import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DocumentActions from '../components/DocumentActions';
import { formatDisplayDateTime } from '../utils/dateFormat';

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

export default function StoricoOperaioPage() {
  const navigate = useNavigate();
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
        ? await window.api.payroll.listHistory()
        : await buildFallbackHistory();
      setRecords(data || []);
    } catch (err) {
      console.error('Storico operaio: endpoint principale non disponibile, uso fallback.', err);
      try {
        const fallbackData = await buildFallbackHistory();
        setRecords(fallbackData || []);
        setLoadNotice('Storico caricato in modalità compatibile.');
      } catch (fallbackErr) {
        console.error(fallbackErr);
        setRecords([]);
        setLoadNotice('Errore caricamento storico operaio.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

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

      if (periodFilter && monthToDateValue(record.month) !== periodFilter) {
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
  }, [records, search, statusFilter, teamFilter, roleFilter, employerFilter, periodFilter, showArchivedSlots]);

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
    const balance = getRecordEffectiveBalance(record);
    return sum + (balance > 0 ? balance : 0);
  }, 0);
  const totalDaRicevere = filteredRecords.reduce((sum, record) => {
    const balance = getRecordEffectiveBalance(record);
    return sum + (balance < 0 ? Math.abs(balance) : 0);
  }, 0);

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
    const confirmed = window.confirm('Confermi l’eliminazione della busta paga allegata?');
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
    const confirmed = window.confirm('Confermi l’archiviazione di questo report storico?');
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
    const confirmed = window.confirm('Confermi l’eliminazione definitiva di questo slot storico?');
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

  return (
    <div className="page">
      <div className="page-sticky-stack">
        <section className="page-hero">
          <div>
            <span className="page-kicker">Archivio consultabile</span>
            <h1 className="page-title">Storico Operaio</h1>
            <p className="page-subtitle">
              Archivio mensile già popolato, con ricerca veloce, filtri utili e collegamento diretto al report di origine.
            </p>
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
            <StatCard label="Voci storiche" value={filteredRecords.length} />
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
                Archivio storico — doppio clic su una voce per aprire il report collegato
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
                        const diff = getRecordEffectiveBalance(record);
                        const currentStatus = employeeStatusLabel(employee);
                        const statusStyle =
                          currentStatus === 'attivo'
                            ? { background: '#dcfce7', color: '#166534' }
                            : currentStatus === 'inattivo'
                            ? { background: '#fef3c7', color: '#92400e' }
                            : { background: '#e5e7eb', color: '#374151' };

                        return (
                          <div
                            key={record.id}
                            onDoubleClick={() => handleOpenLinkedReport(record)}
                            style={{
                              display: 'grid',
                              gap: 14,
                              padding: 16,
                              borderBottom: '1px solid #eef2f7',
                              cursor: 'pointer',
                              background: record.archived_at ? '#fcfcfd' : '#fff',
                            }}
                            title="Doppio clic per aprire il report collegato"
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
                                  label={diff > 0 ? 'Da pagare' : diff < 0 ? 'Da ricevere' : 'Pareggio'}
                                  value={diff === 0 ? '—' : formatCurrency(Math.abs(diff))}
                                  color={diff > 0 ? '#dc2626' : diff < 0 ? '#059669' : '#374151'}
                                />
                              </div>
                            </div>

                            <div style={{ display: 'grid', gap: 10 }}>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button type="button" className="button-secondary" onClick={() => setPreviewRecord(record)}>
                                  Anteprima
                                </button>
                                <button type="button" className="button-secondary" onClick={() => handlePrintSnapshot(record)}>
                                  Stampa
                                </button>
                                {!record.archived_at ? (
                                  <button type="button" className="button-secondary" onClick={() => handleArchiveRecord(record)}>
                                    Archivia slot
                                  </button>
                                ) : (
                                  <button type="button" className="button-secondary" onClick={() => handleRestoreRecord(record)}>
                                    Ripristina slot
                                  </button>
                                )}
                                <button type="button" className="button-danger" onClick={() => handleDeleteRecord(record)}>
                                  Elimina slot
                                </button>
                              </div>

                              <DocumentActions
                                document={record.payroll_document}
                                onUpload={() => handleUploadDocument(record)}
                                onOpen={() => handleOpenDocument(record)}
                                onDelete={() => handleDeleteDocument(record)}
                                uploadLabel={busyRecordId === String(record.id) ? 'Caricamento...' : 'Carica file'}
                                openLabel="Apri file"
                                emptyLabel="Nessuna busta allegata"
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
          <div className="modal-dialog" style={{ maxWidth: 980 }} onClick={(event) => event.stopPropagation()}>
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
              <div style={{ maxHeight: '72vh', overflow: 'auto', padding: 8, background: '#f8fafc', borderRadius: 16 }}>
                <div dangerouslySetInnerHTML={{ __html: previewRecord.report_html_snapshot }} />
              </div>
            ) : (
              <div className="panel empty-state">Nessuna anteprima salvata per questo report.</div>
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
