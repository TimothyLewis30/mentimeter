# CloudWords Multi-Room — Design

- **Status:** Draft untuk disetujui
- **Tanggal:** 2026-10-28
- **Menggantikan:** perilaku single-room pada aplikasi CloudWords saat ini

---

## 1. Ringkasan

CloudWords diubah dari satu sesi word cloud global menjadi **banyak room yang bisa live bersamaan**. Setiap room memiliki nama, pertanyaan, peserta, frekuensi kata, tampilan, dan status sendiri.

Ada tiga jenis perangkat:

| Peran | Siapa | Tugas |
| --- | --- | --- |
| **Admin pusat** | Satu orang / satu perangkat | Membuat dan mengelola room, membagikan link peserta, link display, dan link operator + token rahasia. |
| **Operator room** | Satu perangkat per room | “Satpam” room: hanya perangkat ini yang boleh memulai, merekam, dan mengakhiri room. |
| **Peserta & display** | Banyak perangkat | Peserta masuk waiting room lalu mengirim jawaban; display menampilkan word cloud room tersebut. |

Semua room memakai modul **word cloud** yang sama. Tidak ada modul polling lain.

---

## 2. Tujuan

1. Beberapa room dapat **live pada waktu yang sama** tanpa data saling bocor.
2. Setiap room punya **satu display** dan **satu operator terautentikasi**.
3. Peserta hanya bisa menjawab **setelah operator memulai** room.
4. Memulai room **otomatis menjalankan tampilan live** dan **memulai screen recording di perangkat operator**, bukan di perangkat display.
5. Room dan rekaman berjalan sampai operator menekan **End**; End menghentikan keduanya.
6. Kata/frasa yang lebih sering muncul menjadi **lebih besar**, dan **kata dengan frekuensi tertinggi selalu berada di titik tengah** — termasuk jika hanya ada satu kata. Kata lain mengelilinginya.
7. Admin pusat tetap menjadi **satu-satunya pihak yang membuat dan mengatur room**.
8. State live disimpan sebagai **JSON**; abstraksi repository disiapkan agar database bisa menggantikannya nanti tanpa mengubah alur aplikasi.

## 3. Non-tujuan

- Database relasional/Redis pada iterasi ini.
- Multi-server / horizontal scaling.
- Upload rekaman ke server.
- Modul selain word cloud (polling, quiz, Q&A, dsb.).
- Akun pengguna, organisasi, atau hak akses berlapis.
- Edit pertanyaan atau nama room saat room sedang live.
- Pause room. Hanya ada waiting → live → ended.
- Rekaman otomatis di perangkat display.

## 4. Anti-goal

Hal-hal berikut dianggap kegagalan meskipun aplikasi “jalan”:

- Peserta bisa mengirim jawaban ke room yang belum dimulai atau sudah berakhir.
- Jawaban dari room A muncul di display room B.
- Display atau peserta bisa memulai/mengakhiri room.
- Admin pusat bisa memulai/mengakhiri room layaknya operator.
- Room menjadi live tanpa recording aktif di perangkat operator.
- Token operator bocor ke halaman peserta/display atau ke API publik.
- End menutup room tetapi rekaman operator terus berjalan tanpa batas.
- Rekaman hilang karena End tidak menghentikan recorder dengan benar.

---

## 5. Pendekatan yang dipilih

Tiga pendekatan dipertimbangkan:

### Opsi 1 — Perluas aplikasi Node/Express/Socket.IO yang ada (**dipilih**)

Tambahkan registry room, state per room, namespace/room Socket.IO, halaman admin/operator baru, dan repository JSON. Renderer word cloud dan recorder yang sudah ada dipakai ulang.

- **Kelebihan:** paling sedikit kode baru, paling cepat, seluruh stack sudah terbukti (500 client, p95 ack 66 ms), tidak menambah layanan.
- **Kekurangan:** tetap satu proses; state di memory; belum siap multi-instance.

### Opsi 2 — SQLite/Redis sebagai sumber state

- **Kelebihan:** persistence lebih rapi, bisa multi-instance dengan Redis adapter.
- **Kekurangan:** menambah dependency dan kompleksitas yang diminta untuk ditunda. Tidak sepadan untuk satu server demo.

### Opsi 3 — Pisahkan layanan (room service, display service, recording service)

- **Kelebihan:** batas domain jelas.
- **Kekurangan:** jauh lebih banyak infrastruktur, deployment, dan titik gagal. Recording tetap harus di browser operator, jadi pemisahan layanan tidak memberi manfaat langsung.

**Keputusan:** Opsi 1. DB tetap ditunda; repository JSON dibuat replaceable.

---

## 6. Arsitektur

### 6.1 Komponen

```text
Browser admin ──HTTP /api/admin/login──┐
Browser admin ──Socket.IO /admin──────┤
                                      ├── Node/Express + Socket.IO (satu proses)
Browser operator ──Socket.IO /room────┤     ├── RoomRegistry (memory + JSON)
Browser display  ──Socket.IO /room────┤     ├── RoomState per room
Browser peserta  ──Socket.IO /room────┘     └── JsonRoomRepository
                                                   ├── data/rooms.json
                                                   ├── data/rooms/<id>.json
                                                   └── data/archive/<id>_<waktu>.json
```

- **Satu proses Node** melayani HTTP dan Socket.IO.
- **Namespace Socket.IO**:
  - `/room` untuk peserta, display, operator, dan admin yang sedang menonton satu room.
  - `/admin` untuk admin pusat (manajemen registry room).
- **Room Socket.IO per room**:
  - `room:<id>` — semua klien room (untuk status/pertanyaan).
  - `room:<id>:audience` — peserta.
  - `room:<id>:display` — display.
  - `room:<id>:operator` — operator.
  - `room:<id>:admin` — admin yang sedang melihat detail room.
- **Tidak ada lagi `io.emit(...)` global.**
- Admin pusat memakai **dua koneksi** saat membuka detail room: socket `/admin` untuk daftar room, dan socket `/room` dengan `role: "admin"` untuk preview live room tersebut. Ini menghindari duplikasi fan-out lintas namespace. Socket preview ditutup saat admin pindah room.

### 6.2 Model peran

| Peran | Autentikasi | Boleh |
| --- | --- | --- |
| Admin pusat (super admin) | Password admin → token HMAC | Buat/edit/hapus room, regenerate token operator, lihat semua room. **Tidak** start/end. |
| Admin watcher | Token HMAC admin | Hanya membaca satu room untuk preview live. Tidak bisa start/end/menjawab. |
| Operator | Token rahasia per room | Start (setelah recording aktif), resume recording, End, reset jawaban saat waiting, lihat statistik/aktivitas. |
| Peserta | Tidak ada (link room) | Lihat waiting/live/ended, kirim jawaban saat live. |
| Display | Tidak ada (link room) | Lihat word cloud dan statistik. Tidak bisa mengirim jawaban atau mengontrol room. |

**Satu controller operator aktif per room.** Token operator boleh dibuka di beberapa tab, tetapi koneksi operator terbaru menjadi **controller** dan koneksi operator sebelumnya menerima `operator:superseded`, dihentikan recorder-nya, lalu diputus. Ini menjaga aturan “satu perangkat operator” dan mencegah dua rekaman berjalan bersamaan.

### 6.3 Routing

| Route | Halaman | Akses |
| --- | --- | --- |
| `/` | Lobby daftar room | Publik |
| `/room/:roomId` | Waiting room + form jawaban peserta | Publik |
| `/display/:roomId` | Display word cloud room | Publik |
| `/operator/:roomId?token=...` | Dashboard operator + recorder | Token room |
| `/admin` | Login + dashboard **super admin** (admin pusat) | Password admin |
| `/superadmin` | Alias halaman super admin; serve halaman yang sama dengan `/admin` | Password admin |
| `/api/rooms` | Daftar room publik (tanpa token) | Publik |
| `/api/admin/login` | Login admin | Publik (rate-limited) |
| `/health` | Status server + ringkasan room | Publik |

Route lama:

- `/display` (tanpa room) → redirect ke `/`.
- `/api/state` lama → dihapus.
- `/admin` tetap ada, tetapi kini login + manajemen room, bukan kontrol satu sesi.

---

## 7. Model data

### 7.1 Room

```json
{
  "id": "r_9f2c1a7b",
  "name": "Ruang Kolaborasi",
  "question": "Apa satu kata yang menggambarkan harimu?",
  "status": "waiting",
  "operatorToken": "token-rahasia-panjang",
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000,
  "startedAt": null,
  "endedAt": null,
  "totalAnswers": 0,
  "wordCounts": {},
  "recent": [],
  "recording": {
    "status": "idle",
    "ownerId": null,
    "segment": 0,
    "startedAt": null,
    "updatedAt": null
  }
}
```

Aturan:

- `id` dibuat acak, URL-safe, 8–10 karakter, dicek unik.
- `name` 1–60 karakter; `question` 3–140 karakter.
- `status` hanya `waiting`, `live`, `ended`.
- `operatorToken` dibuat acak 32 byte (base64url) dan **hanya dikirim ke admin**. Disimpan plaintext di file server agar admin bisa menyalin ulang link; file server setara akses penuh, jadi hash tidak memberi proteksi tambahan pada iterasi ini.
- `wordCounts` adalah objek `{ "kata": jumlah }`, bukan Map, saat diserialisasi.
- `recent` maksimal 12 entri `{ text, at }`.
- `recording.status` adalah `idle`, `recording`, `interrupted`, `unknown`, atau `stopped`.
- `recording.ownerId` adalah UUID yang dibuat tab operator saat mulai merekam; dipakai untuk membedakan segmen dan mencegah status dari tab lama menimpa tab baru.
- `recording.segment` adalah nomor segmen (mulai 1) dan bertambah setiap resume.
- `recording` adalah metadata yang dilaporkan operator; server tidak bisa memverifikasi isi rekaman. Saat controller operator terputus, server mengubah status `recording` menjadi `unknown` agar dashboard tidak mengklaim rekaman masih berjalan.

### 7.2 Registry

`data/rooms.json`:

```json
{
  "version": 1,
  "rooms": [
    {
      "id": "r_9f2c1a7b",
      "name": "Ruang Kolaborasi",
      "question": "...",
      "status": "waiting",
      "operatorToken": "...",
      "createdAt": 1760000000000,
      "startedAt": null,
      "endedAt": null
    }
  ]
}
```

Registry menyimpan metadata. State kata lengkap disimpan terpisah agar registry tetap kecil.

### 7.3 File state per room

- `data/rooms/<roomId>.json` — snapshot state room (kata, recent, statistik, recording).
- `data/archive/<roomId>_<ISO timestamp>.json` — salinan final saat End.
- `data/state.json` lama — tidak dipakai lagi; dibiarkan agar tidak menghapus data pengguna.

### 7.4 Repository

Antarmuka `RoomRepository`:

```js
loadAll()                 // registry + snapshot semua room
create(room)              // metadata + snapshot awal
saveMeta(room)            // registry
saveState(room)           // snapshot state
archive(room)             // salinan final
remove(room)              // hapus dari registry + snapshot
```

Implementasi awal: `JsonRoomRepository` dengan:

- write atomic (`.tmp` → `rename`),
- antrean serial per file untuk mencegah save bertabrakan,
- debounce 1.5 detik untuk perubahan kata,
- save langsung untuk create/start/end/delete.

Nanti `SqlRoomRepository` cukup mengimplementasikan antarmuka yang sama.

---

## 8. Autentikasi dan otorisasi

### 8.1 Admin pusat

- Password dari env `ADMIN_PASSWORD`.
- `POST /api/admin/login` menerima `{ password }`.
- Perbandingan memakai hash SHA-256 + `crypto.timingSafeEqual`.
- Rate limit login: maksimal 10 percobaan per 5 menit per IP; lebih dari itu `429`.
- Sukses → token HMAC:
  - payload `{ sub: "admin", iat, exp }`,
  - tanda tangan HMAC-SHA-256 dengan `SESSION_SECRET`,
  - berlaku 12 jam.
- Token disimpan di `sessionStorage` browser admin, **bukan cookie**, sehingga tidak ada CSRF cookie.
- Socket.IO `/admin` memvalidasi token pada handshake. Token salah/kedaluwarsa → koneksi ditolak.
- Logout menghapus token dan memutus socket.

Perilaku env:

- `ADMIN_PASSWORD` tidak di-set dan `NODE_ENV !== "production"` → default `admin`, dengan peringatan besar di console.
- `ADMIN_PASSWORD` tidak di-set dan `NODE_ENV === "production"` → server menolak start.
- `SESSION_SECRET` tidak di-set → dibuat acak per boot; semua sesi admin logout saat restart (dicatat di console).

### 8.2 Operator room

- Token 32 byte acak per room.
- Link: `/operator/<roomId>?token=<token>`.
- Halaman operator:
  - `Cache-Control: no-store`,
  - `Referrer-Policy: no-referrer`,
  - `X-Robots-Tag: noindex`.
- Client membaca token dari query, menyimpannya di `sessionStorage`, lalu menghapus query dengan `history.replaceState` agar tidak tertinggal di address bar/riwayat.
- Socket `/room` handshake: `{ roomId, role: "operator", token }`.
- Server membandingkan token dengan `timingSafeEqual`.
- Token salah → koneksi ditolak `INVALID_TOKEN`; halaman menampilkan instruksi mengambil link baru dari admin.
- **Controller operator:** server menyimpan `operatorSocketId` di memory (tidak dipersistenkan). Saat operator baru terhubung:
  - operator lama menerima `operator:superseded`, recorder-nya dihentikan dan file diunduh, lalu socket-nya diputus;
  - operator baru menjadi controller;
  - jika room live dan `recording.status === "recording"`, status diubah menjadi `interrupted` dan di-broadcast.
- Jika controller terputus:
  - `operatorOnline` menjadi false;
  - jika room live dan recording masih `recording`, status menjadi `unknown`.
- Saat operator reconnect, client melaporkan status recorder sebenarnya lewat `operator:recording` (mis. `recording` bila stream masih jalan) sehingga metadata pulih.
- Regenerate token dari admin:
  - token lama langsung tidak valid,
  - socket operator lama menerima `operator:revoked`, lalu diputus,
  - recorder di tab lama dihentikan dan file diunduh,
  - link baru bisa dipakai untuk melanjutkan/mengakhiri room.

### 8.3 Peserta dan display

- Tidak memakai token.
- Cukup `roomId` yang valid.
- Server memastikan `roomId` ada; jika tidak → koneksi ditolak `ROOM_NOT_FOUND`.
- Display dan peserta tidak bisa mengirim event kontrol room.

### 8.4 Matriks event sensitif

| Event | Admin pusat | Admin watcher | Operator | Display | Peserta |
| --- | --- | --- | --- | --- | --- |
| `admin:create-room` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `admin:update-room` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `admin:delete-room` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `admin:regenerate-token` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `operator:start` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `operator:resume-recording` | ❌ | ❌ | ✅ (saat live) | ❌ | ❌ |
| `operator:end` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `operator:recording` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `reset-data` | ❌ | ❌ | ✅ (saat waiting) | ❌ | ❌ |
| `submit-answer` | ❌ | ❌ | ❌ | ❌ | ✅ (saat live) |

Server selalu memeriksa `socket.data.role` **dan** `socket.data.roomId`; tidak ada kepercayaan pada payload role dari client.

---

## 9. Protokol Socket.IO

### 9.1 Namespace `/room`

Handshake:

```js
io("/room", {
  auth: {
    roomId,
    role: "audience" | "display" | "operator" | "admin",
    token?, // token operator untuk role operator; token HMAC admin untuk role admin
  },
});
```

Middleware:

1. Validasi `roomId` ada.
2. Validasi `role`.
3. Jika `role === "operator"`, validasi token operator room.
4. Jika `role === "admin"`, validasi token HMAC admin (hanya untuk membaca).
5. Simpan `socket.data.roomId` dan `socket.data.role`.
6. Join `room:<id>`, `room:<id>:<role>`.
7. Jika operator, jadikan controller terbaru dan evict controller lama (lihat 8.2).
8. Kirim `room:init` sesuai peran.

Event client → server:

| Event | Peran | Payload | Keterangan |
| --- | --- | --- | --- |
| `submit-answer` | audience | `string` | Ditolak jika room belum live atau sudah ended. |
| `operator:start` | operator | `{ recording: { active, mimeType, startedAt, ownerId } }` | Hanya diterima jika `status === "waiting"` dan `recording.active === true`. |
| `operator:resume-recording` | operator | `{ recording: { active, mimeType, startedAt, ownerId, segment } }` | Hanya diterima jika `status === "live"`; memulai/melanjutkan segmen recording. |
| `operator:end` | operator | — | Hanya diterima jika `status === "live"`. |
| `operator:recording` | operator | `{ status, ownerId, segment }` | Metadata recording (`recording`/`interrupted`/`stopped`). |
| `reset-data` | operator | — | Hanya saat `waiting`. Room `ended` bersifat terminal. |

Event server → client:

| Event | Penerima | Payload |
| --- | --- | --- |
| `room:init` | satu socket | Snapshot sesuai peran. |
| `room:status` | semua di room | `{ status, startedAt, endedAt, recording }`. |
| `update-wordcloud` | display, operator, admin watcher | Array `{ text, size }` lengkap. |
| `topwords:update` | audience | 5 kata teratas. |
| `stats:update` | semua di room | `{ participants, totalAnswers, uniqueWords, topWord, status }`. |
| `activity:new` | operator, admin watcher | `{ text, at }`. |
| `question:update` | semua di room | Pertanyaan baru (hanya saat waiting). |
| `recording:update` | operator, display, admin watcher | Metadata recording. |
| `operator:revoked` | operator lama | Sinyal token dicabut; client menghentikan recorder. |
| `operator:superseded` | operator lama | Sinyal controller digantikan tab/perangkat operator baru; client menghentikan recorder, lalu memutus socket tanpa reconnect. |
| `room:deleted` | semua di room | Sinyal room dihapus; client menampilkan pesan. |
| `error` | satu socket | `{ code, message }`. |

`room:init` berisi:

- `room`: `{ id, name, question, status, startedAt, endedAt }`,
- `words`: lengkap untuk display/operator/admin watcher, 5 teratas untuk audience,
- `stats`,
- `recent`: untuk operator/admin watcher,
- `recording`: untuk display/operator/admin watcher,
- `serverTime`.

Admin watcher menerima event read-only yang sama dengan display ditambah `activity:new`.

### 9.2 Namespace `/admin`

Handshake: `{ token }`.

Event client → server:

| Event | Payload | Keterangan |
| --- | --- | --- |
| `admin:create-room` | `{ name, question }` | Membuat room `waiting`. |
| `admin:update-room` | `{ roomId, name?, question? }` | Hanya room `waiting`. |
| `admin:delete-room` | `{ roomId }` | Hanya room `waiting`/`ended`. |
| `admin:regenerate-token` | `{ roomId }` | Mencabut operator lama. |

Event server → admin:

| Event | Payload |
| --- | --- |
| `admin:rooms` | Daftar metadata + statistik ringan semua room. |
| `admin:room-created` | Room baru. |
| `admin:room-updated` | Metadata berubah. |
| `admin:room-deleted` | `{ roomId }`. |

Preview live **tidak** lewat namespace `/admin`. Saat admin memilih room, dashboard membuka socket `/room` kedua dengan `role: "admin"` dan token HMAC admin; socket itu menerima `room:init`, `update-wordcloud`, `stats:update`, `activity:new`, `room:status`, dan `recording:update` untuk room tersebut. Socket preview ditutup saat admin berpindah room atau logout.

Daftar admin di-throttle maksimal 1 detik agar 50 room tidak membanjiri dashboard.

---

## 10. Siklus hidup room

```text
          admin create
               │
               ▼
          ┌─────────┐   operator Start + recorder aktif   ┌──────┐   operator End   ┌───────┐
          │ waiting │ ───────────────────────────────────▶ │ live │ ───────────────▶ │ ended │
          └─────────┘                                      └──────┘                  └───────┘
               │                                                │
               │ admin edit/delete                              │ reset ditolak
               ▼                                                ▼
          (dihapus)                                    recording interrupted
                                                       → room tetap live
                                                       → operator bisa resume
```

### 10.1 Waiting

- Dibuat admin.
- Peserta boleh masuk dan melihat nama room + pertanyaan, tetapi input disabled.
- `submit-answer` ditolak dengan `NOT_STARTED`.
- Display menampilkan layar tunggu + link peserta.
- Operator melihat tombol **Mulai & rekam**.
- Admin boleh edit nama/pertanyaan, regenerate token, atau hapus room.

### 10.2 Start (recording dulu, baru live)

Urutan wajib:

1. Operator klik **Mulai & rekam** (gesture user yang sah untuk `getDisplayMedia`).
2. `recorder.start()` membuka picker; operator memilih tab **Display**.
3. Setelah `MediaRecorder` benar-benar berstatus `recording`, client mengirim `operator:start` dengan `recording.active = true`.
4. Server memvalidasi token, status `waiting`, dan flag recording.
5. Server set `status = live`, `startedAt`, `acceptingAnswers = true`, simpan state, dan broadcast `room:status`.
6. Display langsung masuk mode live; peserta mendapat form aktif.

Kegagalan:

| Kejadian | Perilaku |
| --- | --- |
| Picker dibatalkan / izin ditolak | Recorder tetap idle; **tidak ada** `operator:start`; room tetap `waiting`; error ditampilkan. |
| Browser tidak mendukung recording | Tombol Start disabled + penjelasan; room tidak bisa live. |
| Server menolak start (mis. sudah live) | Client menghentikan recorder dan menyegarkan state; room tidak berubah. |
| Server sukses tetapi ack hilang | Room sudah live; client reconnect dan membaca `room:init`; recording tetap berjalan. |

**Aturan keras:** room tidak boleh masuk ke status live tanpa recording pernah aktif. Ini yang membedakan operator dari sekadar tombol start. Jika recording terputus setelah live, room tetap live tetapi statusnya harus terlihat dan operator wajib bisa melanjutkan recording.

### 10.3 Live

- `submit-answer` diterima.
- Normalisasi, rate limit 700 ms per socket, maksimal 1.000 kata unik, panjang 40 karakter.
- Broadcast kata di-throttle 500 ms per room dan hanya dikirim jika berubah.
- Peserta menerima 5 kata teratas; display/operator/admin watcher menerima word cloud lengkap.
- Statistik per room: peserta online, total jawaban, kata unik, kata teratas.
- Kata tersering menjadi lebih besar dan ditempatkan lebih dulu di tengah oleh renderer yang ada.
- Admin tidak bisa mengedit pertanyaan/nama atau menghapus room.
- Operator bisa End. **Reset tidak boleh saat live** (mencegah kehilangan data).

#### 10.3.1 Aturan pusat dan ukuran kata

- Kata dengan frekuensi tertinggi **wajib** berada di titik tengah area gambar: `(width / 2, height / 2)`, dengan anchor tengah (bukan kiri atas).
- Jika hanya ada **satu kata**, kata itu tepat di tengah.
- Jika ada beberapa kata dengan frekuensi berdekatan, kata dengan frekuensi tertinggi tetap di tengah; kata lain disusun mengelilinginya.
- Ukuran font tetap proporsional terhadap frekuensi (rasio akar, dengan batas minimum/maksimum agar kanvas tidak didominasi satu kata).
- Jika frekuensi seri, urutan alfabetis menjadi tie-breaker; kata pertama yang ditempatkan tetap di tengah.
- Implementasi **tidak boleh hanya mengandalkan urutan penempatan d3-cloud**. Setelah layout selesai, renderer melakukan pass **center + fit**:
  1. Hitung selisih posisi kata teratas terhadap titik tengah.
  2. Geser seluruh cloud sehingga kata teratas tepat di tengah.
  3. Jika ada kata yang keluar canvas setelah digeser, skalakan seluruh cloud secara seragam (posisi dan ukuran) sampai semuanya masuk, dengan margin aman.
- Pass ini menjaga posisi tengah tetap benar saat data berubah, saat canvas di-resize, dan saat jumlah kata sedikit.
- Acceptance test khusus:
  - 1 kata → tepat di tengah.
  - 3 kata dengan count 10 / 9 / 8 → kata count 10 di tengah, dua lainnya mengelilingi tanpa menutupi kata tengah.
  - Resize canvas → kata count 10 tetap di tengah.
  - Data berubah dari 1 kata menjadi 3 kata → animasi berakhir dengan kata terbanyak di tengah.

### 10.4 End

Urutan:

1. Operator klik **Akhiri sesi** dan konfirmasi.
2. Client mengirim `operator:end` (ack timeout 5 detik).
3. Server set `status = ended`, `endedAt`, `acceptingAnswers = false`, simpan snapshot, buat arsip, lalu broadcast `room:status` + statistik final.
4. Controller operator (satu-satunya tab operator aktif) menghentikan recorder saat menerima `room:status = ended`.
5. Recorder finalize → preview + auto-download file.
6. Display menampilkan word cloud final + banner “Sesi berakhir”.
7. Peserta melihat layar terima kasih; input hilang/disabled.
8. Admin melihat status ended dan statistik final.

Jika server tidak merespons:

- Recorder tetap dihentikan setelah timeout agar rekaman tidak hilang.
- UI menampilkan peringatan “Rekaman dihentikan, sesi mungkin masih live”.
- Client mencoba mengirim ulang `operator:end` saat reconnect.
- Room akan berakhir begitu server menerima End.

### 10.5 Recording terputus tak terduga

Penyebab: operator menekan “Stop sharing”, tab crash, atau track video berakhir.

Perilaku:

- Room **tetap live** (sesuai keputusan sebelumnya).
- Client mengirim `operator:recording { status: "interrupted", ownerId, segment }`.
- UI operator menampilkan peringatan + tombol **Lanjutkan rekaman**.
- Resume memanggil `recorder.start()` lagi (user gesture), lalu mengirim `operator:resume-recording` dengan segmen baru.
- Server menerima `operator:resume-recording` saat `status === "live"`, mencatat `recording.status = "recording"`, `ownerId`, dan `segment` baru, lalu broadcast `recording:update`.
- Resume membuat **file segmen baru** (file terpisah), mis. `cloudwords-<room>-part2-<timestamp>.webm`.
- Display tetap menampilkan word cloud; indikator REC di display berubah menjadi “recording terputus” bila fitur indikator dipakai.
- Hanya End yang mengakhiri room.

Jika operator membuka kembali room yang live (reload, reconnect, atau token baru), UI menampilkan tombol **Lanjutkan rekaman** kapan pun `recording.status` bukan `recording`. Ini juga jalur pemulihan setelah regenerate token atau `operator:superseded`.

### 10.6 Operator disconnect / tab ditutup

- Room tetap live.
- Recording berjalan di browser operator selama tab masih hidup; jika tab ditutup, track berakhir dan segmen terakhir mungkin tidak sempat terunduh.
- Saat controller disconnect, server menandai `recording.status = "unknown"` (jika sebelumnya `recording`) dan `operatorOnline = false`.
- Saat operator membuka link lagi, koneksi baru menjadi controller; `room:init` memulihkan status live dan tombol End/Resume.
- Client segera melaporkan status recorder sebenarnya lewat `operator:recording`, sehingga status `unknown` kembali menjadi `recording` bila stream masih berjalan.
- Jika tab operator lain dibuka, tab baru menjadi controller dan tab lama menerima `operator:superseded`; recorder tab lama dihentikan dan file diunduh. Tab lama tidak reconnect otomatis.
- UI memperingatkan sebelum menutup tab saat merekam (`beforeunload`).
- Batasan yang diakui: recording sepenuhnya client-side; crash browser dapat menghilangkan segmen yang sedang berjalan.

### 10.7 Server restart

- Saat boot, room `waiting` dan `ended` dipulihkan apa adanya.
- Room yang sebelumnya `live` **diakhiri otomatis** dengan `endedAt = now` dan `endReason = "server-restart"`, lalu diarsipkan.
- Client operator yang reconnect melihat `ended`, menghentikan recorder, dan mengunduh rekaman yang sempat berjalan.
- Alasan: mencegah room “zombie” yang live tanpa operator dan tanpa kemungkinan End yang jelas, serta menghindari pelanggaran aturan “hanya operator yang mengakhiri” di kondisi normal.

---

## 11. UI per halaman

### 11.1 Lobby `/`

- Daftar room `waiting` dan `live` (room `ended` disembunyikan).
- Urutan: live dulu, lalu waiting; di dalamnya berdasarkan nama/waktu.
- Kartu: nama room, status, pertanyaan, jumlah peserta, tombol **Masuk**.
- Tidak menampilkan token atau link operator.
- Empty state: “Belum ada room. Hubungi admin.”
- Data dari `/api/rooms`, refresh via Socket.IO `/room`? Lobby tidak perlu socket; polling ringan 10 detik atau refresh manual. Untuk kesederhanaan: fetch saat load + tombol refresh. (Bisa ditingkatkan nanti.)

### 11.2 Peserta `/room/:roomId`

Tiga state:

| State | Tampilan |
| --- | --- |
| `waiting` | Nama room, pertanyaan, “Sesi belum dimulai. Tunggu operator.” Input disabled. |
| `live` | Form jawaban aktif, 5 kata teratas, statistik, konfirmasi jawaban terkirim. |
| `ended` | “Sesi telah berakhir. Terima kasih!” + 5 kata teratas final. Input tidak ada. |

- Reconnect otomatis; state diambil ulang dari `room:init`.
- Jika room tidak ada: halaman 404 yang ramah.
- Jika room dihapus saat dibuka: tampilkan pesan dan tombol ke lobby.
- Mobile-first; input tetap nyaman di layar kecil.

### 11.3 Display `/display/:roomId`

| State | Tampilan |
| --- | --- |
| `waiting` | Nama room, pertanyaan, “Menunggu operator memulai”, link peserta, statistik 0. |
| `live` | Word cloud full-screen, pertanyaan, statistik, indikator recording (opsional). |
| `ended` | Word cloud final, banner “Sesi berakhir”, statistik final, terima kasih. |

- Tanpa kontrol apa pun; hanya menerima state.
- Nama room ditampilkan agar operator/admin tidak salah membuka display.
- Link peserta ditampilkan agar mudah dibagikan.
- Full-screen 16:9, tetap terbaca dari jauh.

#### 11.3.1 Jaminan kata teratas di tengah

Ini adalah requirement keras, bukan sekadar efek samping layout:

1. Data selalu diurutkan dari frekuensi tertinggi ke terendah; jika frekuensi sama, urutan alfabetis.
2. Kata peringkat pertama mendapat ukuran font terbesar.
3. Kata peringkat pertama ditempatkan tepat di `(width / 2, height / 2)`.
4. Jika `d3-cloud` menempatkan kata pertama meleset dari tengah, seluruh layout digeser sehingga kata pertama kembali ke tengah. Pergeseran ini tidak mengubah jarak antar-kata, jadi tidak menimbulkan overlap baru.
5. Kata lain melingkar keluar dari tengah; kata yang lebih kecil berada lebih jauh dari pusat.

Kasus yang wajib benar:

| Data | Hasil |
| --- | --- |
| 1 kata: `fokus` (1) | `fokus` tepat di tengah, satu-satunya kata. |
| 3 kata: `fokus` (5), `kerja` (4), `tim` (4) | `fokus` di tengah dan paling besar; `kerja`/`tim` di sekitarnya. |
| 2 kata dengan frekuensi sama: `a` (3), `b` (3) | `a` di tengah karena urutan alfabetis; keduanya ukuran sama. |
| Kata teratas berganti saat live | Layout baru tetap menempatkan kata teratas yang baru di tengah, dengan animasi. |

Jaminan ini berlaku di display, preview admin, dan preview operator karena semuanya memakai `WordCloudRenderer` yang sama.

### 11.4 Operator `/operator/:roomId?token=...`

Panel:

- Header: nama room, status pill (`waiting`/`live`/`ended`), koneksi.
- Tombol utama:
  - `waiting`: **Mulai & rekam** (hijau).
  - `live`: **Akhiri sesi** (merah) + timer recording.
  - `ended`: tidak ada tombol start/end; tampilkan ringkasan.
- Panel recording:
  - status (Siap / Meminta izin / Merekam / Terputus / Tidak terpantau / Selesai),
  - timer,
  - tombol **Lanjutkan rekaman** saat `recording.status` `interrupted`/`unknown` dan room live,
  - preview video + link unduh setelah selesai.
- Info room: pertanyaan, link peserta, tombol **Buka Display**.
- Statistik live: peserta, jawaban, kata unik, kata teratas.
- Daftar kata teratas + aktivitas terbaru.
- Tombol **Reset jawaban** hanya saat `waiting`.
- Peringatan sebelum meninggalkan halaman saat recording aktif.
- Token tidak ditampilkan di UI; cukup indikator “Operator terautentikasi”.
- Jika tab ini menerima `operator:superseded`: hentikan recorder, tampilkan “Sesi operator diambil alih tab/perangkat lain”, nonaktifkan kontrol, dan putuskan socket tanpa reconnect.

### 11.5 Super admin `/admin` (alias `/superadmin`)

Ini adalah halaman pusat untuk membuat dan mengelola semua room. Pada aplikasi lama, `/admin` masih mengontrol satu sesi; setelah revisi multi-room, halaman ini berubah menjadi **super admin**.

Login:

- Form password.
- Setelah sukses, dashboard dimuat.
- Token di `sessionStorage`; reload tidak perlu login ulang selama token valid.
- 401/expired → kembali ke form login.

Dashboard:

- Header: jumlah room, tombol **Buat room**, logout.
- Daftar room (kartu/tabel):
  - nama, status, pertanyaan,
  - peserta online, total jawaban, kata unik,
  - status recording + operator online/offline,
  - waktu dibuat / mulai / selesai.
- Aksi per room:
  - **Salin link peserta**,
  - **Salin link display**,
  - **Salin link operator + token**,
  - **Regenerate token** (konfirmasi; mencabut operator lama),
  - **Edit** (hanya waiting),
  - **Hapus** (hanya waiting/ended; konfirmasi),
  - **Preview** (buka socket `/room` watcher untuk word cloud live room tersebut).
- Form buat room: nama + pertanyaan. Setelah dibuat, tampilkan link operator + token di panel detail; token tetap bisa disalin kapan saja oleh admin yang login.
- Admin **tidak** memiliki tombol Start/End.
- `Regenerate token` saat live diperbolehkan dengan konfirmasi keras: controller lama menerima `operator:revoked`, recorder-nya berhenti, dan operator baru bisa melanjutkan/mengakhiri.

**Cara mengetahui multi-room sudah aktif:**

1. Buka `/admin` atau `/superadmin`, lalu login.
2. Dashboard menampilkan tombol **Buat room** dan daftar room.
3. Buat dua room (mis. “Ruang A” dan “Ruang B”).
4. Masing-masing room menampilkan tiga link: peserta, display, dan operator + token.
5. Buka display dan operator untuk kedua room, lalu start keduanya.
6. Jika kedua word cloud berjalan bersamaan dan jawaban room A tidak muncul di room B, multi-room aktif.

Halaman ini **belum ada** pada kode saat ini. `/admin` lama masih single-room. Implementasi baru dimulai setelah desain ini disetujui.

---

## 12. Persistensi

- **Runtime:** semua state room di memory.
- **Selama live:** snapshot JSON per room ditulis debounced 1.5 detik (crash recovery + syarat “state disimpan sebagai JSON”).
- **Saat End:** snapshot final + arsip `data/archive/<roomId>_<timestamp>.json`.
- **Saat create/start/end/delete:** registry langsung ditulis.
- **Saat restart:** registry + snapshot dimuat; room live diakhiri otomatis (lihat 10.7).
- **Database:** ditunda. Semua akses file lewat `RoomRepository` agar implementasi DB nanti tidak mengubah handler Socket.IO.
- **Retensi:** arsip tidak dihapus otomatis pada iterasi ini. Admin bisa menghapus file manual. (Bisa ditambahkan nanti.)

Struktur data:

```text
data/
├── rooms.json
├── rooms/
│   ├── r_9f2c1a7b.json
│   └── r_ab12cd34.json
└── archive/
    ├── r_9f2c1a7b_2026-10-28T10-15-00.json
    └── r_ab12cd34_2026-10-28T11-02-00.json
```

---

## 13. Keamanan

- **Admin password** tidak pernah dikirim ke client selain saat login; token HMAC berumur pendek.
- **Token operator** tidak muncul di:
  - `/api/rooms`,
  - halaman peserta/display,
  - log akses (Express tidak logging by default),
  - referrer (header `no-referrer`).
- **Token operator** dihapus dari address bar setelah halaman dimuat.
- **Perbandingan token** memakai `timingSafeEqual`.
- **Validasi input**:
  - nama room 1–60,
  - pertanyaan 3–140,
  - jawaban 1–40 setelah normalisasi,
  - payload Socket.IO maksimal 100 KB (sudah ada).
- **Rate limit**:
  - jawaban: 700 ms per socket,
  - login admin: 10 percobaan / 5 menit / IP,
  - pembuatan room: maksimal 50 room.
- **CORS**: default same-origin; `CORS_ORIGIN` hanya untuk kebutuhan pengembangan. Tidak lagi `*` untuk produksi.
- **XSS**: semua teks dinamis dimasukkan lewat `textContent`, bukan `innerHTML`.
- **CSRF**: token admin di header/handshake, bukan cookie.
- **Admin watcher**: role `admin` di `/room` wajib token HMAC admin yang valid; server menolak semua event tulis dari role ini.
- **Room deletion**: hanya waiting/ended; live tidak bisa dihapus.

---

## 14. Performa

- Broadcast per room, bukan global.
- Satu tick global setiap `BROADCAST_INTERVAL` (500 ms) memeriksa room yang “dirty”; ini membatasi kerja dan menghindari satu timer per room.
- Cache JSON per room untuk mencegah broadcast data yang tidak berubah.
- Peserta hanya menerima 5 kata; payload lengkap hanya untuk display/operator/admin watcher.
- Statistik saat connect/disconnect di-debounce 200 ms per room.
- Daftar room admin di-throttle 1 detik.
- Batas:
  - 50 room,
  - 1.000 kata unik per room,
  - 150 kata dikirim ke display,
  - 12 aktivitas terbaru.
- Target: 500 koneksi total pada satu proses tetap nyaman; p95 ack jawaban < 150 ms pada mesin development.
- Multi-instance tidak didukung pada iterasi ini.

---

## 15. Migrasi dari aplikasi single-room

- State global `wordCounts` dan `question` dihapus dari `server.js`.
- `register-role` global diganti handshake `/room` dan `/admin`.
- `io.emit(...)` diganti broadcast per room.
- `public/index.html` menjadi lobby; form peserta pindah ke `room.html`.
- `public/display.html` membaca `roomId` dari path.
- `public/admin.html` menjadi dashboard room; recorder pindah ke `operator.html`.
- `public/js/admin.js` dipecah menjadi `admin.js` (manajemen room) dan `operator.js` (lifecycle + recorder).
- `public/js/audience.js` menjadi `room.js` (waiting/live/ended).
- `public/js/display.js` disesuaikan dengan room.
- `wordcloud.js` dan `recorder.js` tetap, dengan tambahan opsi `filenamePrefix` pada recorder.
- `README.md` diperbarui total.
- `scripts/load-test.js` diperbarui agar menerima `--room` dan menguji banyak room.
- `data/state.json` lama tidak dimigrasikan otomatis. Jika ada, file dibiarkan; admin membuat room baru. Ini aman karena state demo saat ini kosong.
- Route `/display` lama redirect ke `/`.
- `/api/state` lama dihapus; diganti `/api/rooms` (publik, tanpa token).

---

## 16. Penanganan kegagalan

| Kegagalan | Perilaku |
| --- | --- |
| Server mati saat room live | Restart → room diakhiri otomatis & diarsipkan; operator reconnect → recorder berhenti & file diunduh. |
| Operator kehilangan koneksi | Room tetap live; recording lokal tetap jalan; status recording menjadi `unknown`; operator reconnect → state pulih dan status dilaporkan ulang. |
| Operator menutup tab | Recording berhenti; room tetap live; operator baru dengan link/token menjadi controller dan bisa End atau resume. |
| Operator kedua membuka link | Controller lama menerima `operator:superseded`, recorder-nya berhenti dan file diunduh; controller baru mengambil alih. |
| Recording track berakhir | Room tetap live; status interrupted; tombol resume muncul; file segmen sebelumnya diunduh. |
| Display ditutup | Room tetap live; operator melihat display offline; recording mungkin merekam layar kosong. |
| Admin menghapus room waiting | Socket room diputus; semua halaman menampilkan “Room dihapus”; file snapshot dihapus. |
| Admin regenerate token saat live | Operator lama dicabut + recorder dihentikan; operator baru bisa End. |
| File JSON korup | Server mencatat error, melewati room yang korup, dan tetap melayani room lain. |
| Disk penuh | Save gagal; server tetap live di memory; error dicatat; UI admin bisa menampilkan peringatan. |
| Browser tidak mendukung recording | Tombol Start disabled; room tidak bisa live; pesan jelas. |

---

## 17. Keputusan yang diserahkan ke builder

Keputusan berikut diambil sebagai default yang wajar. Admin/user bisa mengoreksi saat review:

1. **Admin tidak bisa start/end room.** Hanya operator. Admin bisa regenerate token sebagai jalur pemulihan.
2. **Lobby menampilkan semua room waiting/live.** Tidak ada mode “unlisted”. Untuk internal event, ini cukup.
3. **Token operator disimpan plaintext** di file server agar admin bisa menyalin ulang link. Regenerate mencabut token lama.
4. **Regenerate token saat live diperbolehkan** dengan konfirmasi; ini jalur pemulihan jika operator hilang.
5. **Recording terputus tidak mengakhiri room**; resume membuat file segmen baru.
6. **Server restart mengakhiri room live** dan mengarsipkannya.
7. **Tidak ada pause/accepting toggle**; status hanya waiting/live/ended.
8. **Nama dan pertanyaan hanya bisa diedit saat waiting.**
9. **Tidak ada database**; JSON repository dengan antarmuka replaceable.
10. **Tidak ada upload rekaman**; file diunduh ke perangkat operator.
11. **Satu proses Node**; belum ada Redis adapter.
12. **Admin password dev default `admin`**, tetapi produksi wajib `ADMIN_PASSWORD`.
13. **Room `ended` bersifat terminal.** `reset-data` hanya diizinkan saat `waiting`; untuk putaran baru, admin membuat room baru. Arsip sesi lama tidak diubah.
14. **Satu controller operator per room.** Koneksi operator terbaru menang; koneksi lama di-supersede dan recorder-nya dihentikan. Ini mencegah dua rekaman berjalan bersamaan.
15. **Preview admin memakai socket `/room` terpisah** dengan role read-only `admin`, bukan fan-out lintas namespace.
16. **Recording yang terputus boleh dilanjutkan saat live** lewat `operator:resume-recording`; ini menutup celah room live tanpa recorder setelah token di-regenerate atau operator reconnect.
17. **`/admin` dan `/superadmin` menyajikan halaman super admin yang sama.** `/admin` dipertahankan agar link lama tidak rusak; `/superadmin` disediakan agar penamaan sesuai peran pusat.
18. **Posisi tengah kata teratas dijamin oleh kode**, bukan hanya kebetulan layout: setelah `d3-cloud`, seluruh layout digeser bila kata peringkat pertama tidak berada di tengah.

---

## 18. Kriteria penerimaan

1. Super admin bisa login di `/admin` atau `/superadmin` dengan `ADMIN_PASSWORD`; password salah ditolak; percobaan berlebih kena rate limit.
2. Super admin bisa membuat beberapa room; masing-masing punya `id`, nama, pertanyaan, dan token operator unik; daftar room langsung menampilkan dua room atau lebih.
3. Link operator valid membuka dashboard; token salah/kedaluwarsa ditolak dengan pesan jelas.
4. Dua room bisa live bersamaan; jawaban room A tidak pernah muncul di room B.
5. Peserta di waiting room tidak bisa mengirim jawaban; server menolak `NOT_STARTED`.
6. Klik Start membuka picker screen share; batal → room tetap waiting; berhasil → room live dan recording berjalan.
7. Start ditolak jika recording belum aktif; room tidak bisa live tanpa recorder. Setelah live, recording yang terputus boleh dilanjutkan lewat `operator:resume-recording`.
8. Hanya operator yang bisa start/end; percobaan dari peserta/display/admin pusat/admin watcher ditolak server.
9. Kata dengan frekuensi tertinggi tampil lebih besar dan **tepat di tengah**; jika hanya satu kata, kata itu di tengah; jika tiga kata dengan frekuensi berdekatan (mis. 5, 4, 4), kata dengan frekuensi 5 tetap di tengah; word cloud tetap animasi dan responsif.
10. End menghentikan room, menolak jawaban baru, menampilkan cloud final di display, dan menghentikan + mengunduh rekaman.
11. Recording terputus menampilkan peringatan, room tetap live, dan resume membuat segmen baru.
12. Hanya halaman operator yang memuat recorder; display tidak.
13. JSON registry, snapshot per room, dan arsip akhir terbentuk; restart memulihkan waiting/ended dan mengakhiri live.
14. Lobby hanya menampilkan room waiting/live; link langsung ke room/display berfungsi.
15. Admin bisa regenerate token, edit room waiting, dan menghapus room waiting/ended; tidak bisa menghapus room live.
16. `reset-data` diterima saat waiting dan ditolak saat live/ended.
17. Membuka link operator di tab/perangkat kedua membuat tab baru menjadi controller; tab lama menerima `operator:superseded` dan recorder-nya berhenti.
18. Admin membuka preview tidak bisa memicu start/end/reset; socket watcher hanya menerima data.
19. Load test banyak room tidak menyebabkan cross-talk dan tetap dalam target latency.
20. Tampilan peserta/operator nyaman di mobile; display terbaca di layar besar.
21. README, dokumentasi event, dan panduan menjalankan diperbarui.
22. Alur verifikasi multi-room berhasil: login super admin → buat dua room → salin tiga link per room → start dua operator → dua display live bersamaan dengan data terpisah.
23. Regression test renderer membuktikan kasus 1 kata, 3 kata berdekatan, dan seri frekuensi menempatkan kata teratas di tengah.

---

## 19. Rencana implementasi tingkat tinggi

Setelah desain ini disetujui, implementation plan akan dipecah menjadi fase:

1. **Fondasi backend** — `RoomRepository`, registry, model room, helper normalisasi/statistik per room.
2. **Auth** — login admin, token HMAC, middleware `/admin`, validasi token operator `/room`.
3. **Room lifecycle & broadcast** — create/start/end/delete, per-room throttle, stats, presence.
4. **API & routing** — `/api/rooms`, `/api/admin/login`, halaman statis per route.
5. **UI super admin** — login di `/admin` + alias `/superadmin`, daftar room, create/edit/delete, link & token, preview.
6. **UI operator** — Start/End, recorder terintegrasi, status recording, resume, warning.
7. **UI peserta & display** — waiting/live/ended, room-aware socket, lobby.
8. **Center guarantee** — pastikan kata teratas selalu di tengah untuk 1 kata, 3 kata berdekatan, dan seri frekuensi; tambahkan regression test.
9. **Persistensi & migrasi** — snapshot, arsip, restart recovery, README.
10. **Verifikasi** — unit/integration test untuk auth & lifecycle, load test multi-room, uji manual recording di Chrome/Edge, uji alur dua room dari super admin.

Belum ada kode produk yang ditulis sebelum rencana ini disetujui.
