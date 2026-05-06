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

function toDisplayDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const iso = raw.split('T')[0];
  const isoMatch = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  const parts = raw.split(/[\/\-\.]/);
  if (parts.length === 3 && parts[0].length === 1) {
    return `0${parts[0]}/${parts[1].padStart(2, '0')}/${parts[2]}`;
  }
  if (parts.length === 3 && parts[0].length === 2) {
    return `${parts[0]}/${parts[1].padStart(2, '0')}/${parts[2]}`;
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
    hire_date_from: toIsoDate(row.hire_date_from),
    hire_date_to: toIsoDate(row.hire_date_to),
    parser_uncertain_reason: row.manual_corrected ? '' : row.parser_uncertain_reason,
    manual_corrected: !!row.manual_corrected,
  };
}

function buildRecordMergeKey(row) {
  const fiscalCode = String(row?.fiscal_code || '').replace(/\s+/g, '').toUpperCase();
  if (fiscalCode) return `cf:${fiscalCode}`;
  const nameKey = `${String(row?.last_name || '').trim().toUpperCase()}|${String(row?.first_name || '').trim().toUpperCase()}`;
  if (nameKey !== '|') return `name:${nameKey}`;
  const pages = Array.isArray(row?.page_numbers) && row.page_numbers.length ? row.page_numbers.join('-') : String(row?.page_index ?? '');
  return pages ? `page:${pages}` : '';
}

function isReadyImportStatus(status) {
  return status === 'pronto' || status === 'nuovo_rapporto_datore';
}

function hasMinimumValidData(row) {
  const firstName = String(row?.first_name || '').trim();
  const lastName = String(row?.last_name || '').trim();
  const fiscalCode = String(row?.fiscal_code || '').replace(/\s+/g, '').toUpperCase();
  const hireDateFrom = toIsoDate(row?.hire_date_from);
  return !!firstName && !!lastName && /^[A-Z0-9]{16}$/.test(fiscalCode) && !!hireDateFrom;
}

function hasValidEmployerAssociation(row, employerOptions = []) {
  const employer = String(row?.hired_by || '').trim().toUpperCase();
  if (!employer) return false;
  if (employer === 'ENTRAMBI') return employerOptions.length > 1;
  return employerOptions.some((option) => String(option.short_name || option.value || '').trim().toUpperCase() === employer);
}

export default function PdfImportModal({
  open,
  onClose,
  onConfirm,
  records,
  employerOptions = [],
  settings = null,
  filePath = '',
  pdfEmployer = null,
  initialEmployerResolution = null,
  importDiagnostics = null,
}) {
  const [rows, setRows] = useState([]);
  const [currentDiagnostics, setCurrentDiagnostics] = useState(importDiagnostics);
  const [confirming, setConfirming] = useState(false);
  const [onlineOcrBusy, setOnlineOcrBusy] = useState(false);
  const [onlineOcrMessage, setOnlineOcrMessage] = useState('');
  const [results, setResults] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [resolvingEmployer, setResolvingEmployer] = useState(false);
  const [employerResolution, setEmployerResolution] = useState(initialEmployerResolution || null);
  const [selectedEmployerShortName, setSelectedEmployerShortName] = useState('');
  const [employerAssociationMode, setEmployerAssociationMode] = useState('');
  const [employerFeedback, setEmployerFeedback] = useState(null);
  const [dismissEmployerMismatch, setDismissEmployerMismatch] = useState(false);
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
      setEmployerAssociationMode('');
      setEmployerFeedback(null);
      setDismissEmployerMismatch(false);
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
        hire_date_from: toDisplayDate(r.hire_date_from),
        hire_date_to: toDisplayDate(r.hire_date_to),
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
        manual_corrected: !!r.manual_corrected,
        birth_date: r.birth_date || '',
        tipo_lavorazione: r.tipo_lavorazione || '',
        giornate_previste: r.giornate_previste || '',
        original_text: r.original_text || '',
      }))
    );
    setCurrentDiagnostics(importDiagnostics);
    setEmployerResolution(initialEmployerResolution || null);
    setSelectedEmployerShortName(initialEmployerResolution?.employer_short_name || employerOptions[0]?.short_name || employerOptions[0]?.value || '');
    setEmployerAssociationMode('');
    setEmployerFeedback(null);
    setDismissEmployerMismatch(false);
  }, [open, records, importDiagnostics]);

  useEffect(() => {
    setEmployerResolution(initialEmployerResolution || null);
    setSelectedEmployerShortName(initialEmployerResolution?.employer_short_name || employerOptions[0]?.short_name || employerOptions[0]?.value || '');
    setDismissEmployerMismatch(false);
  }, [initialEmployerResolution, employerOptions]);

  useEffect(() => () => {
    if (recheckTimerRef.current) {
      clearTimeout(recheckTimerRef.current);
      recheckTimerRef.current = null;
    }
  }, []);

  const isEmployerResolved = employerResolution?.status === 'matched' || employerResolution?.status === 'mapped';
  const currentEmployerOptions = employerResolution?.employer_options || employerOptions;
  const selectedRows = rows.filter((row) => row.selected);
  const readyRows = rows.filter((row) => isReadyImportStatus(row.status));
  const selectedReadyRows = rows.filter((row) =>
    row.selected &&
    isReadyImportStatus(row.status) &&
    hasMinimumValidData(row) &&
    hasValidEmployerAssociation(row, currentEmployerOptions)
  );
  const invalidSelectedRows = selectedRows.filter((row) => !selectedReadyRows.some((candidate) => candidate._key === row._key));
  const selectedCount = selectedReadyRows.length;
  const readyCount = readyRows.length;
  const correctionCount = rows.filter((r) => r.status === 'da_correggere' || r.status === 'duplicato').length;
  const hasEmployerAssociation = selectedReadyRows.length > 0
    ? selectedReadyRows.every((row) => hasValidEmployerAssociation(row, currentEmployerOptions))
    : selectedRows.every((row) => hasValidEmployerAssociation(row, currentEmployerOptions));
  const disabledReason =
    confirming
      ? 'confirming'
      : selectedReadyRows.length === 0
      ? selectedRows.length === 0
        ? 'no_selected_rows'
        : invalidSelectedRows.length > 0
        ? 'selected_rows_not_ready'
        : 'no_ready_selected_rows'
      : !hasEmployerAssociation
      ? 'missing_employer_association'
      : 'enabled';
  const onlineOcrEnabled = !!settings?.ocr?.online_fallback_enabled;
  const onlineOcrConfigured = !!settings?.ocr?.online_configured || !!String(settings?.ocr?.ocr_space_api_key || '').trim();
  const canRunOnlineOcr = onlineOcrEnabled && onlineOcrConfigured && !!filePath && !onlineOcrBusy;

  useEffect(() => {
    console.info('[pdf-import] employer state debug', {
      selectedEmployerShortName,
      pdfEmployer,
      employerAssociationMode,
      hasEmployerAssociation,
      readySelectedCount: selectedReadyRows.length,
      disabledReason,
    });
  }, [selectedEmployerShortName, pdfEmployer, employerAssociationMode, hasEmployerAssociation, selectedReadyRows.length, disabledReason]);

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
        setCurrentDiagnostics((current) => current ? ({
          ...current,
          records_length: evaluated.length,
          records_ready_count: evaluated.filter((row) => row.status === 'pronto' || row.status === 'nuovo_rapporto_datore').length,
          records_to_fix_count: evaluated.filter((row) => row.status === 'da_correggere' || row.status === 'duplicato').length,
        }) : current);
        setRows((prev) => evaluated.map((row, index) => ({
          ...prev[index],
          ...row,
          hire_date_from: toDisplayDate(row.hire_date_from),
          hire_date_to: toDisplayDate(row.hire_date_to),
          hired_by_detected: prev[index]?.hired_by_detected || '',
          original_text: prev[index]?.original_text || '',
          parser_uncertain_reason: prev[index]?.manual_corrected ? '' : (row.parser_uncertain_reason || prev[index]?.parser_uncertain_reason || ''),
          correction_reasons: prev[index]?.manual_corrected && (row.status === 'pronto' || row.status === 'nuovo_rapporto_datore') ? [] : row.correction_reasons,
          selected:
            row.status === 'pronto' || row.status === 'nuovo_rapporto_datore'
              ? !!prev[index]?.selected
              : false,
          restored: prev[index]?.restored || false,
          manual_corrected: prev[index]?.manual_corrected || false,
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
        const isManualField = ['first_name', 'last_name', 'fiscal_code', 'hire_date_from', 'hire_date_to', 'hired_by'].includes(field);
        const next = {
          ...r,
          [field]: field === 'hire_date_from' || field === 'hire_date_to' ? toDisplayDate(value) : value,
          manual_corrected: isManualField ? true : r.manual_corrected,
          parser_uncertain_reason: isManualField ? '' : r.parser_uncertain_reason,
        };
        if (isManualField) {
          next.correction_reasons = [];
        }
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
      setEmployerAssociationMode(action);
      setEmployerFeedback(null);
      console.info('[pdf-import] employer action click', {
        action,
        selectedEmployerShortName,
        pdfEmployer,
        employerAssociationMode: action,
        hasEmployerAssociation,
        readySelectedCount: selectedReadyRows.length,
        disabledReason,
      });
      const payload = {
        action,
        pdfEmployer,
        employerShortName: selectedEmployerShortName,
      };
      const nextResolution = await window.api.employees.resolvePdfEmployer(payload);
      console.info('[pdf-import] employer action resolved', {
        action,
        selectedEmployerShortName,
        pdfEmployer,
        nextResolution,
      });
      setEmployerResolution(nextResolution);
      applyResolvedEmployer(nextResolution);
      setDismissEmployerMismatch(false);
      if (action === 'associate_existing') {
        setEmployerFeedback({
          tone: 'success',
          message: `Datore associato correttamente: ${nextResolution.employer_short_name} - ${nextResolution.employer_name}`,
        });
      } else {
        setEmployerFeedback({
          tone: 'success',
          message: `Nuovo datore creato e associato correttamente: ${nextResolution.employer_short_name} - ${nextResolution.employer_name}`,
        });
      }
    } catch (err) {
      console.error('[pdf-import] employer action failed', {
        action,
        selectedEmployerShortName,
        pdfEmployer,
        message: err?.message || String(err),
      });
      setEmployerFeedback({
        tone: 'error',
        message: `Errore associazione datore: ${err.message}`,
      });
      alert(`Errore associazione datore: ${err.message}`);
    } finally {
      setResolvingEmployer(false);
    }
  }

  function toggleSelectAll() {
    const readyRows = rows.filter((r) => isReadyImportStatus(r.status));
    const allSelected = readyRows.length > 0 && readyRows.every((r) => r.selected);
    setRows((prev) => prev.map((r) => ({
      ...r,
      selected: isReadyImportStatus(r.status) ? !allSelected : false,
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

  async function handleManualOnlineOcr() {
    if (!onlineOcrEnabled) {
      setOnlineOcrMessage('Configura OCR online nelle Impostazioni');
      return;
    }
    if (!onlineOcrConfigured) {
      setOnlineOcrMessage('OCR online non configurato.');
      return;
    }
    if (!filePath) {
      setOnlineOcrMessage('PDF non disponibile per OCR online.');
      return;
    }

    const hasManualCorrections = rows.some((row) => row.manual_corrected);
    if (hasManualCorrections) {
      const keepGoing = window.confirm(
        'Hai gia corretto manualmente alcune righe. OCR online aggiornera la preview mantenendo le correzioni dove possibile. Continuare?'
      );
      if (!keepGoing) return;
    }

    const confirmed = window.confirm('Il PDF verrà inviato a un servizio esterno OCR. Confermi?');
    if (!confirmed) return;

    setOnlineOcrBusy(true);
    setOnlineOcrMessage('Lettura OCR online in corso...');
    try {
      const result = await window.api.employees.runOcrOnlineImport({
        filePath,
        targetYear: rows[0]?.target_year,
      });
      const manualRowsByKey = new Map(
        rows
          .filter((row) => row.manual_corrected && buildRecordMergeKey(row))
          .map((row) => [buildRecordMergeKey(row), row])
      );
      const usedManualKeys = new Set();
      const nextRows = (result.records || []).map((record, index) => {
        const recordKey = buildRecordMergeKey(record);
        const manualRow = manualRowsByKey.get(recordKey);
        if (manualRow) usedManualKeys.add(recordKey);
        return {
          _key: manualRow?._key ?? `online-${Date.now()}-${index}`,
          selected: manualRow ? !!manualRow.selected : !!record.selected,
          first_name: manualRow?.first_name || record.first_name || '',
          last_name: manualRow?.last_name || record.last_name || '',
          fiscal_code: manualRow?.fiscal_code || record.fiscal_code || '',
          hire_date_from: toDisplayDate(manualRow?.hire_date_from || record.hire_date_from),
          hire_date_to: toDisplayDate(manualRow?.hire_date_to || record.hire_date_to),
          hired_by: manualRow?.hired_by || record.hired_by || record.hired_by_detected || '',
          hired_by_detected: record.hired_by_detected || manualRow?.hired_by_detected || '',
          status: record.status || 'da_correggere',
          import_action: record.import_action || (record.existing_employee_id ? 'esistente' : 'nuovo'),
          existing_employee_id: record.existing_employee_id || null,
          existing_name: record.existing_name || null,
          existing_is_deleted: record.existing_is_deleted || false,
          restored: manualRow?.restored || false,
          parse_warnings: record.parse_warnings || [],
          correction_reasons: manualRow ? [] : (record.correction_reasons || []),
          hire_year: record.hire_year || null,
          target_year: record.target_year || rows[0]?.target_year || new Date().getFullYear(),
          year_mismatch: !!record.year_mismatch,
          year_warning: record.year_warning || '',
          page_index: record.page_index ?? index,
          page_numbers: Array.isArray(record.page_numbers) ? record.page_numbers : [],
          parse_model: record.parse_model || 'online_ocr_text',
          parser_uncertain_reason: manualRow ? '' : (record.parser_uncertain_reason || ''),
          manual_corrected: !!manualRow,
          birth_date: record.birth_date || manualRow?.birth_date || '',
          tipo_lavorazione: record.tipo_lavorazione || manualRow?.tipo_lavorazione || '',
          giornate_previste: record.giornate_previste || manualRow?.giornate_previste || '',
          original_text: record.original_text || manualRow?.original_text || '',
        };
      });

      for (const row of rows) {
        const key = buildRecordMergeKey(row);
        if (row.manual_corrected && key && !usedManualKeys.has(key)) {
          nextRows.push(row);
        }
      }

      setRows(nextRows);
      setCurrentDiagnostics(result.importDiagnostics || null);
      setOnlineOcrMessage(
        nextRows.length > 0
          ? `OCR online completato: ${nextRows.length} righe in preview.`
          : 'OCR online completato ma nessun lavoratore riconosciuto.'
      );
      scheduleReevaluation(nextRows);
    } catch (err) {
      setOnlineOcrMessage(err?.message || 'OCR online fallito.');
    } finally {
      setOnlineOcrBusy(false);
    }
  }

  async function handleConfirm() {
    const submitRows = rows
      .map(normalizeRowForEvaluation)
      .filter((row) =>
        row.selected &&
        isReadyImportStatus(row.status) &&
        hasMinimumValidData(row) &&
        hasValidEmployerAssociation(row, currentEmployerOptions)
      );
    console.info('[pdf-import] confirm submit debug', {
      totalRows: rows.length,
      selectedRows: selectedRows.length,
      readyRows: readyRows.length,
      selectedReadyRows: submitRows.length,
      invalidSelectedRows: invalidSelectedRows.length,
      hasEmployerAssociation,
      disabledReason,
    });
    if (!submitRows.length) return;
    setConfirming(true);
    try {
      const res = await onConfirm(submitRows);
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
              {currentDiagnostics ? (
                <>
                  <span className="soft-chip" style={{ background: 'rgba(99, 102, 241, 0.12)', color: '#3730a3' }}>
                    Pagine OCR: {currentDiagnostics.pages_ocr_count ?? 'n/d'}
                  </span>
                  <span className="soft-chip" style={{ background: 'rgba(14, 116, 144, 0.12)', color: '#155e75' }}>
                    Blocchi: {currentDiagnostics.candidate_blocks_count ?? rows.length}
                  </span>
                  <span className="soft-chip" style={{ background: 'rgba(22, 163, 74, 0.12)', color: '#166534' }}>
                    Pronti: {currentDiagnostics.records_ready_count ?? readyCount}
                  </span>
                  <span className="soft-chip" style={{ background: 'rgba(245, 158, 11, 0.14)', color: '#92400e' }}>
                    Da correggere: {currentDiagnostics.records_to_fix_count ?? correctionCount}
                  </span>
                </>
              ) : null}
              {onlineOcrMessage ? (
                <span className="soft-chip" style={{ background: onlineOcrMessage.includes('fallito') || onlineOcrMessage.includes('non configurato') ? '#fee2e2' : '#e0f2fe', color: onlineOcrMessage.includes('fallito') || onlineOcrMessage.includes('non configurato') ? '#b91c1c' : '#0369a1' }}>
                  {onlineOcrMessage}
                </span>
              ) : null}
              {employerFeedback ? (
                <span
                  className="soft-chip"
                  style={{
                    background: employerFeedback.tone === 'error' ? '#fee2e2' : '#dcfce7',
                    color: employerFeedback.tone === 'error' ? '#b91c1c' : '#166534',
                    maxWidth: 520,
                    whiteSpace: 'normal',
                  }}
                >
                  {employerFeedback.message}
                </span>
              ) : null}
            </div>
            <div className="toolbar-group pdf-import-toolbar-group">
              <button
                type="button"
                className="button-secondary"
                style={compactButtonStyle}
                onClick={handleManualOnlineOcr}
                disabled={!canRunOnlineOcr}
                title={canRunOnlineOcr ? 'Leggi il PDF con OCR.space' : 'Configura OCR online nelle Impostazioni'}
              >
                {onlineOcrBusy ? (
                  <>
                    <span style={{ ...spinnerStyle, borderColor: 'rgba(37,99,235,0.22)', borderTopColor: '#2563eb' }} />
                    OCR online...
                  </>
                ) : 'Leggi con OCR online'}
              </button>
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
                {readyRows.length > 0 && readyRows.every((r) => r.selected) ? 'Deseleziona tutto' : 'Seleziona tutto'}
              </button>
            </div>
          </div>

          {employerResolution?.status === 'mismatch' && !dismissEmployerMismatch && (
            <div className="panel panel-section" style={{ marginBottom: 16, padding: 16, display: 'grid', gap: 12, background: '#fff8e8', border: '1px solid rgba(180, 83, 9, 0.18)', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#92400e' }}>
                  Il datore indicato nel PDF non corrisponde ai datori configurati nel gestionale.
                </div>
                <div style={{ fontSize: 13, color: '#7c2d12', marginTop: 6 }}>
                  Scegli come associare il datore prima di importare. Nessun dipendente verrà salvato finché non completi questa scelta.
                  </div>
                </div>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setDismissEmployerMismatch(true)}
                  title="Nascondi avviso"
                  style={{ minHeight: 32, width: 32, padding: 0, borderRadius: 999, flexShrink: 0, fontSize: 16, fontWeight: 800 }}
                >
                  ×
                </button>
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
                    {resolvingEmployer && employerAssociationMode === 'associate_existing'
                      ? 'Associazione in corso...'
                      : 'Associa a datore esistente'}
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={resolvingEmployer}
                    onClick={() => handleResolveEmployer('create_new')}
                  >
                    {resolvingEmployer && employerAssociationMode === 'create_new'
                      ? 'Creazione in corso...'
                      : 'Aggiungi come nuovo datore'}
                  </button>
                  <button type="button" className="button-secondary" onClick={onClose}>
                    Annulla import
                  </button>
                </div>
              </div>
              {resolvingEmployer ? (
                <div style={{ fontSize: 12, color: '#92400e', fontWeight: 700 }}>
                  Operazione sul datore in corso...
                </div>
              ) : null}
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
                              disabled={!isReadyImportStatus(row.status)}
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
              disabled={selectedReadyRows.length === 0 || !hasEmployerAssociation || confirming}
              title={disabledReason === 'enabled' ? 'Importa le righe selezionate e pronte' : `Importazione non disponibile: ${disabledReason}`}
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
