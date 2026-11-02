'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hashPassword,
  verifyPassword,
  safeEqual,
  signAdminToken,
  verifyAdminToken,
  LoginRateLimiter,
} = require('../lib/auth');

test('verifyPassword accepts the matching password only', () => {
  assert.equal(verifyPassword('admin', 'admin'), true);
  assert.equal(verifyPassword('admin', 'not-admin'), false);
  assert.equal(verifyPassword('', 'admin'), false);
  assert.equal(verifyPassword(null, 'admin'), false);
});

test('hashPassword is deterministic and does not contain the plaintext', () => {
  assert.equal(hashPassword('rahasia'), hashPassword('rahasia'));
  assert.notEqual(hashPassword('rahasia'), hashPassword('rahasia2'));
  assert.ok(!hashPassword('rahasia').includes('rahasia'));
});

test('safeEqual compares strings without throwing on length mismatch', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(undefined, ''), true);
});

test('admin token round-trips and reports expiry', () => {
  const secret = 'test-secret';
  const now = 1_700_000_000_000;
  const { token, expiresAt } = signAdminToken({ secret, ttlMs: 1000, now });

  assert.equal(expiresAt, now + 1000);
  assert.deepEqual(verifyAdminToken(token, secret, now + 500), {
    valid: true,
    payload: { sub: 'admin', iat: now, exp: now + 1000 },
  });
  assert.equal(verifyAdminToken(token, secret, now + 1001).valid, false);
  assert.equal(verifyAdminToken(token, secret, now + 1001).reason, 'expired');
});

test('admin token rejects tampering and wrong secrets', () => {
  const { token } = signAdminToken({ secret: 'secret-a', ttlMs: 1000 });
  const [body, signature] = token.split('.');
  const tampered = `${body}.${signature.slice(0, -1)}x`;

  assert.equal(verifyAdminToken(tampered, 'secret-a').valid, false);
  assert.equal(verifyAdminToken(token, 'secret-b').valid, false);
  assert.equal(verifyAdminToken('not-a-token', 'secret-a').reason, 'malformed');
  assert.equal(verifyAdminToken('', 'secret-a').reason, 'missing');
});

test('login rate limiter blocks after max attempts and resets after the window', () => {
  let now = 1000;
  const limiter = new LoginRateLimiter({ maxAttempts: 2, windowMs: 1000, now: () => now });

  assert.equal(limiter.check('1.2.3.4'), true);
  limiter.fail('1.2.3.4');
  assert.equal(limiter.check('1.2.3.4'), true);
  limiter.fail('1.2.3.4');
  assert.equal(limiter.check('1.2.3.4'), false);
  assert.equal(limiter.check('5.6.7.8'), true);

  now += 1001;
  assert.equal(limiter.check('1.2.3.4'), true);
});

test('login rate limiter reset clears an IP', () => {
  const limiter = new LoginRateLimiter({ maxAttempts: 1, windowMs: 1000 });
  limiter.fail('ip');
  assert.equal(limiter.check('ip'), false);
  limiter.reset('ip');
  assert.equal(limiter.check('ip'), true);
});
