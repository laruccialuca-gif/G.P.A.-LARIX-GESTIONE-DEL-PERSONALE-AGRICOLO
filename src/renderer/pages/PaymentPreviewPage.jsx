import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useYearContext } from '../context/YearContext';
import { dispatchRouteReady } from '../utils/navigationPerf';
import AttendanceEmployeeFilter from '../components/attendance/AttendanceEmployeeFilter';

const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

function formatCurrency(value) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatHours(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '0 h';
  return `${Number.isInteger(amount) ? amount : amount.toFixed(2).replace(/\.?0+$/, '')} h`;
}

function formatResidualHours(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '0 h';
  return `${amount.toFixed(2).replace(/\.?0+$/, '')} h`;
}

function formatWorkedSummary(fullDays, residualHours) {
  const days = Number(fullDays || 0);
  const residual = Number(residualHours || 0);
  if (days <= 0 && residual <= 0) return '0 gg';
  if (days > 0 && residual <= 0) return `${days} gg`;
  if (days <= 0) return formatResidualHours(residual);
  return `${days} gg + ${formatResidualHours(residual)}`;
}

function buildMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function sanitizeFileName(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

function convertHoursToSummary(totalHours, standardHours) {
  const safeStandardHours = Number(standardHours || 7) > 0 ? Number(standardHours || 7) : 7;
  const safeTotalHours = Number(totalHours || 0);
  const fullDays = Math.floor(safeTotalHours / safeStandardHours);
  const residualHours = Number((safeTotalHours % safeStandardHours).toFixed(2));
  return { fullDays, residualHours };
}

function summaryCard(title, value, detail) {
  return { title, value, detail };
}

function formatDailyRate(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '—';
  return formatCurrency(amount);
}

function splitTeamNames(value) {
  return String(value || '')
    .split(/•|â€¢|\|/)
    .flatMap((item) => String(item || '').split(/[;,]/))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

export default function PaymentPreviewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { selectedYear, setSelectedYear, yearOptions } = useYearContext();
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [previewData, setPreviewData] = useState({ rows: [], settings: { standard_day_hours: 7 } });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedEmployer, setSelectedEmployer] = useState('');
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const monthKey = useMemo(
    () => buildMonthKey(selectedYear, selectedMonth),
    [selectedMonth, selectedYear]
  );
  const requestedMonth = String(searchParams.get('month') || '').trim();
  const requestedTeam = String(searchParams.get('team') || '').trim();
  const requestedEmployer = String(searchParams.get('employer') || '').trim();
  const requestedEmployee = String(searchParams.get('employee') || '').trim();

  // Sync da URL (deep-link) verso lo stato locale.
  // BUG STORICO: questo effetto aveva `selectedTeam`/`selectedEmployer`/`selectedEmployeeIds`
  // nelle deps; quando l'utente sceglieva una squadra dal select, l'effetto si ri-eseguiva
  // e riapplicava il valore del query-param (''), azzerando la scelta.
  // Le deps ora includono SOLO i `requested*` che provengono dall'URL.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (/^\d{4}-\d{2}$/.test(requestedMonth)) {
      const nextYear = Number(requestedMonth.slice(0, 4));
      const nextMonth = Number(requestedMonth.slice(5, 7));
      if (nextYear) {
        setSelectedYear(nextYear);
      }
      if (nextMonth) {
        setSelectedMonth(nextMonth);
      }
    }

    if (requestedTeam) {
      setSelectedTeam(requestedTeam);
    }

    if (requestedEmployer) {
      setSelectedEmployer(requestedEmployer);
    }

    if (requestedEmployee) {
      const nextEmployeeIds = requestedEmployee
        .split(',')
        .map((value) => Number(value))
        .filter(Number.isFinite);
      if (nextEmployeeIds.length) {
        setSelectedEmployeeIds(nextEmployeeIds);
      }
    }
  }, [requestedEmployee, requestedEmployer, requestedMonth, requestedTeam]);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      setLoading(true);
      try {
        const result = await window.api.payroll.getPaymentPreviewByMonth({ month: monthKey });
        if (cancelled) return;
        setPreviewData(result || { rows: [], settings: { standard_day_hours: 7 } });
      } catch (error) {
        if (!cancelled) {
          setPreviewData({ rows: [], settings: { standard_day_hours: 7 } });
          window.alert(`Errore caricamento preview pagamenti: ${error?.message || error}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPreview();

    return () => {
      cancelled = true;
    };
  }, [monthKey]);

  useEffect(() => {
    if (!loading) {
      dispatchRouteReady('/preview-pagamenti');
    }
  }, [loading]);

  const rows = useMemo(
    () => Array.isArray(previewData?.rows) ? previewData.rows : [],
    [previewData?.rows]
  );

  const rowsFilteredByContext = useMemo(() => {
    return rows.filter((row) => {
      if (selectedTeam && !splitTeamNames(row.team_name).includes(selectedTeam)) {
        return false;
      }
      if (selectedEmployer && String(row.datore || '').toUpperCase() !== selectedEmployer) {
        return false;
      }
      return true;
    });
  }, [rows, selectedEmployer, selectedTeam]);

  const employeesForSelector = useMemo(() => {
    const byEmployeeId = new Map();
    rowsFilteredByContext.forEach((row) => {
      const employeeId = Number(row.employee_id ?? row.employeeId);
      if (!Number.isFinite(employeeId) || byEmployeeId.has(employeeId)) {
        return;
      }
      const teamNames = splitTeamNames(row.team_name);
      byEmployeeId.set(employeeId, {
        id: employeeId,
        first_name: row.first_name || '',
        last_name: row.last_name || '',
        label: row.employee_name || `${row.last_name || ''} ${row.first_name || ''}`.trim(),
        full_name: row.employee_name || `${row.last_name || ''} ${row.first_name || ''}`.trim(),
        employee_name: row.employee_name || `${row.last_name || ''} ${row.first_name || ''}`.trim(),
        employeeId: employeeId,
        team_id: row.team_id ?? null,
        team_name: row.team_name || '',
        team_names: teamNames,
        team_history: teamNames.map((name) => ({ name })),
      });
    });
    return [...byEmployeeId.values()];
  }, [rowsFilteredByContext]);

  const rowsFilteredByNonEmployeeFilters = useMemo(() => {
    const normalizedSearch = String(searchTerm || '').trim().toLowerCase();
    return rowsFilteredByContext.filter((row) => {
      if (normalizedSearch) {
        const haystack = `${row.employee_name || ''} ${row.team_name || ''} ${row.datore || ''}`.toLowerCase();
        if (!haystack.includes(normalizedSearch)) {
          return false;
        }
      }
      return true;
    });
  }, [rowsFilteredByContext, searchTerm]);

  const employeeOptions = employeesForSelector;

  const selectedEmployeeIdsSet = useMemo(
    () => new Set((selectedEmployeeIds || []).map((id) => Number(id))),
    [selectedEmployeeIds]
  );

  const teamOptions = useMemo(() => {
    const flattenedTeams = rows.flatMap((row) => splitTeamNames(row.team_name));
    return [...new Set(flattenedTeams)].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rowsFilteredByNonEmployeeFilters.filter((row) => {
      if (selectedEmployeeIdsSet.size > 0 && !selectedEmployeeIdsSet.has(Number(row.employee_id))) {
        return false;
      }
      return true;
    });
  }, [rowsFilteredByNonEmployeeFilters, selectedEmployeeIdsSet]);

  useEffect(() => {
    if (!selectedEmployeeIdsSet.size) {
      return;
    }
    const availableIds = new Set(employeesForSelector.map((employee) => Number(employee.id)));
    const nextIds = selectedEmployeeIds.filter((employeeId) => availableIds.has(Number(employeeId)));
    if (nextIds.length !== selectedEmployeeIds.length) {
      setSelectedEmployeeIds(nextIds);
    }
  }, [employeesForSelector, selectedEmployeeIds, selectedEmployeeIdsSet.size]);

  const filteredSummary = useMemo(() => {
    const ordinaryHours = filteredRows.reduce(
      (sum, row) => sum + (Number(row.ordinary_full_days || 0) * Number(row.standard_hours || 0)) + Number(row.ordinary_residual_hours || 0),
      0
    );
    const ordinaryWorked = convertHoursToSummary(
      ordinaryHours,
      previewData?.settings?.standard_day_hours || 7
    );
    return {
      employeesCount: filteredRows.length,
      ordinaryFullDays: ordinaryWorked.fullDays,
      ordinaryResidualHours: ordinaryWorked.residualHours,
      overtimeHours: filteredRows.reduce((sum, row) => sum + Number(row.total_overtime_hours || 0), 0),
      ordinaryCompensation: filteredRows.reduce((sum, row) => sum + Number(row.ordinary_compensation || 0), 0),
      overtimeCompensation: filteredRows.reduce((sum, row) => sum + Number(row.overtime_compensation || 0), 0),
      grossCompensation: filteredRows.reduce((sum, row) => sum + Number(row.gross_compensation || row.total_compensation || 0), 0),
      pendingAdvances: filteredRows.reduce((sum, row) => sum + Number(row.pending_advances_amount || 0), 0),
      previousCreditsTotal: filteredRows.reduce((sum, row) => sum + Number(row.previous_credit || 0), 0),
      previousDebitsTotal: filteredRows.reduce((sum, row) => sum + Number(row.previous_debit || 0), 0),
      previousBalanceNet: filteredRows.reduce((sum, row) => sum + Number(row.previous_balance || 0), 0),
      totalToPay: filteredRows.reduce((sum, row) => sum + Number((row.total_to_pay ?? row.total_compensation) || 0), 0),
      totalCompensation: filteredRows.reduce((sum, row) => sum + Number(row.gross_compensation || row.total_compensation || 0), 0),
    };
  }, [filteredRows, previewData?.settings?.standard_day_hours]);

  const summaryCards = useMemo(
    () => [
      summaryCard('Dipendenti con presenze', filteredSummary.employeesCount, monthKey),
      summaryCard(
        'Giornate ordinarie',
        formatWorkedSummary(filteredSummary.ordinaryFullDays, filteredSummary.ordinaryResidualHours),
        'ore ordinarie'
      ),
      summaryCard('Ore straordinario', formatHours(filteredSummary.overtimeHours), 'totale mese'),
      summaryCard('Retribuzione ordinaria', formatCurrency(filteredSummary.ordinaryCompensation), 'base'),
      summaryCard('Straordinari €', formatCurrency(filteredSummary.overtimeCompensation), 'extra'),
      summaryCard('Totale complessivo €', formatCurrency(filteredSummary.totalCompensation), 'ordinario + straordinari'),
    ],
    [filteredSummary, monthKey]
  );

  const paymentSummaryCards = useMemo(
    () => [
      summaryCard('Dipendenti con presenze', filteredSummary.employeesCount, monthKey),
      summaryCard(
        'Giornate ordinarie',
        formatWorkedSummary(filteredSummary.ordinaryFullDays, filteredSummary.ordinaryResidualHours),
        'ore ordinarie'
      ),
      summaryCard('Ore straordinario', formatHours(filteredSummary.overtimeHours), 'totale mese'),
      summaryCard('Retribuzione ordinaria', formatCurrency(filteredSummary.ordinaryCompensation), 'base'),
      summaryCard('Straordinari €', formatCurrency(filteredSummary.overtimeCompensation), 'extra'),
      summaryCard('Totale lordo €', formatCurrency(filteredSummary.grossCompensation), 'ordinario + straordinari'),
      summaryCard('Totale acconti €', formatCurrency(filteredSummary.pendingAdvances), 'da scalare'),
      summaryCard('Crediti precedenti €', formatCurrency(filteredSummary.previousCreditsTotal), 'riporto mese prec.'),
      summaryCard('Debiti precedenti €', formatCurrency(filteredSummary.previousDebitsTotal), 'riporto mese prec.'),
      summaryCard('Totale da pagare €', formatCurrency(filteredSummary.totalToPay), 'lordo - acconti +/- saldo prec.'),
    ],
    [filteredSummary, monthKey]
  );

  const paymentPreviewTableHeaders = useMemo(
    () => [
      'Dipendente',
      'Squadra',
      'Datore',
      'Tariffa gg',
      'Giornate + ore rimanenti',
      'Ore straordinario',
      'Retribuzione ordinaria',
      'Straordinario €',
      'Acconti',
      'Credito/Debito prec.',
      'Totale da pagare',
      'Azioni',
    ],
    []
  );

  function openEmployeeReport(row) {
    setSelectedYear(Number(String(row.month || monthKey).slice(0, 4)) || selectedYear);
    navigate(`/report?employee=${row.employee_id}&month=${row.month || monthKey}`);
  }

  function buildPaymentPreviewPdfHtml() {
    const rowsHtml = filteredRows.map((row) => `
      <tr>
        <td style="white-space:nowrap;width:220px;">${row.employee_name || '—'}</td>
        <td>${row.team_name || '—'}</td>
        <td>${row.datore || '—'}</td>
        <td>${formatDailyRate(row.daily_pay)}</td>
        <td>${formatWorkedSummary(row.ordinary_full_days, row.ordinary_residual_hours)}</td>
        <td>${row.show_overtime_in_report ? formatHours(row.total_overtime_hours) : '—'}</td>
        <td>${formatCurrency(row.ordinary_compensation)}</td>
        <td>${row.show_overtime_in_report ? formatCurrency(row.overtime_compensation) : '—'}</td>
        <td><strong>${formatCurrency(row.total_compensation)}</strong></td>
      </tr>
    `).join('');

    return `
      <div style="font-family:'Segoe UI',sans-serif;color:#0f172a;padding:16px 18px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:18px;">
          <div>
            <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">GPA 1.0.5</div>
            <h1 style="margin:8px 0 0;font-size:28px;line-height:1.1;">Preview pagamenti - ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}</h1>
          </div>
          <div style="font-size:12px;color:#475569;text-align:right;">Generato il ${new Date().toLocaleString('it-IT')}</div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:18px;">
          <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:white;">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;">Dipendenti</div>
            <div style="margin-top:6px;font-size:22px;font-weight:800;">${filteredSummary.employeesCount}</div>
          </div>
          <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:white;">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;">Giornate ordinarie</div>
            <div style="margin-top:6px;font-size:22px;font-weight:800;">${formatWorkedSummary(filteredSummary.ordinaryFullDays, filteredSummary.ordinaryResidualHours)}</div>
          </div>
          <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:white;">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;">Ore straordinario</div>
            <div style="margin-top:6px;font-size:22px;font-weight:800;">${formatHours(filteredSummary.overtimeHours)}</div>
          </div>
          <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:white;">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;">Retribuzione ordinaria</div>
            <div style="margin-top:6px;font-size:22px;font-weight:800;">${formatCurrency(filteredSummary.ordinaryCompensation)}</div>
          </div>
          <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:white;">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;">Straordinario €</div>
            <div style="margin-top:6px;font-size:22px;font-weight:800;">${formatCurrency(filteredSummary.overtimeCompensation)}</div>
          </div>
          <div style="border:1px solid #d1fae5;border-radius:12px;padding:12px 14px;background:#f0fdf4;">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#166534;">Totale complessivo €</div>
            <div style="margin-top:6px;font-size:22px;font-weight:900;color:#166534;">${formatCurrency(filteredSummary.totalCompensation)}</div>
          </div>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:auto;">
          <thead>
            <tr style="background:#eff6ff;">
              ${['Dipendente', 'Squadra', 'Datore', 'Tariffa gg', 'Giornate + ore rimanenti', 'Ore straordinario', 'Retribuzione ordinaria', 'Straordinario €', 'Totale €'].map((header) => `
                <th style="text-align:left;padding:10px 12px;border:1px solid #cbd5e1;color:#334155;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;">${header}</th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="9" style="padding:16px;border:1px solid #cbd5e1;color:#64748b;">Nessun dipendente con presenze per i filtri selezionati.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function buildPaymentPreviewPdfHtmlDocument() {
    const rowsHtml = filteredRows.map((row) => `
      <tr>
        <td class="employee-cell">${row.employee_name || '—'}</td>
        <td>${row.team_name || '—'}</td>
        <td>${row.datore || '—'}</td>
        <td>${formatDailyRate(row.daily_pay)}</td>
        <td>${formatWorkedSummary(row.ordinary_full_days, row.ordinary_residual_hours)}</td>
        <td>${row.show_overtime_in_report ? formatHours(row.total_overtime_hours) : '—'}</td>
        <td>${formatCurrency(row.ordinary_compensation)}</td>
        <td>${row.show_overtime_in_report ? formatCurrency(row.overtime_compensation) : '—'}</td>
        <td><strong>${formatCurrency(row.total_compensation)}</strong></td>
      </tr>
    `).join('');

    return `
      <style>
        @page {
          size: A4 landscape;
          margin: 10mm;
        }
        html, body {
          margin: 0;
          padding: 0;
          min-height: auto;
          height: auto;
          background: #ffffff;
        }
        body {
          font-family: 'Segoe UI', sans-serif;
          color: #0f172a;
        }
        .payment-preview-pdf {
          padding: 12px 14px;
          min-height: auto;
          height: auto;
          page-break-after: auto;
          break-after: auto;
        }
        .payment-preview-pdf__header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 14px;
        }
        .payment-preview-pdf__summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 14px;
        }
        .payment-preview-pdf__card {
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 10px 12px;
          background: #ffffff;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .payment-preview-pdf__card--total {
          border-color: #d1fae5;
          background: #f0fdf4;
        }
        .payment-preview-pdf__table {
          width: 100%;
          border-collapse: collapse;
          table-layout: auto;
          font-size: 10.5px;
          page-break-inside: auto;
          break-inside: auto;
        }
        .payment-preview-pdf__table thead tr {
          background: #eff6ff;
        }
        .payment-preview-pdf__table th {
          text-align: left;
          padding: 9px 11px;
          border: 1px solid #cbd5e1;
          color: #334155;
          font-size: 10.5px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .payment-preview-pdf__table tbody tr:nth-child(even) {
          background: #f8faf8;
        }
        .payment-preview-pdf__table tbody tr {
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .payment-preview-pdf__table td {
          padding: 7px 11px;
          border-bottom: 1px solid #e5e7eb;
          vertical-align: middle;
        }
        .payment-preview-pdf__table td.employee-cell {
          width: 220px;
          white-space: nowrap;
        }
        .payment-preview-pdf__empty {
          padding: 16px;
          border: 1px solid #cbd5e1;
          color: #64748b;
        }
      </style>
      <div class="payment-preview-pdf">
        <div class="payment-preview-pdf__header">
          <div>
            <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">GPA 1.0.5</div>
            <h1 style="margin:8px 0 0;font-size:28px;line-height:1.1;">Preview pagamenti - ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}</h1>
          </div>
          <div style="font-size:12px;color:#475569;text-align:right;">Generato il ${new Date().toLocaleString('it-IT')}</div>
        </div>

        <div class="payment-preview-pdf__summary">
          <div class="payment-preview-pdf__card">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;">Dipendenti</div>
            <div style="margin-top:6px;font-size:22px;font-weight:800;">${filteredSummary.employeesCount}</div>
          </div>
          <div class="payment-preview-pdf__card">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;">Giornate ordinarie</div>
            <div style="margin-top:6px;font-size:22px;font-weight:800;">${formatWorkedSummary(filteredSummary.ordinaryFullDays, filteredSummary.ordinaryResidualHours)}</div>
          </div>
          <div class="payment-preview-pdf__card">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;">Ore straordinario</div>
            <div style="margin-top:6px;font-size:22px;font-weight:800;">${formatHours(filteredSummary.overtimeHours)}</div>
          </div>
          <div class="payment-preview-pdf__card">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;">Retribuzione ordinaria</div>
            <div style="margin-top:6px;font-size:22px;font-weight:800;">${formatCurrency(filteredSummary.ordinaryCompensation)}</div>
          </div>
          <div class="payment-preview-pdf__card">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;">Straordinario €</div>
            <div style="margin-top:6px;font-size:22px;font-weight:800;">${formatCurrency(filteredSummary.overtimeCompensation)}</div>
          </div>
          <div class="payment-preview-pdf__card payment-preview-pdf__card--total">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#166534;">Totale complessivo €</div>
            <div style="margin-top:6px;font-size:22px;font-weight:900;color:#166534;">${formatCurrency(filteredSummary.totalCompensation)}</div>
          </div>
        </div>

        <table class="payment-preview-pdf__table">
          <thead>
            <tr>
              ${['Dipendente', 'Squadra', 'Datore', 'Tariffa gg', 'Giornate + ore rimanenti', 'Ore straordinario', 'Retribuzione ordinaria', 'Straordinario €', 'Totale €'].map((header) => `
                <th>${header}</th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="9" class="payment-preview-pdf__empty">Nessun dipendente con presenze per i filtri selezionati.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function buildPaymentPreviewPdfHtmlDocumentV2() {
    const rowsHtml = filteredRows.map((row) => {
      const prev = Number(row.previous_balance || 0);
      const prevColor = prev > 0 ? '#166534' : prev < 0 ? '#b91c1c' : '#64748b';
      const prevLabel = prev === 0 ? '—' : formatCurrency(prev);
      return `
      <tr>
        <td class="employee-cell">${row.employee_name || '—'}</td>
        <td>${row.team_name || '—'}</td>
        <td>${row.datore || '—'}</td>
        <td>${formatDailyRate(row.daily_pay)}</td>
        <td>${formatWorkedSummary(row.ordinary_full_days, row.ordinary_residual_hours)}</td>
        <td>${row.show_overtime_in_report ? formatHours(row.total_overtime_hours) : '—'}</td>
        <td>${formatCurrency(row.ordinary_compensation)}</td>
        <td>${row.show_overtime_in_report ? formatCurrency(row.overtime_compensation) : '—'}</td>
        <td>${formatCurrency(row.pending_advances_amount || 0)}</td>
        <td style="color:${prevColor};font-weight:700;">${prevLabel}</td>
        <td><strong>${formatCurrency((row.total_to_pay ?? row.total_compensation) || 0)}</strong></td>
      </tr>
    `;
    }).join('');

    return `
      <style>
        @page {
          size: A4 landscape;
          margin: 6mm;
        }
        html, body {
          margin: 0;
          padding: 0;
          min-height: auto;
          height: auto;
          background: #ffffff;
        }
        body {
          font-family: 'Segoe UI', sans-serif;
          color: #0f172a;
        }
        .payment-preview-pdf {
          padding: 0;
          min-height: auto;
          height: auto;
          page-break-after: auto;
          break-after: auto;
        }
        .payment-preview-pdf__header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          margin-bottom: 6px;
        }
        .payment-preview-pdf__header h1 {
          margin: 0;
          font-size: 15px;
          line-height: 1.1;
          font-weight: 800;
        }
        .payment-preview-pdf__header .kicker {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #64748b;
          margin-right: 8px;
        }
        .payment-preview-pdf__header .meta {
          font-size: 9px;
          color: #475569;
          white-space: nowrap;
        }
        .payment-preview-pdf__summary {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 4px;
          margin-bottom: 6px;
        }
        .payment-preview-pdf__card {
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 3px 7px;
          background: #ffffff;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .payment-preview-pdf__card .label {
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #64748b;
          line-height: 1.1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .payment-preview-pdf__card .value {
          font-size: 13px;
          font-weight: 800;
          line-height: 1.15;
          margin-top: 1px;
          white-space: nowrap;
        }
        .payment-preview-pdf__card--total {
          border-color: #d1fae5;
          background: #f0fdf4;
        }
        .payment-preview-pdf__card--total .label,
        .payment-preview-pdf__card--total .value {
          color: #166534;
        }
        .payment-preview-pdf__card--credit .label,
        .payment-preview-pdf__card--credit .value {
          color: #166534;
        }
        .payment-preview-pdf__card--debit .label,
        .payment-preview-pdf__card--debit .value {
          color: #b91c1c;
        }
        .payment-preview-pdf__table {
          width: 100%;
          border-collapse: collapse;
          table-layout: auto;
          font-size: 9.25px;
          page-break-inside: auto;
          break-inside: auto;
        }
        .payment-preview-pdf__table thead tr {
          background: #eff6ff;
        }
        .payment-preview-pdf__table th {
          text-align: left;
          padding: 4px 6px;
          border: 1px solid #cbd5e1;
          color: #334155;
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          line-height: 1.15;
        }
        .payment-preview-pdf__table tbody tr:nth-child(even) {
          background: #f8faf8;
        }
        .payment-preview-pdf__table tbody tr {
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .payment-preview-pdf__table td {
          padding: 3px 6px;
          border-bottom: 1px solid #e5e7eb;
          vertical-align: middle;
          line-height: 1.2;
        }
        .payment-preview-pdf__table td.employee-cell {
          min-width: 150px;
          white-space: nowrap;
        }
        .payment-preview-pdf__empty {
          padding: 10px;
          border: 1px solid #cbd5e1;
          color: #64748b;
        }
      </style>
      <div class="payment-preview-pdf">
        <div class="payment-preview-pdf__header">
          <div>
            <span class="kicker">GPA 1.0.5</span>
            <h1 style="display:inline-block;">Preview pagamenti · ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}</h1>
          </div>
          <div class="meta">Generato il ${new Date().toLocaleString('it-IT')}</div>
        </div>

        <div class="payment-preview-pdf__summary">
          <div class="payment-preview-pdf__card">
            <div class="label">Dipendenti</div>
            <div class="value">${filteredSummary.employeesCount}</div>
          </div>
          <div class="payment-preview-pdf__card">
            <div class="label">Giornate ordinarie</div>
            <div class="value">${formatWorkedSummary(filteredSummary.ordinaryFullDays, filteredSummary.ordinaryResidualHours)}</div>
          </div>
          <div class="payment-preview-pdf__card">
            <div class="label">Ore straordinario</div>
            <div class="value">${formatHours(filteredSummary.overtimeHours)}</div>
          </div>
          <div class="payment-preview-pdf__card">
            <div class="label">Retribuzione ord.</div>
            <div class="value">${formatCurrency(filteredSummary.ordinaryCompensation)}</div>
          </div>
          <div class="payment-preview-pdf__card">
            <div class="label">Straordinari €</div>
            <div class="value">${formatCurrency(filteredSummary.overtimeCompensation)}</div>
          </div>
          <div class="payment-preview-pdf__card">
            <div class="label">Totale lordo €</div>
            <div class="value">${formatCurrency(filteredSummary.grossCompensation)}</div>
          </div>
          <div class="payment-preview-pdf__card">
            <div class="label">Totale acconti €</div>
            <div class="value">${formatCurrency(filteredSummary.pendingAdvances)}</div>
          </div>
          <div class="payment-preview-pdf__card payment-preview-pdf__card--credit">
            <div class="label">Crediti prec. €</div>
            <div class="value">${formatCurrency(filteredSummary.previousCreditsTotal)}</div>
          </div>
          <div class="payment-preview-pdf__card payment-preview-pdf__card--debit">
            <div class="label">Debiti prec. €</div>
            <div class="value">${formatCurrency(filteredSummary.previousDebitsTotal)}</div>
          </div>
          <div class="payment-preview-pdf__card payment-preview-pdf__card--total">
            <div class="label">Totale da pagare €</div>
            <div class="value">${formatCurrency(filteredSummary.totalToPay)}</div>
          </div>
        </div>

        <table class="payment-preview-pdf__table">
          <thead>
            <tr>
              ${['Dipendente', 'Squadra', 'Datore', 'Tariffa gg', 'Giornate + ore rim.', 'Ore strd.', 'Retrib. ord.', 'Straord. €', 'Acconti', 'Credito/Debito prec.', 'Totale da pagare'].map((header) => `
                <th>${header}</th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="11" class="payment-preview-pdf__empty">Nessun dipendente con presenze per i filtri selezionati.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  async function handleGeneratePdf() {
    if (generatingPdf) return;
    setGeneratingPdf(true);
    try {
      await window.api.reports.savePdf({
        fileName: sanitizeFileName(`Preview pagamenti - ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}.pdf`),
        html: buildPaymentPreviewPdfHtmlDocumentV2(),
        landscape: true,
        debugRenderLabel: `payment-preview-${monthKey}`,
      });
    } catch (error) {
      console.error('[payment-preview] pdf failed', error);
      window.alert(`Errore generazione PDF: ${error?.message || error}`);
    } finally {
      setGeneratingPdf(false);
    }
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <h1 className="page-title" style={{ marginBottom: 6 }}>Preview pagamenti</h1>
            <div className="page-subtitle">
              Mostra per il mese selezionato solo i dipendenti con almeno una presenza registrata nel Foglio Presenze.
            </div>
          </div>
          <button type="button" className="button" onClick={handleGeneratePdf} disabled={loading || generatingPdf}>
            {generatingPdf ? 'Generazione PDF...' : 'Genera PDF'}
          </button>
        </div>

        <div className="card" style={{ padding: 18, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Mese</span>
              <select value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))}>
                {MONTH_NAMES.map((label, index) => (
                  <option key={label} value={index + 1}>{label}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Anno</span>
              <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Cerca dipendente</span>
              <input
                type="text"
                placeholder="Cerca dipendente..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>

            <div style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Dipendenti</span>
              <AttendanceEmployeeFilter
                availableEmployees={employeeOptions}
                selectedIds={selectedEmployeeIds}
                onChange={setSelectedEmployeeIds}
              />
            </div>

            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Squadra</span>
              <select value={selectedTeam} onChange={(event) => setSelectedTeam(event.target.value)}>
                <option value="">Tutte le squadre</option>
                {teamOptions.map((team) => (
                  <option key={team} value={team}>{team}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Datore</span>
              <select value={selectedEmployer} onChange={(event) => setSelectedEmployer(event.target.value)}>
                <option value="">Tutti i datori</option>
                <option value="LG">LG</option>
                <option value="LC">LC</option>
              </select>
            </label>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {paymentSummaryCards.map((card) => (
            <div key={card.title} className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
                {card.title}
              </div>
              <div style={{ marginTop: 8, fontSize: 24, fontWeight: 800, color: '#0f172a' }}>
                {card.value}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
                {card.detail}
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(148, 163, 184, 0.2)', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, color: '#0f172a' }}>
              Anteprima pagamenti {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
            </div>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              Righe visibili: {filteredRows.length}
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1360 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {paymentPreviewTableHeaders.map((header) => (
                    <th
                      key={header}
                      style={{
                        textAlign: 'left',
                        padding: '12px 14px',
                        fontSize: 12,
                        fontWeight: 800,
                        letterSpacing: '0.03em',
                        textTransform: 'uppercase',
                        color: '#475569',
                        borderBottom: '1px solid rgba(148, 163, 184, 0.24)',
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} style={{ padding: 22, color: '#64748b' }}>Caricamento preview pagamenti...</td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ padding: 22, color: '#64748b' }}>
                      Nessun dipendente con presenze per i filtri selezionati.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={`${row.employee_id}-${row.month}`} style={{ borderBottom: '1px solid rgba(226, 232, 240, 0.85)' }}>
                      <td style={{ padding: '14px', whiteSpace: 'nowrap', minWidth: 220 }}>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{row.employee_name}</div>
                        <div style={{ marginTop: 4, fontSize: 12, color: row.is_processed ? '#166534' : '#64748b' }}>
                          {row.is_processed ? 'Report già elaborato' : 'Da elaborare'}
                        </div>
                      </td>
                      <td style={{ padding: '14px', color: '#334155' }}>{row.team_name || '—'}</td>
                      <td style={{ padding: '14px', color: '#334155' }}>{row.datore || '—'}</td>
                      <td style={{ padding: '14px', color: '#334155' }}>{formatDailyRate(row.daily_pay)}</td>
                      <td style={{ padding: '14px', color: '#0f172a', fontWeight: 700 }}>
                        {formatWorkedSummary(row.ordinary_full_days, row.ordinary_residual_hours)}
                      </td>
                      <td style={{ padding: '14px', color: '#334155' }}>
                        {row.show_overtime_in_report ? formatHours(row.total_overtime_hours) : '—'}
                      </td>
                      <td style={{ padding: '14px', color: '#334155' }}>{formatCurrency(row.ordinary_compensation)}</td>
                      <td style={{ padding: '14px', color: '#334155' }}>
                        {row.show_overtime_in_report ? formatCurrency(row.overtime_compensation) : '—'}
                      </td>
                      <td style={{ padding: '14px', color: '#334155' }}>{formatCurrency(row.pending_advances_amount || 0)}</td>
                      <td style={{
                        padding: '14px',
                        fontWeight: 700,
                        color: Number(row.previous_balance || 0) > 0 ? '#166534' : Number(row.previous_balance || 0) < 0 ? '#b91c1c' : '#64748b',
                      }}>
                        {Number(row.previous_balance || 0) === 0 ? '—' : formatCurrency(row.previous_balance || 0)}
                      </td>
                      <td style={{ padding: '14px', fontWeight: 800, color: '#0f172a' }}>
                        {formatCurrency((row.total_to_pay ?? row.total_compensation) || 0)}
                      </td>
                      <td style={{ padding: '14px' }}>
                        <button type="button" className="button-secondary" onClick={() => openEmployeeReport(row)}>
                          Apri report
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
