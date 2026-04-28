export function formatDisplayDate(value) {
  if (!value) return '—';

  const [year, month, day] = String(value).split('-');
  if (!year || !month || !day) {
    return value;
  }

  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

export function formatDisplayDateTime(value) {
  if (!value) return '—';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
