'use strict';

const crypto = require('crypto');

class RoomError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'RoomError';
    this.code = code;
  }
}

function cleanText(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeAnswer(raw, maxLength = 40) {
  if (typeof raw !== 'string') return '';
  let text = raw.normalize('NFKC').toLowerCase();
  text = text.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > maxLength) {
    text = text.slice(0, maxLength).trim();
  }
  return text;
}

function defaultRecording() {
  return {
    status: 'idle',
    ownerId: null,
    segment: 0,
    startedAt: null,
    updatedAt: null,
  };
}

class RoomRegistry {
  constructor({ repository, config }) {
    this.repository = repository;
    this.config = config;
    this.rooms = new Map();
  }

  async load() {
    const rawRooms = await this.repository.loadAll();
    const now = Date.now();

    for (const raw of rawRooms) {
      let room;
      try {
        room = this.deserializeRoom(raw);
      } catch (err) {
        console.error(`[rooms] Melewati room rusak: ${err.message}`);
        continue;
      }

      if (room.status === 'live') {
        room.status = 'ended';
        room.endedAt = now;
        room.endReason = 'server-restart';
        if (room.recording.status === 'recording') {
          room.recording.status = 'interrupted';
          room.recording.updatedAt = now;
        }
        room.updatedAt = now;
        try {
          await this.repository.saveState(this.serializeRoom(room));
          await this.repository.archive(this.serializeRoom(room));
        } catch (err) {
          console.error(`[rooms] Gagal mengarsipkan room ${room.id}: ${err.message}`);
        }
      }

      this.rooms.set(room.id, room);
    }

    if (this.rooms.size > 0) {
      await this.persistRegistry();
    }

    return this;
  }

  list() {
    return [...this.rooms.values()];
  }

  publicList() {
    return this.list()
      .filter((room) => room.status === 'waiting' || room.status === 'live')
      .map((room) => ({
        id: room.id,
        name: room.name,
        question: room.question,
        status: room.status,
        createdAt: room.createdAt,
        startedAt: room.startedAt,
        endedAt: room.endedAt,
        totalAnswers: room.totalAnswers,
        uniqueWords: room.wordCounts.size,
      }));
  }

  get(id) {
    return this.rooms.get(id) || null;
  }

  generateId() {
    let id;
    do {
      id = `r_${crypto.randomBytes(5).toString('hex')}`;
    } while (this.rooms.has(id));
    return id;
  }

  async create({ name, question }) {
    if (this.rooms.size >= this.config.maxRooms) {
      throw new RoomError('ROOM_LIMIT', `Maksimal ${this.config.maxRooms} room.`);
    }

    const cleanName = cleanText(name, 60);
    const cleanQuestion = cleanText(question || this.config.defaultQuestion, 140) || this.config.defaultQuestion;

    if (!cleanName) {
      throw new RoomError('INVALID_NAME', 'Nama room wajib diisi.');
    }
    if (cleanQuestion.length < 3) {
      throw new RoomError('INVALID_QUESTION', 'Pertanyaan minimal 3 karakter.');
    }

    const now = Date.now();
    const room = {
      id: this.generateId(),
      name: cleanName,
      question: cleanQuestion,
      status: 'waiting',
      operatorToken: crypto.randomBytes(32).toString('base64url'),
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      endedAt: null,
      endReason: null,
      totalAnswers: 0,
      wordCounts: new Map(),
      recent: [],
      recording: defaultRecording(),
      operatorSocketId: null,
    };

    this.rooms.set(room.id, room);
    await this.repository.create(this.serializeRoom(room));
    return room;
  }

  async updateMeta(id, { name, question }) {
    const room = this.requireRoom(id);
    if (room.status !== 'waiting') {
      throw new RoomError('NOT_WAITING', 'Room hanya bisa diedit saat waiting.');
    }

    if (name !== undefined) {
      const cleanName = cleanText(name, 60);
      if (!cleanName) throw new RoomError('INVALID_NAME', 'Nama room wajib diisi.');
      room.name = cleanName;
    }

    if (question !== undefined) {
      const cleanQuestion = cleanText(question, 140);
      if (cleanQuestion.length < 3) {
        throw new RoomError('INVALID_QUESTION', 'Pertanyaan minimal 3 karakter.');
      }
      room.question = cleanQuestion;
    }

    room.updatedAt = Date.now();
    await this.persist(room);
    return room;
  }

  async delete(id) {
    const room = this.requireRoom(id);
    if (room.status === 'live') {
      throw new RoomError('LIVE_ROOM', 'Room live tidak bisa dihapus. Akhiri sesi terlebih dahulu.');
    }

    this.rooms.delete(id);
    await this.repository.remove(this.serializeRoom(room));
  }

  async regenerateToken(id) {
    const room = this.requireRoom(id);
    room.operatorToken = crypto.randomBytes(32).toString('base64url');
    room.updatedAt = Date.now();
    await this.persist(room);
    return room.operatorToken;
  }

  async start(id, recording = {}) {
    const room = this.requireRoom(id);
    if (room.status === 'live') throw new RoomError('ALREADY_LIVE', 'Room sudah live.');
    if (room.status === 'ended') throw new RoomError('ENDED', 'Room sudah berakhir.');
    if (!recording || recording.active !== true) {
      throw new RoomError('RECORDING_REQUIRED', 'Recording harus aktif sebelum room dimulai.');
    }

    const now = Date.now();
    room.status = 'live';
    room.startedAt = now;
    room.endedAt = null;
    room.endReason = null;
    room.updatedAt = now;
    room.recording = {
      status: 'recording',
      ownerId: typeof recording.ownerId === 'string' ? recording.ownerId : null,
      segment: 1,
      startedAt: now,
      updatedAt: now,
    };

    await this.persist(room);
    return room;
  }

  async resumeRecording(id, recording = {}) {
    const room = this.requireRoom(id);
    if (room.status !== 'live') {
      throw new RoomError('NOT_LIVE', 'Recording hanya bisa dilanjutkan saat room live.');
    }
    if (!recording || recording.active !== true) {
      throw new RoomError('RECORDING_REQUIRED', 'Recording baru belum aktif.');
    }

    const now = Date.now();
    const nextSegment =
      Number.isFinite(Number(recording.segment)) && Number(recording.segment) > 0
        ? Math.floor(Number(recording.segment))
        : (room.recording.segment || 0) + 1;

    room.recording = {
      status: 'recording',
      ownerId: typeof recording.ownerId === 'string' ? recording.ownerId : room.recording.ownerId,
      segment: nextSegment,
      startedAt: now,
      updatedAt: now,
    };

    await this.persistState(room);
    return room;
  }

  async updateRecording(id, payload = {}) {
    const room = this.requireRoom(id);
    const allowed = new Set(['recording', 'interrupted', 'stopped', 'unknown']);
    if (!allowed.has(payload.status)) {
      throw new RoomError('INVALID_RECORDING_STATUS', 'Status recording tidak valid.');
    }
    if (payload.status === 'recording' && room.status !== 'live') {
      throw new RoomError('NOT_LIVE', 'Recording hanya bisa aktif saat room live.');
    }

    const now = Date.now();
    room.recording.status = payload.status;
    if (typeof payload.ownerId === 'string') room.recording.ownerId = payload.ownerId;
    if (Number.isFinite(Number(payload.segment)) && Number(payload.segment) > 0) {
      room.recording.segment = Math.floor(Number(payload.segment));
    }
    room.recording.updatedAt = now;

    await this.persistState(room);
    return room;
  }

  async end(id, reason = 'operator') {
    const room = this.requireRoom(id);
    if (room.status === 'ended') return room;
    if (room.status !== 'live') {
      throw new RoomError('NOT_LIVE', 'Room belum live.');
    }

    const now = Date.now();
    room.status = 'ended';
    room.endedAt = now;
    room.endReason = reason;
    room.updatedAt = now;
    room.recording.status = 'stopped';
    room.recording.updatedAt = now;

    await this.persist(room);
    await this.repository.archive(this.serializeRoom(room));
    return room;
  }

  async reset(id) {
    const room = this.requireRoom(id);
    if (room.status !== 'waiting') {
      throw new RoomError('NOT_WAITING', 'Reset hanya bisa saat room waiting.');
    }

    room.wordCounts.clear();
    room.totalAnswers = 0;
    room.recent = [];
    room.recording = defaultRecording();
    room.updatedAt = Date.now();

    await this.persist(room);
    return room;
  }

  submitAnswer(id, raw) {
    const room = this.requireRoom(id);
    if (room.status === 'waiting') {
      throw new RoomError('NOT_STARTED', 'Sesi belum dimulai oleh operator.');
    }
    if (room.status === 'ended') {
      throw new RoomError('ENDED', 'Sesi sudah berakhir.');
    }

    const text = normalizeAnswer(raw, this.config.maxAnswerLength);
    if (!text) {
      throw new RoomError('INVALID', 'Jawaban tidak valid. Gunakan huruf atau angka.');
    }

    const existing = room.wordCounts.get(text);
    if (existing === undefined && room.wordCounts.size >= this.config.maxUniqueWords) {
      throw new RoomError('LIMIT', 'Batas kata unik tercapai. Coba kata lain yang sudah ada.');
    }

    const now = Date.now();
    room.wordCounts.set(text, (existing || 0) + 1);
    room.totalAnswers += 1;
    room.updatedAt = now;
    room.recent.unshift({ text, at: now });
    room.recent = room.recent.slice(0, this.config.recentLimit);

    return {
      text,
      totalAnswers: room.totalAnswers,
      uniqueWords: room.wordCounts.size,
      topWord: this.formatWords(room, 1)[0] || null,
    };
  }

  formatWords(room, limit = this.config.maxCloudWords) {
    return [...room.wordCounts.entries()]
      .map(([text, size]) => ({ text, size }))
      .sort((a, b) => b.size - a.size || a.text.localeCompare(b.text))
      .slice(0, limit);
  }

  stats(room, participants = 0) {
    return {
      participants: Math.max(0, Number(participants) || 0),
      totalAnswers: room.totalAnswers,
      uniqueWords: room.wordCounts.size,
      topWord: this.formatWords(room, 1)[0] || null,
      status: room.status,
      accepting: room.status === 'live',
    };
  }

  serializeRoom(room) {
    return {
      id: room.id,
      name: room.name,
      question: room.question,
      status: room.status,
      operatorToken: room.operatorToken,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      startedAt: room.startedAt,
      endedAt: room.endedAt,
      endReason: room.endReason,
      totalAnswers: room.totalAnswers,
      wordCounts: Object.fromEntries(room.wordCounts),
      recent: room.recent,
      recording: { ...room.recording },
    };
  }

  deserializeRoom(data) {
    if (!data || typeof data.id !== 'string') {
      throw new Error('Room tanpa id.');
    }

    const wordCounts = new Map();
    if (data.wordCounts && typeof data.wordCounts === 'object') {
      for (const [word, count] of Object.entries(data.wordCounts)) {
        const safe = Number(count);
        if (typeof word === 'string' && word && Number.isFinite(safe) && safe > 0) {
          wordCounts.set(word, Math.floor(safe));
        }
      }
    }

    const recent = Array.isArray(data.recent)
      ? data.recent
          .filter((item) => item && typeof item.text === 'string' && Number.isFinite(item.at))
          .slice(0, this.config.recentLimit)
          .map((item) => ({ text: item.text, at: item.at }))
      : [];

    const status = ['waiting', 'live', 'ended'].includes(data.status) ? data.status : 'waiting';
    const recording = { ...defaultRecording(), ...(data.recording || {}) };

    return {
      id: data.id,
      name: cleanText(data.name, 60) || 'Ruang tanpa nama',
      question: cleanText(data.question, 140) || this.config.defaultQuestion,
      status,
      operatorToken: typeof data.operatorToken === 'string' ? data.operatorToken : '',
      createdAt: Number(data.createdAt) || Date.now(),
      updatedAt: Number(data.updatedAt) || Date.now(),
      startedAt: Number.isFinite(Number(data.startedAt)) ? Number(data.startedAt) : null,
      endedAt: Number.isFinite(Number(data.endedAt)) ? Number(data.endedAt) : null,
      endReason: typeof data.endReason === 'string' ? data.endReason : null,
      totalAnswers: Math.max(0, Number(data.totalAnswers) || 0),
      wordCounts,
      recent,
      recording,
      operatorSocketId: null,
    };
  }

  requireRoom(id) {
    const room = this.rooms.get(id);
    if (!room) throw new RoomError('NOT_FOUND', 'Room tidak ditemukan.');
    return room;
  }

  async persist(room) {
    await this.persistState(room);
    await this.persistRegistry();
  }

  async persistState(room) {
    await this.repository.saveState(this.serializeRoom(room));
  }

  async persistRegistry() {
    await this.repository.saveRegistry(this.list().map((room) => this.serializeRoom(room)));
  }
}

module.exports = {
  RoomRegistry,
  RoomError,
  normalizeAnswer,
  cleanText,
  defaultRecording,
};
