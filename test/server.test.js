'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

const { createCloudWordsServer } = require('../server');

async function startServer() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudwords-server-'));
  const instance = createCloudWordsServer({
    dataDir,
    adminPassword: 'admin-test',
    sessionSecret: 'session-test-secret',
    broadcastInterval: 100,
    port: 0,
  });
  const address = await instance.start(0);
  const url = `http://127.0.0.1:${address.port}`;
  return {
    instance,
    url,
    dataDir,
    async cleanup() {
      await instance.stop();
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}

function connectSocket(url, namespace, auth) {
  return new Promise((resolve, reject) => {
    const socket = io(`${url}${namespace}`, {
      auth,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      timeout: 4000,
    });
    // Rekam event awal (mis. room:init) supaya test tidak balapan dengan handshake.
    socket.__early = [];
    socket.onAny((event, payload) => {
      if (socket.__early.length < 100) socket.__early.push([event, payload]);
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Timeout connecting to ${namespace}`));
    }, 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

function ack(socket, event, payload, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout ack ${event}`)), timeout);
    const done = (response) => {
      clearTimeout(timer);
      resolve(response);
    };
    if (payload === undefined) socket.emit(event, done);
    else socket.emit(event, payload, done);
  });
}

function waitFor(socket, event, timeout = 3000) {
  const early = socket.__early && socket.__early.find(([name]) => name === event);
  if (early) return Promise.resolve(early[1]);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function waitUntil(predicate, timeout = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return false;
}

async function login(url, password = 'admin-test') {
  const response = await fetch(`${url}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return { status: response.status, body: await response.json() };
}

test('admin login rejects a wrong password and accepts the configured one', async () => {
  const ctx = await startServer();
  try {
    const wrong = await login(ctx.url, 'wrong');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.ok, false);

    const good = await login(ctx.url);
    assert.equal(good.status, 200);
    assert.equal(good.body.ok, true);
    assert.ok(good.body.token);

    const admin = await connectSocket(ctx.url, '/admin', { token: good.body.token });
    const rooms = await waitFor(admin, 'admin:rooms');
    assert.deepEqual(rooms.rooms, []);
    admin.close();
  } finally {
    await ctx.cleanup();
  }
});

test('public room list excludes operator tokens and ended rooms', async () => {
  const ctx = await startServer();
  try {
    const token = (await login(ctx.url)).body.token;
    const admin = await connectSocket(ctx.url, '/admin', { token });
    const created = await ack(admin, 'admin:create-room', { name: 'Publik', question: 'Apa?' });
    assert.equal(created.ok, true);
    admin.close();

    const response = await fetch(`${ctx.url}/api/rooms`);
    const body = await response.json();
    assert.equal(body.rooms.length, 1);
    assert.equal(body.rooms[0].name, 'Publik');
    assert.equal(body.rooms[0].operatorToken, undefined);
    assert.ok(!JSON.stringify(body).includes(created.operatorToken));

    const health = await (await fetch(`${ctx.url}/health`)).json();
    assert.equal(health.rooms, 1);
    assert.equal(health.liveRooms, 0);
  } finally {
    await ctx.cleanup();
  }
});

test('operator authentication rejects invalid tokens', async () => {
  const ctx = await startServer();
  try {
    const token = (await login(ctx.url)).body.token;
    const admin = await connectSocket(ctx.url, '/admin', { token });
    const created = await ack(admin, 'admin:create-room', { name: 'Token', question: 'Apa?' });
    admin.close();

    await assert.rejects(
      connectSocket(ctx.url, '/room', {
        roomId: created.room.id,
        role: 'operator',
        token: 'salah',
      }),
      (error) => error.data && error.data.code === 'INVALID_TOKEN'
    );

    const operator = await connectSocket(ctx.url, '/room', {
      roomId: created.room.id,
      role: 'operator',
      token: created.operatorToken,
    });
    const init = await waitFor(operator, 'room:init');
    assert.equal(init.room.id, created.room.id);
    assert.equal(init.isController, true);
    operator.close();
  } finally {
    await ctx.cleanup();
  }
});

test('waiting rooms reject answers and only the operator can start after recording is active', async () => {
  const ctx = await startServer();
  try {
    const token = (await login(ctx.url)).body.token;
    const admin = await connectSocket(ctx.url, '/admin', { token });
    const created = await ack(admin, 'admin:create-room', { name: 'Mulai', question: 'Apa?' });
    admin.close();

    const audience = await connectSocket(ctx.url, '/room', {
      roomId: created.room.id,
      role: 'audience',
    });
    const operator = await connectSocket(ctx.url, '/room', {
      roomId: created.room.id,
      role: 'operator',
      token: created.operatorToken,
    });
    await waitFor(operator, 'room:init');

    const waitingAnswer = await ack(audience, 'submit-answer', 'fokus');
    assert.equal(waitingAnswer.ok, false);
    assert.equal(waitingAnswer.code, 'NOT_STARTED');

    const forbidden = await ack(audience, 'operator:start', {
      recording: { active: true },
    });
    assert.equal(forbidden.ok, false);
    assert.equal(forbidden.code, 'FORBIDDEN');

    const noRecording = await ack(operator, 'operator:start', {
      recording: { active: false },
    });
    assert.equal(noRecording.ok, false);
    assert.equal(noRecording.code, 'RECORDING_REQUIRED');

    const started = await ack(operator, 'operator:start', {
      recording: { active: true, ownerId: 'op-1' },
    });
    assert.equal(started.ok, true);
    assert.equal(started.room.status, 'live');

    const accepted = await ack(audience, 'submit-answer', '你好！');
    assert.equal(accepted.ok, true);
    assert.equal(accepted.text, '你好');

    const ended = await ack(operator, 'operator:end', {});
    assert.equal(ended.ok, true);
    assert.equal(ended.room.status, 'ended');

    const afterEnd = await ack(audience, 'submit-answer', 'lagi');
    assert.equal(afterEnd.ok, false);
    assert.equal(afterEnd.code, 'ENDED');

    audience.close();
    operator.close();
  } finally {
    await ctx.cleanup();
  }
});

test('two live rooms stay isolated', async () => {
  const ctx = await startServer();
  try {
    const token = (await login(ctx.url)).body.token;
    const admin = await connectSocket(ctx.url, '/admin', { token });

    const roomA = await ack(admin, 'admin:create-room', { name: 'Ruang A', question: 'Apa A?' });
    const roomB = await ack(admin, 'admin:create-room', { name: 'Ruang B', question: 'Apa B?' });
    assert.notEqual(roomA.operatorToken, roomB.operatorToken);
    admin.close();

    const displayA = await connectSocket(ctx.url, '/room', { roomId: roomA.room.id, role: 'display' });
    const displayB = await connectSocket(ctx.url, '/room', { roomId: roomB.room.id, role: 'display' });
    const audienceA = await connectSocket(ctx.url, '/room', { roomId: roomA.room.id, role: 'audience' });
    const audienceB = await connectSocket(ctx.url, '/room', { roomId: roomB.room.id, role: 'audience' });
    const operatorA = await connectSocket(ctx.url, '/room', {
      roomId: roomA.room.id,
      role: 'operator',
      token: roomA.operatorToken,
    });
    const operatorB = await connectSocket(ctx.url, '/room', {
      roomId: roomB.room.id,
      role: 'operator',
      token: roomB.operatorToken,
    });

    await Promise.all([
      waitFor(displayA, 'room:init'),
      waitFor(displayB, 'room:init'),
      waitFor(audienceA, 'room:init'),
      waitFor(audienceB, 'room:init'),
      waitFor(operatorA, 'room:init'),
      waitFor(operatorB, 'room:init'),
    ]);

    const seenB = [];
    const seenA = [];
    let statsA = null;
    let statsB = null;
    displayB.on('update-wordcloud', (words) => seenB.push(words));
    displayA.on('update-wordcloud', (words) => seenA.push(words));
    displayA.on('stats:update', (stats) => {
      statsA = stats;
    });
    displayB.on('stats:update', (stats) => {
      statsB = stats;
    });

    assert.equal((await ack(operatorA, 'operator:start', { recording: { active: true } })).ok, true);
    assert.equal((await ack(operatorB, 'operator:start', { recording: { active: true } })).ok, true);

    const answerA = await ack(audienceA, 'submit-answer', 'fokus');
    assert.equal(answerA.ok, true);
    const answerB = await ack(audienceB, 'submit-answer', 'tim');
    assert.equal(answerB.ok, true);

    assert.equal(
      await waitUntil(
        () => statsA && statsB && statsA.totalAnswers === 1 && statsB.totalAnswers === 1
      ),
      true
    );
    assert.equal(statsA.totalAnswers, 1);
    assert.equal(statsB.totalAnswers, 1);

    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.ok(!seenB.some((words) => words.some((word) => word.text === 'fokus')));
    assert.ok(!seenA.some((words) => words.some((word) => word.text === 'tim')));
    assert.ok(seenA.some((words) => words.some((word) => word.text === 'fokus')));
    assert.ok(seenB.some((words) => words.some((word) => word.text === 'tim')));

    for (const socket of [displayA, displayB, audienceA, audienceB, operatorA, operatorB]) socket.close();
  } finally {
    await ctx.cleanup();
  }
});

test('a second operator connection supersedes the first controller', async () => {
  const ctx = await startServer();
  try {
    const token = (await login(ctx.url)).body.token;
    const admin = await connectSocket(ctx.url, '/admin', { token });
    const created = await ack(admin, 'admin:create-room', { name: 'Takeover', question: 'Apa?' });
    admin.close();

    const first = await connectSocket(ctx.url, '/room', {
      roomId: created.room.id,
      role: 'operator',
      token: created.operatorToken,
    });
    await waitFor(first, 'room:init');
    const superseded = waitFor(first, 'operator:superseded', 4000);

    const second = await connectSocket(ctx.url, '/room', {
      roomId: created.room.id,
      role: 'operator',
      token: created.operatorToken,
    });
    const payload = await superseded;
    assert.equal(payload.reason, 'new-controller');

    const secondInit = await waitFor(second, 'room:init');
    assert.equal(secondInit.isController, true);

    // Controller lama diputus setelah sinyal superseded.
    assert.equal(await waitUntil(() => !first.connected), true);

    second.close();
  } finally {
    await ctx.cleanup();
  }
});

test('admin watcher can read a room but cannot control it', async () => {
  const ctx = await startServer();
  try {
    const token = (await login(ctx.url)).body.token;
    const admin = await connectSocket(ctx.url, '/admin', { token });
    const created = await ack(admin, 'admin:create-room', { name: 'Watcher', question: 'Apa?' });
    admin.close();

    const watcher = await connectSocket(ctx.url, '/room', {
      roomId: created.room.id,
      role: 'admin',
      token,
    });
    const init = await waitFor(watcher, 'room:init');
    assert.equal(init.room.name, 'Watcher');

    const answer = await ack(watcher, 'submit-answer', 'fokus');
    assert.equal(answer.ok, false);
    assert.equal(answer.code, 'FORBIDDEN');

    const start = await ack(watcher, 'operator:start', { recording: { active: true } });
    assert.equal(start.ok, false);
    assert.equal(start.code, 'FORBIDDEN');

    watcher.close();
  } finally {
    await ctx.cleanup();
  }
});

test('role pages are served and only superadmin renders the site nav', async () => {
  const ctx = await startServer();
  try {
    const lobby = await fetch(`${ctx.url}/`);
    assert.equal(lobby.status, 200);
    const lobbyHtml = await lobby.text();
    assert.doesNotMatch(lobbyHtml, /data-site-nav/);
    assert.doesNotMatch(lobbyHtml, /href="\/operator"/);
    assert.doesNotMatch(lobbyHtml, /href="\/admin"/);

    const display = await fetch(`${ctx.url}/display`);
    assert.equal(display.status, 200);
    const displayHtml = await display.text();
    assert.match(displayHtml, /id="roomGrid"/);
    assert.match(displayHtml, /id="pickerTitle"/);
    assert.doesNotMatch(displayHtml, /data-site-nav/);
    assert.doesNotMatch(displayHtml, /\/js\/nav\.js/);

    const join = await fetch(`${ctx.url}/join`);
    assert.equal(join.status, 200);
    const joinHtml = await join.text();
    assert.match(joinHtml, /id="roomGrid"/);
    assert.match(joinHtml, /id="pickerTitle"/);
    assert.doesNotMatch(joinHtml, /data-site-nav/);
    assert.doesNotMatch(joinHtml, /\/js\/nav\.js/);

    const operator = await fetch(`${ctx.url}/operator`);
    assert.equal(operator.status, 200);
    const operatorHtml = await operator.text();
    assert.match(operatorHtml, /id="operatorEntryForm"/);
    assert.match(operatorHtml, /Admin Room/);
    assert.doesNotMatch(operatorHtml, /data-site-nav/);

    const admin = await fetch(`${ctx.url}/admin`);
    assert.equal(admin.status, 200);
    const adminHtml = await admin.text();
    assert.match(adminHtml, /data-site-nav/);
    assert.match(adminHtml, /\/js\/nav\.js/);

    const roomRedirect = await fetch(`${ctx.url}/room`, { redirect: 'manual' });
    assert.equal(roomRedirect.status, 302);
    assert.equal(roomRedirect.headers.get('location'), '/join');
  } finally {
    await ctx.cleanup();
  }
});

test('deleting a waiting room disconnects its sockets and removes the snapshot', async () => {
  const ctx = await startServer();
  try {
    const token = (await login(ctx.url)).body.token;
    const admin = await connectSocket(ctx.url, '/admin', { token });
    const created = await ack(admin, 'admin:create-room', { name: 'Hapus', question: 'Apa?' });

    const audience = await connectSocket(ctx.url, '/room', {
      roomId: created.room.id,
      role: 'audience',
    });
    await waitFor(audience, 'room:init');

    const deleted = ack(admin, 'admin:delete-room', { roomId: created.room.id });
    const signal = waitFor(audience, 'room:deleted');
    const result = await deleted;
    assert.equal(result.ok, true);
    assert.equal((await signal).roomId, created.room.id);

    admin.close();
    audience.close();
  } finally {
    await ctx.cleanup();
  }
});
