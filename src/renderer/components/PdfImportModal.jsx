import { useState, useEffect, useRef, Fragment } from 'react';

const STATUS_LABELS = {
  pronto: { label: 'Pronto', color: '#166534', bg: '#dcfce7' },
  da_correggere: { label: 'Da correggere', color: '#b45309', bg: '#fef3c7' },
  duplicato: { label: 'Duplicato', color: '#92400e', bg: '#fde68a' },
  nuovo_rapporto_datore: { label: 'Nuovo rapporto datore', color: '#1d4ed8', bg: '#dbeafe' },
  già_presente: { label: 'Già in archivio', color: '#6b7280', bg: '#f3f4f6' },
};

function StatusBadge({ status }) {
  const s = STATUS_LABELS[status] || { label: status || '—', color: '#6b7280', bg: '#f3f4f6' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, borderRadius: 4, padding: '2px 7px',
      color: s.color, background: s.bg, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

function DatoreToggle({ value, onChange, employerOptions = [] }) {
  const opts = [
    ...employerOptions.map((option) => ({ val: option.short_name || option.value, label: option.short_name || option.value })),
    ...(employerOptions.length > 1 ? [{ val: 'entrambi', label: 'Ent.' }] : []),
  ];
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
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

function normalizeRowForEvaluation(row) {
  return {
    ...row,
    first_name: String(row.first_name || '').trim(),
    last_name: String(row.last_name || '').trim(),
    fiscal_code: String(row.fiscal_code || '').replace(/\s+/g, '').toUpperCase(),
    hired_by: String(row.hired_by || '').trim(),
    hire_date_from: String(row.hire_date_from || '').trim(),
    hire_date_to: String(row.hire_date_to || '').trim(),
  };
}

export default function PdfImportModal({
  open,
  onClose,
  onConfirm,
  records,
  employerOptions = [],
  pdfEmployer = null,
  initialEmployerResolution = null,
}) {
  const [rows, setRows] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [resolvingEmployer, setResolvingEmployer] = useState(false);
  const [employerResolution, setEmployerResolution] = useState(initialEmployerResolution || null);
  const [selectedEmployerShortName, setSelectedEmployerShortName] = useState('');
  const recheckTimerRef = useRef(null);
  const [expandedTextKeys, setExpandedTextKeys] = useState(new Set());

  useEffect(() => {
    if (!open) {
      setResults(null);
      setConfirming(false);
      setEvaluating(false);
      setResolvingEmployer(false);
      setEmployerResolution(initialEmployerResolution || null);
      setSelectedEmployerShortName('');
      setExpandedTextKeys(new Set());
      if (recheckTimerRef.current) {
        clearTimeout(recheckTimerRef.current);
        recheckTimerRef.current = null;
      }
      return;
    }
    setRows(
      (records || []).map((r, idx) => ({
        _key: idx,
        selected: !!r.selected,
        first_name: r.first_name || '',
        last_name: r.last_name || '',
        fiscal_code: r.fiscal_code || '',
        hire_date_from: r.hire_date_from || '',
        hire_date_to: r.hire_date_to || '',
        hired_by: r.hired_by || r.hired_by_detected || '',
        hired_by_detected: r.hired_by_detected || '',
        status: r.status || 'da_verificare',
        import_action: r.import_action || (r.existing_employee_id ? 'esistente' : 'nuovo'),
        existing_employee_id: r.existing_employee_id || null,
        existing_name: r.existing_name || null,
        existing_is_deleted: r.existing_is_deleted || false,
        restored: false,
        parse_warnings: r.parse_warnings || [],
        correction_reasons: r.correction_reasons || [],
        hire_year: r.hire_year || null,
        target_year: r.target_year || new Date().getFullYear(),
        year_mismatch: !!r.year_mismatch,
        year_warning: r.year_warning || '',
        page_index: r.page_index ?? idx,
        page_numbers: Array.isArray(r.page_numbers) ? r.page_numbers : [],
        parse_model: r.parse_model || '',
        parser_uncertain_reason: r.parser_uncertain_reason || '',
        birth_date: r.birth_date || '',
        tipo_lavorazione: r.tipo_lavorazione || '',
        giornate_previste: r.giornate_previste || '',
        original_text: r.original_text || '',
      }))
    );
    setEmployerResolution(initialEmployerResolution || null);
    setSelectedEmployerShortName(initialEmployerResolution?.employer_short_name || employerOptions[0]?.short_name || employerOptions[0]?.value || '');
  }, [open, records]);

  useEffect(() => {
    setEmployerResolution(initialEmployerResolution || null);
    setSelectedEmployerShortName(initialEmployerResolution?.employer_short_name || employerOptions[0]?.short_name || employerOptions[0]?.value || '');
  }, [initialEmployerResolution, employerOptions]);

  useEffect(() => () => {
    if (recheckTimerRef.current) {
      clearTimeout(recheckTimerRef.current);
      recheckTimerRef.current = null;
    }
  }, []);

  const isEmployerResolved = employerResolution?.status === 'matched' || employerResolution?.status === 'mapped';
  const currentEmployerOptions = employerResolution?.employer_options || employerOptions;

  const selectedCount = rows.filter((r) => r.selected && (r.status === 'pronto' || r.status === 'nuovo_rapporto_datore')).length;
  const readyCount = rows.filter((r) => r.status === 'pronto' || r.status === 'nuovo_rapporto_datore').length;
  const correctionCount = rows.filter((r) => r.status === 'da_correggere' || r.status === 'duplicato').length;

  if (!open) return null;

  function applyResolvedEmployer(nextResolution) {
    if (!nextResolution?.employer_short_name) return;
    setRows((prev) => {
      const nextRows = prev.map((row) => ({
        ...row,
        hired_by: row.hired_by || nextResolution.employer_short_name,
      }));
      scheduleReevaluation(nextRows);
      return nextRows;
    });
  }

  function scheduleReevaluation(nextRows) {
    if (recheckTimerRef.current) {
      clearTimeout(recheckTimerRef.current);
    }
    recheckTimerRef.current = setTimeout(async () => {
      setEvaluating(true);
      try {
        const evaluated = await window.api.employees.evaluatePdfImportRows({
          rows: nextRows.map(normalizeRowForEvaluation),
          targetYear: nextRows[0]?.target_year,
        });
        setRows((prev) => evaluated.map((row, index) => ({
          ...prev[index],
          ...row,
          hired_by_detected: prev[index]?.hired_by_detected || '',
          original_text: prev[index]?.original_text || '',
          selected:
            row.status === 'pronto' || row.status === 'nuovo_rapporto_datore'
              ? !!prev[index]?.selected
              : false,
          restored: prev[index]?.restored || false,
          _key: prev[index]?._key ?? index,
        })));
      } catch (err) {
        console.error(err);
      } finally {
        setEvaluating(false);
      }
    }, 220);
  }

  function updateRow(key, field, value) {
    setRows((prev) => {
      const nextRows = prev.map((r) => {
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
            next.status = 'pronto';
          }
        }
        return next;
      });
      scheduleReevaluation(nextRows);
      return nextRows;
    });
  }

  function retryCfFromText(rowKey) {
    const row = rows.find((r) => r._key === rowKey);
    if (!row || !row.original_text) return;
    const match = row.original_text.toUpperCase().match(/[A-Z]{6}\s*[0-9]{2}\s*[A-Z]\s*[0-9]{2}\s*[A-Z]\s*[0-9]{3}\s*[A-Z]/);
    if (match) {
      updateRow(rowKey, 'fiscal_code', match[0].replace(/\s+/g, ''));
    }
  }

  function toggleTextExpanded(key) {
    setExpandedTextKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function applyDatoreToAll(datore) {
    setRows((prev) => {
      const nextRows = prev.map((r) => r.selected ? { ...r, hired_by: datore } : r);
      scheduleReevaluation(nextRows);
      return nextRows;
    });
  }

  async function handleResolveEmployer(action) {
    if (!pdfEmployer) return;
    try {
      setResolvingEmployer(true);
      const payload = {
        action,
        pdfEmployer,
        employerShortName: selectedEmployerShortName,
      };
      const nextResolution = await window.api.employees.resolvePdfEmployer(payload);
      setEmployerResolution(nextResolution);
      applyResolvedEmployer(nextResolution);
    } catch (err) {
      alert(`Errore associazione datore: ${err.message}`);
    } finally {
      setResolvingEmployer(false);
    }
  }

  function toggleSelectAll() {
    const readyRows = rows.filter((r) => r.status === 'pronto' || r.status === 'nuovo_rapporto_datore');
    const allSelected = readyRows.length > 0 && readyRows.every((r) => r.selected);
    setRows((prev) => prev.map((r) => ({
      ...r,
      selected: (r.status === 'pronto' || r.status === 'nuovo_rapporto_datore') ? !allSelected : false,
    })));
  }

  async function handleRestore(rowKey) {
    const row = rows.find((r) => r._key === rowKey);
    if (!row || !row.existing_employee_id) return;
    try {
      await window.api.employees.restore(row.existing_employee_id);
      setRows((prev) => {
        const nextRows = prev.map((r) =>
          r._key === rowKey ? { ...r, restored: true, selected: false } : r
        );
        scheduleReevaluation(nextRows);
        return nextRows;
      });
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
      <div className="modal-dialog pdf-import-dialog" style={{ width: 'min(1440px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="modal-header">
          <div>
            <span className="page-kicker">Importazione guidata</span>
            <h2 style={{ margin: '6px 0 0' }}>Importa da PDF assunzioni</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="pdf-import-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div className="toolbar pdf-import-toolbar" style={{ marginBottom: 16, padding: '14px 18px', flexShrink: 0 }}>
            <div className="toolbar-group pdf-import-toolbar-group">
              <span className="soft-chip" style={{ background: 'rgba(20, 33, 61, 0.06)', color: '#314762' }}>
                {rows.length} rilevati
              </span>
              <span className="soft-chip" style={{ background: 'rgba(15, 118, 110, 0.12)', color: '#115e59' }}>
                {readyCount} pronti · {selectedCount} selezionati
              </span>
              {correctionCount > 0 ? (
                <span className="soft-chip" style={{ background: '#fff4db', color: '#92400e' }}>
                  {correctionCount} da correggere
                </span>
              ) : null}
              <span className="soft-chip" style={{ background: 'rgba(37, 99, 235, 0.12)', color: '#1d4ed8' }}>
                {evaluating ? 'Rivalutazione in corso...' : `Modello: ${[...new Set(rows.map((row) => row.parse_model).filter(Boolean))].join(', ') || 'n/d'}`}
              </span>
            </div>
            <div className="toolbar-group pdf-import-toolbar-group">
              <span style={{ fontSize: 12, color: '#667085', fontWeight: 700 }}>Applica datore:</span>
              {[
                ...currentEmployerOptions.map((option) => option.short_name || option.value),
                ...(currentEmployerOptions.length > 1 ? ['entrambi'] : []),
              ].map((d) => (
                <button key={d} type="button" className="button-secondary" style={compactButtonStyle} onClick={() => applyDatoreToAll(d)}>
                  {d === 'entrambi' ? 'Entrambi' : d}
                </button>
              ))}
              <button type="button" className="button-secondary" style={compactButtonStyle} onClick={toggleSelectAll}>
                {rows.every((r) => r.selected) ? 'Deseleziona tutto' : 'Seleziona tutto'}
              </button>
            </div>
          </div>

          {employerResolution?.status === 'mismatch' && (
            <div className="panel panel-section" style={{ marginBottom: 16, padding: 16, display: 'grid', gap: 12, background: '#fff8e8', border: '1px solid rgba(180, 83, 9, 0.18)', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#92400e' }}>
                  Il datore indicato nel PDF non corrisponde ai datori configurati nel gestionale.
                </div>
                <div style={{ fontSize: 13, color: '#7c2d12', marginTop: 6 }}>
                  Scegli come associare il datore prima di importare. Nessun dipendente verrà salvato finché non completi questa scelta.
                </div>
              </div>
              <div style={{ display: 'grid', gap: 4, fontSize: 13, color: '#374151' }}>
                <div><strong>Datore PDF:</strong> {pdfEmployer?.name || '—'}</div>
                <div><strong>CF/P.IVA PDF:</strong> {pdfEmployer?.tax_id || '—'}</div>
                <div><strong>Sede lavoro PDF:</strong> {pdfEmployer?.workplace || '—'}</div>
                <div><strong>Datori attuali del gestionale:</strong> {currentEmployerOptions.map((option) => option.short_name || option.value).join(', ') || 'nessuno'}</div>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={selectedEmployerShortName}
                    onChange={(event) => setSelectedEmployerShortName(event.target.value)}
                    style={{ minWidth: 220, minHeight: 38, borderRadius: 8, border: '1px solid #d0d5dd', padding: '0 12px', background: '#fff' }}
                  >
                    {currentEmployerOptions.map((option) => (
                      <option key={option.short_name || option.value} value={option.short_name || option.value}>
                        {(option.short_name || option.value)} · {option.name || option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={!selectedEmployerShortName || resolvingEmployer}
                    onClick={() => handleResolveEmployer('associate_existing')}
                  >
                    Associa a datore esistente
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={resolvingEmployer}
                    onClick={() => handleResolveEmployer('create_new')}
                  >
                    Aggiungi come nuovo datore
                  </button>
                  <button type="button" className="button-secondary" onClick={onClose}>
                    Annulla import
                  </button>
                </div>
              </div>
            </div>
          )}

          {isEmployerResolved && employerResolution?.employer_short_name ? (
            <div className="panel panel-section" style={{ marginBottom: 16, padding: 14, display: 'grid', gap: 6, background: '#effaf6', border: '1px solid rgba(22, 101, 52, 0.12)', flexShrink: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#166534' }}>
                Datore PDF associato a {employerResolution.employer_short_name} · {employerResolution.employer_name}
              </div>
              <div style={{ fontSize: 12, color: '#166534' }}>
                Datore PDF: {pdfEmployer?.name || '—'} {pdfEmployer?.tax_id ? `· ${pdfEmployer.tax_id}` : ''}
              </div>
            </div>
          ) : null}

          <div className="panel panel-section" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid rgba(20, 33, 61, 0.08)', flexShrink: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Anteprima dati estratti</div>
              <div style={{ fontSize: 13, color: '#667085', marginTop: 4 }}>
                Rivedi tutti i record rilevati. Le righe arancioni richiedono correzione prima dell&apos;import.
              </div>
            </div>

            <div className="table-shell pdf-import-table-shell" style={{ border: 0, borderRadius: 0, boxShadow: 'none', background: 'transparent', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <div className="table-scroll pdf-import-table-scroll" style={{ flex: 1, minHeight: 0, maxHeight: 'none', overflowX: 'auto', overflowY: 'auto', paddingBottom: 12 }}>
                <table className="table pdf-import-table" style={{ fontSize: 12, minWidth: 1280, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 36 }} />
                  <col style={{ width: 40 }} />
                  <col style={{ width: 115 }} />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 190 }} />
                  <col style={{ width: 95 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 108 }} />
                  <col style={{ width: 108 }} />
                  <col style={{ width: 218 }} />
                  <col style={{ width: 60 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}></th>
                    <th style={thStyle}>Stato</th>
                    <th style={thStyle}>Cognome</th>
                    <th style={thStyle}>Nome</th>
                    <th style={thStyle}>Cod. Fiscale</th>
                    <th style={thStyle}>Datore PDF</th>
                    <th style={thStyle}>Datore</th>
                    <th style={thStyle}>Inizio</th>
                    <th style={thStyle}>Fine</th>
                    <th style={thStyle}>Motivo / avviso</th>
                    <th style={thStyle}>Testo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIdx) => {
                    const isCorrection = row.status === 'da_correggere' || row.status === 'duplicato';
                    const rowBg = isCorrection
                      ? 'rgba(254, 243, 199, 0.6)'
                      : row.selected ? 'rgba(255,255,255,0.92)' : 'rgba(244, 248, 248, 0.76)';
                    const textExpanded = expandedTextKeys.has(row._key);
                    return (
                      <Fragment key={row._key}>
                        <tr style={{ background: rowBg }}>
                          <td style={{ ...tdStyle, textAlign: 'center', color: '#9ca3af', fontSize: 11, fontWeight: 600 }}>
                            {rowIdx + 1}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={row.selected}
                              disabled={!(row.status === 'pronto' || row.status === 'nuovo_rapporto_datore')}
                              onChange={(e) => updateRow(row._key, 'selected', e.target.checked)}
                            />
                          </td>
                          <td style={tdStyle}>
                            {row.restored
                              ? <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>✓ Ripristinato</span>
                              : <StatusBadge status={row.status} />
                            }
                            {row.status === 'già_presente' && !row.restored && row.existing_is_deleted && (
                              <button
                                type="button"
                                onClick={() => handleRestore(row._key)}
                                style={{ marginTop: 4, padding: '2px 7px', fontSize: 11, fontWeight: 700, borderRadius: 4, cursor: 'pointer', border: '1px solid #16a34a', background: '#f0fdf4', color: '#15803d', display: 'block' }}
                              >
                                Ripristina
                              </button>
                            )}
                            {row.status === 'già_presente' && !row.restored && !row.existing_is_deleted && (
                              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3, lineHeight: 1.4 }}>
                                {row.existing_name}
                              </div>
                            )}
                            {row.parse_model ? (
                              <div style={{ fontSize: 10, color: '#1d4ed8', marginTop: 3, lineHeight: 1.4 }}>
                                {row.parse_model}
                              </div>
                            ) : null}
                          </td>
                          <td style={tdStyle}>
                            <EditableCell value={row.last_name} onChange={(v) => updateRow(row._key, 'last_name', v)} placeholder="Cognome" minWidth={120} />
                          </td>
                          <td style={tdStyle}>
                            <EditableCell value={row.first_name} onChange={(v) => updateRow(row._key, 'first_name', v)} placeholder="Nome" minWidth={100} />
                          </td>
                          <td style={tdStyle}>
                            <EditableCell value={row.fiscal_code} onChange={(v) => updateRow(row._key, 'fiscal_code', v.toUpperCase())} placeholder="CF" minWidth={150} />
                            {!row.fiscal_code && row.original_text ? (
                              <button
                                type="button"
                                onClick={() => retryCfFromText(row._key)}
                                style={{ marginTop: 4, padding: '2px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: '1px solid #d97706', background: '#fffbeb', color: '#b45309', display: 'block', width: '100%' }}
                              >
                                Riprova CF dal testo
                              </button>
                            ) : null}
                            {(row.parse_warnings || []).map((w, i) => (
                              <div key={i} style={{ color: '#d97706', fontSize: 10, marginTop: 2, whiteSpace: 'normal', lineHeight: 1.3 }}>⚠ {w}</div>
                            ))}
                          </td>
                          <td style={{ ...tdStyle, fontSize: 11, color: '#6b7280' }}>
                            {row.hired_by_detected || '—'}
                          </td>
                          <td style={tdStyle}>
                            <DatoreToggle value={row.hired_by} onChange={(v) => updateRow(row._key, 'hired_by', v)} employerOptions={currentEmployerOptions} />
                          </td>
                          <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                            <EditableCell value={row.hire_date_from} onChange={(v) => updateRow(row._key, 'hire_date_from', v)} placeholder="gg/mm/aaaa" minWidth={90} />
                          </td>
                          <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                            <EditableCell value={row.hire_date_to} onChange={(v) => updateRow(row._key, 'hire_date_to', v)} placeholder="—" minWidth={90} />
                          </td>
                          <td style={{ ...tdStyle, whiteSpace: 'normal' }}>
                            <div style={{ display: 'grid', gap: 3 }}>
                              {(row.correction_reasons || []).length ? (
                                <span style={{ fontSize: 11, color: '#92400e', lineHeight: 1.4 }}>
                                  {(row.correction_reasons || []).join(' · ')}
                                </span>
                              ) : row.parser_uncertain_reason ? (
                                <span style={{ fontSize: 11, color: '#92400e', lineHeight: 1.4 }}>
                                  {row.parser_uncertain_reason}
                                </span>
                              ) : row.year_mismatch ? (
                                <span style={{ fontSize: 11, color: '#92400e', lineHeight: 1.4 }}>
                                  {row.year_warning}
                                </span>
                              ) : (
                                <span style={{ fontSize: 11, color: '#166534', fontWeight: 700 }}>
                                  Pronto per l&apos;import
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            {row.original_text ? (
                              <button
                                type="button"
                                onClick={() => toggleTextExpanded(row._key)}
                                style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: '1px solid #d1d5db', background: textExpanded ? '#f3f4f6' : '#fff', color: '#374151' }}
                              >
                                {textExpanded ? 'Chiudi' : 'Vedi'}
                              </button>
                            ) : '—'}
                          </td>
                        </tr>
                        {textExpanded && row.original_text ? (
                          <tr style={{ background: '#f9fafb' }}>
                            <td colSpan={12} style={{ padding: '8px 16px 12px 56px', fontSize: 11, color: '#52606d', lineHeight: 1.55, whiteSpace: 'pre-wrap', borderBottom: '1px solid #e5e7eb' }}>
                              {row.original_text}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
            {rows.length === 0 && (
              <div className="empty-state" style={{ padding: 32 }}>Nessun dipendente trovato nel PDF</div>
            )}
          </div>
        </div>

        <div className="pdf-import-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 18, flexWrap: 'wrap', flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: '#667085' }}>
            Vengono importate solo le righe con badge <strong>Pronto</strong> o <strong>Nuovo rapporto datore</strong>.
          </span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="button-secondary" onClick={onClose}>
              Annulla
            </button>
            <button
              type="button"
              className="button"
              onClick={handleConfirm}
              disabled={!isEmployerResolved || selectedCount === 0 || confirming}
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
