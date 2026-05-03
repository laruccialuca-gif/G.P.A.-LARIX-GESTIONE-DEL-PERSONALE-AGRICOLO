function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function createFixedHoliday(month, day, label) {
  return { month, day, label };
}

const FIXED_ITALIAN_HOLIDAYS = [
  createFixedHoliday(1, 1, 'Capodanno'),
  createFixedHoliday(1, 6, 'Epifania'),
  createFixedHoliday(4, 25, 'Festa della Liberazione'),
  createFixedHoliday(5, 1, 'Festa dei Lavoratori'),
  createFixedHoliday(6, 2, 'Festa della Repubblica'),
  createFixedHoliday(8, 15, 'Ferragosto'),
  createFixedHoliday(11, 1, 'Ognissanti'),
  createFixedHoliday(12, 8, 'Immacolata Concezione'),
  createFixedHoliday(12, 25, 'Natale'),
  createFixedHoliday(12, 26, 'Santo Stefano'),
];

function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month - 1, day);
}

function getItalianHolidayMap(year) {
  const holidayMap = new Map();

  for (const holiday of FIXED_ITALIAN_HOLIDAYS) {
    const date = new Date(year, holiday.month - 1, holiday.day);
    holidayMap.set(formatDateKey(date), holiday.label);
  }

  const easterSunday = getEasterSunday(year);
  const easterMonday = new Date(easterSunday);
  easterMonday.setDate(easterSunday.getDate() + 1);

  holidayMap.set(formatDateKey(easterSunday), 'Pasqua');
  holidayMap.set(formatDateKey(easterMonday), "Lunedi dell'Angelo");

  return holidayMap;
}

function getCalendarDayInfo(date) {
  const holidayMap = getItalianHolidayMap(date.getFullYear());
  const dateKey = formatDateKey(date);
  const holidayLabel = holidayMap.get(dateKey) || null;
  const isSunday = date.getDay() === 0;
  const isHoliday = !!holidayLabel;

  return {
    dateKey,
    isSunday,
    isHoliday,
    holidayLabel,
    isSpecialDay: isSunday || isHoliday,
  };
}

export {
  FIXED_ITALIAN_HOLIDAYS,
  formatDateKey,
  getCalendarDayInfo,
  getItalianHolidayMap,
};
