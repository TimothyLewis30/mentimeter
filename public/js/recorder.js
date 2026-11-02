'use strict';

/**
 * ScreenRecorder
 * --------------
 * Merekam tab/layar browser memakai MediaRecorder API (tanpa render server-side).
 *
 * - Memilih codec terbaik yang didukung browser (VP9/VP8 WebM, fallback MP4).
 * - Auto-download file hasil rekaman (.webm / .mp4).
 * - Berhenti otomatis jika user menghentikan share screen dari browser.
 */

(function () {
  const MIME_CANDIDATES = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
  ];

  function pickMimeType() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }
    for (const type of MIME_CANDIDATES) {
      try {
        if (MediaRecorder.isTypeSupported(type)) return type;
      } catch (err) {
        /* ignore */
      }
    }
    return '';
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (value) => String(value).padStart(2, '0');
    return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, index);
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function normalizePrefix(value) {
    if (typeof value !== 'string') return '';
    return value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  function buildFilename(prefix, mimeType, date = new Date()) {
    const extension = String(mimeType || '').includes('mp4') ? 'mp4' : 'webm';
    const stamp = date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    return `${normalizePrefix(prefix) || 'wordcloud-recording'}-${stamp}.${extension}`;
  }

  class ScreenRecorder {
    constructor(options = {}) {
      this.onStateChange = options.onStateChange || function () {};
      this.onPreview = options.onPreview || function () {};
      this.onError = options.onError || function () {};
      this.onTick = options.onTick || function () {};
      this.onDownload = options.onDownload || function () {};

      this.filenamePrefix = normalizePrefix(options.filenamePrefix) || 'wordcloud-recording';

      this.state = 'idle';
      this.mediaRecorder = null;
      this.stream = null;
      this.chunks = [];
      this.blob = null;
      this.url = null;
      this.filename = '';
      this.mimeType = '';
      this.startedAt = 0;
      this.timer = null;
      this.autoStopped = false;
      this._trackEndedHandler = null;
    }

    static isSupported() {
      return Boolean(
        typeof navigator !== 'undefined' &&
          navigator.mediaDevices &&
          typeof navigator.mediaDevices.getDisplayMedia === 'function' &&
          typeof MediaRecorder !== 'undefined'
      );
    }

    static formatDuration(ms) {
      return formatDuration(ms);
    }

    static formatBytes(bytes) {
      return formatBytes(bytes);
    }

    setFilenamePrefix(prefix) {
      this.filenamePrefix = normalizePrefix(prefix) || 'wordcloud-recording';
    }

    static buildFilename(prefix, mimeType, date) {
      return buildFilename(prefix, mimeType, date);
    }

    isRecording() {
      return this.state === 'recording';
    }

    elapsed() {
      return this.startedAt ? Math.max(0, Date.now() - this.startedAt) : 0;
    }

    setState(state, extra = {}) {
      this.state = state;
      this.onStateChange({
        state,
        elapsed: this.elapsed(),
        mimeType: (this.mediaRecorder && this.mediaRecorder.mimeType) || this.mimeType,
        ...extra,
      });
    }

    async start() {
      if (this.state === 'recording' || this.state === 'starting') return false;

      if (!ScreenRecorder.isSupported()) {
        const error = new Error(
          'Browser ini tidak mendukung screen recording (MediaRecorder / getDisplayMedia).'
        );
        this.onError(error);
        throw error;
      }

      this.releasePrevious();
      this.setState('starting');

      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 30, max: 60 },
            displaySurface: 'browser',
          },
          audio: false,
          // Hints untuk Chrome (diabaikan browser lain):
          selfBrowserSurface: 'include',
          surfaceSwitching: 'include',
          systemAudio: 'exclude',
        });
      } catch (err) {
        this.setState('idle');
        this.onError(err);
        throw err;
      }

      this.stream = stream;
      this.mimeType = pickMimeType();

      try {
        const recorderOptions = { videoBitsPerSecond: 4500000 };
        if (this.mimeType) recorderOptions.mimeType = this.mimeType;

        try {
          this.mediaRecorder = new MediaRecorder(stream, recorderOptions);
        } catch (err) {
          // Sebagian browser menolak opsi mimeType/videoBitsPerSecond tertentu.
          this.mediaRecorder = new MediaRecorder(stream);
        }
      } catch (err) {
        this.stopTracks();
        this.setState('idle');
        this.onError(err);
        throw err;
      }

      this.chunks = [];
      this.autoStopped = false;
      this.startedAt = Date.now();

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.finalize();
      };

      this.mediaRecorder.onerror = (event) => {
        this.onError((event && event.error) || new Error('Terjadi kesalahan saat merekam.'));
      };

      this._trackEndedHandler = () => {
        if (this.state === 'recording') {
          this.autoStopped = true;
          this.stop();
        }
      };

      stream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', this._trackEndedHandler);
      });

      try {
        this.mediaRecorder.start(1000);
      } catch (err) {
        this.stopTracks();
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.mediaRecorder = null;
        this.startedAt = 0;
        this.setState('idle');
        this.onError(err);
        throw err;
      }

      this.setState('recording');
      this.onTick(0);
      this.timer = setInterval(() => {
        this.onTick(this.elapsed());
      }, 250);

      return true;
    }

    stop() {
      if (this.state !== 'recording' && this.state !== 'starting') return;

      this.setState('stopping');

      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }

      const recorder = this.mediaRecorder;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch (err) {
          console.warn('[recorder] Gagal menghentikan recorder:', err);
          this.finalize();
        }
      } else {
        this.finalize();
      }

      this.stopTracks();
    }

    finalize() {
      if (this.state === 'stopped') return;

      this.stopTracks();

      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }

      const elapsed = this.elapsed();
      const mimeType =
        (this.mediaRecorder && this.mediaRecorder.mimeType) || this.mimeType || 'video/webm';

      if (!this.chunks.length) {
        this.setState('idle');
        this.onError(new Error('Rekaman kosong — tidak ada data yang terekam.'));
        this.startedAt = 0;
        this.mediaRecorder = null;
        return;
      }

      this.blob = new Blob(this.chunks, { type: mimeType });
      this.mimeType = mimeType;

      this.filename = buildFilename(this.filenamePrefix, mimeType);

      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(this.blob);

      this.chunks = [];
      this.mediaRecorder = null;
      this.startedAt = 0;

      this.onPreview({
        url: this.url,
        blob: this.blob,
        filename: this.filename,
        mimeType,
        size: this.blob.size,
        duration: elapsed,
      });

      this.setState('stopped', { elapsed, autoStopped: this.autoStopped });
      this.triggerDownload();
    }

    triggerDownload() {
      if (!this.url || !this.filename) return;

      try {
        const link = document.createElement('a');
        link.href = this.url;
        link.download = this.filename;
        link.rel = 'noopener';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        this.onDownload({ filename: this.filename, size: this.blob ? this.blob.size : 0 });
      } catch (err) {
        console.warn('[recorder] Auto-download gagal, gunakan tombol unduh manual.', err);
      }
    }

    stopTracks() {
      if (this._trackEndedHandler && this.stream) {
        this.stream.getTracks().forEach((track) => {
          try {
            track.removeEventListener('ended', this._trackEndedHandler);
          } catch (err) {
            /* ignore */
          }
        });
      }

      if (this.stream) {
        this.stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (err) {
            /* ignore */
          }
        });
        this.stream = null;
      }

      this._trackEndedHandler = null;
    }

    releasePrevious() {
      if (this.url) {
        URL.revokeObjectURL(this.url);
        this.url = null;
      }
      this.blob = null;
      this.filename = '';
    }

    dispose() {
      this.stop();
      this.releasePrevious();
    }
  }

  if (typeof window !== 'undefined') window.ScreenRecorder = ScreenRecorder;
  if (typeof module === 'object' && module.exports) {
    module.exports = { ScreenRecorder, buildFilename, normalizePrefix };
  }
})();
