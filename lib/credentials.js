'use strict';

/**
 * Credentials
 * -----------
 * Semua kredensial server disimpan di satu file JSON (default
 * `data/credentials.json`) yang di-ignore oleh git.
 *
 * Isi file:
 *   {
 *     "adminPassword": "...",
 *     "sessionSecret": "..."
 *   }
 *
 * Urutan prioritas: override eksplisit (test) -> environment variable ->
 * file JSON -> nilai default development. File tidak pernah ditimpa oleh
 * nilai dari environment; environment hanya menang untuk proses berjalan.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class CredentialsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CredentialsError';
    this.code = code;
  }
}

function credentialsFileFor({ dataDir, env = process.env } = {}) {
  if (env.CREDENTIALS_FILE) return path.resolve(env.CREDENTIALS_FILE);
  return path.join(dataDir, 'credentials.json');
}

function readCredentials(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { exists: false, data: {} };
    throw new CredentialsError(
      'CREDENTIALS_UNREADABLE',
      `Tidak bisa membaca file kredensial ${file}: ${err.message}`
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new CredentialsError(
      'CREDENTIALS_INVALID',
      `File kredensial rusak (${file}). Perbaiki JSON-nya atau hapus file tersebut.`
    );
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new CredentialsError(
      'CREDENTIALS_INVALID',
      `File kredensial ${file} harus berisi objek JSON.`
    );
  }

  return { exists: true, data };
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function writeCredentials(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.renameSync(temporary, file);
  } catch (err) {
    fs.rmSync(temporary, { force: true });
    throw new CredentialsError(
      'CREDENTIALS_WRITE_FAILED',
      `Gagal menyimpan file kredensial ${file}: ${err.message}`
    );
  }
}

/**
 * @param {{
 *   dataDir?: string,
 *   credentialsFile?: string,
 *   env?: NodeJS.ProcessEnv,
 *   nodeEnv?: string,
 *   adminPassword?: string,
 *   sessionSecret?: string,
 * }} [options]
 */
function loadCredentials(options = {}) {
  const env = options.env || process.env;
  const nodeEnv = options.nodeEnv || env.NODE_ENV || 'development';
  const dataDir = options.dataDir || env.DATA_DIR || path.join(__dirname, '..', 'data');
  const file = options.credentialsFile || credentialsFileFor({ dataDir, env });
  const { exists, data } = readCredentials(file);

  const fileAdmin = firstNonEmptyString(data.adminPassword);
  const fileSecret = firstNonEmptyString(data.sessionSecret);

  let adminPassword =
    options.adminPassword !== undefined
      ? options.adminPassword
      : env.ADMIN_PASSWORD !== undefined
        ? env.ADMIN_PASSWORD
        : fileAdmin;

  if (!adminPassword) {
    if (nodeEnv === 'production') {
      throw new CredentialsError(
        'CREDENTIALS_REQUIRED',
        `ADMIN_PASSWORD belum di-set. Buat ${file} dengan isi ` +
          '{"adminPassword":"password-kuat"} atau set environment ADMIN_PASSWORD.'
      );
    }
    adminPassword = 'admin';
  }

  const sessionSecret =
    firstNonEmptyString(options.sessionSecret, env.SESSION_SECRET, fileSecret) ||
    crypto.randomBytes(32).toString('hex');

  const needsFile = !exists;
  const needsSecretPersist =
    exists &&
    !fileSecret &&
    !firstNonEmptyString(options.sessionSecret, env.SESSION_SECRET);

  if (needsFile || needsSecretPersist) {
    const persistedPassword = firstNonEmptyString(
      options.adminPassword,
      env.ADMIN_PASSWORD,
      fileAdmin,
      adminPassword
    );
    const persistedSecret = firstNonEmptyString(
      options.sessionSecret,
      env.SESSION_SECRET,
      fileSecret,
      sessionSecret
    );

    writeCredentials(file, {
      adminPassword: persistedPassword,
      sessionSecret: persistedSecret,
    });
  }

  return {
    adminPassword,
    sessionSecret,
    file,
    created: needsFile,
  };
}

module.exports = {
  loadCredentials,
  credentialsFileFor,
  CredentialsError,
};
