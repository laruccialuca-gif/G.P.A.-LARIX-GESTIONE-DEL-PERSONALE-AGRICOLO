#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const variant = (process.argv[2] || 'demo').trim().toLowerCase();
const outputDir = variant === 'standard' ? 'release' : 'release-demo';

const nodeBinaryPath = path.join(
  process.cwd(),
  outputDir,
  'win-unpacked',
  'resources',
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
);

if (!fs.existsSync(nodeBinaryPath)) {
  console.error('[verify-native] File mancante: ' + nodeBinaryPath);
  console.error('[verify-native] Build non valida: better-sqlite3 non risulta unpacked correttamente.');
  process.exit(1);
}

const header = Buffer.alloc(4);
const fd = fs.openSync(nodeBinaryPath, 'r');
try {
  fs.readSync(fd, header, 0, 4, 0);
} finally {
  fs.closeSync(fd);
}

const isPE = header[0] === 0x4d && header[1] === 0x5a; // MZ
if (!isPE) {
  const hexHeader = header.toString('hex');
  console.error('[verify-native] Header non Win32 (atteso MZ) in: ' + nodeBinaryPath);
  console.error('[verify-native] Header rilevato: 0x' + hexHeader);
  console.error('[verify-native] Probabile binario compilato per piattaforma errata (es. macOS/Linux).');
  process.exit(1);
}

console.log('[verify-native] OK: better_sqlite3.node valido per Windows (header MZ).');
console.log('[verify-native] Path: ' + nodeBinaryPath);
