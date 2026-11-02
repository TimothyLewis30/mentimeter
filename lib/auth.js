'use strict';

const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest();
}

function hashPassword(value) {
  return sha256(value).toString('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(left, right);
  } catch (err) {
    return false;
  }
}

function verifyPassword(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string') return false;
  return safeEqual(hashPassword(input), hashPassword(expected));
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function signAdminToken({ secret, ttlMs, now = Date.now() }) {
  const payload = { sub: 'admin', iat: now, exp: now + ttlMs };
  const body = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return { token: `${body}.${signature}`, expiresAt: payload.exp };
}

function verifyAdminToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !token) {
    return { valid: false, reason: 'missing' };
  }

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'malformed' };
  }

  const [body, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(signature, expected)) {
    return { valid: false, reason: 'signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (err) {
    return { valid: false, reason: 'payload' };
  }

  if (!payload || payload.sub !== 'admin') {
    return { valid: false, reason: 'subject' };
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= now) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, payload };
}

class LoginRateLimiter {
  constructor({ maxAttempts = 10, windowMs = 5 * 60 * 1000, now = Date.now } = {}) {
    this.maxAttempts = Math.max(1, Number(maxAttempts) || 10);
    this.windowMs = Math.max(1000, Number(windowMs) || 5 * 60 * 1000);
    this.now = now;
    this.entries = new Map();
  }

  check(ip) {
    const key = ip || 'unknown';
    const now = this.now();
    const entry = this.entries.get(key);

    if (!entry || entry.resetAt <= now) {
      this.entries.set(key, { count: 0, resetAt: now + this.windowMs });
      return true;
    }

    return entry.count < this.maxAttempts;
  }

  fail(ip) {
    const key = ip || 'unknown';
    const now = this.now();
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(key, entry);
    }
    entry.count += 1;
  }

  reset(ip) {
    this.entries.delete(ip || 'unknown');
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  safeEqual,
  signAdminToken,
  verifyAdminToken,
  LoginRateLimiter,
};
