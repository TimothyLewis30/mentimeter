'use strict';

const path = require('path');

const { loadCredentials } = require('./credentials');

const DEFAULT_QUESTION = 'Apa satu kata yang menggambarkan harimu?';

/**
 * Konfigurasi terpusat. Semua nilai bisa dioverride untuk test.
 */
function createConfig(overrides = {}) {
  const env = process.env;
  const nodeEnv = overrides.nodeEnv || env.NODE_ENV || 'development';
  const dataDir = overrides.dataDir || env.DATA_DIR || path.join(__dirname, '..', 'data');

  const credentials = loadCredentials({
    dataDir,
    credentialsFile: overrides.credentialsFile,
    env,
    nodeEnv,
    adminPassword: overrides.adminPassword,
    sessionSecret: overrides.sessionSecret,
  });

  return {
    port: Number(overrides.port ?? env.PORT) || 3000,
    broadcastInterval: Math.max(
      100,
      Number(overrides.broadcastInterval ?? env.BROADCAST_INTERVAL) || 500
    ),
    maxAnswerLength: Number(overrides.maxAnswerLength) || 40,
    maxUniqueWords: Number(overrides.maxUniqueWords) || 1000,
    maxCloudWords: Number(overrides.maxCloudWords) || 150,
    answerCooldownMs: Number(overrides.answerCooldownMs) || 700,
    recentLimit: Number(overrides.recentLimit) || 12,
    maxRooms: Number(overrides.maxRooms) || 50,
    adminPassword: credentials.adminPassword,
    sessionSecret: credentials.sessionSecret,
    credentialsFile: credentials.file,
    adminTokenTtlMs: 12 * 60 * 60 * 1000,
    dataDir,
    defaultQuestion: DEFAULT_QUESTION,
    nodeEnv,
  };
}

module.exports = { createConfig, DEFAULT_QUESTION };
