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

function parseAmountInput(value) {
  const normalized = String(value || '').trim().replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
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
  source: 'financial',
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
  async function loadBaseData() {
    setLoading(true);
    const __t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    try {
      const __empT0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const employeesPromise = window.api.employees.listBasic({ includePeriods: false });
      const teamsPromise = window.api.teams.list();
      const settingsPromise = window.api.settings.get();
      const employeeRows = await employeesPromise;
      const __empMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - __empT0;
      console.info('[page-perf] financial:employees-load:end', {
        count: Array.isArray(employeeRows) ? employeeRows.length : 0,
        duration_ms: Math.round(__empMs),
      });
      const [teamRows, settingsData] = await Promise.all([teamsPromise, settingsPromise]);
      setEmployees(employeeRows || []);
      setTeams(teamRows || []);
      setSettings(settingsData || null);
    } catch (error) {
      console.error(error);
      alert('Errore caricamento dati acconti e rate');
    } finally {
      setLoading(false);
      const __dt = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - __t0;
      console.info('[page-perf] financial:loadBaseData:end', { duration_ms: Math.round(__dt) });
    }
  }

  async function loadMovements() {
    try {
      const [employeeRows, teamAdvanceRows] = await Promise.all([
        window.api.financialMovements.list({
          month: filters.month || undefined,
          employee_id: filters.employee_id || undefined,
          team_id: filters.team_id || undefined,
          type: filters.type || undefined,
          status: filters.status || undefined,
          employer_key: filters.employer_key || undefined,
        }),
        filters.employee_id || (filters.type && filters.type !== 'advance')
          ? Promise.resolve([])
          : window.api.teamPayroll.listAllAdvances({
              month: filters.month || undefined,
              team_id: filters.team_id || undefined,
              employer_key: filters.employer_key || undefined,
              status: filters.status || undefined,
            }),
      ]);

      const normalizedTeamRows = (teamAdvanceRows || []).map((row) => ({
        id: `team-advance-${row.id}`,
        record_id: row.id,
        source: 'team_advance',
        type: 'advance',
        employee_id: null,
        team_id: row.team_id,
        employer_key: row.employer_key || '',
        movement_date: row.advance_date,
        amount: Number(row.amount || 0),
        notes: row.notes || '',
        status: row.include_in_report ? 'inserted' : 'pending',
        inserted_month: row.include_in_report ? row.month : '',
        employee_name: 'Acconto squadra',
        team_name: row.team_name || '',
      }));

      const combinedRows = [...(employeeRows || []), ...normalizedTeamRows].sort((a, b) => {
        const dateCompare = String(b.movement_date || '').localeCompare(String(a.movement_date || ''));
        if (dateCompare !== 0) return dateCompare;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
      setMovements(combinedRows);
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
    setForm({ ...emptyForm, source: 'financial', movement_date: formatLocalDate(), employer_key: defaultEmployer });
  }

  function editMovement(movement) {
    setForm({
      id: movement.id,
      source: movement.source || 'financial',
      type: movement.type,
      movement_date: movement.movement_date,
      amount: String(movement.amount || ''),
      employer_key: movement.employer_key || employerOptions[0]?.short_name || employerOptions[0]?.value || 'LC',
      assignment: movement.team_id ? 'team' : 'employee',
      employee_id: movement.employee_id ? String(movement.employee_id) : '',
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
        amount: parseAmountInput(form.amount),
        employer_key: form.employer_key,
        notes: form.notes,
        status: form.status,
      };

      if (form.assignment === 'team' && form.team_id) {
        if (form.type !== 'advance') {
          alert('Per le squadre è disponibile solo la registrazione di acconti.');
          return;
        }

        const teamAdvancePayload = {
          team_id: Number(form.team_id),
          month: String(form.movement_date || '').slice(0, 7),
          advance_date: form.movement_date,
          amount: parseAmountInput(form.amount),
          employer_key: form.employer_key,
          notes: form.notes,
          include_in_report: form.status === 'inserted',
          source_type: 'financial_movement',
        };

        if (form.source === 'team_advance' && form.id) {
          await window.api.teamPayroll.updateAdvance(
            Number(String(form.id).replace('team-advance-', '')),
            teamAdvancePayload
          );
        } else {
          await window.api.teamPayroll.createAdvance(teamAdvancePayload);
        }
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
      if (String(id).startsWith('team-advance-')) {
        await window.api.teamPayroll.deleteAdvance(Number(String(id).replace('team-advance-', '')));
      } else {
        await window.api.financialMovements.delete(id);
      }
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
            <div style={hintStyle}>Le squadre registrano un solo acconto intestato alla squadra.</div>
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
            <input
              type="text"
              inputMode="decimal"
              value={form.amount}
              onChange={(event) => updateForm('amount', event.target.value)}
              required
            />
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
          {form.assignment === 'employee' ? (
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
            <strong>Acconto squadra</strong>
            <span>{selectedTeam.name}</span>
            <span>Il movimento verra registrato solo sulla squadra, non sui singoli componenti.</span>
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

      <div className="panel" style={historyPanelStyle}>
        <div style={tableHeaderStyle}>
          <div style={sectionTitleStyle}>Storico movimenti</div>
          <div style={hintStyle}>{loading ? 'Caricamento...' : `${movements.length} movimenti`}</div>
        </div>
        <div style={historyTableViewportStyle}>
          <div style={historyTableStyle}>
            <div className="financial-movements-grid-header" style={historyTableHeadStyle}>
              <div style={historyHeadCellStyle}>Data</div>
              <div style={historyHeadCellStyle}>Tipo</div>
              <div style={historyHeadCellStyle}>Dipendente / Squadra</div>
              <div style={historyHeadCellStyle}>Datore</div>
              <div style={{ ...historyHeadCellStyle, textAlign: 'right' }}>Importo</div>
              <div style={historyHeadCellStyle}>Stato</div>
              <div style={historyHeadCellStyle}>Note</div>
              <div style={historyHeadCellStyle}>Azioni</div>
            </div>

            <div style={historyTableBodyStyle}>
              {movements.map((movement) => (
                <div key={movement.id} className="financial-movements-grid-row" style={historyRowStyle}>
                  <div style={historyDateCellStyle}>{formatDateLabel(movement.movement_date)}</div>
                  <div style={historyTypeCellStyle}>{movementTypeLabel(movement.type)}</div>
                  <div style={historyPersonCellStyle}>
                    <strong>{movement.employee_name}</strong>
                    {movement.team_name ? <div style={mutedStyle}>{movement.team_name}</div> : null}
                  </div>
                  <div style={historyEmployerCellStyle}>{movement.employer_key || '—'}</div>
                  <div style={historyAmountCellStyle}>{formatCurrency(movement.amount)}</div>
                  <div>
                    <span style={statusBadgeStyle(movement.status)}>
                      {statusLabel(movement.status)}
                    </span>
                  </div>
                  <div style={historyNotesCellStyle(movement.notes)}>{movement.notes || '—'}</div>
                  <div style={historyActionsCellStyle}>
                    <button type="button" className="button-secondary" style={historyActionButtonStyle} onClick={() => editMovement(movement)}>
                      Modifica
                    </button>
                    <button type="button" className="button-danger" style={historyActionButtonStyle} onClick={() => deleteMovement(movement.id)}>
                      Elimina
                    </button>
                  </div>
                </div>
              ))}

              {!movements.length ? (
                <div style={historyEmptyStateStyle}>
                  Nessun movimento trovato.
                </div>
              ) : null}
            </div>
          </div>
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
  padding: '12px 14px',
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
  marginTop: 24,
  marginBottom: 10,
};

const mutedStyle = {
  color: '#667085',
  fontSize: 12,
  marginTop: 2,
};

const historyGridTemplate = '120px 110px minmax(220px, 1.6fr) 90px 130px 110px minmax(120px, 1fr) 180px';

const historyPanelStyle = {
  overflow: 'hidden',
  width: '100%',
};

const historyTableViewportStyle = {
  overflowX: 'auto',
  width: '100%',
};

const historyTableStyle = {
  minWidth: 1050,
  width: '100%',
};

const historyTableHeadStyle = {
  display: 'grid',
  gridTemplateColumns: historyGridTemplate,
  alignItems: 'center',
  columnGap: 16,
  padding: '14px 18px',
  borderBottom: '1px solid rgba(31, 41, 55, 0.08)',
};

const historyHeadCellStyle = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#344054',
};

const historyTableBodyStyle = {
  display: 'grid',
  gap: 10,
  paddingTop: 12,
};

const historyRowStyle = {
  display: 'grid',
  gridTemplateColumns: historyGridTemplate,
  alignItems: 'center',
  columnGap: 16,
  minHeight: 64,
  padding: '14px 18px',
  borderBottom: '1px solid rgba(31, 41, 55, 0.08)',
  background: 'rgba(255, 255, 255, 0.96)',
};

const historyDateCellStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: '#111827',
};

const historyTypeCellStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: '#1f2937',
};

const historyPersonCellStyle = {
  minWidth: 0,
  display: 'grid',
  gap: 2,
  lineHeight: 1.35,
};

const historyEmployerCellStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: '#1f2937',
};

const historyAmountCellStyle = {
  fontSize: 16,
  fontWeight: 900,
  textAlign: 'right',
  color: '#111827',
  whiteSpace: 'nowrap',
};

const historyNotesCellStyle = (notes) => ({
  minWidth: 0,
  fontSize: 13,
  color: notes ? '#1f2937' : 'rgba(31, 41, 55, 0.45)',
  lineHeight: 1.4,
  overflowWrap: 'anywhere',
  textAlign: notes ? 'left' : 'center',
});

const historyActionsCellStyle = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  justifyContent: 'flex-end',
  minWidth: 0,
};

const historyActionButtonStyle = {
  minHeight: 36,
  padding: '0 12px',
  fontSize: 12,
};

const historyEmptyStateStyle = {
  padding: '28px 18px',
  border: '1px dashed rgba(31, 41, 55, 0.14)',
  textAlign: 'center',
  color: '#667085',
  background: 'rgba(248, 250, 252, 0.7)',
};

const statusBadgeStyle = (status) => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '6px 12px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 800,
  color: status === 'inserted' ? '#14532d' : '#9a3412',
  background: status === 'inserted' ? '#bbf7d0' : '#fed7aa',
});
