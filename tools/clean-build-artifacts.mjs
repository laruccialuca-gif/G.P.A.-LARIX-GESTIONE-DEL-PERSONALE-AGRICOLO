#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const targets = [
  'node_modules',
  'dist',
  'release',
  'release-demo',
  '.vite',
  '.cache',
];

for (const rel of targets) {
  const p = path.join(process.cwd(), rel);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log('[clean] removed:', rel);
  } else {
    console.log('[clean] skip (missing):', rel);
  }
}

console.log('[clean] done');
