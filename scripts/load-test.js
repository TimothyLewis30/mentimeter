'use strict';

/**
 * Load test multi-room untuk mengukur performa satu room saat 300-500 peserta
 * mengirim jawaban hampir bersamaan.
 *
 * Pemakaian:
 *   npm run loadtest -- --room <roomId>
 *   npm run loadtest -- --room <roomId> --token <operatorToken>
 *   npm run loadtest -- --room <roomId> --clients 500 --messages 5 --interval 800
 *   npm run loadtest -- --url http://localhost:3000 --room <roomId> --token <token>
 *
 * Tanpa --token, room harus sudah live (operator sudah menekan Mulai & rekam).
 * Dengan --token, script membuka koneksi operator, memulai room (recording
 * dianggap aktif untuk keperluan load test), lalu menjalankan client peserta.
 *
 * Hati-hati: jawaban load test masuk ke word cloud room tersebut. Gunakan
 * room demo/kosong, bukan room acara yang sedang dipakai.
 */

const { io } = require('socket.io-client');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const body = arg.slice(2);
    const eq = body.indexOf('=');

    if (eq !== -1) {
      args[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[body] = argv[i + 1];
      i += 1;
    } else {
      args[body] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.log(`
CloudWords load test (multi-room)

  --url <url>           URL server (default: http://localhost:3000)
  --room <roomId>       ID room target, wajib (contoh: r_2d845ea3a4)
  --token <token>       Token operator; bila diisi, room otomatis dimulai
  --clients <n>         Jumlah koneksi peserta (default: 300)
  --messages <n>        Jawaban per client (default: 5)
  --interval <ms>       Jeda antar jawaban per client (default: 800)
  --settle <ms>         Jeda setelah connect sebelum mulai kirim (default: 1200)
  --help                Tampilkan bantuan ini

Contoh:
  npm run loadtest -- --room r_2d845ea3a4
  npm run loadtest -- --room r_2d845ea3a4 --token <operatorToken>
  npm run loadtest -- --room r_1bd2bf3ee7 --clients 500 --messages 2

Room ID dan token operator bisa disalin dari kartu room di /admin.
`);
  process.exit(0);
}

const URL = String(args.url || process.env.URL || 'http://localhost:3000').replace(/\/+$/, '');
const ROOM_ID = String(args.room || process.env.ROOM_ID || '').trim();
const ROOM_TOKEN = String(args.token || process.env.ROOM_TOKEN || '').trim();
const CLIENTS = Math.max(1, Math.min(2000, Number(args.clients) || 300));
const MESSAGES = Math.max(1, Math.min(50, Number(args.messages) || 5));
const INTERVAL = Math.max(750, Number(args.interval) || 800);
const SETTLE = Math.max(0, Math.min(10000, Number(args.settle ?? 1200)));
const TIMEOUT_MS = 120000;

if (!ROOM_ID) {
  console.error('  ✖ --room <roomId> wajib diisi. Lihat npm run loadtest -- --help');
  process.exit(1);
}

const WORDS = [
  'kolaborasi',
  'inovasi',
  'seru',
  'menantang',
  'inspiratif',
  'cepat',
  'kreatif',
  'teamwork',
  'menyenangkan',
  'produktif',
  'solutif',
  'fokus',
  'ceria',
  'solid',
  'berkembang',
  'komunikasi',
  'optimis',
  'luar biasa',
  'mudah',
  'bermanfaat',
];

const results = {
  connected: 0,
  connectionFailed: 0,
  accepted: 0,
  rejected: 0,
  timeoutOrError: 0,
  latencies: [],
};

const activeSockets = new Set();
const startedAt = Date.now();
let finishedClients = 0;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize() {
  const elapsed = (Date.now() - startedAt) / 1000;
  const latencies = results.latencies.slice().sort((a, b) => a - b);

  console.log('');
  console.log('─'.repeat(58));
  console.log('  HASIL LOAD TEST');
  console.log('─'.repeat(58));
  console.log(`  Target            : ${URL}`);
  console.log(`  Room              : ${ROOM_ID}`);
  console.log(`  Clients           : ${CLIENTS}`);
  console.log(`  Jawaban / client  : ${MESSAGES}`);
  console.log(`  Interval          : ${INTERVAL} ms`);
  console.log(`  Settle            : ${SETTLE} ms`);
  console.log(`  Durasi total      : ${elapsed.toFixed(2)} s`);
  console.log('');
  console.log(`  Terhubung         : ${results.connected}`);
  console.log(`  Gagal koneksi     : ${results.connectionFailed}`);
  console.log(`  Jawaban diterima  : ${results.accepted}`);
  console.log(`  Ditolak (validasi): ${results.rejected}`);
  console.log(`  Timeout / error   : ${results.timeoutOrError}`);
  console.log('');
  console.log(`  Latency ack p50   : ${percentile(latencies, 50).toFixed(1)} ms`);
  console.log(`  Latency ack p95   : ${percentile(latencies, 95).toFixed(1)} ms`);
  console.log(`  Latency ack p99   : ${percentile(latencies, 99).toFixed(1)} ms`);
  console.log(`  Latency ack max   : ${(latencies[latencies.length - 1] || 0).toFixed(1)} ms`);
  console.log('─'.repeat(58));
  console.log(`  Tips: buka /display/${ROOM_ID} untuk melihat word cloud room ini.`);
  console.log('');
}

function connectRoom(auth) {
  return new Promise((resolve, reject) => {
    const socket = io(`${URL}/room`, {
      auth,
      transports: ['websocket'],
      reconnection: false,
      timeout: 10000,
      forceNew: true,
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Timeout koneksi'));
    }, 12000);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

function ack(socket, event, payload, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout ack ${event}`)), timeout);
    const done = (response) => {
      clearTimeout(timer);
      resolve(response);
    };
    if (payload === undefined) socket.emit(event, done);
    else socket.emit(event, payload, done);
  });
}

async function ensureLiveRoom() {
  if (!ROOM_TOKEN) {
    console.log('  Token operator tidak diberikan; menganggap room sudah live.');
    return null;
  }

  console.log('  Memulai room lewat token operator…');
  const operator = await connectRoom({
    roomId: ROOM_ID,
    role: 'operator',
    token: ROOM_TOKEN,
  });
  activeSockets.add(operator);

  try {
    const response = await ack(operator, 'operator:start', {
      recording: {
        active: true,
        mimeType: 'video/webm',
        startedAt: Date.now(),
        ownerId: 'load-test',
        segment: 1,
      },
    });
    if (!response || !response.ok) {
      throw new Error(
        (response && response.message) || 'Server menolak memulai room.'
      );
    }
    if (response.room && response.room.status) {
      console.log(`  Room ${ROOM_ID} sekarang: ${response.room.status}.`);
    }
    return operator;
  } catch (error) {
    operator.disconnect();
    activeSockets.delete(operator);
    throw error;
  }
}

function runClient(index) {
  return new Promise((resolve) => {
    let socket;
    try {
      socket = io(`${URL}/room`, {
        auth: { roomId: ROOM_ID, role: 'audience' },
        transports: ['websocket'],
        reconnection: false,
        timeout: 10000,
        forceNew: true,
      });
    } catch (error) {
      results.connectionFailed += 1;
      finishedClients += 1;
      resolve();
      return;
    }

    activeSockets.add(socket);

    let answered = 0;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      finishedClients += 1;
      clearTimeout(watchdog);
      activeSockets.delete(socket);
      socket.disconnect();
      resolve();
    };

    const sendNext = () => {
      if (finished) return;

      if (answered >= MESSAGES) {
        finish();
        return;
      }

      const word = WORDS[(index * 3 + answered * 7) % WORDS.length];
      const sentAt = process.hrtime.bigint();

      socket.timeout(10000).emit('submit-answer', word, (err, response) => {
        if (finished) return;

        const receivedAt = process.hrtime.bigint();
        results.latencies.push(Number(receivedAt - sentAt) / 1e6);

        if (err) {
          results.timeoutOrError += 1;
        } else if (response && response.ok) {
          results.accepted += 1;
        } else {
          results.rejected += 1;
        }

        answered += 1;
        setTimeout(sendNext, INTERVAL);
      });
    };

    const watchdog = setTimeout(() => {
      if (!finished) {
        results.connectionFailed += 1;
        finish();
      }
    }, TIMEOUT_MS);

    socket.on('connect', () => {
      results.connected += 1;
      setTimeout(sendNext, SETTLE + 120 + (index % 12) * 25);
    });

    socket.on('connect_error', (error) => {
      results.connectionFailed += 1;
      const code = error && error.data && error.data.code;
      if (code === 'ROOM_NOT_FOUND') {
        console.error(`  ✖ Room ${ROOM_ID} tidak ditemukan di ${URL}.`);
      }
      finish();
    });
  });
}

async function main() {
  console.log('');
  console.log('  ☁  CloudWords Load Test');
  console.log(`  Room ${ROOM_ID} · ${CLIENTS} koneksi ke ${URL}`);
  console.log('');

  let operator = null;
  try {
    operator = await ensureLiveRoom();
  } catch (error) {
    console.error(`  ✖ Gagal menyiapkan room: ${error.message}`);
    process.exit(1);
  }

  const progress = setInterval(() => {
    console.log(
      `  progress: ${finishedClients}/${CLIENTS} selesai · ` +
        `${results.connected} terhubung · ${results.accepted} jawaban diterima`
    );
  }, 2000);

  const clients = Array.from({ length: CLIENTS }, (_, index) => runClient(index));

  try {
    await Promise.all(clients);
  } finally {
    clearInterval(progress);
    for (const socket of activeSockets) socket.disconnect();
    if (operator) operator.disconnect();
    summarize();
  }

  const expected = CLIENTS * MESSAGES;
  if (results.accepted < expected * 0.95) {
    console.warn(
      `  ⚠ Hanya ${results.accepted}/${expected} jawaban diterima. ` +
        'Pastikan room live, cek log server, atau naikkan interval.'
    );
    process.exitCode = 1;
  }
}

process.on('SIGINT', () => {
  console.log('\n  Load test dihentikan.');
  for (const socket of activeSockets) socket.disconnect();
  process.exit(1);
});

main().catch((err) => {
  console.error('Load test gagal:', err);
  process.exit(1);
});
