import React, { useEffect, useMemo, useState } from 'react';
import { useYearContext } from '../context/YearContext';
import { employeeIsActiveInYear } from '../utils/yearScope';
import { dispatchRouteReady } from '../utils/navigationPerf';

const MONTH_NAMES = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

function sanitizeFileName(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

function formatMonth(monthStr) {
  if (!monthStr) return '—';
  const [year, month] = String(monthStr).split('-');
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return monthStr;
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

function formatDays(value) {
  const amount = Number(value || 0);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.00$/, '');
}

function formatEmployer(value, employee) {
  const normalized = String(value || '').trim();
  if (normalized) return normalized;
  const fallback = String(employee?.hired_by || '').trim();
  return fallback || '—';
}

function getAttachmentLabel(record) {
  if (!record?.payroll_document) {
    return 'Nessun allegato';
  }
  return record.payroll_document.file_name || 'Allegato disponibile';
}

export default function BustePagaPage() {
  const { selectedYear } = useYearContext();
  const [employees, setEmployees] = useState([]);
  const [recordsByEmployee, setRecordsByEmployee] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      const __nowMs = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const __t0 = __nowMs();

      console.log(`[buste-perf] mount start`);

      try {
        const __empT0 = __nowMs();
        const employeeData = await window.api.employees.listBasic({ includeDeleted: true });
        const __empMs = __nowMs() - __empT0;
        console.log(`[buste-perf] employees IPC: ${Math.round(__empMs)}ms, records: ${Array.isArray(employeeData) ? employeeData.length : 0}`);
        if (cancelled) return;

        const normalizedEmployees = (employeeData || [])
          .slice()
          .sort((a, b) => {
            const lastCompare = String(a.last_name || '').localeCompare(String(b.last_name || ''), 'it');
            if (lastCompare !== 0) return lastCompare;
            return String(a.first_name || '').localeCompare(String(b.first_name || ''), 'it');
          });

        setEmployees(normalizedEmployees);

        const __payrollT0 = __nowMs();
        console.log(`[buste-perf] calling listByEmployees with ${normalizedEmployees.length} employees`);

        let payrollMap;
        try {
          payrollMap = await window.api.payroll.listByEmployees({
            employeeIds: normalizedEmployees.map((e) => e.id),
          });
          console.log(`[buste-perf] listByEmployees returned:`, typeof payrollMap, Object.keys(payrollMap || {}).length);
        } catch (ipcError) {
          console.error(`[buste-error] listByEmployees IPC failed:`, ipcError);
          throw ipcError;
        }

        const __payrollMs = __nowMs() - __payrollT0;
        console.log(`[buste-perf] payroll all-employees IPC: ${Math.round(__payrollMs)}ms, employees: ${normalizedEmployees.length}`);

        if (cancelled) return;

        const nextMap = {};
        normalizedEmployees.forEach((employee) => {
          const records = (payrollMap[employee.id] || [])
            .slice()
            .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')));
          nextMap[employee.id] = records;
        });
        setRecordsByEmployee(nextMap);
      } catch (error) {
        console.error('[buste-error] load failed:', error);
        console.error('[buste-error] stack:', error?.stack);
        alert('Errore caricamento sezione Buste paga: ' + (error?.message || 'sconosciuto'));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
        const __dt = __nowMs() - __t0;
        console.log(`[buste-perf] page ready: ${Math.round(__dt)}ms`);
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      dispatchRouteReady('/buste-paga');
    }
  }, [loading]);

  const employeeRows = useMemo(
    () => employees
      .filter((employee) => employeeIsActiveInYear(employee, selectedYear))
      .map((employee) => {
      const records = (recordsByEmployee[employee.id] || [])
        .filter((record) => String(record.month || '').startsWith(`${selectedYear}-`));
      const totalWorked = records.reduce((sum, record) => sum + Number(record.giornate_effettuate || 0), 0);
      const totalPayroll = records.reduce((sum, record) => sum + Number(record.giornate_busta_paga || 0), 0);

      return {
        employee,
        records,
        totalWorked,
        totalPayroll,
      };
    })
      .filter((row) => row.records.length > 0),
    [employees, recordsByEmployee, selectedYear]
  );

  function buildEmployeePdfHtml(employee, records, totalWorked, totalPayroll) {
    const rowsHtml = records.map((record) => `
      <tr>
        <td style="padding:10px 12px; font-weight:700; color:#1F2937;">${formatMonth(record.month)}</td>
        <td style="padding:10px 12px; color:#334155;">${formatEmployer(record.datore, employee)}</td>
        <td style="padding:10px 12px; color:#334155;">${formatDays(record.giornate_effettuate)}</td>
        <td style="padding:10px 12px; color:#334155;">${formatDays(record.giornate_busta_paga)}</td>
        <td style="padding:10px 12px; color:#334155;">${record.payroll_document ? 'Presente' : 'Nessun allegato'}</td>
      </tr>
    `).join('');

    return `
      <div style="
        font-family:'Avenir Next','Segoe UI',sans-serif;
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
              Buste paga
            </div>
            <div style="margin-top:12px; font-size:24px; font-weight:800; line-height:1.1;">
              ${employee.last_name || ''} ${employee.first_name || ''}
            </div>
            <div style="margin-top:6px; font-size:13px; color:#475569;">
              Codice fiscale: <strong>${employee.fiscal_code || '—'}</strong>
            </div>
          </div>

          <div style="
            min-width:220px;
            border:1px solid rgba(31, 41, 55, 0.10);
            border-radius:18px;
            padding:12px 14px;
            background:linear-gradient(180deg, rgba(255,255,255,0.96), rgba(244,248,243,0.96));
          ">
            <div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#64748b;">
              Totali
            </div>
            <div style="margin-top:8px; font-size:13px; color:#334155;">
              Giornate lavorate: <strong>${formatDays(totalWorked)}</strong>
            </div>
            <div style="margin-top:4px; font-size:13px; color:#334155;">
              Giornate busta paga: <strong>${formatDays(totalPayroll)}</strong>
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
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Mese</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Datore di lavoro</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Giornate lavorate</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Giornate busta paga</th>
                <th style="padding:12px; text-align:left; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#475569; background:#edf4ee; border-bottom:1px solid rgba(31, 41, 55, 0.08);">Allegato</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
              <tr>
                <td style="padding:12px; font-weight:800; color:#1F2937; border-top:1px solid rgba(31, 41, 55, 0.08);">Totale</td>
                <td style="padding:12px; font-weight:800; color:#1F2937; border-top:1px solid rgba(31, 41, 55, 0.08);">—</td>
                <td style="padding:12px; font-weight:800; color:#1F2937; border-top:1px solid rgba(31, 41, 55, 0.08);">${formatDays(totalWorked)}</td>
                <td style="padding:12px; font-weight:800; color:#1F2937; border-top:1px solid rgba(31, 41, 55, 0.08);">${formatDays(totalPayroll)}</td>
                <td style="padding:12px; font-weight:800; color:#1F2937; border-top:1px solid rgba(31, 41, 55, 0.08);">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async function handleGeneratePdf(employee, records, totalWorked, totalPayroll) {
    try {
      await window.api.reports.savePdf({
        fileName: sanitizeFileName(`Buste paga - ${employee.last_name || ''} ${employee.first_name || ''}.pdf`),
        html: buildEmployeePdfHtml(employee, records, totalWorked, totalPayroll),
        landscape: false,
      });
    } catch (error) {
      console.error(error);
      alert('Errore apertura PDF buste paga');
    }
  }

  async function handleOpenAttachment(record) {
    try {
      await window.api.payroll.openDocument(record.employee_id, record.month);
    } catch (error) {
      console.error(error);
      alert('Errore apertura allegato busta paga');
    }
  }

  return (
    <div className="page">
      <div className="page-sticky-stack">
        <section className="page-hero">
          <div>
            <span className="page-kicker">Riepilogo mensile</span>
            <h1 className="page-title">Buste paga</h1>
            <p className="page-subtitle">
              Confronto mese per mese tra giornate lavorate effettive e giornate inserite in busta paga.
            </p>
          </div>

          <div className="page-actions">
            <span className="soft-chip" style={{ background: 'rgba(31, 41, 55, 0.1)', color: '#1F2937', borderColor: 'rgba(31, 41, 55, 0.12)' }}>
              Anno {selectedYear}
            </span>
            <span className="soft-chip" style={{ background: 'rgba(22, 163, 74, 0.12)', color: '#14532d', borderColor: 'rgba(22, 101, 52, 0.14)' }}>
              {employeeRows.length} dipendenti
            </span>
          </div>
        </section>
      </div>

      {loading ? (
        <div className="panel empty-state">Caricamento buste paga...</div>
      ) : !employeeRows.length ? (
        <div className="panel empty-state">Nessun dipendente disponibile.</div>
      ) : (
        <section className="panel panel-section" style={{ padding: 16 }}>
          <div style={{ display: 'grid', gap: 12 }}>
            {employeeRows.map(({ employee, records, totalWorked, totalPayroll }) => (
              <details
                key={employee.id}
                style={{
                  borderRadius: 20,
                  border: '1px solid rgba(20, 33, 61, 0.08)',
                  background: 'rgba(255, 255, 255, 0.9)',
                  overflow: 'hidden',
                }}
              >
                <summary
                  style={{
                    listStyle: 'none',
                    cursor: 'pointer',
                    padding: '16px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>
                      {employee.last_name} {employee.first_name}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13, color: '#667085' }}>
                      {employee.role || 'Nessuna mansione'}{employee.hired_by ? ` · ${employee.hired_by}` : ''}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span className="soft-chip" style={{ background: 'rgba(31, 41, 55, 0.1)', color: '#1F2937', borderColor: 'rgba(31, 41, 55, 0.12)' }}>
                      Lavorate: {formatDays(totalWorked)}
                    </span>
                    <span className="soft-chip" style={{ background: 'rgba(22, 163, 74, 0.12)', color: '#14532d', borderColor: 'rgba(22, 101, 52, 0.14)' }}>
                      Busta paga: {formatDays(totalPayroll)}
                    </span>
                  </div>
                </summary>

                <div style={{ padding: '0 18px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                    <button
                      type="button"
                      className="button"
                      onClick={() => handleGeneratePdf(employee, records, totalWorked, totalPayroll)}
                      disabled={!records.length}
                    >
                      Genera PDF
                    </button>
                  </div>

                  {!records.length ? (
                    <div className="empty-state" style={{ padding: '20px 14px' }}>
                      Nessun mese elaborato per questo dipendente.
                    </div>
                  ) : (
                    <div className="table-shell" style={{ boxShadow: 'none', background: 'rgba(255,255,255,0.8)' }}>
                      <div className="table-scroll">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Mese</th>
                              <th>Datore di lavoro</th>
                              <th>Giornate lavorate</th>
                              <th>Giornate busta paga</th>
                              <th>Allegato</th>
                            </tr>
                          </thead>
                          <tbody>
                            {records.map((record) => (
                              <tr key={`${employee.id}-${record.month}`}>
                                <td>{formatMonth(record.month)}</td>
                                <td>{formatEmployer(record.datore, employee)}</td>
                                <td>{formatDays(record.giornate_effettuate)}</td>
                                <td>{formatDays(record.giornate_busta_paga)}</td>
                                <td>
                                  {record.payroll_document ? (
                                    <button
                                      type="button"
                                      className="button-secondary"
                                      onClick={() => handleOpenAttachment(record)}
                                      style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}
                                      title={record.payroll_document.file_name || 'Apri allegato busta paga'}
                                    >
                                      Apri allegato
                                    </button>
                                  ) : (
                                    <span style={{ color: '#667085', fontSize: 12 }}>
                                      {getAttachmentLabel(record)}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                            <tr>
                              <td style={{ fontWeight: 800 }}>Totale</td>
                              <td style={{ fontWeight: 800 }}>—</td>
                              <td style={{ fontWeight: 800 }}>{formatDays(totalWorked)}</td>
                              <td style={{ fontWeight: 800 }}>{formatDays(totalPayroll)}</td>
                              <td style={{ fontWeight: 800 }}>—</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
