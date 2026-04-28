import { useState, useEffect } from 'react';

const STATUS_LABELS = {
  nuovo: { label: 'Nuovo', color: '#16a34a', bg: '#dcfce7' },
  esistente: { label: 'Esistente', color: '#1d4ed8', bg: '#dbeafe' },
  da_verificare: { label: 'Da verificare', color: '#d97706', bg: '#fef3c7' },
  già_presente: { label: 'Già in archivio', color: '#6b7280', bg: '#f3f4f6' },
};

function StatusBadge({ status }) {
  const s = STATUS_LABELS[status] || STATUS_LABELS.da_verificare;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, borderRadius: 4, padding: '2px 7px',
      color: s.color, background: s.bg, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

function DatoreToggle({ value, onChange }) {
  const opts = [
    { val: 'LC', label: 'LC' },
    { val: 'LG', label: 'LG' },
    { val: 'entrambi', label: 'Ent.' },
  ];
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {opts.map((opt) => (
        <button
          key={opt.val}
          onClick={() => onChange(opt.val)}
          style={{
            padding: '2px 7px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: '1px solid',
            borderColor: value === opt.val ? '#2563eb' : '#d1d5db',
            background: value === opt.val ? '#2563eb' : '#f9fafb',
            color: value === opt.val ? '#fff' : '#374151',
            fontWeight: value === opt.val ? 700 : 400,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function EditableCell({ value, onChange, placeholder, minWidth }) {
  return (
    <input
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder || '—'}
      style={{
        width: '100%', minWidth: minWidth || 80, border: '1px solid #e5e7eb', borderRadius: 4,
        padding: '2px 6px', fontSize: 12, background: '#fff',
        fontFamily: 'inherit',
      }}
    />
  );
}

function toIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parts = raw.split(/[\/\-\.]/);
  if (parts.length === 3 && parts[0].length === 2) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return raw;
}

function getHireYear(value) {
  const iso = toIsoDate(value);
  const year = Number(String(iso).slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

export default function PdfImportModal({ open, onClose, onConfirm, records }) {
  const [rows, setRows] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    if (!open) {
      setResults(null);
      setConfirming(false);
      return;
    }
    setRows(
      (records || []).map((r, idx) => ({
        _key: idx,
        selected: !r.parse_warnings?.includes('Codice fiscale non trovato') && !r.year_mismatch && r.status !== 'già_presente',
        first_name: r.first_name || '',
        last_name: r.last_name || '',
        fiscal_code: r.fiscal_code || '',
        hire_date_from: r.hire_date_from || '',
        hire_date_to: r.hire_date_to || '',
        hired_by: r.hired_by_detected || 'LG',
        status: r.status || 'da_verificare',
        import_action: r.import_action || (r.existing_employee_id ? 'esistente' : 'nuovo'),
        existing_employee_id: r.existing_employee_id || null,
        existing_name: r.existing_name || null,
        existing_is_deleted: r.existing_is_deleted || false,
        restored: false,
        parse_warnings: r.parse_warnings || [],
        hire_year: r.hire_year || null,
        target_year: r.target_year || new Date().getFullYear(),
        year_mismatch: !!r.year_mismatch,
        year_warning: r.year_warning || '',
        page_index: r.page_index ?? idx,
      }))
    );
  }, [open, records]);

  if (!open) return null;

  const selectedCount = rows.filter((r) => r.selected).length;

  function updateRow(key, field, value) {
    setRows((prev) => prev.map((r) => {
      if (r._key !== key) return r;
      const next = { ...r, [field]: value };
      if (field === 'hire_date_from') {
        const hireYear = getHireYear(value);
        const yearMismatch = hireYear !== null && hireYear < next.target_year;
        next.hire_year = hireYear;
        next.year_mismatch = yearMismatch;
        next.year_warning = yearMismatch
          ? `Assunzione riferita all'anno ${hireYear}, non all'anno corrente ${next.target_year}`
          : '';
        if (yearMismatch) {
          next.status = 'da_verificare';
          next.selected = false;
        } else {
          next.status = next.import_action === 'esistente' ? 'esistente' : 'nuovo';
        }
      }
      return next;
    }));
  }

  function applyDatoreToAll(datore) {
    setRows((prev) => prev.map((r) => r.selected ? { ...r, hired_by: datore } : r));
  }

  function toggleSelectAll() {
    const allSelected = rows.every((r) => r.selected);
    setRows((prev) => prev.map((r) => ({ ...r, selected: !allSelected })));
  }

  async function handleRestore(rowKey) {
    const row = rows.find((r) => r._key === rowKey);
    if (!row || !row.existing_employee_id) return;
    try {
      await window.api.employees.restore(row.existing_employee_id);
      setRows((prev) => prev.map((r) =>
        r._key === rowKey ? { ...r, restored: true, selected: false } : r
      ));
    } catch (err) {
      alert(`Errore ripristino: ${err.message}`);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      const res = await onConfirm(rows);
      setResults(res);
    } catch (err) {
      setResults([{ action: 'errore', error: err.message }]);
    } finally {
      setConfirming(false);
    }
  }

  if (results) {
    const created = results.filter((r) => r.action === 'creato').length;
    const updated = results.filter((r) => r.action === 'aggiornato').length;
    const errors = results.filter((r) => r.action === 'errore');
    return (
      <div className="modal-overlay">
        <div className="modal-dialog" style={{ maxWidth: 560 }}>
          <div className="modal-header">
            <div>
              <span className="page-kicker">Importazione PDF</span>
              <h2 style={{ margin: '6px 0 0' }}>Importazione completata</h2>
            </div>
            <button type="button" className="modal-close" onClick={onClose}>✕</button>
          </div>
          <div className="panel panel-section" style={{ padding: 20, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {created > 0 ? <span className="soft-chip" style={{ background: '#dcfce7', color: '#166534' }}>Creati: {created}</span> : null}
              {updated > 0 ? <span className="soft-chip" style={{ background: '#dbeafe', color: '#1d4ed8' }}>Aggiornati: {updated}</span> : null}
              {errors.length > 0 ? <span className="soft-chip" style={{ background: '#fee2e2', color: '#b91c1c' }}>Errori: {errors.length}</span> : null}
            </div>
            {errors.length ? (
              <div style={{ display: 'grid', gap: 6 }}>
                {errors.map((e, i) => (
                  <div key={i} style={{ color: '#b91c1c', fontSize: 13 }}>
                    {e.fiscal_code || 'N/D'}: {e.error}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: '#52606d', fontSize: 14 }}>
                Operazione completata correttamente. Puoi chiudere questa finestra e continuare a lavorare.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button type="button" className="button" onClick={onClose}>
              Chiudi
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal-dialog" style={{ width: 'min(1440px, 96vw)', maxHeight: 'min(94vh, 1080px)', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div>
            <span className="page-kicker">Importazione guidata</span>
            <h2 style={{ margin: '6px 0 0' }}>Importa da PDF assunzioni</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="toolbar" style={{ marginBottom: 16, padding: '14px 18px' }}>
          <div className="toolbar-group">
            <span className="soft-chip" style={{ background: 'rgba(15, 118, 110, 0.12)', color: '#115e59' }}>
              {selectedCount} selezionati su {rows.length}
            </span>
            <span className="soft-chip" style={{ background: 'rgba(20, 33, 61, 0.06)', color: '#314762' }}>
              Controlla i dati prima della conferma
            </span>
          </div>
          <div className="toolbar-group">
            <span style={{ fontSize: 12, color: '#667085', fontWeight: 700 }}>Applica datore:</span>
            {['LC', 'LG', 'entrambi'].map((d) => (
              <button key={d} type="button" className="button-secondary" style={compactButtonStyle} onClick={() => applyDatoreToAll(d)}>
                {d === 'entrambi' ? 'Entrambi' : d}
              </button>
            ))}
            <button type="button" className="button-secondary" style={compactButtonStyle} onClick={toggleSelectAll}>
              {rows.every((r) => r.selected) ? 'Deseleziona tutto' : 'Seleziona tutto'}
            </button>
          </div>
        </div>

        <div className="panel panel-section" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid rgba(20, 33, 61, 0.08)' }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Anteprima dati estratti</div>
            <div style={{ fontSize: 13, color: '#667085', marginTop: 4 }}>
              Rivedi anagrafica, codice fiscale, date e datore prima di importare.
            </div>
          </div>

          <div className="table-shell" style={{ border: 0, borderRadius: 0, boxShadow: 'none', background: 'transparent', flex: 1, minHeight: 0 }}>
            <div className="table-scroll" style={{ maxHeight: 'min(58vh, 660px)', overflowX: 'auto', overflowY: 'auto' }}>
              <table className="table" style={{ fontSize: 12, minWidth: 1320, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 185 }} />
                  <col style={{ width: 118 }} />
                  <col style={{ width: 118 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 225 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={thStyle}></th>
                    <th style={thStyle}>Cognome</th>
                    <th style={thStyle}>Nome</th>
                    <th style={thStyle}>Cod. Fiscale</th>
                    <th style={thStyle}>Inizio</th>
                    <th style={thStyle}>Fine</th>
                    <th style={thStyle}>Anno</th>
                    <th style={thStyle}>Datore</th>
                    <th style={thStyle}>Stato</th>
                    <th style={thStyle}>Avviso anno</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row._key} style={{ background: row.selected ? 'rgba(255,255,255,0.92)' : 'rgba(244, 248, 248, 0.76)', opacity: row.selected ? 1 : 0.7 }}>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <input type="checkbox" checked={row.selected} onChange={(e) => updateRow(row._key, 'selected', e.target.checked)} />
                      </td>
                      <td style={tdStyle}>
                        <EditableCell value={row.last_name} onChange={(v) => updateRow(row._key, 'last_name', v)} placeholder="Cognome" minWidth={120} />
                      </td>
                      <td style={tdStyle}>
                        <EditableCell value={row.first_name} onChange={(v) => updateRow(row._key, 'first_name', v)} placeholder="Nome" minWidth={110} />
                      </td>
                      <td style={tdStyle}>
                        <EditableCell value={row.fiscal_code} onChange={(v) => updateRow(row._key, 'fiscal_code', v.toUpperCase())} placeholder="CF" minWidth={165} />
                        {row.parse_warnings.map((w, i) => (
                          <div key={i} style={{ color: '#d97706', fontSize: 10, marginTop: 2, whiteSpace: 'normal', lineHeight: 1.3 }}>⚠ {w}</div>
                        ))}
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        <EditableCell value={row.hire_date_from} onChange={(v) => updateRow(row._key, 'hire_date_from', v)} placeholder="gg/mm/aaaa" minWidth={100} />
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        <EditableCell value={row.hire_date_to} onChange={(v) => updateRow(row._key, 'hire_date_to', v)} placeholder="—" minWidth={100} />
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, color: '#334155', fontSize: 13 }}>
                          {row.hire_year || '—'}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <DatoreToggle value={row.hired_by} onChange={(v) => updateRow(row._key, 'hired_by', v)} />
                      </td>
                      <td style={tdStyle}>
                        {row.restored
                          ? <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>✓ Ripristinato</span>
                          : <StatusBadge status={row.status} />
                        }
                        {row.status === 'già_presente' && !row.restored && (
                          <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <div style={{ fontSize: 10, color: '#6b7280', whiteSpace: 'normal', lineHeight: 1.4 }}>
                              {row.existing_is_deleted
                                ? 'Dipendente archiviato con le stesse date'
                                : 'Dipendente già presente in archivio con le stesse date'}
                            </div>
                            {row.existing_is_deleted && (
                              <button
                                type="button"
                                onClick={() => handleRestore(row._key)}
                                style={{
                                  marginTop: 2, padding: '3px 8px', fontSize: 11, fontWeight: 700,
                                  borderRadius: 4, cursor: 'pointer', border: '1px solid #16a34a',
                                  background: '#f0fdf4', color: '#15803d',
                                  alignSelf: 'flex-start',
                                }}
                              >
                                Ripristina dall&apos;archivio
                              </button>
                            )}
                          </div>
                        )}
                        {row.status !== 'già_presente' && row.existing_name && (
                          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3, whiteSpace: 'normal', lineHeight: 1.4 }}>
                            {row.existing_is_deleted ? '(archiviato) ' : ''}{row.existing_name}
                          </div>
                        )}
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'normal' }}>
                        {row.year_mismatch ? (
                          <div style={{ display: 'grid', gap: 3 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706' }}>
                              Da verificare
                            </span>
                            <span style={{ fontSize: 11, color: '#92400e', lineHeight: 1.4 }}>
                              {row.year_warning}
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: '#166534', fontWeight: 700 }}>
                            Anno coerente con {row.target_year}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {rows.length === 0 && (
            <div className="empty-state" style={{ padding: 32 }}>Nessun dipendente trovato nel PDF</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 18, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#667085' }}>
            Le righe fuori anno vengono deselezionate automaticamente e restano importabili solo con conferma manuale.
          </span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="button-secondary" onClick={onClose}>
              Annulla
            </button>
            <button
              type="button"
              className="button"
              onClick={handleConfirm}
              disabled={selectedCount === 0 || confirming}
            >
              {confirming ? (
                <>
                  <span style={spinnerStyle} />
                  Importazione in corso...
                </>
              ) : (
                `Conferma importazione (${selectedCount})`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const compactButtonStyle = {
  minHeight: 36,
  padding: '0 14px',
  fontSize: 12,
};

const spinnerStyle = {
  width: 16,
  height: 16,
  borderRadius: '50%',
  border: '2px solid rgba(255, 255, 255, 0.35)',
  borderTopColor: '#ffffff',
  display: 'inline-block',
  animation: 'spin 0.8s linear infinite',
};

const thStyle = {
  padding: '10px 12px',
  textAlign: 'left',
  fontWeight: 800,
  color: '#314762',
  fontSize: 11,
  borderBottom: '1px solid rgba(20, 33, 61, 0.08)',
  background: '#eef5f4',
  position: 'sticky',
  top: 0,
  zIndex: 1,
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '10px 12px',
  verticalAlign: 'top',
  borderBottom: '1px solid rgba(20, 33, 61, 0.06)',
};
