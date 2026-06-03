const MONTH_ALIASES = {
  gennaio: '01',
  febbr: '02',
  marzo: '03',
  aprile: '04',
  maggio: '05',
  giugno: '06',
  luglio: '07',
  agosto: '08',
  settembre: '09',
  ottobre: '10',
  novembre: '11',
  dicembre: '12',
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,;:!?()[\]{}"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function removeMonthAndYear(text) {
  let next = ` ${text} `;
  Object.keys(MONTH_ALIASES).forEach((alias) => {
    next = next.replace(new RegExp(`\\b${alias}\\w*\\b`, 'g'), ' ');
  });
  next = next.replace(/\b20\d{2}\b/g, ' ');
  return compactSpaces(next);
}

function extractMonthInfo(text, fallbackYear) {
  let foundMonth = '';
  Object.entries(MONTH_ALIASES).forEach(([alias, month]) => {
    if (!foundMonth && new RegExp(`\\b${alias}\\w*\\b`).test(text)) {
      foundMonth = month;
    }
  });

  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : Number(fallbackYear);
  if (!foundMonth) {
    return {
      month: '',
      year: Number.isFinite(year) ? year : new Date().getFullYear(),
      monthKey: '',
    };
  }

  return {
    month: foundMonth,
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    monthKey: `${Number.isFinite(year) ? year : new Date().getFullYear()}-${foundMonth}`,
  };
}

function stripNavigationWords(text) {
  return compactSpaces(
    text
      .replace(/\b(apri|apri il|apri lo|apri la|vai|vai a|vai al|vai alla|vai allo|mostrami|mostra|cerca|apri preview|apri report|apri storico)\b/g, ' ')
      .replace(/\b(di|del|della|dello|dei|degli|delle|il|lo|la|i|gli|le|a|al|alla|allo)\b/g, ' ')
  );
}

function detectTarget(text) {
  if (/preview pagamenti/.test(text)) return 'preview-pagamenti';
  if (/stampa documenti|documenti/.test(text)) return 'stampa-documenti';
  if (/operai assunti/.test(text)) return 'operai-assunti';
  if (/comunicazione/.test(text)) return 'comunicazione';
  if (/storico/.test(text)) return 'storico-operaio';
  if (/presenze/.test(text)) return 'presenze';
  if (/\breport\b/.test(text)) return 'report';
  if (/\bdipendenti\b/.test(text) || /^cerca\b/.test(text)) return 'dipendenti';
  return '';
}

export function parseLarixCommand(command, options = {}) {
  const fallbackYear = Number(options.selectedYear) || new Date().getFullYear();
  const normalized = normalizeText(command);
  const target = detectTarget(normalized);
  const monthInfo = extractMonthInfo(normalized, fallbackYear);
  const withoutDate = removeMonthAndYear(normalized);
  const stripped = stripNavigationWords(withoutDate);

  let employeeTerm = '';
  let teamTerm = '';

  if (target === 'report' && /\bsquadra\b/.test(stripped)) {
    teamTerm = compactSpaces(stripped.replace(/\breport\b/g, '').replace(/\bsquadra\b/g, ' '));
  } else if (target === 'report') {
    employeeTerm = compactSpaces(stripped.replace(/\breport\b/g, ' '));
  } else if (target === 'storico-operaio') {
    employeeTerm = compactSpaces(stripped.replace(/\bstorico\b/g, ' '));
  } else if (target === 'dipendenti') {
    employeeTerm = compactSpaces(stripped.replace(/\bdipendenti\b/g, ' '));
  }

  return {
    raw: String(command || '').trim(),
    normalized,
    target,
    month: monthInfo.month,
    year: monthInfo.year,
    monthKey: monthInfo.monthKey,
    employeeTerm,
    teamTerm,
  };
}

export function formatLarixMonthKey(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return '';
  return monthKey;
}

