# Arsitektur

## Gambaran sistem

CloudWords adalah aplikasi Node.js satu proses dengan tiga lapisan:

```text
Browser (peserta / display / operator / superadmin)
        │  HTTP + WebSocket
        ▼
Express + Socket.IO (server.js)
        │
        ├── lib/rooms.js            lifecycle & aturan room
        ├── lib/room-repository.js  persistence JSON
        ├── lib/auth.js             password, token admin, rate limit
        ├── lib/credentials.js      loader kredensial JSON
        └── lib/config.js           konfigurasi terpusat
        │
        ▼
data/*.json  (runtime, di-ignore git)
```

Tidak ada database dan tidak ada worker terpisah. State room hidup di memory
selama proses berjalan, lalu dipersistenkan ke JSON secara berkala dan saat
perubahan penting.

## Komponen server

| File | Tanggung jawab |
| --- | --- |
| `server.js` | Route HTTP, autentikasi Socket.IO, event room/admin, broadcast, lifecycle server |
| `lib/config.js` | Menggabungkan environment, kredensial, dan nilai default |
| `lib/credentials.js` | Membaca/menulis `data/credentials.json` dengan prioritas yang jelas |
| `lib/auth.js` | Verifikasi password, token admin bertanda tangan, rate limiter login |
| `lib/rooms.js` | Registry room, validasi jawaban, transisi status, recording, arsip |
| `lib/room-repository.js` | Registry `rooms.json`, snapshot per room, arsip, atomic write |

## Frontend

Halaman statis dilayani dari `public/`:

| Halaman | File | Peran |
| --- | --- | --- |
| Lobby | `index.html` + `lobby.js` | Daftar room publik tanpa navbar admin |
| Pemilih Display | `picker.html` + `picker.js` | Memilih room untuk dibuka sebagai display |
| Pemilih Peserta | `picker.html` + `picker.js` | Memilih room untuk mengirim jawaban |
| Waiting room / jawaban | `room.html` + `room.js` | Menunggu operator, lalu mengirim jawaban |
| Display | `display.html` + `display.js` | Word cloud dan statistik satu room |
| Admin Room | `operator.html` + `operator.js` + `recorder.js` | Start/end sesi dan screen recording |
| Entry Admin Room | `operator-entry.html` + `operator-entry.js` | Menempel link operator + token |
| Superadmin | `admin.html` + `admin.js` | CRUD room, link, preview read-only |

`public/js/nav.js` hanya dimuat oleh halaman Superadmin. Script ini mengisi
elemen `<div data-site-nav></div>` di `admin.html` dengan menu lengkap:

```text
Lobby · Display · Isi Jawaban · Admin Room · Superadmin
```

Menu menandai halaman aktif dengan `aria-current="page"` dan class
`is-active`. Halaman publik (lobby, picker display/join, waiting room, display,
Admin Room) tidak memuat `nav.js` dan tidak menampilkan tautan ke Superadmin.
Pertanyaan room hanya dapat dibuat/diubah oleh Superadmin.

## Isolasi antar-room

Setiap koneksi `/room` membawa `roomId` dan `role` di handshake. Server
memasukkan socket ke channel:

```text
room:<roomId>            → semua peran room tersebut
room:<roomId>:operator   → hanya operator
room:<roomId>:admin      → hanya admin watcher
room:<roomId>:display
room:<roomId>:audience
```

Semua emit memakai channel room yang sesuai. Tidak ada broadcast global untuk
jawaban atau word cloud, sehingga dua room yang live bersamaan tidak saling
membocorkan data.

Superadmin memakai namespace `/admin` yang terpisah. Untuk preview, admin
membuka koneksi `/room` dengan role `admin` dan token admin; koneksi ini
read-only dan tidak bisa memanggil event operator.

## Lifecycle room

```text
create ──► waiting ──(operator:start + recording aktif)──► live
              │                                             │
              │ reset-data (hanya waiting)                  │ operator:end
              ▼                                             ▼
           waiting                                        ended (terminal)
```

Aturan penting:

- Room baru selalu `waiting`.
- Peserta tidak bisa mengirim jawaban saat `waiting` atau `ended`.
- `operator:start` ditolak jika `recording.active !== true`.
- Jika pemilih layar dibatalkan, tidak ada event start yang valid; room tetap
  `waiting`.
- `ended` bersifat terminal. Room tidak bisa dimulai ulang.
- Saat restart server, room yang tadinya `live` diakhiri dengan alasan
  `server-restart`, diarsipkan, dan recording ditandai `interrupted`.
- Room `waiting` dipulihkan apa adanya.

## Recording

Recording berjalan sepenuhnya di perangkat operator:

1. Operator menekan **Mulai & rekam**.
2. Browser meminta izin `getDisplayMedia`.
3. Operator memilih tab **Display**.
4. `MediaRecorder` mulai merekam.
5. Setelah recorder benar-benar aktif, klien mengirim `operator:start` dengan
   `recording.active = true`.
6. Server mengubah room menjadi `live`.
7. Saat **Akhiri sesi**, recorder dihentikan dan file diunduh ke perangkat
   operator.
8. Tidak ada upload rekaman ke server.

Jika share screen berhenti di tengah sesi, room tetap `live`, status recording
menjadi `interrupted`, dan operator dapat memulai segmen baru dengan
`operator:resume-recording`.

## Word cloud

- Jawaban dinormalisasi: NFKC, lowercase, tanda baca menjadi spasi, spasi
  dirapikan, maksimal 40 karakter. Normalisasi memakai Unicode property
  (`\p{L}`, `\p{N}`), sehingga **Mandarin dan aksara Unicode lain diterima**
  (mis. `你好`, `团队合作`).
- Frekuensi dihitung per kata/frasa.
- Layout memakai `d3-cloud` yang di-vendor di `public/vendor/`.
- `wordcloud-center.js` menjamin kata dengan frekuensi tertinggi berada tepat
  di titik tengah kanvas setelah layout selesai.
- Jika hasil layout keluar dari kanvas, seluruh cloud diperkecil secara
  seragam; posisi relatif tidak berubah.
- Urutan tie-break menggunakan alfabet, sehingga hasil deterministik.

## Persistence

| File | Isi |
| --- | --- |
| `data/credentials.json` | `adminPassword`, `sessionSecret` |
| `data/rooms.json` | Registry room + token operator |
| `data/rooms/<roomId>.json` | Snapshot state room |
| `data/archive/<file>.json` | Arsip room ended |

Penulisan memakai antrean serial per file dan atomic write (tulis file
sementara, lalu rename). Saat server berhenti, antrean di-flush.

## Batas skala

- State room ada di memory satu proses. Untuk beberapa instance, pindahkan
  state ke Redis dan gunakan `@socket.io/redis-adapter`.
- Batas default: 1.000 kata unik per room dan 150 kata dikirim ke display.
- Recording tidak membebani server karena file tetap di perangkat operator.
