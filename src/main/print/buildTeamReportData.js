const path = require('node:path');

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCurrency(value) {
  return Math.round(normalizeNumber(value) * 100) / 100;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundCurrency(value));
}

function formatHours(value) {
  const normalized = roundCurrency(value);
  if (Number.isInteger(normalized)) {
    return String(normalized);
  }
  return normalized.toFixed(2).replace(/\.?0+$/, '');
}

function buildTeamReportData(input = {}) {
  const source = {
    teamName: 'Squadra Leonora',
    monthLabel: 'Maggio 2026',
    standardDayHours: 7,
    totalHours: 660.5,
    headcountPresences: 105,
    equivalentDays: 94.36,
    grossCompensation: 6133.21,
    transportEnabled: true,
    transportDescription: 'Trasporto squadra',
    transportAmount: 150,
    giftEnabled: true,
    giftDescription: 'Premio raccolta',
    giftAmount: 33.93,
    advancesTotal: 0,
    payrollComponentsTotal: 3267.14,
    note: 'Mock Leonora per validazione nuovo template stampa squadra.',
    payrollComponents: [
      { label: 'Mario Rossi', days: 10, amount: 550 },
      { label: 'Giuseppe Verdi', days: 9, amount: 510 },
      { label: 'Anna Bianchi', days: 8, amount: 468.14 },
      { label: 'Totale altri componenti', days: 0, amount: 1739 },
    ],
    advances: [],
    generatedBy: 'buildTeamReportData.js',
    ...input,
  };

  const standardDayHours = normalizeNumber(source.standardDayHours, 7) || 7;
  const totalHours = roundCurrency(source.totalHours);
  const equivalentDays = roundCurrency(
    source.equivalentDays || (standardDayHours > 0 ? totalHours / standardDayHours : 0)
  );
  const grossCompensation = roundCurrency(source.grossCompensation);
  const transportAmount = source.transportEnabled ? roundCurrency(source.transportAmount) : 0;
  const giftAmount = source.giftEnabled ? roundCurrency(source.giftAmount) : 0;
  const advancesTotal = roundCurrency(source.advancesTotal);
  const payrollComponentsTotal = roundCurrency(source.payrollComponentsTotal);
  const finalBalance = roundCurrency(
    grossCompensation + transportAmount + giftAmount - advancesTotal - payrollComponentsTotal
  );

  return {
    meta: {
      brand: 'GPA 1.0.5',
      templateName: 'TeamReportTemplate',
      generatedAt: new Date().toISOString(),
      generatedBy: source.generatedBy,
      sourceFile: path.basename(__filename),
    },
    team: {
      name: String(source.teamName || '').trim(),
      monthLabel: String(source.monthLabel || '').trim(),
      standardDayHours,
      totalHours,
      totalHoursLabel: `${formatHours(totalHours)} h`,
      headcountPresences: normalizeNumber(source.headcountPresences),
      headcountPresencesLabel: `${formatHours(source.headcountPresences)} pres.`,
      equivalentDays,
      equivalentDaysLabel: `${formatHours(equivalentDays)} gg eq.`,
    },
    economics: {
      grossCompensation,
      grossCompensationLabel: formatCurrency(grossCompensation),
      transportEnabled: !!source.transportEnabled,
      transportDescription: String(source.transportDescription || 'Trasporto squadra'),
      transportAmount,
      transportAmountLabel: formatCurrency(transportAmount),
      giftEnabled: !!source.giftEnabled,
      giftDescription: String(source.giftDescription || 'Regalo squadra'),
      giftAmount,
      giftAmountLabel: formatCurrency(giftAmount),
      advancesTotal,
      advancesTotalLabel: formatCurrency(advancesTotal),
      payrollComponentsTotal,
      payrollComponentsTotalLabel: formatCurrency(payrollComponentsTotal),
      finalBalance,
      finalBalanceLabel: formatCurrency(finalBalance),
      formulaLabel: `${formatCurrency(grossCompensation)} + ${formatCurrency(transportAmount)} + ${formatCurrency(giftAmount)} - ${formatCurrency(advancesTotal)} - ${formatCurrency(payrollComponentsTotal)} = ${formatCurrency(finalBalance)}`,
    },
    items: {
      advances: Array.isArray(source.advances) ? source.advances : [],
      payrollComponents: Array.isArray(source.payrollComponents) ? source.payrollComponents.map((item) => ({
        label: String(item.label || 'Componente squadra'),
        days: roundCurrency(item.days),
        daysLabel: item.days > 0 ? `${formatHours(item.days)} gg` : '-',
        amount: roundCurrency(item.amount),
        amountLabel: formatCurrency(item.amount),
      })) : [],
    },
    note: String(source.note || '').trim(),
  };
}

function buildMockLeonoraTeamReportData() {
  return buildTeamReportData();
}

if (require.main === module) {
  const payload = buildMockLeonoraTeamReportData();
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

module.exports = {
  buildTeamReportData,
  buildMockLeonoraTeamReportData,
  formatCurrency,
  formatHours,
};
