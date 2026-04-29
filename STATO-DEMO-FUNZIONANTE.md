# Stato demo funzionante

Data: 2026-04-29

Questa e la base funzionante prima delle nuove modifiche.

## Installer funzionante conservato

- `release-demo/GPA-Demo-1.0.0-Setup.exe`
- `release-demo/GPA-Demo-1.0.0-Setup.exe.blockmap`

## Verifiche eseguite

- `npm run build`: completato correttamente.
- Il comando installer demo e ancora disponibile in `package.json`.
- Non e stato generato un nuovo installer.

## Modifiche post-demo applicate

- pulizia file inutili
- allineamento nome installer a `GPA-Demo-1.0.0-Setup.exe`
- aggiunta `cross-env` per compatibilita Windows degli script `dev:demo` e `start:demo`
- `npm run build` verificato dopo le modifiche
- nessun installer rigenerato

## Cartella release-demo pulita

Dopo la pulizia, `release-demo/` contiene solo:

- `GPA-Demo-1.0.0-Setup.exe`
- `GPA-Demo-1.0.0-Setup.exe.blockmap`

## File eliminati durante la pulizia sicura

- `__MACOSX/`
- tutti i file `.DS_Store`
- `GPA-Demo-1.0.0-Setup.exe` non corretto fuori da `release-demo/`, se presente in vecchie consegne
- vecchi installer demo con nome diverso da `GPA-Demo-1.0.0-Setup.exe`
- vecchi `.blockmap` collegati a installer demo obsoleti
- `release-demo/win-unpacked/`
- `release-demo/builder-debug.yml`
- `release-demo/builder-effective-config.yaml`
- `dist/`
- `app-demo/dist/`

Nota: `dist/` e stato poi ricreato da `npm run build` durante la verifica di compilazione.

## File e cartelle lasciati intatti

- `app-demo/`
- `app-dev/`
- `node_modules/`
- `src/`
- `tools/`
- `build/resources/`
- `build/windows-installer-demo.iss`
- `build/windows-installer.iss`
- `CHECKSUM-GESTIONALE-DEMO.txt`
- `package.json`
- `package-lock.json`
- `electron-builder.json`
- `vite.config.js`

## Comando futuro per rigenerare la demo

Comando consigliato per rigenerare la demo partendo da output pulito:

```powershell
npm run dist:win:demo:clean
```

Comandi demo disponibili in `package.json`:

- `npm run dist:win:demo`
- `npm run dist:win:demo:clean`
- `npm run dist:win:demo:dir`
- `npm run dist:win:demo:nsis`
- `npm run dist:win:demo:nsis:clean`
- `npm run dist:win:demo:inno`
