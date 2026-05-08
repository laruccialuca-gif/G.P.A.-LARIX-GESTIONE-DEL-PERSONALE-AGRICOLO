#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_FLAG = '--dry-run';
const baseDir = path.resolve('C:/Users/llaru/Downloads/gestionale-presenze-offline');
const backupDir = path.resolve('C:/Users/llaru/Downloads/GPA-old-folders-backup');
const protectedActiveDirName = 'G.P.A.-LARIX-GESTIONE-DEL-PERSONALE-AGRICOLO';
const protectedDirs = new Set([
  path.resolve(baseDir, protectedActiveDirName),
  path.resolve('C:/Users/llaru/AppData'),
]);

const plan = [
  {
    name: protectedActiveDirName,
    absolutePath: path.resolve(baseDir, protectedActiveDirName),
    action: 'preserve',
    reason: 'Cartella progetto attiva da preservare sempre.',
  },
  {
    name: 'gestionale-presenze-offline',
    absolutePath: path.resolve(baseDir, 'gestionale-presenze-offline'),
    action: 'archive',
    targetPath: path.resolve(backupDir, 'gestionale-presenze-offline'),
    reason: 'Copia vecchia da archiviare, non da cancellare.',
  },
  {
    name: 'gpa-gestionale',
    absolutePath: path.resolve(baseDir, 'gpa-gestionale'),
    action: 'archive-or-delete',
    targetPath: path.resolve(backupDir, 'gpa-gestionale'),
    reason: 'Cartella vuota, candidabile a rimozione o archiviazione.',
  },
  {
    name: '.claude',
    absolutePath: path.resolve(baseDir, '.claude'),
    action: 'preserve',
    reason: 'Cartella locale da preservare.',
  },
];

function fail(message) {
  console.error(`ERRORE: ${message}`);
  process.exit(1);
}

function ensureDryRunOnly() {
  const args = process.argv.slice(2);
  if (!args.includes(REQUIRED_FLAG)) {
    fail(`lo script funziona solo in modalita dry-run. Usa: node tools/cleanup-old-project-folders.mjs ${REQUIRED_FLAG}`);
  }

  const unsupported = args.filter((arg) => arg !== REQUIRED_FLAG);
  if (unsupported.length) {
    fail(`argomenti non supportati in questa fase: ${unsupported.join(', ')}`);
  }
}

function ensureSafePath(targetPath) {
  const resolved = path.resolve(targetPath);
  if (protectedDirs.has(resolved)) {
    fail(`percorso protetto rilevato: ${resolved}`);
  }
  if (resolved.includes(`${path.sep}AppData${path.sep}`)) {
    fail(`tentativo bloccato su AppData: ${resolved}`);
  }
  return resolved;
}

function getFolderInfo(targetPath) {
  const exists = fs.existsSync(targetPath);
  if (!exists) {
    return {
      exists: false,
      sizeBytes: 0,
      itemCount: 0,
      lastModified: '',
    };
  }

  let sizeBytes = 0;
  let itemCount = 0;
  let lastModified = fs.statSync(targetPath).mtime.toISOString();
  const stack = [targetPath];

  while (stack.length) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.mtime.toISOString() > lastModified) {
      lastModified = stat.mtime.toISOString();
    }
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        stack.push(path.join(current, entry.name));
      }
    } else if (stat.isFile()) {
      sizeBytes += stat.size;
      itemCount += 1;
    }
  }

  return {
    exists: true,
    sizeBytes,
    itemCount,
    lastModified,
  };
}

function formatBytes(sizeBytes) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function main() {
  ensureDryRunOnly();
  ensureSafePath(baseDir);
  ensureSafePath(backupDir);

  printSection('CONFIGURAZIONE');
  console.log(`Cartella base: ${baseDir}`);
  console.log(`Cartella attiva preservata: ${path.resolve(baseDir, protectedActiveDirName)}`);
  console.log(`Backup target previsto: ${backupDir}`);

  printSection('PROTEZIONI');
  console.log(`Protetta: ${path.resolve(baseDir, protectedActiveDirName)}`);
  console.log('Protetta: C:\\Users\\llaru\\AppData');
  console.log('Protetto: release attuale del progetto attivo');
  console.log('Protetti: database e file dati utente');

  printSection('PIANO DRY-RUN');
  for (const entry of plan) {
    const safePath = entry.action === 'preserve'
      ? path.resolve(entry.absolutePath)
      : ensureSafePath(entry.absolutePath);
    const info = getFolderInfo(safePath);
    console.log(`- ${entry.name}`);
    console.log(`  path: ${safePath}`);
    console.log(`  esiste: ${info.exists ? 'si' : 'no'}`);
    console.log(`  dimensione: ${formatBytes(info.sizeBytes)}`);
    console.log(`  file conteggiati: ${info.itemCount}`);
    console.log(`  ultima modifica: ${info.lastModified || 'n/d'}`);
    console.log(`  azione prevista: ${entry.action}`);
    console.log(`  motivo: ${entry.reason}`);
    if (entry.targetPath) {
      console.log(`  target previsto: ${ensureSafePath(entry.targetPath)}`);
    }
  }

  printSection('AZIONI SIMULATE');
  console.log(`- PRESERVARE ${path.resolve(baseDir, protectedActiveDirName)}`);
  console.log(`- SPOSTARE ${path.resolve(baseDir, 'gestionale-presenze-offline')} -> ${path.resolve(backupDir, 'gestionale-presenze-offline')}`);
  console.log(`- ARCHIVIARE O ELIMINARE ${path.resolve(baseDir, 'gpa-gestionale')} (preferibilmente backup in ${path.resolve(backupDir, 'gpa-gestionale')})`);
  console.log(`- PRESERVARE ${path.resolve(baseDir, '.claude')}`);

  printSection('RIEPILOGO');
  console.log('DRY RUN - nessun file modificato.');
}

main();
