# Peran dan Menu

## Aturan navigasi

- **Navbar hanya ada di halaman Superadmin** (`/admin` dan `/superadmin`).
- Navbar Superadmin memuat semua tautan:
  **Lobby · Display · Isi Jawaban · Admin Room · Superadmin**.
- Halaman publik berikut **tidak** memiliki navbar dan tidak memiliki tautan ke
  Admin Room atau Superadmin:
  - Lobby `/`
  - Pemilih Display `/display`
  - Pemilih Peserta `/join`
  - Waiting room / form jawaban `/room/<id>`
  - Display `/display/<id>`
- Halaman **Admin Room** (`/operator`, `/operator/<id>`) juga tidak memiliki
  navbar. Halaman ini hanya bisa dibuka lewat link operator + token.
- Superadmin diakses lewat URL langsung `/admin` atau `/superadmin`.

Tujuannya: peserta dan display tidak bisa menemukan atau mengetahui jalur admin
dari halaman yang mereka pakai.

## Pertanyaan room

**Pertanyaan hanya dibuat dan diubah oleh Superadmin.** Operator room tidak
memiliki editor pertanyaan. Perubahan pertanyaan yang dilakukan Superadmin
langsung diteruskan ke display dan form peserta melalui event `room:meta`.

## Ringkasan peran

| Peran | Halaman | Bisa start/end? | Bisa rekam? | Bisa kelola room/pertanyaan? |
| --- | --- | --- | --- | --- |
| Peserta | `/join` → `/room/<id>` | Tidak | Tidak | Tidak |
| Display | `/display` → `/display/<id>` | Tidak | Tidak | Tidak |
| Admin Room (operator) | `/operator` → `/operator/<id>?token=...` | **Ya** | **Ya** | Tidak |
| Superadmin | `/admin` | Tidak | Tidak | **Ya** |
| Admin watcher | preview di `/admin` | Tidak | Tidak | Read-only |

## Peserta

1. Buka `/join` (bisa dari link yang dibagikan).
2. Pilih room.
3. Waiting room menampilkan status dan pertanyaan dari Superadmin.
4. Setelah operator memulai, form jawaban aktif otomatis.
5. Kirim satu kata/frasa; jawaban muncul di word cloud.

Peserta tidak bisa mengirim jawaban sebelum room `live`. Jika room `ended`,
form diganti pesan penutup.

## Display

1. Buka `/display` atau link display yang dibagikan.
2. Pilih room.
3. Display menampilkan pertanyaan, word cloud, dan statistik room.

Display adalah permukaan pasif: tidak ada tombol start, end, atau rekam. Saat
operator diminta memilih layar untuk direkam, pilih tab display ini.

## Admin Room (operator)

Admin Room adalah satu-satunya tempat untuk mengontrol sesi dan merekam layar.

### Mendapatkan akses

Superadmin menyalin **link operator + token** dari kartu room di `/admin`:

```text
http://localhost:3000/operator/r_xxxxxxxxxx?token=<token-rahasia>
```

Link ini hanya untuk perangkat operator. Siapa pun yang memegang token dapat
mengendalikan room.

### Dua cara membuka

- **Langsung:** buka link operator lengkap.
- **Lewat halaman entry:** buka `/operator`, tempel link, klik
  **Buka Admin Room**. `operator-entry.js` memvalidasi bentuk link lalu
  mengarahkan ke halaman operator.

Halaman `/operator` tidak menautkan ke Superadmin. Jika operator belum punya
link, teks bantuan hanya menyuruh menghubungi Superadmin secara langsung.

### Kontrol sesi

- **Mulai & rekam** — meminta izin screen share, merekam tab Display, lalu
  mengaktifkan room.
- **Akhiri sesi** — menghentikan room dan recording; file rekaman diunduh.
- **Lanjutkan rekaman** — membuat segmen baru setelah share screen terputus.
- **Reset jawaban** — hanya tersedia saat room `waiting`.

Jika izin screen share dibatalkan, room tetap `waiting` dan peserta belum bisa
menjawab.

### Kepemilikan controller

Hanya satu operator yang menjadi controller per room. Jika operator lain
membuka link yang sama, koneksi lama menerima `operator:superseded`, rekamannya
dihentikan, dan controller berpindah ke koneksi baru. Jika Superadmin
meregenerasi token, operator lama menerima `operator:revoked`.

## Superadmin

Superadmin login di `/admin` dengan password dari `data/credentials.json`
(environment `ADMIN_PASSWORD` menimpa file).

Yang bisa dilakukan:

- membuat room baru **beserta pertanyaannya**;
- mengedit nama/pertanyaan saat room `waiting`;
- menghapus room yang tidak sedang live;
- menyalin link peserta, display, dan operator;
- membuka **Admin Room ↗** langsung dari kartu room;
- meregenerasi token operator;
- melihat preview word cloud read-only;
- memakai navbar lengkap ke semua halaman.

Yang **tidak** bisa dilakukan:

- memulai atau mengakhiri sesi;
- merekam layar;
- mengirim jawaban sebagai peserta.

Pemisahan ini disengaja: Superadmin mengelola room dan pertanyaan, operator room
memegang kendali sesi dan rekaman.

## Tabel URL lengkap

| URL | Keterangan | Navbar? |
| --- | --- | --- |
| `/` | Lobby | Tidak |
| `/display` | Pemilih room untuk display | Tidak |
| `/display/<roomId>` | Display room | Tidak |
| `/join` | Pemilih room untuk peserta | Tidak |
| `/room/<roomId>` | Waiting room / form jawaban | Tidak |
| `/room` | Redirect ke `/join` | — |
| `/operator` | Entry link operator | Tidak |
| `/operator/<roomId>?token=...` | Kontrol room + recording | Tidak |
| `/admin`, `/superadmin` | Superadmin | **Ya** |
| `/api/rooms` | Daftar room publik tanpa token | — |
| `/health` | Status server | — |
