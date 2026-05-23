import React, { useEffect, useMemo, useState } from 'react';
import DocumentActions from './DocumentActions';

const contractLabels = {
  tempo_indeterminato: 'Tempo Indeterminato',
  tempo_determinato: 'Tempo Determinato',
  apprendistato: 'Apprendistato',
  stagionale: 'Stagionale',
  partita_iva: 'Partita IVA',
};

const UI_SYMBOLS = {
  medical: '\u{1FA7A}',
  training: '\u{1F393}',
  dpi: '\u{1F97E}',
  attachment: '\u{1F4CE}',
  info: '\u2139\uFE0F',
  close: '\u2715',
  bullet: '\u2022',
  euro: '\u20AC',
  arrow: '\u2192',
  divide: '\u00F7',
  times: '\u00D7',
  emDash: '\u2014',
  ellipsis: '\u2026',
};

function SectionTitle({ children }) {
  return (
    <div className="employee-form__section-title">
      <span className="employee-form__section-kicker">{children}</span>
      <div className="employee-form__section-divider" />
    </div>
  );
}

function SectionCard({ title, description, children, className = '' }) {
  return (
    <section className={`employee-form__section ${className}`.trim()}>
      <div className="employee-form__section-header">
        <SectionTitle>{title}</SectionTitle>
        {description ? <p className="employee-form__section-description">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SecurityCard({ badge, title, children }) {
  return (
    <div className="employee-form__security-card">
      <div className="employee-form__security-head">
        <span className="employee-form__security-badge">{badge}</span>
        <div className="employee-form__security-title">{title}</div>
      </div>
      <div className="employee-form__security-body">{children}</div>
    </div>
  );
}

function CheckRow({ id, label, checked, onChange, disabled = false }) {
  return (
    <label
      htmlFor={id}
      className="employee-form__check-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: disabled ? 'default' : 'pointer',
        padding: '8px 10px',
        borderRadius: 14,
        background: 'rgba(255,255,255,0.62)',
        border: '1px solid rgba(20, 33, 61, 0.06)',
        opacity: disabled ? 0.78 : 1,
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18 }}
      />
      <span style={{ fontSize: 14 }}>{label}</span>
    </label>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 700 }}>{label}</label>
      {children}
    </div>
  );
}

function getOvertimeMode(form) {
  if (form?.overtime_use_general_rate) {
    return 'general';
  }

  if (
    form?.overtime_hourly_rate !== '' &&
    form?.overtime_hourly_rate !== null &&
    form?.overtime_hourly_rate !== undefined
  ) {
    return 'custom';
  }

  return 'disabled';
}

function normalizeDecimalValue(value) {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }

  const normalized = Number(String(value).replace(',', '.'));
  return Number.isFinite(normalized) ? normalized : undefined;
}

function formatDisplayDate(value) {
  if (!value) return UI_SYMBOLS.emDash;
  const clean = String(value).split('T')[0];
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return clean;
}

function addValidityToIsoDate(dateValue, validityValue, validityUnit = 'years') {
  const raw = String(dateValue || '').trim();
  if (!raw) return '';

  const parts = raw.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return '';
  }

  const [year, month, day] = parts;
  const result = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(result.getTime())) {
    return '';
  }

  const amount = Math.max(1, Number(validityValue || 0) || 1);
  const originalDay = result.getUTCDate();

  if (validityUnit === 'months') {
    result.setUTCMonth(result.getUTCMonth() + amount);
  } else {
    result.setUTCFullYear(result.getUTCFullYear() + amount);
  }

  if (result.getUTCDate() !== originalDay) {
    result.setUTCDate(0);
  }

  return result.toISOString().slice(0, 10);
}

const emptyForm = {
  first_name: '',
  last_name: '',
  fiscal_code: '',
  role: '',
  contract_type: 'tempo_determinato',
  daily_pay: '',
  standard_hours: 7,
  overtime_use_general_rate: true,
  overtime_hourly_rate: '',
  phone: '',
  email: '',
  hire_date: '',
  hire_date_from: '',
  hire_date_to: '',
  hired_by: 'LC',
  status: 'attivo',

  medical_visit_required: false,
  medical_visit_done: false,
  medical_visit_done_with_us: false,
  medical_visit_date: '',
  medical_visit_expiry: '',
  medical_visit_notes: '',

  art37_required: false,
  art37_done: false,
  art37_done_with_us: false,
  art37_date: '',
  art37_expiry: '',
  art37_notes: '',

  notes: '',
};

function normalizeEmployeeFormForDirtyCheck(form, selectedHistoryId = '') {
  return JSON.stringify({
    first_name: form.first_name || '',
    last_name: form.last_name || '',
    fiscal_code: form.fiscal_code || '',
    role: form.role || '',
    contract_type: form.contract_type || 'tempo_indeterminato',
    daily_pay: form.daily_pay ?? '',
    standard_hours: form.standard_hours ?? 7,
    overtime_use_general_rate: !!form.overtime_use_general_rate,
    overtime_hourly_rate: form.overtime_hourly_rate ?? '',
    phone: form.phone || '',
    email: form.email || '',
    hire_date: form.hire_date || '',
    hire_date_from: form.hire_date_from || '',
    hire_date_to: form.hire_date_to || '',
    hired_by: form.hired_by || '',
    status: form.status || 'attivo',
    medical_visit_required: !!form.medical_visit_required,
    medical_visit_done: !!form.medical_visit_done,
    medical_visit_done_with_us: !!form.medical_visit_done_with_us,
    medical_visit_date: form.medical_visit_date || '',
    medical_visit_expiry: form.medical_visit_expiry || '',
    medical_visit_notes: form.medical_visit_notes || '',
    art37_required: !!form.art37_required,
    art37_done: !!form.art37_done,
    art37_done_with_us: !!form.art37_done_with_us,
    art37_date: form.art37_date || '',
    art37_expiry: form.art37_expiry || '',
    art37_notes: form.art37_notes || '',
    notes: form.notes || '',
    reactivate_employee_id: selectedHistoryId || '',
  });
}

export default function EmployeeForm({ open, onClose, onSubmit, employee }) {
  const [form, setForm] = useState(employee || emptyForm);
  const [settingsGeneral, setSettingsGeneral] = useState({
    overtime_enabled: false,
    overtime_hourly_rate: 0,
    medical_visit_validity_value: 1,
    medical_visit_validity_unit: 'years',
    art37_validity_value: 5,
    art37_validity_unit: 'years',
  });
  const [historyMatches, setHistoryMatches] = useState([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState('');
  const [occupations, setOccupations] = useState([]);
  const [newOccupation, setNewOccupation] = useState('');
  const [overtimeMode, setOvertimeMode] = useState(getOvertimeMode(employee || emptyForm));
  const [employeeDocuments, setEmployeeDocuments] = useState({
    hire_document: null,
    legacy_hire_document: null,
    art37_document: null,
    medical_visit_document: null,
    dpi_delivery_document: null,
  });
  const [documentBusyKey, setDocumentBusyKey] = useState('');
  const [employmentPeriods, setEmploymentPeriods] = useState([]);
  const [dpiAssignments, setDpiAssignments] = useState([]);
  const [employerOptions, setEmployerOptions] = useState([
    { value: 'LC', label: 'LC' },
    { value: 'LG', label: 'LG' },
    { value: 'ENTRAMBE', label: 'ENTRAMBE' },
  ]);

  useEffect(() => {
    setForm(employee || emptyForm);
    setHistoryMatches([]);
    setSelectedHistoryId('');
    setNewOccupation('');
    setOvertimeMode(getOvertimeMode(employee || emptyForm));
    setEmployeeDocuments({
      hire_document: employee?.hire_document || null,
      legacy_hire_document: employee?.legacy_hire_document || null,
      art37_document: employee?.art37_document || null,
      medical_visit_document: employee?.medical_visit_document || null,
      dpi_delivery_document: employee?.dpi_delivery_document || null,
    });
    setEmploymentPeriods(employee?.employment_periods || []);
    setDpiAssignments([]);
  }, [employee, open]);

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const initialSnapshot = useMemo(
    () => normalizeEmployeeFormForDirtyCheck(employee || emptyForm, ''),
    [employee]
  );
  const currentSnapshot = useMemo(
    () => normalizeEmployeeFormForDirtyCheck(form, employee ? '' : selectedHistoryId),
    [form, employee, selectedHistoryId]
  );
  const isDirty = initialSnapshot !== currentSnapshot;

  useEffect(() => {
    let cancelled = false;

    async function loadFormSettings() {
      if (!open) return;

      try {
        const [data, settings] = await Promise.all([
          window.api.occupations.list(),
          window.api.settings.get(),
        ]);
        if (cancelled) return;

        const values = (data || []).map((item) => item.name);
        if (form.role && !values.includes(form.role)) {
          values.push(form.role);
          values.sort((a, b) => a.localeCompare(b, 'it'));
        }
        setOccupations(values);

        const options = (settings?.employer_options || []).map((item) => ({
          value: item.short_name,
          label: `${item.short_name} • ${item.name}`,
        }));

        if ((settings?.employers?.mode || 'two') === 'two') {
          options.push({ value: 'ENTRAMBE', label: 'ENTRAMBE' });
        }

        if (form.hired_by && !options.some((item) => item.value === form.hired_by)) {
          options.push({ value: form.hired_by, label: form.hired_by });
        }

        setEmployerOptions(options);
        setSettingsGeneral({
          overtime_enabled: !!settings?.general?.overtime_enabled,
          overtime_hourly_rate: Number(settings?.general?.overtime_hourly_rate || 0) || 0,
          medical_visit_validity_value: Math.max(1, Number(settings?.general?.medical_visit_validity_value || 1) || 1),
          medical_visit_validity_unit: settings?.general?.medical_visit_validity_unit === 'months' ? 'months' : 'years',
          art37_validity_value: Math.max(1, Number(settings?.general?.art37_validity_value || 5) || 5),
          art37_validity_unit: settings?.general?.art37_validity_unit === 'months' ? 'months' : 'years',
        });
        if (!employee && options.length && !options.some((item) => item.value === form.hired_by)) {
          set('hired_by', options[0].value);
        }
      } catch (err) {
        console.error(err);
      }
    }

    loadFormSettings();

    return () => {
      cancelled = true;
    };
  }, [open, form.role, form.hired_by]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistoryMatches() {
      if (!open || employee) return;

      const hasEnoughData =
        (form.first_name?.trim() && form.last_name?.trim()) || form.fiscal_code?.trim();

      if (!hasEnoughData) {
        setHistoryMatches([]);
        setSelectedHistoryId('');
        return;
      }

      try {
        const matches = await window.api.employees.findHistoryMatches({
          first_name: form.first_name,
          last_name: form.last_name,
          fiscal_code: form.fiscal_code,
        });

        if (cancelled) return;

        setHistoryMatches(matches || []);
        const archivedMatch = (matches || []).find((item) => item.is_deleted);
        setSelectedHistoryId((current) => current || (archivedMatch ? String(archivedMatch.id) : ''));
      } catch (err) {
        console.error(err);
      }
    }

    const timer = setTimeout(() => {
      loadHistoryMatches();
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, employee, form.first_name, form.last_name, form.fiscal_code]);

  useEffect(() => {
    let cancelled = false;

    async function loadDpiAssignments() {
      if (!open || !employee?.id) {
        setDpiAssignments([]);
        return;
      }

      try {
        const assignments = await window.api.dpi.getEmployeeAssignments(employee.id);
        if (!cancelled) {
          setDpiAssignments(Array.isArray(assignments) ? assignments : []);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setDpiAssignments([]);
        }
      }
    }

    loadDpiAssignments();
    return () => {
      cancelled = true;
    };
  }, [open, employee?.id]);

  useEffect(() => {
    setForm((prev) => {
      const nextMedicalExpiry = prev.medical_visit_date
        ? addValidityToIsoDate(
            prev.medical_visit_date,
            settingsGeneral.medical_visit_validity_value,
            settingsGeneral.medical_visit_validity_unit
          )
        : '';
      const nextArt37Expiry = prev.art37_date
        ? addValidityToIsoDate(
            prev.art37_date,
            settingsGeneral.art37_validity_value,
            settingsGeneral.art37_validity_unit
          )
        : '';

      if (
        prev.medical_visit_expiry === nextMedicalExpiry &&
        prev.art37_expiry === nextArt37Expiry
      ) {
        return prev;
      }

      return {
        ...prev,
        medical_visit_expiry: nextMedicalExpiry,
        art37_expiry: nextArt37Expiry,
      };
    });
  }, [
    settingsGeneral.medical_visit_validity_value,
    settingsGeneral.medical_visit_validity_unit,
    settingsGeneral.art37_validity_value,
    settingsGeneral.art37_validity_unit,
  ]);

  const handleSubmit = (e) => {
    e.preventDefault();

    onSubmit({
      ...form,
      daily_pay: form.daily_pay !== '' ? Number(form.daily_pay) : undefined,
      standard_hours: form.standard_hours ? Number(form.standard_hours) : 7,
      overtime_use_general_rate: !!form.overtime_use_general_rate,
      overtime_hourly_rate:
        form.overtime_use_general_rate
          ? undefined
          : normalizeDecimalValue(form.overtime_hourly_rate),
      reactivate_employee_id: !employee && selectedHistoryId ? Number(selectedHistoryId) : undefined,
    });
  };

  async function handleAddOccupation() {
    const trimmed = String(newOccupation || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      return;
    }

    try {
      const created = await window.api.occupations.create(trimmed);
      const value = created?.name || trimmed;
      setOccupations((current) => {
        const next = Array.from(new Set([...current, value]));
        next.sort((a, b) => a.localeCompare(b, 'it'));
        return next;
      });
      set('role', value);
      setNewOccupation('');
    } catch (err) {
      console.error(err);
      alert('Errore aggiunta mansione');
    }
  }

  const exampleHours = 8;
  const pay = Number(form.daily_pay) || 0;
  const stdH = Number(form.standard_hours) || 7;
  const standardHoursLabel = String(form.standard_hours ?? '').trim() || '7';
  const dailyPayLabel = `Retribuzione giornaliera (${UI_SYMBOLS.euro} / ${standardHoursLabel} ore)`;
  const exampleEarning = stdH > 0 && pay > 0 ? ((pay / stdH) * exampleHours).toFixed(2) : null;
  const hasEmployeeRecord = !!employee?.id;
  const latestDpiAssignment = useMemo(() => {
    if (!dpiAssignments.length) return null;
    return [...dpiAssignments].sort((a, b) =>
      String(b.assigned_date || '').localeCompare(String(a.assigned_date || ''))
    )[0];
  }, [dpiAssignments]);
  const handleMedicalVisitDateChange = (value) => {
    setForm((prev) => ({
      ...prev,
      medical_visit_date: value,
      medical_visit_expiry: value
        ? addValidityToIsoDate(
            value,
            settingsGeneral.medical_visit_validity_value,
            settingsGeneral.medical_visit_validity_unit
          )
        : '',
    }));
  };
  const handleArt37DateChange = (value) => {
    setForm((prev) => ({
      ...prev,
      art37_date: value,
      art37_expiry: value
        ? addValidityToIsoDate(
            value,
            settingsGeneral.art37_validity_value,
            settingsGeneral.art37_validity_unit
          )
        : '',
    }));
  };

  if (!open) return null;

  async function refreshEmployeeDocuments() {
    if (!employee?.id) return;
    try {
      const fresh = await window.api.employees.getById(employee.id, { includeDeleted: true });
      if (fresh) {
        setEmployeeDocuments({
          hire_document: fresh.hire_document || null,
          legacy_hire_document: fresh.legacy_hire_document || null,
          art37_document: fresh.art37_document || null,
          medical_visit_document: fresh.medical_visit_document || null,
          dpi_delivery_document: fresh.dpi_delivery_document || null,
        });
        setEmploymentPeriods(fresh.employment_periods || []);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDocumentAction(action, errorMessage, options = {}) {
    const { documentKey = '', busyKey = documentKey, perfName = '' } = options;
    const perf = typeof performance !== 'undefined' ? performance : { now: () => Date.now() };
    const startedAt = perf.now();
    const isFormationUpload = perfName === 'formazione';

    if (busyKey) {
      setDocumentBusyKey(busyKey);
    }
    if (isFormationUpload) {
      console.info('[documents-perf] formazione upload start');
    }

    try {
      const result = await action();
      if (!result?.canceled) {
        if (isFormationUpload) {
          console.info(
            `[documents-perf] formazione upload saved in ${Math.round(perf.now() - startedAt)} ms`
          );
        }

        const uiStartedAt = perf.now();
        if (documentKey && Object.prototype.hasOwnProperty.call(result || {}, 'document')) {
          setEmployeeDocuments((current) => ({
            ...current,
            [documentKey]: result.document || null,
          }));
        } else {
          await refreshEmployeeDocuments();
        }

        if (isFormationUpload) {
          console.info(
            `[documents-perf] formazione ui updated in ${Math.round(perf.now() - uiStartedAt)} ms`
          );
        }
      }
    } catch (err) {
      console.error(err);
      alert(errorMessage);
    } finally {
      if (busyKey) {
        setDocumentBusyKey('');
      }
    }
  }

  async function handleOpenDocument(action, errorMessage) {
    try {
      const result = await action();
      if (result && result.success === false && result.message) {
        alert(result.message);
      }
    } catch (err) {
      console.error(err);
      alert(errorMessage);
    }
  }

  function requestClose() {
    if (isDirty && !window.confirm('Ci sono modifiche non salvate. Vuoi chiudere comunque la scheda?')) {
      return;
    }
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div className="modal-dialog employee-form-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header employee-form__header">
          <div>
            <span className="page-kicker">{employee ? 'Scheda dipendente' : 'Nuovo inserimento'}</span>
            <h2 style={{ margin: '6px 0 0' }}>{employee ? 'Modifica Dipendente' : 'Nuovo Dipendente'}</h2>
            <p className="employee-form__header-subtitle">
              {employee ? 'Scheda dipendente' : 'Compila anagrafica, contratto e documenti di sicurezza.'}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={requestClose}>{UI_SYMBOLS.close}</button>
        </div>

        <form onSubmit={handleSubmit} className="employee-form">
          <div className="form-grid employee-form-grid employee-form__body">
          <SectionTitle>Anagrafica</SectionTitle>

          <div className="employee-form__grid employee-form__grid--2">
            <Field label="Nome *">
              <input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} required />
            </Field>
            <Field label="Cognome *">
              <input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} required />
            </Field>
          </div>

          <div className="employee-form__grid employee-form__grid--2">
            <Field label="Codice Fiscale">
              <input value={form.fiscal_code} onChange={(e) => set('fiscal_code', e.target.value)} />
            </Field>
            <Field label="Mansione">
              <div style={{ display: 'grid', gap: 8 }}>
                <select value={form.role || ''} onChange={(e) => set('role', e.target.value)}>
                  <option value="">Seleziona mansione</option>
                  {occupations.map((occupation) => (
                    <option key={occupation} value={occupation}>
                      {occupation}
                    </option>
                  ))}
                </select>
                <div className="employee-form__inline-add">
                  <input
                    value={newOccupation}
                    onChange={(e) => setNewOccupation(e.target.value)}
                    placeholder="Aggiungi nuova mansione"
                  />
                  <button type="button" className="button-secondary" onClick={handleAddOccupation}>
                    Aggiungi
                  </button>
                </div>
              </div>
            </Field>
          </div>

          {!employee && historyMatches.length ? (
            <div style={historyBoxStyle}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>
                Storico gia presente nel sistema
              </div>
              <div style={{ color: '#475467', fontSize: 14, marginBottom: 10 }}>
                Il gestionale ha trovato un dipendente con identita compatibile. Puoi riattivare lo storico invece di creare una nuova scheda scollegata.
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                {historyMatches.map((match) => (
                  <label
                    key={match.id}
                    style={{
                      display: 'grid',
                      gap: 6,
                      padding: 12,
                      borderRadius: 12,
                      border: selectedHistoryId === String(match.id)
                        ? '1px solid #0f766e'
                        : '1px solid #d0d5dd',
                      background: selectedHistoryId === String(match.id)
                        ? 'rgba(15, 118, 110, 0.08)'
                        : 'rgba(255,255,255,0.84)',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="radio"
                        name="history-match"
                        disabled={!match.is_deleted}
                        checked={selectedHistoryId === String(match.id)}
                        onChange={() => setSelectedHistoryId(match.is_deleted ? String(match.id) : '')}
                      />
                      <strong>{match.first_name} {match.last_name}</strong>
                      <span
                        className="soft-chip"
                        style={{
                          background: match.is_deleted ? 'rgba(107, 114, 128, 0.14)' : 'rgba(16, 185, 129, 0.14)',
                          color: match.is_deleted ? '#374151' : '#047857',
                        }}
                      >
                        {match.is_deleted ? 'Ex dipendente archiviato' : 'Gia attivo'}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: '#667085' }}>
                      Periodi registrati: {match.employment_periods?.length || 0}
                      {match.hired_by ? ` ${UI_SYMBOLS.bullet} Datore attuale/storico: ${match.hired_by}` : ''}
                      {!match.is_deleted ? ' • Scheda gia attiva nel gestionale' : ''}
                    </div>
                  </label>
                ))}

                <label
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    padding: 12,
                    borderRadius: 12,
                    border: !selectedHistoryId ? '1px solid #0f766e' : '1px solid #d0d5dd',
                    background: !selectedHistoryId ? 'rgba(15, 118, 110, 0.08)' : 'rgba(255,255,255,0.84)',
                  }}
                >
                  <input
                    type="radio"
                    name="history-match"
                    checked={!selectedHistoryId}
                    onChange={() => setSelectedHistoryId('')}
                  />
                  <span>Crea comunque una nuova identita separata</span>
                </label>
              </div>
            </div>
          ) : null}

          <div className="employee-form__grid employee-form__grid--2">
            <Field label="Telefono">
              <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
          </div>

          <SectionTitle>Contratto e Retribuzione</SectionTitle>

          <div className="employee-form__grid employee-form__grid--2">
            <Field label="Tipo Contratto">
              <select value={form.contract_type} onChange={(e) => set('contract_type', e.target.value)}>
                {Object.entries(contractLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>

            <Field label="Stato">
              <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="attivo">Attivo</option>
                <option value="inattivo">Inattivo</option>
              </select>
            </Field>
          </div>

          <div className="employee-form__grid employee-form__grid--3">
            <Field label="Data assunzione da">
              <input
                type="date"
                value={form.hire_date_from || ''}
                onChange={(e) => set('hire_date_from', e.target.value)}
              />
            </Field>

            <Field label="Data assunzione a">
              <input
                type="date"
                value={form.hire_date_to || ''}
                onChange={(e) => set('hire_date_to', e.target.value)}
              />
            </Field>

            <Field label="Assunto da">
              <select
                value={form.hired_by || employerOptions[0]?.value || ''}
                onChange={(e) => set('hired_by', e.target.value)}
              >
                {employerOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="employee-form__grid employee-form__grid--2">
            <Field label={dailyPayLabel}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.daily_pay}
                onChange={(e) => set('daily_pay', e.target.value)}
                placeholder="Inserisci importo retribuzione giornaliera"
              />
            </Field>

            <Field label="Ore standard/giorno (base calcolo)">
              <input
                type="number"
                min="1"
                max="12"
                step="0.5"
                value={form.standard_hours}
                onChange={(e) => set('standard_hours', e.target.value)}
              />
            </Field>
          </div>

          <div className="employee-form__grid employee-form__grid--2">
            <Field label="Gestione straordinario">
              <select
                value={overtimeMode}
                onChange={(e) => {
                  const nextMode = e.target.value;
                  setOvertimeMode(nextMode);
                  if (nextMode === 'general') {
                    setForm((prev) => ({
                      ...prev,
                      overtime_use_general_rate: true,
                    }));
                    return;
                  }

                  if (nextMode === 'custom') {
                    setForm((prev) => ({
                      ...prev,
                      overtime_use_general_rate: false,
                      overtime_hourly_rate:
                        prev.overtime_hourly_rate !== '' &&
                        prev.overtime_hourly_rate !== null &&
                        prev.overtime_hourly_rate !== undefined
                          ? prev.overtime_hourly_rate
                          : '',
                    }));
                    return;
                  }

                  setForm((prev) => ({
                    ...prev,
                    overtime_use_general_rate: false,
                    overtime_hourly_rate: '',
                  }));
                }}
              >
                <option value="disabled">Disattivato</option>
                <option value="general">Tariffa generale</option>
                <option value="custom">Tariffa personalizzata</option>
              </select>
            </Field>

            <Field label="Tariffa straordinario (€ / ora)">
              <input
                type="text"
                inputMode="decimal"
                value={
                  overtimeMode === 'general'
                    ? settingsGeneral.overtime_hourly_rate
                    : overtimeMode === 'custom'
                    ? form.overtime_hourly_rate
                    : ''
                }
                disabled={overtimeMode !== 'custom'}
                onChange={(e) => set('overtime_hourly_rate', e.target.value)}
                placeholder="Es. 10,50"
              />
            </Field>
          </div>

          <div style={infoBoxStyle}>
            Straordinario {overtimeMode === 'disabled' ? 'disattivato' : 'attivo'}.
            {overtimeMode === 'general' ? (
              <>
                {' '}Tariffa generale: <strong>€ {Number(settingsGeneral.overtime_hourly_rate || 0).toFixed(2)} / ora</strong>.
                {' '}Questo dipendente usa la tariffa generale.
              </>
            ) : overtimeMode === 'custom' ? (
              <> Questo dipendente usa una tariffa personalizzata.</>
            ) : (
              <> Nessuna tariffa straordinario attiva per questo dipendente.</>
            )}
            {!settingsGeneral.overtime_enabled ? (
              <> Lo straordinario è disattivato nelle impostazioni generali.</>
            ) : null}
          </div>

          {exampleEarning && (
            <div style={infoBoxStyle}>
              ℹ️ <strong>Esempio calcolo:</strong> per {exampleHours} ore lavorate →{' '}
              <strong>€ {exampleEarning}</strong>{' '}
              <span style={{ color: '#6b7280' }}>(€{pay} ÷ {stdH}h × {exampleHours}h)</span>
            </div>
          )}

          <SectionCard
            title="Sicurezza e adempimenti"
            description="🩺 Visita medica, 🎓 formazione e 🥾 DPI in una sezione compatta."
          >
            <div className="employee-form__security-grid">
              <SecurityCard badge="🩺" title="Visita medica">
                <div className="employee-form__security-checks">
                  <CheckRow
                    id="mv_req"
                    label="Richiesta"
                    checked={form.medical_visit_required}
                    onChange={(v) => set('medical_visit_required', v)}
                  />
                  <CheckRow
                    id="mv_done"
                    label="Effettuata"
                    checked={form.medical_visit_done}
                    onChange={(v) => set('medical_visit_done', v)}
                  />
                  {form.medical_visit_done ? (
                    <CheckRow
                      id="mv_us"
                      label="Tramite la nostra azienda"
                      checked={form.medical_visit_done_with_us}
                      onChange={(v) => set('medical_visit_done_with_us', v)}
                    />
                  ) : null}
                </div>

                {form.medical_visit_done ? (
                  <div className="employee-form__security-fields">
                    <Field label="Data effettuata">
                      <input
                        type="date"
                        value={form.medical_visit_date}
                        onChange={(e) => handleMedicalVisitDateChange(e.target.value)}
                      />
                    </Field>

                    <Field label="Scadenza visita medica">
                      <input
                        type="date"
                        value={form.medical_visit_expiry}
                        readOnly
                      />
                    </Field>
                  </div>
                ) : null}

                <Field label="Note">
                  <input
                    value={form.medical_visit_notes}
                    onChange={(e) => set('medical_visit_notes', e.target.value)}
                    placeholder="es. idoneo con prescrizioni…"
                  />
                </Field>

                <div className="employee-form__document-panel">
                  <div className="employee-form__document-title">📎 Allegato visita medica</div>
                  {employee?.id ? (
                    <DocumentActions
                      document={employeeDocuments.medical_visit_document}
                      onUpload={() =>
                        handleDocumentAction(
                          () => window.api.employees.uploadMedicalVisitDocument(employee.id),
                          'Errore caricamento allegato visita medica',
                          { documentKey: 'medical_visit_document', busyKey: 'medical_visit_document' }
                        )
                      }
                      onOpen={() =>
                        handleOpenDocument(
                          () => window.api.employees.openMedicalVisitDocument(employee.id),
                          'Errore apertura allegato visita medica'
                        )
                      }
                      onDelete={() =>
                        handleDocumentAction(
                          async () => {
                            if (!window.confirm("Confermi l'eliminazione dell'allegato visita medica?")) {
                              return { canceled: true };
                            }
                            return window.api.employees.deleteMedicalVisitDocument(employee.id);
                          },
                          'Errore eliminazione allegato visita medica',
                          { documentKey: 'medical_visit_document', busyKey: 'medical_visit_document' }
                        )
                      }
                      emptyLabel="Nessun allegato visita medica"
                      loading={documentBusyKey === 'medical_visit_document'}
                    />
                  ) : (
                    <div className="employee-form__compact-note">Salva prima la scheda per caricare l'allegato.</div>
                  )}
                </div>
              </SecurityCard>

              <SecurityCard badge="🎓" title="Formazione Art. 37">
                <div className="employee-form__security-checks">
                  <CheckRow
                    id="a37_req"
                    label="Richiesta"
                    checked={form.art37_required}
                    onChange={(v) => set('art37_required', v)}
                  />
                  <CheckRow
                    id="a37_done"
                    label="Effettuata"
                    checked={form.art37_done}
                    onChange={(v) => set('art37_done', v)}
                  />
                  {form.art37_done ? (
                    <CheckRow
                      id="a37_us"
                      label="Tramite la nostra azienda"
                      checked={form.art37_done_with_us}
                      onChange={(v) => set('art37_done_with_us', v)}
                    />
                  ) : null}
                </div>

                {form.art37_done ? (
                  <div className="employee-form__security-fields">
                    <Field label="Data effettuata">
                      <input
                        type="date"
                        value={form.art37_date}
                        onChange={(e) => handleArt37DateChange(e.target.value)}
                      />
                    </Field>

                    <Field label="Scadenza formazione">
                      <input
                        type="date"
                        value={form.art37_expiry}
                        readOnly
                      />
                    </Field>
                  </div>
                ) : null}

                <Field label="Note">
                  <input
                    value={form.art37_notes}
                    onChange={(e) => set('art37_notes', e.target.value)}
                    placeholder="es. corso completato 8h…"
                  />
                </Field>

                <div className="employee-form__document-panel">
                  <div className="employee-form__document-title">📎 Allegato formazione</div>
                  {employee?.id ? (
                    <DocumentActions
                      document={employeeDocuments.art37_document}
                      onUpload={() =>
                        handleDocumentAction(
                          () => window.api.employees.uploadArt37Document(employee.id),
                          'Errore caricamento allegato formazione art. 37',
                          {
                            documentKey: 'art37_document',
                            busyKey: 'art37_document',
                            perfName: 'formazione',
                          }
                        )
                      }
                      onOpen={() =>
                        handleOpenDocument(
                          () => window.api.employees.openArt37Document(employee.id),
                          'Errore apertura allegato formazione art. 37'
                        )
                      }
                      onDelete={() =>
                        handleDocumentAction(
                          async () => {
                            if (!window.confirm("Confermi l'eliminazione dell'allegato formazione art. 37?")) {
                              return { canceled: true };
                            }
                            return window.api.employees.deleteArt37Document(employee.id);
                          },
                          'Errore eliminazione allegato formazione art. 37',
                          { documentKey: 'art37_document', busyKey: 'art37_document' }
                        )
                      }
                      emptyLabel="Nessun allegato formazione art. 37"
                      loading={documentBusyKey === 'art37_document'}
                      loadingLabel="Salvataggio formazione in corso..."
                    />
                  ) : (
                    <div className="employee-form__compact-note">Salva prima la scheda per caricare l'allegato.</div>
                  )}
                </div>
              </SecurityCard>

              <SecurityCard badge="🥾" title="DPI">
                <div className="employee-form__security-checks">
                  <CheckRow
                    id="dpi_assigned"
                    label="DPI consegnati"
                    checked={dpiAssignments.length > 0}
                    onChange={() => {}}
                    disabled
                  />
                </div>

                <div className="employee-form__dpi-summary">
                  <div className="employee-form__dpi-summary-line">
                    <span>Assegnazioni</span>
                    <strong>{dpiAssignments.length}</strong>
                  </div>
                  <div className="employee-form__dpi-summary-line">
                    <span>Ultima consegna</span>
                    <strong>{latestDpiAssignment ? formatDisplayDate(latestDpiAssignment.assigned_date) : '—'}</strong>
                  </div>
                </div>

                <Field label="Note DPI">
                  <input
                    value={latestDpiAssignment?.notes || ''}
                    readOnly
                    placeholder="Nessuna nota DPI disponibile"
                  />
                </Field>

                {dpiAssignments.length ? (
                  <div className="employee-form__dpi-list">
                    {dpiAssignments.slice(0, 3).map((assignment) => (
                      <div key={assignment.id} className="employee-form__dpi-item">
                        <strong>{assignment.item_type}{assignment.item_description ? ` - ${assignment.item_description}` : ''}</strong>
                        <span>Qty {Number(assignment.quantity || 0)} • {formatDisplayDate(assignment.assigned_date)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="employee-form__document-panel">
                  <div className="employee-form__document-title">📎 Allegato consegna DPI</div>
                  {employee?.id ? (
                    <DocumentActions
                      document={employeeDocuments.dpi_delivery_document}
                      onUpload={() =>
                        handleDocumentAction(
                          () => window.api.employees.uploadDpiDeliveryDocument(employee.id),
                          'Errore caricamento allegato consegna DPI',
                          { documentKey: 'dpi_delivery_document', busyKey: 'dpi_delivery_document' }
                        )
                      }
                      onOpen={() =>
                        handleOpenDocument(
                          () => window.api.employees.openDpiDeliveryDocument(employee.id),
                          'Errore apertura allegato consegna DPI'
                        )
                      }
                      onDelete={() =>
                        handleDocumentAction(
                          async () => {
                            if (!window.confirm("Confermi l'eliminazione dell'allegato consegna DPI?")) {
                              return { canceled: true };
                            }
                            return window.api.employees.deleteDpiDeliveryDocument(employee.id);
                          },
                          'Errore eliminazione allegato consegna DPI',
                          { documentKey: 'dpi_delivery_document', busyKey: 'dpi_delivery_document' }
                        )
                      }
                      emptyLabel="Nessun allegato consegna DPI"
                      loading={documentBusyKey === 'dpi_delivery_document'}
                    />
                  ) : (
                    <div className="employee-form__compact-note">Salva prima la scheda per caricare l'allegato.</div>
                  )}
                </div>
              </SecurityCard>
            </div>
          </SectionCard>

          <SectionTitle>Note Generali</SectionTitle>

          <Field label="Note">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              placeholder="Altre informazioni…"
            />
          </Field>

          <SectionTitle>📎 Allegati</SectionTitle>

          {employee?.id ? (
            <>
            <div className="employee-form-attachments" style={{ display: 'grid', gap: 12 }}>
              {(employmentPeriods || []).length ? (
                <div style={{ display: 'grid', gap: 14 }}>
                  {['LC', 'LG', 'ENTRAMBE'].map((employerCode) => {
                    const periods = employmentPeriods.filter((period) => (period.hired_by || '') === employerCode);
                    if (!periods.length) return null;

                    return (
                      <div
                        key={employerCode}
                        style={{
                          display: 'grid',
                          gap: 12,
                          padding: 16,
                          borderRadius: 18,
                          border: '1px solid rgba(20, 33, 61, 0.08)',
                          background: 'rgba(244, 248, 248, 0.78)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: 16, fontWeight: 800 }}>Documenti rapporto {employerCode}</div>
                            <div style={{ fontSize: 13, color: '#667085' }}>
                              PDF assunzione collegati al rapporto di lavoro specifico.
                            </div>
                          </div>
                          <span
                            className="soft-chip"
                            style={{ background: 'rgba(15, 118, 110, 0.12)', color: '#115e59' }}
                          >
                            {periods.length} rapporti
                          </span>
                        </div>

                        {periods.map((period) => (
                          <div key={period.id} style={{ display: 'grid', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: 14 }}>
                                {formatDisplayDate(period.hire_date_from)} → {period.hire_date_to ? formatDisplayDate(period.hire_date_to) : 'attivo'}
                              </strong>
                              {period.is_current ? (
                                <span className="soft-chip" style={{ background: 'rgba(37, 99, 235, 0.12)', color: '#1d4ed8' }}>
                                  Rapporto corrente
                                </span>
                              ) : null}
                            </div>

                            <DocumentActions
                              document={period.hire_document}
                              onUpload={() =>
                                handleDocumentAction(
                                  () => window.api.employees.uploadHireDocumentForPeriod(employee.id, period.id),
                                  'Errore caricamento allegato assunzione rapporto'
                                )
                              }
                              onOpen={() =>
                                handleOpenDocument(
                                  () => window.api.employees.openHireDocumentForPeriod(employee.id, period.id),
                                  'Errore apertura allegato assunzione rapporto'
                                )
                              }
                              onDelete={() =>
                                handleDocumentAction(
                                  async () => {
                                    if (!window.confirm("Confermi l'eliminazione dell'allegato assunzione per questo rapporto?")) {
                                      return { canceled: true };
                                    }
                                    return window.api.employees.deleteHireDocumentForPeriod(employee.id, period.id);
                                  },
                                  'Errore eliminazione allegato assunzione rapporto'
                                )
                              }
                              emptyLabel={`Nessun allegato assunzione per rapporto ${employerCode}`}
                            />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {employeeDocuments.legacy_hire_document ? (
                <DocumentActions
                  document={employeeDocuments.legacy_hire_document}
                  onUpload={() =>
                    handleDocumentAction(
                      () => window.api.employees.uploadHireDocument(employee.id),
                      'Errore caricamento allegato assunzione'
                    )
                  }
                  onOpen={() =>
                    handleOpenDocument(
                      () => window.api.employees.openHireDocument(employee.id),
                      'Errore apertura allegato assunzione'
                    )
                  }
                  onDelete={() =>
                    handleDocumentAction(
                      async () => {
                        if (!window.confirm("Confermi l'eliminazione dell'allegato assunzione legacy?")) {
                          return { canceled: true };
                        }
                        return window.api.employees.deleteHireDocument(employee.id);
                      },
                      'Errore eliminazione allegato assunzione'
                    )
                  }
                  emptyLabel="Nessun allegato assunzione legacy"
                />
              ) : null}

            </div>
            </>
          ) : (
            <div style={infoBoxStyle}>
              Salva prima la scheda: dopo il primo salvataggio potrai allegare assunzione, formazione art. 37, visita medica e consegna DPI.
            </div>
          )}

          </div>

          <div className="employee-form__footer">
            <div className="employee-form__footer-status">
              {isDirty ? (
                <span className="soft-chip" style={{ background: 'rgba(245, 158, 11, 0.14)', color: '#b45309', borderColor: 'rgba(245, 158, 11, 0.18)' }}>
                  Modifiche non salvate
                </span>
              ) : (
                <span className="soft-chip" style={{ background: 'rgba(22, 163, 74, 0.14)', color: '#14532d', borderColor: 'rgba(22, 101, 52, 0.14)' }}>
                  Dati sincronizzati
                </span>
              )}
            </div>
            <div className="employee-form__footer-actions">
              <button type="button" className="button-secondary" onClick={requestClose}>Annulla</button>
              <button type="submit" className="button">{employee ? 'Salva Modifiche' : 'Aggiungi'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const grid2 = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};

const grid3 = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
};

const infoBoxStyle = {
  background: '#eef2ff',
  border: '1px solid #c7d2fe',
  borderRadius: 10,
  padding: 12,
  fontSize: 14,
};

const historyBoxStyle = {
  background: '#f0fdf4',
  border: '1px solid #bbf7d0',
  borderRadius: 12,
  padding: 14,
};
