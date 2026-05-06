import React, { useEffect, useMemo, useState } from 'react';

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthString(date = new Date()) {
  return formatLocalDate(date).slice(0, 7);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(Number(value || 0));
}

function formatDateLabel(value) {
  if (!value) return '-';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return [day, month, year].filter(Boolean).join('/');
}

function movementTypeLabel(type) {
  return type === 'installment' ? 'Rata' : 'Acconto';
}

function statusLabel(status) {
  return status === 'inserted' ? 'Inserito' : 'Non inserito';
}

const emptyForm = {
  id: null,
  type: 'advance',
  movement_date: formatLocalDate(),
  amount: '',
  employer_key: 'LC',
  assignment: 'employee',
  employee_id: '',
  team_id: '',
  notes: '',
  status: 'pending',
};

export default function FinancialMovementsPage() {
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [settings, setSettings] = useState(null);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [filters, setFilters] = useState({
    month: monthString(),
    employee_id: '',
    team_id: '',
    type: '',
    status: '',
    employer_key: '',
  });

  const employerOptions = settings?.employer_options?.length
    ? settings.employer_options
    : [
        { value: 'LC', short_name: 'LC', name: 'Laruccia Cosimo' },
        { value: 'LG', short_name: 'LG', name: 'Laruccia Giuseppe' },
      ];

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.status !== 'inattivo' && !employee.is_deleted),
    [employees]
  );

  const selectedTeam = teams.find((team) => String(team.id) === String(form.team_id));
  const selectedTeamMembers = selectedTeam?.members || [];

  async function loadBaseData() {
    setLoading(true);
    try {
      const [employeeRows, teamRows, settingsData] = await Promise.all([
        window.api.employees.list(),
        window.api.teams.list(),
        window.api.settings.get(),
      ]);
      setEmployees(employeeRows || []);
      setTeams(teamRows || []);
      setSettings(settingsData || null);
    } catch (error) {
      console.error(error);
      alert('Errore caricamento dati acconti e rate');
    } finally {
      setLoading(false);
    }
  }

  async function loadMovements() {
    try {
      const rows = await window.api.financialMovements.list({
        month: filters.month || undefined,
        employee_id: filters.employee_id || undefined,
        team_id: filters.team_id || undefined,
        type: filters.type || undefined,
        status: filters.status || undefined,
        employer_key: filters.employer_key || undefined,
      });
      setMovements(rows || []);
    } catch (error) {
      console.error(error);
      alert('Errore caricamento storico acconti e rate');
    }
  }

  useEffect(() => {
    loadBaseData();
  }, []);

  useEffect(() => {
    loadMovements();
  }, [filters.month, filters.employee_id, filters.team_id, filters.type, filters.status, filters.employer_key]);

  useEffect(() => {
    const defaultEmployer = employerOptions[0]?.short_name || employerOptions[0]?.value || 'LC';
    setForm((current) => current.employer_key ? current : { ...current, employer_key: defaultEmployer });
  }, [settings]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    const defaultEmployer = employerOptions[0]?.short_name || employerOptions[0]?.value || 'LC';
    setForm({ ...emptyForm, movement_date: formatLocalDate(), employer_key: defaultEmployer });
  }

  function editMovement(movement) {
    setForm({
      id: movement.id,
      type: movement.type,
      movement_date: movement.movement_date,
      amount: String(movement.amount || ''),
      employer_key: movement.employer_key || employerOptions[0]?.short_name || employerOptions[0]?.value || 'LC',
      assignment: movement.team_id ? 'team' : 'employee',
      employee_id: String(movement.employee_id || ''),
      team_id: movement.team_id ? String(movement.team_id) : '',
      notes: movement.notes || '',
      status: movement.status || 'pending',
    });
  }

  async function saveMovement(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        id: form.id,
        type: form.type,
        movement_date: form.movement_date,
        amount: Number(form.amount || 0),
        employer_key: form.employer_key,
        notes: form.notes,
        status: form.status,
      };

      if (form.assignment === 'team' && form.team_id && !form.id) {
        const employeeIds = selectedTeamMembers.map((member) => member.employee_id).filter(Boolean);
        if (!employeeIds.length) {
          alert('La squadra selezionata non ha dipendenti.');
          return;
        }
        await window.api.financialMovements.createManyForEmployees({
          ...payload,
          team_id: Number(form.team_id),
          employee_ids: employeeIds,
        });
      } else {
        await window.api.financialMovements.save({
          ...payload,
          employee_id: Number(form.employee_id),
          team_id: form.assignment === 'team' && form.team_id ? Number(form.team_id) : null,
        });
      }

      resetForm();
      await loadMovements();
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Errore salvataggio movimento');
    } finally {
      setSaving(false);
    }
  }

  async function deleteMovement(id) {
    if (!window.confirm('Eliminare questo movimento dallo storico?')) return;
    try {
      await window.api.financialMovements.delete(id);
      await loadMovements();
    } catch (error) {
      console.error(error);
      alert('Errore eliminazione movimento');
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Storico economico</p>
          <h1>Acconti e Rate</h1>
          <p className="page-subtitle">
            Registra movimenti per dipendenti o squadre e importali poi nel report mensile.
          </p>
        </div>
      </div>

      <form onSubmit={saveMovement} style={formPanelStyle}>
        <div style={formHeaderStyle}>
          <div>
            <div style={sectionTitleStyle}>{form.id ? 'Modifica movimento' : 'Nuovo movimento'}</div>
            <div style={hintStyle}>Le squadre generano un movimento separato per ogni componente.</div>
          </div>
          {form.id ? (
            <button type="button" className="button-secondary" onClick={resetForm}>
              Annulla modifica
            </button>
          ) : null}
        </div>

        <div style={formGridStyle}>
          <label>
            <span style={fieldLabelStyle}>Tipo movimento</span>
            <select value={form.type} onChange={(event) => updateForm('type', event.target.value)}>
              <option value="advance">Acconto</option>
              <option value="installment">Rata</option>
            </select>
          </label>
          <label>
            <span style={fieldLabelStyle}>Data movimento</span>
            <input type="date" value={form.movement_date} onChange={(event) => updateForm('movement_date', event.target.value)} required />
          </label>
          <label>
            <span style={fieldLabelStyle}>Importo</span>
            <input type="number" step="0.01" min="0" value={form.amount} onChange={(event) => updateForm('amount', event.target.value)} required />
          </label>
          <label>
            <span style={fieldLabelStyle}>Datore</span>
            <select value={form.employer_key} onChange={(event) => updateForm('employer_key', event.target.value)}>
              {employerOptions.map((option) => (
                <option key={option.short_name || option.value} value={option.short_name || option.value}>
                  {option.short_name || option.value}{option.name ? ` · ${option.name}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span style={fieldLabelStyle}>Assegnazione</span>
            <select
              value={form.assignment}
              disabled={!!form.id}
              onChange={(event) => updateForm('assignment', event.target.value)}
            >
              <option value="employee">Singolo dipendente</option>
              <option value="team">Squadra</option>
            </select>
          </label>
          {form.assignment === 'employee' || form.id ? (
            <label>
              <span style={fieldLabelStyle}>Dipendente</span>
              <select value={form.employee_id} onChange={(event) => updateForm('employee_id', event.target.value)} required>
                <option value="">Seleziona dipendente</option>
                {activeEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.last_name} {employee.first_name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              <span style={fieldLabelStyle}>Squadra</span>
              <select value={form.team_id} onChange={(event) => updateForm('team_id', event.target.value)} required>
                <option value="">Seleziona squadra</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span style={fieldLabelStyle}>Stato</span>
            <select value={form.status} onChange={(event) => updateForm('status', event.target.value)}>
              <option value="pending">Non inserito</option>
              <option value="inserted">Inserito</option>
            </select>
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span style={fieldLabelStyle}>Note</span>
            <input value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} placeholder="Note opzionali" />
          </label>
        </div>

        {form.assignment === 'team' && selectedTeam ? (
          <div style={teamPreviewStyle}>
            <strong>{selectedTeam.name}</strong>
            <span>
              {selectedTeamMembers.length
                ? selectedTeamMembers.map((member) => `${member.employee.last_name} ${member.employee.first_name}`).join(', ')
                : 'Nessun dipendente in squadra'}
            </span>
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="submit" className="button" disabled={saving}>
            {saving ? 'Salvataggio...' : form.id ? 'Salva modifica' : 'Registra movimento'}
          </button>
        </div>
      </form>

      <div style={filterPanelStyle}>
        <label>
          <span style={fieldLabelStyle}>Mese</span>
          <input type="month" value={filters.month} onChange={(event) => updateFilter('month', event.target.value)} />
        </label>
        <label>
          <span style={fieldLabelStyle}>Dipendente</span>
          <select value={filters.employee_id} onChange={(event) => updateFilter('employee_id', event.target.value)}>
            <option value="">Tutti</option>
            {activeEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.last_name} {employee.first_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={fieldLabelStyle}>Squadra</span>
          <select value={filters.team_id} onChange={(event) => updateFilter('team_id', event.target.value)}>
            <option value="">Tutte</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span style={fieldLabelStyle}>Tipo</span>
          <select value={filters.type} onChange={(event) => updateFilter('type', event.target.value)}>
            <option value="">Tutti</option>
            <option value="advance">Acconto</option>
            <option value="installment">Rata</option>
          </select>
        </label>
        <label>
          <span style={fieldLabelStyle}>Stato</span>
          <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">Tutti</option>
            <option value="pending">Non inserito</option>
            <option value="inserted">Inserito</option>
          </select>
        </label>
        <label>
          <span style={fieldLabelStyle}>Datore</span>
          <select value={filters.employer_key} onChange={(event) => updateFilter('employer_key', event.target.value)}>
            <option value="">Tutti</option>
            {employerOptions.map((option) => (
              <option key={option.short_name || option.value} value={option.short_name || option.value}>
                {option.short_name || option.value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel" style={{ overflow: 'hidden' }}>
        <div style={tableHeaderStyle}>
          <div style={sectionTitleStyle}>Storico movimenti</div>
          <div style={hintStyle}>{loading ? 'Caricamento...' : `${movements.length} movimenti`}</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Dipendente / Squadra</th>
                <th>Datore</th>
                <th>Importo</th>
                <th>Stato</th>
                <th>Note</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td>{formatDateLabel(movement.movement_date)}</td>
                  <td>{movementTypeLabel(movement.type)}</td>
                  <td>
                    <strong>{movement.employee_name}</strong>
                    {movement.team_name ? <div style={mutedStyle}>{movement.team_name}</div> : null}
                  </td>
                  <td>{movement.employer_key || '-'}</td>
                  <td style={{ fontWeight: 800 }}>{formatCurrency(movement.amount)}</td>
                  <td>
                    <span style={statusBadgeStyle(movement.status)}>
                      {statusLabel(movement.status)}
                    </span>
                  </td>
                  <td>{movement.notes || '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="button-secondary" onClick={() => editMovement(movement)}>
                        Modifica
                      </button>
                      <button type="button" className="button-danger" onClick={() => deleteMovement(movement.id)}>
                        Elimina
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!movements.length ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: '#667085' }}>
                    Nessun movimento trovato.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const formPanelStyle = {
  display: 'grid',
  gap: 16,
  padding: 18,
  borderRadius: 12,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  background: '#fff',
  marginBottom: 16,
};

const formHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'flex-start',
};

const formGridStyle = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
};

const filterPanelStyle = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  padding: 14,
  borderRadius: 12,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  background: 'rgba(248, 250, 252, 0.95)',
  marginBottom: 16,
};

const sectionTitleStyle = {
  fontSize: 16,
  fontWeight: 800,
  color: '#111827',
};

const hintStyle = {
  fontSize: 12,
  color: '#4b5563',
  marginTop: 4,
};

const fieldLabelStyle = {
  display: 'block',
  fontSize: 11,
  fontWeight: 800,
  textTransform: 'uppercase',
  color: '#374151',
  marginBottom: 6,
};

const teamPreviewStyle = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  background: '#f8fafc',
  fontSize: 13,
};

const tableHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center',
  marginBottom: 12,
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
};

const mutedStyle = {
  color: '#667085',
  fontSize: 12,
  marginTop: 2,
};

const statusBadgeStyle = (status) => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 800,
  color: status === 'inserted' ? '#166534' : '#92400e',
  background: status === 'inserted' ? '#dcfce7' : '#fef3c7',
});
