import React, { useEffect, useMemo, useState } from 'react';
import { formatDisplayDate } from '../utils/dateFormat';

function sanitizeFileName(value) {
  return value.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getIpcRecoveryMessage(error, fallbackMessage) {
  const message = String(error?.message || '');
  if (message.includes('No handler registered')) {
    return 'Questa funzione richiede il riavvio completo di Electron per aggiornare il processo principale.';
  }
  return fallbackMessage;
}

function findFirstPeriodWithDoc(employee) {
  const periods = employee?.employment_periods || [];
  return (
    periods.find((p) => p.is_current && p.hire_document) ||
    periods.find((p) => p.hire_document) ||
    null
  );
}

function hasAnyHireDocument(employee) {
  if (!employee) return false;
  if (employee.has_hire_document) return true;
  if (employee.legacy_hire_document) return true;
  if (employee.hire_document) return true;
  return !!findFirstPeriodWithDoc(employee);
}

const NO_DOC_MESSAGE =
  'Nessun documento assunzione trovato né nel record assunto né nella scheda dipendente collegata.';

const INITIAL_FILTERS = {
  datore: 'TUTTI',
  team: 'TUTTI',
  status: 'TUTTI',
  training: 'TUTTI',
  medical: 'TUTTI',
  search: '',
  // bonus: extension points for future filters (period, status, ...)
};

function isPastDate(value) {
  if (!value) return false;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed < today;
}

function getComplianceInfo(employee, type) {
  const prefix = type === 'medical' ? 'medical_visit' : 'art37';
  const done = !!employee?.[`${prefix}_done`];
  const required = !!employee?.[`${prefix}_required`];
  const expiry = employee?.[`${prefix}_expiry`] || null;
  const expired = done && isPastDate(expiry);

  if (expired) {
    return {
      state: 'SCADUTO',
      label: 'Scaduta',
      detail: expiry ? `Scad. ${formatDisplayDate(expiry)}` : '',
      tone: 'expired',
    };
  }
  if (done) {
    return {
      state: 'VALIDO',
      label: expiry ? 'Valida' : 'Presente',
      detail: expiry ? `Scad. ${formatDisplayDate(expiry)}` : '',
      tone: 'valid',
    };
  }
  return {
    state: 'MANCANTE',
    label: required ? 'Mancante' : 'Assente',
    detail: required ? 'Richiesta' : 'Non presente',
    tone: required ? 'missing' : 'neutral',
  };
}

function matchesComplianceFilter(employee, type, filterValue) {
  if (!filterValue || filterValue === 'TUTTI') return true;
  return getComplianceInfo(employee, type).state === filterValue;
}

function getComplianceFilterLabel(value) {
  if (value === 'VALIDO') return 'presenti / validi';
  if (value === 'MANCANTE') return 'mancanti';
  if (value === 'SCADUTO') return 'scaduti';
  return 'tutti';
}

function matchEmployeeFilter(employee, filters) {
  if (filters.datore !== 'TUTTI' && (employee.hired_by || '') !== filters.datore) {
    return false;
  }
  if (filters.team !== 'TUTTI') {
    const wanted = String(filters.team);
    const list = employee.team_history || [];
    if (!list.some((t) => String(t.team_id) === wanted)) return false;
  }
  if (filters.status !== 'TUTTI' && (employee.status || '') !== filters.status) {
    return false;
  }
  if (!matchesComplianceFilter(employee, 'training', filters.training)) {
    return false;
  }
  if (!matchesComplianceFilter(employee, 'medical', filters.medical)) {
    return false;
  }
  if (filters.search) {
    const q = filters.search.trim().toLowerCase();
    if (q) {
      const haystack = `${employee.last_name || ''} ${employee.first_name || ''} ${employee.role || ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
  }
  return true;
}

const nameButtonStyle = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: 0,
  display: 'block',
  width: '100%',
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  font: 'inherit',
  color: '#0f172a',
  fontWeight: 700,
  cursor: 'pointer',
  textAlign: 'left',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  textDecorationColor: 'rgba(15, 23, 42, 0.25)',
};

export default function OperaiAssuntiPage() {
  const [employees, setEmployees] = useState([]);
  const [settings, setSettings] = useState(null);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [busyId, setBusyId] = useState(null);
  const [detailEmployeeId, setDetailEmployeeId] = useState(null);
  const [earlyClosureOpen, setEarlyClosureOpen] = useState(false);
  const [earlyClosureDate, setEarlyClosureDate] = useState('');
  const [earlyClosureNotes, setEarlyClosureNotes] = useState('');
  const [earlyClosureGenerating, setEarlyClosureGenerating] = useState(false);

  const [detailEmployee, setDetailEmployee] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (detailEmployeeId == null) {
      setDetailEmployee(null);
      setDetailLoading(false);
      return undefined;
    }
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      try {
        const full = await window.api.employees.getById(detailEmployeeId, { includeDeleted: true });
        if (!cancelled) {
          setDetailEmployee(full || null);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setDetailEmployee(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [detailEmployeeId]);

  useEffect(() => {
    if (detailEmployeeId == null) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape') setDetailEmployeeId(null);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [detailEmployeeId]);

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function loadAll() {
    setLoading(true);
    const __nowMs = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const __t0 = __nowMs();
    try {
      const __empT0 = __nowMs();
      const employeesPromise = window.api.employees.listBasic({
        includePeriods: true,
        includeTeamHistory: true,
        includeHireDocFlag: true,
      });
      const settingsPromise = window.api.settings.get();
      const teamsPromise = window.api.teams.list({ includeArchived: true }).catch(() => []);
      const data = await employeesPromise;
      console.info('[page-perf] hired-workers:employees-load:end', {
        count: Array.isArray(data) ? data.length : 0,
        duration_ms: Math.round(__nowMs() - __empT0),
      });
      const [settingsData, teamsData] = await Promise.all([settingsPromise, teamsPromise]);
      setEmployees(data || []);
      setSettings(settingsData || null);
      setTeams(Array.isArray(teamsData) ? teamsData : []);
    } catch (err) {
      console.error(err);
      alert('Errore caricamento operai assunti');
    } finally {
      setLoading(false);
      console.info('[page-perf] hired-workers:loadBaseData:end', { duration_ms: Math.round(__nowMs() - __t0) });
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const filtered = useMemo(() => {
    return employees
      .filter((employee) => matchEmployeeFilter(employee, filters))
      .sort((a, b) => {
        const last = String(a.last_name || '').localeCompare(String(b.last_name || ''));
        if (last !== 0) return last;
        return String(a.first_name || '').localeCompare(String(b.first_name || ''));
      });
  }, [employees, filters]);

  const employerOptions = settings?.employer_options || [
    { short_name: 'LC', name: 'Laruccia Cosimo' },
    { short_name: 'LG', name: 'Laruccia Giuseppe' },
  ];

  const teamOptions = useMemo(() => {
    return [...teams].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'it', { sensitivity: 'base' }),
    );
  }, [teams]);
  const statusOptions = useMemo(() => {
    return [...new Set(
      employees
        .map((employee) => String(employee.status || '').trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
  }, [employees]);

  const filteredIds = useMemo(() => filtered.map((e) => e.id), [filtered]);
  const selectedFilteredCount = useMemo(
    () => filteredIds.reduce((acc, id) => (selectedIds.has(id) ? acc + 1 : acc), 0),
    [filteredIds, selectedIds],
  );
  const allFilteredSelected = filteredIds.length > 0 && selectedFilteredCount === filteredIds.length;
  const someFilteredSelected = selectedFilteredCount > 0 && !allFilteredSelected;

  function toggleSelectOne(id, checked) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const id of filteredIds) next.delete(id);
      } else {
        for (const id of filteredIds) next.add(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function resetFilters() {
    setFilters(INITIAL_FILTERS);
  }

  function getSelectedEmployees() {
    if (selectedIds.size === 0) return [];
    return employees.filter((e) => selectedIds.has(e.id));
  }

  function describeFilters() {
    const parts = [];
    parts.push(`Datore: ${filters.datore}`);
    if (filters.team && filters.team !== 'TUTTI') {
      const t = teams.find((tt) => String(tt.id) === String(filters.team));
      parts.push(`Squadra: ${t ? t.name : filters.team}`);
    } else {
      parts.push('Squadra: TUTTE');
    }
    if (filters.status && filters.status !== 'TUTTI') {
      parts.push(`Stato: ${filters.status}`);
    }
    if (filters.training && filters.training !== 'TUTTI') {
      parts.push(`Formazione: ${getComplianceFilterLabel(filters.training)}`);
    }
    if (filters.medical && filters.medical !== 'TUTTI') {
      parts.push(`Visita medica: ${getComplianceFilterLabel(filters.medical)}`);
    }
    if (filters.search) parts.push(`Ricerca: "${filters.search}"`);
    return parts.join(' • ');
  }

  function buildPrintHtml(list, modeLabel) {
    const printDate = new Date().toLocaleDateString('it-IT');
    const sortedList = [...list].sort((a, b) => {
      const last = String(a.last_name || '').localeCompare(String(b.last_name || ''));
      if (last !== 0) return last;
      return String(a.first_name || '').localeCompare(String(b.first_name || ''));
    });

    const renderCompliancePrintCell = (info) => `
      <td style="padding:8px 9px; color:#334155;">
        <strong style="display:block; color:${info.tone === 'expired' ? '#991b1b' : info.tone === 'valid' ? '#14532d' : '#92400e'};">
          ${info.label}
        </strong>
        ${info.detail ? `<span style="font-size:10px; color:#64748b;">${info.detail}</span>` : ''}
      </td>
    `;

    const rows = sortedList.map((employee) => {
      const trainingInfo = getComplianceInfo(employee, 'training');
      const medicalInfo = getComplianceInfo(employee, 'medical');
      return `
      <tr>
        <td style="padding:10px 12px; font-weight:700; color:#1F2937;">${employee.last_name || ''} ${employee.first_name || ''}</td>
        <td style="padding:10px 12px; color:#334155;">${employee.role || '—'}</td>
        <td style="padding:10px 12px; color:#334155; white-space:nowrap;">${formatDisplayDate(employee.hire_date_from)}</td>
        <td style="padding:10px 12px; color:#334155; white-space:nowrap;">${formatDisplayDate(employee.hire_date_to)}</td>
        <td style="padding:10px 12px; color:#334155; white-space:nowrap;">${employee.hired_by || '—'}</td>
        ${renderCompliancePrintCell(trainingInfo)}
        ${renderCompliancePrintCell(medicalInfo)}
        <td style="padding:8px 9px;">
          <span style="
            display:inline-flex;
            align-items:center;
            min-height:24px;
            padding:0 10px;
            border-radius:999px;
            font-size:11px;
            font-weight:800;
            background:${employee.status === 'attivo' ? 'rgba(22, 163, 74, 0.12)' : 'rgba(212, 160, 23, 0.16)'};
            color:${employee.status === 'attivo' ? '#14532d' : '#a16207'};
          ">
            ${employee.status || '—'}
          </span>
        </td>
      </tr>
    `;
    }).join('');

    return `
      <div style="
        font-family: 'Avenir Next', 'Segoe UI', sans-serif;
        color:#1F2937;
        padding:12px 14px;
      ">
        <div style="
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
          gap:18px;
          margin-bottom:18px;
        ">
          <div style="flex:1; min-width:0;">
            <div style="
              display:inline-flex;
              align-items:center;
              min-height:26px;
              padding:0 12px;
              border-radius:999px;
              background:rgba(22, 163, 74, 0.12);
              color:#14532d;
              font-size:11px;
              font-weight:800;
              letter-spacing:0.06em;
              text-transform:uppercase;
            ">
              Vista stampabile
            </div>
            <div style="margin-top:12px; font-size:24px; font-weight:800; line-height:1.1;">
              Elenco Operai Assunti
            </div>
            <div style="margin-top:6px; font-size:13px; color:#475569;">
              ${settings?.company?.document_header || settings?.company?.name || 'GPA 1.0.4'}
            </div>
          </div>

          <div style="
            min-width:240px;
            border:1px solid rgba(31, 41, 55, 0.10);
            border-radius:18px;
            padding:12px 14px;
            background:linear-gradient(180deg, rgba(255,255,255,0.96), rgba(244,248,243,0.96));
          ">
            <div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#64748b;">
              Riepilogo stampa
            </div>
            <div style="margin-top:8px; font-size:12px; color:#334155;">
              Modalità: <strong>${modeLabel}</strong>
            </div>
            <div style="margin-top:4px; font-size:12px; color:#334155;">
              ${describeFilters()}
            </div>
            <div style="margin-top:4px; font-size:13px; color:#334155;">
              Stampato il: <strong>${printDate}</strong>
            </div>
            <div style="margin-top:4px; font-size:13px; color:#334155;">
              Operai inclusi: <strong>${sortedList.length}</strong>
            </div>
          </div>
        </div>

        <div style="
          border:1px solid rgba(31, 41, 55, 0.08);
          border-radius:22px;
          overflow:hidden;
          background:rgba(255,255,255,0.96);
          box-shadow:0 18px 40px rgba(31, 41, 55, 0.08);
        ">
          <table style="width:100%; border-collapse:separate; border-spacing:0; font-size:11px;">
            <thead>
              <tr>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Operaio</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Mansione</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Data da</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Data a</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Assunto da</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Formazione</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Visita medica</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Stato</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `
                <tr>
                  <td colspan="8" style="padding:22px 14px; text-align:center; color:#64748b;">
                    Nessun operaio disponibile per il filtro selezionato.
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function buildPdfFileName(modeLabel) {
    const parts = ['Operai assunti', filters.datore];
    if (filters.team && filters.team !== 'TUTTI') {
      const t = teams.find((tt) => String(tt.id) === String(filters.team));
      if (t?.name) parts.push(t.name);
    }
    if (modeLabel === 'Selezionati') parts.push('selezione');
    return sanitizeFileName(`${parts.join(' - ')}.pdf`);
  }

  function getTeamNames(employee) {
    return (employee?.team_history || [])
      .map((team) => team.name)
      .filter(Boolean)
      .join(', ');
  }

  function buildEarlyClosurePdfHtml(list, closureDate, notes) {
    const printDate = new Date().toLocaleDateString('it-IT');
    const closureDateLabel = formatDisplayDate(closureDate);
    const sortedList = [...list].sort((a, b) => {
      const last = String(a.last_name || '').localeCompare(String(b.last_name || ''), 'it', { sensitivity: 'base' });
      if (last !== 0) return last;
      return String(a.first_name || '').localeCompare(String(b.first_name || ''), 'it', { sensitivity: 'base' });
    });

    const rows = sortedList.map((employee) => `
      <tr>
        <td style="padding:9px 10px; font-weight:800; color:#111827;">${escapeHtml(`${employee.last_name || ''} ${employee.first_name || ''}`.trim() || '—')}</td>
        <td style="padding:9px 10px; color:#334155; font-family:ui-monospace, SFMono-Regular, monospace;">${escapeHtml(employee.fiscal_code || '—')}</td>
        <td style="padding:9px 10px; color:#334155;">${escapeHtml(employee.role || '—')}</td>
        <td style="padding:9px 10px; color:#334155;">${escapeHtml(getTeamNames(employee) || '—')}</td>
        <td style="padding:9px 10px; color:#334155; white-space:nowrap;">${escapeHtml(formatDisplayDate(employee.hire_date_from))}</td>
        <td style="padding:9px 10px; color:#334155; white-space:nowrap;">${escapeHtml(formatDisplayDate(employee.hire_date_to))}</td>
        <td style="padding:9px 10px; color:#334155; white-space:nowrap;">${escapeHtml(employee.hired_by || '—')}</td>
        <td style="padding:9px 10px; color:#111827; font-weight:800; white-space:nowrap;">${escapeHtml(closureDateLabel)}</td>
      </tr>
    `).join('');

    return `
      <div style="font-family:'Avenir Next','Segoe UI',sans-serif; color:#1f2937; padding:14px 16px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:18px; margin-bottom:18px;">
          <div>
            <div style="font-size:11px; font-weight:900; letter-spacing:0.08em; text-transform:uppercase; color:#14532d;">Richiesta consulente</div>
            <div style="margin-top:8px; font-size:25px; line-height:1.12; font-weight:900;">Richiesta chiusura anticipata operai</div>
            <div style="margin-top:6px; font-size:13px; color:#475569;">${escapeHtml(settings?.company?.document_header || settings?.company?.name || 'GPA 1.0.4')}</div>
          </div>
          <div style="min-width:250px; border:1px solid #dbe4dd; border-radius:16px; padding:12px 14px; background:#f8fbf7;">
            <div style="font-size:12px; color:#334155;">Data documento: <strong>${escapeHtml(printDate)}</strong></div>
            <div style="margin-top:6px; font-size:12px; color:#334155;">Chiusura richiesta: <strong>${escapeHtml(closureDateLabel)}</strong></div>
            <div style="margin-top:6px; font-size:12px; color:#334155;">Operai inclusi: <strong>${sortedList.length}</strong></div>
          </div>
        </div>

        <div style="border:1px solid #dbe4dd; border-radius:18px; padding:14px 16px; background:#ffffff; margin-bottom:16px;">
          <p style="margin:0; font-size:13px; line-height:1.55; color:#334155;">
            Con la presente si richiede la chiusura anticipata dei rapporti di lavoro dei seguenti operai agricoli a decorrere dalla data indicata.
          </p>
        </div>

        <div style="border:1px solid rgba(31,41,55,0.10); border-radius:18px; overflow:hidden; background:#fff;">
          <table style="width:100%; border-collapse:collapse; font-size:10.5px;">
            <thead>
              <tr>
                <th style="padding:10px; text-align:left; background:#edf4ee; color:#475569; text-transform:uppercase; letter-spacing:0.04em;">Cognome e nome</th>
                <th style="padding:10px; text-align:left; background:#edf4ee; color:#475569; text-transform:uppercase; letter-spacing:0.04em;">Codice fiscale</th>
                <th style="padding:10px; text-align:left; background:#edf4ee; color:#475569; text-transform:uppercase; letter-spacing:0.04em;">Mansione</th>
                <th style="padding:10px; text-align:left; background:#edf4ee; color:#475569; text-transform:uppercase; letter-spacing:0.04em;">Squadra</th>
                <th style="padding:10px; text-align:left; background:#edf4ee; color:#475569; text-transform:uppercase; letter-spacing:0.04em;">Data da</th>
                <th style="padding:10px; text-align:left; background:#edf4ee; color:#475569; text-transform:uppercase; letter-spacing:0.04em;">Data a</th>
                <th style="padding:10px; text-align:left; background:#edf4ee; color:#475569; text-transform:uppercase; letter-spacing:0.04em;">Assunto da</th>
                <th style="padding:10px; text-align:left; background:#edf4ee; color:#475569; text-transform:uppercase; letter-spacing:0.04em;">Chiusura richiesta</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>

        ${notes ? `
          <div style="margin-top:14px; border:1px solid #e5e7eb; border-radius:14px; padding:12px 14px; background:#fff;">
            <div style="font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:0.05em; color:#64748b;">Note</div>
            <div style="margin-top:6px; font-size:12px; line-height:1.5; color:#334155;">${escapeHtml(notes)}</div>
          </div>
        ` : ''}

        <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:24px; margin-top:32px;">
          <div style="font-size:12px; color:#334155;">
            <strong>${escapeHtml(settings?.company?.name || settings?.company?.document_header || '')}</strong>
          </div>
          <div style="width:240px; border-top:1px solid #111827; padding-top:8px; text-align:center; font-size:12px; color:#334155;">
            Firma
          </div>
        </div>
      </div>
    `;
  }

  function openEarlyClosureModal() {
    if (!selectedIds.size) {
      alert('Seleziona almeno un operaio.');
      return;
    }
    setEarlyClosureDate('');
    setEarlyClosureNotes('');
    setEarlyClosureOpen(true);
  }

  async function handleGenerateEarlyClosurePdf(event) {
    event.preventDefault();
    const list = getSelectedEmployees();
    if (!list.length) {
      alert('Nessun operaio selezionato.');
      return;
    }
    if (!earlyClosureDate) {
      alert('Inserisci la data di chiusura anticipata.');
      return;
    }

    const invalidEmployees = list.filter((employee) => {
      if (!employee.hire_date_from) return false;
      return String(earlyClosureDate) < String(employee.hire_date_from).slice(0, 10);
    });
    if (invalidEmployees.length) {
      const names = invalidEmployees
        .map((employee) => `${employee.last_name || ''} ${employee.first_name || ''}`.trim())
        .join(', ');
      alert(`La data di chiusura è precedente alla data di assunzione per: ${names}`);
      return;
    }

    setEarlyClosureGenerating(true);
    try {
      await window.api.reports.savePdf({
        fileName: `richiesta-chiusura-anticipata-operai-${earlyClosureDate}.pdf`,
        html: buildEarlyClosurePdfHtml(list, earlyClosureDate, earlyClosureNotes),
        landscape: true,
      });
      setEarlyClosureOpen(false);
    } catch (err) {
      console.error(err);
      alert('Errore generazione PDF operai da chiudere');
    } finally {
      setEarlyClosureGenerating(false);
    }
  }

  async function handleSavePdf(mode) {
    const list = mode === 'selected' ? getSelectedEmployees() : filtered;
    if (!list.length) {
      alert(mode === 'selected' ? 'Nessun operaio selezionato.' : 'Nessun operaio nel filtro corrente.');
      return;
    }
    const modeLabel = mode === 'selected' ? 'Selezionati' : 'Filtrati';
    try {
      await window.api.reports.savePdf({
        fileName: buildPdfFileName(modeLabel),
        html: buildPrintHtml(list, modeLabel),
        landscape: true,
      });
    } catch (err) {
      console.error(err);
      alert('Errore apertura PDF');
    }
  }

  async function handlePrint(mode) {
    const list = mode === 'selected' ? getSelectedEmployees() : filtered;
    if (!list.length) {
      alert(mode === 'selected' ? 'Nessun operaio selezionato.' : 'Nessun operaio nel filtro corrente.');
      return;
    }
    const modeLabel = mode === 'selected' ? 'Selezionati' : 'Filtrati';
    try {
      await window.api.reports.printHtml({
        fileName: buildPdfFileName(modeLabel),
        html: buildPrintHtml(list, modeLabel),
        landscape: true,
      });
    } catch (err) {
      console.error(err);
      alert('Errore stampa');
    }
  }

  async function handleUpload(employeeId) {
    setBusyId(employeeId);
    try {
      const result = await window.api.employees.uploadHireDocument(employeeId);
      if (!result?.canceled) {
        await loadAll();
      }
    } catch (err) {
      console.error(err);
      alert('Errore caricamento allegato assunzione');
    } finally {
      setBusyId(null);
    }
  }

  async function tryOpenLegacy(employeeId) {
    try {
      const result = await window.api.employees.openHireDocument(employeeId);
      if (result && result.success === false) return false;
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  async function tryOpenPeriod(employeeId, periodId) {
    try {
      const result = await window.api.employees.openHireDocumentForPeriod(employeeId, periodId);
      if (result && result.success === false) return false;
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  async function handleOpen(employee) {
    if (!employee) return;
    // Lista light: i flag dei singoli documenti non ci sono. Recuperiamo
    // il dettaglio completo on-demand solo per decidere quale aprire.
    let resolved = employee;
    if (!('legacy_hire_document' in employee) && !('hire_document' in employee)) {
      try {
        const full = await window.api.employees.getById(employee.id, { includeDeleted: true });
        if (full) resolved = full;
      } catch (err) {
        console.error(err);
      }
    }
    if (resolved.legacy_hire_document) {
      if (await tryOpenLegacy(resolved.id)) return;
    }
    const period = findFirstPeriodWithDoc(resolved);
    if (period) {
      if (await tryOpenPeriod(resolved.id, period.id)) return;
    }
    if (!resolved.legacy_hire_document && !period) {
      if (await tryOpenLegacy(resolved.id)) return;
    }
    alert(NO_DOC_MESSAGE);
  }

  async function handleOpenArt37(employeeId) {
    try {
      const result = await window.api.employees.openArt37Document(employeeId);
      if (result && result.success === false && result.message) alert(result.message);
    } catch (err) {
      console.error(err);
      alert('Errore apertura documento art. 37');
    }
  }

  async function handleOpenMedicalVisit(employeeId) {
    try {
      const result = await window.api.employees.openMedicalVisitDocument(employeeId);
      if (result && result.success === false && result.message) alert(result.message);
    } catch (err) {
      console.error(err);
      alert('Errore apertura documento visita medica');
    }
  }

  async function handleDelete(employeeId) {
    const confirmed = window.confirm("Confermi l'eliminazione dell'allegato di assunzione?");
    if (!confirmed) return;

    try {
      const result = await window.api.employees.deleteHireDocument(employeeId);
      if (result && result.success === false && result.message) {
        alert(result.message);
      }
      await loadAll();
    } catch (err) {
      console.error(err);
      alert(getIpcRecoveryMessage(err, 'Errore eliminazione allegato'));
    }
  }

  const totalCount = employees.length;
  const filteredCount = filtered.length;
  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;

  return (
    <div className="page">
      <div className="page-sticky-stack">
        <section className="page-hero">
          <div>
            <span className="page-kicker">Vista stampabile</span>
            <h1 className="page-title">Operai Assunti</h1>
            <p className="page-subtitle">
              Elenco pronto per l'esportazione con periodo di assunzione, datore e allegato locale.
            </p>
          </div>

          <div className="page-actions hired-workers-page-actions">
            <button className="button-secondary" onClick={() => handlePrint('filtered')}>Stampa</button>
            <button className="button" onClick={() => handleSavePdf('filtered')}>Genera PDF</button>
            <button
              className="button"
              onClick={() => handleSavePdf('selected')}
              disabled={!hasSelection}
              title={hasSelection ? `Genera PDF dei ${selectedCount} selezionati` : 'Seleziona almeno un operaio'}
            >
              Genera PDF selezionati ({selectedCount})
            </button>
            <button
              className="button-warning"
              onClick={openEarlyClosureModal}
              disabled={!hasSelection || earlyClosureGenerating}
              title={hasSelection ? `Richiedi chiusura per ${selectedCount} operai` : 'Seleziona almeno un operaio'}
            >
              {earlyClosureGenerating ? 'Generazione...' : `Operai da chiudere (${selectedCount})`}
            </button>
          </div>
        </section>

        <div
          className="toolbar hired-workers-toolbar"
          style={{
            padding: '12px 14px',
            borderRadius: 20,
            border: '1px solid rgba(15, 23, 42, 0.08)',
            background: 'rgba(255,255,255,0.96)',
            boxShadow: '0 14px 34px rgba(15, 23, 42, 0.06)',
            gap: 14,
          }}
        >
          <div className="toolbar-group hired-workers-toolbar__filters" style={{ gap: 12, flex: '1 1 auto', minWidth: 0 }}>
            <input
              type="search"
              className="hired-workers-toolbar__search"
              placeholder="Cerca nominativo o mansione..."
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
              style={{ minHeight: 42 }}
            />
            <select
              className="hired-workers-toolbar__select"
              value={filters.datore}
              onChange={(e) => updateFilter('datore', e.target.value)}
              style={{ minHeight: 42 }}
            >
              <option value="TUTTI">Tutti i datori</option>
              {employerOptions.map((option) => (
                <option key={option.short_name} value={option.short_name}>
                  {option.short_name} - {option.name}
                </option>
              ))}
              <option value="ENTRAMBE">ENTRAMBE</option>
            </select>
            <select
              className="hired-workers-toolbar__select"
              value={filters.team}
              onChange={(e) => updateFilter('team', e.target.value)}
              style={{ minHeight: 42 }}
            >
              <option value="TUTTI">Tutte le squadre</option>
              {teamOptions.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}{team.is_archived ? ' (archiviata)' : ''}
                </option>
              ))}
            </select>
            <select
              className="hired-workers-toolbar__select"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
              style={{ minHeight: 42 }}
            >
              <option value="TUTTI">Tutti gli stati</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              className="hired-workers-toolbar__select"
              value={filters.training}
              onChange={(e) => updateFilter('training', e.target.value)}
              style={{ minHeight: 42 }}
            >
              <option value="TUTTI">Formazione: tutti</option>
              <option value="VALIDO">Formazione: presenti/validi</option>
              <option value="MANCANTE">Formazione: mancanti</option>
              <option value="SCADUTO">Formazione: scaduti</option>
            </select>
            <select
              className="hired-workers-toolbar__select"
              value={filters.medical}
              onChange={(e) => updateFilter('medical', e.target.value)}
              style={{ minHeight: 42 }}
            >
              <option value="TUTTI">Visita: tutti</option>
              <option value="VALIDO">Visita: presenti/validi</option>
              <option value="MANCANTE">Visita: mancanti</option>
              <option value="SCADUTO">Visita: scaduti</option>
            </select>
            <button
              type="button"
              className="button-secondary hired-workers-toolbar__reset"
              onClick={resetFilters}
              style={{ minHeight: 42, padding: '0 14px', fontSize: 13 }}
              disabled={
                filters.datore === INITIAL_FILTERS.datore &&
                filters.team === INITIAL_FILTERS.team &&
                filters.status === INITIAL_FILTERS.status &&
                filters.training === INITIAL_FILTERS.training &&
                filters.medical === INITIAL_FILTERS.medical &&
                !filters.search
              }
            >
              Reset
            </button>
          </div>

          <div className="toolbar-group hired-workers-toolbar__meta" style={{ gap: 8, flexWrap: 'wrap', marginLeft: 0 }}>
            <span
              className="soft-chip hired-workers-toolbar__badge"
              style={{
                background: 'rgba(22, 163, 74, 0.12)',
                color: '#14532d',
                borderColor: 'rgba(22, 101, 52, 0.14)',
                minHeight: 34,
                padding: '0 12px',
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {selectedCount} selezionati su {filteredCount}
              {filteredCount !== totalCount ? ` (totale ${totalCount})` : ''}
            </span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="panel empty-state">Caricamento...</div>
      ) : (
        <div className="panel table-shell hired-workers-table-shell">
          <div className="table-scroll hired-workers-table-scroll">
            <table className="table hired-workers-table">
              <thead>
                <tr>
                  <th style={{ ...th, width: 44 }}>
                    <input
                      type="checkbox"
                      aria-label="Seleziona tutti i filtrati"
                      checked={allFilteredSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someFilteredSelected;
                      }}
                      onChange={toggleSelectAllFiltered}
                      disabled={filteredCount === 0}
                    />
                  </th>
                  <th style={th}>Operaio</th>
                  <th style={th}>Mansione</th>
                  <th style={th}>Squadre</th>
                  <th style={th}>Data da</th>
                  <th style={th}>Data a</th>
                  <th style={th}>Assunto da</th>
                  <th style={th}>Stato</th>
                  <th style={th}>Formazione</th>
                  <th style={th}>Visita medica</th>
                  <th style={{ ...th, width: 180 }}>Documento assunzione</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ ...td, textAlign: 'center', color: '#64748b' }}>
                      Nessun operaio corrisponde ai filtri correnti.
                    </td>
                  </tr>
                ) : (
                  filtered.map((employee) => {
                    const isSelected = selectedIds.has(employee.id);
                    const teamNames = (employee.team_history || [])
                      .map((t) => t.name)
                      .filter(Boolean);
                    const docAvailable = hasAnyHireDocument(employee);
                    const trainingInfo = getComplianceInfo(employee, 'training');
                    const medicalInfo = getComplianceInfo(employee, 'medical');
                    return (
                      <tr key={employee.id} style={isSelected ? selectedRowStyle : undefined}>
                        <td style={{ ...td, width: 44 }}>
                          <input
                            type="checkbox"
                            aria-label={`Seleziona ${employee.last_name || ''} ${employee.first_name || ''}`}
                            checked={isSelected}
                            onChange={(e) => toggleSelectOne(employee.id, e.target.checked)}
                          />
                        </td>
                        <td style={td} className="hired-workers-name-cell">
                          <button
                            type="button"
                            onClick={() => setDetailEmployeeId(employee.id)}
                            style={nameButtonStyle}
                            title="Apri scheda dipendente"
                          >
                            {employee.last_name} {employee.first_name}
                          </button>
                        </td>
                        <td style={td}>{employee.role || '—'}</td>
                        <td style={td} className="hired-workers-team-cell" title={teamNames.join(', ')}>
                          {teamNames.length ? teamNames.join(', ') : <span style={{ color: '#94a3b8' }}>—</span>}
                        </td>
                        <td style={td}>{formatDisplayDate(employee.hire_date_from)}</td>
                        <td style={td}>{formatDisplayDate(employee.hire_date_to)}</td>
                        <td style={td}>{employee.hired_by || '—'}</td>
                        <td style={td}>{employee.status || '—'}</td>
                        <td style={td}>
                          <ComplianceStatusBadge info={trainingInfo} />
                        </td>
                        <td style={td}>
                          <ComplianceStatusBadge info={medicalInfo} />
                        </td>
                        <td style={{ ...td, width: 180 }}>
                          <div className="hired-workers-doc-actions">
                            <button
                              type="button"
                              className={docAvailable ? 'button-secondary' : 'button'}
                              style={{ minHeight: 30, padding: '0 8px', fontSize: 11 }}
                              onClick={() => handleUpload(employee.id)}
                              disabled={busyId === employee.id}
                            >
                              {busyId === employee.id
                                ? '...'
                                : docAvailable
                                ? 'Sostituisci'
                                : 'PDF'}
                            </button>

                            {docAvailable ? (
                              <>
                                <button
                                  type="button"
                                  className="button-secondary"
                                  style={{ minHeight: 30, padding: '0 8px', fontSize: 11 }}
                                  onClick={() => handleOpen(employee)}
                                >
                                  Apri
                                </button>
                                <button
                                  type="button"
                                  className="button-danger"
                                  style={{ minHeight: 30, padding: '0 8px', fontSize: 11 }}
                                  onClick={() => handleDelete(employee.id)}
                                >
                                  Elimina
                                </button>
                              </>
                            ) : (
                              <span style={{ fontSize: 12, color: '#667085' }}>
                                Nessun PDF
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailEmployee ? (
        <EmployeeDetailDrawer
          employee={detailEmployee}
          onClose={() => setDetailEmployeeId(null)}
          onOpenHire={() => handleOpen(detailEmployee)}
          onOpenHirePeriod={(periodId) => tryOpenPeriod(detailEmployee.id, periodId).then((ok) => {
            if (!ok) alert('Allegato del rapporto non trovato.');
          })}
          onOpenArt37={() => handleOpenArt37(detailEmployee.id)}
          onOpenMedical={() => handleOpenMedicalVisit(detailEmployee.id)}
        />
      ) : null}

      {earlyClosureOpen ? (
        <div className="modal-overlay" onClick={() => !earlyClosureGenerating && setEarlyClosureOpen(false)}>
          <form
            className="modal-dialog early-closure-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleGenerateEarlyClosurePdf}
          >
            <div className="modal-header">
              <div>
                <h2>Operai da chiudere</h2>
                <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
                  Genera una richiesta PDF per {selectedCount} operai selezionati.
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setEarlyClosureOpen(false)}
                disabled={earlyClosureGenerating}
              >
                x
              </button>
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 800 }}>Data chiusura anticipata *</span>
                <input
                  type="date"
                  value={earlyClosureDate}
                  onChange={(event) => setEarlyClosureDate(event.target.value)}
                  required
                  disabled={earlyClosureGenerating}
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 800 }}>Note opzionali</span>
                <textarea
                  value={earlyClosureNotes}
                  onChange={(event) => setEarlyClosureNotes(event.target.value)}
                  rows={4}
                  placeholder="Eventuali indicazioni per il consulente..."
                  disabled={earlyClosureGenerating}
                />
              </label>

              <div className="soft-chip" style={{ justifySelf: 'start', background: 'rgba(245, 158, 11, 0.16)', color: '#92400e' }}>
                Il PDF non modifica lo stato degli operai nel database.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setEarlyClosureOpen(false)}
                disabled={earlyClosureGenerating}
              >
                Annulla
              </button>
              <button type="submit" className="button" disabled={earlyClosureGenerating}>
                {earlyClosureGenerating ? (
                  <>
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        border: '2px solid rgba(255,255,255,0.45)',
                        borderTopColor: '#fff',
                        animation: 'spin 0.8s linear infinite',
                      }}
                      aria-hidden="true"
                    />
                    Generazione...
                  </>
                ) : (
                  'Genera PDF'
                )}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ComplianceStatusBadge({ info }) {
  const toneStyle = complianceToneStyles[info?.tone || 'neutral'] || complianceToneStyles.neutral;
  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 112 }}>
      <span style={{ ...complianceBadgeStyle, ...toneStyle }}>
        {info?.label || '-'}
      </span>
      {info?.detail ? (
        <span style={{ fontSize: 11, color: '#64748b', lineHeight: 1.2 }}>
          {info.detail}
        </span>
      ) : null}
    </div>
  );
}

function EmployeeDetailDrawer({ employee, onClose, onOpenHire, onOpenHirePeriod, onOpenArt37, onOpenMedical }) {
  const fullName = `${employee.last_name || ''} ${employee.first_name || ''}`.trim();
  const periods = employee.employment_periods || [];
  const teamNames = (employee.team_history || []).map((t) => t.name).filter(Boolean);
  const hasLegacy = !!employee.legacy_hire_document;
  const periodsWithDoc = periods.filter((p) => p.hire_document);
  const hasArt37 = !!employee.art37_document;
  const hasMedical = !!employee.medical_visit_document;
  const noDocAtAll = !hasLegacy && periodsWithDoc.length === 0 && !hasArt37 && !hasMedical;

  return (
    <div style={drawerBackdropStyle} onClick={onClose} role="presentation">
      <aside
        style={drawerPanelStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Scheda dipendente ${fullName}`}
      >
        <header style={drawerHeaderStyle}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#475569' }}>
              Scheda dipendente
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: '#0f172a' }}>{fullName || '—'}</div>
            {employee.role ? <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>{employee.role}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="button-secondary"
            style={{ minHeight: 34, padding: '0 12px', fontSize: 13 }}
            aria-label="Chiudi scheda"
          >
            Chiudi
          </button>
        </header>

        <div style={drawerBodyStyle}>
          <Section title="Anagrafica">
            <Field label="Cognome" value={employee.last_name} />
            <Field label="Nome" value={employee.first_name} />
            <Field label="Codice fiscale" value={employee.fiscal_code} mono />
            <Field label="Telefono" value={employee.phone} />
            <Field label="Email" value={employee.email} />
            <Field label="Stato" value={employee.status} />
            <Field label="Squadre" value={teamNames.length ? teamNames.join(', ') : null} />
          </Section>

          <Section title="Rapporti di lavoro">
            {periods.length === 0 ? (
              <div style={{ fontSize: 13, color: '#64748b' }}>
                Nessun rapporto di lavoro registrato per questo dipendente.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {periods.map((p) => (
                  <div key={p.id} style={periodCardStyle(p.is_current)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>
                        {p.hired_by || '—'} {p.is_current ? <span style={periodCurrentBadgeStyle}>corrente</span> : null}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{p.status || 'attivo'}</div>
                    </div>
                    <div style={{ fontSize: 13, color: '#334155', marginTop: 4 }}>
                      Dal <strong>{formatDisplayDate(p.hire_date_from) || '—'}</strong>
                      {p.hire_date_to ? <> al <strong>{formatDisplayDate(p.hire_date_to)}</strong></> : null}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      {p.hire_document ? (
                        <button
                          type="button"
                          className="button-secondary"
                          style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}
                          onClick={() => onOpenHirePeriod(p.id)}
                        >
                          Apri allegato rapporto
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>Nessun allegato per questo rapporto</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Documenti">
            {noDocAtAll ? (
              <div style={{ fontSize: 13, color: '#64748b' }}>
                Nessun documento caricato sulla scheda dipendente.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {hasLegacy || periodsWithDoc.length ? (
                  <div style={docRowStyle}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>Documento assunzione</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {hasLegacy ? 'Allegato globale' : `Allegato rapporto ${periodsWithDoc[0].hired_by || ''}`.trim()}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="button-secondary"
                      style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}
                      onClick={onOpenHire}
                    >
                      Apri
                    </button>
                  </div>
                ) : null}
                {hasArt37 ? (
                  <div style={docRowStyle}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>Documento Art. 37</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>Formazione sicurezza</div>
                    </div>
                    <button
                      type="button"
                      className="button-secondary"
                      style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}
                      onClick={onOpenArt37}
                    >
                      Apri
                    </button>
                  </div>
                ) : null}
                {hasMedical ? (
                  <div style={docRowStyle}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>Visita medica</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>Idoneità sanitaria</div>
                    </div>
                    <button
                      type="button"
                      className="button-secondary"
                      style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}
                      onClick={onOpenMedical}
                    >
                      Apri
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </Section>

          {employee.notes ? (
            <Section title="Note">
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: '#334155', lineHeight: 1.5 }}>
                {employee.notes}
              </div>
            </Section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px dashed #e2e8f0' }}>
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? '#0f172a' : '#94a3b8', fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : undefined, textAlign: 'right' }}>
        {value || '—'}
      </div>
    </div>
  );
}

const th = {
  padding: 12,
  textAlign: 'left',
  borderBottom: '1px solid #e5e7eb',
};

const td = {
  padding: 12,
  borderBottom: '1px solid #f3f4f6',
  verticalAlign: 'top',
};

const selectedRowStyle = {
  background: 'rgba(22, 163, 74, 0.06)',
};

const complianceBadgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'fit-content',
  minHeight: 24,
  padding: '0 9px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 800,
  whiteSpace: 'nowrap',
};

const complianceToneStyles = {
  valid: {
    background: 'rgba(22, 163, 74, 0.12)',
    color: '#14532d',
  },
  missing: {
    background: 'rgba(245, 158, 11, 0.16)',
    color: '#92400e',
  },
  expired: {
    background: 'rgba(220, 38, 38, 0.12)',
    color: '#991b1b',
  },
  neutral: {
    background: 'rgba(100, 116, 139, 0.12)',
    color: '#475569',
  },
};

const drawerBackdropStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.35)',
  zIndex: 50,
  display: 'flex',
  justifyContent: 'flex-end',
};

const drawerPanelStyle = {
  width: 'min(520px, 100%)',
  height: '100%',
  background: '#ffffff',
  boxShadow: '-12px 0 40px rgba(15, 23, 42, 0.18)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const drawerHeaderStyle = {
  padding: '16px 18px',
  borderBottom: '1px solid #e5e7eb',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
};

const drawerBodyStyle = {
  padding: '16px 18px',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};

const sectionStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: '12px 14px',
  background: '#fbfdfb',
};

const sectionTitleStyle = {
  margin: 0,
  marginBottom: 8,
  fontSize: 12,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#475569',
};

const periodCardStyle = (isCurrent) => ({
  border: `1px solid ${isCurrent ? 'rgba(22, 163, 74, 0.45)' : '#e5e7eb'}`,
  background: isCurrent ? 'rgba(22, 163, 74, 0.05)' : '#ffffff',
  borderRadius: 10,
  padding: '10px 12px',
});

const periodCurrentBadgeStyle = {
  display: 'inline-block',
  marginLeft: 6,
  padding: '1px 8px',
  borderRadius: 999,
  background: 'rgba(22, 163, 74, 0.16)',
  color: '#14532d',
  fontSize: 10,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  verticalAlign: 'middle',
};

const docRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  padding: '8px 10px',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  background: '#ffffff',
};
