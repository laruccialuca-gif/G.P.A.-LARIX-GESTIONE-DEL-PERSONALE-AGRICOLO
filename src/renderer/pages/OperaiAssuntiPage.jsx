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

export default function OperaiAssuntiPage() {
  const [employees, setEmployees] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterDatore, setFilterDatore] = useState('TUTTI');
  const [busyId, setBusyId] = useState(null);

  async function loadEmployees() {
    setLoading(true);
    try {
      const [data, settingsData] = await Promise.all([
        window.api.employees.list(),
        window.api.settings.get(),
      ]);
      setEmployees(data || []);
      setSettings(settingsData || null);
    } catch (err) {
      console.error(err);
      alert('Errore caricamento operai assunti');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEmployees();
  }, []);

  const filtered = useMemo(() => {
    return employees
      .filter((employee) => {
        if (filterDatore === 'TUTTI') return true;
        return (employee.hired_by || '') === filterDatore;
      })
      .sort((a, b) => {
        const last = String(a.last_name || '').localeCompare(String(b.last_name || ''));
        if (last !== 0) return last;
        return String(a.first_name || '').localeCompare(String(b.first_name || ''));
      });
  }, [employees, filterDatore]);
  const employerOptions = settings?.employer_options || [
    { short_name: 'LC', name: 'Laruccia Cosimo' },
    { short_name: 'LG', name: 'Laruccia Giuseppe' },
  ];

  function buildPrintHtml() {
    const printDate = new Date().toLocaleDateString('it-IT');
    const rows = filtered.map((employee) => `
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
              ${settings?.company?.document_header || settings?.company?.name || 'Gestionale Presenze'}
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
              Riepilogo stampa
            </div>
            <div style="margin-top:8px; font-size:13px; color:#334155;">
              Filtro datore: <strong>${filterDatore}</strong>
            </div>
            <div style="margin-top:4px; font-size:13px; color:#334155;">
              Stampato il: <strong>${printDate}</strong>
            </div>
            <div style="margin-top:4px; font-size:13px; color:#334155;">
              Operai inclusi: <strong>${filtered.length}</strong>
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

  async function handleSavePdf() {
    try {
      await window.api.reports.savePdf({
        fileName: sanitizeFileName(`Operai assunti - ${filterDatore}.pdf`),
        html: buildPrintHtml(),
        landscape: false,
      });
    } catch (err) {
      console.error(err);
      alert('Errore apertura PDF');
    }
  }

  async function handlePrint() {
    try {
      await window.api.reports.printHtml({
        fileName: sanitizeFileName(`Operai assunti - ${filterDatore}.pdf`),
        html: buildPrintHtml(),
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
        await loadEmployees();
      }
    } catch (err) {
      console.error(err);
      alert('Errore caricamento allegato assunzione');
    } finally {
      setBusyId(null);
    }
  }

  async function handleOpen(employeeId) {
    try {
      const result = await window.api.employees.openHireDocument(employeeId);
      if (result && !result.success && result.message) {
        alert(result.message);
      }
    } catch (err) {
      console.error(err);
      alert('Errore apertura allegato');
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
      await loadEmployees();
    } catch (err) {
      console.error(err);
      alert(getIpcRecoveryMessage(err, 'Errore eliminazione allegato'));
    }
  }

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
            <button className="button-secondary" onClick={handlePrint}>Stampa</button>
            <button className="button" onClick={handleSavePdf}>Genera PDF</button>
          </div>
        </section>

        <div className="toolbar">
          <div className="toolbar-group">
            <select
              value={filterDatore}
              onChange={(e) => setFilterDatore(e.target.value)}
              style={{ minWidth: 220 }}
            >
              <option value="TUTTI">Tutti</option>
              {employerOptions.map((option) => (
                <option key={option.short_name} value={option.short_name}>
                  {option.short_name} · {option.name}
                </option>
              ))}
              <option value="ENTRAMBE">ENTRAMBE</option>
            </select>
          </div>

          <div className="toolbar-group">
            <span
              className="soft-chip"
              style={{
                background: 'rgba(22, 163, 74, 0.12)',
                color: '#14532d',
                borderColor: 'rgba(22, 101, 52, 0.14)',
              }}
            >
              {filtered.length} operai
            </span>
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
                  <th style={th}>Operaio</th>
                  <th style={th}>Mansione</th>
                  <th style={th}>Data da</th>
                  <th style={th}>Data a</th>
                  <th style={th}>Assunto da</th>
                  <th style={th}>Stato</th>
                  <th style={th}>Documento assunzione</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((employee) => (
                  <tr key={employee.id}>
                    <td style={td}>{employee.last_name} {employee.first_name}</td>
                    <td style={td}>{employee.role || '—'}</td>
                    <td style={td}>{formatDisplayDate(employee.hire_date_from)}</td>
                    <td style={td}>{formatDisplayDate(employee.hire_date_to)}</td>
                    <td style={td}>{employee.hired_by || '—'}</td>
                    <td style={td}>{employee.status || '—'}</td>
                    <td style={{ ...td, minWidth: 220 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className={employee.hire_document ? 'button-secondary' : 'button'}
                          style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }}
                          onClick={() => handleUpload(employee.id)}
                          disabled={busyId === employee.id}
                        >
                          {busyId === employee.id
                            ? 'Caricamento...'
                            : employee.hire_document
                            ? 'Sostituisci PDF'
                            : 'Aggiungi PDF'}
                        </button>

                        {employee.hire_document ? (
                          <>
                            <button
                              type="button"
                              className="button-secondary"
                              style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }}
                              onClick={() => handleOpen(employee.id)}
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
