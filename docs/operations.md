# Operasional

## Prasyarat

- Node.js **18+** (disarankan 20/22/24).
- npm.
- Browser modern dengan `MediaRecorder` dan `getDisplayMedia` untuk operator
  (Chrome, Edge, atau Firefox terbaru).
- HTTPS atau `http://localhost` agar screen recording diizinkan browser.

## Instalasi

```powershell
cd C:\Timothy\DOC\Project\mentimeter
npm install
```

`npm install` menjalankan `postinstall` → `scripts/copy-vendor.js`, yang
menyalin `d3-cloud` ke `public/vendor/`. Jika folder vendor kosong:

```powershell
npm run vendor
```

## Menjalankan

```powershell
npm start
```

Mode development dengan auto-restart:

```powershell
npm run dev
```

Port default `3000`. Jika port dipakai proses lain:

```powershell
$env:PORT='3100'
npm start
```

Saat start, server menampilkan lokasi data dan file kredensial:

```text
☁  CloudWords — Multi-Room Word Cloud
➜  Lobby        : http://localhost:3000/
➜  Super admin  : http://localhost:3000/admin
➜  Health       : http://localhost:3000/health
➜  Data         : C:\...\data
➜  Credentials  : C:\...\data\credentials.json
   (file JSON ini di-ignore git — ubah adminPassword sebelum dipakai)
```

## Kredensial

Semua kredensial server berada di `data/credentials.json`:

```json
{
  "adminPassword": "admin",
  "sessionSecret": "<64 karakter hex>"
}
```

- Dibuat otomatis saat pertama kali dijalankan.
- Default development: password `admin`.
- **Ganti `adminPassword` sebelum dipakai sungguhan**, lalu restart server.
- `sessionSecret` menandatangani token admin. Mengubahnya membuat semua sesi
  admin lama tidak valid.
- File ditulis dengan mode `0600` di Linux/macOS. Di Windows, akses mengikuti
  ACL folder.
- `NODE_ENV=production` menolak start jika tidak ada password admin di file
  maupun environment.
- File rusak **tidak** ditimpa diam-diam; server gagal start dengan pesan yang
  jelas.

Prioritas nilai:

1. Override eksplisit (hanya test)
2. Environment (`ADMIN_PASSWORD`, `SESSION_SECRET`)
3. File JSON
4. Default development

Environment tidak mengubah isi file. Untuk perubahan permanen, edit JSON.

Lokasi file bisa dipindah:

```powershell
$env:CREDENTIALS_FILE='C:\secrets\cloudwords.json'
npm start
```

## Konfigurasi environment

| Variable | Default | Keterangan |
| --- | --- | --- |
| `PORT` | `3000` | Port HTTP/Socket.IO |
| `NODE_ENV` | `development` | `production` mewajibkan password admin |
| `DATA_DIR` | `./data` | Folder data JSON |
| `CREDENTIALS_FILE` | `<DATA_DIR>/credentials.json` | Lokasi kredensial |
| `ADMIN_PASSWORD` | dari file / `admin` (dev) | Override password admin |
| `SESSION_SECRET` | dari file / acak | Override secret token admin |
| `BROADCAST_INTERVAL` | `500` | Interval broadcast word cloud (ms, min. 100) |
| `CORS_ORIGIN` | `*` | Origin Socket.IO yang diizinkan |

## Alur demo cepat

1. Buka `http://localhost:3000/admin`.
2. Login dengan password dari `data/credentials.json`.
3. Klik **+ Buat room**, isi nama dan pertanyaan.
4. Salin **link operator + token** dari kartu room.
5. Buka link display di layar room.
6. Bagikan link peserta.
7. Di perangkat operator, buka **Admin Room** (`/operator`), tempel link
   operator, lalu klik **Buka Admin Room**.
8. Klik **Mulai & rekam**, pilih tab **Display**.
9. Peserta mengirim jawaban; word cloud tampil live.
10. Klik **Akhiri sesi**; rekaman berhenti dan file terunduh.

## Recording

- Berjalan di perangkat operator, bukan di server.
- Operator harus memilih tab **Display** saat browser meminta izin.
- Start hanya sah jika `recording.active === true`; server menolak start tanpa
  rekaman.
- Jika izin dibatalkan, room tetap `waiting`.
- Jika share screen berhenti di tengah sesi, room tetap `live`; status recording
  menjadi `interrupted`. Klik **Lanjutkan rekaman** untuk segmen baru.
- File tidak di-upload. Nama file memuat nama room dan nomor segmen.

## Production

1. Ganti password admin di `data/credentials.json`.
2. Jalankan dengan `NODE_ENV=production`.
3. Letakkan di belakang reverse proxy HTTPS.
4. Pastikan WebSocket upgrade diteruskan.

Contoh Nginx:

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

Untuk VPS Linux dengan banyak peserta:

```bash
ulimit -n 65536
```

## Backup dan pemulihan

File yang perlu dibackup:

| File | Prioritas |
| --- | --- |
| `data/credentials.json` | Tinggi — simpan di tempat aman |
| `data/rooms.json` | Tinggi — berisi token operator |
| `data/rooms/*.json` | Sedang — snapshot room |
| `data/archive/*.json` | Sedang — arsip sesi selesai |

Jangan menyimpan backup di dalam repository publik. Jika `sessionSecret`
hilang, token admin lama tidak valid; buat sesi admin baru. Jika
`adminPassword` hilang, edit file atau set `ADMIN_PASSWORD`.

## GitHub dan `.gitignore`

Saat ini folder project **belum menjadi repository git**. Sebelum push:

```powershell
git init
git add .
git status
```

Pastikan yang ter-stage **tidak** memuat:

- `data/credentials.json`
- `data/rooms.json`
- `data/rooms/*.json`
- `data/archive/*.json`
- `.env`

`.gitignore` sudah meng-ignore semua pola tersebut. `package.json` dan
`package-lock.json` tetap ikut.

Jika file sensitif telanjur ter-commit:

```bash
git rm --cached data/credentials.json data/rooms.json data/rooms/*.json
git commit -m "Hapus kredensial dan data runtime dari repository"
```

Setelah itu **ganti password admin dan session secret**, karena nilai lama harus
dianggap bocor. Regenerate token operator dari `/admin` bila perlu.

Checklist sebelum push:

- [ ] `npm test` lulus.
- [ ] `data/credentials.json` tidak muncul di `git status`.
- [ ] Password default `admin` sudah diganti.
- [ ] Tidak ada token operator di dokumentasi/screenshot.
- [ ] `node_modules/` tidak ter-stage.
- [ ] File `.env` tidak ada atau sudah di-ignore.

## Troubleshooting

| Masalah | Solusi |
| --- | --- |
| `ADMIN_PASSWORD belum di-set` | Buat `data/credentials.json` atau set `ADMIN_PASSWORD` |
| Login admin gagal | Cek `adminPassword`; environment menimpa file |
| File kredensial rusak | Perbaiki JSON atau hapus file; server tidak menimpa diam-diam |
| Token operator tidak valid | Minta link terbaru; Superadmin bisa regenerate token |
| Room tidak bisa start | Pastikan recording aktif dan izin screen share diberikan |
| Peserta tidak bisa menjawab | Room harus `live`, bukan `waiting`/`ended` |
| Word cloud kosong | Pastikan room live dan jawaban masuk; cek `/health` |
| `d3-cloud tidak tersedia` | Jalankan `npm run vendor`, lalu reload display |
| Port 3000 dipakai | `$env:PORT='3100'; npm start` |
| Recording tidak didukung | Gunakan Chrome/Edge/Firefox via `localhost` atau HTTPS |
| Rekaman terputus | Room tetap live; klik **Lanjutkan rekaman** |
| Data lama muncul setelah restart | Room waiting/ended dipulihkan; hapus file `data/` jika ingin bersih |
| Load test banyak ditolak | Pastikan room live dan interval minimal 750 ms |
