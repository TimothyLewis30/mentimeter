'use strict';

/**
 * WordCloudCenter
 * ---------------
 * Jaminan posisi: kata dengan frekuensi tertinggi selalu tepat di tengah
 * kanvas, berapa pun hasil penempatan d3-cloud.
 *
 * Koordinat layout d3-cloud memakai origin (0, 0) di tengah kanvas. Helper ini:
 *  1. menggeser SELURUH layout sehingga kata peringkat 0 berada di (0, 0);
 *  2. bila hasil geser membuat ada kata keluar kanvas, mengecilkan seluruh
 *     layout secara seragam (posisi + ukuran) sampai semuanya masuk.
 *
 * Pergeseran tidak mengubah jarak antarkata, jadi tidak menimbulkan overlap
 * baru. Penskalaan juga seragam, sehingga proporsi ukuran tetap terjaga.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WordCloudCenter = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
  }

  function findTopWord(placed) {
    if (!Array.isArray(placed) || placed.length === 0) return null;

    let top = null;
    for (const item of placed) {
      if (!item || !isFiniteNumber(item.x) || !isFiniteNumber(item.y)) continue;
      if (!top || Number(item.rank) < Number(top.rank)) top = item;
    }
    return top;
  }

  function halfExtents(placed) {
    let halfWidth = 0;
    let halfHeight = 0;

    for (const item of placed) {
      const width = isFiniteNumber(item.width) ? Math.abs(Number(item.width)) : 0;
      const height = isFiniteNumber(item.height) ? Math.abs(Number(item.height)) : 0;
      halfWidth = Math.max(halfWidth, Math.abs(Number(item.x) || 0) + width / 2);
      halfHeight = Math.max(halfHeight, Math.abs(Number(item.y) || 0) + height / 2);
    }

    return { halfWidth, halfHeight };
  }

  /**
   * @param {Array<{x:number,y:number,size:number,rank:number,width?:number,height?:number}>} placed
   * @param {{width?:number,height?:number,margin?:number}} [options]
   * @returns {boolean} true jika ada layout yang diproses
   */
  function centerTopWord(placed, options = {}) {
    const top = findTopWord(placed);
    if (!top) return false;

    const dx = -(Number(top.x) || 0);
    const dy = -(Number(top.y) || 0);
    for (const item of placed) {
      item.x = (Number(item.x) || 0) + dx;
      item.y = (Number(item.y) || 0) + dy;
    }

    const width = Number(options.width);
    const height = Number(options.height);
    if (!(width > 0) || !(height > 0)) return true;

    const margin = Number.isFinite(Number(options.margin)) ? Math.max(0, Number(options.margin)) : 0;
    const allowedX = Math.max(1, width / 2 - margin);
    const allowedY = Math.max(1, height / 2 - margin);
    const { halfWidth, halfHeight } = halfExtents(placed);

    const scaleX = halfWidth > allowedX ? allowedX / halfWidth : 1;
    const scaleY = halfHeight > allowedY ? allowedY / halfHeight : 1;
    const scale = Math.min(1, scaleX, scaleY);

    if (scale < 1 && scale > 0) {
      for (const item of placed) {
        item.x = (Number(item.x) || 0) * scale;
        item.y = (Number(item.y) || 0) * scale;
        if (isFiniteNumber(item.size)) item.size = Number(item.size) * scale;
        if (isFiniteNumber(item.width)) item.width = Number(item.width) * scale;
        if (isFiniteNumber(item.height)) item.height = Number(item.height) * scale;
      }
    }

    // Kata teratas tetap di (0, 0) setelah skala karena posisinya nol.
    top.x = 0;
    top.y = 0;

    return true;
  }

  return { centerTopWord };
});
