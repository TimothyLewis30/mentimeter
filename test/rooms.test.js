'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { createConfig } = require('../lib/config');
const { JsonRoomRepository } = require('../lib/room-repository');
const { RoomRegistry, RoomError, normalizeAnswer } = require('../lib/rooms');

async function makeRegistry(overrides = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudwords-rooms-'));
  const config = createConfig({ dataDir, ...overrides });
  const repository = new JsonRoomRepository(dataDir);
  const registry = new RoomRegistry({ repository, config });
  await registry.load();
  return {
    registry,
    repository,
    config,
    dataDir,
    cleanup: () => fs.rm(dataDir, { recursive: true, force: true }),
  };
}

const activeRecording = { active: true, ownerId: 'owner-1', segment: 1 };

test('normalizeAnswer lowercases, strips punctuation, caps length, and keeps Mandarin', () => {
  assert.equal(normalizeAnswer('  Kerja   Tim!! ', 40), 'kerja tim');
  assert.equal(normalizeAnswer('Hari-Baru', 40), 'hari baru');
  assert.equal(normalizeAnswer('😀', 40), '');
  assert.equal(normalizeAnswer('abcdefghij', 4), 'abcd');
  assert.equal(normalizeAnswer(42, 40), '');
  assert.equal(normalizeAnswer(' 你好！ ', 40), '你好');
  assert.equal(normalizeAnswer('团队 合作', 40), '团队 合作');
  assert.equal(normalizeAnswer('團隊合作', 40), '團隊合作');
});

test('create makes a waiting room with a unique operator token', async () => {
  const ctx = await makeRegistry();
  try {
    const a = await ctx.registry.create({ name: 'Ruang A' });
    const b = await ctx.registry.create({ name: 'Ruang B' });

    assert.equal(a.status, 'waiting');
    assert.equal(a.name, 'Ruang A');
    assert.equal(a.question, ctx.config.defaultQuestion);
    assert.notEqual(a.operatorToken, b.operatorToken);
    assert.match(a.id, /^r_[a-f0-9]{10}$/);
    assert.equal(ctx.registry.publicList().length, 2);
    assert.equal(ctx.registry.publicList()[0].operatorToken, undefined);
  } finally {
    await ctx.cleanup();
  }
});

test('create rejects an empty name and enforces the room limit', async () => {
  const ctx = await makeRegistry({ maxRooms: 1 });
  try {
    await assert.rejects(ctx.registry.create({ name: '   ' }), { code: 'INVALID_NAME' });
    await ctx.registry.create({ name: 'Satu' });
    await assert.rejects(ctx.registry.create({ name: 'Dua' }), { code: 'ROOM_LIMIT' });
  } finally {
    await ctx.cleanup();
  }
});

test('waiting rooms reject answers and start requires active recording', async () => {
  const ctx = await makeRegistry();
  try {
    const room = await ctx.registry.create({ name: 'Ruang' });

    assert.throws(() => ctx.registry.submitAnswer(room.id, 'fokus'), { code: 'NOT_STARTED' });
    await assert.rejects(ctx.registry.start(room.id, { active: false }), {
      code: 'RECORDING_REQUIRED',
    });
    assert.equal(room.status, 'waiting');

    await ctx.registry.start(room.id, activeRecording);
    assert.equal(room.status, 'live');
    assert.equal(room.recording.status, 'recording');
    assert.equal(room.recording.segment, 1);
  } finally {
    await ctx.cleanup();
  }
});

test('live answers accumulate per room and do not leak', async () => {
  const ctx = await makeRegistry();
  try {
    const a = await ctx.registry.create({ name: 'A' });
    const b = await ctx.registry.create({ name: 'B' });
    await ctx.registry.start(a.id, activeRecording);
    await ctx.registry.start(b.id, activeRecording);

    ctx.registry.submitAnswer(a.id, 'Fokus');
    ctx.registry.submitAnswer(a.id, 'fokus');
    ctx.registry.submitAnswer(b.id, 'Tim');

    assert.deepEqual(ctx.registry.formatWords(a), [{ text: 'fokus', size: 2 }]);
    assert.deepEqual(ctx.registry.formatWords(b), [{ text: 'tim', size: 1 }]);
    assert.equal(a.totalAnswers, 2);
    assert.equal(b.totalAnswers, 1);
  } finally {
    await ctx.cleanup();
  }
});

test('formatWords sorts by count then alphabetically and limits output', async () => {
  const ctx = await makeRegistry();
  try {
    const room = await ctx.registry.create({ name: 'Urut' });
    await ctx.registry.start(room.id, activeRecording);
    for (const word of ['tim', 'kerja', 'kerja', 'fokus', 'fokus', 'fokus']) {
      ctx.registry.submitAnswer(room.id, word);
    }
    const words = ctx.registry.formatWords(room, 2);
    assert.deepEqual(words, [
      { text: 'fokus', size: 3 },
      { text: 'kerja', size: 2 },
    ]);
  } finally {
    await ctx.cleanup();
  }
});

test('tied counts use alphabetical order for the top word', async () => {
  const ctx = await makeRegistry();
  try {
    const room = await ctx.registry.create({ name: 'Seri' });
    await ctx.registry.start(room.id, activeRecording);
    ctx.registry.submitAnswer(room.id, 'beta');
    ctx.registry.submitAnswer(room.id, 'alpha');
    assert.deepEqual(ctx.registry.formatWords(room), [
      { text: 'alpha', size: 1 },
      { text: 'beta', size: 1 },
    ]);
  } finally {
    await ctx.cleanup();
  }
});

test('end is terminal, archives, and rejects further answers', async () => {
  const ctx = await makeRegistry();
  try {
    const room = await ctx.registry.create({ name: 'Selesai' });
    await ctx.registry.start(room.id, activeRecording);
    ctx.registry.submitAnswer(room.id, 'fokus');
    await ctx.registry.end(room.id);

    assert.equal(room.status, 'ended');
    assert.equal(room.recording.status, 'stopped');
    assert.throws(() => ctx.registry.submitAnswer(room.id, 'lagi'), { code: 'ENDED' });
    await assert.rejects(ctx.registry.start(room.id, activeRecording), { code: 'ENDED' });
    await assert.rejects(ctx.registry.reset(room.id), { code: 'NOT_WAITING' });
    assert.equal(ctx.registry.publicList().length, 0);

    const archiveDir = path.join(ctx.dataDir, 'archive');
    const files = await fs.readdir(archiveDir);
    assert.equal(files.length, 1);
  } finally {
    await ctx.cleanup();
  }
});

test('reset clears answers only while waiting', async () => {
  const ctx = await makeRegistry();
  try {
    const room = await ctx.registry.create({ name: 'Reset' });
    room.wordCounts.set('lama', 4);
    room.totalAnswers = 4;
    room.recent = [{ text: 'lama', at: Date.now() }];

    await ctx.registry.reset(room.id);
    assert.equal(room.totalAnswers, 0);
    assert.equal(room.wordCounts.size, 0);
    assert.equal(room.recent.length, 0);

    await ctx.registry.start(room.id, activeRecording);
    await assert.rejects(ctx.registry.reset(room.id), { code: 'NOT_WAITING' });
  } finally {
    await ctx.cleanup();
  }
});

test('resumeRecording starts a new segment only while live', async () => {
  const ctx = await makeRegistry();
  try {
    const room = await ctx.registry.create({ name: 'Segmen' });
    await assert.rejects(ctx.registry.resumeRecording(room.id, activeRecording), {
      code: 'NOT_LIVE',
    });
    await ctx.registry.start(room.id, activeRecording);
    await ctx.registry.resumeRecording(room.id, { active: true, ownerId: 'owner-2' });
    assert.equal(room.recording.segment, 2);
    assert.equal(room.recording.status, 'recording');
    assert.equal(room.recording.ownerId, 'owner-2');
  } finally {
    await ctx.cleanup();
  }
});

test('updateRecording rejects invalid statuses and recording while not live', async () => {
  const ctx = await makeRegistry();
  try {
    const room = await ctx.registry.create({ name: 'Meta' });
    await assert.rejects(ctx.registry.updateRecording(room.id, { status: 'wat' }), {
      code: 'INVALID_RECORDING_STATUS',
    });
    await assert.rejects(ctx.registry.updateRecording(room.id, { status: 'recording' }), {
      code: 'NOT_LIVE',
    });
    await ctx.registry.start(room.id, activeRecording);
    await ctx.registry.updateRecording(room.id, { status: 'interrupted', segment: 1 });
    assert.equal(room.recording.status, 'interrupted');
  } finally {
    await ctx.cleanup();
  }
});

test('load ends rooms that were live before a restart and archives them', async () => {
  const ctx = await makeRegistry();
  try {
    const room = await ctx.registry.create({ name: 'Restart' });
    await ctx.registry.start(room.id, activeRecording);

    const reloaded = new RoomRegistry({ repository: ctx.repository, config: ctx.config });
    await reloaded.load();
    const restored = reloaded.get(room.id);

    assert.equal(restored.status, 'ended');
    assert.equal(restored.endReason, 'server-restart');
    assert.equal(restored.recording.status, 'interrupted');
    assert.equal(reloaded.publicList().length, 0);

    const files = await fs.readdir(path.join(ctx.dataDir, 'archive'));
    assert.equal(files.length, 1);
  } finally {
    await ctx.cleanup();
  }
});

test('delete refuses live rooms and removes waiting rooms', async () => {
  const ctx = await makeRegistry();
  try {
    const room = await ctx.registry.create({ name: 'Hapus' });
    await ctx.registry.start(room.id, activeRecording);
    await assert.rejects(ctx.registry.delete(room.id), { code: 'LIVE_ROOM' });

    await ctx.registry.end(room.id);
    await ctx.registry.delete(room.id);
    assert.equal(ctx.registry.get(room.id), null);
  } finally {
    await ctx.cleanup();
  }
});

test('RoomError carries a machine-readable code', () => {
  const error = new RoomError('NOT_FOUND', 'hilang');
  assert.equal(error.code, 'NOT_FOUND');
  assert.equal(error.message, 'hilang');
  assert.ok(error instanceof Error);
});
