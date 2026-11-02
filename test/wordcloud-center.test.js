'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { centerTopWord } = require('../public/js/wordcloud-center');

function word(text, rank, x, y, size = 40) {
  return { text, rank, x, y, size, width: text.length * size * 0.55, height: size * 1.05 };
}

test('a single word is placed exactly at the center', () => {
  const placed = [word('fokus', 0, 73, -41, 120)];
  assert.equal(centerTopWord(placed), true);
  assert.equal(placed[0].x, 0);
  assert.equal(placed[0].y, 0);
});

test('the top word is centered while other words keep their relative offsets', () => {
  const placed = [
    word('kerja', 1, 150, -20, 70),
    word('fokus', 0, 60, 30, 110),
    word('tim', 2, -170, 90, 65),
  ];
  centerTopWord(placed);

  const top = placed.find((item) => item.rank === 0);
  assert.equal(top.x, 0);
  assert.equal(top.y, 0);
  assert.equal(placed.find((item) => item.text === 'kerja').x, 90);
  assert.equal(placed.find((item) => item.text === 'kerja').y, -50);
  assert.equal(placed.find((item) => item.text === 'tim').x, -230);
  assert.equal(placed.find((item) => item.text === 'tim').y, 60);
});

test('the alphabetically first word wins a tie because it has rank 0', () => {
  const placed = [word('b', 1, 90, 90, 40), word('a', 0, -40, 20, 40)];
  centerTopWord(placed);
  assert.equal(placed.find((item) => item.text === 'a').x, 0);
  assert.equal(placed.find((item) => item.text === 'a').y, 0);
});

test('an empty layout is left untouched', () => {
  assert.equal(centerTopWord([]), false);
  assert.equal(centerTopWord(null), false);
});

test('the whole cloud is scaled down uniformly when a word would leave the canvas', () => {
  const placed = [
    word('fokus', 0, 0, 0, 100),
    word('jauh', 1, 260, 0, 40),
  ];
  const changed = centerTopWord(placed, { width: 400, height: 300, margin: 10 });

  assert.equal(changed, true);
  const top = placed.find((item) => item.rank === 0);
  assert.equal(top.x, 0);
  assert.equal(top.y, 0);

  for (const item of placed) {
    assert.ok(Math.abs(item.x) + item.width / 2 <= 200 - 10 + 0.001, `${item.text} x fits`);
    assert.ok(Math.abs(item.y) + item.height / 2 <= 150 - 10 + 0.001, `${item.text} y fits`);
  }
  assert.ok(placed.every((item) => item.size > 0));
});

test('no scaling happens when the cloud already fits', () => {
  const placed = [word('fokus', 0, 30, 0, 100), word('kecil', 1, -60, 20, 30)];
  const before = placed.map((item) => item.size);
  centerTopWord(placed, { width: 800, height: 600, margin: 10 });
  assert.deepEqual(placed.map((item) => item.size), before);
});
