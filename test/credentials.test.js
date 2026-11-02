'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadCredentials, credentialsFileFor, CredentialsError } = require('../lib/credentials');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cloudwords-credentials-'));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('development creates credentials.json with a stable generated secret', () => {
  const dataDir = tempDir();
  try {
    const first = loadCredentials({ dataDir, env: {}, nodeEnv: 'development' });
    const file = credentialsFileFor({ dataDir });
    assert.equal(first.created, true);
    assert.equal(first.adminPassword, 'admin');
    assert.match(first.sessionSecret, /^[a-f0-9]{64}$/);

    const onDisk = readJson(file);
    assert.equal(onDisk.adminPassword, 'admin');
    assert.equal(onDisk.sessionSecret, first.sessionSecret);

    const second = loadCredentials({ dataDir, env: {}, nodeEnv: 'development' });
    assert.equal(second.created, false);
    assert.equal(second.adminPassword, 'admin');
    assert.equal(second.sessionSecret, first.sessionSecret);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('environment variables override the credentials file without rewriting it', () => {
  const dataDir = tempDir();
  try {
    const initial = loadCredentials({ dataDir, env: {}, nodeEnv: 'development' });
    const file = credentialsFileFor({ dataDir });
    const before = fs.readFileSync(file, 'utf8');

    const loaded = loadCredentials({
      dataDir,
      env: { ADMIN_PASSWORD: 'dari-env', SESSION_SECRET: 'rahasia-env' },
      nodeEnv: 'production',
    });

    assert.equal(loaded.adminPassword, 'dari-env');
    assert.equal(loaded.sessionSecret, 'rahasia-env');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.notEqual(initial.sessionSecret, loaded.sessionSecret);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('explicit overrides win over environment and file values', () => {
  const dataDir = tempDir();
  try {
    loadCredentials({ dataDir, env: {}, nodeEnv: 'development' });
    const loaded = loadCredentials({
      dataDir,
      env: { ADMIN_PASSWORD: 'env-pass', SESSION_SECRET: 'env-secret' },
      nodeEnv: 'production',
      adminPassword: 'test-pass',
      sessionSecret: 'test-secret',
    });

    assert.equal(loaded.adminPassword, 'test-pass');
    assert.equal(loaded.sessionSecret, 'test-secret');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('production without a credentials file or password refuses to start', () => {
  const dataDir = tempDir();
  try {
    assert.throws(
      () => loadCredentials({ dataDir, env: {}, nodeEnv: 'production' }),
      (error) => error instanceof CredentialsError && error.code === 'CREDENTIALS_REQUIRED'
    );
    assert.equal(fs.existsSync(credentialsFileFor({ dataDir })), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a corrupt credentials file fails loudly instead of silently regenerating', () => {
  const dataDir = tempDir();
  try {
    const file = credentialsFileFor({ dataDir });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, '{not-json', 'utf8');

    assert.throws(
      () => loadCredentials({ dataDir, env: {}, nodeEnv: 'development' }),
      (error) => error instanceof CredentialsError && error.code === 'CREDENTIALS_INVALID'
    );
    assert.equal(fs.readFileSync(file, 'utf8'), '{not-json');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a file without a session secret gets one generated and persisted', () => {
  const dataDir = tempDir();
  try {
    const file = credentialsFileFor({ dataDir });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ adminPassword: 'pilihan-admin' }), 'utf8');

    const loaded = loadCredentials({ dataDir, env: {}, nodeEnv: 'development' });
    assert.equal(loaded.adminPassword, 'pilihan-admin');
    assert.match(loaded.sessionSecret, /^[a-f0-9]{64}$/);

    const onDisk = readJson(file);
    assert.equal(onDisk.sessionSecret, loaded.sessionSecret);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the credentials path can be overridden with CREDENTIALS_FILE', () => {
  const dataDir = tempDir();
  try {
    const custom = path.join(dataDir, 'nested', 'secret.json');
    const loaded = loadCredentials({
      dataDir,
      env: { CREDENTIALS_FILE: custom },
      nodeEnv: 'development',
    });

    assert.equal(loaded.file, custom);
    assert.equal(fs.existsSync(custom), true);
    assert.equal(readJson(custom).adminPassword, 'admin');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
