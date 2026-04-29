# Demo Gestionale - Istruzioni per la prova (Windows)

## 1. Cos'e questa versione

Questa e una **versione DEMO** del gestionale, pensata per prova funzionale completa.

- Ambiente separato dai dati reali
- Dati di esempio gia caricati
- Uso offline

---

## 2. Avvio rapido

1. Estrai completamente lo ZIP in una cartella locale (es. Desktop).
2. Avvia il file `GPA-Demo-1.0.0-Setup.exe`.
3. Se Windows mostra un avviso di protezione:
   - clicca `Altre informazioni`
   - clicca `Esegui comunque`

Nota: il file della demo e `GPA-Demo-1.0.0-Setup.exe`.

---

## 3. Se il file non si apre

1. Tasto destro sul file `.exe` -> `Proprieta`.
2. Se presente, spunta `Sblocca` in basso a destra.
3. Conferma con `Applica` e `OK`.
4. Riprova ad avviare come utente normale.
5. Se ancora bloccato, tasto destro -> `Esegui come amministratore`.

Se dopo il click non si apre nulla:

- apri `%APPDATA%\\GestionaleDemo\\main-process.log`
- invia il contenuto delle ultime righe per diagnosi rapida

---

## 4. Primo avvio

Al primo avvio compare un popup di benvenuto demo.

- Cliccare `Inizia` per entrare.
- Il popup compare una sola volta.

In alto nell'app e visibile la dicitura **Modalita demo**.

---

## 5. Dove salva i dati demo

La demo usa solo questa cartella:

`C:\Users\%USERNAME%\AppData\Roaming\GestionaleDemo\`

I dati reali (versione standard) restano separati in:

`C:\Users\%USERNAME%\AppData\Roaming\Gestionale\`

---

## 6. Reset dati demo

Se vuoi tornare ai dati iniziali:

1. Apri `Impostazioni`
2. Clicca `Ripristina dati demo`
3. Conferma

L'app si riavvia e riparte con database demo pulito.

---

## 7. Cosa verificare durante la prova

1. Apertura e navigazione sezioni (`Dipendenti`, `Squadre`, `Presenze`, `Report`, `Storico`, `Comunicazione`).
2. Presenze: modifica celle, inserimento rapido, stampa e PDF.
3. Report: salvataggio nel registro, stato pagato/non pagato, resto precedente, stampa/PDF.
4. Storico operaio: filtri, anteprima, stampa e colori saldo.
5. Comunicazione: salvataggio mensile, PDF/Excel, eliminazione voce.
6. Allegati: carica/apri/elimina file nelle sezioni abilitate.

---

## 8. Note utili

- La demo e autonoma: puo essere disinstallata senza impattare la versione standard.
- In caso di test estremo o dati incoerenti, usare `Ripristina dati demo`.
- Per feedback, indicare sempre:
  - sezione
  - azione effettuata
  - risultato atteso
  - risultato ottenuto
