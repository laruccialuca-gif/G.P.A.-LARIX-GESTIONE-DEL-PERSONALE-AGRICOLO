# Distribuzione Windows

Questa guida prepara il gestionale come applicazione desktop Windows installabile, offline e con dati utente persistenti.

## Struttura file locali

I dati utente non vengono salvati nella cartella del programma.

Percorsi usati dall'app standard:

- Database SQLite: `%APPDATA%\Gestionale\data\presenze.sqlite`
- Documenti allegati: `%APPDATA%\Gestionale\documents\`
- Configurazioni: `%APPDATA%\Gestionale\config\`
- Backup: `%APPDATA%\Gestionale\backups\`
- Stato licenza e attivazione: `%APPDATA%\Gestionale\config\`

Percorsi usati dalla demo:

- Database SQLite: `%APPDATA%\GestionaleDemo\data\presenze.sqlite`
- Documenti allegati: `%APPDATA%\GestionaleDemo\documents\`
- Configurazioni: `%APPDATA%\GestionaleDemo\config\`
- Backup: `%APPDATA%\GestionaleDemo\backups\`
- Stato demo e popup primo avvio: `%APPDATA%\GestionaleDemo\config\`

In questo modo:

- aggiornamenti del software non cancellano il database
- la disinstallazione non rimuove i dati utente
- reinstallazioni future trovano i dati gia presenti
- il legame di attivazione/licenza resta persistente per quella installazione

L'app usa un percorso dati utente stabile separato dalla cartella programma e migra automaticamente eventuali dati creati con percorsi legacy.

## Primo avvio

Al primo avvio l'app:

- crea automaticamente cartelle `data`, `config`, `documents`, `backups` se mancanti
- crea o migra il database SQLite locale
- inizializza le impostazioni base
- mantiene separata la cartella programma dalla cartella dati utente

## Build Windows con electron-builder

Prerequisito fondamentale:

- eseguire la build su host Windows (`win32`) quando sono presenti moduli nativi come `better-sqlite3`
- evitare build Windows da macOS/Linux per la release finale

### 1. Installazione dipendenze

```bash
npm install
```

### 2. Rebuild moduli nativi per Electron target

```bash
npm run rebuild:native:electron
```

### 3. Genera cartella Windows unpacked

```bash
npm run dist:win:dir
```

Output atteso:

- `release/win-unpacked/`

### 4. Genera installer NSIS `.exe`

```bash
npm run dist:win:nsis
```

Output atteso:

- `release/Gestionale-1.0.0-x64.exe`
- verifica automatica `better_sqlite3.node` (header `MZ`) superata

Questo installer:

- installa il programma in `Program Files` o nella cartella scelta dall'utente
- crea collegamento desktop
- crea collegamento nel menu Start
- aggiunge la voce di disinstallazione
- non cancella i dati utente in `%APPDATA%`

## Installer con Inno Setup

Se preferisci distribuire il programma con Inno Setup:

### 1. Genera prima la cartella applicazione

```bash
npm run dist:win:dir
```

### 2. Apri Inno Setup Compiler su Windows

Apri il file:

- `build/windows-installer.iss`

### 3. Compila lo script

Da interfaccia Inno Setup:

- `Build > Compile`

Oppure da terminale Windows:

```bat
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" build\windows-installer.iss
```

Oppure, se `ISCC.exe` e nel `PATH`:

```bat
npm run dist:win:inno
```

Output atteso:

- `release/inno/Gestionale-Setup-1.0.0.exe`

## Build demo Windows

### 1. Genera cartella demo unpacked

```bash
npm run dist:win:demo:dir
```

Output atteso:

- `release-demo/win-unpacked/`
- verifica automatica `better_sqlite3.node` (header `MZ`) superata

### 2. Genera installer demo NSIS

```bash
npm run dist:win:demo
```

Output atteso:

- `release-demo/Gestionale-Demo-1.0.0-Setup.exe`
- verifica automatica `better_sqlite3.node` (header `MZ`) superata

### Procedura consigliata anti-bug (build pulita)

Su Windows x64 pulito:

```bat
npm run dist:win:demo:nsis:clean
```

Questa procedura esegue in sequenza:

- cleanup completo (`node_modules`, `dist`, `release*`)
- reinstall lockfile (`npm ci`)
- rebuild moduli nativi per Electron (`better-sqlite3`)
- build installer demo x64
- verifica automatica del modulo unpacked (`MZ`)

In alternativa sono disponibili script dedicati:

- `tools/build-demo-windows-clean.ps1`
- `tools/build-demo-windows-clean.cmd`

### 3. Genera installer demo Inno Setup

```bat
npm run dist:win:demo:inno
```

oppure compila manualmente:

- `build/windows-installer-demo.iss`

Output atteso:

- `release-demo/inno/Gestionale Demo-Setup-1.0.0.exe`

La demo:

- usa dati separati in `%APPDATA%\GestionaleDemo`
- non tocca mai i dati reali in `%APPDATA%\Gestionale`
- apre con archivio demo gia popolato
- mostra banner e popup primo avvio solo in variante demo
- conserva database, config, documenti, backup e log tra aggiornamenti demo successivi

Lo script Inno Setup e configurato per:

- usare icona applicazione
- creare shortcut desktop e Start
- permettere uninstall
- preservare i dati utente
- chiedere esplicitamente in fase di disinstallazione se eliminare anche i dati locali

### 4. Verifica finale post-build demo

Eseguire su Windows dopo la generazione di `release-demo/Gestionale-Demo-1.0.0-Setup.exe`.

#### Test guidato 1. Aggiornamento sopra demo gia installata

- installare la nuova build sopra una demo esistente
- verificare che il setup aggiorni la demo esistente senza creare una seconda app diversa
- avviare la demo aggiornata
- confermare che `%APPDATA%\GestionaleDemo\data\presenze.sqlite` resti invariato se gia presente
- confermare che `%APPDATA%\GestionaleDemo\main-process.log` venga aggiornato con i nuovi eventi di bootstrap
- confermare che documenti, config e backup in `%APPDATA%\GestionaleDemo\` restino presenti

Esito atteso:

- stessa app demo aggiornata
- stessi dati demo gia presenti
- nessun contatto con `%APPDATA%\Gestionale`

#### Test guidato 2. Installazione pulita

- disinstallare la demo
- reinstallare da zero l'installer aggiornato
- avviare `Gestionale Demo`
- verificare che il renderer si carichi senza schermata bianca
- verificare che la cartella `%APPDATA%\GestionaleDemo\` venga creata
- verificare presenza di `main-process.log`
- verificare apertura database `%APPDATA%\GestionaleDemo\data\presenze.sqlite`

Esito atteso:

- app avviata regolarmente
- database demo creato o riusato nella cartella demo
- log di bootstrap presente

#### Test guidato 3. Disinstallazione

- chiudere `Gestionale Demo`
- disinstallare da `App installate` oppure dal collegamento di uninstall
- verificare che la cartella programma venga rimossa
- scegliere di non cancellare i dati demo se vuoi testare la reinstallazione con dati persistenti
- reinstallare e verificare che i dati demo precedenti siano ancora presenti

Esito atteso:

- programma rimosso correttamente
- dati demo preservati se l'utente sceglie `No` alla rimozione dati

#### Test guidato 4. Controllo cartella dati

- aprire `%APPDATA%\GestionaleDemo`
- verificare presenza sottocartelle `data`, `config`, `documents`, `backups`
- verificare che non vengano usate cartelle standard come `%APPDATA%\Gestionale`

Esito atteso:

- tutta la persistenza demo rimane in `%APPDATA%\GestionaleDemo`

#### Test guidato 5. Controllo log

- aprire `%APPDATA%\GestionaleDemo\main-process.log`
- verificare presenza eventi `bootstrap:runtime-info`, `window:create`, `renderer:did-finish-load`
- in caso di errore renderer, verificare che resti traccia nel log

Esito atteso:

- log leggibile e aggiornato all'ultimo avvio

#### Test guidato 6. Controllo database

- verificare presenza file `%APPDATA%\GestionaleDemo\data\presenze.sqlite`
- controllare che dimensione e data modifica cambino solo quando l'app usa davvero il DB
- riaprire l'app e verificare che storico e dati demo risultino coerenti

Esito atteso:

- database demo separato, persistente e non sovrascritto inutilmente

#### Test guidato 7. Controllo schermata bianca

- avviare la demo appena installata
- verificare che compaiano sidebar, banner demo e contenuto renderer
- se il renderer fallisce, verificare comparsa del fallback con messaggio di errore invece di una pagina bianca vuota

Esito atteso:

- niente finestra bianca muta
- errore eventualmente visibile e diagnosticabile

#### Test guidato 8. Controllo import PDF

- aprire la funzione di import PDF dipendente
- selezionare un PDF di prova
- verificare caricamento, parsing e salvataggio senza crash

Esito atteso:

- import funzionante
- nessun errore bloccante nel renderer o nel main log

#### Test guidato 9. Controllo storico e scrollbar

- aprire la scheda `Storico`
- controllo che la scrollbar laterale non copra i dati
- controllo che la sezione filtri dello storico sia piu compatta
- apertura anteprima/stampa report storico

Esito atteso:

- filtri compatti
- contenuto leggibile
- scrollbar non sovrapposta ai dati

Se servono diagnostiche aggiuntive:

- eseguire `tools/collect-demo-runtime-diagnostics.cmd`
- eseguire `tools/generate-demo-windows-report.cmd`
- confrontare eventuali cartelle legacy `%APPDATA%\gestionale-presenze-offline` e `%APPDATA%\Gestionale Dipendenti Offline Demo`

## Branding configurabile

Puoi cambiare rapidamente:

- nome programma standard: `electron-builder.json` campo `productName`
- nome programma demo: `package.json` campo `build.productName`
- publisher: `electron-builder.json` / `package.json` campo `win.publisherName`
- nome/metadata Inno Setup: costanti in `build/windows-installer.iss` e `build/windows-installer-demo.iss`
- icona Windows: `build/resources/icon.ico`

## Disinstallazione

Sia NSIS sia Inno Setup includono:

- voce nel menu Start
- disinstallazione da Pannello di Controllo / App installate
- collegamento desktop opzionale

I dati locali restano separati in `%APPDATA%` e non vengono cancellati automaticamente.
Nello script Inno Setup l'utente puo scegliere esplicitamente di rimuoverli in disinstallazione.

## Compatibilita con backup, storico e licenza

La struttura Windows e compatibile con:

- database locale persistente
- backup locali
- documenti PDF/Excel e allegati
- storico applicativo
- impostazioni
- stato licenza e attivazione

Questi dati restano fuori dalla cartella del programma e quindi non vengono persi per aggiornamenti o reinstallazioni standard.

## Nota importante

Per buildare davvero per Windows, esegui i comandi su una macchina Windows o in una pipeline CI Windows.
I comandi `dist:win:*` ora bloccano automaticamente l'esecuzione su host non Windows per evitare release con binari nativi incompatibili.
