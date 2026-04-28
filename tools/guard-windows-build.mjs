#!/usr/bin/env node

const platform = process.platform;

if (platform !== 'win32') {
  console.error('[build-windows] Errore: la build Windows con moduli nativi deve essere eseguita su Windows (host corrente: ' + platform + ').');
  console.error('[build-windows] Usa una macchina Windows o una CI Windows, poi rilancia il comando dist:win.');
  process.exit(1);
}

console.log('[build-windows] Host Windows rilevato, procedo.');
