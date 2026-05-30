const { getDb } = require('./db');

function normalizeMonth(value) {
  return String(value || '').slice(0, 7);
}

function normalizeSigla(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeSelectedDays(value) {
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

function formatDatesLabel(days) {
  return normalizeSelectedDays(days).join('-');
}

function formatGiornate(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0';
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
}

function buildAutoNoteLine(entry) {
  const parts = [];
  const label = String(entry.employee_label || '').trim();
  const giornate = Number(entry.giornate || 0);
  const sigla = normalizeSigla(entry.sigla);
  const days = normalizeSelectedDays(entry.dates);
  const manualNote = String(entry.manual_note || '').trim();

  let head = label;
  if (giornate > 0) {
    head += ` — ${formatGiornate(giornate)} giornate${sigla ? ` ${sigla}` : ''}`;
  } else if (sigla) {
    head += ` — ${sigla}`;
  }
  parts.push(head);

  if (manualNote) {
    parts.push(`note: ${manualNote}`);
  }
  if (days.length) {
    parts.push(`date busta: ${days.join('-')}`);
  }

  return parts.join(' — ');
}

function mapAutoNoteRow(row) {
  const dates = normalizeSelectedDays(row.dates_json);
  return {
    id: Number(row.id),
    month_reference: row.month_reference,
    source_type: row.source_type,
    source_id: Number(row.source_id),
    employee_id: row.employee_id ? Number(row.employee_id) : null,
    employee_label: row.employee_label || '',
    sigla: normalizeSigla(row.sigla),
    giornate: Number(row.giornate || 0),
    dates,
    manual_note: row.manual_note || '',
    sort_order: Number(row.sort_order || 0),
    line: buildAutoNoteLine({
      employee_label: row.employee_label,
      giornate: row.giornate,
      sigla: row.sigla,
      dates,
      manual_note: row.manual_note,
    }),
  };
}

function getAutoReportNotesByMonth(month) {
  const db = getDb();
  const monthReference = normalizeMonth(month);
  if (!monthReference) {
    return { month_reference: '', entries: [], lines: [], text: '' };
  }

  const rows = db.prepare(`
    SELECT *
    FROM report_auto_notes
    WHERE month_reference = ?
    ORDER BY source_type ASC, source_id ASC, sort_order ASC, id ASC
  `).all(monthReference);

  const entries = rows.map(mapAutoNoteRow);
  const lines = entries.map((entry) => entry.line).filter(Boolean);
  return {
    month_reference: monthReference,
    entries,
    lines,
    text: lines.join('\n'),
  };
}

function replaceAutoNotesForSource(db, monthReference, sourceType, sourceId, entries) {
  db.prepare(`
    DELETE FROM report_auto_notes
    WHERE month_reference = ?
      AND source_type = ?
      AND source_id = ?
  `).run(monthReference, sourceType, sourceId);

  if (!entries.length) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO report_auto_notes (
      month_reference, source_type, source_id, employee_id, employee_label,
      sigla, giornate, dates_json, manual_note, sort_order
    ) VALUES (
      @month_reference, @source_type, @source_id, @employee_id, @employee_label,
      @sigla, @giornate, @dates_json, @manual_note, @sort_order
    )
  `);

  entries.forEach((entry, index) => {
    insert.run({
      month_reference: monthReference,
      source_type: sourceType,
      source_id: sourceId,
      employee_id: entry.employee_id || null,
      employee_label: entry.employee_label,
      sigla: normalizeSigla(entry.sigla) || null,
      giornate: Number(entry.giornate || 0),
      dates_json: JSON.stringify(normalizeSelectedDays(entry.dates)),
      manual_note: String(entry.manual_note || '').trim() || null,
      sort_order: Number.isFinite(entry.sort_order) ? entry.sort_order : index,
    });
  });
}

function syncTeamReportNotes(teamId, month) {
  const db = getDb();
  const normalizedTeamId = Number(teamId || 0);
  const monthReference = normalizeMonth(month);
  if (!normalizedTeamId || !monthReference) {
    return { success: false };
  }

  const reportRecord = db.prepare(`
    SELECT employer_key
    FROM team_report_records
    WHERE team_id = ? AND month = ?
    LIMIT 1
  `).get(normalizedTeamId, monthReference);
  const teamSigla = normalizeSigla(reportRecord?.employer_key);

  const components = db.prepare(`
    SELECT employee_id, employee_label, days, notes, selected_payroll_days_json, sort_order
    FROM team_payroll_components
    WHERE team_id = ? AND month = ?
    ORDER BY sort_order ASC, id ASC
  `).all(normalizedTeamId, monthReference);

  const entries = components
    .map((component, index) => {
      const dates = normalizeSelectedDays(component.selected_payroll_days_json);
      const giornate = dates.length ? dates.length : Number(component.days || 0);
      return {
        employee_id: component.employee_id ? Number(component.employee_id) : null,
        employee_label: String(component.employee_label || '').trim(),
        sigla: teamSigla,
        giornate,
        dates,
        manual_note: component.notes || '',
        sort_order: index,
      };
    })
    .filter((entry) => entry.employee_label && (entry.dates.length > 0 || entry.giornate > 0));

  const tx = db.transaction(() => {
    replaceAutoNotesForSource(db, monthReference, 'team', normalizedTeamId, entries);
  });
  tx();

  return { success: true, count: entries.length };
}

function syncEmployeeReportNotes(employeeId, month) {
  const db = getDb();
  const normalizedEmployeeId = Number(employeeId || 0);
  const monthReference = normalizeMonth(month);
  if (!normalizedEmployeeId || !monthReference) {
    return { success: false };
  }

  const record = db.prepare(`
    SELECT
      pr.datore,
      pr.giornate_busta_paga,
      pr.selected_payroll_days_json,
      pr.note,
      e.first_name,
      e.last_name
    FROM payroll_records pr
    JOIN employees e ON e.id = pr.employee_id
    WHERE pr.employee_id = ? AND pr.month = ?
    LIMIT 1
  `).get(normalizedEmployeeId, monthReference);

  const entries = [];
  if (record) {
    const dates = normalizeSelectedDays(record.selected_payroll_days_json);
    const giornate = dates.length ? dates.length : Number(record.giornate_busta_paga || 0);
    const label = `${record.first_name || ''} ${record.last_name || ''}`.trim();
    if (label && (dates.length > 0 || giornate > 0)) {
      entries.push({
        employee_id: normalizedEmployeeId,
        employee_label: label,
        sigla: normalizeSigla(record.datore),
        giornate,
        dates,
        manual_note: '',
        sort_order: 0,
      });
    }
  }

  const tx = db.transaction(() => {
    replaceAutoNotesForSource(db, monthReference, 'employee', normalizedEmployeeId, entries);
  });
  tx();

  return { success: true, count: entries.length };
}

module.exports = {
  buildAutoNoteLine,
  getAutoReportNotesByMonth,
  syncTeamReportNotes,
  syncEmployeeReportNotes,
};
