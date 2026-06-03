'use strict';

/**
 * @typedef {'outside'|'empty'|'rest'|'absent'|'worked'} DayType
 *
 * @typedef {Object} PresenzaInput
 * @property {number} data                  - Day of month (1–31)
 * @property {DayType} tipo
 * @property {number}  [ore]                - Hours worked (only for tipo='worked')
 * @property {string}  [task]               - Task label shown on the day cell
 * @property {boolean} [isOvertime]         - True for Sunday/extra work (styles task bold)
 *
 * @typedef {Object} BustaPagaInput
 * @property {number} importo
 * @property {number} giornate
 * @property {string} note
 *
 * @typedef {Object} AccontiInput
 * @property {number} importo
 * @property {number} count
 *
 * @typedef {Object} RateInput
 * @property {number} importo
 * @property {string} note
 *
 * @typedef {Object} EmployeeReportInput
 * @property {string} squadra               - Team name, e.g. "Leonora"
 * @property {string} generatoDa            - App version string, e.g. "GPA 1.0.5"
 * @property {Object} periodo
 * @property {string} periodo.inizioISO     - "YYYY-MM-DD"
 * @property {string} periodo.fineISO       - "YYYY-MM-DD"
 *
 * @property {Object} dipendente
 * @property {string} dipendente.nome
 * @property {string} dipendente.ruolo      - Role/crop shown as chip, e.g. "Raccolta"
 * @property {string} dipendente.markerLabel        - Short label on worked days & chip
 * @property {string} dipendente.markerLegendLabel  - Full label in calendar legend
 * @property {'paid'|'unpaid'|'partial'} dipendente.paymentStatus
 * @property {string} dipendente.paymentStatusLabel - e.g. "Pagato"
 * @property {number} dipendente.dailyRate           - e.g. 65.00
 * @property {number} dipendente.overtimeRate        - e.g. 10.00
 * @property {number} dipendente.standardHours       - e.g. 7
 *
 * @property {Object} kpi                   - All pre-computed by caller
 * @property {number} kpi.giornateIntere
 * @property {number} kpi.oreResidue
 * @property {number} kpi.oreTotali
 * @property {number} kpi.straordinari      - Total overtime hours
 * @property {number} kpi.giornateEquivalenti
 * @property {number} kpi.compensoLordo    - Theoretical monthly gross
 *
 * @property {Object} compenso              - All pre-computed by caller
 * @property {number} compenso.retribuzione
 * @property {number} compenso.straordinariImporto
 * @property {number} compenso.regalo
 * @property {number} compenso.trasporto
 * @property {number} compenso.creditoPrecedente
 * @property {BustaPagaInput} compenso.bustaPaga
 * @property {AccontiInput}   compenso.acconti
 * @property {RateInput}      compenso.rate
 * @property {number} compenso.saldoFinale
 * @property {string} compenso.balanceStatusLabel  - e.g. "Netto da ricevere"
 *
 * @property {PresenzaInput[]} presenze     - Only significant days; others default to 'empty'
 * @property {string} note                  - Free text notes
 */

const GIORNI_NOMI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const MESI_NOMI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

function formatWorkedTimeLabel(days, residualHours) {
  const safeDays = Number(days || 0);
  const safeHours = Number(residualHours || 0);
  const dayLabel = `${Number.isInteger(safeDays) ? safeDays : safeDays.toLocaleString('it-IT', { maximumFractionDigits: 2 })} gg`;

  if (safeHours <= 0) {
    return dayLabel;
  }

  return `${dayLabel} + ${safeHours.toLocaleString('it-IT', { maximumFractionDigits: 2 })} h`;
}

function formatCurrencyValue(value) {
  return `€ ${Number(value || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizeSelectedPayrollDays(value) {
  let source = value;
  if (typeof source === 'string') {
    const text = source.trim();
    if (!text) {
      source = [];
    } else {
      try {
        source = JSON.parse(text);
      } catch {
        source = text.split(/[,\s;]+/);
      }
    }
  }
  if (!Array.isArray(source)) return [];
  return [...new Set(
    source
      .map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31)
  )].sort((a, b) => a - b);
}

/**
 * Build the render-ready data object for EmployeeReportTemplate.html.
 * All economic calculations must be pre-computed by the caller.
 *
 * @param {EmployeeReportInput} input
 * @returns {Object} Data object ready for window.loadData()
 */
function buildEmployeeReportData(input) {
  const inizio = new Date(input.periodo.inizioISO + 'T00:00:00');
  const fine   = new Date(input.periodo.fineISO   + 'T00:00:00');

  const meseNome = MESI_NOMI[inizio.getMonth()];
  const anno     = inizio.getFullYear();

  const fmtDate = (d) =>
    String(d.getDate()).padStart(2, '0') + '/' +
    String(d.getMonth() + 1).padStart(2, '0') + '/' +
    d.getFullYear();

  const { kpi, compenso, dipendente } = input;

  const tariffa    = dipendente.dailyRate;
  const otRate     = dipendente.overtimeRate;
  const tariffaFmt = tariffa.toLocaleString('it-IT', { minimumFractionDigits: 2 });
  const otRateFmt  = otRate.toLocaleString('it-IT', { minimumFractionDigits: 2 });
  const otHFmt     = kpi.straordinari.toLocaleString('it-IT', { maximumFractionDigits: 1 });
  const workedTimeLabel = formatWorkedTimeLabel(kpi.giornateIntere, kpi.oreResidue);
  const selectedPayrollDays = normalizeSelectedPayrollDays(compenso.bustaPaga.selectedPayrollDays ?? compenso.bustaPaga.selected_payroll_days);
  const residualHourlyRate = Number(compenso.residualHourlyRate || 0);
  const regularDaysCompensation = Number(compenso.regularDaysCompensation || 0);
  const residualHoursCompensation = Number(compenso.residualHoursCompensation || 0);
  const residualHours = Number(compenso.residualHours || 0);

  const retribuzioneLines = [];
  if (Number(kpi.giornateIntere || 0) > 0) {
    retribuzioneLines.push(
      `${kpi.giornateIntere} gg × € ${tariffaFmt} = ${formatCurrencyValue(regularDaysCompensation)}`
    );
  }
  if (residualHours > 0) {
    retribuzioneLines.push(
      `${residualHours.toLocaleString('it-IT', { maximumFractionDigits: 2 })} h × € ${residualHourlyRate.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} = ${formatCurrencyValue(residualHoursCompensation)}`
    );
  }
  const retribuzioneNote = retribuzioneLines.length
    ? retribuzioneLines.join(' + ')
    : workedTimeLabel + ' · tariffa € ' + tariffaFmt;

  // Voce extra (storica "Regalo"): se importo positivo finisce nei CREDITI,
  // se negativo si converte in valore positivo e va nei DEBITI (trattenuta).
  const regaloSigned = Number(compenso.regalo || 0);
  const regaloCredit = regaloSigned > 0 ? regaloSigned : 0;
  const regaloDebit = regaloSigned < 0 ? Math.abs(regaloSigned) : 0;

  const totalCredits =
    compenso.retribuzione +
    compenso.straordinariImporto +
    regaloCredit +
    compenso.trasporto +
    compenso.creditoPrecedente;

  const totalDebits =
    compenso.bustaPaga.importo +
    compenso.acconti.importo +
    compenso.rate.importo +
    regaloDebit;

  return {
    brand:      '',
    squadra:    input.squadra,
    generatoDa: input.generatoDa,
    periodo: {
      mese:   meseNome + ' ' + anno,
      header: String(inizio.getDate()).padStart(2, '0') +
              ' — ' + String(fine.getDate()).padStart(2, '0') +
              ' ' + meseNome + ' ' + anno,
      footer: fmtDate(inizio) + ' — ' + fmtDate(fine)
    },
    dipendente: {
      nome:                dipendente.nome,
      ruolo:               dipendente.ruolo,
      markerLabel:         dipendente.markerLabel,
      markerLegendLabel:   dipendente.markerLegendLabel,
      paymentStatus:       dipendente.paymentStatus,
      paymentStatusLabel:  dipendente.paymentStatusLabel,
      dailyRate:           tariffa,
      overtimeRate:        otRate,
      standardHours:       dipendente.standardHours
    },
    kpi: {
      giornateIntere:     kpi.giornateIntere,
      oreResidue:         kpi.oreResidue,
      oreTotali:          kpi.oreTotali,
      straordinari:       kpi.straordinari,
      giornateEquivalenti: kpi.giornateEquivalenti,
      compensoLordo:      kpi.compensoLordo
    },
    compenso: {
      retribuzione:         compenso.retribuzione,
      retribuzioneNote:     retribuzioneNote,
      straordinariImporto:  compenso.straordinariImporto,
      straordinariNote:     otHFmt + ' h × € ' + otRateFmt,
      regalo:               compenso.regalo,
      // L'etichetta in stampa salvata dal report (giftLabel / regalo_descrizione / regaloNote / regaloLabel)
      // arriva al template attraverso `regaloNote`. Accetta sia `regaloNote` che `regaloLabel`.
      regaloNote:           String(compenso.regaloNote || compenso.regaloLabel || '').trim(),
      trasporto:            compenso.trasporto,
      creditoPrecedente:    compenso.creditoPrecedente,
      totalCredits,
      bustaPaga:            compenso.bustaPaga,
      selectedPayrollDays,
      selectedPayrollDaysLabel: selectedPayrollDays.length ? selectedPayrollDays.join(', ') : '',
      showSelectedPayrollDaysInReport: !!compenso.bustaPaga.showSelectedPayrollDaysInReport,
      acconti:              compenso.acconti,
      rate:                 compenso.rate,
      totalDebits,
      saldoFinale:          compenso.saldoFinale,
      balanceStatusLabel:   compenso.balanceStatusLabel,
      chiusuraSaldo:        compenso.chiusuraSaldo || null
    },
    calendario: buildCalendar(inizio, fine, input.presenze),
    note:       input.note || ''
  };
}

/**
 * Build the flat calendar array (5 or 6 weeks × 7 days).
 * Days not listed in `presenze` default to tipo='empty'.
 *
 * @param {Date} inizio
 * @param {Date} fine
 * @param {PresenzaInput[]} presenze
 * @returns {Object[]}
 */
function buildCalendar(inizio, fine, presenze) {
  const totalDays = fine.getDate();
  const firstDow  = (new Date(inizio.getFullYear(), inizio.getMonth(), 1).getDay() + 6) % 7;
  const totalCells = Math.ceil((firstDow + totalDays) / 7) * 7;

  const presenzeByDay = {};
  (presenze || []).forEach(function(p) { presenzeByDay[p.data] = p; });

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDow + 1;

    if (dayNum < 1 || dayNum > totalDays) {
      cells.push({ tipo: 'outside' });
      continue;
    }

    const dowName  = GIORNI_NOMI[i % 7];
    const presenza = presenzeByDay[dayNum];

    if (!presenza) {
      cells.push({ tipo: 'empty', data: dayNum, giorno: dowName });
    } else {
      cells.push(Object.assign({ giorno: dowName }, presenza));
    }
  }

  return cells;
}

module.exports = { buildEmployeeReportData };

// ---------------------------------------------------------------------------
// Example data — MD Sabbir Fakir · Squadra Leonora · Maggio 2026
// ---------------------------------------------------------------------------
if (require.main === module) {
  const exampleInput = {
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

    // All values pre-computed by GPA's payroll engine
    kpi: {
      giornateIntere:      10,
      oreResidue:          0,
      oreTotali:           77,    // 10 × 7h regular + 1 × 7h overtime
      straordinari:        7,
      giornateEquivalenti: 10,
      compensoLordo:       650.00  // 10 × 65
    },

    compenso: {
      retribuzione:        650.00,
      straordinariImporto: 70.00,   // 7h × €10
      regalo:              0,
      trasporto:           10.00,
      creditoPrecedente:   0,
      bustaPaga: {
        importo: 337.98,
        giornate: 6,
        note: 'acconto busta mag.',
        selectedPayrollDays: [8, 11, 12, 13, 14, 18],
        showSelectedPayrollDaysInReport: true,
      },
      acconti:   { importo: 150.00, count: 1 },
      rate:      { importo: 0,      note: 'nessuna rata' },
      saldoFinale:         242.02,
      balanceStatusLabel:  'Netto da ricevere'
    },

    presenze: [
      { data:  1, tipo: 'absent' },
      { data:  2, tipo: 'absent' },
      { data:  3, tipo: 'rest' },           // Dom
      { data:  4, tipo: 'absent' },
      { data:  5, tipo: 'absent' },
      { data:  6, tipo: 'absent' },
      { data:  7, tipo: 'absent' },
      { data:  8, tipo: 'worked', ore: 7,  task: 'Leonora'  },
      { data:  9, tipo: 'worked', ore: 7,  task: 'Leonora'  },
      { data: 10, tipo: 'rest' },           // Dom
      { data: 11, tipo: 'worked', ore: 7,  task: 'Leonora'  },
      { data: 12, tipo: 'worked', ore: 7,  task: 'Leonora'  },
      { data: 13, tipo: 'worked', ore: 7,  task: 'Leonora'  },
      { data: 14, tipo: 'worked', ore: 7,  task: 'Leonora'  },
      { data: 15, tipo: 'worked', ore: 7,  task: 'Leonora'  },
      { data: 16, tipo: 'worked', ore: 7,  task: 'Leonora'  },
      { data: 17, tipo: 'worked', ore: 7,  task: 'Straord.', isOvertime: true }, // Dom OT
      { data: 18, tipo: 'worked', ore: 7,  task: 'Leonora'  },
      { data: 19, tipo: 'worked', ore: 7,  task: 'Leonora'  },
      { data: 20, tipo: 'absent' },
      { data: 21, tipo: 'absent' },
      { data: 22, tipo: 'absent' },
      { data: 23, tipo: 'absent' },
      { data: 24, tipo: 'rest' },           // Dom
      { data: 25, tipo: 'absent' },
      { data: 26, tipo: 'absent' },
      { data: 27, tipo: 'absent' },
      { data: 28, tipo: 'absent' },
      { data: 29, tipo: 'absent' },
      { data: 30, tipo: 'absent' },
      { data: 31, tipo: 'rest' }            // Dom
    ],

    note: 'Straordinario domenica 17/05. Busta pagata il 28/05. Nessuna pendenza.'
  };

  const result = buildEmployeeReportData(exampleInput);
  console.log(JSON.stringify(result, null, 2));
}
