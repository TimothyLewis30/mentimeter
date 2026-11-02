# Spesifikasi Teknis & Panduan Pengembangan: Real-time Word Cloud App (Mentimeter Clone)

Dokumen ini berisi spesifikasi teknis lengkap untuk membangun aplikasi kuis/poling *real-time* berbasis **Node.js** dan **HTML/CSS/JS Native**, yang mendukung beban 300–500 pengguna bersamaan, fitur Word Cloud dinamis, serta Screen Recording untuk Admin.

---

## 1. Arsitektur System & Tech Stack

*   **Backend Runtime:** Node.js (v18+ LTS)
*   **Web Framework:** Express.js
*   **Real-time Engine:** Socket.IO (WebSockets dengan fallback long-polling)
*   **Database (In-Memory / Persistence):** Redis (untuk caching/state real-time & pub-sub) + Lowdb/SQLite/MongoDB (untuk menyimpan data sesi)
*   **Frontend Admin & Audience:** Native HTML5, CSS3 (Tailwind CSS via CDN / Vanilla CSS), JavaScript (ES6+)
*   **Word Cloud Library:** `d3` & `d3-cloud` (atau `wordcloud2.js`)
*   **Screen Recording API:** Native Browser `MediaRecorder API` (`navigator.mediaDevices.getDisplayMedia`)

---

## 2. Fitur Utama & Kebutuhan Fungsional

### A. Real-time Word Cloud Engine (Audience & Display)
1. **Penerimaan Jawaban:** Peserta/Audience mengisi input teks dan mengirim jawaban.
2. **Normalisasi Kata:** System otomatis mengubah kata ke huruf kecil (*lowercase*), menghapus spasi berlebih, dan membersihkan tanda baca.
3. **Agregasi Frekuensi:** Kata yang sama dihitung jumlah kemunculannya (`frequency`).
4. **Dinamis Rendering:** 
   * Kata dengan frekuensi tertinggi otomatis bergeser ke **bagian tengah (center)**.
   * Ukuran font (*font-size*) membesar secara proporsional sesuai frekuensi kata.
   * Transisi smooth menggunakan CSS transition atau D3 layout animations.

### B. High Concurrency (300-500 Concurrent Users)
1. Socket.IO dikonfigurasi untuk menangani *burst traffic* (300-500 pengguna mengirim dalam waktu berdekatan).
2. Mekanisme **Debouncing / Throttling** pada pembaruan UI display (misal: UI Word Cloud diperbarui setiap 500ms, bukan setiap 1 milidetik) untuk menghemat CPU browser Admin/Display.

### C. Screen Record oleh Admin
1. Tombol **"Start Recording"** dan **"Stop Recording"** pada Dashboard Admin/Display.
2. Menggunakan `MediaRecorder API` browser untuk merekam tab/layar Word Cloud secara langsung tanpa server-side rendering beban tinggi.
3. Hasil rekaman dapat didownload secara lokal oleh Admin dengan format `.webm` atau `.mp4`.

---

## 3. Struktur Project (Directory Tree)

```text
menti-clone/
├── package.json
├── server.js               # Entry point Express & Socket.io server
├── public/
│   ├── index.html          # Halaman Input Jawaban (Audience/Peserta)
│   ├── display.html        # Halaman Tampilan Word Cloud (Presenter/Display)
│   ├── admin.html          # Halaman Kontrol Admin & Screen Recording
│   ├── js/
│   │   ├── audience.js     # Logic Socket & Form untuk Peserta
│   │   ├── wordcloud.js    # Logic Render D3/WordCloud & Animasi
│   │   └── recorder.js     # Logic Screen Recorder API untuk Admin
│   └── css/
│       └── style.css       # Style & Layouting
└── README.md
```

---

## 4. Implementasi Source Code Utama

### 4.1. `package.json`
```json
{
  "name": "realtime-wordcloud-app",
  "version": "1.0.0",
  "description": "Realtime Word Cloud Application like Mentimeter",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.7.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

---

### 4.2. Backend (`server.js`)
Server bertugas menerima Socket event dari 500 peserta, melacak frekuensi kata dalam memory, dan mempublikasikan data teragregasi ke tampilan display.

```javascript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  // Optimasi Socket.io untuk 500+ koneksi bersamaan
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static('public'));

// In-Memory Storage kata (Untuk skala besar bisa diganti Redis)
let wordCounts = {};

// Throttle Broadcast ke Display setiap 500ms
let isBroadcasting = false;
function queueBroadcast() {
  if (isBroadcasting) return;
  isBroadcasting = true;
  setTimeout(() => {
    io.emit('update-wordcloud', formatWordData());
    isBroadcasting = false;
  }, 500);
}

function formatWordData() {
  return Object.keys(wordCounts).map(word => ({
    text: word,
    size: wordCounts[word]
  }));
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Kirim data awal ke client yang baru terkoneksi
  socket.emit('update-wordcloud', formatWordData());

  // Tangani jawaban dari peserta
  socket.on('submit-answer', (rawAnswer) => {
    if (!rawAnswer || typeof rawAnswer !== 'string') return;

    // Cleaning & Normalisasi
    const cleanWord = rawAnswer.trim().toLowerCase().replace(/[^\w\s]/gi, '');
    if (cleanWord.length === 0) return;

    // Increment Frekuensi
    wordCounts[cleanWord] = (wordCounts[cleanWord] || 0) + 1;

    // Trigger update broadcast
    queueBroadcast();
  });

  // Event Admin Reset
  socket.on('reset-data', () => {
    wordCounts = {};
    io.emit('update-wordcloud', []);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

---

### 4.3. Halaman Peserta (`public/index.html`)
Halaman interaktif yang ringan (lightweight) agar dapat diakses dengan mulus oleh 300-500 pengguna ponsel/PC.

```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kirim Jawaban Anda</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
    .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); width: 90%; max-width: 400px; text-align: center; }
    input[type="text"] { width: 100%; padding: 12px; font-size: 16px; border: 2px solid #ddd; border-radius: 8px; box-sizing: border-box; margin-bottom: 1rem; }
    button { width: 100%; padding: 12px; background: #0066ff; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; font-weight: bold; }
    button:hover { background: #0052cc; }
    .status { margin-top: 1rem; font-size: 14px; color: #28a745; display: none; }
  </style>
</head>
<body>

  <div class="card">
    <h2>Apa kata pilihan Anda?</h2>
    <form id="answerForm">
      <input type="text" id="answerInput" placeholder="Ketik 1 kata/frasa..." maxlength="30" required autocomplete="off">
      <button type="submit">Kirim Jawaban</button>
    </form>
    <div id="status" class="status">Jawaban berhasil terkirim!</div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const form = document.getElementById('answerForm');
    const input = document.getElementById('answerInput');
    const status = document.getElementById('status');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if(val) {
        socket.emit('submit-answer', val);
        input.value = '';
        status.style.display = 'block';
        setTimeout(() => status.style.display = 'none', 2000);
      }
    });
  </script>
</body>
</html>
```

---

### 4.4. Halaman Display Word Cloud (`public/display.html`)
Halaman ini menampilkan grafik Word Cloud. Menggunakan `wordcloud2.js` CDN untuk render kata yang lebih besar & berada di tengah sesuai frekuensi.

```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Word Cloud Display</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/wordcloud2.js/1.2.2/wordcloud2.min.js"></script>
  <style>
    body { margin: 0; background-color: #1a1a2e; color: white; font-family: sans-serif; overflow: hidden; }
    #canvas-container { width: 100vw; height: 100vh; display: flex; justify-content: center; align-items: center; }
    canvas { width: 100%; height: 100%; }
  </style>
</head>
<body>

  <div id="canvas-container">
    <canvas id="wordCloudCanvas"></canvas>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const canvas = document.getElementById('wordCloudCanvas');

    function resizeCanvas() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    socket.on('update-wordcloud', (wordsData) => {
      // Format data untuk wordcloud2: [['kata', weight], ['kata2', weight2]]
      if (!wordsData || wordsData.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      // Scaling faktor ukuran kata agar responsif di layar
      const maxCount = Math.max(...wordsData.map(w => w.size));
      const list = wordsData.map(item => [item.text, item.size]);

      WordCloud(canvas, {
        list: list,
        gridSize: 8,
        weightFactor: function (size) {
          // Kata yang paling banyak otomatis membesar tajam
          return Math.pow(size, 0.7) * (canvas.width / 40);
        },
        fontFamily: 'Impact, Arial, sans-serif',
        color: 'random-light',
        backgroundColor: '#1a1a2e',
        rotateRatio: 0, // Set 0 agar semua kata rata horizontal mudah dibaca
        drawOutOfBound: false,
        shrinkToFit: true
      });
    });
  </script>
</body>
</html>
```

---

### 4.5. Halaman Admin & Screen Record (`public/admin.html`)

Halaman khusus Admin untuk memantau, mereset data, dan melakukan **Screen Recording** pada tab/layar Word Cloud secara langsung dari browser.

```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard & Screen Recorder</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #f4f6f9; }
    .btn { padding: 10px 20px; font-size: 16px; margin-right: 10px; cursor: pointer; border: none; border-radius: 5px; color: white; }
    .btn-start { background-color: #28a745; }
    .btn-stop { background-color: #dc3545; }
    .btn-reset { background-color: #ffc107; color: black; }
    .status-badge { margin-top: 15px; font-weight: bold; }
    video { margin-top: 20px; border: 2px solid #ccc; width: 100%; max-width: 600px; display: block; }
  </style>
</head>
<body>

  <h1>Admin Control & Screen Recorder</h1>

  <div>
    <button id="startRec" class="btn btn-start">🔴 Start Screen Recording</button>
    <button id="stopRec" class="btn btn-stop" disabled>⬛ Stop & Download</button>
    <button id="resetData" class="btn btn-reset">🔄 Reset Word Cloud</button>
  </div>

  <div id="status" class="status-badge">Status: Idle</div>

  <h3>Preview Hasil Rekaman:</h3>
  <video id="preview" controls></video>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    let mediaRecorder;
    let recordedChunks = [];

    const startBtn = document.getElementById('startRec');
    const stopBtn = document.getElementById('stopRec');
    const resetBtn = document.getElementById('resetData');
    const statusDiv = document.getElementById('status');
    const previewVideo = document.getElementById('preview');

    // Reset Data Event
    resetBtn.addEventListener('click', () => {
      if(confirm("Apakah Anda yakin ingin menghapus semua kata?")) {
        socket.emit('reset-data');
      }
    });

    // Screen Recording API Logic
    startBtn.addEventListener('click', async () => {
      try {
        // Minta izin merekam tab/layar browser
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { mediaSource: "tab" },
          audio: false
        });

        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunks, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          previewVideo.src = url;

          // Auto-download file rekaman
          const a = document.createElement('a');
          a.href = url;
          a.download = `wordcloud-recording-${Date.now()}.webm`;
          a.click();

          statusDiv.innerText = "Status: Rekaman Selesai & Diunduh";
          startBtn.disabled = false;
          stopBtn.disabled = true;
        };

        mediaRecorder.start();
        statusDiv.innerText = "Status: Merekam Layar...";
        startBtn.disabled = true;
        stopBtn.disabled = false;

      } catch (err) {
        console.error("Error memulainya rekaman: ", err);
      }
    });

    stopBtn.addEventListener('click', () => {
      if (mediaRecorder) {
        mediaRecorder.stop();
        // Hentikan semua track kamera/layar
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
    });
  </script>
</body>
</html>
```

---

## 5. Panduan Menjalankan & Pengujian Load Test (300–500 Users)

### A. Cara Menjalankan
1. Clone / Buat folder sesuai struktur di atas.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Jalankan Server:
   ```bash
   npm start
   ```
4. Akses URL berikut di Browser:
   * **Audience (Input):** `http://localhost:3000/`
   * **Display (Word Cloud):** `http://localhost:3000/display.html`
   * **Admin (Control & Rec):** `http://localhost:3000/admin.html`

### B. Strategi Menangani 300–500 High Concurrent Users
1. **Debounce Updates:** Pada file `server.js`, fungsi `queueBroadcast()` memastikan bahwa pembaruan data kata dikirim maksimal **2 kali dalam 1 detik (500ms)**, sehingga meminimalkan beban CPU browser rendering dan beban network.
2. **Nginx Reverse Proxy:** Jika di-deploy ke Server (VPS seperti DigitalOcean/AWS), gunakan **Nginx** sebagai reverse proxy dan pastikan opsi WebSocket Upgrade aktif:
   ```nginx
   location /socket.io/ {
       proxy_pass http://localhost:3000/socket.io/;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "Upgrade";
   }
   ```
3. **Peningkatan Limit File Descriptor OS:** Pada VPS Linux, tingkatkan limit open files agar server mampu menampung koneksi berturut-turut:
   ```bash
   ulimit -n 65536
   ```