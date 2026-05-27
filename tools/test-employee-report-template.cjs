'use strict';

/**
 * Test: EmployeeReportTemplate.html → diagnostics/employee-report-template-test.pdf
 *
 * Run via:
 *   node tools/run-electron-clean-env.cjs tools/test-employee-report-template.cjs
 */

const { app } = require('electron');
const path    = require('path');
const fs      = require('fs');

const { buildEmployeeReportData } = require('../src/main/print/buildEmployeeReportData');
const { renderToPDF }             = require('../src/main/print/printTemplate');

const TEMPLATE_PATH  = path.join(__dirname, '../src/renderer/printTemplates/EmployeeReportTemplate.html');
const OUTPUT_DIR     = path.join(__dirname, '../diagnostics');
const OUTPUT_PATH    = path.join(OUTPUT_DIR, 'employee-report-template-test.pdf');

// ---------------------------------------------------------------------------
// Test input — MD Sabbir Fakir · Squadra Leonora · Maggio 2026
// ---------------------------------------------------------------------------
const testInput = {
  squadra:    'Leonora',
  generatoDa: 'GPA 1.0.5',
  periodo: {
    inizioISO: '2026-05-01',
    fineISO:   '2026-05-31'
  },

  dipendente: {
    nome:               'MD Sabbir Fakir',
    ruolo:              'Raccolta',
    markerLabel:        'Leonora',
    markerLegendLabel:  'Squadra Leonora',
    paymentStatus:      'paid',
    paymentStatusLabel: 'Pagato',
    dailyRate:          65.00,
    overtimeRate:       10.00,
    standardHours:      7
  },

  kpi: {
    giornateIntere:      10,
    oreResidue:          0,
    oreTotali:           77,
    straordinari:        7,
    giornateEquivalenti: 10,
    compensoLordo:       650.00
  },

  compenso: {
    retribuzione:        650.00,
    straordinariImporto: 70.00,
    regalo:              0,
    trasporto:           10.00,
    creditoPrecedente:   0,
    bustaPaga: { importo: 337.98, giornate: 6, note: 'acconto busta mag.' },
    acconti:   { importo: 150.00, count: 1 },
    rate:      { importo: 0,      note: 'nessuna rata' },
    saldoFinale:         242.02,
    balanceStatusLabel:  'Netto da ricevere'
  },

  presenze: [
    { data:  1, tipo: 'absent' },
    { data:  2, tipo: 'absent' },
    { data:  3, tipo: 'rest' },
    { data:  4, tipo: 'absent' },
    { data:  5, tipo: 'absent' },
    { data:  6, tipo: 'absent' },
    { data:  7, tipo: 'absent' },
    { data:  8, tipo: 'worked', ore: 7, task: 'Leonora' },
    { data:  9, tipo: 'worked', ore: 7, task: 'Leonora' },
    { data: 10, tipo: 'rest' },
    { data: 11, tipo: 'worked', ore: 7, task: 'Leonora' },
    { data: 12, tipo: 'worked', ore: 7, task: 'Leonora' },
    { data: 13, tipo: 'worked', ore: 7, task: 'Leonora' },
    { data: 14, tipo: 'worked', ore: 7, task: 'Leonora' },
    { data: 15, tipo: 'worked', ore: 7, task: 'Leonora' },
    { data: 16, tipo: 'worked', ore: 7, task: 'Leonora' },
    { data: 17, tipo: 'worked', ore: 7, task: 'Straord.', isOvertime: true },
    { data: 18, tipo: 'worked', ore: 7, task: 'Leonora' },
    { data: 19, tipo: 'worked', ore: 7, task: 'Leonora' },
    { data: 20, tipo: 'absent' },
    { data: 21, tipo: 'absent' },
    { data: 22, tipo: 'absent' },
    { data: 23, tipo: 'absent' },
    { data: 24, tipo: 'rest' },
    { data: 25, tipo: 'absent' },
    { data: 26, tipo: 'absent' },
    { data: 27, tipo: 'absent' },
    { data: 28, tipo: 'absent' },
    { data: 29, tipo: 'absent' },
    { data: 30, tipo: 'absent' },
    { data: 31, tipo: 'rest' }
  ],

  note: 'Straordinario domenica 17/05. Busta pagata il 28/05. Nessuna pendenza.'
};

// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  try {
    console.log('[test] Building data...');
    const data = buildEmployeeReportData(testInput);

    console.log('[test] Dipendente :', data.dipendente.nome);
    console.log('[test] Periodo    :', data.periodo.header);
    console.log('[test] Calendario :', data.calendario.length, 'celle');
    console.log('[test] Saldo      :', data.compenso.saldoFinale);
    console.log('[test] Template   :', TEMPLATE_PATH);

    if (!fs.existsSync(TEMPLATE_PATH)) {
      throw new Error('Template non trovato: ' + TEMPLATE_PATH);
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    console.log('[test] Rendering PDF...');
    const pdf = await renderToPDF(TEMPLATE_PATH, data);

    fs.writeFileSync(OUTPUT_PATH, pdf);
    console.log('[test] ✓ PDF salvato in:', OUTPUT_PATH);
    console.log('[test] Dimensione:', Math.round(pdf.length / 1024), 'KB');

  } catch (err) {
    console.error('[test] ✗ Errore:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
