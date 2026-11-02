'use strict';

/** Dashboard operator satu room: start, rekam, end, resume. */
(function () {
  const UI = window.UI;
  const roomId = UI.roomIdFromPath();
  const tokenKey = `cloudwords:operator:${roomId}`;

  const connectionPill = document.getElementById('connectionPill');
  const connectionText = document.getElementById('connectionText');
  const authPill = document.getElementById('authPill');
  const authError = document.getElementById('authError');
  const supersededBanner = document.getElementById('supersededBanner');
  const supersededTitle = document.getElementById('supersededTitle');
  const supersededText = document.getElementById('supersededText');
  const recordingWarning = document.getElementById('recordingWarning');
  const operatorGrid = document.getElementById('operatorGrid');
  const operatorRoomName = document.getElementById('operatorRoomName');
  const operatorRoomId = document.getElementById('operatorRoomId');
  const roomBadge = document.getElementById('roomBadge');
  const controlTag = document.getElementById('controlTag');
  const startButton = document.getElementById('startButton');
  const endButton = document.getElementById('endButton');
  const resumeButton = document.getElementById('resumeButton');
  const resetButton = document.getElementById('resetButton');
  const participantLink = document.getElementById('participantLink');
  const displayLink = document.getElementById('displayLink');
  const openDisplayLink = document.getElementById('openDisplayLink');
  const copyParticipant = document.getElementById('copyParticipant');
  const copyDisplay = document.getElementById('copyDisplay');
  const recBadge = document.getElementById('recBadge');
  const recStatus = document.getElementById('recStatus');
  const recTimer = document.getElementById('recTimer');
  const preview = document.getElementById('preview');
  const downloadLink = document.getElementById('downloadLink');
  const statParticipants = document.getElementById('statParticipants');
  const statAnswers = document.getElementById('statAnswers');
  const statUnique = document.getElementById('statUnique');
  const statTopWord = document.getElementById('statTopWord');
  const topWordsList = document.getElementById('topWordsList');
  const uniqueCount = document.getElementById('uniqueCount');
  const activityList = document.getElementById('activityList');
  const footerRoomQuestion = document.getElementById('footerRoomQuestion');

  if (!roomId) {
    window.location.replace('/');
    return;
  }

  const REC_LABELS = {
    idle: 'Siap',
    starting: 'Meminta izin',
    recording: 'Merekam',
    stopping: 'Menyelesaikan',
    interrupted: 'Terputus',
    unknown: 'Tidak terpantau',
    stopped: 'Selesai',
  };

  let token = '';
  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get('token');
  if (tokenFromUrl) {
    token = tokenFromUrl;
    try {
      sessionStorage.setItem(tokenKey, token);
    } catch (err) {
      /* ignore storage failures */
    }
    // Jangan biarkan token tertinggal di address bar atau riwayat.
    window.history.replaceState(null, '', window.location.pathname);
  } else {
    try {
      token = sessionStorage.getItem(tokenKey) || '';
    } catch (err) {
      token = '';
    }
  }

  const state = {
    ready: false,
    roomStatus: 'waiting',
    serverRecording: null,
    segment: 0,
    ownerId: createOwnerId(),
    superseded: false,
    ending: false,
    starting: false,
    suppressInterrupt: false,
    isController: true,
    room: null,
  };

  function createOwnerId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `owner-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function slugify(value) {
    return String(value || 'room')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'room';
  }

  let recorder = null;
  try {
    recorder = new window.ScreenRecorder({
      filenamePrefix: `cloudwords-${slugify(roomId)}-part1`,
      onStateChange: handleRecorderState,
      onPreview: handlePreview,
      onError: handleRecorderError,
      onTick: (elapsed) => {
        recTimer.textContent = window.ScreenRecorder.formatDuration(elapsed);
      },
      onDownload: (file) => {
        UI.toast(`Rekaman diunduh: ${file.filename}`, 'success', 6000);
      },
    });
  } catch (err) {
    console.error('[operator] Recorder tidak tersedia:', err);
  }

  if (!recorder || !window.ScreenRecorder.isSupported()) {
    startButton.disabled = true;
    startButton.textContent = 'Recording tidak didukung browser ini';
  }

  if (!token) {
    showAuthError('Link operator tidak memuat token. Minta link operator baru dari super admin.');
  } else {
    authPill.dataset.state = 'ok';
    authPill.textContent = 'Operator terautentikasi';
  }

  const socket = token
    ? io('/room', {
        auth: { roomId, role: 'operator', token },
        reconnection: true,
        reconnectionAttempts: 20,
      })
    : null;

  function showAuthError(message) {
    authError.hidden = false;
    authPill.dataset.state = 'error';
    authPill.textContent = 'Tidak terautentikasi';
    operatorGrid.classList.add('is-disabled');
    if (message) {
      const paragraph = authError.querySelector('p');
      if (paragraph) paragraph.textContent = message;
    }
  }

  function showSuperseded(title, message) {
    state.superseded = true;
    supersededBanner.hidden = false;
    supersededTitle.textContent = title;
    supersededText.textContent = message;
    operatorGrid.classList.add('is-disabled');
    startButton.disabled = true;
    endButton.disabled = true;
    resumeButton.disabled = true;
    resetButton.disabled = true;
  }

  function updateControls() {
    const live = state.roomStatus === 'live';
    const waiting = state.roomStatus === 'waiting';
    const ended = state.roomStatus === 'ended';
    const busy = state.starting;
    const blocked = state.superseded || !state.ready || !token || !state.isController;

    startButton.hidden = !waiting;
    startButton.disabled = blocked || busy || !recorder;
    startButton.textContent = busy ? 'Menyiapkan rekaman…' : '● Mulai & rekam';

    endButton.hidden = !live;
    endButton.disabled = blocked || busy || state.ending;

    resetButton.hidden = !waiting;
    resetButton.disabled = blocked || busy;

    const recStatusValue = state.serverRecording && state.serverRecording.status;
    const needsResume = live && recStatusValue !== 'recording' && !state.ending && !state.superseded;
    resumeButton.hidden = !needsResume;
    resumeButton.disabled = blocked || busy;
    resumeButton.textContent = busy ? 'Menyiapkan rekaman…' : '● Lanjutkan rekaman';

    recordingWarning.hidden = !needsResume;
  }

  function setRoomStatus(status) {
    state.roomStatus = status;
    roomBadge.className = `status-badge status-badge--${status}`;
    roomBadge.textContent = UI.statusLabel(status);
    controlTag.textContent = status === 'live' ? 'Live' : status === 'ended' ? 'Selesai' : 'Waiting';
    updateControls();
  }

  function setRecorderBadge(localState, extra = {}) {
    let value = localState || 'idle';
    if (value === 'idle' && state.serverRecording && state.serverRecording.status) {
      value = state.serverRecording.status;
    }

    recBadge.dataset.state = value;
    recBadge.textContent = REC_LABELS[value] || 'Siap';
    recStatus.textContent = `Status: ${REC_LABELS[value] || 'Siap'}`;

    if (extra && Number.isFinite(extra.elapsed)) {
      recTimer.textContent = window.ScreenRecorder.formatDuration(extra.elapsed);
    }
  }

  function handleRecorderState(payload) {
    if (!recorder) return;
    setRecorderBadge(recorder.state, payload);

    if (payload && payload.state === 'stopped' && !state.suppressInterrupt) {
      if (state.roomStatus === 'live' && !state.superseded && !state.ending) {
        emitRecordingStatus('interrupted');
        UI.toast('Share screen berhenti. Room tetap live — lanjutkan rekaman bila perlu.', 'warning', 6000);
      }
    }
    if (payload && payload.state === 'recording') {
      state.serverRecording = { ...(state.serverRecording || {}), status: 'recording' };
    }
    updateControls();
  }

  function handlePreview(file) {
    if (!preview) return;
    preview.src = file.url;
    preview.hidden = false;
    if (downloadLink) {
      downloadLink.href = file.url;
      downloadLink.download = file.filename;
      downloadLink.textContent = `Unduh rekaman (${window.ScreenRecorder.formatBytes(file.size)})`;
      downloadLink.hidden = false;
    }
  }

  function handleRecorderError(error) {
    if (!error) return;
    const name = error.name || '';
    if (name === 'NotAllowedError' || name === 'AbortError') {
      UI.toast('Izin screen share dibatalkan. Room tetap menunggu.', 'warning');
      return;
    }
    if (name === 'NotFoundError') {
      UI.toast('Tidak ada layar/tab yang dipilih. Room tetap menunggu.', 'warning');
      return;
    }
    UI.toast(error.message || 'Terjadi kesalahan pada rekaman.', 'error', 6000);
  }

  function emitRecordingStatus(status) {
    if (!socket || !socket.connected) return;
    socket.emit('operator:recording', {
      status,
      ownerId: state.ownerId,
      segment: state.segment || undefined,
    });
  }

  function stopRecorderForEnd() {
    if (!recorder) return;
    state.suppressInterrupt = true;
    if (recorder.isRecording() || recorder.state === 'starting') {
      recorder.stop();
    }
  }

  function updateRoomMeta(room) {
    if (!room) return;
    state.room = room;
    operatorRoomName.textContent = room.name || 'Room';
    operatorRoomId.textContent = room.id || roomId;
    document.title = `${room.name || 'Room'} — Operator CloudWords`;
    footerRoomQuestion.textContent = room.question || '—';

    const links = UI.roomLinks({ ...room, id: room.id || roomId });
    participantLink.textContent = links.participant;
    displayLink.textContent = links.display;
    openDisplayLink.href = links.display;
  }

  function updateStats(stats) {
    if (!stats) return;
    statParticipants.textContent = UI.formatNumber(stats.participants);
    statAnswers.textContent = UI.formatNumber(stats.totalAnswers);
    statUnique.textContent = UI.formatNumber(stats.uniqueWords);
    uniqueCount.textContent = `${UI.formatNumber(stats.uniqueWords)} unik`;
    statTopWord.textContent = stats.topWord ? stats.topWord.text : '—';
  }

  function setPrefix(segment) {
    if (!recorder) return;
    const name = state.room ? state.room.name : roomId;
    recorder.setFilenamePrefix(`cloudwords-${slugify(name)}-part${segment}`);
  }

  async function startRoom() {
    if (!recorder || state.starting || state.superseded) return;
    state.starting = true;
    state.suppressInterrupt = false;
    state.segment = 1;
    setPrefix(1);
    updateControls();

    try {
      await recorder.start();
    } catch (err) {
      state.starting = false;
      updateControls();
      setRecorderBadge('idle');
      return;
    }

    socket.timeout(8000).emit(
      'operator:start',
      {
        recording: {
          active: true,
          mimeType: recorder.mimeType,
          startedAt: Date.now(),
          ownerId: state.ownerId,
          segment: 1,
        },
      },
      (err, response) => {
        state.starting = false;
        if (err || !response || !response.ok) {
          state.suppressInterrupt = true;
          if (recorder.isRecording()) recorder.stop();
          else setRecorderBadge('idle');
          UI.toast(
            (response && response.message) || 'Server menolak memulai room. Rekaman dihentikan.',
            'error',
            6000
          );
          updateControls();
          return;
        }
        setRoomStatus('live');
        state.serverRecording = { status: 'recording', segment: 1 };
        updateControls();
      }
    );
  }

  async function resumeRecording() {
    if (!recorder || state.starting || state.roomStatus !== 'live' || state.superseded) return;
    state.starting = true;
    state.suppressInterrupt = false;
    const nextSegment = Math.max(
      Number(state.segment) || 0,
      Number(state.serverRecording && state.serverRecording.segment) || 0
    ) + 1;
    state.segment = nextSegment;
    setPrefix(nextSegment);
    updateControls();

    try {
      await recorder.start();
    } catch (err) {
      state.starting = false;
      updateControls();
      return;
    }

    socket.timeout(8000).emit(
      'operator:resume-recording',
      {
        recording: {
          active: true,
          mimeType: recorder.mimeType,
          startedAt: Date.now(),
          ownerId: state.ownerId,
          segment: nextSegment,
        },
      },
      (err, response) => {
        state.starting = false;
        if (err || !response || !response.ok) {
          state.suppressInterrupt = true;
          if (recorder.isRecording()) recorder.stop();
          UI.toast((response && response.message) || 'Gagal melanjutkan rekaman.', 'error', 6000);
          updateControls();
          return;
        }
        state.serverRecording = { status: 'recording', segment: nextSegment };
        updateControls();
        UI.toast(`Rekaman segmen ${nextSegment} berjalan.`, 'success');
      }
    );
  }

  function endRoom() {
    if (state.roomStatus !== 'live' || state.ending) return;
    if (!window.confirm('Akhiri sesi ini? Peserta tidak bisa mengirim jawaban lagi dan rekaman akan diunduh.')) {
      return;
    }

    state.ending = true;
    updateControls();

    socket.timeout(5000).emit('operator:end', {}, (err, response) => {
      if (err || !response || !response.ok) {
        UI.toast(
          'Rekaman dihentikan, tetapi server belum mengonfirmasi End. Sesi mungkin masih live — coba lagi setelah tersambung.',
          'error',
          8000
        );
      }
      stopRecorderForEnd();
      updateControls();
    });
  }

  function resetAnswers() {
    if (state.roomStatus !== 'waiting') {
      UI.toast('Reset hanya bisa dilakukan saat room menunggu.', 'warning');
      return;
    }
    if (!window.confirm('Kosongkan semua jawaban di room ini?')) return;

    socket.timeout(5000).emit('reset-data', {}, (err, response) => {
      if (err || !response || !response.ok) {
        UI.toast((response && response.message) || 'Gagal mereset jawaban.', 'error');
        return;
      }
      UI.toast('Word cloud dikosongkan.', 'success');
    });
  }

  function handleInit(payload) {
    if (!payload || !payload.room) return;

    state.ready = true;
    state.isController = payload.isController !== false;
    state.segment = Number(payload.recording && payload.recording.segment) || 0;
    state.serverRecording = payload.recording || null;
    state.ending = false;
    state.starting = false;

    updateRoomMeta(payload.room);
    setRoomStatus(payload.room.status);
    setRecorderBadge(recorder ? recorder.state : 'idle');

    if (payload.words) UI.renderWordBars(topWordsList, payload.words, { emptyText: 'Belum ada jawaban.' });
    if (payload.stats) updateStats(payload.stats);
    if (payload.recent) UI.renderActivity(activityList, payload.recent);

    if (payload.room.status === 'ended') {
      state.suppressInterrupt = true;
      if (recorder && (recorder.isRecording() || recorder.state === 'starting')) recorder.stop();
      endButton.hidden = true;
      startButton.hidden = true;
      resumeButton.hidden = true;
    } else if (payload.room.status === 'live') {
      // Laporkan status recorder sebenarnya setelah reconnect / reload.
      if (recorder && recorder.isRecording()) {
        emitRecordingStatus('recording');
      } else if (state.serverRecording && state.serverRecording.status === 'recording') {
        emitRecordingStatus('interrupted');
      }
    }

    updateControls();
  }

  if (socket) {
    socket.on('connect', () => {
      UI.setConnection(connectionPill, 'online', 'Terhubung');
      authPill.dataset.state = 'ok';
      authPill.textContent = 'Operator terautentikasi';
    });

    socket.on('disconnect', () => {
      UI.setConnection(connectionPill, 'offline', 'Menyambung ulang…');
    });

    socket.on('connect_error', (error) => {
      const code = error && error.data && error.data.code;
      UI.setConnection(connectionPill, 'offline', 'Koneksi gagal');

      if (code === 'INVALID_TOKEN' || code === 'UNAUTHORIZED') {
        showAuthError('Token operator tidak valid atau sudah dicabut. Minta link operator baru dari super admin.');
        if (authError.scrollIntoView) authError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        socket.disconnect();
      } else if (code === 'ROOM_NOT_FOUND') {
        showAuthError('Room tidak ditemukan atau sudah dihapus.');
        socket.disconnect();
      }
    });

    socket.on('room:init', handleInit);

    socket.on('room:status', (payload) => {
      if (!payload) return;
      state.serverRecording = payload.recording || state.serverRecording;
      setRoomStatus(payload.status);

      if (payload.status === 'ended') {
        state.ending = true;
        stopRecorderForEnd();
        setRecorderBadge(recorder ? recorder.state : 'stopped');
        UI.toast('Sesi berakhir. Rekaman dihentikan dan diunduh.', 'success', 6000);
      }
      updateControls();
    });

    socket.on('recording:update', (recording) => {
      state.serverRecording = recording || null;
      if (recording && Number(recording.segment) > 0) state.segment = Number(recording.segment);
      setRecorderBadge(recorder ? recorder.state : 'idle');
      updateControls();
    });

    socket.on('room:meta', (payload) => {
      if (!payload) return;
      if (state.room) {
        if (payload.name) state.room.name = payload.name;
        if (payload.question) state.room.question = payload.question;
      }
      updateRoomMeta(state.room);
    });

    socket.on('update-wordcloud', (words) => {
      UI.renderWordBars(topWordsList, words, { emptyText: 'Belum ada jawaban.' });
    });

    socket.on('stats:update', updateStats);

    socket.on('activity:new', (entry) => {
      if (!entry || !entry.text) return;
      const existing = [...activityList.querySelectorAll('.activity-item__text')].map((el) => el.textContent);
      const item = UI.createElement('li', 'activity-item');
      const dot = UI.createElement('span', 'activity-item__dot');
      dot.setAttribute('aria-hidden', 'true');
      item.append(
        dot,
        UI.createElement('span', 'activity-item__text', entry.text),
        UI.createElement('span', 'activity-item__time', UI.formatTime(entry.at))
      );
      activityList.querySelector('.muted')?.remove();
      activityList.prepend(item);
      while (activityList.children.length > 12) activityList.lastElementChild.remove();
      if (existing.length === 0) item.classList.add('is-new');
    });

    socket.on('operator:superseded', () => {
      showSuperseded(
        'Sesi operator diambil alih',
        'Tab/perangkat operator lain menjadi pengendali room ini. Rekaman di tab ini dihentikan dan diunduh.'
      );
      stopRecorderForEnd();
      socket.disconnect();
    });

    socket.on('operator:revoked', () => {
      showSuperseded(
        'Akses operator dicabut',
        'Admin membuat token operator baru. Rekaman di tab ini dihentikan dan diunduh. Minta link operator terbaru dari admin.'
      );
      stopRecorderForEnd();
      socket.disconnect();
    });

    socket.on('room:deleted', () => {
      showSuperseded('Room dihapus', 'Room ini telah dihapus oleh admin.');
      stopRecorderForEnd();
      socket.disconnect();
    });
  }

  if (copyParticipant) {
    copyParticipant.addEventListener('click', async () => {
      const ok = await UI.copyText(participantLink.textContent);
      UI.toast(ok ? 'Link peserta disalin.' : 'Gagal menyalin link peserta.', ok ? 'success' : 'error');
    });
  }

  if (copyDisplay) {
    copyDisplay.addEventListener('click', async () => {
      const ok = await UI.copyText(displayLink.textContent);
      UI.toast(ok ? 'Link display disalin.' : 'Gagal menyalin link display.', ok ? 'success' : 'error');
    });
  }

  startButton.addEventListener('click', startRoom);
  resumeButton.addEventListener('click', resumeRecording);
  endButton.addEventListener('click', endRoom);
  resetButton.addEventListener('click', resetAnswers);

  window.addEventListener('beforeunload', (event) => {
    if (recorder && recorder.isRecording()) {
      event.preventDefault();
      event.returnValue = 'Rekaman masih berjalan. Menutup tab akan menghentikan rekaman.';
      return event.returnValue;
    }
    return undefined;
  });

  updateControls();
})();
