# CloudWords — Multi-Room Real-time Word Cloud

Aplikasi word cloud **real-time multi-room** bergaya Mentimeter, dibangun dengan
**Node.js + Express + Socket.IO** dan **HTML/CSS/JS native**. Beberapa room dapat
live bersamaan; setiap room punya nama, pertanyaan, peserta, word cloud, display,
operator, dan rekaman layarnya sendiri.

---

## Peran

| Peran | Perangkat | Tugas |
| --- | --- | --- |
| **Super admin** | Satu perangkat | Login di `/admin`, membuat/mengelola room, membagikan link peserta, display, dan operator + token. |
| **Operator room** | Satu perangkat per room | Satu-satunya yang boleh memulai, merekam, dan mengakhiri room. |
| **Peserta** | Banyak perangkat | Masuk waiting room, lalu mengirim jawaban setelah operator memulai. |
| **Display** | Satu layar per room | Menampilkan word cloud, pertanyaan, dan statistik room. Tidak bisa merekam. |

Admin pusat **tidak** bisa start/end room. Start/end hanya lewat link operator
yang memuat token rahasia per room.

---

## Fitur

### Multi-room & isolasi data
- Banyak room bisa live pada waktu bersamaan.
- Setiap room punya word count, peserta, statistik, status, dan display sendiri.
- Broadcast Socket.IO di-scope per room, jadi jawaban tidak bocor antar-room.

### Navigasi dan akses
- **Navbar hanya ada di halaman Superadmin** dan memuat semua tautan: Lobby,
  Display, Isi Jawaban, Admin Room, Superadmin.
- Lobby, Display, Isi Jawaban, waiting room, dan Admin Room **tidak** menampilkan
  navbar atau tautan ke Superadmin. Peserta tidak bisa menemukan jalur admin
  dari halaman publik.
- Admin Room dibuka lewat link operator + token; Superadmin dibuka lewat URL
  langsung `/admin` atau `/superadmin`.
- **Pertanyaan room hanya dibuat dan diubah oleh Superadmin.** Operator room
  tidak bisa mengubah pertanyaan.

### Waiting room & lifecycle
- Room baru berstatus `waiting`; peserta belum bisa mengirim jawaban.
- Operator menekan **Mulai & rekam** → izin screen share diminta → room menjadi `live`
  hanya setelah rekaman benar-benar berjalan.
- Jika izin screen share dibatalkan, room tetap `waiting`.
- **Akhiri sesi** menghentikan room dan rekaman. Room `ended` bersifat terminal.
- `reset-data` hanya boleh saat room `waiting`.
- Recording terputus tidak mengakhiri room; operator bisa memulai **segmen baru**.

### Word cloud
- Normalisasi jawaban: Unicode-aware, lowercase, tanda baca dirapikan, spasi
  dirapikan, maks. 40 karakter.
- **Menerima bahasa Mandarin** dan aksara Unicode lain (mis. `你好`, `团队合作`).
- Kata/frasa dengan frekuensi lebih tinggi tampil lebih besar.
- Kata dengan frekuensi tertinggi **selalu tepat di tengah kanvas**, termasuk:
  - saat hanya ada satu kata;
  - saat frekuensi teratas berdekatan (mis. 5, 4, 4);
  - saat hasil layout d3-cloud harus digeser atau diperkecil seragam.
- Animasi halus, warna stabil per kata, layout responsif.

### Screen recording per room
- Memakai `getDisplayMedia` + `MediaRecorder` di perangkat operator.
- Operator memilih tab **Display** saat diminta.
- File otomatis diunduh ke perangkat operator (`.webm`, atau `.mp4` bila didukung).
- Tidak ada upload rekaman ke server.
- Nama file memuat nama room dan nomor segmen.

### Super admin
- Login dengan password dari file kredensial.
- Membuat, mengedit (saat waiting), dan menghapus room.
- Menyalin link peserta, display, serta link operator + token.
- Regenerate token operator (link lama langsung tidak valid).
- Preview word cloud read-only tanpa bisa mengontrol room.

---

## Tech stack

| Bagian | Teknologi |
| --- | --- |
| Runtime | Node.js 18+ |
| Web server | Express 4 |
| Real-time | Socket.IO 4 |
| Word cloud layout | [`d3-cloud`](https://github.com/jasondavies/d3-cloud) (di-vendor, tanpa CDN) |
| Frontend | HTML5, CSS3, JavaScript ES6+ |
| Recording | MediaRecorder API + `getDisplayMedia` |
| Penyimpanan | File JSON (tanpa database) |
| Test | `node:test` |

---

## Struktur project

```text
mentimeter/
├── package.json
├── server.js                    # Express + Socket.IO, route & event
├── lib/
│   ├── config.js                # Konfigurasi terpusat
│   ├── credentials.js           # Loader kredensial JSON
│   ├── auth.js                  # Password, token admin, rate limiter
│   ├── room-repository.js       # Persistence JSON
│   └── rooms.js                 # Registry & lifecycle room
├── public/
│   ├── index.html               # Lobby (tanpa navbar admin)
│   ├── picker.html             # Pemilih room untuk Display / Isi Jawaban
│   ├── room.html                # Halaman peserta
│   ├── display.html             # Layar word cloud
│   ├── operator.html            # Kontrol operator + recorder
│   ├── operator-entry.html      # Entry link operator + token
│   ├── admin.html               # Super admin (satu-satunya dengan navbar)
│   ├── css/style.css
│   ├── js/
│   │   ├── ui.js                # Helper UI bersama
│   │   ├── nav.js               # Navbar lengkap, hanya dimuat di admin.html
│   │   ├── picker.js
│   │   ├── operator-entry.js
│   │   ├── lobby.js
│   │   ├── room.js
│   │   ├── display.js
│   │   ├── operator.js
│   │   ├── admin.js
│   │   ├── wordcloud.js         # Renderer canvas + animasi d3-cloud
│   │   ├── wordcloud-center.js  # Jaminan kata teratas di tengah
│   │   └── recorder.js          # ScreenRecorder
│   └── vendor/d3.layout.cloud.js
├── scripts/
│   ├── copy-vendor.js
│   └── load-test.js             # Load test per room
├── test/                        # node:test
├── data/                        # Dibuat otomatis, di-ignore git
│   ├── credentials.json         # Password admin + session secret
│   ├── rooms.json               # Registry + token operator
│   ├── rooms/<roomId>.json      # Snapshot state room
│   └── archive/<file>.json      # Arsip room yang selesai
├── .gitignore
└── README.md
```

---

## Menjalankan

Prasyarat: **Node.js 18+** dan npm.

```bash
npm install
npm start
```

`npm install` menjalankan `scripts/copy-vendor.js` untuk menyalin d3-cloud ke
`public/vendor`. Jika folder itu kosong, jalankan:

```bash
npm run vendor
```

Mode development:

```bash
npm run dev
```

Buka `http://localhost:3000`.

### Halaman

| Halaman | URL | Fungsi |
| --- | --- | --- |
| Lobby | `/` | Daftar room waiting/live, tanpa navbar admin |
| Pilih Display | `/display` | Memilih room untuk dibuka sebagai display |
| Display | `/display/<roomId>` | Word cloud room |
| Pilih Peserta | `/join` | Memilih room untuk mengirim jawaban |
| Peserta | `/room/<roomId>` | Waiting room + form jawaban |
| Admin Room entry | `/operator` | Menempel link operator + token |
| Operator | `/operator/<roomId>?token=<token>` | Start/end + recording |
| Super admin | `/admin` atau `/superadmin` | Kelola semua room, satu-satunya halaman dengan navbar |
| API room | `/api/rooms` | Daftar room publik (tanpa token) |
| Login admin | `POST /api/admin/login` | Mendapat token admin |
| Health | `/health` | Status server & jumlah room |

`/room` (tanpa ID) diarahkan ke `/join`.

### Alur demo cepat

1. Buka `/admin`, login dengan password dari `data/credentials.json`
   (default development: `admin`).
2. Klik **+ Buat room**, isi nama dan pertanyaan.
3. Salin **link operator + token** dari kartu room dan kirim ke operator room.
4. Bagikan link peserta dan buka link display di layar room.
5. Di perangkat operator, buka link operator, klik **Mulai & rekam**, lalu pilih
   tab **Display** saat browser meminta izin.
6. Peserta mengirim jawaban; word cloud dan statistik berubah real-time.
7. Klik **Akhiri sesi** di perangkat operator. Rekaman berhenti dan file terunduh.

---

## Kredensial (JSON, tidak masuk git)

Semua kredensial server disimpan di **`data/credentials.json`**:

```json
{
  "adminPassword": "ganti-password-ini",
  "sessionSecret": "hex-64-karakter"
}
```

- File dibuat otomatis saat pertama kali server dijalankan.
- Default development: password `admin`, session secret acak 32 byte.
- Ubah `adminPassword` sebelum dipakai sungguhan, lalu restart server.
- `sessionSecret` dipakai untuk menandatangani token admin. Jika diubah, semua
  sesi admin lama otomatis tidak valid.
- File ditulis dengan mode `0600` di Linux/macOS (Windows mengikuti ACL folder).
- Saat `NODE_ENV=production`, server **menolak start** jika belum ada
  `adminPassword` di file maupun environment.

Urutan prioritas nilai:

1. Override eksplisit (dipakai test)
2. Environment variable (`ADMIN_PASSWORD`, `SESSION_SECRET`)
3. File JSON
4. Default development

Environment tidak menimpa isi file. Jika ingin mengganti permanen, edit file JSON.

Lokasi file bisa dipindah dengan `CREDENTIALS_FILE`:

```bash
CREDENTIALS_FILE=/etc/cloudwords/credentials.json npm start
```

Token operator juga kredensial. Token tersebut disimpan di `data/rooms.json`
dan tidak pernah ditampilkan di `/api/rooms` atau halaman publik.

### `.gitignore`

File `.gitignore` di root meng-ignore semua data sensitif:

```gitignore
credentials.json
*.credentials.json
data/**/*.json
data/**/*.jsonl
.env
.env.*
!.env.example
.superpowers/
```

Artinya `data/credentials.json`, `data/rooms.json`, snapshot room, arsip, dan
token operator **tidak akan ter-push**. `package.json` tetap ter-commit karena
tidak berada di bawah `data/`.

Jika file sensitif sudah sempat ter-commit sebelum `.gitignore` dibuat:

```bash
git rm --cached data/credentials.json data/rooms.json data/rooms/*.json
git commit -m "Hapus kredensial dan data runtime dari repository"
```

Setelah itu **ganti password admin dan session secret**, karena nilai lama harus
dianggap bocor. Regenerate token operator dari `/admin` bila perlu.

---

## Konfigurasi

| Environment variable | Default | Keterangan |
| --- | --- | --- |
| `PORT` | `3000` | Port HTTP/Socket.IO |
| `NODE_ENV` | `development` | `production` mewajibkan password admin |
| `DATA_DIR` | `./data` | Folder data JSON |
| `CREDENTIALS_FILE` | `<DATA_DIR>/credentials.json` | Lokasi file kredensial |
| `ADMIN_PASSWORD` | dari file / `admin` (dev) | Override password admin |
| `SESSION_SECRET` | dari file / acak | Override secret token admin |
| `BROADCAST_INTERVAL` | `500` | Interval broadcast word cloud (ms, min. 100) |
| `CORS_ORIGIN` | `*` | Origin Socket.IO yang diizinkan |

Contoh:

```bash
PORT=8080 BROADCAST_INTERVAL=750 npm start
```

---

## Persistence

Tidak ada database. State room dipersistenkan sebagai JSON:

| File | Isi |
| --- | --- |
| `data/credentials.json` | Password admin + session secret |
| `data/rooms.json` | Registry room + token operator |
| `data/rooms/<roomId>.json` | Snapshot state room (kata, jawaban, recording) |
| `data/archive/<file>.json` | Arsip final room yang sudah ended |

Penulisan memakai antrean serial dan atomic write (file sementara lalu rename),
sehingga tidak ada dua penulisan bersamaan ke file yang sama. Saat server
dihentikan, antrean di-flush.

Saat restart:

- room `waiting` dipulihkan;
- room `ended` tetap `ended`;
- room yang tadinya `live` otomatis diakhiri dengan alasan `server-restart`,
  diarsipkan, dan recording-nya ditandai `interrupted`.

Semua file di atas di-ignore git. Jangan commit folder `data/`.

---

## Socket.IO

### Namespace `/room`

Handshake auth:

```js
{ roomId: 'r_xxx', role: 'audience' | 'display' | 'operator' | 'admin', token?: '...' }
```

- `operator` wajib menyertakan token room.
- `admin` wajib menyertakan token admin (preview read-only).
- `audience` dan `display` tidak perlu token.

| Event | Arah | Keterangan |
| --- | --- | --- |
| `room:init` | server → client | Snapshot awal: room, words, stats, recent, recording, isController |
| `room:status` | server → client | Perubahan status `waiting`/`live`/`ended` |
| `room:meta` | server → client | Perubahan nama/pertanyaan |
| `submit-answer` | audience → server | Kirim jawaban; ack `{ ok, text, totalAnswers }` |
| `update-wordcloud` | server → display/admin | Word cloud lengkap (throttled) |
| `topwords:update` | server → audience | 5 kata teratas |
| `stats:update` | server → semua | Peserta, jawaban, kata unik, kata teratas |
| `recording:update` | server → semua | Status recording room |
| `activity:new` | server → operator/admin | Feed jawaban terbaru |
| `operator:start` | operator → server | Mulai room; wajib `recording.active === true` |
| `operator:resume-recording` | operator → server | Mulai segmen recording baru |
| `operator:recording` | operator → server | Update status recording (`interrupted`, dll.) |
| `operator:end` | operator → server | Akhiri room |
| `reset-data` | operator → server | Kosongkan jawaban (hanya saat waiting) |
| `operator:superseded` | server → operator | Operator lain mengambil alih controller |
| `operator:revoked` | server → operator | Token diregenerate admin |
| `room:deleted` | server → semua | Room dihapus admin |

### Namespace `/admin`

Handshake auth: `{ token }` (token dari `POST /api/admin/login`).

| Event | Arah | Keterangan |
| --- | --- | --- |
| `admin:rooms` | server → admin | Daftar semua room + status online |
| `admin:create-room` | admin → server | Buat room |
| `admin:update-room` | admin → server | Ubah nama/pertanyaan (room waiting) |
| `admin:delete-room` | admin → server | Hapus room non-live |
| `admin:regenerate-token` | admin → server | Buat token operator baru |

---

## Screen recording

- Berjalan di secure context: `https://` atau `http://localhost`.
- Operator memilih **tab Display** saat browser meminta izin.
- Start hanya sah bila `recording.active === true`; server menolak start tanpa rekaman.
- Bila izin dibatalkan, room tetap `waiting`.
- Bila share screen dihentikan di tengah sesi:
  - room tetap `live`;
  - status recording menjadi `interrupted`;
  - klik **Lanjutkan rekaman** untuk membuat segmen/file baru.
- **Akhiri sesi** menghentikan recording dan mengunduh file.
- Recording berjalan di perangkat operator; display tidak merekam.

Jika tombol rekam tidak aktif, pastikan browser mendukung
`navigator.mediaDevices.getDisplayMedia` dan `MediaRecorder` (Chrome/Edge/Firefox
terbaru).

---

## Test

```bash
npm test
```

Test memakai `node:test` dan mencakup:

- autentikasi password/token admin dan rate limiter;
- loader kredensial JSON (create, reload, env override, production, file rusak);
- repository JSON (atomic write, arsip, registry rusak);
- lifecycle room (waiting/live/ended, reset, resume recording, restart);
- isolasi dua room live;
- takeover operator dan admin watcher read-only;
- jaminan kata teratas di tengah (satu kata, seri, scaling);
- nama file rekaman per room/segmen;
- input Mandarin/Unicode (mis. `你好`, `团队合作`);
- navbar hanya dirender di halaman Superadmin.

Saat ini: **51 test lulus**.

---

## Load test per room

Script `scripts/load-test.js` membuka banyak koneksi peserta ke **satu room**.
Gunakan room demo/kosong karena jawaban akan masuk ke word cloud room tersebut.

```bash
# Room harus sudah live
npm run loadtest -- --room r_2d845ea3a4

# Script memulai room lewat token operator, lalu mengirim jawaban
npm run loadtest -- --room r_2d845ea3a4 --token <operatorToken>

# Skenario 500 peserta, 2 jawaban masing-masing
npm run loadtest -- --room r_1bd2bf3ee7 --token <token> --clients 500 --messages 2
```

Opsi:

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `--url` | `http://localhost:3000` | Target server |
| `--room` | wajib | ID room target |
| `--token` | — | Token operator; bila diisi, room otomatis dimulai |
| `--clients` | `300` | Jumlah koneksi peserta (maks. 2000) |
| `--messages` | `5` | Jawaban per client |
| `--interval` | `800` | Jeda antar jawaban per client (min. 750 ms) |
| `--settle` | `1200` | Jeda setelah connect sebelum mengirim |
| `--help` | — | Tampilkan bantuan |

Room ID dan token operator bisa disalin dari kartu room di `/admin`.

---

## Catatan produksi

1. **Ganti password default.** Edit `data/credentials.json` sebelum dipakai.
   Jalankan dengan `NODE_ENV=production` agar server menolak start tanpa password.
2. **Jangan commit `data/`.** `.gitignore` sudah menutup semua JSON runtime.
   Backup file kredensial secara aman di luar repository.
3. **Reverse proxy Nginx** — aktifkan WebSocket upgrade:

   ```nginx
   location /socket.io/ {
       proxy_pass http://127.0.0.1:3000/socket.io/;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_read_timeout 120s;
   }

   location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```

4. **HTTPS untuk recording.** `getDisplayMedia` membutuhkan secure context.
5. **Naikkan file descriptor** di VPS Linux bila peserta banyak:

   ```bash
   ulimit -n 65536
   ```

6. **Skala horizontal.** State room ada di memory per proses. Untuk beberapa
   instance, pindahkan state ke Redis dan gunakan `@socket.io/redis-adapter`.
7. **Batas memori.** Maksimal 1.000 kata unik dan 150 kata dikirim ke display.
   Ubah batas lewat `createConfig`/`lib/config.js` bila perlu.

---

## Troubleshooting

| Masalah | Solusi |
| --- | --- |
| `ADMIN_PASSWORD belum di-set` saat start | Buat `data/credentials.json` dengan `adminPassword`, atau set `ADMIN_PASSWORD`. |
| Login admin selalu gagal | Cek `adminPassword` di `data/credentials.json`; environment `ADMIN_PASSWORD` menimpa file. |
| File kredensial rusak | Perbaiki JSON-nya atau hapus file; server tidak akan menimpa diam-diam. |
| Token operator tidak valid | Minta link operator terbaru; admin bisa **Regenerate token**. |
| Room tidak bisa start | Pastikan recording aktif dan izin screen share diberikan. |
| Peserta tidak bisa menjawab | Room harus `live`, bukan `waiting`/`ended`; tunggu operator. |
| Word cloud kosong | Pastikan jawaban masuk dan room live; cek `/health` dan console browser. |
| `d3-cloud tidak tersedia` | Jalankan `npm run vendor`, lalu reload display. |
| Port 3000 dipakai proses lain | `PORT=3001 npm start`. |
| Recording tidak didukung | Gunakan Chrome/Edge/Firefox terbaru via `localhost` atau HTTPS. |
| Rekaman terputus | Room tetap live; klik **Lanjutkan rekaman** untuk segmen baru. |
| Data lama muncul setelah restart | Room waiting/ended dipulihkan; hapus file di `data/` jika memang ingin bersih. |
| Load test banyak ditolak | Pastikan room live dan `--interval` minimal 750 ms. |

---

## Lisensi

MIT. Layout word cloud memakai [d3-cloud](https://github.com/jasondavies/d3-cloud)
oleh Jason Davies (lihat `public/vendor/d3-cloud.LICENSE`).
