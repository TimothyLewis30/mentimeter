# API dan Event Socket.IO

## HTTP

### `GET /`

Mengirim halaman lobby.

### `GET /api/rooms`

Daftar room publik yang sedang `waiting` atau `live`. **Tidak** memuat
`operatorToken`.

```json
{
  "rooms": [
    {
      "id": "r_2d845ea3a4",
      "name": "Ruang Kolaborasi",
      "question": "Apa satu kata yang menggambarkan harimu?",
      "status": "live",
      "participants": 12,
      "totalAnswers": 34,
      "uniqueWords": 18
    }
  ]
}
```

### `POST /api/admin/login`

Body:

```json
{ "password": "password-admin" }
```

Respons sukses:

```json
{
  "ok": true,
  "token": "<token-admin>",
  "expiresAt": 1760000000000
}
```

Respons gagal: `401` dengan `{ "ok": false, "message": "Password admin salah." }`.
Setelah 10 percobaan gagal dalam 5 menit dari IP yang sama, server membalas
`429`.

### `GET /health`

```json
{
  "status": "ok",
  "uptime": 123,
  "connections": 4,
  "rooms": 2,
  "liveRooms": 1
}
```

### Halaman

| Method | Path | Hasil |
| --- | --- | --- |
| GET | `/` | `index.html` |
| GET | `/display` | `picker.html` |
| GET | `/join` | `picker.html` |
| GET | `/room` | `302` ke `/join` |
| GET | `/room/:roomId` | `room.html` atau `404` |
| GET | `/display/:roomId` | `display.html` atau `404` |
| GET | `/operator` | `operator-entry.html` |
| GET | `/operator/:roomId` | `operator.html` atau `404` |
| GET | `/admin`, `/superadmin` | `admin.html` |

Halaman operator mengirim header `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`, dan `X-Robots-Tag: noindex, nofollow`.

## Autentikasi Socket.IO

### Namespace `/room`

Handshake:

```js
io('/room', {
  auth: {
    roomId: 'r_xxxxxxxxxx',
    role: 'audience' | 'display' | 'operator' | 'admin',
    token: '...' // wajib untuk operator dan admin
  }
})
```

| Role | Token yang diperlukan |
| --- | --- |
| `audience` | — |
| `display` | — |
| `operator` | `operatorToken` room |
| `admin` | token admin dari `/api/admin/login` |

Jika room tidak ada, koneksi ditolak dengan `ROOM_NOT_FOUND`. Jika token salah,
koneksi ditolak dengan `UNAUTHORIZED`/`FORBIDDEN`.

### Namespace `/admin`

Handshake:

```js
io('/admin', { auth: { token: '<token-admin>' } })
```

Token tidak valid atau kedaluwarsa menghasilkan `UNAUTHORIZED`.

## Event namespace `/room`

### Server → client

| Event | Penerima | Payload |
| --- | --- | --- |
| `room:init` | socket baru | `{ room, words, stats, recent, recording, isController, serverTime, broadcastInterval }` |
| `room:status` | semua role room | `{ status, startedAt, endedAt, recording }` |
| `room:meta` | semua role room | `{ name, question }` |
| `update-wordcloud` | display, operator, admin | `[{ text, size }]` (maks. 150 kata) |
| `topwords:update` | audience | 5 kata teratas |
| `stats:update` | semua role room | `{ participants, totalAnswers, uniqueWords, topWord, status, accepting }` |
| `recording:update` | display, operator, admin | `{ status, ownerId, segment, startedAt, updatedAt }` |
| `activity:new` | operator, admin | `{ text, at }` |
| `operator:superseded` | operator lama | `{ reason: 'new-controller' }` |
| `operator:revoked` | operator | `{ reason: 'token-regenerated' }` |
| `room:deleted` | semua role room | `{ roomId }` |

Nilai `recording.status`: `idle`, `recording`, `interrupted`, `stopped`,
`unknown`.

### Client → server

| Event | Pengirim | Payload | Ack |
| --- | --- | --- | --- |
| `submit-answer` | audience | `string` | `{ ok, text, totalAnswers, message }` atau error |
| `operator:start` | operator | `{ recording: { active: true, mimeType, startedAt, ownerId, segment } }` | `{ ok, room, stats }` |
| `operator:resume-recording` | operator | `{ recording: { active: true, segment, ownerId } }` | `{ ok, recording }` |
| `operator:recording` | operator | `{ status }` | `{ ok, recording }` |
| `operator:end` | operator | — | `{ ok, room, stats }` |
| `reset-data` | operator | — | `{ ok, message }` |

Semua event operator hanya diterima dari socket yang saat ini menjadi
controller room. Jika bukan, server membalas `FORBIDDEN` atau `NOT_CONTROLLER`.

### Kode error umum

| Code | Arti |
| --- | --- |
| `ROOM_NOT_FOUND` | Room sudah dihapus atau tidak ada |
| `FORBIDDEN` | Role tidak berhak |
| `NOT_CONTROLLER` | Operator lain sudah mengambil alih |
| `RECORDING_REQUIRED` | Start ditolak karena recording belum aktif |
| `ALREADY_LIVE` | Room sudah live |
| `ENDED` | Room sudah berakhir |
| `NOT_WAITING` | Aksi hanya boleh saat waiting |
| `LIVE_ROOM` | Room live tidak bisa dihapus |
| `COOLDOWN` | Jawaban dikirim terlalu cepat |
| `INVALID_ANSWER` | Jawaban kosong/tidak valid |

## Event namespace `/admin`

### Server → admin

| Event | Payload |
| --- | --- |
| `admin:rooms` | `{ rooms: AdminRoom[] }` |

`AdminRoom`:

```json
{
  "id": "r_xxxxxxxxxx",
  "name": "Ruang Kolaborasi",
  "question": "Apa satu kata ...",
  "status": "waiting",
  "operatorToken": "<token>",
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000,
  "startedAt": null,
  "endedAt": null,
  "endReason": null,
  "totalAnswers": 0,
  "uniqueWords": 0,
  "participants": 0,
  "displayOnline": false,
  "operatorOnline": false,
  "recording": { "status": "idle", "ownerId": null, "segment": 0, "startedAt": null, "updatedAt": null }
}
```

### Admin → server

| Event | Payload | Ack |
| --- | --- | --- |
| `admin:create-room` | `{ name, question }` | `{ ok, room, operatorToken, message }` |
| `admin:update-room` | `{ roomId, name, question }` | `{ ok, room, message }` |
| `admin:delete-room` | `{ roomId }` | `{ ok, message }` |
| `admin:regenerate-token` | `{ roomId }` | `{ ok, operatorToken, message }` |

`admin:update-room` hanya berhasil saat room `waiting`. `admin:delete-room`
ditolak untuk room `live`.

## Contoh klien

```js
const { io } = require('socket.io-client');

const socket = io('http://localhost:3000/room', {
  auth: { roomId: 'r_xxxxxxxxxx', role: 'operator', token: '<operatorToken>' },
});

socket.on('connect', () => {
  socket.emit(
    'operator:start',
    {
      recording: {
        active: true,
        mimeType: 'video/webm',
        startedAt: Date.now(),
        ownerId: 'operator-1',
        segment: 1,
      },
    },
    (response) => console.log(response)
  );
});
```

Contoh lengkap ada di `scripts/load-test.js`.
