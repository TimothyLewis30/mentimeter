'use strict';

/**
 * CloudWords Multi-Room
 * ---------------------
 * Express + Socket.IO server untuk banyak room word cloud.
 *
 * Dua namespace:
 *  - /room  : audience, display, operator, admin watcher
 *  - /admin : super admin (registry room)
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { createConfig } = require('./lib/config');
const {
  verifyPassword,
  safeEqual,
  signAdminToken,
  verifyAdminToken,
  LoginRateLimiter,
} = require('./lib/auth');
const { JsonRoomRepository } = require('./lib/room-repository');
const { RoomRegistry, RoomError } = require('./lib/rooms');

const PUBLIC_DIR = path.join(__dirname, 'public');

function roomChannel(roomId) {
  return `room:${roomId}`;
}

function roleChannel(roomId, role) {
  return `room:${roomId}:${role}`;
}

function reply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

function socketError(code, message) {
  const error = new Error(message);
  error.data = { code, message };
  return error;
}

function errorResponse(error) {
  if (error instanceof RoomError) {
    return { ok: false, code: error.code, message: error.message };
  }
  console.error('[server]', error);
  return { ok: false, code: 'ERROR', message: 'Terjadi kesalahan di server.' };
}

function createCloudWordsServer(overrides = {}) {
  const config = createConfig(overrides);
  const repository = new JsonRoomRepository(config.dataDir);
  const registry = new RoomRegistry({ repository, config });
  const loginLimiter = new LoginRateLimiter({ maxAttempts: 10, windowMs: 5 * 60 * 1000 });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '16kb' }));

  const server = http.createServer(app);
  const ioOptions = {
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e5,
    perMessageDeflate: false,
    connectionStateRecovery: {
      maxDisconnectionDuration: 120000,
      skipMiddlewares: false,
    },
  };
  if (process.env.CORS_ORIGIN) {
    ioOptions.cors = { origin: process.env.CORS_ORIGIN, methods: ['GET', 'POST'] };
  }

  const io = new Server(server, ioOptions);
  const roomNs = io.of('/room');
  const adminNs = io.of('/admin');

  const dirtyRooms = new Set();
  const statsRooms = new Set();
  const broadcastCache = new Map();
  const stateSaveTimers = new Map();

  let statsTimer = null;
  let adminRoomsTimer = null;
  let flushTimer = null;

  function cacheFor(roomId) {
    let cache = broadcastCache.get(roomId);
    if (!cache) {
      cache = { words: undefined, top: undefined, stats: undefined };
      broadcastCache.set(roomId, cache);
    }
    return cache;
  }

  function clearBroadcastCache(roomId) {
    broadcastCache.delete(roomId);
    dirtyRooms.delete(roomId);
    statsRooms.delete(roomId);
  }

  function countParticipants(roomId) {
    const room = roomNs.adapter.rooms.get(roleChannel(roomId, 'audience'));
    return room ? room.size : 0;
  }

  function countDisplays(roomId) {
    const room = roomNs.adapter.rooms.get(roleChannel(roomId, 'display'));
    return room ? room.size : 0;
  }

  function isOperatorOnline(room) {
    return Boolean(
      room.operatorSocketId && roomNs.sockets.get(room.operatorSocketId)
    );
  }

  function buildStats(room) {
    return registry.stats(room, countParticipants(room.id));
  }

  function roomView(room) {
    return {
      id: room.id,
      name: room.name,
      question: room.question,
      status: room.status,
      startedAt: room.startedAt,
      endedAt: room.endedAt,
    };
  }

  function adminRoomView(room) {
    return {
      ...roomView(room),
      operatorToken: room.operatorToken,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      endReason: room.endReason,
      totalAnswers: room.totalAnswers,
      uniqueWords: room.wordCounts.size,
      participants: countParticipants(room.id),
      displayOnline: countDisplays(room.id) > 0,
      operatorOnline: isOperatorOnline(room),
      recording: { ...room.recording },
    };
  }

  function buildInitPayload(room, role, socket) {
    const isFull = role !== 'audience';
    return {
      room: roomView(room),
      words: registry.formatWords(room, isFull ? config.maxCloudWords : 5),
      stats: buildStats(room),
      recent: role === 'operator' || role === 'admin' ? room.recent : [],
      recording: isFull ? { ...room.recording } : null,
      isController: role === 'operator' ? room.operatorSocketId === socket.id : undefined,
      serverTime: Date.now(),
      broadcastInterval: config.broadcastInterval,
    };
  }

  function buildAdminPayload() {
    return {
      rooms: registry.list().map((room) => adminRoomView(room)),
    };
  }

  function flushStats(roomId) {
    const room = registry.get(roomId);
    if (!room) return;
    const stats = buildStats(room);
    const cache = cacheFor(roomId);
    const json = JSON.stringify(stats);
    if (cache.stats !== json) {
      cache.stats = json;
      roomNs.to(roomChannel(roomId)).emit('stats:update', stats);
    }
  }

  function flushDirtyRooms() {
    const ids = [...dirtyRooms];
    dirtyRooms.clear();

    for (const roomId of ids) {
      const room = registry.get(roomId);
      if (!room) {
        clearBroadcastCache(roomId);
        continue;
      }

      const words = registry.formatWords(room, config.maxCloudWords);
      const cache = cacheFor(roomId);
      const wordsJSON = JSON.stringify(words);
      if (cache.words !== wordsJSON) {
        cache.words = wordsJSON;
        roomNs
          .to(roleChannel(roomId, 'display'))
          .to(roleChannel(roomId, 'operator'))
          .to(roleChannel(roomId, 'admin'))
          .emit('update-wordcloud', words);
      }

      const top = words.slice(0, 5);
      const topJSON = JSON.stringify(top);
      if (cache.top !== topJSON) {
        cache.top = topJSON;
        roomNs.to(roleChannel(roomId, 'audience')).emit('topwords:update', top);
      }

      flushStats(roomId);
    }
  }

  function markDirty(roomId) {
    dirtyRooms.add(roomId);
  }

  function scheduleStats(roomId) {
    statsRooms.add(roomId);
    if (statsTimer) return;
    statsTimer = setTimeout(() => {
      statsTimer = null;
      const ids = [...statsRooms];
      statsRooms.clear();
      for (const id of ids) flushStats(id);
    }, 200);
    if (typeof statsTimer.unref === 'function') statsTimer.unref();
  }

  function scheduleAdminRooms() {
    if (adminRoomsTimer) return;
    adminRoomsTimer = setTimeout(() => {
      adminRoomsTimer = null;
      adminNs.emit('admin:rooms', buildAdminPayload());
    }, 1000);
    if (typeof adminRoomsTimer.unref === 'function') adminRoomsTimer.unref();
  }

  function broadcastAdminRooms() {
    if (adminRoomsTimer) {
      clearTimeout(adminRoomsTimer);
      adminRoomsTimer = null;
    }
    adminNs.emit('admin:rooms', buildAdminPayload());
  }

  function broadcastStatus(room) {
    roomNs.to(roomChannel(room.id)).emit('room:status', {
      status: room.status,
      startedAt: room.startedAt,
      endedAt: room.endedAt,
      recording: { ...room.recording },
    });
  }

  function broadcastRecording(room) {
    roomNs
      .to(roleChannel(room.id, 'display'))
      .to(roleChannel(room.id, 'operator'))
      .to(roleChannel(room.id, 'admin'))
      .emit('recording:update', { ...room.recording });
  }

  function broadcastRoomMeta(room) {
    roomNs.to(roomChannel(room.id)).emit('room:meta', {
      name: room.name,
      question: room.question,
    });
  }

  function scheduleStateSave(room) {
    clearStateSave(room.id);
    const timer = setTimeout(() => {
      stateSaveTimers.delete(room.id);
      if (registry.get(room.id) !== room) return;
      void registry.persistState(room).catch((err) => {
        console.error(`[state] Gagal menyimpan room ${room.id}: ${err.message}`);
      });
    }, 1500);
    if (typeof timer.unref === 'function') timer.unref();
    stateSaveTimers.set(room.id, timer);
  }

  function clearStateSave(roomId) {
    const timer = stateSaveTimers.get(roomId);
    if (timer) clearTimeout(timer);
    stateSaveTimers.delete(roomId);
  }

  function ensureController(socket, room, ack) {
    if (socket.data.role !== 'operator') {
      reply(ack, { ok: false, code: 'FORBIDDEN', message: 'Hanya operator yang dapat melakukan aksi ini.' });
      return false;
    }
    if (room.operatorSocketId !== socket.id) {
      reply(ack, { ok: false, code: 'NOT_CONTROLLER', message: 'Sesi operator ini sudah diambil alih tab/perangkat lain.' });
      return false;
    }
    return true;
  }

  function attachOperator(socket, room) {
    const previous = room.operatorSocketId
      ? roomNs.sockets.get(room.operatorSocketId)
      : null;

    if (previous && previous.id !== socket.id) {
      previous.emit('operator:superseded', { reason: 'new-controller' });
      setTimeout(() => {
        try {
          previous.disconnect(true);
        } catch (err) {
          /* ignore */
        }
      }, 300);
    }

    room.operatorSocketId = socket.id;

    if (room.status === 'live' && room.recording.status === 'recording') {
      room.recording.status = 'interrupted';
      room.recording.updatedAt = Date.now();
      void registry.persistState(room).catch(() => {});
      broadcastRecording(room);
      scheduleAdminRooms();
    }
  }

  function handleDisconnect(socket, room) {
    if (registry.get(room.id) !== room) {
      scheduleAdminRooms();
      return;
    }

    if (socket.data.role === 'operator' && room.operatorSocketId === socket.id) {
      room.operatorSocketId = null;
      if (room.status === 'live' && room.recording.status === 'recording') {
        room.recording.status = 'unknown';
        room.recording.updatedAt = Date.now();
        void registry.persistState(room).catch(() => {});
        broadcastRecording(room);
      }
    }

    scheduleStats(room.id);
    scheduleAdminRooms();
  }

  // ---------------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------------

  function sendPage(res, file) {
    res.sendFile(path.join(PUBLIC_DIR, file));
  }

  function sendNotFound(res, message) {
    res.status(404).type('html').send(`<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Room tidak ditemukan — CloudWords</title>
<link rel="stylesheet" href="/css/style.css"></head>
<body class="audience-page"><main class="audience-main"><section class="audience-card">
<p class="eyebrow">404</p><h1 class="question">${message}</h1>
<p class="hint">Periksa link room atau kembali ke lobby.</p>
<a class="btn btn-primary" href="/">Kembali ke lobby</a>
</section></main></body></html>`);
  }

  app.get('/', (_req, res) => sendPage(res, 'index.html'));

  app.get('/api/rooms', (_req, res) => {
    const rooms = registry.publicList()
      .map((room) => ({
        id: room.id,
        name: room.name,
        question: room.question,
        status: room.status,
        participants: countParticipants(room.id),
        totalAnswers: room.totalAnswers,
        uniqueWords: room.uniqueWords,
      }))
      .sort((a, b) => {
        const rank = { live: 0, waiting: 1 };
        return (rank[a.status] ?? 2) - (rank[b.status] ?? 2) || a.name.localeCompare(b.name);
      });

    res.json({ rooms });
  });

  app.post('/api/admin/login', (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!loginLimiter.check(ip)) {
      return res.status(429).json({
        ok: false,
        message: 'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.',
      });
    }

    const password = req.body && req.body.password;
    if (typeof password !== 'string' || !verifyPassword(password, config.adminPassword)) {
      loginLimiter.fail(ip);
      return res.status(401).json({ ok: false, message: 'Password admin salah.' });
    }

    loginLimiter.reset(ip);
    const { token, expiresAt } = signAdminToken({
      secret: config.sessionSecret,
      ttlMs: config.adminTokenTtlMs,
    });
    res.json({ ok: true, token, expiresAt });
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      connections: io.engine.clientsCount,
      rooms: registry.list().length,
      liveRooms: registry.list().filter((room) => room.status === 'live').length,
    });
  });

  // Pemilih room per peran (tanpa roomId).
  app.get('/display', (_req, res) => sendPage(res, 'picker.html'));
  app.get('/join', (_req, res) => sendPage(res, 'picker.html'));
  app.get('/operator', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    sendPage(res, 'operator-entry.html');
  });
  app.get('/room', (_req, res) => res.redirect('/join'));

  app.get('/room/:roomId', (req, res) => {
    if (!registry.get(req.params.roomId)) {
      return sendNotFound(res, 'Room tidak ditemukan.');
    }
    sendPage(res, 'room.html');
  });

  app.get('/display/:roomId', (req, res) => {
    if (!registry.get(req.params.roomId)) {
      return sendNotFound(res, 'Room tidak ditemukan.');
    }
    sendPage(res, 'display.html');
  });

  app.get('/operator/:roomId', (req, res) => {
    if (!registry.get(req.params.roomId)) {
      return sendNotFound(res, 'Room tidak ditemukan.');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    sendPage(res, 'operator.html');
  });

  app.get(['/admin', '/superadmin'], (_req, res) => sendPage(res, 'admin.html'));

  app.use(
    express.static(PUBLIC_DIR, {
      extensions: ['html'],
      etag: true,
      maxAge: 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  app.use((_req, res) => {
    res.status(404).type('text').send('404 — Halaman tidak ditemukan. Buka / untuk lobby.');
  });

  // ---------------------------------------------------------------------------
  // Socket.IO auth
  // ---------------------------------------------------------------------------

  adminNs.use((socket, next) => {
    const auth = socket.handshake.auth || {};
    const result = verifyAdminToken(auth.token, config.sessionSecret);
    if (!result.valid) {
      return next(socketError('UNAUTHORIZED', 'Sesi admin tidak valid atau sudah kedaluwarsa.'));
    }
    socket.data.role = 'admin';
    next();
  });

  roomNs.use((socket, next) => {
    const auth = socket.handshake.auth || {};
    const roomId = typeof auth.roomId === 'string' ? auth.roomId : '';
    const role = ['audience', 'display', 'operator', 'admin'].includes(auth.role)
      ? auth.role
      : '';
    const room = registry.get(roomId);

    if (!room) {
      return next(socketError('ROOM_NOT_FOUND', 'Room tidak ditemukan.'));
    }
    if (!role) {
      return next(socketError('INVALID_ROLE', 'Peran koneksi tidak valid.'));
    }
    if (role === 'operator' && !safeEqual(auth.token, room.operatorToken)) {
      return next(socketError('INVALID_TOKEN', 'Token operator tidak valid.'));
    }
    if (role === 'admin' && !verifyAdminToken(auth.token, config.sessionSecret).valid) {
      return next(socketError('UNAUTHORIZED', 'Sesi admin tidak valid.'));
    }

    socket.data.roomId = roomId;
    socket.data.role = role;
    next();
  });

  // ---------------------------------------------------------------------------
  // Room namespace
  // ---------------------------------------------------------------------------

  roomNs.on('connection', (socket) => {
    const room = registry.get(socket.data.roomId);
    if (!room) {
      socket.disconnect(true);
      return;
    }

    const { roomId, role } = socket.data;
    socket.join(roomChannel(roomId));
    socket.join(roleChannel(roomId, role));

    if (role === 'operator') {
      attachOperator(socket, room);
    }

    socket.emit('room:init', buildInitPayload(room, role, socket));
    scheduleStats(roomId);
    scheduleAdminRooms();

    socket.on('submit-answer', (rawAnswer, ack) => {
      if (socket.data.role !== 'audience') {
        return reply(ack, { ok: false, code: 'FORBIDDEN', message: 'Hanya peserta yang dapat mengirim jawaban.' });
      }
      if (registry.get(room.id) !== room) {
        return reply(ack, { ok: false, code: 'ROOM_NOT_FOUND', message: 'Room tidak ditemukan.' });
      }

      const now = Date.now();
      const lastAnswerAt = Number(socket.data.lastAnswerAt) || 0;
      if (room.status === 'live' && now - lastAnswerAt < config.answerCooldownMs) {
        return reply(ack, {
          ok: false,
          code: 'COOLDOWN',
          message: 'Terlalu cepat! Tunggu sebentar sebelum mengirim lagi.',
        });
      }

      try {
        const result = registry.submitAnswer(room.id, rawAnswer);
        socket.data.lastAnswerAt = now;

        const entry = room.recent[0] || { text: result.text, at: now };
        roomNs
          .to(roleChannel(room.id, 'operator'))
          .to(roleChannel(room.id, 'admin'))
          .emit('activity:new', entry);

        markDirty(room.id);
        scheduleStats(room.id);
        scheduleAdminRooms();
        scheduleStateSave(room);

        reply(ack, {
          ok: true,
          text: result.text,
          totalAnswers: result.totalAnswers,
          message: 'Jawaban berhasil terkirim!',
        });
      } catch (err) {
        reply(ack, errorResponse(err));
      }
    });

    socket.on('operator:start', async (payload, ack) => {
      if (!ensureController(socket, room, ack)) return;
      if (registry.get(room.id) !== room) {
        return reply(ack, { ok: false, code: 'ROOM_NOT_FOUND', message: 'Room tidak ditemukan.' });
      }

      try {
        await registry.start(room.id, payload && payload.recording);
        broadcastStatus(room);
        broadcastRecording(room);
        markDirty(room.id);
        flushDirtyRooms();
        flushStats(room.id);
        broadcastAdminRooms();
        reply(ack, { ok: true, room: roomView(room), stats: buildStats(room) });
      } catch (err) {
        reply(ack, errorResponse(err));
      }
    });

    socket.on('operator:resume-recording', async (payload, ack) => {
      if (!ensureController(socket, room, ack)) return;
      try {
        await registry.resumeRecording(room.id, payload && payload.recording);
        broadcastRecording(room);
        scheduleAdminRooms();
        reply(ack, { ok: true, recording: { ...room.recording } });
      } catch (err) {
        reply(ack, errorResponse(err));
      }
    });

    socket.on('operator:recording', async (payload, ack) => {
      if (!ensureController(socket, room, ack)) return;
      try {
        await registry.updateRecording(room.id, payload || {});
        broadcastRecording(room);
        scheduleAdminRooms();
        reply(ack, { ok: true, recording: { ...room.recording } });
      } catch (err) {
        reply(ack, errorResponse(err));
      }
    });

    socket.on('operator:end', async (_payload, ack) => {
      if (!ensureController(socket, room, ack)) return;
      try {
        await registry.end(room.id);
        broadcastStatus(room);
        broadcastRecording(room);
        markDirty(room.id);
        flushDirtyRooms();
        flushStats(room.id);
        broadcastAdminRooms();
        reply(ack, { ok: true, room: roomView(room), stats: buildStats(room) });
      } catch (err) {
        reply(ack, errorResponse(err));
      }
    });

    socket.on('reset-data', async (_payload, ack) => {
      if (!ensureController(socket, room, ack)) return;
      try {
        await registry.reset(room.id);
        clearBroadcastCache(room.id);
        markDirty(room.id);
        flushDirtyRooms();
        flushStats(room.id);
        broadcastAdminRooms();
        reply(ack, { ok: true, message: 'Word cloud dikosongkan.' });
      } catch (err) {
        reply(ack, errorResponse(err));
      }
    });

    socket.on('disconnect', () => handleDisconnect(socket, room));
  });

  // ---------------------------------------------------------------------------
  // Admin namespace
  // ---------------------------------------------------------------------------

  adminNs.on('connection', (socket) => {
    socket.emit('admin:rooms', buildAdminPayload());

    socket.on('admin:create-room', async (payload, ack) => {
      try {
        const room = await registry.create({
          name: payload && payload.name,
          question: payload && payload.question,
        });
        broadcastAdminRooms();
        reply(ack, {
          ok: true,
          room: adminRoomView(room),
          operatorToken: room.operatorToken,
          message: `Room "${room.name}" dibuat.`,
        });
      } catch (err) {
        reply(ack, errorResponse(err));
      }
    });

    socket.on('admin:update-room', async (payload, ack) => {
      try {
        const room = await registry.updateMeta(payload && payload.roomId, {
          name: payload && payload.name,
          question: payload && payload.question,
        });
        broadcastRoomMeta(room);
        broadcastAdminRooms();
        reply(ack, { ok: true, room: adminRoomView(room), message: 'Room diperbarui.' });
      } catch (err) {
        reply(ack, errorResponse(err));
      }
    });

    socket.on('admin:delete-room', async (payload, ack) => {
      const roomId = payload && payload.roomId;
      const room = registry.get(roomId);
      try {
        await registry.delete(roomId);
        if (room) {
          roomNs.to(roomChannel(roomId)).emit('room:deleted', { roomId });
          roomNs.in(roomChannel(roomId)).disconnectSockets(true);
        }
        clearBroadcastCache(roomId);
        clearStateSave(roomId);
        broadcastAdminRooms();
        reply(ack, { ok: true, message: 'Room dihapus.' });
      } catch (err) {
        reply(ack, errorResponse(err));
      }
    });

    socket.on('admin:regenerate-token', async (payload, ack) => {
      const roomId = payload && payload.roomId;
      try {
        const token = await registry.regenerateToken(roomId);
        const room = registry.get(roomId);
        const operatorSocket = room && room.operatorSocketId
          ? roomNs.sockets.get(room.operatorSocketId)
          : null;

        if (operatorSocket) {
          operatorSocket.emit('operator:revoked', { reason: 'token-regenerated' });
          setTimeout(() => {
            try {
              operatorSocket.disconnect(true);
            } catch (err) {
              /* ignore */
            }
          }, 300);
        }

        if (room) {
          room.operatorSocketId = null;
          if (room.status === 'live' && room.recording.status === 'recording') {
            room.recording.status = 'interrupted';
            room.recording.updatedAt = Date.now();
            await registry.persistState(room);
            broadcastRecording(room);
          }
        }

        broadcastAdminRooms();
        reply(ack, {
          ok: true,
          operatorToken: token,
          message: 'Token operator diperbarui. Operator lama telah dicabut.',
        });
      } catch (err) {
        reply(ack, errorResponse(err));
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  flushTimer = setInterval(flushDirtyRooms, config.broadcastInterval);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();

  let started = false;

  async function start(port = config.port) {
    if (started) return server.address();
    await registry.load();

    await new Promise((resolve, reject) => {
      const onError = (err) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port);
    });

    started = true;
    return server.address();
  }

  async function stop() {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    if (statsTimer) {
      clearTimeout(statsTimer);
      statsTimer = null;
    }
    if (adminRoomsTimer) {
      clearTimeout(adminRoomsTimer);
      adminRoomsTimer = null;
    }

    const pending = [];
    for (const [roomId, timer] of [...stateSaveTimers.entries()]) {
      clearTimeout(timer);
      stateSaveTimers.delete(roomId);
      const room = registry.get(roomId);
      if (room) {
        pending.push(registry.persistState(room).catch(() => {}));
      }
    }

    await new Promise((resolve) => {
      io.close(() => resolve());
    });
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.all(pending);
    await repository.flush();
    await new Promise((resolve) => setImmediate(resolve));
    await repository.flush();

    started = false;
  }

  return {
    app,
    server,
    io,
    registry,
    repository,
    config,
    start,
    stop,
  };
}

if (require.main === module) {
  const instance = createCloudWordsServer();
  instance
    .start()
    .then(() => {
      const port = instance.config.port;
      console.log('');
      console.log('  ☁  CloudWords — Multi-Room Word Cloud');
      console.log(`  ➜  Lobby        : http://localhost:${port}/`);
      console.log(`  ➜  Super admin  : http://localhost:${port}/admin`);
      console.log(`  ➜  Health       : http://localhost:${port}/health`);
      console.log(`  ➜  Data         : ${instance.config.dataDir}`);
      console.log(`  ➜  Credentials  : ${instance.config.credentialsFile}`);
      console.log('     (file JSON ini di-ignore git — ubah adminPassword sebelum dipakai)');
      console.log('');
    })
    .catch((err) => {
      console.error('[server] Gagal start:', err);
      process.exit(1);
    });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[server] Menerima ${signal}, menutup server...`);
    instance
      .stop()
      .finally(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { createCloudWordsServer };
