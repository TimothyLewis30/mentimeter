'use strict';

/**
 * Menyalin build browser d3-cloud dari node_modules ke public/vendor,
 * supaya halaman display bisa render word cloud tanpa CDN (tetap jalan offline).
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'node_modules', 'd3-cloud', 'build', 'd3.layout.cloud.js');
const license = path.join(root, 'node_modules', 'd3-cloud', 'LICENSE');
const vendorDir = path.join(root, 'public', 'vendor');

try {
  if (!fs.existsSync(source)) {
    throw new Error('d3-cloud belum terinstall. Jalankan "npm install" terlebih dahulu.');
  }

  fs.mkdirSync(vendorDir, { recursive: true });
  fs.copyFileSync(source, path.join(vendorDir, 'd3.layout.cloud.js'));

  if (fs.existsSync(license)) {
    fs.copyFileSync(license, path.join(vendorDir, 'd3-cloud.LICENSE'));
  }

  console.log('[vendor] d3-cloud disalin ke public/vendor/d3.layout.cloud.js');
} catch (err) {
  console.warn(`[vendor] Dilewati: ${err.message}`);
  process.exitCode = 0;
}
