'use strict';

/**
 * WordCloudRenderer
 * -----------------
 * Render word cloud di <canvas> memakai d3-cloud (di-vendor ke public/vendor).
 *
 * Fitur:
 *  - Ukuran font proporsional terhadap frekuensi (kata tersering paling besar).
 *  - Layout ulang otomatis saat data berubah / canvas di-resize.
 *  - Animasi interpolasi posisi, ukuran, dan opacity (requestAnimationFrame).
 *  - Kata dengan frekuensi tertinggi ditempatkan lebih dulu sehingga berada
 *    di area tengah (spiral Archimedean).
 *  - Warna stabil per kata + penekanan untuk 3 kata teratas.
 */

(function () {
  const PALETTE = [
    '#ff5c9d',
    '#a78bfa',
    '#38bdf8',
    '#5eead4',
    '#fbbf24',
    '#fb7185',
    '#c084fc',
    '#34d399',
    '#f472b6',
    '#60a5fa',
  ];

  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const colorCache = new Map();

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function parseColor(color) {
    if (colorCache.has(color)) return colorCache.get(color);

    let rgb = [255, 255, 255];
    if (typeof color === 'string') {
      if (color.startsWith('#')) {
        const hex = color.slice(1);
        if (hex.length === 3) {
          rgb = [
            parseInt(hex[0] + hex[0], 16),
            parseInt(hex[1] + hex[1], 16),
            parseInt(hex[2] + hex[2], 16),
          ];
        } else if (hex.length >= 6) {
          rgb = [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
          ];
        }
      } else {
        const match = color.match(/rgba?\(([^)]+)\)/i);
        if (match) {
          const parts = match[1].split(',').map((part) => Number(part.trim()));
          if (parts.length >= 3 && parts.every((part) => Number.isFinite(part))) {
            rgb = parts.slice(0, 3);
          }
        }
      }
    }

    const safe = rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))));
    colorCache.set(color, safe);
    return safe;
  }

  function mixColor(from, to, t) {
    const a = parseColor(from);
    const b = parseColor(to);
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgb(${r}, ${g}, ${bl})`;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /** PRNG deterministik supaya layout tidak "melompat" tiap update. */
  function createRandom(seed) {
    let state = seed >>> 0;
    return function random() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class WordCloudRenderer {
    constructor(canvas, options = {}) {
      if (!canvas) throw new Error('Canvas untuk word cloud tidak ditemukan.');

      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.options = options;

      this.fontFamily = options.fontFamily || 'Segoe UI, system-ui, -apple-system, sans-serif';
      this.padding = Number.isFinite(options.padding) ? options.padding : 5;
      this.maxWords = Math.max(1, Number(options.maxWords) || 80);
      this.maxFontCap = Math.max(24, Number(options.maxFontCap) || 170);
      this.duration = Number.isFinite(options.duration)
        ? Math.max(0, options.duration)
        : prefersReducedMotion
          ? 0
          : 900;

      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.words = [];
      this.current = new Map();
      this.lastDataKey = '';
      this.layoutToken = 0;
      this.layoutTimer = null;
      this.animationFrame = null;
      this.resizeTimer = null;
      this.destroyed = false;

      this._onWindowResize = this._onWindowResize.bind(this);
      this.resize();
      this.drawSnapshot();

      window.addEventListener('resize', this._onWindowResize, { passive: true });

      if (typeof ResizeObserver === 'function' && canvas.parentElement) {
        this.resizeObserver = new ResizeObserver(this._onWindowResize);
        this.resizeObserver.observe(canvas.parentElement);
      }
    }

    _onWindowResize() {
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        if (this.destroyed) return;
        const changed = this.resize();
        if (changed && this.words.length) {
          this.drawSnapshot();
          this.scheduleLayout(0);
        }
      }, 140);
    }

    resize() {
      const parent = this.canvas.parentElement || this.canvas;
      const rect = parent.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (width === this.width && height === this.height && dpr === this.dpr) {
        return false;
      }

      this.width = width;
      this.height = height;
      this.dpr = dpr;

      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      return true;
    }

    /**
     * @param {{text: string, size: number}[]} rawWords
     */
    setData(rawWords) {
      if (this.destroyed) return;

      const words = (Array.isArray(rawWords) ? rawWords : [])
        .filter(
          (item) =>
            item &&
            typeof item.text === 'string' &&
            item.text.trim().length > 0 &&
            Number.isFinite(Number(item.size)) &&
            Number(item.size) > 0
        )
        .map((item) => ({ text: item.text.trim(), size: Number(item.size) }))
        .sort((a, b) => b.size - a.size || a.text.localeCompare(b.text))
        .slice(0, this.maxWords);

      const key = JSON.stringify(words);
      if (key === this.lastDataKey) return;

      this.lastDataKey = key;
      this.words = words;

      if (!words.length) {
        this.layoutToken += 1;
        this.clear();
        return;
      }

      this.scheduleLayout(120);
    }

    scheduleLayout(delay = 120) {
      if (this.layoutTimer) clearTimeout(this.layoutTimer);
      this.layoutTimer = setTimeout(() => {
        this.layoutTimer = null;
        this.runLayout();
      }, delay);
    }

    computeFontSizes(words) {
      const width = this.width;
      const height = this.height;
      const count = words.length;
      const counts = words.map((word) => word.size);
      const minCount = Math.min(...counts);
      const maxCount = Math.max(...counts);

      const base = Math.min(width * 0.155, height * 0.21, this.maxFontCap);
      const crowd = Math.min(1, Math.sqrt(24 / Math.max(12, count)));
      const maxFont = Math.max(24, base * crowd);
      const minFont = Math.max(11, Math.min(width, height) * 0.017);

      if (maxCount === minCount) {
        const mid = minFont + (maxFont - minFont) * 0.42;
        return words.map(() => mid);
      }

      const sqrtMax = Math.sqrt(maxCount);
      return words.map((word) => {
        const ratio = Math.pow(Math.sqrt(word.size) / sqrtMax, 1.25);
        return Math.max(minFont, minFont + (maxFont - minFont) * ratio);
      });
    }

    runLayout(attempt = 0, scale = 1) {
      if (this.destroyed || !this.words.length || this.width < 20 || this.height < 20) {
        return;
      }

      const cloudFactory =
        window.d3 && window.d3.layout && typeof window.d3.layout.cloud === 'function'
          ? window.d3.layout.cloud
          : null;

      if (!cloudFactory) {
        console.warn('[wordcloud] d3-cloud tidak tersedia. Memakai layout fallback.');
        this.renderFallback();
        return;
      }

      const token = (this.layoutToken += 1);
      const words = this.words;
      const fontSizes = this.computeFontSizes(words);

      const data = words.map((word, index) => ({
        text: word.text,
        count: word.size,
        rank: index,
        fontSize: fontSizes[index] * scale,
      }));

      const layout = cloudFactory()
        .size([this.width, this.height])
        .words(data)
        .padding(this.padding)
        .rotate(0)
        .font(this.fontFamily)
        .fontWeight(800)
        .fontSize((item) => item.fontSize)
        .spiral('archimedean')
        .random(createRandom(20240517))
        .on('end', (placed) => {
          if (token !== this.layoutToken || this.destroyed) return;

          const wanted = Math.min(words.length, Math.max(6, Math.ceil(words.length * 0.65)));
          if (placed.length < wanted && attempt < 2) {
            this.runLayout(attempt + 1, scale * 0.85);
            return;
          }

          this.applyLayout(placed);
        });

      layout.start();
    }

    colorFor(item) {
      if (item.rank === 0) return '#ffffff';
      if (item.rank === 1) return '#ffd166';
      if (item.rank === 2) return '#5eead4';
      return PALETTE[hashString(item.text) % PALETTE.length];
    }

    /**
     * Geser seluruh cloud agar kata peringkat 0 berada di (0, 0), lalu
     * kecilkan seragam bila ada kata yang keluar kanvas.
     */
    centerTopWord(placed) {
      const helper = window.WordCloudCenter;
      if (!helper || typeof helper.centerTopWord !== 'function' || !Array.isArray(placed)) {
        return;
      }

      for (const item of placed) {
        this.ctx.font = `800 ${Math.max(1, item.size)}px ${this.fontFamily}`;
        const metrics = this.ctx.measureText(item.text || '');
        item.width = Number.isFinite(metrics.width) ? metrics.width : 0;
        item.height = Math.max(1, Number(item.size) || 0) * 1.1;
      }

      helper.centerTopWord(placed, {
        width: this.width,
        height: this.height,
        margin: Math.max(8, this.padding + 4),
      });
    }

    applyLayout(placed) {
      if (this.destroyed) return;

      // Jaminan keras: kata peringkat pertama tepat di tengah kanvas.
      this.centerTopWord(placed);

      const target = new Map();

      for (const item of placed) {
        target.set(item.text, {
          text: item.text,
          x: item.x + this.width / 2,
          y: item.y + this.height / 2,
          size: Math.max(8, item.size),
          rotate: item.rotate || 0,
          color: this.colorFor(item),
          alpha: 1,
        });
      }

      // Kata yang hilang dari data: fade out di posisi terakhirnya.
      for (const [text, current] of this.current) {
        if (!target.has(text)) {
          target.set(text, { ...current, alpha: 0 });
        }
      }

      const start = new Map();
      for (const [text, end] of target) {
        const current = this.current.get(text);
        if (current) {
          start.set(text, { ...current });
        } else {
          start.set(text, {
            text: end.text,
            x: this.width / 2,
            y: this.height / 2,
            size: end.size * 0.45,
            rotate: end.rotate,
            color: end.color,
            alpha: 0,
          });
        }
      }

      this.animateTo(start, target);
    }

    animateTo(start, target) {
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }

      const duration = this.duration;
      const startedAt = performance.now();

      const step = (now) => {
        if (this.destroyed) return;

        const raw = duration <= 0 ? 1 : Math.min(1, (now - startedAt) / duration);
        const t = easeOutCubic(raw);

        const frame = new Map();
        for (const [text, end] of target) {
          const from = start.get(text) || end;
          frame.set(text, {
            text: end.text,
            x: from.x + (end.x - from.x) * t,
            y: from.y + (end.y - from.y) * t,
            size: from.size + (end.size - from.size) * t,
            rotate: (from.rotate || 0) + ((end.rotate || 0) - (from.rotate || 0)) * t,
            color: mixColor(from.color, end.color, t),
            alpha: from.alpha + (end.alpha - from.alpha) * t,
          });
        }

        this.current = frame;
        this.draw(frame);

        if (raw < 1) {
          this.animationFrame = requestAnimationFrame(step);
        } else {
          this.animationFrame = null;
          const settled = new Map();
          for (const [text, end] of target) {
            if (end.alpha > 0.01) settled.set(text, { ...end });
          }
          this.current = settled;
        }
      };

      this.animationFrame = requestAnimationFrame(step);
    }

    draw(frame) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const list = [...frame.values()].sort((a, b) => b.size - a.size);

      for (const item of list) {
        if (item.alpha <= 0.01 || item.size < 1) continue;

        ctx.globalAlpha = item.alpha;
        ctx.font = `800 ${item.size}px ${this.fontFamily}`;
        ctx.fillStyle = item.color;

        if (item.size > 44) {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
          ctx.shadowBlur = Math.min(26, item.size * 0.22);
          ctx.shadowOffsetY = Math.max(1, item.size * 0.02);
        } else {
          ctx.shadowBlur = 0;
          ctx.shadowOffsetY = 0;
        }

        if (item.rotate) {
          ctx.save();
          ctx.translate(item.x, item.y);
          ctx.rotate((item.rotate * Math.PI) / 180);
          ctx.fillText(item.text, 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(item.text, item.x, item.y);
        }
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }

    drawSnapshot() {
      if (!this.current.size) {
        this.ctx.clearRect(0, 0, this.width, this.height);
        return;
      }
      this.draw(this.current);
    }

    clear() {
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
      this.current.clear();
      this.ctx.clearRect(0, 0, this.width, this.height);
    }

    /** Fallback sederhana bila file d3-cloud gagal dimuat. */
    renderFallback() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const words = this.words.slice(0, 40);
      const sizes = this.computeFontSizes(words);
      let x = 16;
      let y = 28;

      for (let i = 0; i < words.length; i += 1) {
        const fontSize = Math.max(12, Math.min(42, sizes[i]));
        ctx.font = `800 ${fontSize}px ${this.fontFamily}`;
        const textWidth = ctx.measureText(words[i].text).width;

        if (x + textWidth > this.width - 16 && x > 16) {
          x = 16;
          y += 44;
        }
        if (y > this.height - 20) break;

        ctx.fillStyle = this.colorFor({ rank: i, text: words[i].text });
        ctx.fillText(words[i].text, x + textWidth / 2, y);
        x += textWidth + 26;
      }
    }

    destroy() {
      this.destroyed = true;
      if (this.layoutTimer) clearTimeout(this.layoutTimer);
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
      window.removeEventListener('resize', this._onWindowResize);
      if (this.resizeObserver) this.resizeObserver.disconnect();
    }
  }

  window.WordCloudRenderer = WordCloudRenderer;
})();
