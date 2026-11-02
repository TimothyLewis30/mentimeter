# CloudWords Multi-Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengubah CloudWords single-room menjadi aplikasi multi-room real-time dengan super admin pusat, operator per room, waiting room, recording per room, dan word cloud yang selalu menempatkan kata teratas di tengah.

**Architecture:** Express + Socket.IO tetap satu proses. State room disimpan di memory dan dipersistenkan lewat `JsonRoomRepository` ke `data/rooms.json`, `data/rooms/<id>.json`, dan `data/archive/`. Dua namespace Socket.IO: `/room` (peserta, display, operator, admin watcher) dan `/admin` (super admin). Broadcast di-throttle per room.

**Tech Stack:** Node.js 18+, Express 4, Socket.IO 4, HTML/CSS/JS native, d3-cloud, MediaRecorder/getDisplayMedia, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-multi-room-design.md`

## Global Constraints

- Room status hanya `waiting`, `live`, `ended`.
- Room `ended` terminal; `reset-data` hanya saat `waiting`.
- Start hanya boleh setelah recording aktif; recording terputus tidak mengakhiri room.
- Hanya operator yang boleh start/end; admin pusat dan admin watcher tidak.
- Satu controller operator per room; koneksi operator terbaru menang.
- Kata dengan frekuensi tertinggi selalu di tengah dan paling besar.
- Tidak ada database; semua persistence lewat `RoomRepository`.
- Tidak ada upload rekaman; file diunduh ke perangkat operator.
- Admin password dev default `admin`; produksi wajib `ADMIN_PASSWORD`.
- Semua teks dinamis dimasukkan lewat `textContent`, bukan `innerHTML`.

## Review Focus

- **Frekuensi berdekatan/seri:** kata teratas tetap di tengah meski ukuran kata lain hampir sama.
- **Satu kata:** kata tunggal tepat di tengah, bukan bergeser karena padding/layout.
- **Dua room live bersamaan:** event room A tidak boleh sampai ke room B.
- **Start tanpa izin screen share:** room harus tetap `waiting`, bukan live tanpa rekaman.
- **Operator kedua/reload:** controller lama harus berhenti merekam dan tidak reconnect otomatis.

---

### Task 1: Config, auth, and JSON repository

**Files:**
- Create: `lib/config.js`
- Create: `lib/auth.js`
- Create: `lib/room-repository.js`
- Test: `test/auth.test.js`
- Test: `test/repository.test.js`
- Modify: `package.json`

**Interfaces:**
- `createConfig(overrides = {}) -> { port, broadcastInterval, maxAnswerLength, maxUniqueWords, maxCloudWords, answerCooldownMs, recentLimit, maxRooms, adminPassword, sessionSecret, adminTokenTtlMs, dataDir }`
- `hashPassword(value: string) -> string`
- `verifyPassword(input: string, expected: string) -> boolean`
- `signAdminToken({ secret, ttlMs, now? }) -> { token, expiresAt }`
- `verifyAdminToken(token, secret, now?) -> { valid: boolean, reason?: string }`
- `safeEqual(a: string, b: string) -> boolean`
- `new LoginRateLimiter({ maxAttempts, windowMs })` with `check(ip)`, `fail(ip)`, `reset(ip)`
- `new JsonRoomRepository(dataDir)` with `loadAll()`, `saveRegistry(rooms)`, `saveState(room)`, `archive(room)`, `remove(room)`, `create(room)`

- [ ] **Step 1: Write failing auth/repository tests**
- [ ] **Step 2: Run `npm test` and confirm failures**
- [ ] **Step 3: Implement config/auth/repository**
- [ ] **Step 4: Run tests and confirm pass**
- [ ] **Step 5: Add `"test": "node --test test"` and commit**

### Task 2: Room registry and lifecycle

**Files:**
- Create: `lib/rooms.js`
- Test: `test/rooms.test.js`

**Interfaces:**
- `normalizeAnswer(raw, maxLength) -> string`
- `new RoomRegistry({ repository, config })` with:
  - `load()`, `create({ name, question })`, `get(id)`, `list()`, `publicList()`
  - `updateMeta(id, { name?, question? })`, `delete(id)`, `regenerateToken(id)`
  - `start(id, recording)`, `resumeRecording(id, recording)`, `updateRecording(id, payload)`, `end(id, reason?)`
  - `reset(id)`, `submitAnswer(id, raw)`
  - `formatWords(room, limit)`, `stats(room, participants)`
  - `serializeRoom(room)`, `deserializeRoom(data)`

- [ ] **Step 1: Write failing tests for normalize, create, start gate, submit, end, reset rules, sorting**
- [ ] **Step 2: Run tests and confirm failure**
- [ ] **Step 3: Implement registry**
- [ ] **Step 4: Run tests and confirm pass**
- [ ] **Step 5: Commit**

### Task 3: HTTP and Socket.IO server

**Files:**
- Rewrite: `server.js`
- Test: `test/server.test.js`

**Interfaces:**
- `createCloudWordsServer(overrides?) -> { app, server, io, registry, repository, config, start(port?), stop() }`
- HTTP: `GET /`, `/room/:roomId`, `/display/:roomId`, `/operator/:roomId`, `/admin`, `/superadmin`, `GET /api/rooms`, `POST /api/admin/login`, `GET /health`
- Namespaces `/room` and `/admin`; events as in spec sections 9.1 and 9.2 plus `room:meta`.

- [ ] **Step 1: Write failing server test for login + create room + room isolation**
- [ ] **Step 2: Run test and confirm failure**
- [ ] **Step 3: Implement server, middleware, broadcasts, presence**
- [ ] **Step 4: Run tests and confirm pass**
- [ ] **Step 5: Commit**

### Task 4: Center guarantee in renderer

**Files:**
- Create: `public/js/wordcloud-center.js`
- Modify: `public/js/wordcloud.js`
- Test: `test/wordcloud-center.test.js`

**Interfaces:**
- `centerTopWord(placed) -> boolean` in `public/js/wordcloud-center.js`, exported for Node and exposed as `window.WordCloudCenter`.
- `WordCloudRenderer.applyLayout` calls `centerTopWord(placed)` before building target coordinates.

- [ ] **Step 1: Write failing tests for one word, three close words, tie**
- [ ] **Step 2: Run test and confirm failure**
- [ ] **Step 3: Implement helper and wire it into renderer**
- [ ] **Step 4: Run test and confirm pass**
- [ ] **Step 5: Commit**

### Task 5: Shared UI and lobby

**Files:**
- Create: `public/js/ui.js`
- Create: `public/js/lobby.js`
- Rewrite: `public/index.html`
- Modify: `public/css/style.css`

- [ ] **Step 1: Add shared toast/connection/copy/format helpers**
- [ ] **Step 2: Build lobby list from `/api/rooms`**
- [ ] **Step 3: Add responsive lobby styles and empty state**
- [ ] **Step 4: Verify in browser**

### Task 6: Participant room page

**Files:**
- Create: `public/room.html`
- Create: `public/js/room.js`
- Modify: `public/css/style.css`

- [ ] **Step 1: Build waiting/live/ended markup**
- [ ] **Step 2: Connect `/room` as audience; render state and submit answers**
- [ ] **Step 3: Verify waiting rejects answers and live accepts them**

### Task 7: Display page

**Files:**
- Rewrite: `public/display.html`
- Rewrite: `public/js/display.js`

- [ ] **Step 1: Add room name and waiting/live/ended states**
- [ ] **Step 2: Connect as display; render full cloud and stats**
- [ ] **Step 3: Verify two displays show different rooms**

### Task 8: Operator page

**Files:**
- Create: `public/operator.html`
- Create: `public/js/operator.js`
- Modify: `public/js/recorder.js`

- [ ] **Step 1: Parse token, store in sessionStorage, strip query**
- [ ] **Step 2: Implement Start → recorder.start() → operator:start**
- [ ] **Step 3: Implement End → operator:end → recorder stop/download**
- [ ] **Step 4: Implement interrupted/unknown status and resume**
- [ ] **Step 5: Handle `operator:superseded` and `operator:revoked`**
- [ ] **Step 6: Verify recording flow in Chrome/Edge**

### Task 9: Super admin page

**Files:**
- Rewrite: `public/admin.html`
- Rewrite: `public/js/admin.js`

- [ ] **Step 1: Login/logout with sessionStorage token**
- [ ] **Step 2: Render room list and create/edit/delete/regenerate actions**
- [ ] **Step 3: Build/copy participant, display, operator links**
- [ ] **Step 4: Add read-only preview socket**
- [ ] **Step 5: Verify two rooms can be created and run**

### Task 10: Migration, docs, and load test

**Files:**
- Modify: `README.md`
- Modify: `scripts/load-test.js`
- Modify: `public/js/recorder.js`
- Maybe delete/ignore: `public/js/audience.js` (superseded by `room.js`)

- [ ] **Step 1: Update README routes, events, env, recording, multi-room flow**
- [ ] **Step 2: Add `--room` to load test and test multiple rooms**
- [ ] **Step 3: Run `npm test`, `npm run loadtest -- --help`**
- [ ] **Step 4: Run final manual verification and commit**

---

## Verification Checklist

- [ ] `npm test` passes.
- [ ] `/admin` login works; wrong password rejected.
- [ ] Two rooms created; unique tokens.
- [ ] Waiting room rejects answers.
- [ ] Start with canceled screen share leaves room waiting.
- [ ] Start with granted screen share goes live and records.
- [ ] Two rooms live simultaneously with isolated data.
- [ ] Top word always centered for 1 word and 3 close words.
- [ ] End stops room and recording; file downloads.
- [ ] Recording interruption keeps room live and resume creates a new segment.
- [ ] Second operator tab supersedes the first.
- [ ] Admin preview is read-only.
- [ ] Restart restores waiting/ended and ends live rooms.
