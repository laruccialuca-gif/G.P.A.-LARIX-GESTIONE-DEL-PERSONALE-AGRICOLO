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

function formatDecimal(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(normalizeNumber(value));
}

function formatHours(value) {
  const normalized = roundCurrency(value);
  if (Number.isInteger(normalized)) {
    return String(normalized);
  }
  return normalized.toFixed(2).replace(/\.?0+$/, '');
}

function formatHoursLabel(value) {
  return formatDecimal(roundCurrency(value), 2);
}

function formatMonthLabel(year, monthIndex) {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return new Intl.DateTimeFormat('it-IT', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date).replace(/^./, (letter) => letter.toUpperCase());
}

function formatPeriodLabel(year, monthIndex) {
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  const formatter = new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${formatter.format(start)} — ${formatter.format(end)}`;
}

function formatShortDate(dateLike) {
  if (!dateLike) {
    return '';
  }
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    return String(dateLike);
  }
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function safeDivide(value, divisor) {
  const safeDivisor = normalizeNumber(divisor, 0);
  if (!safeDivisor) {
    return 0;
  }
  return roundCurrency(normalizeNumber(value, 0) / safeDivisor);
}

function computeWorkedSummary(totalHours, standardDayHours) {
  const safeStandard = normalizeNumber(standardDayHours, 7) || 7;
  const fullDays = Math.floor(totalHours / safeStandard);
  const remainingHours = roundCurrency(totalHours - fullDays * safeStandard);
  if (remainingHours <= 0) {
    return `${fullDays} gg`;
  }
  return `${fullDays} gg + ${formatDecimal(remainingHours, 2)} ore`;
}

function buildLegend() {
  return [
    { className: 'heavy', label: 'Intensa (≥ 70 h)' },
    { className: '', label: 'Piena' },
    { className: 'light', label: 'Ridotta' },
    { className: 'rest', label: 'Riposo' },
    { type: 'text', label: '· nessuna presenza' },
  ];
}

function getIntensity(totalHours) {
  if (totalHours >= 70) {
    return 'heavy';
  }
  if (totalHours > 0 && totalHours < 40) {
    return 'light';
  }
  return '';
}

function createWorkDay(dateLabel, headcount, hoursPerPerson, standardDayHours) {
  const people = roundCurrency(headcount);
  const hoursEach = roundCurrency(hoursPerPerson);
  const totalHours = roundCurrency(people * hoursEach);
  const equivalentDays = safeDivide(totalHours, standardDayHours);
  return {
    type: 'work',
    dateLabel,
    mainLabel: `${formatHours(people)}×${formatHours(hoursEach)}`,
    eqLabel: `${formatDecimal(equivalentDays, 2)} gg eq.`,
    hoursValueLabel: formatHoursLabel(totalHours),
    intensity: getIntensity(totalHours),
  };
}

function createEmptyMonthCalendar(year, monthIndex) {
  return {
    headers: ['Sett.', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'],
    weeks: buildCalendarFromEntries([], year, monthIndex, 7)?.weeks || [],
    legend: buildLegend(),
  };
}

function buildCalendarFromEntries(entries, year, monthIndex, standardDayHours) {
  if (!Array.isArray(entries) || !entries.length) {
    return null;
  }

  const entryMap = new Map();
  for (const entry of entries) {
    const dayNumber = normalizeNumber(
      entry.day ?? entry.dayOfMonth ?? entry.day_of_month ?? entry.dateNumber,
      NaN
    );
    const dateValue = entry.date || entry.workDate || entry.work_date || entry.isoDate;
    const date = Number.isFinite(dayNumber)
      ? new Date(Date.UTC(year, monthIndex, dayNumber))
      : new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const key = date.toISOString().slice(0, 10);
    const headcount = normalizeNumber(
      entry.headcount ??
        entry.people ??
        entry.personCount ??
        entry.person_count ??
        entry.workers,
      0
    );
    const hoursPerPerson = normalizeNumber(
      entry.hoursPerPerson ??
        entry.hours_per_person ??
        entry.hoursEach ??
        entry.hours_each ??
        entry.overtime_hours ??
        entry.hours,
      0
    );
    const isRest = Boolean(entry.isRest ?? entry.rest ?? entry.dayType === 'rest');

    if (headcount > 0 && hoursPerPerson > 0) {
      entryMap.set(key, {
        type: 'work',
        headcount,
        hoursPerPerson,
      });
      continue;
    }

    if (isRest) {
      entryMap.set(key, { type: 'rest' });
    }
  }

  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  const totalDays = lastDay.getUTCDate();
  const offset = (firstDay.getUTCDay() + 6) % 7;
  const weeks = [];
  const headers = ['Sett.', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  let cursor = 1 - offset;
  let weekIndex = 1;

  while (cursor <= totalDays) {
    const days = [];
    for (let column = 0; column < 7; column += 1, cursor += 1) {
      if (cursor < 1 || cursor > totalDays) {
        days.push({ type: 'outside' });
        continue;
      }

      const date = new Date(Date.UTC(year, monthIndex, cursor));
      const weekdayLabel = new Intl.DateTimeFormat('it-IT', {
        weekday: 'short',
        timeZone: 'UTC',
      })
        .format(date)
        .replace('.', '');
      const dateLabel = `${cursor} ${weekdayLabel.replace(/^./, (letter) => letter.toUpperCase())}`;
      const isoKey = date.toISOString().slice(0, 10);
      const entry = entryMap.get(isoKey);

      if (entry?.type === 'work') {
        days.push(createWorkDay(dateLabel, entry.headcount, entry.hoursPerPerson, standardDayHours));
      } else if (entry?.type === 'rest' || column >= 5) {
        days.push({ type: 'rest', dateLabel, restLabel: 'Riposo' });
      } else {
        days.push({ type: 'empty', dateLabel });
      }
    }

    weeks.push({
      label: `S${weekIndex}`,
      days,
    });
    weekIndex += 1;
  }

  return {
    headers,
    weeks,
    legend: buildLegend(),
  };
}

function toComponentItem(item, index) {
  const amount = roundCurrency(item.amount ?? item.total ?? item.value);
  const selectedDays = normalizeSelectedPayrollDays(
    item.selectedPayrollDays ??
      item.selected_payroll_days ??
      item.selected_payroll_days_json ??
      item.selectedDays
  );
  const days = selectedDays.length
    ? selectedDays.length
    : roundCurrency(item.days ?? item.dayCount ?? item.day_count ?? 0);
  return {
    indexLabel: String(index + 1).padStart(2, '0'),
    label: String(item.label || item.name || item.employeeName || `Componente ${index + 1}`),
    selectedDays,
    selectedDaysLabel: selectedDays.length ? selectedDays.join(',') : '-',
    days,
    daysLabel: days > 0 ? formatDecimal(days, 2) : '—',
    amount,
    amountLabel: amount ? `− ${formatCurrency(Math.abs(amount))}` : '—',
  };
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

function buildTeamReportData(input = {}) {
  const source = {
    teamId: null,
    teamName: '',
    monthReference: '',
    monthLabel: '',
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    standardDayHours: 7,
    dailyRate: 0,
    totalHours: 0,
    headcountPresences: 0,
    equivalentDays: 0,
    grossCompensation: 0,
    transportEnabled: false,
    transportDescription: 'Trasporto squadra',
    transportAmount: 0,
    giftEnabled: false,
    giftDescription: 'Regalo squadra',
    giftAmount: 0,
    previousBalanceType: '',
    previousBalanceAmount: 0,
    previousBalanceNote: '',
    advancesTotal: 0,
    payrollComponentsTotal: 0,
    note: '',
    payrollComponents: [],
    calendarEntries: [],
    advances: [],
    generatedBy: 'buildTeamReportData.js',
    ...input,
  };

  const year = normalizeNumber(source.year, new Date().getFullYear());
  const month = normalizeNumber(source.month, new Date().getMonth() + 1);
  const monthIndex = Math.max(0, month - 1);
  const monthLabel = String(source.monthLabel || formatMonthLabel(year, monthIndex)).trim();
  const periodLabel = String(source.periodLabel || formatPeriodLabel(year, monthIndex)).trim();
  const standardDayHours = normalizeNumber(source.standardDayHours, 7) || 7;
  const totalHours = roundCurrency(source.totalHours);
  const equivalentDays = roundCurrency(
    source.equivalentDays || safeDivide(totalHours, standardDayHours)
  );
  const headcountPresences = roundCurrency(source.headcountPresences);
  const grossCompensation = roundCurrency(source.grossCompensation);
  const transportAmount = source.transportEnabled ? roundCurrency(source.transportAmount) : 0;
  const giftAmount = source.giftEnabled ? roundCurrency(source.giftAmount) : 0;
  const previousBalanceType = String(source.previousBalanceType || source.previous_balance_type || '').trim().toLowerCase();
  const previousBalanceAmount = roundCurrency(source.previousBalanceAmount ?? source.previous_balance_amount);
  const previousBalanceCredit = previousBalanceType === 'credit' ? previousBalanceAmount : 0;
  const previousBalanceDebt = previousBalanceType === 'debt' ? previousBalanceAmount : 0;
  const previousBalanceNote = String(source.previousBalanceNote || source.previous_balance_note || '').trim();
  const advancesTotal = roundCurrency(source.advancesTotal);
  const payrollComponentsTotal = roundCurrency(source.payrollComponentsTotal);
  const finalBalance = roundCurrency(
    grossCompensation +
      transportAmount +
      giftAmount +
      previousBalanceCredit -
      previousBalanceDebt -
      advancesTotal -
      payrollComponentsTotal
  );
  const footerRange =
    source.periodStart && source.periodEnd
      ? `${formatShortDate(source.periodStart)} — ${formatShortDate(source.periodEnd)}`
      : periodLabel;

  const componentsInput = Array.isArray(source.payrollComponents)
    ? source.payrollComponents
    : Array.isArray(source.items?.payrollComponents)
      ? source.items.payrollComponents
      : [];
  const componentItems = componentsInput.map(toComponentItem);
  const componentDaysTotal = roundCurrency(
    componentItems.reduce((sum, item) => sum + normalizeNumber(item.days, 0), 0)
  );
  const runtimeCalendar =
    source.calendario ||
    buildCalendarFromEntries(
      source.calendarEntries || source.calendarDays || source.attendanceEntries || [],
      year,
      monthIndex,
      standardDayHours
    );
  const calendar = runtimeCalendar || createEmptyMonthCalendar(year, monthIndex);

  return {
    title: `Report Squadra · ${String(source.teamName || '').trim()} · ${monthLabel}`,
    meta: {
      brand: 'GPA 1.0.5',
      brandMark: String(source.brandMark || source.teamName || source.companyName || 'gpa').trim().toLowerCase(),
      title: 'Report mensile squadra',
      subtitle: 'Rendicontazione presenze e compenso',
      periodLabel,
      footerLeft: 'Generato da GPA 1.0.5',
      footerRight: `${String(source.teamName || '').trim()} · ${footerRange}`,
      templateName: 'TeamReportTemplate',
      generatedAt: new Date().toISOString(),
      generatedBy: source.generatedBy,
      sourceFile: path.basename(__filename),
    },
    team: {
      id: source.teamId == null ? null : Number(source.teamId),
      name: String(source.teamName || '').trim(),
      monthLabel,
      standardDayHours,
      totalHours,
      totalHoursLabel: `${formatHours(totalHours)} h`,
      headcountPresences,
      headcountPresencesLabel: `${formatHours(headcountPresences)} pres.`,
      equivalentDays,
      equivalentDaysLabel: `${formatDecimal(equivalentDays, 2)} gg eq.`,
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
      previousBalanceType,
      previousBalanceAmount,
      previousBalanceNote,
      previousBalanceCredit,
      previousBalanceDebt,
      advancesTotal,
      advancesTotalLabel: formatCurrency(advancesTotal),
      payrollComponentsTotal,
      payrollComponentsTotalLabel: formatCurrency(payrollComponentsTotal),
      finalBalance,
      finalBalanceLabel: formatCurrency(finalBalance),
      formulaLabel: `${formatCurrency(grossCompensation)} + ${formatCurrency(transportAmount)} + ${formatCurrency(giftAmount)} + ${formatCurrency(previousBalanceCredit)} - ${formatCurrency(previousBalanceDebt)} - ${formatCurrency(advancesTotal)} - ${formatCurrency(payrollComponentsTotal)} = ${formatCurrency(finalBalance)}`,
    },
    riepilogo: {
      workedSummaryLabel: computeWorkedSummary(totalHours, standardDayHours),
      workedSummaryNoteLine1: 'Giornate intere + ore residue',
      workedSummaryNoteLine2: `(giornata standard = ${formatDecimal(standardDayHours, 2)} h)`,
      totalHoursValue: formatHoursLabel(totalHours),
      totalHoursNoteLine1: 'Sommatoria delle ore di tutti',
      totalHoursNoteLine2: 'i componenti nel mese',
      compensationValue: formatCurrency(grossCompensation),
      compensationNoteLine1: 'Saldo teorico del mese',
      compensationNoteLine2: `(${formatDecimal(equivalentDays, 2)} gg × ${formatCurrency(source.dailyRate || 0)})`,
    },
    calendario: calendar,
    compenso: {
      rows: [
        {
          title: 'Retribuzione calcolata',
          sub: `${formatDecimal(equivalentDays, 2)} gg × ${formatCurrency(source.dailyRate || 0)} — base`,
          amountLabel: formatCurrency(grossCompensation),
          sign: '',
        },
        ...(transportAmount > 0
          ? [{
              title: 'Trasporto squadra',
              sub: String(source.transportDescription || 'Voce positiva inclusa nel saldo finale'),
              amountLabel: `+ ${formatCurrency(transportAmount)}`,
              sign: '+',
            }]
          : []),
        ...(giftAmount > 0
          ? [{
              title: 'Regalo squadra',
              sub: String(source.giftDescription || 'Voce positiva inclusa nel saldo finale'),
              amountLabel: `+ ${formatCurrency(giftAmount)}`,
              sign: '+',
            }]
          : []),
        ...(previousBalanceCredit > 0
          ? [{
              title: 'Credito precedente',
              sub: previousBalanceNote || 'Voce positiva riportata dal periodo precedente',
              amountLabel: `+ ${formatCurrency(previousBalanceCredit)}`,
              sign: '+',
            }]
          : []),
        ...(previousBalanceDebt > 0
          ? [{
              title: 'Debito precedente',
              sub: previousBalanceNote || 'Voce negativa riportata dal periodo precedente',
              amountLabel: `− ${formatCurrency(previousBalanceDebt)}`,
              sign: '-',
            }]
          : []),
        ...(advancesTotal > 0
          ? [{
              title: 'Acconti squadra',
              sub: Array.isArray(source.advances) && source.advances.length
                ? `${source.advances.length} voce${source.advances.length > 1 ? 'i' : ''} registrata${source.advances.length > 1 ? 'e' : ''}`
                : 'Acconti registrati nel mese',
              amountLabel: `- ${formatCurrency(advancesTotal)}`,
              sign: '-',
            }]
          : []),
        {
          title: 'Buste paga componenti',
          sub: `${componentItems.length} componenti · vedi tabella`,
          amountLabel: `− ${formatCurrency(payrollComponentsTotal)}`,
          sign: '-',
        },
        {
          title: 'Saldo finale squadra',
          sub: 'Netto da distribuire',
          amountLabel: formatCurrency(finalBalance),
          kind: 'total',
        },
      ],
    },
    componenti: {
      summaryLabel: `${componentItems.length} comp. · ${formatDecimal(componentDaysTotal, 2)} gg`,
      items: componentItems,
      totalDaysLabel: formatDecimal(componentDaysTotal, 2),
      totalAmountLabel: `− ${formatCurrency(payrollComponentsTotal)}`,
    },
    items: {
      advances: Array.isArray(source.advances) ? source.advances : [],
      payrollComponents: componentItems.map((item) => ({
        label: item.label,
        selectedDays: item.selectedDays,
        selectedDaysLabel: item.selectedDaysLabel,
        days: item.days,
        daysLabel: item.daysLabel,
        amount: item.amount,
        amountLabel: item.amountLabel,
      })),
    },
    note: String(source.note || '').trim(),
  };
}

function buildMockLeonoraTeamReportData() {
  return buildTeamReportData({
    teamId: 1,
    teamName: 'Squadra Leonora',
    monthLabel: 'Maggio 2026',
    year: 2026,
    month: 5,
    standardDayHours: 7,
    dailyRate: 65,
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
      { label: 'Leonora Lleshas', selectedPayrollDays: [8, 11, 12, 13, 14, 18], days: 6, amount: 337.98 },
      { label: 'MD Sabbir Fakir', days: 6, amount: 337.98 },
      { label: 'MD Eyasin Ahmed', days: 6, amount: 337.98 },
      { label: 'Imon Molla', days: 6, amount: 337.98 },
      { label: 'Rifat Munshi', days: 6, amount: 337.98 },
      { label: 'Ebadul Kazi', days: 6, amount: 337.98 },
      { label: 'Mahmoud M. Rabi Wahaballah', days: 6, amount: 337.98 },
      { label: 'Amir Said Fahmi Said', days: 6, amount: 337.98 },
      { label: 'MD Nasir Uddin Sarder', days: 6, amount: 337.98 },
      { label: 'Vasil Beleshi', days: 4, amount: 225.32 },
    ],
  });
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
