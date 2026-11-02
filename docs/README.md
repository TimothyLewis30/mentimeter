# Dokumentasi CloudWords

Dokumentasi teknis dan operasional aplikasi word cloud multi-room CloudWords.

## Daftar dokumen

| Dokumen | Isi |
| --- | --- |
| [architecture.md](architecture.md) | Arsitektur server, frontend, isolasi room, lifecycle, word cloud, recording |
| [roles-and-menus.md](roles-and-menus.md) | Peran, menu wajib, URL, alur Admin Room dan Superadmin |
| [api-and-events.md](api-and-events.md) | Endpoint HTTP, namespace Socket.IO, event, payload, autentikasi |
| [operations.md](operations.md) | Instalasi, kredensial, menjalankan, deployment, backup, troubleshooting |
| [testing.md](testing.md) | Test otomatis, load test, checklist verifikasi manual |

Dokumen ringkas untuk pengguna baru ada di [`../README.md`](../README.md).
Desain multi-room yang menjadi acuan ada di
[`superpowers/specs/2026-10-28-multi-room-design.md`](superpowers/specs/2026-10-28-multi-room-design.md).

## Prinsip utama

1. **Satu room = satu display + satu operator + banyak peserta.** Setiap room
   memiliki pertanyaan, word count, status, dan rekaman sendiri.
2. **Isolasi ketat.** Broadcast memakai channel per room; jawaban tidak pernah
   dikirim ke room lain.
3. **Hanya operator room yang boleh start/end.** Superadmin mengelola room dan
   pertanyaan, tetapi tidak bisa memulai atau mengakhiri sesi.
4. **Navbar hanya ada di Superadmin.** Halaman publik dan Admin Room tidak
   menautkan ke Superadmin.
5. **Room live hanya setelah rekaman berjalan.** Jika izin screen share
   dibatalkan, room tetap `waiting`.
6. **Kredensial dan data runtime adalah file JSON yang di-ignore git.**
   `data/credentials.json`, `data/rooms.json`, snapshot room, dan arsip tidak
   boleh masuk repository.
7. **Kata dengan frekuensi tertinggi selalu tepat di tengah** kanvas, termasuk
   saat hanya ada satu kata atau saat frekuensi teratas berdekatan.
8. **Input Unicode, termasuk Mandarin, diterima** dan dinormalisasi tanpa
   membuang karakter Han.

## Status verifikasi

- `npm test` — **51 test lulus**.
- Verifikasi runtime: lobby, `/display`, `/join`, `/operator`, `/admin`,
  `/superadmin`, redirect `/room` → `/join`, login admin, alur tempel link
  operator, dan navbar hanya di Superadmin sudah diuji.
- Input Mandarin (`你好`, `团队合作`) diuji di unit test dan jalur jawaban server.
- Load test nyata: 5 peserta × 2 jawaban = **10/10 diterima**, tanpa error.
- `.gitignore` diuji di repository git sementara: seluruh JSON data/kredensial
  ter-ignore, `package.json` tetap ter-track.
