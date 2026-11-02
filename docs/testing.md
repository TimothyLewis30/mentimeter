# Testing

## Test otomatis

```powershell
npm test
```

Perintah menjalankan seluruh `test/*.test.js` dengan `node:test`.

| File | Cakupan |
| --- | --- |
| `test/auth.test.js` | Verifikasi password, token admin, rate limiter |
| `test/credentials.test.js` | Loader JSON, create/reload, env override, production, file rusak, `CREDENTIALS_FILE` |
| `test/repository.test.js` | Atomic write, registry, snapshot, arsip, file rusak |
| `test/rooms.test.js` | Lifecycle waiting/live/ended, reset, resume recording, restart, delete, normalisasi Mandarin |
| `test/server.test.js` | Login admin, `/api/rooms` tanpa token, isolasi dua room, takeover operator, admin watcher, route halaman, navbar hanya Superadmin, jawaban Mandarin |
| `test/wordcloud-center.test.js` | Kata teratas tepat di tengah, tie-break, scaling |
| `test/recorder.test.js` | Nama file rekaman per room/segmen |

Hasil terakhir: **51 test lulus, 0 gagal**.

Menjalankan satu file:

```powershell
node --test test/server.test.js
```

## Load test

Script `scripts/load-test.js` membuka banyak koneksi peserta ke **satu room**.

```powershell
# Room harus sudah live
npm run loadtest -- --room r_2d845ea3a4

# Script memulai room lewat token operator, lalu mengirim jawaban
npm run loadtest -- --room r_2d845ea3a4 --token <operatorToken>

# 500 peserta, 2 jawaban masing-masing
npm run loadtest -- --room r_2d845ea3a4 --token <token> --clients 500 --messages 2
```

| Opsi | Default | Keterangan |
| --- | --- | --- |
| `--url` | `http://localhost:3000` | Target server |
| `--room` | wajib | ID room target |
| `--token` | — | Token operator; bila diisi, room otomatis dimulai |
| `--clients` | `300` | Jumlah koneksi (maks. 2000) |
| `--messages` | `5` | Jawaban per client |
| `--interval` | `800` | Jeda antar jawaban (min. 750 ms) |
| `--settle` | `1200` | Jeda setelah connect |
| `--help` | — | Bantuan |

Contoh hasil verifikasi:

```text
Terhubung         : 5
Gagal koneksi     : 0
Jawaban diterima  : 10
Ditolak (validasi): 0
Timeout / error   : 0
Latency ack p50   : 4.5 ms
Latency ack p95   : 63.4 ms
```

Gunakan room demo/kosong karena jawaban load test masuk ke word cloud room
tersebut.

## Checklist verifikasi manual

Jalankan server di port bebas, misalnya:

```powershell
$env:PORT='3100'
npm start
```

### Halaman dan menu

- [ ] `/` tidak menampilkan navbar atau tautan ke Admin Room/Superadmin.
- [ ] `/display` dan `/join` menampilkan pemilih room tanpa navbar.
- [ ] `/room/<id>` dan `/display/<id>` tidak menampilkan navbar.
- [ ] `/operator` menampilkan form link operator tanpa navbar.
- [ ] `/admin` dan `/superadmin` menampilkan navbar lengkap:
      **Lobby · Display · Isi Jawaban · Admin Room · Superadmin**.
- [ ] Navbar Superadmin menandai halaman aktif.
- [ ] `/room` redirect `302` ke `/join`.
- [ ] Pertanyaan room hanya bisa dibuat/diubah dari Superadmin.

### Superadmin

- [ ] Login dengan password dari `data/credentials.json` berhasil.
- [ ] Password salah menghasilkan `401`.
- [ ] Membuat room menghasilkan status `waiting`.
- [ ] Kartu room menampilkan link Peserta, Display, Operator.
- [ ] Tombol **Admin Room ↗** membuka link operator + token.
- [ ] `GET /api/rooms` tidak memuat `operatorToken`.
- [ ] Preview read-only tidak bisa start/end.

### Admin Room dan recording

- [ ] Menempel link operator di `/operator` mengarah ke `/operator/<roomId>`.
- [ ] Link tanpa token atau path salah menampilkan pesan error.
- [ ] Room `waiting` belum menerima jawaban.
- [ ] **Mulai & rekam** meminta izin screen share.
- [ ] Membatalkan izin membuat room tetap `waiting`.
- [ ] Setelah recording aktif, room menjadi `live` dan form peserta aktif.
- [ ] Dua room live tidak saling bocor jawaban.
- [ ] **Akhiri sesi** menghentikan room dan recording.
- [ ] Room `ended` menolak jawaban baru.

### Word cloud

- [ ] Satu kata berada tepat di tengah.
- [ ] Kata dengan frekuensi tertinggi berada tepat di tengah.
- [ ] Frekuensi berdekatan (mis. 5, 4, 4) tetap menempatkan pemenang di tengah.
- [ ] Cloud mengecil seragam jika keluar kanvas.
- [ ] Jawaban Mandarin diterima dan tampil, mis. `你好` dan `团队合作`.

### Keamanan data

- [ ] `data/credentials.json` tidak ter-track git.
- [ ] `data/rooms.json` dan snapshot room tidak ter-track.
- [ ] `.env` tidak ter-track.
- [ ] `node_modules/` tidak ter-track.

## Verifikasi `.gitignore`

Pola sudah diuji di repository git sementara:

| File | Ter-ignore? |
| --- | --- |
| `data/credentials.json` | Ya |
| `data/rooms.json` | Ya |
| `data/rooms/r_x.json` | Ya |
| `.env` | Ya |
| `package.json` | Tidak |

## Catatan

- Test server memakai direktori data sementara dan port acak, sehingga tidak
  mengganggu data development.
- Test tidak memerlukan browser. Recording diuji pada level logika/nama file,
  bukan capture layar sungguhan.
- Untuk menguji recording end-to-end, gunakan browser nyata di
  `http://localhost` atau HTTPS.
