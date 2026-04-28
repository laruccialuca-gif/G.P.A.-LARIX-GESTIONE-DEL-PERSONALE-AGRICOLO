import React, { useEffect, useMemo, useState } from 'react';
import DocumentActions from './DocumentActions';

const contractLabels = {
  tempo_indeterminato: 'Tempo Indeterminato',
  tempo_determinato: 'Tempo Determinato',
  apprendistato: 'Apprendistato',
  stagionale: 'Stagionale',
  partita_iva: 'Partita IVA',
};

const DAILY_PAY_OPTIONS = [50, 55, 60, 65, 70];

function SectionTitle({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: '#4338ca',
        }}
      >
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
    </div>
  );
}

function CheckRow({ id, label, checked, onChange }) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        padding: '10px 12px',
        borderRadius: 14,
        background: 'rgba(255,255,255,0.62)',
        border: '1px solid rgba(20, 33, 61, 0.06)',
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={!!checked}
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

function formatDisplayDate(value) {
  if (!value) return '—';
  const clean = String(value).split('T')[0];
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return clean;
}

const emptyForm = {
  first_name: '',
  last_name: '',
  fiscal_code: '',
  role: '',
  contract_type: 'tempo_indeterminato',
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
  });
  const [historyMatches, setHistoryMatches] = useState([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState('');
  const [occupations, setOccupations] = useState([]);
  const [newOccupation, setNewOccupation] = useState('');
  const [employeeDocuments, setEmployeeDocuments] = useState({
    hire_document: null,
    legacy_hire_document: null,
    art37_document: null,
    medical_visit_document: null,
  });
  const [employmentPeriods, setEmploymentPeriods] = useState([]);
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
    setEmployeeDocuments({
      hire_document: employee?.hire_document || null,
      legacy_hire_document: employee?.legacy_hire_document || null,
      art37_document: employee?.art37_document || null,
      medical_visit_document: employee?.medical_visit_document || null,
    });
    setEmploymentPeriods(employee?.employment_periods || []);
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
          label: `${item.short_name} · ${item.name}`,
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
          : form.overtime_hourly_rate !== ''
          ? Number(form.overtime_hourly_rate)
          : undefined,
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
  const exampleEarning = stdH > 0 && pay > 0 ? ((pay / stdH) * exampleHours).toFixed(2) : null;

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
        });
        setEmploymentPeriods(fresh.employment_periods || []);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDocumentAction(action, errorMessage) {
    try {
      const result = await action();
      if (!result?.canceled) {
        await refreshEmployeeDocuments();
      }
    } catch (err) {
      console.error(err);
      alert(errorMessage);
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
      <div className="modal-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="page-kicker">{employee ? 'Scheda dipendente' : 'Nuovo inserimento'}</span>
            <h2 style={{ margin: '6px 0 0' }}>{employee ? 'Modifica Dipendente' : 'Nuovo Dipendente'}</h2>
          </div>
          <button type="button" className="modal-close" onClick={requestClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="form-grid">
          <SectionTitle>Anagrafica</SectionTitle>

          <div style={grid2}>
            <Field label="Nome *">
              <input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} required />
            </Field>
            <Field label="Cognome *">
              <input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} required />
            </Field>
          </div>

          <div style={grid2}>
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
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
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
                      {match.hired_by ? ` · Datore attuale/storico: ${match.hired_by}` : ''}
                      {!match.is_deleted ? ' · Scheda gia attiva nel gestionale' : ''}
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

          <div style={grid2}>
            <Field label="Telefono">
              <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
          </div>

          <SectionTitle>Contratto e Retribuzione</SectionTitle>

          <div style={grid2}>
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

          <div style={grid3}>
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

          <div style={grid2}>
            <Field label="Retribuzione giornaliera (€ / 7 ore)">
              <select
                value={
                  form.daily_pay !== '' && DAILY_PAY_OPTIONS.includes(Number(form.daily_pay))
                    ? String(form.daily_pay)
                    : 'custom'
                }
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    set('daily_pay', '');
                  } else {
                    set('daily_pay', e.target.value);
                  }
                }}
              >
                {DAILY_PAY_OPTIONS.map((p) => (
                  <option key={p} value={String(p)}>
                    € {p} / 7h
                  </option>
                ))}
                <option value="custom">Altro importo</option>
              </select>

              {(!DAILY_PAY_OPTIONS.includes(Number(form.daily_pay)) || form.daily_pay === '') && (
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.daily_pay}
                  onChange={(e) => set('daily_pay', e.target.value)}
                  placeholder="Importo personalizzato (€)"
                  style={{ marginTop: 8 }}
                />
              )}
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

          <div style={grid2}>
            <Field label="Gestione straordinario">
              <select
                value={form.overtime_use_general_rate ? 'general' : 'custom'}
                onChange={(e) => set('overtime_use_general_rate', e.target.value === 'general')}
                disabled={!settingsGeneral.overtime_enabled}
              >
                <option value="general">Usa tariffa generale</option>
                <option value="custom">Tariffa personalizzata</option>
              </select>
            </Field>

            <Field label="Tariffa straordinario (€ / ora)">
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.overtime_use_general_rate ? settingsGeneral.overtime_hourly_rate : form.overtime_hourly_rate}
                disabled={!settingsGeneral.overtime_enabled || form.overtime_use_general_rate}
                onChange={(e) => set('overtime_hourly_rate', e.target.value)}
                placeholder="Importo orario straordinario"
              />
            </Field>
          </div>

          <div style={infoBoxStyle}>
            Straordinario {settingsGeneral.overtime_enabled ? 'attivo' : 'disattivato'}.
            {settingsGeneral.overtime_enabled ? (
              <>
                {' '}Tariffa generale: <strong>€ {Number(settingsGeneral.overtime_hourly_rate || 0).toFixed(2)} / ora</strong>.
                {!form.overtime_use_general_rate ? ' Questo dipendente usa una tariffa personalizzata.' : ' Questo dipendente usa la tariffa generale.'}
              </>
            ) : (
              <> Attivalo dalle impostazioni generali per usarlo nei report.</>
            )}
          </div>

          {exampleEarning && (
            <div style={infoBoxStyle}>
              💡 <strong>Esempio calcolo:</strong> per {exampleHours} ore lavorate →{' '}
              <strong>€ {exampleEarning}</strong>{' '}
              <span style={{ color: '#6b7280' }}>(€{pay} ÷ {stdH}h × {exampleHours}h)</span>
            </div>
          )}

          <SectionTitle>Visita Medica</SectionTitle>

          <div style={{ display: 'grid', gap: 10 }}>
            <CheckRow
              id="mv_req"
              label="Visita medica richiesta"
              checked={form.medical_visit_required}
              onChange={(v) => set('medical_visit_required', v)}
            />

            <CheckRow
              id="mv_done"
              label="Visita medica effettuata"
              checked={form.medical_visit_done}
              onChange={(v) => set('medical_visit_done', v)}
            />

            {form.medical_visit_done && (
              <CheckRow
                id="mv_us"
                label="Effettuata tramite la nostra azienda"
                checked={form.medical_visit_done_with_us}
                onChange={(v) => set('medical_visit_done_with_us', v)}
              />
            )}

            {form.medical_visit_done && (
              <div style={grid2}>
                <Field label="Data visita">
                  <input
                    type="date"
                    value={form.medical_visit_date}
                    onChange={(e) => set('medical_visit_date', e.target.value)}
                  />
                </Field>

                <Field label="Scadenza visita">
                  <input
                    type="date"
                    value={form.medical_visit_expiry}
                    onChange={(e) => set('medical_visit_expiry', e.target.value)}
                  />
                </Field>
              </div>
            )}

            <Field label="Note visita medica">
              <input
                value={form.medical_visit_notes}
                onChange={(e) => set('medical_visit_notes', e.target.value)}
                placeholder="es. idoneo con prescrizioni…"
              />
            </Field>
          </div>

          <SectionTitle>Formazione Art. 37</SectionTitle>

          <div style={{ display: 'grid', gap: 10 }}>
            <CheckRow
              id="a37_req"
              label="Formazione Art. 37 richiesta"
              checked={form.art37_required}
              onChange={(v) => set('art37_required', v)}
            />

            <CheckRow
              id="a37_done"
              label="Formazione Art. 37 effettuata"
              checked={form.art37_done}
              onChange={(v) => set('art37_done', v)}
            />

            {form.art37_done && (
              <CheckRow
                id="a37_us"
                label="Effettuata tramite la nostra azienda"
                checked={form.art37_done_with_us}
                onChange={(v) => set('art37_done_with_us', v)}
              />
            )}

            {form.art37_done && (
              <div style={grid2}>
                <Field label="Data formazione">
                  <input
                    type="date"
                    value={form.art37_date}
                    onChange={(e) => set('art37_date', e.target.value)}
                  />
                </Field>

                <Field label="Scadenza formazione">
                  <input
                    type="date"
                    value={form.art37_expiry}
                    onChange={(e) => set('art37_expiry', e.target.value)}
                  />
                </Field>
              </div>
            )}

            <Field label="Note formazione">
              <input
                value={form.art37_notes}
                onChange={(e) => set('art37_notes', e.target.value)}
                placeholder="es. corso completato 8h…"
              />
            </Field>
          </div>

          <SectionTitle>Note Generali</SectionTitle>

          <Field label="Note">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              placeholder="Altre informazioni…"
            />
          </Field>

          <SectionTitle>Allegati Dipendente</SectionTitle>

          {employee?.id ? (
            <div style={{ display: 'grid', gap: 12 }}>
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
                                    if (!window.confirm('Confermi l’eliminazione dell’allegato assunzione per questo rapporto?')) {
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
                        if (!window.confirm('Confermi l’eliminazione dell’allegato assunzione legacy?')) {
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

              <DocumentActions
                document={employeeDocuments.art37_document}
                onUpload={() =>
                  handleDocumentAction(
                    () => window.api.employees.uploadArt37Document(employee.id),
                    'Errore caricamento allegato formazione art. 37'
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
                      if (!window.confirm('Confermi l’eliminazione dell’allegato formazione art. 37?')) {
                        return { canceled: true };
                      }
                      return window.api.employees.deleteArt37Document(employee.id);
                    },
                    'Errore eliminazione allegato formazione art. 37'
                  )
                }
                emptyLabel="Nessun allegato formazione art. 37"
              />

              <DocumentActions
                document={employeeDocuments.medical_visit_document}
                onUpload={() =>
                  handleDocumentAction(
                    () => window.api.employees.uploadMedicalVisitDocument(employee.id),
                    'Errore caricamento allegato visita medica'
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
                      if (!window.confirm('Confermi l’eliminazione dell’allegato visita medica?')) {
                        return { canceled: true };
                      }
                      return window.api.employees.deleteMedicalVisitDocument(employee.id);
                    },
                    'Errore eliminazione allegato visita medica'
                  )
                }
                emptyLabel="Nessun allegato visita medica"
              />
            </div>
          ) : (
            <div style={infoBoxStyle}>
              Salva prima la scheda: dopo il primo salvataggio potrai allegare assunzione, formazione art. 37 e visita medica.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="button-secondary" onClick={requestClose}>Annulla</button>
            <button type="submit" className="button">{employee ? 'Salva Modifiche' : 'Aggiungi'}</button>
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
