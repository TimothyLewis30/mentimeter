'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function metadataOf(room) {
  return {
    id: room.id,
    name: room.name,
    question: room.question,
    status: room.status,
    operatorToken: room.operatorToken,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    startedAt: room.startedAt ?? null,
    endedAt: room.endedAt ?? null,
    endReason: room.endReason ?? null,
  };
}

function timestampForFile(value) {
  return new Date(Number(value) || Date.now())
    .toISOString()
    .replace(/[:.]/g, '-');
}

class JsonRoomRepository {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.registryFile = path.join(dataDir, 'rooms.json');
    this.roomsDir = path.join(dataDir, 'rooms');
    this.archiveDir = path.join(dataDir, 'archive');
    this.registry = [];
    this.queues = new Map();
  }

  async init() {
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    await fs.promises.mkdir(this.roomsDir, { recursive: true });
    await fs.promises.mkdir(this.archiveDir, { recursive: true });
  }

  stateFile(roomId) {
    return path.join(this.roomsDir, `${roomId}.json`);
  }

  async loadAll() {
    await this.init();

    let raw;
    try {
      raw = await fs.promises.readFile(this.registryFile, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.registry = [];
        return [];
      }
      throw err;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`[repository] Registry rusak: ${err.message}`);
      this.registry = [];
      return [];
    }

    const entries = Array.isArray(parsed && parsed.rooms) ? parsed.rooms : [];
    this.registry = entries.map(metadataOf);

    const rooms = [];
    for (const meta of this.registry) {
      let state = null;
      try {
        const stateRaw = await fs.promises.readFile(this.stateFile(meta.id), 'utf8');
        state = JSON.parse(stateRaw);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`[repository] State ${meta.id} rusak: ${err.message}`);
        }
      }
      rooms.push({ ...meta, ...(state || {}) });
    }

    return rooms;
  }

  async saveRegistry(rooms) {
    await this.init();
    this.registry = rooms.map(metadataOf);
    const payload = { version: 1, rooms: this.registry };
    await this.writeAtomic(this.registryFile, JSON.stringify(payload, null, 2));
  }

  async saveState(room) {
    await this.init();
    await this.writeAtomic(this.stateFile(room.id), JSON.stringify(room, null, 2));
  }

  async create(room) {
    const meta = metadataOf(room);
    this.registry = this.registry.filter((item) => item.id !== room.id);
    this.registry.push(meta);
    await this.writeAtomic(
      this.registryFile,
      JSON.stringify({ version: 1, rooms: this.registry }, null, 2)
    );
    await this.saveState(room);
  }

  async archive(room) {
    await this.init();
    const payload = {
      ...room,
      archivedAt: Date.now(),
    };
    const file = path.join(this.archiveDir, `${room.id}_${timestampForFile(room.endedAt || Date.now())}.json`);
    await this.writeAtomic(file, JSON.stringify(payload, null, 2));
    return file;
  }

  async remove(room) {
    await this.init();
    this.registry = this.registry.filter((item) => item.id !== room.id);
    await this.writeAtomic(
      this.registryFile,
      JSON.stringify({ version: 1, rooms: this.registry }, null, 2)
    );

    try {
      await fs.promises.unlink(this.stateFile(room.id));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async flush() {
    while (this.queues.size > 0) {
      const pending = [...this.queues.values()];
      await Promise.all(pending.map((task) => task.catch(() => {})));
    }
  }

  async writeAtomic(file, contents) {    const task = async () => {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fs.promises.writeFile(temp, contents, 'utf8');
      await fs.promises.rename(temp, file);
    };

    const previous = this.queues.get(file) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    this.queues.set(file, next);

    try {
      await next;
    } finally {
      if (this.queues.get(file) === next) {
        this.queues.delete(file);
      }
    }
  }
}

module.exports = { JsonRoomRepository };
