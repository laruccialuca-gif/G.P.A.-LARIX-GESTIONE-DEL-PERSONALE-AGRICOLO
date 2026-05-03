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
  members: [],
};

function normalizeTeamFormForDirtyCheck(form) {
  return JSON.stringify({
    name: form.name || '',
    notes: form.notes || '',
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

export default function TeamForm({ open, onClose, onSubmit, team, employees = [] }) {
  const [form, setForm] = useState(emptyForm);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const initialSnapshot = useMemo(
    () => normalizeTeamFormForDirtyCheck(
      team
        ? {
            name: team.name || '',
            notes: team.notes || '',
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
    setForm(
      team
        ? {
            name: team.name || '',
            notes: team.notes || '',
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
  }, [open, team]);

  const selectableEmployees = useMemo(() => {
    const selectedIds = new Set(form.members.map((member) => Number(member.employee_id)));
    return employees.filter((employee) => !selectedIds.has(Number(employee.id)));
  }, [employees, form.members]);

  function addMember() {
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
    setForm((current) => ({
      ...current,
      members: current.members.map((member, currentIndex) =>
        currentIndex === index ? { ...member, [field]: value } : member
      ),
    }));
  }

  function removeMember(index) {
    setForm((current) => ({
      ...current,
      members: current.members.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      name: form.name.trim(),
      notes: form.notes.trim(),
      members: form.members.map((member) => ({
        employee_id: Number(member.employee_id),
        compensation: member.compensation === '' ? null : Number(member.compensation),
        manage_by_days: !!member.manage_by_days,
        notes: member.notes || '',
      })),
    });
  }

  function requestClose() {
    if (isDirty && !window.confirm('Ci sono modifiche non salvate. Vuoi chiudere comunque la scheda?')) {
      return;
    }
    onClose();
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div className="modal-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="page-kicker">{team ? 'Scheda squadra' : 'Nuova squadra'}</span>
            <h2 style={{ margin: '6px 0 0' }}>{team ? 'Modifica Squadra' : 'Crea Nuova Squadra'}</h2>
          </div>
          <button type="button" className="modal-close" onClick={requestClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="form-grid">
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 1fr)' }}>
              <Field label="Nome squadra *">
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="es. Squadra Serra Nord"
                  required
                />
              </Field>

              <Field label="Note">
                <textarea
                  rows="2"
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Responsabile, commessa, appunti..."
                />
              </Field>
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
                <select value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
                  <option value="">Seleziona dipendente da aggiungere...</option>
                  {selectableEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.first_name} {employee.last_name}
                    </option>
                  ))}
                </select>
                <button type="button" className="button-secondary" onClick={addMember} disabled={!selectedEmployeeId}>
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
                                onChange={(event) => updateMember(index, 'manage_by_days', event.target.checked)}
                                style={{ width: 18, height: 18 }}
                              />
                              <span>Gestione a giornate</span>
                            </label>
                          </Field>

                          <Field label="Note componente">
                            <input
                              value={member.notes}
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

          <div className="actions-row" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
            <button type="button" className="button-secondary" onClick={requestClose}>
              Annulla
            </button>
            <button type="submit" className="button">
              {team ? 'Salva squadra' : 'Crea squadra'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
