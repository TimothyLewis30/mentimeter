'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildFilename, normalizePrefix } = require('../public/js/recorder');

const date = new Date('2026-10-28T10:15:30.000Z');

test('recording filenames use a sanitized per-room prefix', () => {
  assert.equal(
    buildFilename('CloudWords Ruang A/part 2', 'video/webm;codecs=vp9', date),
    'cloudwords-ruang-a-part-2-2026-10-28_10-15-30.webm'
  );
});

test('recording filenames fall back to the default prefix', () => {
  assert.equal(buildFilename('', 'video/webm', date), 'wordcloud-recording-2026-10-28_10-15-30.webm');
  assert.equal(buildFilename(null, 'video/webm', date), 'wordcloud-recording-2026-10-28_10-15-30.webm');
});

test('recording filenames use mp4 when the mime type is mp4', () => {
  assert.equal(
    buildFilename('room-a', 'video/mp4;codecs=h264', date),
    'room-a-2026-10-28_10-15-30.mp4'
  );
});

test('normalizePrefix strips unsafe characters and trims separators', () => {
  assert.equal(normalizePrefix('  --A B!!  '), 'a-b');
  assert.equal(normalizePrefix('../../etc/passwd'), 'etc-passwd');
  assert.equal(normalizePrefix('x'.repeat(120)).length, 80);
});
