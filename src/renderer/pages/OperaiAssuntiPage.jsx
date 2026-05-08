import React, { useEffect, useMemo, useState } from 'react';
import { formatDisplayDate } from '../utils/dateFormat';

function sanitizeFileName(value) {
  return value.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
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
  search: '',
  // bonus: extension points for future filters (period, status, ...)
};

function matchEmployeeFilter(employee, filters) {
  if (filters.datore !== 'TUTTI' && (employee.hired_by || '') !== filters.datore) {
    return false;
  }
  if (filters.team !== 'TUTTI') {
    const wanted = String(filters.team);
    const list = employee.team_history || [];
    if (!list.some((t) => String(t.team_id) === wanted)) return false;
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
  font: 'inherit',
  color: '#0f172a',
  fontWeight: 700,
  cursor: 'pointer',
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
    if (filters.search) parts.push(`Ricerca: "${filters.search}"`);
    return parts.join(' · ');
  }

  function buildPrintHtml(list, modeLabel) {
    const printDate = new Date().toLocaleDateString('it-IT');
    const sortedList = [...list].sort((a, b) => {
      const last = String(a.last_name || '').localeCompare(String(b.last_name || ''));
      if (last !== 0) return last;
      return String(a.first_name || '').localeCompare(String(b.first_name || ''));
    });

    const rows = sortedList.map((employee) => `
      <tr>
        <td style="padding:10px 12px; font-weight:700; color:#1F2937;">${employee.last_name || ''} ${employee.first_name || ''}</td>
        <td style="padding:10px 12px; color:#334155;">${employee.role || '—'}</td>
        <td style="padding:10px 12px; color:#334155; white-space:nowrap;">${formatDisplayDate(employee.hire_date_from)}</td>
        <td style="padding:10px 12px; color:#334155; white-space:nowrap;">${formatDisplayDate(employee.hire_date_to)}</td>
        <td style="padding:10px 12px; color:#334155; white-space:nowrap;">${employee.hired_by || '—'}</td>
        <td style="padding:10px 12px;">
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
    `).join('');

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
              ${settings?.company?.document_header || settings?.company?.name || 'GPA 1.0.2'}
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
          <table style="width:100%; border-collapse:separate; border-spacing:0; font-size:12px;">
            <thead>
              <tr>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Operaio</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Mansione</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Data da</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Data a</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Assunto da</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Stato</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `
                <tr>
                  <td colspan="6" style="padding:22px 14px; text-align:center; color:#64748b;">
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
        landscape: false,
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
        landscape: false,
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

          <div className="page-actions">
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
          </div>
        </section>

        <div className="toolbar">
          <div className="toolbar-group">
            <input
              type="search"
              placeholder="Cerca nominativo o mansione..."
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
              style={{ minWidth: 240 }}
            />
            <select
              value={filters.datore}
              onChange={(e) => updateFilter('datore', e.target.value)}
              style={{ minWidth: 200 }}
            >
              <option value="TUTTI">Tutti i datori</option>
              {employerOptions.map((option) => (
                <option key={option.short_name} value={option.short_name}>
                  {option.short_name} · {option.name}
                </option>
              ))}
              <option value="ENTRAMBE">ENTRAMBE</option>
            </select>
            <select
              value={filters.team}
              onChange={(e) => updateFilter('team', e.target.value)}
              style={{ minWidth: 200 }}
            >
              <option value="TUTTI">Tutte le squadre</option>
              {teamOptions.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}{team.is_archived ? ' (archiviata)' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button-secondary"
              onClick={resetFilters}
              disabled={
                filters.datore === INITIAL_FILTERS.datore &&
                filters.team === INITIAL_FILTERS.team &&
                !filters.search
              }
            >
              Reset filtri
            </button>
          </div>

          <div className="toolbar-group" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span
              className="soft-chip"
              style={{
                background: 'rgba(22, 163, 74, 0.12)',
                color: '#14532d',
                borderColor: 'rgba(22, 101, 52, 0.14)',
              }}
            >
              {selectedCount} selezionati su {filteredCount}
              {filteredCount !== totalCount ? ` (totale ${totalCount})` : ''}
            </span>
            <button
              type="button"
              className="button-secondary"
              onClick={clearSelection}
              disabled={!hasSelection}
            >
              Cancella selezione
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="panel empty-state">Caricamento...</div>
      ) : (
        <div className="panel table-shell">
          <div className="table-scroll">
            <table className="table">
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
                  <th style={th}>Documento assunzione</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ ...td, textAlign: 'center', color: '#64748b' }}>
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
                        <td style={td}>
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
                        <td style={td}>
                          {teamNames.length ? teamNames.join(', ') : <span style={{ color: '#94a3b8' }}>—</span>}
                        </td>
                        <td style={td}>{formatDisplayDate(employee.hire_date_from)}</td>
                        <td style={td}>{formatDisplayDate(employee.hire_date_to)}</td>
                        <td style={td}>{employee.hired_by || '—'}</td>
                        <td style={td}>{employee.status || '—'}</td>
                        <td style={{ ...td, minWidth: 220 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className={docAvailable ? 'button-secondary' : 'button'}
                              style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }}
                              onClick={() => handleUpload(employee.id)}
                              disabled={busyId === employee.id}
                            >
                              {busyId === employee.id
                                ? 'Caricamento...'
                                : docAvailable
                                ? 'Sostituisci PDF'
                                : 'Aggiungi PDF'}
                            </button>

                            {docAvailable ? (
                              <>
                                <button
                                  type="button"
                                  className="button-secondary"
                                  style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }}
                                  onClick={() => handleOpen(employee)}
                                >
                                  Apri
                                </button>
                                <button
                                  type="button"
                                  className="button-danger"
                                  style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }}
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
