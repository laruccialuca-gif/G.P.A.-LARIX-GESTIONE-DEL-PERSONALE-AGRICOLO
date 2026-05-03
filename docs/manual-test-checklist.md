# Checklist tecnica gestionale

## Backup e ripristino

- Avvio del gestionale in una nuova giornata: verificare che venga creato un backup automatico una sola volta.
- Import PDF confermato: verificare presenza del backup `pre-operation-import_pdf`.
- Bulk upsert presenze: verificare presenza del backup `pre-operation-bulk_attendance`.
- Ripristino backup: verificare creazione del backup `pre-restore` prima dello swap dei dati.
- Ripristino backup fallito: verificare che il messaggio mostri il motivo e il percorso del backup di sicurezza.
- Ripristino backup riuscito: verificare che dopo il restore venga eseguito `PRAGMA integrity_check`.

## Integrità database

- Forzare un caso di integrity warning in ambiente di test: verificare comparsa dell'avviso e proposta di usare i backup.
- Controllare il log main process per eventi `db:integrity-warning`, `db:integrity-ok`, `db:integrity-failed`.

## Import PDF

- PDF leggibile con più dipendenti: verificare avanzamento con step `lettura file`, `parsing PDF`, `riconoscimento dipendente`, `controllo duplicati`, `backup pre-import`, `salvataggio dati`, `completato`.
- PDF non leggibile o corrotto: verificare messaggio chiaro di errore.
- Import multipli rapidi: verificare che il secondo tentativo venga bloccato fino al termine del primo.
- Import con molti record: verificare che la UI resti reattiva e che il banner di avanzamento aggiorni la percentuale.

### Import PDF assunzioni

- Preparazione ambiente:
  usare un database di test pulito o un backup ripristinabile prima di iniziare.
- Preparazione evidenze:
  annotare per ogni caso `CF`, datore, data inizio, data fine, badge preview e risultato finale nel DB.

- 1. PDF corretto:
  importare un PDF con tutti i campi presenti.
  atteso: ogni riga deve essere marcata `Pronto`.
  atteso: conferma import crea o aggiorna i dipendenti senza errori.
  atteso: `CF`, `nome`, `cognome` e `data` risultano salvati correttamente.

- 2. CF spezzato su piu righe:
  usare un PDF in cui il codice fiscale sia diviso da spazi o ritorni a capo.
  atteso: il parser ricostruisce il CF completo da 16 caratteri.
  atteso alternativo: se non riesce, la riga va in `Da correggere` e non viene importata.

- 3. Nome o cognome mancante:
  usare un PDF con `nome` oppure `cognome` assente o illeggibile.
  atteso: non viene creato alcun dipendente.
  atteso: la riga compare in `Da correggere`.
  atteso: dopo correzione manuale, la riga passa a `Pronto` o `Nuovo rapporto datore` e puo essere importata.

- 4. Stesso dipendente, datore diverso:
  importare un record con stesso `CF` ma datore differente rispetto a un dipendente gia presente.
  atteso: non viene creato un nuovo dipendente.
  atteso: viene aggiunto un nuovo rapporto in `employee_employment_periods`.
  atteso: la preview mostra badge `Nuovo rapporto datore`.
  atteso: nella scheda dipendente compare il badge `Assunto da entrambi i datori` quando presenti sia `LC` sia `LG`.

- 5. Stesso PDF importato due volte:
  importare due volte lo stesso file.
  atteso: il secondo import non crea nuovi dipendenti ne nuovi periodi identici.
  atteso: le righe gia presenti sono marcate `Già in archivio`.

- 6. Dipendente archiviato:
  archiviare un dipendente esistente, poi reimportare un PDF con lo stesso `CF`.
  atteso: il sistema propone riattivazione o riuso della scheda esistente.
  atteso: non viene creato un duplicato sporco con stesso `CF`.
  atteso: eventuali nuovi periodi vengono collegati alla stessa persona.

- 7. Verifica database:
  controllare che ogni `CF` corrisponda a un solo dipendente attivo.
  query utile:
  `SELECT fiscal_code, COUNT(*) FROM employees WHERE COALESCE(fiscal_code, '') <> '' GROUP BY fiscal_code HAVING COUNT(*) > 1;`
  atteso: nessuna riga.
  controllare i rapporti per datore:
  `SELECT employee_id, hired_by, hire_date_from, hire_date_to, source_document_id FROM employee_employment_periods ORDER BY employee_id, hired_by, hire_date_from;`
  atteso: periodi distinti per datore senza sovrascritture.
  atteso: `source_document_id` valorizzato per i periodi creati via import.

- 8. Verifica UI:
  atteso: preview leggibile e comprensibile prima del salvataggio.
  atteso: motivi di blocco visibili su ogni riga incompleta.
  atteso: testo originale PDF visibile nella preview.
  atteso: checkbox e import effettivo abilitati solo per righe `Pronto` o `Nuovo rapporto datore`.

- 9. Log diagnostico:
  controllare `main-process.log` per eventi `pdf-import:record-evaluated`.
  atteso: per ogni record risultano parsing, campi mancanti e decisione finale `creato`, `aggiornato`, `scartato`, `già presente`.

- 10. Esito finale archivio:
  atteso: una persona = un dipendente.
  atteso: piu datori = piu rapporti collegati allo stesso dipendente.
  atteso: dati incompleti mai salvati automaticamente.

## Report e stampa

- Generazione report PDF: verificare avanzamento con step `caricamento dati`, `generazione documento`, `salvataggio file`, `completato`.
- Stampa/preview report: verificare gli stessi step senza blocco della UI.
- Doppio click sui pulsanti report: verificare che la seconda operazione venga bloccata con messaggio chiaro.

## Storici e archivi

- Storico operaio con molti report: verificare caricamento paginato, filtri server-side per anno/mese/ricerca e assenza di caricamento completo iniziale.
- Comunicazioni operative: verificare filtro server-side per anno/ricerca e paginazione.
- Navigazione tra pagine archivio: verificare coerenza di totale, pagina corrente e risultati mostrati.

## Aggiornamenti applicazione

- Installazione `1.0.0`:
  installare la build standard su macchina di test senza rimuovere eventuali cartelle `AppData/Application Support` esistenti.
- Preparazione dati su `1.0.0`:
  creare almeno 3 dipendenti, registrare presenze, generare almeno 1 report PDF, creare 1 backup manuale e verificare presenza file licenza.
- Rilevazione percorsi persistenti:
  annotare `userData path`, `database path`, `backup path`, `license path` dalla schermata Impostazioni oppure da `main-process.log`.
- Aggiornamento a `1.0.1`:
  installare la nuova versione sopra la precedente senza disinstallare e senza cancellare manualmente `userData`.
- Verifica dati dopo update:
  controllare che database, PDF, backup, licenza e impostazioni siano rimasti intatti.
- Verifica migrazioni:
  controllare in `main-process.log` la presenza di `bootstrap:runtime-info`, eventuali `db:migration-backup-created`, `db:migration-applied` e `db:integrity-ok`.
- Verifica percorsi dopo update:
  confermare che `userData path`, `database path`, `backup path` e `license path` puntino ancora fuori dalla cartella installazione.
- Verifica licenza dopo update:
  aprire Impostazioni e controllare che stato licenza, scadenza, ultima verifica e file licenza siano ancora coerenti.
- Reinstallazione non distruttiva:
  reinstallare la stessa build sopra quella gia presente e verificare che i dati restino disponibili al riavvio.
- Policy uninstall/update:
  verificare che il pacchetto non cancelli automaticamente `userData` durante update o reinstallazione e che la policy `deleteAppDataOnUninstall=false` resti attiva nelle configurazioni build.
