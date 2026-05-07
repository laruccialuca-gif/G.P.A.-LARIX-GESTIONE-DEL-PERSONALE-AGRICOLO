// Registry centralizzato delle versioni di stampa Report/PDF.
// Aggiungere nuove versioni qui (v2, v3, layout colorato, layout consulente, ecc.)
// senza modificare ReportPage o SettingsPage. La pagina Report sceglie il
// renderer in base a `print_layout_version` salvato nelle impostazioni.

export const DEFAULT_REPORT_LAYOUT_VERSION = 'v1';

// Lista ordinata. L'ordine determina la posizione nel dropdown.
// Quando si aggiunge una versione nuova:
// 1) registrarla qui;
// 2) impostare `available: true` quando il renderer e' pronto;
// 3) opzionale: associare un `renderer` (id letto dal codice di stampa).
export const REPORT_LAYOUT_VERSIONS = [
  {
    id: 'v1',
    label: 'Versione 1 - Report compatto B/N',
    shortLabel: 'V1 · Compatto B/N',
    description:
      'Layout attuale, ottimizzato per la stampa in bianco e nero. Header con dati operaio, '
      + 'tre card riepilogo, griglia presenze settimanale, sezione economica e blocco trattenute/acconti.',
    features: [
      'Stampa B/N ad alta densità',
      'Header compatto operaio',
      'Griglia settimane con totali riga',
      'Riepilogo economico in cornice',
    ],
    palette: 'mono',
    renderer: 'v1',
    available: true,
  },
  // Esempi di versioni future già registrabili (non disponibili finché manca il renderer):
  // {
  //   id: 'v2-colored',
  //   label: 'Versione 2 - Layout colorato',
  //   shortLabel: 'V2 · Colorato',
  //   description: 'Variante a colori con badge evidenziati.',
  //   features: ['Header colorato', 'Badge stato evidenziati'],
  //   palette: 'color',
  //   renderer: 'v2-colored',
  //   available: false,
  // },
  // {
  //   id: 'v3-consulente',
  //   label: 'Versione 3 - Layout consulente',
  //   shortLabel: 'V3 · Consulente',
  //   description: 'Schema esteso con dettagli contabili per il consulente del lavoro.',
  //   features: ['Tabella ore estesa', 'Dettaglio contributi'],
  //   palette: 'mono',
  //   renderer: 'v3-consulente',
  //   available: false,
  // },
];

const VERSIONS_BY_ID = REPORT_LAYOUT_VERSIONS.reduce((acc, item) => {
  acc[item.id] = item;
  return acc;
}, {});

export function getReportLayoutVersion(id) {
  return VERSIONS_BY_ID[id] || VERSIONS_BY_ID[DEFAULT_REPORT_LAYOUT_VERSION];
}

export function listAvailableReportLayoutVersions() {
  return REPORT_LAYOUT_VERSIONS.filter((item) => item.available);
}

// Mapping layoutVersion -> renderer id. Centralizzato qui per evitare
// hardcoded sparsi nel codice di stampa/anteprima/PDF.
export function resolveReportRenderer(id) {
  const version = getReportLayoutVersion(id);
  return version?.renderer || DEFAULT_REPORT_LAYOUT_VERSION;
}
