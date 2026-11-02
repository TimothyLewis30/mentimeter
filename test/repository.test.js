'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { JsonRoomRepository } = require('../lib/room-repository');

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'cloudwords-repo-'));
}

function sampleRoom(overrides = {}) {
  return {
    id: 'r_test0001',
    name: 'Ruang Uji',
    question: 'Apa kabar?',
    status: 'waiting',
    operatorToken: 'token-a',
    createdAt: 1000,
    updatedAt: 1000,
    startedAt: null,
    endedAt: null,
    endReason: null,
    totalAnswers: 0,
    wordCounts: {},
    recent: [],
    recording: { status: 'idle', ownerId: null, segment: 0, startedAt: null, updatedAt: null },
    ...overrides,
  };
}

test('repository creates registry, state, and reloads them', async () => {
  const dir = await tempDir();
  try {
    const repo = new JsonRoomRepository(dir);
    await repo.create(sampleRoom());

    const registry = JSON.parse(await fs.readFile(path.join(dir, 'rooms.json'), 'utf8'));
    assert.equal(registry.rooms.length, 1);
    assert.equal(registry.rooms[0].operatorToken, 'token-a');

    await repo.saveState(sampleRoom({ wordCounts: { fokus: 3 }, totalAnswers: 3 }));

    const fresh = new JsonRoomRepository(dir);
    const rooms = await fresh.loadAll();
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].name, 'Ruang Uji');
    assert.deepEqual(rooms[0].wordCounts, { fokus: 3 });
    assert.equal(rooms[0].totalAnswers, 3);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('repository archives a final snapshot and removes a room', async () => {
  const dir = await tempDir();
  try {
    const repo = new JsonRoomRepository(dir);
    await repo.create(sampleRoom());
    const archiveFile = await repo.archive(
      sampleRoom({ status: 'ended', endedAt: 5000, wordCounts: { tim: 2 } })
    );

    const archived = JSON.parse(await fs.readFile(archiveFile, 'utf8'));
    assert.equal(archived.status, 'ended');
    assert.deepEqual(archived.wordCounts, { tim: 2 });
    assert.ok(Number.isFinite(archived.archivedAt));

    await repo.remove(sampleRoom());
    const fresh = new JsonRoomRepository(dir);
    assert.deepEqual(await fresh.loadAll(), []);
    await assert.rejects(fs.access(path.join(dir, 'rooms', 'r_test0001.json')));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('repository survives a corrupt registry file', async () => {
  const dir = await tempDir();
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'rooms.json'), '{not-json', 'utf8');
    const repo = new JsonRoomRepository(dir);
    assert.deepEqual(await repo.loadAll(), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('repository serializes concurrent writes to the same file', async () => {
  const dir = await tempDir();
  try {
    const repo = new JsonRoomRepository(dir);
    await repo.create(sampleRoom());
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        repo.saveState(sampleRoom({ totalAnswers: index, updatedAt: 1000 + index }))
      )
    );
    const raw = await fs.readFile(path.join(dir, 'rooms', 'r_test0001.json'), 'utf8');
    const state = JSON.parse(raw);
    assert.ok(Number.isInteger(state.totalAnswers));
    assert.ok(state.totalAnswers >= 0 && state.totalAnswers < 20);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
