import React, { useEffect, useMemo, useState } from 'react';
import { dispatchRouteReady } from '../utils/navigationPerf';
import { PRINT_CATEGORIES, getCategoryById, getPrintTypeById } from '../printRegistry';
import { compareAttendanceEmployees, formatAttendanceEmployeeDisplayName } from '../utils/attendanceEmployeeNames';
import { getCalendarDayInfo } from '../utils/holidays';

const PAGE_ICON = '\u{1F4C4}';
const TAB_OPTIONS = [
  { id: 'documents', label: 'Documenti allegati' },
  { id: 'prints', label: 'Stampe / Elenchi' },
];
const DOCUMENT_TYPE_OPTIONS = [
  { value: '', label: 'Tutti' },
  { value: 'hire_attachment', label: 'Assunzione' },
  { value: 'medical_visit_attachment', label: 'Visita medica' },
  { value: 'art37_attachment', label: 'Formazione Art. 37' },
  { value: 'dpi_delivery_attachment', label: 'DPI' },
  { value: 'payroll_slip', label: 'Busta paga' },
  { value: 'communication_pdf', label: 'Comunicazione PDF' },
  { value: 'communication_excel', label: 'Comunicazione Excel' },
];
const MONTH_OPTIONS = [
  { value: '01', label: 'Gennaio' },
  { value: '02', label: 'Febbraio' },
  { value: '03', label: 'Marzo' },
  { value: '04', label: 'Aprile' },
  { value: '05', label: 'Maggio' },
  { value: '06', label: 'Giugno' },
  { value: '07', label: 'Luglio' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Settembre' },
  { value: '10', label: 'Ottobre' },
  { value: '11', label: 'Novembre' },
  { value: '12', label: 'Dicembre' },
];

function normalizeSortText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function formatDate(value) {
  if (!value) return '-';
  const normalized = String(value).slice(0, 10);
  const parts = normalized.split('-');
  if (parts.length !== 3) return value;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatMonthLabel(monthReference) {
  const raw = String(monthReference || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(raw)) return '-';
  const [, month] = raw.split('-');
  const monthLabel = MONTH_OPTIONS.find((item) => item.value === month)?.label || month;
  return `${monthLabel} ${raw.slice(0, 4)}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(Number(value || 0));
}

function formatNumber(value) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2).replace(/\.?0+$/, '');
}

function formatWorkedDaysAndResidualHours(totalHours, standardDayHours = 7) {
  const hours = Number(totalHours || 0);
  const baseHours = Number(standardDayHours || 7) || 7;
  if (hours <= 0 || baseHours <= 0) {
    return '0 gg';
  }
  const fullDays = Math.floor(hours / baseHours);
  const residualHours = Number((hours - fullDays * baseHours).toFixed(2));
  if (Math.abs(residualHours) <= 0.009) {
    return `${fullDays} gg`;
  }
  return `${fullDays} gg + ${formatNumber(residualHours).replace('.', ',')} h`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getEmployeeLabel(employee) {
  return formatAttendanceEmployeeDisplayName(employee);
}

function getEmployeeTeamHistory(employee) {
  return Array.isArray(employee?.team_history) ? employee.team_history : [];
}

function employeeBelongsToTeam(employee, teamId) {
  if (!teamId) return true;
  return getEmployeeTeamHistory(employee).some((entry) => String(entry?.team_id) === String(teamId));
}

function getEmployeeHireDate(employee) {
  const currentPeriod = (employee?.employment_periods || []).find((period) => period?.is_current);
  const firstPeriod = Array.isArray(employee?.employment_periods) ? employee.employment_periods[0] : null;
  return (
    employee?.hire_date_from ||
    employee?.hire_date ||
    employee?.start_date ||
    employee?.contract_start_date ||
    employee?.data_assunzione ||
    employee?.assunzione ||
    currentPeriod?.hire_date_from ||
    currentPeriod?.start_date ||
    firstPeriod?.hire_date_from ||
    firstPeriod?.start_date ||
    ''
  );
}

function getEmployeeContractEndDate(employee) {
  const periods = Array.isArray(employee?.employment_periods) ? employee.employment_periods : [];
  const currentPeriod = periods.find((period) => period?.is_current) || periods[0] || null;
  return (
    employee?.hire_date_to ||
    employee?.contract_end_date ||
    employee?.end_date ||
    employee?.termination_date ||
    currentPeriod?.hire_date_to ||
    currentPeriod?.end_date ||
    ''
  );
}

function getEmployeeTerminationDate(employee) {
  return employee?.early_termination_date || employee?.termination_date || '';
}

function getEmployeeClosureReason(employee) {
  return (
    employee?.early_termination_reason ||
    employee?.archive_reason ||
    employee?.closure_reason ||
    employee?.termination_reason ||
    ''
  );
}

function getEmployeeCurrentTeamLabel(employee) {
  const teams = getEmployeeTeamHistory(employee);
  if (!teams.length) return '-';
  return teams
    .map((team) => normalizeText(team?.name))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'it', { sensitivity: 'base' }))
    .join(', ') || '-';
}

function getEmployeeEmployerLabel(employee) {
  const fromPeriods = (employee?.employment_periods || [])
    .map((period) => normalizeText(period?.hired_by))
    .filter(Boolean);
  const fromEmployee = normalizeText(employee?.hired_by);
  const codes = [...new Set([fromEmployee, ...fromPeriods].filter(Boolean))];
  return codes.length ? codes.join(', ') : '-';
}

function getEmployeeStateLabel(employee) {
  const closureType = String(employee?.closure_type || '').trim().toLowerCase();
  const status = String(employee?.status || '').trim().toLowerCase();
  const isDeleted = !!employee?.is_deleted;

  if (closureType === 'manual_early' || status === 'chiuso_anticipo' || status === 'cessato') {
    return 'Cessato';
  }
  if (closureType === 'natural_expiry' || status === 'scaduto_fine_contratto' || status === 'scaduto') {
    return 'Scaduto';
  }
  if (isDeleted) {
    return 'Archiviato';
  }
  return 'Attivo';
}

function isEmployeeCurrentlyActive(employee) {
  return getEmployeeStateLabel(employee) === 'Attivo';
}

function formatPresenceState(value, dateValue = '', expiryValue = '') {
  const hasDate = !!normalizeText(dateValue);
  const hasExpiry = !!normalizeText(expiryValue);
  if (!value && !hasDate && !hasExpiry) return 'No';
  const details = [];
  if (hasDate) details.push(`Data ${formatDate(dateValue)}`);
  if (hasExpiry) details.push(`Scad. ${formatDate(expiryValue)}`);
  return details.length ? `Si • ${details.join(' • ')}` : 'Si';
}

function buildDpiAssignmentsMap(assignments = []) {
  const map = new Map();
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    const employeeId = Number(assignment?.employee_id || assignment?.employeeId);
    if (!employeeId) continue;
    const current = map.get(employeeId);
    const date = normalizeDateKey(assignment?.assigned_date || assignment?.assignedDate);
    if (!current || String(date).localeCompare(String(current.assigned_date || '')) > 0) {
      map.set(employeeId, { assigned_date: date || '' });
    }
  }
  return map;
}

function compareEmployees(a, b) {
  return compareAttendanceEmployees(a, b);
}

function compareTeams(a, b) {
  return normalizeSortText(a?.name).localeCompare(normalizeSortText(b?.name), 'it', {
    sensitivity: 'base',
  });
}

function compareDocuments(a, b) {
  const employeeCompare = normalizeSortText(a?.employee_name).localeCompare(
    normalizeSortText(b?.employee_name),
    'it',
    { sensitivity: 'base' }
  );
  if (employeeCompare !== 0) return employeeCompare;

  const typeCompare = normalizeSortText(a?.document_type_label).localeCompare(
    normalizeSortText(b?.document_type_label),
    'it',
    { sensitivity: 'base' }
  );
  if (typeCompare !== 0) return typeCompare;

  const dateCompare = String(b?.upload_date || '').localeCompare(String(a?.upload_date || ''));
  if (dateCompare !== 0) return dateCompare;

  return normalizeSortText(a?.file_name).localeCompare(normalizeSortText(b?.file_name), 'it', {
    sensitivity: 'base',
  });
}

function getCurrentYear() {
  return new Date().getFullYear();
}

function buildMonthKey(year, month) {
  return `${String(year)}-${String(month).padStart(2, '0')}`;
}

function normalizeDateKey(value) {
  return String(value || '').slice(0, 10);
}

function getBalanceStatusLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'saldato') return 'Saldato';
  if (normalized === 'parziale') return 'Parziale';
  return 'Non pagato';
}

function getPayrollPaymentStatusLabel(value) {
  return String(value || '').trim().toLowerCase() === 'pagato' ? 'Pagato' : 'Non pagato';
}

function getPayrollPaymentMethodLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'assegno') return 'Assegno';
  if (normalized === 'contanti') return 'Contanti';
  return 'Bonifico';
}

function getPrintConnectionLabel(status) {
  return status === 'ready' ? 'Stampa collegata' : 'Stampa non ancora collegata';
}

function getEmployeeSelectionModeLabel(selectionMode) {
  if (selectionMode === 'single') return 'Selezione singola obbligatoria';
  if (selectionMode === 'single_optional') return 'Selezione singola facoltativa';
  if (selectionMode === 'multiple') return 'Selezione multipla obbligatoria';
  if (selectionMode === 'multiple_optional') return 'Selezione multipla facoltativa';
  return '';
}

function summarizeAttendanceEntries(entries = []) {
  const meaningfulEntries = entries.filter((entry) => {
    const hours = Number(entry?.hours_worked || 0);
    const overtime = Number(entry?.overtime_hours || 0);
    const status = String(entry?.status || '').trim().toLowerCase();
    return hours > 0 || overtime > 0 || (status && status !== 'assente');
  });

  return {
    presenceDays: meaningfulEntries.length,
    totalHours: meaningfulEntries.reduce((sum, entry) => sum + Number(entry?.hours_worked || 0), 0),
    totalOvertime: meaningfulEntries.reduce((sum, entry) => sum + Number(entry?.overtime_hours || 0), 0),
  };
}

function normalizeSelectedPayrollDays(value) {
  if (Array.isArray(value)) {
    return [...new Set(
      value
        .map((item) => Number.parseInt(item, 10))
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= 31)
    )].sort((left, right) => left - right);
  }

  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return normalizeSelectedPayrollDays(parsed);
    }
  } catch {
    // fallback on plain string split
  }

  return normalizeSelectedPayrollDays(
    String(value)
      .split(/[,\s;-]+/)
      .filter(Boolean)
  );
}

function getDaysInMonth(year, month) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  if (!Number.isInteger(numericYear) || !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
    return 31;
  }
  return new Date(numericYear, numericMonth, 0).getDate();
}

function formatWeekdayShort(year, month, day) {
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date
    .toLocaleDateString('it-IT', { weekday: 'short' })
    .replace('.', '')
    .trim()
    .toLowerCase();
}

function buildPayrollGridDays(year, month) {
  const count = getDaysInMonth(year, month);
  return Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    const date = new Date(Number(year), Number(month) - 1, day);
    const dayInfo = getCalendarDayInfo(date);
    return {
      day,
      weekday: formatWeekdayShort(year, month, day),
      isSpecialDay: !!dayInfo?.isSpecialDay,
      holidayLabel: dayInfo?.holidayLabel || '',
    };
  });
}

function normalizeComparableDateKey(value) {
  return String(value || '').slice(0, 10);
}

function getEmployeeEmploymentRanges(employee) {
  const periods = Array.isArray(employee?.employment_periods)
    ? employee.employment_periods.filter((period) => period && (period.hire_date_from || period.hire_date_to))
    : [];

  if (periods.length > 0) {
    return periods.map((period) => ({
      start: period.hire_date_from || period.hire_date || period.start_date || period.contract_start_date || null,
      end: period.hire_date_to || period.early_termination_date || period.termination_date || period.end_date || period.contract_end_date || null,
    }));
  }

  const fallbackStart =
    employee?.hire_date_from || employee?.hire_date || employee?.start_date || employee?.contract_start_date || null;
  const fallbackEnd =
    employee?.early_termination_date || employee?.hire_date_to || employee?.termination_date || employee?.contract_end_date || employee?.end_date || null;
  if (!fallbackStart && !fallbackEnd) {
    return [];
  }
  return [{ start: fallbackStart, end: fallbackEnd }];
}

function employeeHasEmploymentInRange(employee, startDate, endDate) {
  const ranges = getEmployeeEmploymentRanges(employee);
  if (!ranges.length) {
    return true;
  }
  const startKey = normalizeComparableDateKey(startDate);
  const endKey = normalizeComparableDateKey(endDate);
  return ranges.some((range) => {
    const rangeStart = normalizeComparableDateKey(range.start) || startKey;
    const rangeEnd = normalizeComparableDateKey(range.end) || endKey;
    return rangeStart <= endKey && rangeEnd >= startKey;
  });
}

function formatDateRangeLabel(startDate, endDate) {
  if (!startDate && !endDate) return '-';
  if (startDate && endDate) {
    return `dal ${formatDate(startDate)} al ${formatDate(endDate)}`;
  }
  return startDate ? formatDate(startDate) : formatDate(endDate);
}

function buildMonthWeekOptions(year, month) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const monthDays = getDaysInMonth(numericYear, numericMonth);
  const options = [];
  let weekIndex = 1;
  let cursor = 1;
  while (cursor <= monthDays) {
    const start = new Date(numericYear, numericMonth - 1, cursor);
    const end = new Date(numericYear, numericMonth - 1, Math.min(cursor + 6, monthDays));
    const startKey = normalizeDateKey(start.toISOString().slice(0, 10));
    const endKey = normalizeDateKey(end.toISOString().slice(0, 10));
    options.push({
      value: String(weekIndex),
      dateFrom: startKey,
      dateTo: endKey,
      label: `Settimana ${weekIndex} (${formatDate(startKey)} - ${formatDate(endKey)})`,
    });
    weekIndex += 1;
    cursor += 7;
  }
  return options;
}

function buildWeeklySignaturesHtml(preview, companyHeader = 'GPA 1.0.5') {
  const rows = Array.isArray(preview?.signatureRows) ? preview.signatureRows : [];
  const summaryCards = (preview?.summaryCards || [])
    .map((card) => `
      <div class="sig-card">
        <div class="sig-card__label">${escapeHtml(card.label)}</div>
        <div class="sig-card__value">${escapeHtml(card.value)}</div>
      </div>
    `)
    .join('');
  const dayColumns = Array.isArray(preview?.weekDays) ? preview.weekDays : [];
  const mode = preview?.signatureMode || 'both';
  const showDaily = mode === 'daily' || mode === 'both';
  const showWeekly = mode === 'weekly' || mode === 'both';
  const dayHeaders = showDaily
    ? dayColumns
        .map((day) => {
          const specialClass = day?.isSpecialDay ? ' sig-grid__day--special' : '';
          const title = day?.holidayLabel ? ` title="${escapeHtml(day.holidayLabel)}"` : '';
          return `<th class="sig-grid__day${specialClass}"${title}><span class="sig-grid__dayname">${escapeHtml(day.weekday)}</span><span class="sig-grid__daydate">${escapeHtml(formatDate(day.date))}</span></th>`;
        })
        .join('')
    : '';

  const bodyRows = rows
    .map((row, index) => {
      const dayCells = showDaily
        ? dayColumns
            .map((day) => {
              const specialClass = day?.isSpecialDay ? ' sig-grid__cell--special' : '';
              return `<td class="sig-grid__cell${specialClass}"></td>`;
            })
            .join('')
        : '';
      return `
        <tr>
          <td class="sig-grid__index">${index + 1}</td>
          <td class="sig-grid__employee">
            <div class="sig-grid__name">${escapeHtml(row.employee || '-')}</div>
            <div class="sig-grid__team">${escapeHtml(row.team || '-')}</div>
          </td>
          ${dayCells}
          ${showWeekly ? '<td class="sig-grid__weekly"></td>' : ''}
        </tr>
      `;
    })
    .join('');

  return `
    <!doctype html>
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(preview?.title || 'Firme settimanali squadra')}</title>
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          * { box-sizing: border-box; }
          html, body { margin:0; padding:0; font-family:"Segoe UI", Arial, sans-serif; color:#0f172a; background:#fff; }
          .sig { width:100%; }
          .sig__header { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; margin-bottom:12px; }
          .sig__kicker { margin:0 0 4px; font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#64748b; font-weight:700; }
          .sig__title { margin:0; font-size:22px; line-height:1.1; }
          .sig__subtitle { margin:6px 0 0; color:#475569; font-size:12px; }
          .sig__meta { text-align:right; font-size:11px; color:#334155; }
          .sig__company { font-size:12px; font-weight:700; color:#0f172a; }
          .sig__summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px; margin-bottom:12px; }
          .sig-card { border:1px solid #dbe4ee; border-radius:12px; padding:10px 12px; background:#f8fafc; }
          .sig-card__label { font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px; }
          .sig-card__value { font-size:15px; font-weight:700; }
          .sig-grid { width:100%; border-collapse:collapse; table-layout:fixed; font-size:9px; }
          .sig-grid thead { display:table-header-group; }
          .sig-grid th, .sig-grid td { border:1px solid #cbd5e1; padding:5px 4px; text-align:center; vertical-align:middle; }
          .sig-grid thead th { background:#f8fafc; color:#334155; font-size:8px; font-weight:700; }
          .sig-grid__index-head, .sig-grid__index { width:10mm; }
          .sig-grid__employee-head { width:52mm; text-align:left !important; }
          .sig-grid__employee { text-align:left !important; padding:6px 7px !important; }
          .sig-grid__name { font-weight:700; font-size:9.2px; line-height:1.1; white-space:nowrap; }
          .sig-grid__team { margin-top:2px; font-size:7.2px; color:#64748b; white-space:nowrap; }
          .sig-grid__dayname { display:block; font-size:8px; font-weight:700; text-transform:capitalize; }
          .sig-grid__daydate { display:block; margin-top:2px; font-size:7px; color:#64748b; }
          .sig-grid__day--special { background:#fff1f1 !important; }
          .sig-grid__cell { height:18mm; }
          .sig-grid__cell--special { background:#fff1f1 !important; }
          .sig-grid__weekly-head, .sig-grid__weekly { width:28mm; }
          .sig-grid__weekly { height:18mm; }
          .sig-grid tbody tr { page-break-inside: avoid; break-inside: avoid; }
        </style>
      </head>
      <body>
        <div class="sig">
          <div class="sig__header">
            <div>
              <p class="sig__kicker">Stampa e Documenti</p>
              <h1 class="sig__title">${escapeHtml(preview?.title || 'Firme settimanali squadra')}</h1>
              <p class="sig__subtitle">${escapeHtml(preview?.subtitle || '')}</p>
            </div>
            <div class="sig__meta">
              <div class="sig__company">${escapeHtml(companyHeader)}</div>
              <div>Stampato il ${escapeHtml(formatDate(new Date().toISOString().slice(0, 10)))}</div>
            </div>
          </div>
          ${summaryCards ? `<div class="sig__summary">${summaryCards}</div>` : ''}
          <table class="sig-grid">
            <thead>
              <tr>
                <th class="sig-grid__index-head">N.</th>
                <th class="sig-grid__employee-head">Cognome Nome</th>
                ${dayHeaders}
                ${showWeekly ? '<th class="sig-grid__weekly-head">Firma settimanale</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${bodyRows || '<tr><td colspan="99">Nessun componente disponibile nel periodo selezionato.</td></tr>'}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

function hasAttendancePresence(entry) {
  const hours = Number(entry?.hours_worked || 0);
  const overtime = Number(entry?.overtime_hours || 0);
  const markerCode = normalizeText(entry?.marker_code);
  const status = normalizeText(entry?.status).toLowerCase();
  return hours > 0 || overtime > 0 || !!markerCode || (status && status !== 'assente');
}

function getAttendancePresenceCellValue(entry) {
  const hours = Number(entry?.hours_worked || 0);
  const overtime = Number(entry?.overtime_hours || 0);
  if (hours > 0) {
    return formatNumber(hours);
  }
  if (overtime > 0) {
    return formatNumber(overtime);
  }
  return 'X';
}

function buildAttendanceTeamPresenceGridHtml(preview, companyHeader = 'GPA 1.0.5') {
  const gridDays = Array.isArray(preview?.gridDays) ? preview.gridDays : [];
  const gridRows = Array.isArray(preview?.gridRows) ? preview.gridRows : [];
  const summaryCards = (preview?.summaryCards || [])
    .map((card) => `
      <div class="team-presence-card">
        <div class="team-presence-card__label">${escapeHtml(card.label)}</div>
        <div class="team-presence-card__value">${escapeHtml(card.value)}</div>
      </div>
    `)
    .join('');

  const headCells = gridDays
    .map((dayMeta) => {
      const title = dayMeta?.holidayLabel ? ` title="${escapeHtml(dayMeta.holidayLabel)}"` : '';
      const specialClass = dayMeta?.isSpecialDay ? ' team-presence-grid__day--special' : '';
      return `<th class="team-presence-grid__day${specialClass}"${title}><span class="team-presence-grid__daynum">${escapeHtml(String(dayMeta?.day ?? ''))}</span><span class="team-presence-grid__weekday">${escapeHtml(dayMeta?.weekday || '')}</span></th>`;
    })
    .join('');

  const bodyRows = gridRows
    .map((row) => {
      const cellMap = row?.cells || {};
      const dayCells = gridDays
        .map((dayMeta) => {
          const specialClass = dayMeta?.isSpecialDay ? ' team-presence-grid__cell--special' : '';
          return `<td class="team-presence-grid__cell${specialClass}">${escapeHtml(cellMap[dayMeta.day] || '')}</td>`;
        })
        .join('');
      return `
        <tr>
          <td class="team-presence-grid__employee">
            <div class="team-presence-grid__name">${escapeHtml(row.employee || '-')}</div>
            <div class="team-presence-grid__team">${escapeHtml(row.team || '-')}</div>
          </td>
          ${dayCells}
          <td class="team-presence-grid__total">${escapeHtml(row.totalLabel || '')}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <!doctype html>
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(preview?.title || 'Stampa presenze per squadra - tabella presenze')}</title>
        <style>
          @page { size: A4 landscape; margin: 8mm; }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; background: #fff; }
          .team-presence { width: 100%; }
          .team-presence__header { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; margin-bottom:12px; }
          .team-presence__kicker { margin:0 0 4px; font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#64748b; font-weight:700; }
          .team-presence__title { margin:0; font-size:22px; line-height:1.1; }
          .team-presence__subtitle { margin:6px 0 0; color:#475569; font-size:12px; }
          .team-presence__meta { text-align:right; font-size:11px; color:#334155; }
          .team-presence__company { font-size:12px; font-weight:700; color:#0f172a; }
          .team-presence__summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; margin-bottom:12px; }
          .team-presence-card { border:1px solid #dbe4ee; border-radius:12px; padding:10px 12px; background:#f8fafc; }
          .team-presence-card__label { font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px; }
          .team-presence-card__value { font-size:16px; font-weight:700; }
          .team-presence-grid { width:100%; border-collapse:collapse; table-layout:fixed; font-size:8.2px; }
          .team-presence-grid thead { display: table-header-group; }
          .team-presence-grid th, .team-presence-grid td { border:1px solid #cbd5e1; padding:3px 2px; text-align:center; line-height:1.08; }
          .team-presence-grid thead th { background:#f8fafc; color:#334155; font-size:7.5px; font-weight:700; }
          .team-presence-grid__employee-head { width:58mm; text-align:left !important; padding-left:6px !important; }
          .team-presence-grid__total-head, .team-presence-grid__total { width:18mm; white-space:nowrap; font-weight:700; }
          .team-presence-grid__employee { text-align:left !important; padding:5px 6px !important; background:#fff; }
          .team-presence-grid__name { font-weight:700; font-size:8.5px; line-height:1.08; white-space:nowrap; }
          .team-presence-grid__team { margin-top:2px; font-size:7.2px; color:#64748b; white-space:nowrap; }
          .team-presence-grid__daynum { display:block; font-size:8.2px; font-weight:700; color:#0f172a; }
          .team-presence-grid__weekday { display:block; margin-top:1px; font-size:6.2px; font-weight:600; text-transform:lowercase; color:#64748b; }
          .team-presence-grid__day--special { background:#fff1f1 !important; border-left-color:#efcaca; border-right-color:#efcaca; }
          .team-presence-grid__cell { font-weight:700; }
          .team-presence-grid__cell--special { background:#fff1f1 !important; border-left-color:#efcaca; border-right-color:#efcaca; }
          .team-presence-grid tbody tr:nth-child(even) td { background:#fcfcfd; }
          .team-presence-grid tbody tr:nth-child(even) td.team-presence-grid__cell--special { background:#fdecec !important; }
          .team-presence-grid tbody tr { page-break-inside: avoid; break-inside: avoid; }
        </style>
      </head>
      <body>
        <div class="team-presence">
          <div class="team-presence__header">
            <div>
              <p class="team-presence__kicker">Stampa e Documenti</p>
              <h1 class="team-presence__title">${escapeHtml(preview?.title || 'Stampa presenze per squadra - tabella presenze')}</h1>
              <p class="team-presence__subtitle">${escapeHtml(preview?.subtitle || '')}</p>
            </div>
            <div class="team-presence__meta">
              <div class="team-presence__company">${escapeHtml(companyHeader)}</div>
              <div>Stampato il ${escapeHtml(formatDate(new Date().toISOString().slice(0, 10)))}</div>
            </div>
          </div>
          ${summaryCards ? `<div class="team-presence__summary">${summaryCards}</div>` : ''}
          <table class="team-presence-grid">
            <thead>
              <tr>
                <th class="team-presence-grid__employee-head">Dipendente / Squadra</th>
                ${headCells}
                <th class="team-presence-grid__total-head">Totale</th>
              </tr>
            </thead>
            <tbody>
              ${bodyRows || `<tr><td colspan="${gridDays.length + 2}">Nessun dato disponibile con i filtri correnti.</td></tr>`}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

function buildPayrollSelectedDaysPrintHtml(preview, companyHeader = 'GPA 1.0.5') {
  const gridDays = Array.isArray(preview?.gridDays) ? preview.gridDays : [];
  const gridRows = Array.isArray(preview?.gridRows) ? preview.gridRows : [];
  const summaryCards = (preview?.summaryCards || [])
    .map((card) => `
      <div class="payroll-days-card">
        <div class="payroll-days-card__label">${escapeHtml(card.label)}</div>
        <div class="payroll-days-card__value">${escapeHtml(card.value)}</div>
      </div>
    `)
    .join('');

  const headCells = gridDays
    .map((dayMeta) => {
      const title = dayMeta?.holidayLabel ? ` title="${escapeHtml(dayMeta.holidayLabel)}"` : '';
      const specialClass = dayMeta?.isSpecialDay ? ' payroll-days-grid__day--special' : '';
      return `<th class="payroll-days-grid__day${specialClass}"${title}><span class="payroll-days-grid__daynum">${escapeHtml(String(dayMeta?.day ?? ''))}</span><span class="payroll-days-grid__weekday">${escapeHtml(dayMeta?.weekday || '')}</span></th>`;
    })
    .join('');

  const bodyRows = gridRows
    .map((row) => {
      const markSet = new Set(normalizeSelectedPayrollDays(row?.selectedDays));
      const dayCells = gridDays
        .map((dayMeta) => {
          const specialClass = dayMeta?.isSpecialDay ? ' payroll-days-grid__cell--special' : '';
          return `<td class="payroll-days-grid__cell${specialClass}">${markSet.has(dayMeta?.day) ? 'X' : ''}</td>`;
        })
        .join('');
      return `
        <tr>
          <td class="payroll-days-grid__employee">
            <div class="payroll-days-grid__name">${escapeHtml(row.employee || '-')}</div>
            <div class="payroll-days-grid__team">${escapeHtml(row.team || '-')}</div>
          </td>
          ${dayCells}
          <td class="payroll-days-grid__total">${escapeHtml(String(row.totalDays || 0))}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <!doctype html>
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(preview?.title || 'Date inserite busta paga')}</title>
        <style>
          @page { size: A4 landscape; margin: 8mm; }
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            padding: 0;
            font-family: "Segoe UI", Arial, sans-serif;
            color: #0f172a;
            background: #ffffff;
          }
          body {
            padding: 0;
          }
          .payroll-days {
            width: 100%;
          }
          .payroll-days__header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 14px;
            margin-bottom: 12px;
          }
          .payroll-days__kicker {
            margin: 0 0 4px;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #64748b;
            font-weight: 700;
          }
          .payroll-days__title {
            margin: 0;
            font-size: 22px;
            line-height: 1.1;
          }
          .payroll-days__subtitle {
            margin: 6px 0 0;
            color: #475569;
            font-size: 12px;
          }
          .payroll-days__meta {
            text-align: right;
            font-size: 11px;
            color: #334155;
          }
          .payroll-days__company {
            font-size: 12px;
            font-weight: 700;
            color: #0f172a;
          }
          .payroll-days__summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 8px;
            margin-bottom: 12px;
          }
          .payroll-days-card {
            border: 1px solid #dbe4ee;
            border-radius: 12px;
            padding: 10px 12px;
            background: #f8fafc;
          }
          .payroll-days-card__label {
            font-size: 10px;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 4px;
          }
          .payroll-days-card__value {
            font-size: 16px;
            font-weight: 700;
          }
          .payroll-days-grid {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: 8.4px;
          }
          .payroll-days-grid th,
          .payroll-days-grid td {
            border: 1px solid #cbd5e1;
            padding: 3px 2px;
            text-align: center;
            line-height: 1.1;
          }
          .payroll-days-grid thead {
            display: table-header-group;
          }
          .payroll-days-grid thead th {
            background: #f8fafc;
            color: #334155;
            font-size: 7.5px;
            font-weight: 700;
            line-height: 1.02;
          }
          .payroll-days-grid__employee-head {
            width: 58mm;
            text-align: left !important;
            padding-left: 6px !important;
          }
          .payroll-days-grid__total-head,
          .payroll-days-grid__total {
            width: 12mm;
            white-space: nowrap;
            font-weight: 700;
          }
          .payroll-days-grid__employee {
            text-align: left !important;
            padding: 5px 6px !important;
            background: #ffffff;
          }
          .payroll-days-grid__day {
            vertical-align: bottom;
          }
          .payroll-days-grid__daynum {
            display: block;
            font-size: 8.2px;
            font-weight: 700;
            color: #0f172a;
          }
          .payroll-days-grid__weekday {
            display: block;
            margin-top: 1px;
            font-size: 6.2px;
            font-weight: 600;
            text-transform: lowercase;
            color: #64748b;
          }
          .payroll-days-grid__day--special {
            background: #fff1f1 !important;
            border-left-color: #efcaca;
            border-right-color: #efcaca;
          }
          .payroll-days-grid__name {
            font-weight: 700;
            font-size: 8.6px;
            line-height: 1.08;
            white-space: nowrap;
          }
          .payroll-days-grid__team {
            margin-top: 2px;
            font-size: 7.3px;
            color: #64748b;
            white-space: nowrap;
          }
          .payroll-days-grid__cell {
            font-weight: 700;
          }
          .payroll-days-grid__cell--special {
            background: #fff1f1 !important;
            border-left-color: #efcaca;
            border-right-color: #efcaca;
          }
          .payroll-days-grid tbody tr:nth-child(even) td {
            background: #fcfcfd;
          }
          .payroll-days-grid tbody tr:nth-child(even) td.payroll-days-grid__cell--special {
            background: #fdecec !important;
          }
          .payroll-days-grid tbody tr {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        </style>
      </head>
      <body>
        <div class="payroll-days">
          <div class="payroll-days__header">
            <div>
              <p class="payroll-days__kicker">Stampa e Documenti</p>
              <h1 class="payroll-days__title">${escapeHtml(preview?.title || 'Date inserite busta paga')}</h1>
              <p class="payroll-days__subtitle">${escapeHtml(preview?.subtitle || '')}</p>
            </div>
            <div class="payroll-days__meta">
              <div class="payroll-days__company">${escapeHtml(companyHeader)}</div>
              <div>Stampato il ${escapeHtml(formatDate(new Date().toISOString().slice(0, 10)))}</div>
            </div>
          </div>
          ${summaryCards ? `<div class="payroll-days__summary">${summaryCards}</div>` : ''}
          <table class="payroll-days-grid">
            <thead>
              <tr>
                <th class="payroll-days-grid__employee-head">Dipendente / Squadra</th>
                ${headCells}
                <th class="payroll-days-grid__total-head">Tot.</th>
              </tr>
            </thead>
            <tbody>
              ${bodyRows || `<tr><td colspan="${gridDays.length + 2}">Nessun dato disponibile con i filtri correnti.</td></tr>`}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

function buildPrintHtml(preview, companyHeader) {
  const summaryCards = (preview.summaryCards || [])
    .map(
      (card) => `
        <div class="print-hub-card">
          <div class="print-hub-card__label">${escapeHtml(card.label)}</div>
          <div class="print-hub-card__value">${escapeHtml(card.value)}</div>
        </div>
      `
    )
    .join('');

  const headCells = (preview.columns || [])
    .map((column) => `<th class="align-${escapeHtml(column.align || 'left')}">${escapeHtml(column.label)}</th>`)
    .join('');

  const bodyRows = (preview.rows || [])
    .map((row) => `
      <tr>
        ${(preview.columns || [])
          .map((column) => `<td class="align-${escapeHtml(column.align || 'left')}">${escapeHtml(row[column.key] ?? '-')}</td>`)
          .join('')}
      </tr>
    `)
    .join('');

  return `
    <!doctype html>
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(preview.title)}</title>
        <style>
          @page { size: ${preview.landscape ? 'A4 landscape' : 'A4 portrait'}; margin: 10mm; }
          body {
            margin: 0;
            font-family: "Segoe UI", Arial, sans-serif;
            color: #0f172a;
            background: #ffffff;
          }
          .print-hub {
            padding: 10px 4px 18px;
          }
          .print-hub__header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 20px;
            margin-bottom: 16px;
          }
          .print-hub__kicker {
            margin: 0 0 4px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #64748b;
            font-weight: 700;
          }
          .print-hub__title {
            margin: 0;
            font-size: 24px;
            line-height: 1.15;
          }
          .print-hub__subtitle {
            margin: 8px 0 0;
            color: #475569;
            font-size: 13px;
          }
          .print-hub__meta {
            text-align: right;
            font-size: 12px;
            color: #334155;
          }
          .print-hub__company {
            font-size: 13px;
            font-weight: 700;
            color: #0f172a;
          }
          .print-hub__summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 10px;
            margin-bottom: 18px;
          }
          .print-hub-card {
            border: 1px solid #dbe4ee;
            border-radius: 14px;
            padding: 12px 14px;
            background: #f8fafc;
          }
          .print-hub-card__label {
            font-size: 11px;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 6px;
          }
          .print-hub-card__value {
            font-size: 18px;
            font-weight: 700;
            color: #0f172a;
          }
          .print-hub__table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
          }
          .print-hub__table thead th {
            text-align: left;
            padding: 9px 10px;
            border-bottom: 1px solid #cbd5e1;
            color: #334155;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            background: #f8fafc;
            white-space: nowrap;
          }
          .print-hub__table tbody td {
            padding: 9px 10px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: top;
          }
          .align-center { text-align: center; }
          .align-right { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        </style>
      </head>
      <body>
        <div class="print-hub">
          <div class="print-hub__header">
            <div>
              <p class="print-hub__kicker">Stampa e Documenti</p>
              <h1 class="print-hub__title">${escapeHtml(preview.title)}</h1>
              <p class="print-hub__subtitle">${escapeHtml(preview.subtitle || '')}</p>
            </div>
            <div class="print-hub__meta">
              <div class="print-hub__company">${escapeHtml(companyHeader || 'GPA 1.0.5')}</div>
              <div>Stampato il ${escapeHtml(formatDate(new Date().toISOString().slice(0, 10)))}</div>
            </div>
          </div>
          ${summaryCards ? `<div class="print-hub__summary">${summaryCards}</div>` : ''}
          <table class="print-hub__table">
            <thead>
              <tr>${headCells}</tr>
            </thead>
            <tbody>
              ${bodyRows || '<tr><td colspan="99">Nessun dato disponibile.</td></tr>'}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

export default function PrintDocumentsPage() {
  const [activeTab, setActiveTab] = useState('documents');
  const [loading, setLoading] = useState(true);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [documents, setDocuments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [settings, setSettings] = useState(null);

  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [documentsFilters, setDocumentsFilters] = useState({
    documentType: '',
    monthReference: '',
    uploadDate: '',
  });

  const [selectedCategoryId, setSelectedCategoryId] = useState('attendance');
  const [selectedTypeId, setSelectedTypeId] = useState('attendance-month-selected');
  const [printFilters, setPrintFilters] = useState({
    year: String(getCurrentYear()),
    month: String(new Date().getMonth() + 1).padStart(2, '0'),
    date: '',
    dateFrom: '',
    dateTo: '',
    weekOfMonth: '',
    teamId: '',
    balanceStatus: '',
    payrollPaymentStatus: '',
    signatureMode: 'both',
  });
  const [printEmployeeSearch, setPrintEmployeeSearch] = useState('');
  const [attendanceDayTeamFilter, setAttendanceDayTeamFilter] = useState('');
  const [includeAttendanceDayHireDates, setIncludeAttendanceDayHireDates] = useState(false);
  const [selectedPrintEmployeeIds, setSelectedPrintEmployeeIds] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [printPreview, setPrintPreview] = useState(null);

  const sortedEmployees = useMemo(() => [...employees].sort(compareEmployees), [employees]);
  const sortedTeams = useMemo(() => [...teams].sort(compareTeams), [teams]);
  const employeesById = useMemo(
    () => new Map(sortedEmployees.map((employee) => [Number(employee.id), employee])),
    [sortedEmployees]
  );
  const attendanceDayTeamOptions = useMemo(
    () => sortedTeams.filter((team) => !team.is_archived),
    [sortedTeams]
  );
  const weeklySignatureWeekOptions = useMemo(
    () => buildMonthWeekOptions(printFilters.year, printFilters.month),
    [printFilters.year, printFilters.month]
  );
  const selectedCategory = useMemo(() => getCategoryById(selectedCategoryId), [selectedCategoryId]);
  const selectedType = useMemo(() => getPrintTypeById(selectedTypeId), [selectedTypeId]);

  async function loadDocuments(filters = {}) {
    setDocumentsLoading(true);
    try {
      const data = await window.api.printDocuments.listDocuments(filters);
      setDocuments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Errore caricamento documenti.');
    } finally {
      setDocumentsLoading(false);
    }
  }

  async function loadInitialData() {
    setLoading(true);
    try {
      const [employeesData, teamsData, settingsData] = await Promise.all([
        window.api.employees.listBasic({ includeTeamHistory: true, includeDeleted: true }),
        window.api.teams.list({ includeArchived: true }),
        window.api.settings.get(),
      ]);
      setEmployees(Array.isArray(employeesData) ? employeesData : []);
      setTeams(Array.isArray(teamsData) ? teamsData : []);
      setSettings(settingsData || null);
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Errore caricamento Stampa e Documenti.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (!loading) {
      dispatchRouteReady('/stampa-documenti');
    }
  }, [loading]);

  useEffect(() => {
    if (!selectedCategory?.types?.length) return;
    if (!selectedCategory.types.some((type) => type.id === selectedTypeId)) {
      setSelectedTypeId(selectedCategory.types[0].id);
    }
  }, [selectedCategory, selectedTypeId]);

  useEffect(() => {
    if (!selectedType) return;
    if (selectedType.employeeSelection === 'none') {
      setSelectedPrintEmployeeIds([]);
      setPrintEmployeeSearch('');
      return;
    }
    if (selectedType.employeeSelection === 'single' || selectedType.employeeSelection === 'single_optional') {
      setSelectedPrintEmployeeIds((current) => current.slice(0, 1));
    }
  }, [selectedType]);

  useEffect(() => {
    if (selectedType?.id !== 'attendance-team-weekly-signatures') {
      return;
    }
    if (!printFilters.weekOfMonth) {
      return;
    }
    const selectedWeek = weeklySignatureWeekOptions.find((option) => option.value === printFilters.weekOfMonth);
    if (!selectedWeek) {
      return;
    }
    setPrintFilters((current) => {
      if (current.dateFrom === selectedWeek.dateFrom && current.dateTo === selectedWeek.dateTo) {
        return current;
      }
      return {
        ...current,
        dateFrom: selectedWeek.dateFrom,
        dateTo: selectedWeek.dateTo,
      };
    });
  }, [selectedType?.id, printFilters.weekOfMonth, weeklySignatureWeekOptions]);

  const employeeSearchResults = useMemo(() => {
    const query = normalizeSortText(employeeSearch);
    if (!query) {
      return sortedEmployees.slice(0, 12);
    }
    return sortedEmployees
      .filter((employee) => {
        const haystack = [
          getEmployeeLabel(employee),
          employee.first_name,
          employee.last_name,
          employee.fiscal_code,
          employee.role,
        ].map(normalizeSortText).join(' ');
        return haystack.includes(query);
      })
      .slice(0, 20);
  }, [employeeSearch, sortedEmployees]);

  const documentMonthOptions = useMemo(
    () =>
      [...new Set(documents.map((document) => document.month_reference).filter(Boolean))]
        .sort((a, b) => String(b).localeCompare(String(a)))
        .map((value) => ({ value, label: formatMonthLabel(value) })),
    [documents]
  );

  const filteredDocuments = useMemo(
    () =>
      [...documents]
        .filter((document) => !documentsFilters.documentType || document.document_type === documentsFilters.documentType)
        .filter((document) => !documentsFilters.monthReference || document.month_reference === documentsFilters.monthReference)
        .filter((document) => !documentsFilters.uploadDate || document.upload_date === documentsFilters.uploadDate)
        .sort(compareDocuments),
    [documents, documentsFilters]
  );

  useEffect(() => {
    if (!selectedEmployee?.id) {
      setDocuments([]);
      setDocumentsLoading(false);
      return;
    }
    loadDocuments({
      employeeId: selectedEmployee.id,
      documentType: documentsFilters.documentType,
      monthReference: documentsFilters.monthReference,
      uploadDate: documentsFilters.uploadDate,
    });
  }, [
    selectedEmployee?.id,
    documentsFilters.documentType,
    documentsFilters.monthReference,
    documentsFilters.uploadDate,
  ]);

  const printSearchBaseEmployees = useMemo(() => {
    if (selectedType?.id !== 'attendance-day' || !attendanceDayTeamFilter) {
      return sortedEmployees;
    }
    return sortedEmployees.filter((employee) => employeeBelongsToTeam(employee, attendanceDayTeamFilter));
  }, [attendanceDayTeamFilter, selectedType?.id, sortedEmployees]);

  const printSearchResults = useMemo(() => {
    const query = normalizeSortText(printEmployeeSearch);
    if (!query) {
      return printSearchBaseEmployees.slice(0, 16);
    }
    return printSearchBaseEmployees
      .filter((employee) => {
        const haystack = [
          getEmployeeLabel(employee),
          employee.first_name,
          employee.last_name,
          employee.fiscal_code,
          employee.role,
        ].map(normalizeSortText).join(' ');
        return haystack.includes(query);
      })
      .slice(0, 30);
  }, [printEmployeeSearch, printSearchBaseEmployees]);

  const selectedPrintEmployees = useMemo(
    () => sortedEmployees.filter((employee) => selectedPrintEmployeeIds.includes(Number(employee.id))),
    [selectedPrintEmployeeIds, sortedEmployees]
  );

  function handleSelectEmployee(employee) {
    setSelectedEmployee(employee);
    setEmployeeSearch(getEmployeeLabel(employee));
    setDocumentsFilters({
      documentType: '',
      monthReference: '',
      uploadDate: '',
    });
  }

  function handleResetDocumentSelection() {
    setSelectedEmployee(null);
    setEmployeeSearch('');
    setDocuments([]);
    setDocumentsFilters({
      documentType: '',
      monthReference: '',
      uploadDate: '',
    });
  }

  function togglePrintEmployeeSelection(employeeId) {
    if (!selectedType) return;
    const normalizedId = Number(employeeId);
    setSelectedPrintEmployeeIds((current) => {
      const exists = current.includes(normalizedId);
      if (selectedType.employeeSelection === 'single' || selectedType.employeeSelection === 'single_optional') {
        return exists ? [] : [normalizedId];
      }
      return exists ? current.filter((id) => id !== normalizedId) : [...current, normalizedId];
    });
  }

  function selectAllFilteredEmployees() {
    if (!selectedType || (selectedType.employeeSelection !== 'multiple' && selectedType.employeeSelection !== 'multiple_optional')) {
      return;
    }
    setSelectedPrintEmployeeIds(printSearchResults.map((employee) => Number(employee.id)));
  }

  function clearPrintEmployeeSelection() {
    setSelectedPrintEmployeeIds([]);
  }

  function updateAttendanceDayTeamFilter(teamId) {
    setAttendanceDayTeamFilter(teamId);
    if (!teamId) return;
    setSelectedPrintEmployeeIds((current) =>
      current.filter((employeeId) => employeeBelongsToTeam(employeesById.get(Number(employeeId)), teamId))
    );
  }

  function buildSelectionMeta() {
    if (!selectedType) return [];
    const meta = [
      { label: 'Categoria', value: selectedCategory?.label || '-' },
      { label: 'Tipo stampa', value: selectedType.label || '-' },
    ];

    if (selectedType.filters.includes('year') && selectedType.filters.includes('month')) {
      meta.push({ label: 'Periodo', value: formatMonthLabel(buildMonthKey(printFilters.year, printFilters.month)) });
    }
    if (selectedType.filters.includes('date') && printFilters.date) {
      meta.push({ label: 'Data', value: formatDate(printFilters.date) });
    }
    if (selectedType.filters.includes('teamId') && printFilters.teamId) {
      const team = sortedTeams.find((item) => Number(item.id) === Number(printFilters.teamId));
      meta.push({ label: 'Squadra', value: team?.name || '-' });
    }
    if (selectedType.filters.includes('dateFrom') && selectedType.filters.includes('dateTo') && (printFilters.dateFrom || printFilters.dateTo)) {
      meta.push({ label: 'Periodo selezionato', value: formatDateRangeLabel(printFilters.dateFrom, printFilters.dateTo) });
    }
    if (selectedType.id === 'attendance-day' && attendanceDayTeamFilter) {
      const team = sortedTeams.find((item) => Number(item.id) === Number(attendanceDayTeamFilter));
      meta.push({ label: 'Squadra dipendenti', value: team?.name || '-' });
    }
    if (selectedType.id === 'attendance-day') {
      meta.push({
        label: 'Date assunzione',
        value: includeAttendanceDayHireDates ? 'Incluse' : 'Non incluse',
      });
    }
    if (selectedType.filters.includes('balanceStatus') && printFilters.balanceStatus) {
      meta.push({ label: 'Stato saldo', value: getBalanceStatusLabel(printFilters.balanceStatus) });
    }
    if (selectedType.filters.includes('payrollPaymentStatus') && printFilters.payrollPaymentStatus) {
      meta.push({ label: 'Stato busta', value: getPayrollPaymentStatusLabel(printFilters.payrollPaymentStatus) });
    }
    if (selectedPrintEmployees.length) {
      meta.push({
        label: selectedPrintEmployees.length === 1 ? 'Dipendente' : 'Dipendenti',
        value:
          selectedPrintEmployees.length <= 3
            ? selectedPrintEmployees.map(getEmployeeLabel).join(', ')
            : `${selectedPrintEmployees.length} dipendenti selezionati`,
      });
    }

    return meta;
  }

  async function handleDocumentAction(action, document) {
    if (!document?.relative_path) return;
    setActionLoading(`${action}:${document.relative_path}`);
    try {
      if (action === 'open') {
        const result = await window.api.printDocuments.openDocument(document.relative_path);
        if (result?.success === false) {
          alert(result.message || 'Impossibile aprire il documento.');
        }
      } else if (action === 'print') {
        const result = await window.api.printDocuments.printDocument(document.relative_path);
        if (result?.success === false) {
          alert(result.message || 'Impossibile inviare il documento alla stampa.');
        }
      } else if (action === 'export') {
        const result = await window.api.printDocuments.exportDocument(document.relative_path, document.file_name);
        if (!result?.canceled && result?.file_path) {
          alert(`Documento esportato in:\n${result.file_path}`);
        }
      }
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Operazione documento non riuscita.');
    } finally {
      setActionLoading('');
    }
  }

  async function loadPrintPreview() {
    if (!selectedType) {
      setPrintPreview(null);
      return;
    }

    if (selectedType.status !== 'ready') {
      setPrintPreview({
        status: 'disabled',
        title: selectedType.label,
        subtitle: 'Stampa non ancora collegata.',
        columns: [],
        rows: [],
        summaryCards: [],
      });
      return;
    }

    const employeeSelection = selectedType.employeeSelection || 'none';
    const requiresEmployees = employeeSelection === 'single' || employeeSelection === 'multiple';
    if (requiresEmployees && !selectedPrintEmployeeIds.length) {
      setPrintPreview({
        status: 'empty',
        title: selectedType.label,
        subtitle: 'Seleziona i dipendenti richiesti per generare questa stampa.',
        columns: [],
        rows: [],
        summaryCards: [],
      });
      return;
    }

    setPreviewLoading(true);
    try {
      const monthKey = buildMonthKey(printFilters.year, printFilters.month);
      const selectedTeam = sortedTeams.find((team) => Number(team.id) === Number(printFilters.teamId));
      const selectedEmployeesById = new Map(
        selectedPrintEmployees.map((employee) => [Number(employee.id), employee])
      );
      let nextPreview = null;

      switch (selectedType.id) {
        case 'attendance-month-selected': {
          const rows = await window.api.attendance.listByMonth(Number(printFilters.year), Number(printFilters.month));
          const rowsByEmployee = new Map();
          rows.forEach((row) => {
            const employeeId = Number(row.employee_id);
            if (!selectedEmployeesById.has(employeeId)) return;
            const list = rowsByEmployee.get(employeeId) || [];
            list.push(row);
            rowsByEmployee.set(employeeId, list);
          });

          nextPreview = {
            status: 'ready',
            title: `Presenze mensili ${formatMonthLabel(monthKey)}`,
            subtitle: 'Riepilogo mensile delle presenze per i dipendenti selezionati.',
            fileName: `presenze-dipendenti-${monthKey}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Periodo', value: formatMonthLabel(monthKey) },
              { label: 'Dipendenti', value: String(selectedPrintEmployees.length) },
            ],
            columns: [
              { label: 'Dipendente', key: 'employee', align: 'left' },
              { label: 'Mansione', key: 'role', align: 'left' },
              { label: 'Giorni presenza', key: 'days', align: 'center' },
              { label: 'Ore', key: 'hours', align: 'right' },
              { label: 'Straordinario', key: 'overtime', align: 'right' },
            ],
            rows: selectedPrintEmployees.map((employee) => {
              const totals = summarizeAttendanceEntries(rowsByEmployee.get(Number(employee.id)) || []);
              return {
                employee: getEmployeeLabel(employee),
                role: employee.role || '-',
                days: String(totals.presenceDays),
                hours: formatNumber(totals.totalHours),
                overtime: formatNumber(totals.totalOvertime),
              };
            }),
          };
          break;
        }

        case 'attendance-day': {
          if (!printFilters.date) {
            nextPreview = {
              status: 'empty',
              title: 'Presenze giornaliere',
              subtitle: 'Seleziona una data per generare questa stampa.',
              columns: [],
              rows: [],
              summaryCards: [],
            };
            break;
          }
          const [year, month] = String(printFilters.date).split('-');
          const rows = await window.api.attendance.listByMonth(Number(year), Number(month));
          let filtered = rows.filter((row) => normalizeDateKey(row.date) === normalizeDateKey(printFilters.date));
          if (attendanceDayTeamFilter) {
            filtered = filtered.filter((row) =>
              employeeBelongsToTeam(employeesById.get(Number(row.employee_id)), attendanceDayTeamFilter)
            );
          }
          if (selectedPrintEmployeeIds.length) {
            filtered = filtered.filter((row) => selectedPrintEmployeeIds.includes(Number(row.employee_id)));
          }
          const attendanceDayColumns = [
            { label: 'Dipendente', key: 'employee', align: 'left' },
            ...(includeAttendanceDayHireDates
              ? [{ label: 'Assunzione', key: 'hireDate', align: 'center' }]
              : []),
            { label: 'Mansione', key: 'role', align: 'left' },
            { label: 'Stato', key: 'status', align: 'center' },
            { label: 'Ore', key: 'hours', align: 'right' },
            { label: 'Straordinario', key: 'overtime', align: 'right' },
          ];

          nextPreview = {
            status: 'ready',
            title: `Presenze giornaliere ${formatDate(printFilters.date)}`,
            subtitle: 'Riepilogo presenze del giorno selezionato.',
            fileName: `presenze-giornaliere-${printFilters.date}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Data', value: formatDate(printFilters.date) },
              { label: 'Righe', value: String(filtered.length) },
            ],
            columns: attendanceDayColumns,
            rows: filtered.map((row) => {
              const employee = employeesById.get(Number(row.employee_id));
              return {
                employee: getEmployeeLabel(employee || row),
                hireDate: formatDate(getEmployeeHireDate(employee)),
                role: row.role || '-',
                status: String(row.status || '').trim() || 'Presente',
                hours: formatNumber(row.hours_worked),
                overtime: formatNumber(row.overtime_hours),
              };
            }),
          };
          break;
        }

        case 'attendance-team-headcount':
        case 'attendance-team-table': {
          if (!selectedTeam) {
            nextPreview = {
              status: 'empty',
              title:
                selectedType.id === 'attendance-team-headcount'
                  ? 'Stampa presenze per squadra - numero presenti'
                  : 'Stampa presenze per squadra - tabella presenze',
              subtitle: 'Seleziona una squadra per generare questa stampa.',
              columns: [],
              rows: [],
              summaryCards: [],
            };
            break;
          }
          const attendanceRows = await window.api.attendance.listByMonth(Number(printFilters.year), Number(printFilters.month));
          const filteredAttendanceRows = (Array.isArray(attendanceRows) ? attendanceRows : []).filter((row) => {
            const employee = employeesById.get(Number(row.employee_id));
            return employee && employeeBelongsToTeam(employee, selectedTeam.id);
          });
          const monthDays = getDaysInMonth(printFilters.year, printFilters.month);
          const gridDays = buildPayrollGridDays(printFilters.year, printFilters.month);
          const presentRows = filteredAttendanceRows.filter(hasAttendancePresence);
          const byDate = new Map();
          presentRows.forEach((row) => {
            const dateKey = normalizeDateKey(row.date);
            if (!dateKey) return;
            const list = byDate.get(dateKey) || [];
            list.push(row);
            byDate.set(dateKey, list);
          });

          if (selectedType.id === 'attendance-team-headcount') {
            const rows = Array.from({ length: monthDays }, (_, index) => {
              const date = new Date(Number(printFilters.year), Number(printFilters.month) - 1, index + 1);
              const dateKey = normalizeDateKey(date.toISOString().slice(0, 10));
              const dayInfo = getCalendarDayInfo(date);
              const items = byDate.get(dateKey) || [];
              const presentCount = items.length;
              const totalHours = items.reduce((sum, item) => sum + Number(item.hours_worked || 0), 0);
              return {
                date: formatDate(dateKey),
                presentCount,
                totalHours,
                note: presentCount > 0 ? `${presentCount} presenti` : (dayInfo?.isSpecialDay ? 'Riposo' : '0 presenti'),
              };
            });

            nextPreview = {
              status: 'ready',
              title: 'Stampa presenze per squadra - numero presenti',
              subtitle: `${selectedTeam.name || '-'} · ${formatMonthLabel(monthKey)}`,
              fileName: `presenze-squadra-numero-presenti-${normalizeSortText(selectedTeam.name) || 'squadra'}-${monthKey}.pdf`,
              landscape: true,
              summaryCards: [
                { label: 'Periodo', value: formatMonthLabel(monthKey) },
                { label: 'Squadra', value: selectedTeam.name || '-' },
                { label: 'Presenze totali', value: String(presentRows.length) },
              ],
              columns: [
                { label: 'Data', key: 'date', align: 'center' },
                { label: 'Presenti', key: 'present', align: 'center' },
                { label: 'Ore totali', key: 'hours', align: 'right' },
                { label: 'Note', key: 'note', align: 'left' },
              ],
              rows: rows.map((row) => ({
                date: row.date,
                present: `${row.presentCount} presenti`,
                hours: formatNumber(row.totalHours),
                note: row.note,
              })),
            };
            break;
          }

          const employeeRowsMap = new Map();
          presentRows.forEach((row) => {
            const employeeId = Number(row.employee_id || 0);
            const employee = employeesById.get(employeeId);
            if (!employee) return;
            const day = Number(String(row.date || '').slice(8, 10));
            if (!Number.isInteger(day) || day < 1 || day > monthDays) return;
            const existing = employeeRowsMap.get(employeeId) || {
              employee,
              employeeId,
              team: selectedTeam.name || '-',
              cells: {},
              totalDays: 0,
              totalHours: 0,
            };
            if (!existing.cells[day]) {
              existing.totalDays += 1;
            }
            existing.cells[day] = getAttendancePresenceCellValue(row);
            existing.totalHours += Number(row.hours_worked || 0);
            employeeRowsMap.set(employeeId, existing);
          });

          const gridRows = [...employeeRowsMap.values()]
            .sort((left, right) => compareEmployees(left.employee, right.employee))
            .map((item) => ({
              employee: getEmployeeLabel(item.employee),
              team: item.team,
              cells: item.cells,
              totalDays: item.totalDays,
              totalHours: item.totalHours,
              totalLabel: formatWorkedDaysAndResidualHours(item.totalHours, 7),
            }));

          nextPreview = {
            status: 'ready',
            title: 'Stampa presenze per squadra - tabella presenze',
            subtitle: `${selectedTeam.name || '-'} · ${formatMonthLabel(monthKey)}`,
            fileName: `presenze-squadra-tabella-${normalizeSortText(selectedTeam.name) || 'squadra'}-${monthKey}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Periodo', value: formatMonthLabel(monthKey) },
              { label: 'Squadra', value: selectedTeam.name || '-' },
              { label: 'Componenti con presenze', value: String(gridRows.length) },
            ],
            columns: [
              { label: 'Dipendente', key: 'employee', align: 'left' },
              { label: 'Squadra', key: 'team', align: 'left' },
              { label: 'Totale', key: 'total', align: 'center' },
            ],
            rows: gridRows.map((row) => ({
              employee: row.employee,
              team: row.team,
              total: row.totalLabel,
            })),
            gridDays,
            gridRows,
            customHtml: buildAttendanceTeamPresenceGridHtml({
              title: 'Stampa presenze per squadra - tabella presenze',
              subtitle: `${selectedTeam.name || '-'} · ${formatMonthLabel(monthKey)}`,
              summaryCards: [
                { label: 'Periodo', value: formatMonthLabel(monthKey) },
                { label: 'Squadra', value: selectedTeam.name || '-' },
                { label: 'Componenti con presenze', value: String(gridRows.length) },
              ],
              gridDays,
              gridRows,
            }, settings?.company?.document_header || settings?.company?.name || 'GPA 1.0.5'),
          };
          break;
        }

        case 'attendance-team-weekly-signatures': {
          if (!selectedTeam) {
            nextPreview = {
              status: 'empty',
              title: 'Firme settimanali squadra',
              subtitle: 'Seleziona una squadra per generare questa stampa.',
              columns: [],
              rows: [],
              summaryCards: [],
            };
            break;
          }
          const selectedWeek = weeklySignatureWeekOptions.find((option) => option.value === printFilters.weekOfMonth);
          const dateFrom = normalizeDateKey(printFilters.dateFrom || selectedWeek?.dateFrom || '');
          const dateTo = normalizeDateKey(printFilters.dateTo || selectedWeek?.dateTo || '');
          if (!dateFrom || !dateTo) {
            nextPreview = {
              status: 'empty',
              title: 'Firme settimanali squadra',
              subtitle: 'Seleziona una settimana del mese oppure un intervallo date.',
              columns: [],
              rows: [],
              summaryCards: [],
            };
            break;
          }

          const weekDays = [];
          let cursor = new Date(dateFrom);
          const end = new Date(dateTo);
          while (cursor <= end) {
            const dayInfo = getCalendarDayInfo(cursor);
            weekDays.push({
              date: normalizeDateKey(cursor.toISOString().slice(0, 10)),
              weekday: formatWeekdayShort(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()),
              isSpecialDay: !!dayInfo?.isSpecialDay,
              holidayLabel: dayInfo?.holidayLabel || '',
            });
            cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
          }

          const members = sortedEmployees
            .filter((employee) => employeeBelongsToTeam(employee, selectedTeam.id))
            .filter((employee) => employeeHasEmploymentInRange(employee, dateFrom, dateTo))
            .sort(compareEmployees)
            .map((employee) => ({
              employee: getEmployeeLabel(employee),
              team: selectedTeam.name || '-',
            }));

          const signatureMode = printFilters.signatureMode || 'both';
          nextPreview = {
            status: 'ready',
            title: 'Firme settimanali squadra',
            subtitle: `${selectedTeam.name || '-'} · ${formatDateRangeLabel(dateFrom, dateTo)}`,
            fileName: `firme-settimanali-${normalizeSortText(selectedTeam.name) || 'squadra'}-${dateFrom}.pdf`,
            folderName: 'Presenze squadra',
            landscape: false,
            summaryCards: [
              { label: 'Squadra', value: selectedTeam.name || '-' },
              { label: 'Periodo', value: formatDateRangeLabel(dateFrom, dateTo) },
              { label: 'Componenti', value: String(members.length) },
              { label: 'Modalità', value: signatureMode === 'daily' ? 'Giornaliera' : signatureMode === 'weekly' ? 'Settimanale' : 'Giornaliera + settimanale' },
            ],
            columns: [
              { label: 'Dipendente', key: 'employee', align: 'left' },
              { label: 'Squadra', key: 'team', align: 'left' },
            ],
            rows: members,
            signatureRows: members,
            weekDays,
            signatureMode,
            customHtml: buildWeeklySignaturesHtml({
              title: 'Firme settimanali squadra',
              subtitle: `${selectedTeam.name || '-'} · ${formatDateRangeLabel(dateFrom, dateTo)}`,
              summaryCards: [
                { label: 'Squadra', value: selectedTeam.name || '-' },
                { label: 'Periodo', value: formatDateRangeLabel(dateFrom, dateTo) },
                { label: 'Componenti', value: String(members.length) },
                { label: 'Modalità', value: signatureMode === 'daily' ? 'Giornaliera' : signatureMode === 'weekly' ? 'Settimanale' : 'Giornaliera + settimanale' },
              ],
              signatureRows: members,
              weekDays,
              signatureMode,
            }, settings?.company?.document_header || settings?.company?.name || 'GPA 1.0.5'),
          };
          break;
        }

        case 'report-employee-month':
        case 'report-employees-month': {
          const employeesToLoad =
            selectedType.id === 'report-employee-month'
              ? selectedPrintEmployees.slice(0, 1)
              : selectedPrintEmployees;
          const records = await Promise.all(
            employeesToLoad.map((employee) => window.api.payroll.getRecord(Number(employee.id), monthKey))
          );

          nextPreview = {
            status: 'ready',
            title:
              selectedType.id === 'report-employee-month'
                ? `Report mensile ${getEmployeeLabel(employeesToLoad[0])}`
                : `Report mensili dipendenti selezionati`,
            subtitle: 'Riepilogo economico dei report salvati nel mese selezionato.',
            fileName:
              selectedType.id === 'report-employee-month'
                ? `report-${normalizeSortText(getEmployeeLabel(employeesToLoad[0]))}-${monthKey}.pdf`
                : `report-dipendenti-${monthKey}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Periodo', value: formatMonthLabel(monthKey) },
              { label: 'Report', value: String(employeesToLoad.length) },
            ],
            columns: [
              { label: 'Dipendente', key: 'employee', align: 'left' },
              { label: 'Datore', key: 'employer', align: 'left' },
              { label: 'Giornate', key: 'days', align: 'center' },
              { label: 'Compenso mese', key: 'compensation', align: 'right' },
              { label: 'Importo busta', key: 'payrollAmount', align: 'right' },
              { label: 'Saldo finale', key: 'balance', align: 'right' },
              { label: 'Stato saldo', key: 'balanceStatus', align: 'center' },
            ],
            rows: employeesToLoad.map((employee, index) => {
              const record = records[index];
              return {
                employee: getEmployeeLabel(employee),
                employer: record?.datore || employee.hired_by || '-',
                days: formatNumber(record?.giornate_effettuate || 0),
                compensation: formatCurrency(record?.retribuzione_calcolata || 0),
                payrollAmount: formatCurrency(record?.importo_busta_paga || 0),
                balance: formatCurrency(record?.remaining_balance ?? record?.differenza_finale ?? 0),
                balanceStatus: getBalanceStatusLabel(record?.balance_status),
              };
            }),
          };
          break;
        }

        case 'report-team-month': {
          if (!selectedTeam) {
            nextPreview = {
              status: 'empty',
              title: 'Report mensile squadra',
              subtitle: 'Seleziona una squadra per generare questa stampa.',
              columns: [],
              rows: [],
              summaryCards: [],
            };
            break;
          }

          const [record, advances, components, teamAttendanceRows] = await Promise.all([
            window.api.teamPayroll.getReportRecord(Number(selectedTeam.id), monthKey),
            window.api.teamPayroll.listAdvances(Number(selectedTeam.id), monthKey),
            window.api.teamPayroll.listPayrollComponents(Number(selectedTeam.id), monthKey),
            window.api.attendance.listTeamByMonth(Number(printFilters.year), Number(printFilters.month)),
          ]);
          const filteredAttendance = teamAttendanceRows.filter((row) => Number(row.team_id) === Number(selectedTeam.id));
          const standardHours = Number(settings?.general?.standard_day_hours || 7) || 7;
          const equivalentDays = filteredAttendance.reduce((sum, row) => {
            const totalHours = Number(row.headcount || 0) * Number(row.hours_per_person || 0);
            return sum + (standardHours > 0 ? totalHours / standardHours : 0);
          }, 0);
          const grossCompensation = record?.report_snapshot_json?.gross_compensation
            ?? equivalentDays * Number(selectedTeam.team_daily_rate || 0);
          const transportAmount = Number(record?.transport_amount || 0);
          const advancesTotal = (advances || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const componentsTotal = (components || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const finalBalance = record?.report_snapshot_json?.final_balance
            ?? (grossCompensation + transportAmount - advancesTotal - componentsTotal);

          nextPreview = {
            status: 'ready',
            title: `Report mensile squadra ${selectedTeam.name}`,
            subtitle: 'Riepilogo squadra con compenso, acconti, componenti e saldo finale.',
            fileName: `report-squadra-${normalizeSortText(selectedTeam.name) || 'squadra'}-${monthKey}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Periodo', value: formatMonthLabel(monthKey) },
              { label: 'Squadra', value: selectedTeam.name || '-' },
              { label: 'Saldo finale', value: formatCurrency(finalBalance) },
            ],
            columns: [
              { label: 'Voce', key: 'label', align: 'left' },
              { label: 'Dettaglio', key: 'detail', align: 'left' },
              { label: 'Valore', key: 'value', align: 'right' },
            ],
            rows: [
              {
                label: 'Retribuzione calcolata',
                detail: `${formatNumber(equivalentDays)} gg x ${formatCurrency(selectedTeam.team_daily_rate || 0)}`,
                value: formatCurrency(grossCompensation),
              },
              {
                label: 'Trasporto squadra',
                detail: record?.transport_description || '-',
                value: formatCurrency(transportAmount),
              },
              {
                label: 'Acconti squadra',
                detail: `${(advances || []).length} movimenti`,
                value: formatCurrency(advancesTotal),
              },
              {
                label: 'Buste paga componenti',
                detail: `${(components || []).length} righe`,
                value: formatCurrency(componentsTotal),
              },
              {
                label: 'Saldo finale squadra',
                detail: getBalanceStatusLabel(record?.report_snapshot_json?.final_balance ? 'saldato' : 'non_pagato').replace('Non pagato', 'Calcolato'),
                value: formatCurrency(finalBalance),
              },
            ],
          };
          break;
        }

        case 'report-history-month':
        case 'payroll-list-month':
        case 'payroll-status-month': {
          const historyRows = await window.api.payroll.listHistory({
            year: Number(printFilters.year),
            month: monthKey,
            employee_id: selectedPrintEmployeeIds[0] || undefined,
          });
          let items = Array.isArray(historyRows?.items)
            ? historyRows.items
            : Array.isArray(historyRows)
            ? historyRows
            : [];

          if (selectedType.id === 'report-history-month' && printFilters.balanceStatus) {
            items = items.filter((item) => String(item.balance_status || '').toLowerCase() === String(printFilters.balanceStatus).toLowerCase());
          }
          if (selectedType.id === 'payroll-status-month' && printFilters.payrollPaymentStatus) {
            items = items.filter((item) => String(item.payroll_payment_status || '').toLowerCase() === String(printFilters.payrollPaymentStatus).toLowerCase());
          }

          nextPreview = {
            status: 'ready',
            title:
              selectedType.id === 'report-history-month'
                ? `Storico report ${formatMonthLabel(monthKey)}`
                : selectedType.id === 'payroll-list-month'
                ? `Elenco buste paga ${formatMonthLabel(monthKey)}`
                : `Stato buste paga ${formatMonthLabel(monthKey)}`,
            subtitle:
              selectedType.id === 'report-history-month'
                ? 'Riepilogo storico mensile con stato saldo.'
                : 'Riepilogo mensile delle buste paga salvate.',
            fileName:
              selectedType.id === 'report-history-month'
                ? `storico-report-${monthKey}.pdf`
                : selectedType.id === 'payroll-list-month'
                ? `buste-paga-${monthKey}.pdf`
                : `stato-buste-${monthKey}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Periodo', value: formatMonthLabel(monthKey) },
              { label: 'Righe', value: String(items.length) },
            ],
            columns:
              selectedType.id === 'report-history-month'
                ? [
                    { label: 'Dipendente', key: 'employee', align: 'left' },
                    { label: 'Datore', key: 'employer', align: 'left' },
                    { label: 'Compenso', key: 'compensation', align: 'right' },
                    { label: 'Busta', key: 'payrollAmount', align: 'right' },
                    { label: 'Residuo', key: 'remaining', align: 'right' },
                    { label: 'Stato saldo', key: 'balanceStatus', align: 'center' },
                  ]
                : [
                    { label: 'Dipendente', key: 'employee', align: 'left' },
                    { label: 'Datore', key: 'employer', align: 'left' },
                    { label: 'Importo busta', key: 'payrollAmount', align: 'right' },
                    { label: 'Modalita', key: 'method', align: 'center' },
                    { label: 'Data pagamento', key: 'paymentDate', align: 'center' },
                    { label: 'Stato busta', key: 'payrollStatus', align: 'center' },
                  ],
            rows: items.map((item) =>
              selectedType.id === 'report-history-month'
                ? {
                    employee: getEmployeeLabel(item.employee),
                    employer: item.datore || '-',
                    compensation: formatCurrency(item.retribuzione_calcolata || 0),
                    payrollAmount: formatCurrency(item.importo_busta_paga || 0),
                    remaining: formatCurrency(item.remaining_balance ?? item.differenza_finale ?? 0),
                    balanceStatus: getBalanceStatusLabel(item.balance_status),
                  }
                : {
                    employee: getEmployeeLabel(item.employee),
                    employer: item.datore || '-',
                    payrollAmount: formatCurrency(item.importo_busta_paga || 0),
                    method: getPayrollPaymentMethodLabel(item.payroll_payment_method),
                    paymentDate: formatDate(item.payroll_payment_date),
                    payrollStatus: getPayrollPaymentStatusLabel(item.payroll_payment_status),
                  }
            ),
          };
          break;
        }

        case 'payroll-selected-days-month': {
          const teamFilterId = Number(printFilters.teamId || 0) || null;
          const selectedEmployeeIdSet = new Set(selectedPrintEmployeeIds.map((id) => Number(id)).filter(Boolean));
          const historyRows = await window.api.payroll.listHistory({
            year: Number(printFilters.year),
            month: monthKey,
          });
          const payrollRecords = Array.isArray(historyRows?.items)
            ? historyRows.items
            : Array.isArray(historyRows)
            ? historyRows
            : [];
          const teamsToLoad = teamFilterId
            ? sortedTeams.filter((team) => Number(team.id) === teamFilterId)
            : sortedTeams;
          const componentGroups = await Promise.all(
            teamsToLoad.map(async (team) => ({
              team,
              components: await window.api.teamPayroll.listPayrollComponents(Number(team.id), monthKey),
            }))
          );
          const rowsMap = new Map();

          function upsertPayrollDaysRow(rowKey, payload) {
            if (!rowKey) return;
            const existing = rowsMap.get(rowKey);
            if (!existing) {
              rowsMap.set(rowKey, {
                ...payload,
                selectedDays: normalizeSelectedPayrollDays(payload.selectedDays),
              });
              return;
            }
            const mergedDays = normalizeSelectedPayrollDays([
              ...(existing.selectedDays || []),
              ...(payload.selectedDays || []),
            ]);
            const nextTeams = [...new Set([existing.team, payload.team].filter(Boolean))].join(', ');
            rowsMap.set(rowKey, {
              ...existing,
              selectedDays: mergedDays,
              totalDays: mergedDays.length,
              team: nextTeams || existing.team || payload.team || '-',
            });
          }

          payrollRecords.forEach((record) => {
            const selectedDays = normalizeSelectedPayrollDays(record?.selected_payroll_days ?? record?.selected_payroll_days_json);
            if (!selectedDays.length) return;
            const employeeId = Number(record?.employee_id || record?.employee?.id || 0);
            const employee = employeesById.get(employeeId) || record?.employee || null;
            if (teamFilterId && employee && !employeeBelongsToTeam(employee, teamFilterId)) {
              return;
            }
            if (selectedEmployeeIdSet.size && (!employeeId || !selectedEmployeeIdSet.has(employeeId))) {
              return;
            }
            const employeeLabel = employee
              ? getEmployeeLabel(employee)
              : formatAttendanceEmployeeDisplayName(record?.employee || {
                  first_name: record?.employee_first_name || '',
                  last_name: record?.employee_last_name || '',
                }) || '-';
            upsertPayrollDaysRow(`employee-${employeeId || employeeLabel}`, {
              employee: employeeLabel,
              employeeSortRef: employee || null,
              team: employee ? getEmployeeCurrentTeamLabel(employee) : ((record?.employee?.team_names || []).join(', ') || '-'),
              selectedDays,
              totalDays: selectedDays.length,
            });
          });

          componentGroups.forEach(({ team, components }) => {
            (Array.isArray(components) ? components : []).forEach((component) => {
              const selectedDays = normalizeSelectedPayrollDays(component?.selected_payroll_days ?? component?.selected_payroll_days_json);
              if (!selectedDays.length) return;
              const employeeId = Number(component?.employee_id || 0) || null;
              if (selectedEmployeeIdSet.size) {
                if (!employeeId || !selectedEmployeeIdSet.has(employeeId)) {
                  return;
                }
              }
              const employee = employeeId ? employeesById.get(employeeId) : null;
              const employeeLabel = employee
                ? getEmployeeLabel(employee)
                : normalizeText(component?.employee_label) || '-';
              upsertPayrollDaysRow(employeeId ? `employee-${employeeId}` : `component-${team?.id || 'team'}-${employeeLabel}`, {
                employee: employeeLabel,
                employeeSortRef: employee || null,
                team: team?.name || '-',
                selectedDays,
                totalDays: selectedDays.length,
              });
            });
          });

          const previewRows = [...rowsMap.values()]
            .filter((row) => Array.isArray(row.selectedDays) && row.selectedDays.length > 0)
            .sort((left, right) => {
              if (left.employeeSortRef && right.employeeSortRef) {
                return compareEmployees(left.employeeSortRef, right.employeeSortRef);
              }
              if (left.employeeSortRef) return -1;
              if (right.employeeSortRef) return 1;
              return normalizeSortText(left.employee).localeCompare(normalizeSortText(right.employee), 'it', {
                sensitivity: 'base',
              });
            });
          const gridDays = buildPayrollGridDays(printFilters.year, printFilters.month);
          const totalMarks = previewRows.reduce((sum, row) => sum + Number(row.totalDays || 0), 0);

          nextPreview = {
            status: 'ready',
            title: 'Date inserite busta paga',
            subtitle: formatMonthLabel(monthKey),
            fileName: `date-busta-paga-${monthKey}.pdf`,
            folderName: 'Buste paga',
            landscape: true,
            summaryCards: [
              { label: 'Periodo', value: formatMonthLabel(monthKey) },
              { label: 'Righe', value: String(previewRows.length) },
              { label: 'Giorni busta', value: String(totalMarks) },
            ],
            columns: [
              { label: 'Dipendente', key: 'employee', align: 'left' },
              { label: 'Squadra', key: 'team', align: 'left' },
              { label: 'Date busta', key: 'days', align: 'left' },
              { label: 'Totale giorni', key: 'total', align: 'center' },
            ],
            rows: previewRows.map((row) => ({
              employee: row.employee,
              team: row.team || '-',
              days: row.selectedDays.join(', '),
              total: String(row.totalDays || 0),
            })),
            gridDays,
            gridRows: previewRows,
            customHtml: buildPayrollSelectedDaysPrintHtml({
              title: 'Date inserite busta paga',
              subtitle: formatMonthLabel(monthKey),
              summaryCards: [
                { label: 'Periodo', value: formatMonthLabel(monthKey) },
                { label: 'Righe', value: String(previewRows.length) },
                { label: 'Giorni busta', value: String(totalMarks) },
              ],
              gridDays,
              gridRows: previewRows,
            }, settings?.company?.document_header || settings?.company?.name || 'GPA 1.0.5'),
          };

          if (!previewRows.length) {
            nextPreview = {
              ...nextPreview,
              status: 'empty',
              subtitle: 'Nessuna data busta paga trovata nel mese selezionato con i filtri correnti.',
            };
          }
          break;
        }

        case 'employees-active':
        case 'employees-inactive': {
          const dpiAssignments = await window.api.dpi.listAssignments();
          const dpiAssignmentsByEmployeeId = buildDpiAssignmentsMap(dpiAssignments);
          const rows = sortedEmployees.filter((employee) =>
            selectedType.id === 'employees-active'
              ? isEmployeeCurrentlyActive(employee)
              : !isEmployeeCurrentlyActive(employee)
          );
          nextPreview = {
            status: 'ready',
            title: selectedType.id === 'employees-active' ? 'Elenco dipendenti attivi' : 'Elenco dipendenti inattivi',
            subtitle: 'Elenco anagrafico completo con stato, squadra, visite, formazione e DPI.',
            fileName: selectedType.id === 'employees-active' ? 'elenco-dipendenti-attivi.pdf' : 'elenco-dipendenti-inattivi.pdf',
            landscape: true,
            summaryCards: [
              { label: 'Dipendenti', value: String(rows.length) },
            ],
            columns: [
              { label: 'Dipendente', key: 'employee', align: 'left' },
              { label: 'Codice fiscale', key: 'fiscalCode', align: 'left' },
              { label: 'Mansione', key: 'role', align: 'left' },
              { label: 'Squadra', key: 'team', align: 'left' },
              { label: 'Datore', key: 'employer', align: 'left' },
              { label: 'Assunzione', key: 'hireDate', align: 'center' },
              { label: 'Fine contratto', key: 'contractEndDate', align: 'center' },
              { label: 'Cessazione', key: 'terminationDate', align: 'center' },
              { label: 'Motivo chiusura', key: 'closureReason', align: 'left' },
              { label: 'Stato', key: 'state', align: 'center' },
              { label: 'Visita medica', key: 'medicalVisit', align: 'left' },
              { label: 'Art. 37', key: 'art37', align: 'left' },
              { label: 'DPI', key: 'dpi', align: 'left' },
              { label: 'Note', key: 'notes', align: 'left' },
            ],
            rows: rows.map((employee) => ({
              employee: getEmployeeLabel(employee),
              fiscalCode: employee.fiscal_code || '-',
              role: employee.role || '-',
              team: getEmployeeCurrentTeamLabel(employee),
              employer: getEmployeeEmployerLabel(employee),
              hireDate: formatDate(getEmployeeHireDate(employee)),
              contractEndDate: formatDate(getEmployeeContractEndDate(employee)),
              terminationDate: formatDate(getEmployeeTerminationDate(employee)),
              closureReason: getEmployeeClosureReason(employee) || '-',
              state: getEmployeeStateLabel(employee),
              medicalVisit: formatPresenceState(
                employee.medical_visit_done || employee.medical_visit_done_with_us,
                employee.medical_visit_date,
                employee.medical_visit_expiry
              ),
              art37: formatPresenceState(
                employee.art37_done || employee.art37_done_with_us,
                employee.art37_date,
                employee.art37_expiry
              ),
              dpi: formatPresenceState(
                dpiAssignmentsByEmployeeId.has(Number(employee.id)),
                dpiAssignmentsByEmployeeId.get(Number(employee.id))?.assigned_date,
                ''
              ),
              notes: employee.notes || '-',
            })),
          };
          break;
        }

        case 'teams-list': {
          nextPreview = {
            status: 'ready',
            title: 'Elenco squadre',
            subtitle: 'Anagrafica squadre con numero componenti e tariffa.',
            fileName: 'elenco-squadre.pdf',
            landscape: true,
            summaryCards: [
              { label: 'Squadre', value: String(sortedTeams.length) },
            ],
            columns: [
              { label: 'Squadra', key: 'team', align: 'left' },
              { label: 'Componenti', key: 'members', align: 'center' },
              { label: 'Tariffa', key: 'rate', align: 'right' },
              { label: 'Stato', key: 'status', align: 'center' },
            ],
            rows: sortedTeams.map((team) => ({
              team: team.name || '-',
              members: String((team.members || []).length),
              rate: formatCurrency(team.team_daily_rate || 0),
              status: team.is_archived ? 'Archiviata' : 'Attiva',
            })),
          };
          break;
        }

        case 'team-members': {
          if (!selectedTeam) {
            nextPreview = {
              status: 'empty',
              title: 'Elenco dipendenti per squadra',
              subtitle: 'Seleziona una squadra per generare questa stampa.',
              columns: [],
              rows: [],
              summaryCards: [],
            };
            break;
          }
          const members = [...(selectedTeam.members || [])].sort((left, right) => compareEmployees(left.employee, right.employee));
          nextPreview = {
            status: 'ready',
            title: `Dipendenti squadra ${selectedTeam.name}`,
            subtitle: 'Componenti associati alla squadra selezionata.',
            fileName: `dipendenti-squadra-${normalizeSortText(selectedTeam.name) || 'squadra'}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Squadra', value: selectedTeam.name || '-' },
              { label: 'Componenti', value: String(members.length) },
            ],
            columns: [
              { label: 'Dipendente', key: 'employee', align: 'left' },
              { label: 'Mansione', key: 'role', align: 'left' },
              { label: 'Compenso', key: 'compensation', align: 'right' },
              { label: 'Gestione giorni', key: 'manageByDays', align: 'center' },
            ],
            rows: members.map((member) => ({
              employee: getEmployeeLabel(member.employee),
              role: member.employee?.role || '-',
              compensation: member.compensation !== null && member.compensation !== undefined ? formatCurrency(member.compensation) : '-',
              manageByDays: member.manage_by_days ? 'Si' : 'No',
            })),
          };
          break;
        }

        case 'dpi-inventory': {
          const items = await window.api.dpi.listItems({ includeArchived: true });
          nextPreview = {
            status: 'ready',
            title: 'Magazzino DPI',
            subtitle: 'Situazione aggiornata del magazzino DPI.',
            fileName: 'magazzino-dpi.pdf',
            landscape: true,
            summaryCards: [
              { label: 'Articoli', value: String(Array.isArray(items) ? items.length : 0) },
            ],
            columns: [
              { label: 'Tipologia', key: 'type', align: 'left' },
              { label: 'Descrizione', key: 'description', align: 'left' },
              { label: 'Taglia', key: 'size', align: 'center' },
              { label: 'Disponibili', key: 'available', align: 'center' },
              { label: 'Assegnati', key: 'assigned', align: 'center' },
              { label: 'Acquistati', key: 'purchased', align: 'center' },
            ],
            rows: (Array.isArray(items) ? items : []).map((item) => ({
              type: item.type || '-',
              description: item.description || '-',
              size: item.size || '-',
              available: formatNumber(item.available_quantity),
              assigned: formatNumber(item.assigned_quantity),
              purchased: formatNumber(item.purchased_quantity),
            })),
          };
          break;
        }

        case 'dpi-assignments': {
          const assignments = await window.api.dpi.listAssignments();
          nextPreview = {
            status: 'ready',
            title: 'Assegnazioni DPI',
            subtitle: 'Storico assegnazioni DPI ordinate per data.',
            fileName: 'assegnazioni-dpi.pdf',
            landscape: true,
            summaryCards: [
              { label: 'Assegnazioni', value: String(Array.isArray(assignments) ? assignments.length : 0) },
            ],
            columns: [
              { label: 'Dipendente', key: 'employee', align: 'left' },
              { label: 'DPI', key: 'item', align: 'left' },
              { label: 'Taglia', key: 'size', align: 'center' },
              { label: 'Quantita', key: 'quantity', align: 'center' },
              { label: 'Data consegna', key: 'assignedDate', align: 'center' },
            ],
            rows: (Array.isArray(assignments) ? assignments : []).map((assignment) => ({
              employee: assignment.employee_name || '-',
              item: [assignment.item_type, assignment.item_description].filter(Boolean).join(' - ') || '-',
              size: assignment.item_size || '-',
              quantity: formatNumber(assignment.quantity),
              assignedDate: formatDate(assignment.assigned_date),
            })),
          };
          break;
        }

        case 'dpi-employee': {
          if (!selectedPrintEmployeeIds.length) {
            nextPreview = {
              status: 'empty',
              title: 'DPI per dipendente',
              subtitle: 'Seleziona un dipendente per generare questa stampa.',
              columns: [],
              rows: [],
              summaryCards: [],
            };
            break;
          }
          const employee = selectedPrintEmployees[0];
          const assignments = await window.api.dpi.getEmployeeAssignments(Number(employee.id));
          nextPreview = {
            status: 'ready',
            title: `DPI assegnati a ${getEmployeeLabel(employee)}`,
            subtitle: 'Storico DPI collegato al dipendente selezionato.',
            fileName: `dpi-${normalizeSortText(getEmployeeLabel(employee)) || 'dipendente'}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Dipendente', value: getEmployeeLabel(employee) || '-' },
              { label: 'Assegnazioni', value: String(Array.isArray(assignments) ? assignments.length : 0) },
            ],
            columns: [
              { label: 'DPI', key: 'item', align: 'left' },
              { label: 'Taglia', key: 'size', align: 'center' },
              { label: 'Quantita', key: 'quantity', align: 'center' },
              { label: 'Data consegna', key: 'assignedDate', align: 'center' },
              { label: 'Note', key: 'notes', align: 'left' },
            ],
            rows: (Array.isArray(assignments) ? assignments : []).map((assignment) => ({
              item: [assignment.item_type, assignment.item_description].filter(Boolean).join(' - ') || '-',
              size: assignment.item_size || '-',
              quantity: formatNumber(assignment.quantity),
              assignedDate: formatDate(assignment.assigned_date),
              notes: assignment.notes || '-',
            })),
          };
          break;
        }

        default:
          nextPreview = {
            status: 'disabled',
            title: selectedType.label,
            subtitle: 'Stampa non ancora collegata.',
            columns: [],
            rows: [],
            summaryCards: [],
          };
      }

      setPrintPreview(nextPreview);
    } catch (error) {
      console.error(error);
      setPrintPreview({
        status: 'error',
        title: selectedType.label,
        subtitle: error?.message || 'Errore caricamento anteprima stampa.',
        columns: [],
        rows: [],
        summaryCards: [],
      });
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab !== 'prints') return;
    loadPrintPreview();
  }, [
    activeTab,
    selectedTypeId,
    printFilters.year,
    printFilters.month,
    printFilters.date,
    printFilters.dateFrom,
    printFilters.dateTo,
    printFilters.weekOfMonth,
    printFilters.teamId,
    printFilters.balanceStatus,
    printFilters.payrollPaymentStatus,
    printFilters.signatureMode,
    attendanceDayTeamFilter,
    includeAttendanceDayHireDates,
    selectedPrintEmployeeIds,
    settings,
    weeklySignatureWeekOptions,
  ]);

  async function handlePrintOutput(mode) {
    if (!printPreview || printPreview.status !== 'ready') return;
    const companyHeader = settings?.company?.document_header || settings?.company?.name || 'GPA 1.0.5';
    const html = printPreview.customHtml || buildPrintHtml(printPreview, companyHeader);
    const fileName = printPreview.fileName || 'stampa.pdf';

    try {
      if (mode === 'pdf') {
        await window.api.reports.savePdf({
          html,
          fileName,
          landscape: !!printPreview.landscape,
          debugRenderLabel: `print-hub:${selectedTypeId}`,
        });
      } else if (mode === 'print') {
        await window.api.reports.printHtml({
          html,
          fileName,
          landscape: !!printPreview.landscape,
        });
      } else if (mode === 'export') {
        const result = await window.api.reports.savePdfToFolder({
          html,
          fileName,
          monthFolderName: printPreview.folderName || 'Stampe e Documenti',
          landscape: !!printPreview.landscape,
        });
        if (!result?.canceled && result?.file_path) {
          alert(`Esportazione completata in:\n${result.file_path}`);
        }
      }
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Generazione stampa non riuscita.');
    }
  }

  function renderPrintFilters() {
    if (!selectedType) return null;
    return (
      <div className="print-hub-filters print-hub-filters--wizard">
        {selectedType.filters.includes('year') ? (
          <label className="print-hub-field">
            <span>Anno</span>
            <input
              type="number"
              min="2000"
              max="2100"
              value={printFilters.year}
              onChange={(event) => setPrintFilters((current) => ({ ...current, year: event.target.value }))}
            />
          </label>
        ) : null}
        {selectedType.filters.includes('month') ? (
          <label className="print-hub-field">
            <span>Mese</span>
            <select
              value={printFilters.month}
              onChange={(event) => setPrintFilters((current) => ({ ...current, month: event.target.value }))}
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selectedType.filters.includes('date') ? (
          <label className="print-hub-field">
            <span>Data</span>
            <input
              type="date"
              value={printFilters.date}
              onChange={(event) => setPrintFilters((current) => ({ ...current, date: event.target.value }))}
            />
          </label>
        ) : null}
        {selectedType.filters.includes('dateFrom') ? (
          <label className="print-hub-field">
            <span>Dal</span>
            <input
              type="date"
              value={printFilters.dateFrom}
              onChange={(event) => setPrintFilters((current) => ({ ...current, dateFrom: event.target.value }))}
            />
          </label>
        ) : null}
        {selectedType.filters.includes('dateTo') ? (
          <label className="print-hub-field">
            <span>Al</span>
            <input
              type="date"
              value={printFilters.dateTo}
              onChange={(event) => setPrintFilters((current) => ({ ...current, dateTo: event.target.value }))}
            />
          </label>
        ) : null}
        {selectedType.filters.includes('teamId') ? (
          <label className="print-hub-field">
            <span>Squadra</span>
            <select
              value={printFilters.teamId}
              onChange={(event) => setPrintFilters((current) => ({ ...current, teamId: event.target.value }))}
            >
              <option value="">
                {selectedType.id === 'payroll-selected-days-month' ? 'Tutte le squadre' : 'Seleziona squadra'}
              </option>
              {sortedTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selectedType.id === 'attendance-team-weekly-signatures' ? (
          <>
            <label className="print-hub-field">
              <span>Settimana del mese</span>
              <select
                value={printFilters.weekOfMonth}
                onChange={(event) => setPrintFilters((current) => ({ ...current, weekOfMonth: event.target.value }))}
              >
                <option value="">Seleziona settimana</option>
                {weeklySignatureWeekOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="print-hub-field">
              <span>Modalità firma</span>
              <select
                value={printFilters.signatureMode}
                onChange={(event) => setPrintFilters((current) => ({ ...current, signatureMode: event.target.value }))}
              >
                <option value="daily">Giornaliera</option>
                <option value="weekly">Settimanale</option>
                <option value="both">Giornaliera + settimanale</option>
              </select>
            </label>
          </>
        ) : null}
        {selectedType.filters.includes('balanceStatus') ? (
          <label className="print-hub-field">
            <span>Stato saldo</span>
            <select
              value={printFilters.balanceStatus}
              onChange={(event) => setPrintFilters((current) => ({ ...current, balanceStatus: event.target.value }))}
            >
              <option value="">Tutti</option>
              <option value="non_pagato">Non pagato</option>
              <option value="parziale">Parziale</option>
              <option value="saldato">Saldato</option>
            </select>
          </label>
        ) : null}
        {selectedType.filters.includes('payrollPaymentStatus') ? (
          <label className="print-hub-field">
            <span>Stato busta</span>
            <select
              value={printFilters.payrollPaymentStatus}
              onChange={(event) => setPrintFilters((current) => ({ ...current, payrollPaymentStatus: event.target.value }))}
            >
              <option value="">Tutti</option>
              <option value="non_pagato">Non pagato</option>
              <option value="pagato">Pagato</option>
            </select>
          </label>
        ) : null}
      </div>
    );
  }

  function renderPrintEmployeePicker() {
    if (!selectedType || selectedType.employeeSelection === 'none') {
      return null;
    }

    const isMulti = selectedType.employeeSelection === 'multiple' || selectedType.employeeSelection === 'multiple_optional';
    const modeLabel = getEmployeeSelectionModeLabel(selectedType.employeeSelection);

    return (
      <section className="print-hub-wizard-card">
        <div className="section-header">
          <div>
            <h3 className="section-title">4. Dipendenti</h3>
            <p className="section-subtitle">
              Cerca i dipendenti interessati e costruisci la selezione da stampare.
            </p>
          </div>
          {modeLabel ? <span className="soft-chip">{modeLabel}</span> : null}
        </div>

        {selectedType.id === 'attendance-day' ? (
          <div className="print-hub-employee-options">
            <label className="print-hub-field">
              <span>Squadra</span>
              <select
                value={attendanceDayTeamFilter}
                onChange={(event) => updateAttendanceDayTeamFilter(event.target.value)}
              >
                <option value="">Tutte le squadre</option>
                {attendanceDayTeamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="print-hub-checkbox-option">
              <input
                type="checkbox"
                checked={includeAttendanceDayHireDates}
                onChange={(event) => setIncludeAttendanceDayHireDates(event.target.checked)}
              />
              <span>Includi date di assunzione</span>
            </label>
          </div>
        ) : null}

        <label className="print-hub-field print-hub-field--search">
          <span>Cerca dipendente</span>
          <input
            className="search-input print-hub-search-input"
            type="text"
            value={printEmployeeSearch}
            onChange={(event) => setPrintEmployeeSearch(event.target.value)}
            placeholder="Cerca dipendente..."
          />
        </label>

        <div className="print-hub-selection-toolbar">
          <span className="soft-chip soft-chip--success">
            {selectedPrintEmployeeIds.length} dipendenti selezionati
          </span>
          {isMulti ? (
            <button type="button" className="button-secondary" onClick={selectAllFilteredEmployees}>
              Seleziona tutti filtrati
            </button>
          ) : null}
            <button type="button" className="button-secondary" onClick={clearPrintEmployeeSelection}>
            Svuota selezione
          </button>
        </div>

        {selectedPrintEmployees.length ? (
          <div className="print-hub-selected-list">
            {selectedPrintEmployees.slice(0, 8).map((employee) => (
              <span key={employee.id} className="soft-chip">
                {getEmployeeLabel(employee)}
              </span>
            ))}
            {selectedPrintEmployees.length > 8 ? (
              <span className="soft-chip">+{selectedPrintEmployees.length - 8} altri</span>
            ) : null}
          </div>
        ) : null}

        <div className="print-hub-search-results">
          {printSearchResults.map((employee) => {
            const checked = selectedPrintEmployeeIds.includes(Number(employee.id));
            return (
              <label key={employee.id} className={`print-hub-check-card ${checked ? 'print-hub-check-card--active' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePrintEmployeeSelection(employee.id)}
                />
                <div>
                  <strong>{getEmployeeLabel(employee)}</strong>
                  <span>{employee.role || 'Dipendente'}</span>
                </div>
              </label>
            );
          })}
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <div className="page print-hub-page">
        <section className="page-hero">
          <div>
            <span className="page-kicker">Centro operativo documenti</span>
            <h1 className="page-title">{PAGE_ICON} Stampa e Documenti</h1>
            <p className="page-subtitle">Caricamento dati in corso...</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page print-hub-page">
      <section className="page-hero print-hub-page__hero">
        <div>
          <span className="page-kicker">Centro operativo documenti</span>
          <h1 className="page-title">{PAGE_ICON} Stampa e Documenti</h1>
          <p className="page-subtitle">
            Unica sezione per aprire allegati e gestire le stampe del gestionale.
          </p>
        </div>
      </section>

      <div className="print-hub-tabs">
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`print-hub-tab ${activeTab === tab.id ? 'print-hub-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'documents' ? (
        <div className="print-hub-documents">
          <section className="section-card print-hub-documents-card">
            <div className="section-header">
              <div>
                <h2 className="section-title">Documenti allegati</h2>
                <p className="section-subtitle">
                  Cerca un dipendente, scegli il tipo documento e lavora solo sugli allegati rilevanti.
                </p>
              </div>
              {selectedEmployee ? (
                <button className="button-secondary" type="button" onClick={handleResetDocumentSelection}>
                  Cambia dipendente
                </button>
              ) : null}
            </div>

            <div className="print-hub-search-panel">
              <label className="print-hub-field print-hub-field--search">
                <span>Cerca dipendente</span>
                <input
                  className="search-input print-hub-search-input"
                  type="text"
                  value={employeeSearch}
                  onChange={(event) => {
                    setEmployeeSearch(event.target.value);
                    if (
                      selectedEmployee &&
                      normalizeSortText(event.target.value) !== normalizeSortText(getEmployeeLabel(selectedEmployee))
                    ) {
                      setSelectedEmployee(null);
                      setDocuments([]);
                    }
                  }}
                  placeholder="Cerca dipendente..."
                />
              </label>

              {!selectedEmployee ? (
                <>
                  <div className="print-hub-search-help">
                    Cerca e seleziona un dipendente per visualizzare i documenti allegati.
                  </div>
                  {employeeSearchResults.length ? (
                    <div className="print-hub-search-results">
                      {employeeSearchResults.map((employee) => (
                        <button
                          key={employee.id}
                          type="button"
                          className="print-hub-search-result"
                          onClick={() => handleSelectEmployee(employee)}
                        >
                          <strong>{getEmployeeLabel(employee)}</strong>
                          <span>{employee.role || 'Dipendente'}</span>
                        </button>
                      ))}
                    </div>
                  ) : employeeSearch ? (
                    <div className="empty-state">Nessun dipendente trovato con questo criterio.</div>
                  ) : null}
                </>
              ) : null}
            </div>

            {selectedEmployee ? (
              <>
                <div className="print-hub-selected-employee">
                  <div>
                    <span className="page-kicker">Dipendente selezionato</span>
                    <h3>{getEmployeeLabel(selectedEmployee)}</h3>
                    <p>{selectedEmployee.role || 'Scheda dipendente'}</p>
                  </div>
                  <div className="print-hub-summary-strip">
                    <span className="soft-chip soft-chip--success">{filteredDocuments.length} documenti trovati</span>
                  </div>
                </div>

                <div className="print-hub-filters print-hub-filters--documents">
                  <label className="print-hub-field">
                    <span>Tipo documento</span>
                    <select
                      value={documentsFilters.documentType}
                      onChange={(event) => setDocumentsFilters((current) => ({ ...current, documentType: event.target.value }))}
                    >
                      {DOCUMENT_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="print-hub-field">
                    <span>Mese / anno</span>
                    <select
                      value={documentsFilters.monthReference}
                      onChange={(event) => setDocumentsFilters((current) => ({ ...current, monthReference: event.target.value }))}
                    >
                      <option value="">Tutti</option>
                      {documentMonthOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="print-hub-field">
                    <span>Data caricamento</span>
                    <input
                      type="date"
                      value={documentsFilters.uploadDate}
                      onChange={(event) => setDocumentsFilters((current) => ({ ...current, uploadDate: event.target.value }))}
                    />
                  </label>
                </div>

                {documentsLoading ? (
                  <div className="empty-state">Caricamento documenti del dipendente...</div>
                ) : filteredDocuments.length ? (
                  <div className="print-hub-document-cards">
                    {filteredDocuments.map((document) => (
                      <article
                        key={`${document.source_kind}-${document.source_id}-${document.relative_path}`}
                        className="print-hub-document-card"
                      >
                        <div className="print-hub-document-card__head">
                          <div>
                            <span className="page-kicker">{document.document_type_label}</span>
                            <h4>{document.file_name}</h4>
                          </div>
                          {!document.exists ? (
                            <span className="soft-chip soft-chip--danger">Mancante su disco</span>
                          ) : null}
                        </div>
                        <div className="print-hub-document-card__meta">
                          <div>
                            <span>Data</span>
                            <strong>{formatDate(document.upload_date)}</strong>
                          </div>
                          <div>
                            <span>Origine</span>
                            <strong>{document.origin_label}</strong>
                          </div>
                          <div>
                            <span>Mese</span>
                            <strong>{document.month_reference ? formatMonthLabel(document.month_reference) : '-'}</strong>
                          </div>
                        </div>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => handleDocumentAction('open', document)}
                            disabled={actionLoading === `open:${document.relative_path}`}
                          >
                            Apri
                          </button>
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => handleDocumentAction('print', document)}
                            disabled={actionLoading === `print:${document.relative_path}`}
                          >
                            Stampa
                          </button>
                          <button
                            type="button"
                            className="button"
                            onClick={() => handleDocumentAction('export', document)}
                            disabled={actionLoading === `export:${document.relative_path}`}
                          >
                            Esporta
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">Nessun documento disponibile per questo dipendente con i filtri correnti.</div>
                )}
              </>
            ) : null}
          </section>
        </div>
      ) : (
        <div className="print-hub-layout">
          <section className="section-card print-hub-sidebar-card">
            <div className="section-header">
              <div>
                <h2 className="section-title">Generatore stampe</h2>
                <p className="section-subtitle">
                  Scegli la categoria, definisci il tipo stampa, applica i filtri e seleziona i dipendenti solo quando servono.
                </p>
              </div>
            </div>

            <div className="print-hub-search-help print-hub-search-help--wizard">
              Segui i passaggi da sinistra a destra: categoria, tipo stampa, filtri e, se richiesto, selezione dipendenti.
            </div>

            <section className="print-hub-wizard-card">
              <div className="section-header">
                <div>
                  <h3 className="section-title">1. Cosa vuoi stampare?</h3>
                  <p className="section-subtitle">Scegli l'area del gestionale da cui partire.</p>
                </div>
              </div>
              <label className="print-hub-field">
                <span>Categoria stampa</span>
                <select
                  value={selectedCategoryId}
                  onChange={(event) => setSelectedCategoryId(event.target.value)}
                >
                  {PRINT_CATEGORIES.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section className="print-hub-wizard-card">
              <div className="section-header">
                <div>
                  <h3 className="section-title">2. Tipo stampa</h3>
                  <p className="section-subtitle">Il sistema adatta filtri e selezione in base alla stampa scelta.</p>
                </div>
              </div>
              <label className="print-hub-field">
                <span>Tipo</span>
                <select
                  value={selectedTypeId}
                  onChange={(event) => setSelectedTypeId(event.target.value)}
                >
                  {(selectedCategory?.types || []).map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className={`print-hub-inline-hint ${selectedType?.status === 'ready' ? 'print-hub-inline-hint--success' : 'print-hub-inline-hint--warning'}`}>
                {getPrintConnectionLabel(selectedType?.status)}
              </div>
            </section>

            <section className="print-hub-wizard-card">
              <div className="section-header">
                <div>
                  <h3 className="section-title">3. Filtri</h3>
                  <p className="section-subtitle">Mostriamo solo i campi utili per questa stampa.</p>
                </div>
              </div>
              {renderPrintFilters()}
            </section>

            {renderPrintEmployeePicker()}
          </section>

          <section className="section-card print-hub-preview-card">
            <div className="section-header">
              <div>
                <h2 className="section-title">Anteprima / riepilogo</h2>
                <p className="section-subtitle">
                  Qui vedi esattamente cosa verra stampato prima di generare il PDF.
                </p>
              </div>
            </div>

            <div className="print-hub-preview-selection">
              {buildSelectionMeta().map((item) => (
                <div key={item.label} className="print-hub-preview-selection__item">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>

            {previewLoading ? (
              <div className="empty-state">Aggiornamento anteprima in corso...</div>
            ) : printPreview?.status === 'ready' ? (
              <>
                <div className="print-hub-preview-head">
                  <div>
                    <h3>{printPreview.title}</h3>
                    <p>{printPreview.subtitle}</p>
                  </div>
                  <span className="soft-chip soft-chip--success">Collegata</span>
                </div>

                {printPreview.summaryCards?.length ? (
                  <div className="print-hub-preview-summary">
                    {printPreview.summaryCards.map((card) => (
                      <div key={card.label} className="print-hub-preview-stat">
                        <span>{card.label}</span>
                        <strong>{card.value}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="print-hub-preview-table-wrap">
                  <table className="print-hub-table print-hub-table--preview">
                    <thead>
                      <tr>
                        {printPreview.columns.map((column) => (
                          <th
                            key={column.key}
                            className={
                              column.align === 'right'
                                ? 'align-right'
                                : column.align === 'center'
                                ? 'align-center'
                                : ''
                            }
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {printPreview.rows.length ? (
                        printPreview.rows.slice(0, 12).map((row, index) => (
                          <tr key={`${printPreview.title}-${index}`}>
                            {printPreview.columns.map((column) => (
                              <td
                                key={column.key}
                                className={
                                  column.align === 'right'
                                    ? 'align-right'
                                    : column.align === 'center'
                                    ? 'align-center'
                                    : ''
                                }
                              >
                                {row[column.key] ?? '-'}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={printPreview.columns.length}>Nessun dato disponibile con i filtri correnti.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {printPreview.rows.length > 12 ? (
                  <div className="print-hub-inline-hint">
                    Anteprima ridotta alle prime 12 righe. PDF, stampa ed esportazione useranno l'intero set di dati.
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-state print-hub-empty">
                <strong>{printPreview?.title || selectedType?.label || 'Anteprima non disponibile'}</strong>
                <p>{printPreview?.subtitle || 'Configura la stampa per vedere il riepilogo.'}</p>
              </div>
            )}

            <div className="toolbar">
              <div className="toolbar-group">
                <button
                  type="button"
                  className="button"
                  onClick={() => handlePrintOutput('pdf')}
                  disabled={printPreview?.status !== 'ready' || !printPreview?.rows?.length}
                >
                  Genera PDF
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => handlePrintOutput('print')}
                  disabled={printPreview?.status !== 'ready' || !printPreview?.rows?.length}
                >
                  Stampa
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => handlePrintOutput('export')}
                  disabled={printPreview?.status !== 'ready' || !printPreview?.rows?.length}
                >
                  Esporta
                </button>
              </div>
            </div>

            {printPreview?.status === 'disabled' ? (
              <div className="print-hub-disabled-hint">Stampa non ancora collegata.</div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
