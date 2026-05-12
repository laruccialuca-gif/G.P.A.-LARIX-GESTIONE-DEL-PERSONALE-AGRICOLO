import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDisplayDateTime } from '../utils/dateFormat';
import { formatWorkedSummary } from '../utils/attendanceSummary';
import { useYearContext } from '../context/YearContext';

const MONTH_NAMES = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

function StatCard({ label, value, color = '#111827' }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 24, color }}>{value}</div>
    </div>
  );
}

function formatMonth(monthStr) {
  if (!monthStr) return '';
  const [year, month] = monthStr.split('-');
  return `${MONTH_NAMES[parseInt(month, 10) - 1]} ${year}`;
}

function formatCurrency(value) {
  return `€ ${Number(value || 0).toFixed(2)}`;
}

function formatHours(value) {
  const hours = Number(value || 0);
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(2).replace('.', ',')} h`;
}

function getRecordEffectiveBalance(record) {
  const snapshot =
    typeof record?.report_snapshot_json === 'string'
      ? (() => {
          try {
            return JSON.parse(record.report_snapshot_json);
          } catch {
            return null;
          }
        })()
      : record?.report_snapshot_json || null;

  const currentInstallmentsTotal = Number(
    snapshot?.current_installments_total ??
      record?.current_installments_total ??
      0
  );

  return (
    Number(record?.retribuzione_calcolata || 0) +
    Number(record?.resto_precedente || 0) +
    Number(record?.totale_trasporto || 0) +
    Number(record?.regalo_importo || 0) -
    Number(record?.acconti || 0) -
    Number(record?.importo_busta_paga || 0) -
    currentInstallmentsTotal
  );
}

function employeeStatusLabel(employee) {
  if (!employee) return '';
  if (employee.is_deleted) return 'archiviato';
  return employee.status === 'attivo' ? 'attivo' : 'inattivo';
}

function monthToDateValue(month) {
  if (!month) return '';
  return `${month}-01`;
}

function buildHistoryDetail(record) {
  const parts = [];

  if (record.datore) {
    parts.push(record.datore);
  }

  parts.push(`giornate effettive ${Number(record.giornate_effettuate || 0)}`);

  if (record.employee?.team_names?.length) {
    parts.push(record.employee.team_names.join(', '));
  }

  if (record.employee?.role) {
    parts.push(record.employee.role);
  }

  return parts.join(' · ');
}

function getIpcRecoveryMessage(error, fallbackMessage) {
  const message = String(error?.message || '');
  if (message.includes('No handler registered')) {
    return 'Questa funzione richiede il riavvio completo di Electron per aggiornare il processo principale.';
  }
  return fallbackMessage;
}

function HistoryPayrollActions({
  document,
  busy,
  onUpload,
  onOpen,
  onDelete,
}) {
  const hasDocument = !!document;
  const buttonStyle = { minHeight: 34, padding: '0 12px', fontSize: 12 };

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 12, color: '#667085', minWidth: 132 }}>
        {hasDocument ? 'Busta paga presente' : 'Nessuna busta paga'}
      </span>
      <button
        type="button"
        className={hasDocument ? 'button-secondary' : 'button'}
        style={buttonStyle}
        onClick={onUpload}
        disabled={busy}
      >
        {busy ? 'Caricamento...' : hasDocument ? 'Sostituisci PDF' : 'Carica PDF'}
      </button>
      <button
        type="button"
        className="button-secondary"
        style={buttonStyle}
        onClick={onOpen}
        disabled={!hasDocument}
      >
        Apri
      </button>
      <button
        type="button"
        className="button-danger"
        style={buttonStyle}
        onClick={onDelete}
        disabled={!hasDocument}
      >
        Elimina
      </button>
    </div>
  );
}

function getSnapshot(record) {
  return typeof record?.report_snapshot_json === 'string'
    ? (() => {
        try {
          return JSON.parse(record.report_snapshot_json);
        } catch {
          return null;
        }
      })()
    : record?.report_snapshot_json || null;
}

function getRecordPaymentSummary(record) {
  const snapshot = getSnapshot(record);
  const grossBalance = getRecordEffectiveBalance(record);
  const residual = record?.resto_pagato ? 0 : grossBalance;
  const basePaidAmount =
    Number(record?.importo_busta_paga || 0) +
    Number(record?.acconti || 0) +
    Number(snapshot?.current_installments_total || 0);
  const residualPaidAmount = record?.resto_pagato ? Math.abs(grossBalance) : 0;
  const paidAmount = basePaidAmount + residualPaidAmount;

  let status = 'non_pagato';
  let label = 'Non pagato';
  if (Math.abs(grossBalance) <= 0.009) {
    status = record?.is_pagato ? 'pagato' : 'pareggio';
    label = record?.is_pagato ? 'Pagato' : 'Pareggio';
  } else if (record?.resto_pagato) {
    status = 'saldato';
    label = 'Saldato';
  } else if (basePaidAmount > 0 || record?.is_pagato) {
    status = 'parziale';
    label = 'Parziale';
  }

  return {
    snapshot,
    grossBalance,
    residual,
    originAmount: Math.abs(grossBalance),
    paidAmount,
    residualAmount: Math.abs(residual),
    status,
    label,
    paidDate:
      record?.resto_pagato_data ||
      (record?.is_pagato ? record?.processed_at || record?.updated_at || record?.created_at || '' : ''),
    overtimeHours: Number(snapshot?.totalOvertimeHours || 0),
    overtimeAmount: Number(snapshot?.totalOvertimePay || 0),
    regularHours: Number(
      snapshot?.totalRegularHours ??
        Math.max(Number(record?.ore_totali || 0) - Number(snapshot?.totalOvertimeHours || 0), 0)
    ),
  };
}

export default function StoricoOperaioPage() {
  const HISTORY_PAGE_SIZE = 40;
  const navigate = useNavigate();
  const { selectedYear } = useYearContext();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyRecordId, setBusyRecordId] = useState('');
  const [loadNotice, setLoadNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [employerFilter, setEmployerFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('');
  const [previewRecord, setPreviewRecord] = useState(null);
  const [showArchivedSlots, setShowArchivedSlots] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);
  const deferredSearch = useDeferredValue(search);

  async function buildFallbackHistory() {
    const employees = await window.api.employees.list({ includeDeleted: true });
    const normalizedEmployees = employees || [];
    const results = await Promise.all(
      normalizedEmployees.map((employee) => window.api.payroll.listByEmployee(employee.id))
    );

    return normalizedEmployees
      .flatMap((employee, index) =>
        (results[index] || []).map((record) => ({
          ...record,
          employee: {
            id: employee.id,
            first_name: employee.first_name,
            last_name: employee.last_name,
            role: employee.role || '',
            status: employee.status || 'attivo',
            is_deleted: !!employee.is_deleted,
            hired_by: employee.hired_by || '',
            team_names: (employee.team_history || []).map((item) => item.name).filter(Boolean),
          },
        }))
      )
      .filter((record) => String(record.month || '').startsWith(`${selectedYear}-`))
      .sort((a, b) => {
        const monthCompare = String(b.month || '').localeCompare(String(a.month || ''));
        if (monthCompare !== 0) return monthCompare;
        const lastNameCompare = String(a.employee?.last_name || '').localeCompare(String(b.employee?.last_name || ''), 'it');
        if (lastNameCompare !== 0) return lastNameCompare;
        return String(a.employee?.first_name || '').localeCompare(String(b.employee?.first_name || ''), 'it');
      });
  }

  async function loadHistory() {
    setLoading(true);
    try {
      setLoadNotice('');
      const data = typeof window.api.payroll.listHistory === 'function'
        ? await window.api.payroll.listHistory({
            year: selectedYear,
            month: periodFilter ? periodFilter.slice(0, 7) : '',
            search: deferredSearch,
            limit: HISTORY_PAGE_SIZE,
            offset: historyOffset,
          })
        : await buildFallbackHistory();
      if (Array.isArray(data)) {
        setRecords(data || []);
        setHistoryTotal((data || []).length);
      } else {
        setRecords(data?.items || []);
        setHistoryTotal(Number(data?.total || 0));
      }
    } catch (err) {
      console.error('Storico operaio: endpoint principale non disponibile, uso fallback.', err);
      try {
        const fallbackData = await buildFallbackHistory();
        setRecords(fallbackData || []);
        setHistoryTotal((fallbackData || []).length);
        setLoadNotice('Storico caricato in modalità compatibile.');
      } catch (fallbackErr) {
        console.error(fallbackErr);
        setRecords([]);
        setHistoryTotal(0);
        setLoadNotice('Errore caricamento storico operaio.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, [selectedYear, deferredSearch, periodFilter, historyOffset]);

  // [report-debug] TEMPORANEO — rimuovere dopo diagnosi
  useEffect(() => {
    if (!previewRecord) return;
    const snap = typeof previewRecord.report_snapshot_json === 'string'
      ? (() => { try { return JSON.parse(previewRecord.report_snapshot_json); } catch { return null; } })()
      : previewRecord.report_snapshot_json;

    const rawLive = previewRecord.live_installments_total;
    const liveFieldPresent = rawLive !== undefined && rawLive !== null;
    const computedLive = Number(rawLive ?? snap?.current_installments_total ?? 0);
    const computedSnapshot = Number(snap?.current_installments_total ?? 0);
    const computedMismatch =
      liveFieldPresent &&
      (!!previewRecord.installments_snapshot_mismatch ||
        Math.abs(computedSnapshot - Number(rawLive)) > 0.009);
    const renderedValue = computedMismatch
      ? `€ ${computedLive.toFixed(2)} · valore storico salvato: € ${computedSnapshot.toFixed(2)}`
      : `€ ${computedLive.toFixed(2)}`;

    console.log('[report-debug] Rate/trattenute renderer', {
      employee: `${previewRecord.employee?.last_name || ''} ${previewRecord.employee?.first_name || ''}`.trim(),
      month: previewRecord.month,
      // campi dal backend
      live_installments_total: rawLive,
      live_field_present: liveFieldPresent,
      snapshot_installments_total: previewRecord.snapshot_installments_total,
      installments_snapshot_mismatch: previewRecord.installments_snapshot_mismatch,
      // valore dentro lo snapshot JSON
      snap_current_installments_total: snap?.current_installments_total,
      report_snapshot_json_type: typeof previewRecord.report_snapshot_json,
      // valori computati
      computed_live: computedLive,
      computed_snapshot: computedSnapshot,
      computed_mismatch: computedMismatch,
      // stringa renderizzata nella riga
      rendered_value: renderedValue,
    });
  }, [previewRecord]);

  useEffect(() => {
    setHistoryOffset(0);
  }, [selectedYear, deferredSearch, periodFilter]);

  const teamOptions = useMemo(() => {
    const values = new Set();
    records.forEach((record) => {
      (record.employee?.team_names || []).forEach((name) => values.add(name));
    });
    return [...values].sort((a, b) => a.localeCompare(b, 'it'));
  }, [records]);

  const roleOptions = useMemo(() => {
    const values = new Set();
    records.forEach((record) => {
      if (record.employee?.role) {
        values.add(record.employee.role);
      }
    });
    return [...values].sort((a, b) => a.localeCompare(b, 'it'));
  }, [records]);

  const employerOptions = useMemo(() => {
    const values = new Set();
    records.forEach((record) => {
      if (record.datore) {
        values.add(record.datore);
      }
    });
    return [...values].sort((a, b) => a.localeCompare(b, 'it'));
  }, [records]);

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();

    return records.filter((record) => {
      const employee = record.employee || {};
      const currentStatus = employeeStatusLabel(employee);

      if (statusFilter !== 'all' && currentStatus !== statusFilter) {
        return false;
      }

      if (teamFilter !== 'all' && !(employee.team_names || []).includes(teamFilter)) {
        return false;
      }

      if (roleFilter !== 'all' && employee.role !== roleFilter) {
        return false;
      }

      if (employerFilter !== 'all' && record.datore !== employerFilter) {
        return false;
      }

      if (!showArchivedSlots && record.archived_at) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        employee.first_name,
        employee.last_name,
        employee.role,
        currentStatus,
        record.datore,
        ...(employee.team_names || []),
        buildHistoryDetail(record),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [records, search, statusFilter, teamFilter, roleFilter, employerFilter, showArchivedSlots]);

  const groupedRecords = useMemo(() => {
    const map = new Map();
    for (const record of filteredRecords) {
      const key = String(record.employee_id);
      const group = map.get(key) || {
        employee: record.employee || {},
        records: [],
      };
      group.records.push(record);
      map.set(key, group);
    }
    return [...map.values()];
  }, [filteredRecords]);

  const totalGiornate = filteredRecords.reduce((sum, record) => sum + Number(record.giornate_effettuate || 0), 0);
  const uniqueEmployees = new Set(filteredRecords.map((record) => record.employee_id)).size;
  const totalDaPagare = filteredRecords.reduce((sum, record) => {
    const balance = getRecordPaymentSummary(record).residual;
    return sum + (balance > 0 ? balance : 0);
  }, 0);
  const totalDaRicevere = filteredRecords.reduce((sum, record) => {
    const balance = getRecordPaymentSummary(record).residual;
    return sum + (balance < 0 ? Math.abs(balance) : 0);
  }, 0);
  const currentPage = Math.floor(historyOffset / HISTORY_PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));

  async function handleUploadDocument(record) {
    setBusyRecordId(String(record.id));
    try {
      const result = await window.api.payroll.uploadDocument(record.employee_id, record.month);
      if (!result?.canceled) {
        await loadHistory();
      }
    } catch (err) {
      console.error(err);
      alert('Errore caricamento busta paga');
    } finally {
      setBusyRecordId('');
    }
  }

  async function handleOpenDocument(record) {
    try {
      const result = await window.api.payroll.openDocument(record.employee_id, record.month);
      if (result && !result.success && result.message) {
        alert(result.message);
      }
    } catch (err) {
      console.error(err);
      alert('Errore apertura busta paga');
    }
  }

  async function handleDeleteDocument(record) {
    const confirmed = window.confirm("Confermi l'eliminazione della busta paga allegata?");
    if (!confirmed) return;

    try {
      const result = await window.api.payroll.deleteDocument(record.employee_id, record.month);
      if (result && result.success === false && result.message) {
        alert(result.message);
      }
      await loadHistory();
    } catch (err) {
      console.error(err);
      alert(getIpcRecoveryMessage(err, 'Errore eliminazione busta paga'));
    }
  }

  function handleOpenLinkedReport(record) {
    navigate(`/report?employee=${record.employee_id}&month=${record.month}`);
  }

  async function handlePrintSnapshot(record) {
    if (!record.report_html_snapshot) {
      alert('Questo report storico non ha una stampa salvata.');
      return;
    }

    try {
      await window.api.reports.printHtml({
        html: record.report_html_snapshot,
        fileName: `${record.employee?.last_name || 'report'}-${record.month}.pdf`,
        landscape: false,
      });
    } catch (err) {
      console.error(err);
      alert('Errore stampa report storico');
    }
  }

  async function handleArchiveRecord(record) {
    const confirmed = window.confirm("Confermi l'archiviazione di questo report storico?");
    if (!confirmed) return;

    try {
      await window.api.payroll.archiveRecord(record.id);
      await loadHistory();
    } catch (err) {
      console.error(err);
      alert('Errore archiviazione report storico');
    }
  }

  async function handleRestoreRecord(record) {
    try {
      await window.api.payroll.restoreRecord(record.id);
      await loadHistory();
    } catch (err) {
      console.error(err);
      alert('Errore ripristino report storico');
    }
  }

  async function handleDeleteRecord(record) {
    const confirmed = window.confirm("Confermi l'eliminazione definitiva di questo slot storico?");
    if (!confirmed) return;

    try {
      const result = await window.api.payroll.deleteRecord(record.id);
      if (result?.success === false && result.message) {
        alert(result.message);
        return;
      }
      await loadHistory();
    } catch (err) {
      console.error(err);
      alert('Errore eliminazione report storico');
    }
  }

  const previewPaymentSummary = previewRecord ? getRecordPaymentSummary(previewRecord) : null;
  const previewSnapshot = previewPaymentSummary?.snapshot || null;
  const previewStandardHours = Number(
    previewSnapshot?.standardHours || previewRecord?.employee?.standard_hours || 7
  );
  const previewWorkedSummary = previewRecord
    ? formatWorkedSummary(
        Number(previewSnapshot?.totalHours ?? previewRecord?.ore_totali ?? 0),
        previewStandardHours
      )
    : '';
  const previewCreditAmount =
    previewPaymentSummary?.grossBalance > 0 ? previewPaymentSummary.originAmount : 0;
  const previewDebtAmount =
    previewPaymentSummary?.grossBalance < 0 ? previewPaymentSummary.originAmount : 0;
  // Usa live_installments_total se presente (anche se 0 è un valore valido).
  // Fallback allo snapshot SOLO per record storici non ancora arricchiti dal backend.
  // NON usare || perché 0 verrebbe ignorato come falsy.
  const previewLiveInstallments = Number(
    previewRecord?.live_installments_total ?? previewSnapshot?.current_installments_total ?? 0
  );
  const previewSnapshotInstallments = Number(previewSnapshot?.current_installments_total ?? 0);
  // Mostra l'annotazione solo quando il campo live è effettivamente presente
  // (record arricchito dal backend) e il valore differisce dallo snapshot.
  const previewLiveFieldPresent =
    previewRecord != null &&
    previewRecord.live_installments_total !== undefined &&
    previewRecord.live_installments_total !== null;
  const previewInstallmentsMismatch =
    previewLiveFieldPresent &&
    (!!previewRecord.installments_snapshot_mismatch ||
      Math.abs(previewSnapshotInstallments - Number(previewRecord.live_installments_total)) > 0.009);

  return (
    <div className="page">
      <div className="page-sticky-stack">
        <section className="page-hero">
          <div>
            <span className="page-kicker">Archivio consultabile</span>
            <h1 className="page-title">Storico Operaio</h1>
            <p className="page-subtitle">
              Archivio storico filtrato per anno attivo, con ricerca veloce, filtri utili e collegamento diretto al report di origine.
            </p>
          </div>
          <div className="page-actions">
            <span className="soft-chip" style={{ background: 'rgba(31, 41, 55, 0.1)', color: '#1F2937' }}>
              Anno {selectedYear}
            </span>
          </div>
        </section>

        <div className="toolbar history-toolbar">
          <div className="toolbar-group history-toolbar-main">
            <input
              className="search-input history-search-input"
              placeholder="Cerca per nome, squadra, mansione, datore..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="toolbar-group history-toolbar-filters">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="history-compact-input">
              <option value="all">Tutti gli stati</option>
              <option value="attivo">Attivi</option>
              <option value="inattivo">Inattivi</option>
              <option value="archiviato">Archiviati</option>
            </select>
            <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="history-compact-input">
              <option value="all">Tutte le squadre</option>
              {teamOptions.map((team) => (
                <option key={team} value={team}>{team}</option>
              ))}
            </select>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="history-compact-input">
              <option value="all">Tutte le mansioni</option>
              {roleOptions.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
            <select value={employerFilter} onChange={(e) => setEmployerFilter(e.target.value)} className="history-compact-input">
              <option value="all">Tutti i datori</option>
              {employerOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <input
              type="month"
              value={periodFilter ? periodFilter.slice(0, 7) : ''}
              onChange={(e) => setPeriodFilter(e.target.value ? `${e.target.value}-01` : '')}
              className="history-compact-input"
            />
            <label className="history-toggle">
              <input
                type="checkbox"
                checked={showArchivedSlots}
                onChange={(e) => setShowArchivedSlots(e.target.checked)}
              />
              Mostra slot archiviati
            </label>
            <span className="soft-chip" style={{ background: 'rgba(20, 33, 61, 0.06)', color: '#314762' }}>
              Pagina {currentPage} / {totalPages}
            </span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="panel empty-state">Caricamento...</div>
      ) : (
        <>
          {loadNotice ? (
            <div className="panel panel-section" style={{ padding: 14, color: loadNotice.includes('Errore') ? '#b91c1c' : '#92400e' }}>
              {loadNotice}
            </div>
          ) : null}

          <div className="stats-grid">
            <StatCard label="Voci storiche" value={historyTotal} />
            <StatCard label="Operai coinvolti" value={uniqueEmployees} />
            <StatCard label="Giornate effettive" value={totalGiornate} />
            <StatCard label="Totale da dare agli operai" value={formatCurrency(totalDaPagare)} color="#dc2626" />
            <StatCard label="Totale da ricevere dagli operai" value={formatCurrency(totalDaRicevere)} color="#059669" />
          </div>

          {!filteredRecords.length ? (
            <div className="panel empty-state">
              Nessun risultato con i filtri attuali.
            </div>
          ) : (
            <div className="panel panel-section" style={{ padding: 0 }}>
              <div style={{ padding: 16, borderBottom: '1px solid #f3f4f6', fontWeight: 700 }}>
                Archivio storico — clic su una voce per aprire l'anteprima del report collegato
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ color: '#64748b', fontSize: 13 }}>
                  Caricati {records.length} record su {historyTotal} totali per i filtri server-side correnti.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={historyOffset === 0 || loading}
                    onClick={() => setHistoryOffset((current) => Math.max(0, current - HISTORY_PAGE_SIZE))}
                  >
                    Pagina precedente
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={historyOffset + HISTORY_PAGE_SIZE >= historyTotal || loading}
                    onClick={() => setHistoryOffset((current) => current + HISTORY_PAGE_SIZE)}
                  >
                    Pagina successiva
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 0 }}>
                {groupedRecords.map((group) => (
                  <div key={`history-group-${group.employee.id}`} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <div style={{ padding: 16, background: '#f8fafc', borderBottom: '1px solid #eef2f7' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 18 }}>
                            {group.employee.first_name} {group.employee.last_name}
                          </div>
                          <div style={{ color: '#667085', fontSize: 13 }}>
                            {group.employee.role || 'Nessuna mansione'}
                            {group.employee.team_names?.length ? ` · Squadra: ${group.employee.team_names.join(', ')}` : ''}
                            {group.employee.hired_by ? ` · Datore storico: ${group.employee.hired_by}` : ''}
                          </div>
                        </div>
                        <div className="soft-chip" style={{ background: '#eef2ff', color: '#4338ca' }}>
                          {group.records.length} report storici
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 0 }}>
                      {group.records.map((record) => {
                        const employee = record.employee || {};
                        const paymentSummary = getRecordPaymentSummary(record);
                        const diff = paymentSummary.residual;
                        const currentStatus = employeeStatusLabel(employee);
                        const statusStyle =
                          currentStatus === 'attivo'
                            ? { background: '#dcfce7', color: '#166534' }
                            : currentStatus === 'inattivo'
                            ? { background: '#fef3c7', color: '#92400e' }
                            : { background: '#e5e7eb', color: '#374151' };
                        const paymentStatusStyle =
                          paymentSummary.status === 'saldato' || paymentSummary.status === 'pagato' || paymentSummary.status === 'pareggio'
                            ? { background: '#e5e7eb', color: '#374151' }
                            : paymentSummary.status === 'parziale'
                            ? { background: '#fef3c7', color: '#92400e' }
                            : { background: '#fee2e2', color: '#b91c1c' };

                        return (
                          <div
                            key={record.id}
                            onClick={() => setPreviewRecord(record)}
                            style={{
                              display: 'grid',
                              gap: 14,
                              padding: 16,
                              borderBottom: '1px solid #eef2f7',
                              cursor: 'pointer',
                              background: record.archived_at ? '#fcfcfd' : '#fff',
                            }}
                            title="Clic per aprire l'anteprima del report"
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'start' }}>
                              <div style={{ display: 'grid', gap: 6 }}>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                  <span className="soft-chip" style={statusStyle}>
                                    {currentStatus}
                                  </span>
                                  <span className="soft-chip" style={{ background: '#eef2ff', color: '#4338ca' }}>
                                    {formatMonth(record.month)}
                                  </span>
                                  {record.archived_at ? (
                                    <span className="soft-chip" style={{ background: 'rgba(107, 114, 128, 0.14)', color: '#374151' }}>
                                      slot archiviato
                                    </span>
                                  ) : null}
                                  {record.datore ? (
                                    <span className="soft-chip" style={{ background: 'rgba(37, 99, 235, 0.12)', color: '#1d4ed8' }}>
                                      {record.datore}
                                    </span>
                                  ) : null}
                                  <span className="soft-chip" style={paymentStatusStyle}>
                                    {paymentSummary.label}
                                  </span>
                                </div>
                                <div style={{ color: '#667085', fontSize: 14 }}>
                                  {buildHistoryDetail(record)}
                                </div>
                                <div style={{ color: '#94a3b8', fontSize: 12 }}>
                                  Processato il {formatDisplayDateTime(record.processed_at || record.updated_at || record.created_at)}
                                </div>
                              </div>

                              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <MiniInfo label="Compenso" value={formatCurrency(record.retribuzione_calcolata)} />
                                <MiniInfo label="Busta paga" value={formatCurrency(record.importo_busta_paga)} />
                                <MiniInfo
                                  label={diff === 0 ? 'Residuo' : diff > 0 ? 'Da pagare' : 'Da ricevere'}
                                  value={formatCurrency(Math.abs(diff))}
                                  color={diff > 0 ? '#dc2626' : diff < 0 ? '#059669' : '#374151'}
                                />
                              </div>
                            </div>

                            <div style={{ display: 'grid', gap: 10 }}>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button type="button" className="button-secondary" onClick={(event) => {
                                  event.stopPropagation();
                                  setPreviewRecord(record);
                                }}>
                                  Anteprima
                                </button>
                                <button type="button" className="button-secondary" onClick={(event) => {
                                  event.stopPropagation();
                                  handlePrintSnapshot(record);
                                }}>
                                  Stampa
                                </button>
                                {!record.archived_at ? (
                                  <button type="button" className="button-secondary" onClick={(event) => {
                                    event.stopPropagation();
                                    handleArchiveRecord(record);
                                  }}>
                                    Archivia slot
                                  </button>
                                ) : (
                                  <button type="button" className="button-secondary" onClick={(event) => {
                                    event.stopPropagation();
                                    handleRestoreRecord(record);
                                  }}>
                                    Ripristina slot
                                  </button>
                                )}
                                <button type="button" className="button-danger" onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteRecord(record);
                                }}>
                                  Elimina slot
                                </button>
                              </div>

                              <HistoryPayrollActions
                                document={record.payroll_document}
                                busy={busyRecordId === String(record.id)}
                                onUpload={() => handleUploadDocument(record)}
                                onOpen={() => handleOpenDocument(record)}
                                onDelete={() => handleDeleteDocument(record)}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {previewRecord ? (
        <div className="modal-overlay" onClick={() => setPreviewRecord(null)}>
          <div className="modal-dialog" style={{ maxWidth: 1240 }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="page-kicker">Report processato</span>
                <h2 style={{ margin: '6px 0 0' }}>
                  {previewRecord.employee?.first_name} {previewRecord.employee?.last_name} · {formatMonth(previewRecord.month)}
                </h2>
              </div>
              <button type="button" className="modal-close" onClick={() => setPreviewRecord(null)}>✕</button>
            </div>

            {previewRecord.report_html_snapshot ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(280px, 0.8fr)', gap: 18, alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, color: '#92400e', padding: '5px 10px', background: '#fef3c7', borderRadius: 6, borderLeft: '3px solid #f59e0b', lineHeight: 1.4 }}>
                    Anteprima storica — i valori mostrati qui riflettono il momento del salvataggio. Per i dati aggiornati (incluse rate/trattenute) usa la Sintesi nel pannello a destra.
                  </div>
                  <div style={{ maxHeight: '68vh', overflow: 'auto', padding: 8, background: '#f8fafc', borderRadius: 16 }}>
                    <div dangerouslySetInnerHTML={{ __html: previewRecord.report_html_snapshot }} />
                  </div>
                </div>

                <div style={{ display: 'grid', gap: 14 }}>
                  <div className="panel panel-section" style={{ padding: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#667085', marginBottom: 12 }}>
                      Sintesi report
                    </div>
                    <div style={{ display: 'grid', gap: 10 }}>
                      <HistorySummaryRow label="Dipendente" value={`${previewRecord.employee?.first_name || ''} ${previewRecord.employee?.last_name || ''}`.trim() || '—'} />
                      <HistorySummaryRow label="Mese" value={formatMonth(previewRecord.month)} />
                      <HistorySummaryRow label="Giornate lavorate" value={String(Number(previewRecord.giornate_effettuate || 0))} />
                      <HistorySummaryRow label="Ore ordinarie" value={formatHours(previewPaymentSummary?.regularHours)} />
                      <HistorySummaryRow label="Ore totali" value={formatHours(previewRecord.ore_totali)} />
                      <HistorySummaryRow label="Giornate + ore residue" value={previewWorkedSummary} />
                      <HistorySummaryRow label="Retribuzione calcolata" value={formatCurrency(previewRecord.retribuzione_calcolata)} />
                      <HistorySummaryRow label="Straordinario" value={formatHours(previewPaymentSummary?.overtimeHours)} />
                      <HistorySummaryRow label="Importo straordinario" value={formatCurrency(previewPaymentSummary?.overtimeAmount)} />
                      <HistorySummaryRow label="Acconti" value={formatCurrency(previewRecord.acconti)} />
                      {/* [report-debug] TEMPORANEO — rimuovere dopo diagnosi */}
                      {(() => {
                        const _rawLive = previewRecord?.live_installments_total;
                        const _snapVal = previewSnapshot?.current_installments_total;
                        const _finalValue = Number(_rawLive ?? _snapVal ?? 0);
                        const _source = (_rawLive !== undefined && _rawLive !== null) ? 'live' : (_snapVal !== undefined ? 'snapshot' : 'missing');
                        console.log('[report-debug] Rate/trattenute JSX render', {
                          employee: `${previewRecord?.employee?.last_name || ''} ${previewRecord?.employee?.first_name || ''}`.trim(),
                          month: previewRecord?.month,
                          record_id: previewRecord?.id,
                          'record.live_installments_total': _rawLive,
                          'record.snapshot_installments_total': previewRecord?.snapshot_installments_total,
                          'snapshot.current_installments_total': _snapVal,
                          finalValuePrinted: _finalValue,
                          finalSource: _source,
                        });
                        return null;
                      })()}
                      <HistorySummaryRow
                        label="Rate / trattenute"
                        value={
                          previewInstallmentsMismatch
                            ? `${formatCurrency(previewLiveInstallments)} · valore storico salvato: ${formatCurrency(previewSnapshotInstallments)}`
                            : formatCurrency(previewLiveInstallments)
                        }
                      />
                      <HistorySummaryRow label="Recuperi" value={formatCurrency(previewSnapshot?.recoveries_total)} />
                      <HistorySummaryRow label="Resto precedente" value={formatCurrency(previewRecord.resto_precedente)} />
                      <HistorySummaryRow label="Busta paga" value={formatCurrency(previewRecord.importo_busta_paga)} />
                      <HistorySummaryRow label="Credito da dare all'operaio" value={formatCurrency(previewCreditAmount)} />
                      <HistorySummaryRow label="Debito da ricevere dall'operaio" value={formatCurrency(previewDebtAmount)} />
                      <HistorySummaryRow label="Importo originario aperto" value={formatCurrency(previewPaymentSummary?.originAmount)} />
                      <HistorySummaryRow label="Importo pagato" value={formatCurrency(previewPaymentSummary?.paidAmount)} />
                      <HistorySummaryRow label="Importo residuo" value={formatCurrency(previewPaymentSummary?.residualAmount)} />
                      <HistorySummaryRow label="Saldo finale" value={formatCurrency(previewPaymentSummary?.residualAmount)} />
                      <HistorySummaryRow label="Stato finale" value={previewPaymentSummary?.label} />
                      <HistorySummaryRow label="Data pagamento" value={previewPaymentSummary?.paidDate ? formatDisplayDateTime(previewPaymentSummary.paidDate) : '—'} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button type="button" className="button" onClick={() => handleOpenLinkedReport(previewRecord)}>
                      Modifica report
                    </button>
                    <button type="button" className="button-secondary" onClick={() => handlePrintSnapshot(previewRecord)}>
                      Stampa
                    </button>
                    <button type="button" className="button-secondary" onClick={() => setPreviewRecord(null)}>
                      Esci
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 18 }}>
                <div className="panel empty-state">Nessuna anteprima salvata per questo report.</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button type="button" className="button" onClick={() => handleOpenLinkedReport(previewRecord)}>
                    Modifica report
                  </button>
                  <button type="button" className="button-secondary" onClick={() => setPreviewRecord(null)}>
                    Esci
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MiniInfo({ label, value, color = '#111827' }) {
  return (
    <div style={{ minWidth: 120, textAlign: 'right' }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

function HistorySummaryRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
      <span style={{ fontSize: 12, color: '#667085', fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 14, color: '#111827', fontWeight: 800, textAlign: 'right' }}>{value || '—'}</span>
    </div>
  );
}
