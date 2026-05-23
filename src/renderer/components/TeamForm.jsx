import React, { useEffect, useMemo, useState } from 'react';

function Field({ label, children }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 700 }}>{label}</label>
      {children}
    </div>
  );
}

function InfoCell({ label, value }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#667085', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{value || '—'}</span>
    </div>
  );
}

const emptyForm = {
  name: '',
  notes: '',
  attendance_mode: 'details',
  team_daily_rate: '',
  members: [],
};

function normalizeDecimalInput(value) {
  return String(value ?? '')
    .replace(',', '.')
    .trim();
}

function parseTeamDailyRateInput(value) {
  const normalized = normalizeDecimalInput(value);
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeTeamFormForDirtyCheck(form) {
  return JSON.stringify({
    name: form.name || '',
    notes: form.notes || '',
    attendance_mode: form.attendance_mode === 'headcount' ? 'headcount' : 'details',
    team_daily_rate: form.team_daily_rate === '' || form.team_daily_rate === null || form.team_daily_rate === undefined
      ? ''
      : String(form.team_daily_rate),
    members: (form.members || []).map((member) => ({
      employee_id: Number(member.employee_id),
      compensation: member.compensation === '' || member.compensation === null || member.compensation === undefined
        ? ''
        : String(member.compensation),
      manage_by_days: !!member.manage_by_days,
      notes: member.notes || '',
    })),
  });
}

function formatHireDate(employee) {
  if (employee.hire_date_from || employee.hire_date_to) {
    return `${employee.hire_date_from || '—'} → ${employee.hire_date_to || '—'}`;
  }
  return employee.hire_date || '—';
}

function normalizeTeamSortText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getEmployeeFallbackName(employee) {
  return String(
    employee?.full_name ||
    employee?.displayName ||
    employee?.name ||
    [employee?.last_name, employee?.first_name].filter(Boolean).join(' ') ||
    [employee?.first_name, employee?.last_name].filter(Boolean).join(' ')
  ).trim();
}

function compareEmployeeByLastNameThenFirstName(a, b) {
  const lastCompare = normalizeTeamSortText(a?.last_name).localeCompare(
    normalizeTeamSortText(b?.last_name),
    'it',
    { sensitivity: 'base' }
  );
  if (lastCompare !== 0) return lastCompare;

  const firstCompare = normalizeTeamSortText(a?.first_name).localeCompare(
    normalizeTeamSortText(b?.first_name),
    'it',
    { sensitivity: 'base' }
  );
  if (firstCompare !== 0) return firstCompare;

  return normalizeTeamSortText(getEmployeeFallbackName(a)).localeCompare(
    normalizeTeamSortText(getEmployeeFallbackName(b)),
    'it',
    { sensitivity: 'base' }
  );
}

function isEmployeeAvailableStatus(employee) {
  const status = normalizeTeamSortText(employee?.status);
  return status === 'attivo' || status === 'active';
}

export default function TeamForm({ open, onClose, onSubmit, team, employees = [], teams = [] }) {
  const [form, setForm] = useState(emptyForm);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [saving, setSaving] = useState(false);
  const initialSnapshot = useMemo(
    () => normalizeTeamFormForDirtyCheck(
      team
        ? {
            name: team.name || '',
            notes: team.notes || '',
            attendance_mode: team.attendance_mode === 'headcount' ? 'headcount' : 'details',
            team_daily_rate: team.team_daily_rate ?? '',
            members: (team.members || []).map((member) => ({
              employee_id: member.employee_id,
              compensation: member.compensation ?? '',
              manage_by_days: !!member.manage_by_days,
              notes: member.notes || '',
            })),
          }
        : emptyForm
    ),
    [team]
  );
  const currentSnapshot = useMemo(() => normalizeTeamFormForDirtyCheck(form), [form]);
  const isDirty = initialSnapshot !== currentSnapshot;

  useEffect(() => {
    if (!open) return;
    const nextRateValue = team?.team_daily_rate ?? '';
    console.info('[team-rate-debug] loaded team_daily_rate =', nextRateValue);
    setForm(
      team
        ? {
            name: team.name || '',
            notes: team.notes || '',
            attendance_mode: team.attendance_mode === 'headcount' ? 'headcount' : 'details',
            team_daily_rate: team.team_daily_rate ?? '',
            members: (team.members || []).map((member) => ({
              employee_id: member.employee_id,
              compensation: member.compensation ?? '',
              manage_by_days: !!member.manage_by_days,
              notes: member.notes || '',
            })),
          }
        : emptyForm
    );
    setSelectedEmployeeId('');
    setSaving(false);
  }, [open, team]);

  const selectableEmployees = useMemo(() => {
    const selectedIds = new Set(form.members.map((member) => Number(member.employee_id)));
    const currentTeamId = Number(team?.id);
    const assignedToOtherTeams = new Set();

    teams.forEach((currentTeam) => {
      if (currentTeam?.is_archived) return;
      if (Number(currentTeam?.id) === currentTeamId) return;

      (currentTeam?.members || []).forEach((member) => {
        const employeeId = Number(member?.employee_id);
        if (Number.isFinite(employeeId)) {
          assignedToOtherTeams.add(employeeId);
        }
      });
    });

    return [...employees]
      .filter((employee) => isEmployeeAvailableStatus(employee))
      .filter((employee) => !selectedIds.has(Number(employee.id)))
      .filter((employee) => !assignedToOtherTeams.has(Number(employee.id)))
      .sort(compareEmployeeByLastNameThenFirstName);
  }, [employees, form.members, team?.id, teams]);

  function addMember() {
    if (saving) return;
    const employeeId = Number(selectedEmployeeId);
    if (!employeeId) return;

    const employee = employees.find((item) => Number(item.id) === employeeId);
    setForm((current) => ({
      ...current,
      members: [
        ...current.members,
        {
          employee_id: employeeId,
          compensation: employee?.daily_pay ?? '',
          manage_by_days: false,
          notes: '',
        },
      ],
    }));
    setSelectedEmployeeId('');
  }

  function updateMember(index, field, value) {
    if (saving) return;
    setForm((current) => ({
      ...current,
      members: current.members.map((member, currentIndex) =>
        currentIndex === index ? { ...member, [field]: value } : member
      ),
    }));
  }

  function removeMember(index) {
    if (saving) return;
    setForm((current) => ({
      ...current,
      members: current.members.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        notes: form.notes.trim(),
        attendance_mode: form.attendance_mode === 'headcount' ? 'headcount' : 'details',
        team_daily_rate: parseTeamDailyRateInput(form.team_daily_rate),
        members: form.members.map((member) => ({
          employee_id: Number(member.employee_id),
          compensation: member.compensation === '' ? null : Number(member.compensation),
          manage_by_days: !!member.manage_by_days,
          notes: member.notes || '',
        })),
      };
      console.info('[team-rate-debug] payload =', payload);
      await onSubmit(payload);
    } finally {
      setSaving(false);
    }
  }

  function requestClose() {
    if (saving) return;
    if (isDirty && !window.confirm('Ci sono modifiche non salvate. Vuoi chiudere comunque la scheda?')) {
      return;
    }
    onClose();
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div className="modal-dialog team-form-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header team-form__header">
          <div>
            <span className="page-kicker">{team ? 'Scheda squadra' : 'Nuova squadra'}</span>
            <h2 style={{ margin: '6px 0 0' }}>{team ? 'Modifica Squadra' : 'Crea Nuova Squadra'}</h2>
          </div>
          <button type="button" className="modal-close" onClick={requestClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="team-form">
          <div className="form-grid team-form__body">
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 1fr)' }}>
              <Field label="Nome squadra *">
                <input
                  value={form.name}
                  disabled={saving}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="es. Squadra Serra Nord"
                  required
                />
              </Field>

              <Field label="Note">
                <textarea
                  rows="2"
                  value={form.notes}
                  disabled={saving}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Responsabile, commessa, appunti..."
                />
              </Field>
            </div>

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(220px, 300px) minmax(220px, 300px) minmax(0, 1fr)' }}>
              <Field label="Modalita gestione presenze">
                <select
                  value={form.attendance_mode}
                  disabled={saving}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      attendance_mode: event.target.value === 'headcount' ? 'headcount' : 'details',
                    }))
                  }
                >
                  <option value="details">Dettaglio dipendenti</option>
                  <option value="headcount">Numero presenti</option>
                </select>
              </Field>

              <Field label="Tariffa giornaliera squadra">
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.team_daily_rate}
                  disabled={saving}
                  onChange={(event) => {
                    const rawValue = event.target.value;
                    console.info('[team-rate-debug] form value =', rawValue);
                    setForm((current) => ({ ...current, team_daily_rate: rawValue }));
                  }}
                  placeholder="es. 55"
                />
              </Field>

              <div
                style={{
                  alignSelf: 'end',
                  padding: '11px 14px',
                  borderRadius: 14,
                  border: '1px solid rgba(20, 33, 61, 0.08)',
                  background: 'rgba(244, 248, 248, 0.72)',
                  color: '#526071',
                  fontSize: 13,
                }}
              >
                {form.attendance_mode === 'headcount'
                  ? 'Nel Foglio Presenze verra mostrata una sola riga squadra e in ogni giorno inserirai il numero dei presenti.'
                  : 'Nel Foglio Presenze continueranno a comparire i singoli dipendenti della squadra.'}
              </div>
            </div>

            <div
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
                  <div style={{ fontSize: 16, fontWeight: 800 }}>Componenti della squadra</div>
                  <div style={{ fontSize: 13, color: '#667085' }}>
                    Seleziona i dipendenti gia presenti in anagrafica e personalizza compenso e gestione.
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(260px, 1fr) auto' }}>
                <select value={selectedEmployeeId} disabled={saving} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
                  <option value="">Seleziona dipendente da aggiungere...</option>
                  {selectableEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.first_name} {employee.last_name}
                    </option>
                  ))}
                </select>
                <button type="button" className="button-secondary" onClick={addMember} disabled={saving || !selectedEmployeeId}>
                  Aggiungi
                </button>
              </div>

              {form.members.length ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  {form.members.map((member, index) => {
                    const employee = employees.find((item) => Number(item.id) === Number(member.employee_id));
                    if (!employee) return null;

                    return (
                      <div key={`${member.employee_id}-${index}`} className="team-member-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: 16, fontWeight: 800 }}>
                              {employee.first_name} {employee.last_name}
                            </div>
                            <div style={{ fontSize: 13, color: '#667085' }}>{employee.role || 'Nessuna mansione'}</div>
                          </div>

                          <button
                            type="button"
                            className="button-danger"
                            onClick={() => removeMember(index)}
                            disabled={saving}
                            style={{ minWidth: 110 }}
                          >
                            Rimuovi
                          </button>
                        </div>

                        <div className="team-member-meta">
                          <InfoCell label="Data assunzione" value={formatHireDate(employee)} />
                          <InfoCell label="Scadenza visita medica" value={employee.medical_visit_expiry || '—'} />
                          <InfoCell label="Scadenza formazione" value={employee.art37_expiry || '—'} />
                        </div>

                        <div className="team-member-grid">
                          <Field label="Compenso squadra (€)">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={member.compensation}
                              disabled={saving}
                              onChange={(event) => updateMember(index, 'compensation', event.target.value)}
                              placeholder="Compenso dedicato"
                            />
                          </Field>

                          <Field label="Gestione">
                            <label
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                minHeight: 48,
                                padding: '0 14px',
                                borderRadius: 14,
                                border: '1px solid rgba(20, 33, 61, 0.08)',
                                background: 'rgba(255,255,255,0.9)',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={member.manage_by_days}
                                disabled={saving}
                                onChange={(event) => updateMember(index, 'manage_by_days', event.target.checked)}
                                style={{ width: 18, height: 18 }}
                              />
                              <span>Gestione a giornate</span>
                            </label>
                          </Field>

                          <Field label="Note componente">
                            <input
                              value={member.notes}
                              disabled={saving}
                              onChange={(event) => updateMember(index, 'notes', event.target.value)}
                              placeholder="Note opzionali per il componente"
                            />
                          </Field>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state" style={{ padding: 18 }}>
                  Nessun componente inserito. Usa "Aggiungi" per comporre la squadra.
                </div>
              )}
            </div>
          </div>
          </div>

          <div className="team-form__footer">
            <div className="team-form__footer-status">
              <span className="soft-chip" style={{ background: 'rgba(15, 118, 110, 0.10)', color: '#115e59' }}>
                Dati squadra sincronizzati
              </span>
            </div>
            <div className="team-form__footer-actions">
              <button type="button" className="button-secondary" onClick={requestClose} disabled={saving}>
                Annulla
              </button>
              <button type="submit" className="button" disabled={saving}>
                {saving ? 'Salvataggio squadra...' : team ? 'Salva squadra' : 'Crea squadra'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
