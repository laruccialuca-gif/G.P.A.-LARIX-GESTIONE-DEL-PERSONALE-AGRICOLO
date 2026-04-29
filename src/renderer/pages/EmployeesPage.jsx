import React, { useEffect, useMemo, useState } from 'react';
import EmployeeForm from '../components/EmployeeForm';
import TeamForm from '../components/TeamForm';
import PdfImportModal from '../components/PdfImportModal';
import { useYearContext } from '../context/YearContext';
import { employeeIsActiveInYear, getEmployeePeriodsActiveInYear, getEmployeePrimaryPeriodInYear } from '../utils/yearScope';

const CONTRACT_LABELS = {
  tempo_indeterminato: 'Tempo Indeterminato',
  tempo_determinato: 'Tempo Determinato',
  apprendistato: 'Apprendistato',
  stagionale: 'Stagionale',
  partita_iva: 'Partita IVA',
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const s = dateStr.split('T')[0];
  const parts = s.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function normalizeSortText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getEmployeeDisplayName(employee) {
  const firstName = String(employee?.first_name || '').trim();
  const lastName = String(employee?.last_name || '').trim();
  const composed = [firstName, lastName].filter(Boolean).join(' ').trim();
  return composed || String(employee?.full_name || employee?.name || employee?.displayName || '').trim() || '—';
}

function getContractLabel(contractType) {
  return CONTRACT_LABELS[contractType] || '—';
}

function getComparableDateValue(dateStr) {
  if (!dateStr) return null;
  const parsed = new Date(`${String(dateStr).split('T')[0]}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function compareStrings(a, b) {
  return normalizeSortText(a).localeCompare(normalizeSortText(b), 'it', { sensitivity: 'base' });
}

function compareNumbers(a, b) {
  return Number(a || 0) - Number(b || 0);
}

function SortHeader({ label, field, sortField, sortDirection, onToggle, width, flex, extraStyle }) {
  const isActive = sortField === field;
  const arrow = isActive ? (sortDirection === 'asc' ? '↑' : '↓') : '↕';

  return (
    <button
      type="button"
      onClick={() => onToggle(field)}
      style={{
        ...(flex ? { flex } : {}),
        ...(width ? { width, flexShrink: 0 } : {}),
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: 0,
        border: 'none',
        background: isActive ? 'rgba(22, 101, 52, 0.08)' : 'transparent',
        color: isActive ? '#166534' : '#9ca3af',
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        borderRadius: 10,
        minHeight: 28,
        textAlign: 'left',
        ...extraStyle,
      }}
      title={`Ordina per ${label}`}
    >
      <span>{label}</span>
      <span style={{ fontSize: 12, lineHeight: 1 }}>{arrow}</span>
    </button>
  );
}

function getExpiryInfo(dateStr) {
  if (!dateStr) {
    return {
      label: 'Attivo',
      color: '#475467',
      background: 'rgba(20, 33, 61, 0.06)',
    };
  }

  const target = new Date(`${String(dateStr).split('T')[0]}T00:00:00`);
  if (Number.isNaN(target.getTime())) {
    return {
      label: 'Nessuna scadenza',
      color: '#475467',
      background: 'rgba(20, 33, 61, 0.06)',
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (diffDays < 0) {
    return {
      label: `Scaduto da ${Math.abs(diffDays)} giorni`,
      color: '#b91c1c',
      background: 'rgba(239, 68, 68, 0.12)',
    };
  }

  if (diffDays === 0) {
    return {
      label: 'Scade oggi',
      color: '#b91c1c',
      background: 'rgba(239, 68, 68, 0.12)',
    };
  }

  if (diffDays <= 7) {
    return {
      label: `Scade tra ${diffDays} giorni`,
      color: '#b45309',
      background: 'rgba(245, 158, 11, 0.16)',
    };
  }

  if (diffDays <= 30) {
    return {
      label: `Scade tra ${diffDays} giorni`,
      color: '#b45309',
      background: 'rgba(250, 204, 21, 0.18)',
    };
  }

  return {
    label: `Scade tra ${diffDays} giorni`,
    color: '#166534',
    background: 'rgba(34, 197, 94, 0.14)',
  };
}

function getExpiryDays(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${String(dateStr).split('T')[0]}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function MiniCheckBadge({ label, required, done }) {
  if (!required && !done) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: done ? '#dcfce7' : '#fee2e2',
      color: done ? '#166534' : '#b91c1c',
      border: '1px solid rgba(0,0,0,0.06)',
      whiteSpace: 'nowrap',
    }}>
      {done ? '✓' : '✗'} {label}
    </span>
  );
}

function EmployeeRow({ employee, onClick, onArchive, selected, onToggleSelected, selectionMode }) {
  const expiryInfo = getExpiryInfo(employee.hire_date_to);
  const selectedBg = selectionMode && selected ? 'rgba(15,118,110,0.07)' : '';

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px', borderBottom: '1px solid #f3f4f6',
        cursor: 'pointer', background: selectedBg,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = selectionMode && selected ? 'rgba(15,118,110,0.13)' : '#f9fafb'; }}
      onMouseLeave={e => { e.currentTarget.style.background = selectedBg; }}
    >
      {selectionMode && (
        <div style={{ width: 26, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
          <input
            type="checkbox"
            checked={!!selected}
            onChange={(event) => {
              event.stopPropagation();
              onToggleSelected(employee.id, event.target.checked);
            }}
            onClick={(event) => event.stopPropagation()}
            style={{ width: 16, height: 16 }}
          />
        </div>
      )}

      <div
        className="avatar"
        style={{ width: 34, height: 34, fontSize: 13, flexShrink: 0 }}
        onClick={() => onClick(employee)}
      >
        {(employee.first_name?.[0] || '') + (employee.last_name?.[0] || '')}
      </div>

      <div style={{ flex: 1, minWidth: 0 }} onClick={() => onClick(employee)}>
        <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {getEmployeeDisplayName(employee)}
        </div>
        <div style={{ fontSize: 12, color: '#667085' }}>{employee.role || 'Nessuna mansione'}</div>
      </div>

      <div style={{ fontSize: 12, color: '#374151', width: 130, flexShrink: 0 }} onClick={() => onClick(employee)}>
        {getContractLabel(employee.contract_type)}
      </div>

      <div style={{ fontSize: 12, color: '#374151', width: 90, flexShrink: 0 }} onClick={() => onClick(employee)}>
        {formatDate(employee.hire_date_from)}
      </div>

      <div style={{ fontSize: 12, color: '#374151', width: 90, flexShrink: 0 }} onClick={() => onClick(employee)}>
        {employee.hire_date_to ? formatDate(employee.hire_date_to) : 'attivo'}
      </div>

      <div style={{ width: 160, flexShrink: 0 }} onClick={() => onClick(employee)}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '4px 10px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            color: expiryInfo.color,
            background: expiryInfo.background,
            whiteSpace: 'nowrap',
          }}
        >
          {expiryInfo.label}
        </span>
      </div>

      <div style={{ fontSize: 12, color: '#374151', width: 110, flexShrink: 0 }} onClick={() => onClick(employee)}>
        {employee.daily_pay ? `€ ${Number(employee.daily_pay).toFixed(2)}/g` : '—'}
      </div>

      <div style={{ display: 'flex', gap: 5, flexShrink: 0, width: 150 }} onClick={() => onClick(employee)}>
        <MiniCheckBadge label="Visita" required={!!employee.medical_visit_required} done={!!employee.medical_visit_done} />
        <MiniCheckBadge label="Form." required={!!employee.art37_required} done={!!employee.art37_done} />
      </div>

      <div style={{ width: 162, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
        {employee.status !== 'attivo' ? (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap' }}>
            Inattivo
          </span>
        ) : null}
      </div>

      <div style={{ width: 92, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onArchive(employee.id); }}
          title="Archivia dipendente"
          style={{
            width: '100%',
            flexShrink: 0,
            padding: '3px 10px',
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 8,
            border: '1px solid rgba(239,68,68,0.25)',
            background: 'rgba(239,68,68,0.07)',
            color: '#b91c1c',
            cursor: 'pointer',
          }}
        >
          Archivia
        </button>
      </div>
    </div>
  );
}

const compactFilterToolbarStyle = {
  margin: '0 16px 8px',
  padding: '8px 10px',
  gap: 7,
};

const compactFilterGroupStyle = {
  gap: 7,
};

const compactFilterSelectStyle = {
  width: 116,
  minWidth: 110,
  minHeight: 32,
  padding: '6px 10px',
  fontSize: 12,
};

const compactFilterCheckboxStyle = {
  minHeight: 30,
  padding: '0 9px',
  gap: 6,
  fontSize: 12,
  fontWeight: 700,
};

const compactFilterButtonStyle = {
  minHeight: 32,
  padding: '0 12px',
  fontSize: 12,
};

function TeamRow({ team, onClick, onArchive }) {
  const memberCount = (team.members || []).length;
  const activeMemberCount = (team.members || []).filter(
    m => !m.employee?.is_deleted && m.employee?.status === 'attivo'
  ).length;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px', borderBottom: '1px solid #f3f4f6',
        cursor: 'pointer',
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
      onMouseLeave={e => e.currentTarget.style.background = ''}
    >
      <div
        className="avatar"
        style={{ width: 34, height: 34, fontSize: 11, flexShrink: 0, background: 'rgba(37,99,235,0.12)', color: '#1d4ed8' }}
        onClick={() => onClick(team)}
      >
        SQ
      </div>

      <div style={{ flex: 1, minWidth: 0 }} onClick={() => onClick(team)}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{team.name}</div>
        <div style={{ fontSize: 12, color: '#667085' }}>
          {memberCount} componenti · {activeMemberCount} attivi
        </div>
      </div>

      {activeMemberCount === 0 && (
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e', flexShrink: 0 }}>
          Inattiva
        </span>
      )}

      <button
        type="button"
        onClick={e => { e.stopPropagation(); onArchive(team.id); }}
        title="Archivia squadra"
        style={{
          flexShrink: 0, padding: '3px 10px', fontSize: 11, fontWeight: 700,
          borderRadius: 8, border: '1px solid rgba(239,68,68,0.25)',
          background: 'rgba(239,68,68,0.07)', color: '#b91c1c', cursor: 'pointer',
        }}
      >
        Archivia
      </button>
    </div>
  );
}

function ArchivedEmployeeRow({ employee, onRestore, onDelete, selected, onToggleSelected, selectionMode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 16px', borderBottom: '1px solid #f3f4f6',
      background: selectionMode && selected ? 'rgba(15,118,110,0.07)' : '#fff',
    }}>
      {selectionMode && (
        <div style={{ width: 26, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
          <input
            type="checkbox"
            checked={!!selected}
            onChange={(event) => onToggleSelected(employee.id, event.target.checked)}
            style={{ width: 16, height: 16 }}
          />
        </div>
      )}
      <div className="avatar" style={{ width: 34, height: 34, fontSize: 13, flexShrink: 0, opacity: 0.45 }}>
        {(employee.first_name?.[0] || '') + (employee.last_name?.[0] || '')}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#6b7280' }}>
          {employee.first_name} {employee.last_name}
        </div>
        <div style={{ fontSize: 12, color: '#9ca3af' }}>
          {employee.role || 'Nessuna mansione'} · archiviato il {formatDate(employee.deleted_at)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          className="button-secondary"
          style={{ padding: '4px 12px', fontSize: 12 }}
          onClick={() => onRestore(employee.id)}
        >
          Ripristina
        </button>
        <button
          className="button-danger"
          style={{ padding: '4px 12px', fontSize: 12 }}
          onClick={() => onDelete(employee.id)}
        >
          Elimina definitivamente
        </button>
      </div>
    </div>
  );
}

function ArchivedTeamRow({ team, onRestore, onDelete }) {
  const memberCount = (team.members || []).length;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 16px', borderBottom: '1px solid #f3f4f6',
    }}>
      <div className="avatar" style={{ width: 34, height: 34, fontSize: 11, flexShrink: 0, opacity: 0.45, background: 'rgba(37,99,235,0.12)', color: '#1d4ed8' }}>
        SQ
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#6b7280' }}>{team.name}</div>
        <div style={{ fontSize: 12, color: '#9ca3af' }}>
          {memberCount} componenti · archiviata il {formatDate(team.archived_at)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          className="button-secondary"
          style={{ padding: '4px 12px', fontSize: 12 }}
          onClick={() => onRestore(team.id)}
        >
          Ripristina
        </button>
        <button
          className="button-danger"
          style={{ padding: '4px 12px', fontSize: 12 }}
          onClick={() => onDelete(team.id)}
        >
          Elimina definitivamente
        </button>
      </div>
    </div>
  );
}

function SectionAccordion({ title, subtitle, count, isOpen, onToggle, color, bg, children, action }) {
  return (
    <div style={{ borderRadius: 14, border: '1px solid #e5e7eb', overflow: 'hidden', background: '#fff' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 20px', background: isOpen ? bg : '#fff',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          transition: 'background 0.15s',
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 18, color: '#111827', flex: 1 }}>{title}</span>
        {subtitle && <span style={{ fontSize: 12, color: '#9ca3af' }}>{subtitle}</span>}
        <span style={{
          fontWeight: 700, fontSize: 12, padding: '3px 10px',
          borderRadius: 999, background: bg, color,
        }}>{count}</span>
        <span style={{
          fontSize: 14, color: '#9ca3af',
          display: 'inline-block',
          transform: isOpen ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s',
        }}>▾</span>
      </button>
      {isOpen && (
        <div>
          {action && (
            <div style={{ padding: '12px 16px 0', display: 'flex', justifyContent: 'flex-end' }}>
              {action}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

export default function EmployeesPage() {
  const { selectedYear, getTargetYear } = useYearContext();
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pdfImportLoading, setPdfImportLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editingTeam, setEditingTeam] = useState(null);
  const [search, setSearch] = useState('');
  const [openSection, setOpenSection] = useState(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveTab, setArchiveTab] = useState('dipendenti');
  const [showPdfImport, setShowPdfImport] = useState(false);
  const [pdfImportData, setPdfImportData] = useState(null);
  const [employeeFilters, setEmployeeFilters] = useState({
    expiry: 'tutti',
    datore: 'tutti',
    medicalMissing: false,
    trainingMissing: false,
  });
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedArchivedEmployeeIds, setSelectedArchivedEmployeeIds] = useState([]);
  const [archiveSelectionMode, setArchiveSelectionMode] = useState(false);
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');

  async function loadData() {
    setLoading(true);
    try {
      const [employeeData, teamData] = await Promise.all([
        window.api.employees.list({ includeDeleted: true }),
        window.api.teams.list({ includeArchived: true }),
      ]);
      setEmployees(employeeData || []);
      setTeams(teamData || []);
    } catch (err) {
      console.error(err);
      alert('Errore caricamento archivio');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  async function handleCreate(data) {
    try {
      await window.api.employees.create(data);
      setShowForm(false);
      await loadData();
    } catch (err) {
      console.error(err);
      if (err?.code === 'EMPLOYEE_ALREADY_ACTIVE') {
        alert('Esiste già una scheda attiva per questo dipendente. Apri quella esistente o riattiva uno storico archiviato.');
      } else {
        alert('Errore creazione dipendente');
      }
    }
  }

  async function handleUpdate(data) {
    try {
      await window.api.employees.update(editing.id, data);
      setEditing(null);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Errore modifica dipendente');
    }
  }

  async function handleArchive(id) {
    const ok = window.confirm("Archivia il dipendente? Lo storico resterà disponibile nell'archivio.");
    if (!ok) return;
    try {
      await window.api.employees.archive(id);
      setEditing(null);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Errore archiviazione dipendente');
    }
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedEmployeeIds([]);
  }

  function exitArchiveSelectionMode() {
    setArchiveSelectionMode(false);
    setSelectedArchivedEmployeeIds([]);
  }

  async function handleArchiveSelectedEmployees() {
    if (!selectedEmployeeIds.length) return;

    const ok = window.confirm(`Archiviare ${selectedEmployeeIds.length} dipendenti selezionati?`);
    if (!ok) return;

    try {
      for (const employeeId of selectedEmployeeIds) {
        await window.api.employees.archive(employeeId);
      }
      exitSelectionMode();
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Errore archiviazione multipla dipendenti');
    }
  }

  async function handleRestore(id) {
    try {
      await window.api.employees.restore(id);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Errore ripristino dipendente');
    }
  }

  async function handleDeleteEmployee(id) {
    const ok = window.confirm(
      'Eliminazione definitiva: tutti i dati, le presenze, le buste paga e i file allegati verranno cancellati in modo irreversibile. Continuare?'
    );
    if (!ok) return;
    try {
      await window.api.employees.deletePermanently(id);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Errore eliminazione definitiva dipendente');
    }
  }

  async function handleRestoreSelectedArchivedEmployees() {
    if (!selectedArchivedEmployeeIds.length) return;

    const ok = window.confirm(`Ripristinare ${selectedArchivedEmployeeIds.length} dipendenti archiviati selezionati?`);
    if (!ok) return;

    try {
      for (const employeeId of selectedArchivedEmployeeIds) {
        await window.api.employees.restore(employeeId);
      }
      exitArchiveSelectionMode();
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Errore ripristino multiplo dipendenti archiviati');
    }
  }

  async function handleDeleteSelectedArchivedEmployees() {
    if (!selectedArchivedEmployeeIds.length) return;

    const firstConfirm = window.confirm(
      `Eliminare definitivamente ${selectedArchivedEmployeeIds.length} dipendenti archiviati selezionati?`
    );
    if (!firstConfirm) return;

    const secondConfirm = window.confirm(
      'Conferma finale: verranno cancellati definitivamente tutti i dati collegati ai dipendenti selezionati. Continuare?'
    );
    if (!secondConfirm) return;

    try {
      for (const employeeId of selectedArchivedEmployeeIds) {
        await window.api.employees.deletePermanently(employeeId);
      }
      exitArchiveSelectionMode();
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Errore eliminazione multipla dipendenti archiviati');
    }
  }

  async function handleCreateTeam(data) {
    try {
      await window.api.teams.create(data);
      setShowTeamForm(false);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Errore creazione squadra');
    }
  }

  async function handleUpdateTeam(data) {
    try {
      await window.api.teams.update(editingTeam.id, data);
      setEditingTeam(null);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Errore aggiornamento squadra');
    }
  }

  async function handleArchiveTeam(id) {
    const ok = window.confirm("Archivia la squadra? Lo storico resterà disponibile nell'archivio.");
    if (!ok) return;
    try {
      await window.api.teams.archive(id);
      setEditingTeam(null);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Errore archiviazione squadra');
    }
  }

  async function handleRestoreTeam(id) {
    try {
      await window.api.teams.restore(id);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Errore ripristino squadra');
    }
  }

  async function handleDeleteTeam(id) {
    const ok = window.confirm(
      'Eliminazione definitiva: la squadra e tutti i dati collegati verranno cancellati in modo irreversibile. Continuare?'
    );
    if (!ok) return;
    try {
      await window.api.teams.deletePermanently(id);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Errore eliminazione definitiva squadra');
    }
  }

  async function handleOpenPdfImport() {
    if (pdfImportLoading) return;

    setPdfImportLoading(true);
    try {
      const result = await window.api.employees.parsePdfImport({
        targetYear: getTargetYear(),
      });
      if (result.canceled) return;
      setPdfImportData(result);
      setShowPdfImport(true);
    } catch (err) {
      console.error(err);
      alert('Errore lettura PDF: ' + err.message);
    } finally {
      setPdfImportLoading(false);
    }
  }

  async function handleConfirmPdfImport(rows) {
    const res = await window.api.employees.confirmPdfImport({
      filePath: pdfImportData.filePath,
      rows,
    });
    await loadData();
    return res;
  }

  function handleClosePdfImport() {
    setShowPdfImport(false);
    setPdfImportData(null);
  }

  function toggleSection(name) {
    setOpenSection(prev => (prev === name ? null : name));
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();

    const filteredEmployees = employees
      .map((employee) => {
        const primaryPeriod = getEmployeePrimaryPeriodInYear(employee, selectedYear);
        return {
          ...employee,
          year_periods: getEmployeePeriodsActiveInYear(employee, selectedYear),
          hire_date_from: primaryPeriod?.hire_date_from ?? employee.hire_date_from,
          hire_date_to: primaryPeriod?.hire_date_to ?? employee.hire_date_to,
          hired_by: primaryPeriod?.hired_by ?? employee.hired_by,
        };
      })
      .filter(employee => {
        if (!q) return true;
        return [employee.first_name, employee.last_name, employee.role, employee.fiscal_code, employee.phone, employee.email, employee.hired_by]
          .filter(Boolean).join(' ').toLowerCase().includes(q);
      });

    const filteredTeams = teams.filter(team => {
      if (!q) return true;
      return [
        team.name, team.notes,
        ...(team.members || []).flatMap(m => [m.employee?.first_name, m.employee?.last_name, m.employee?.role]),
      ].filter(Boolean).join(' ').toLowerCase().includes(q);
    });

    return { employees: filteredEmployees, teams: filteredTeams };
  }, [employees, teams, search, selectedYear]);

  const filteredVisibleEmployees = useMemo(() => filtered.employees.filter((employee) => {
    if (employee.is_deleted) return false;
    if (!employeeIsActiveInYear(employee, selectedYear)) return false;

    if (employeeFilters.expiry === 'scadenza') {
      const days = getExpiryDays(employee.hire_date_to);
      if (days === null || days < 0 || days > 30) return false;
    }

    if (employeeFilters.expiry === 'scaduti') {
      const days = getExpiryDays(employee.hire_date_to);
      if (days === null || days >= 0) return false;
    }

    if (employeeFilters.datore !== 'tutti' && !employee.year_periods?.some((period) => (period.hired_by || '') === employeeFilters.datore)) {
      return false;
    }

    if (employeeFilters.medicalMissing && employee.medical_visit_done) {
      return false;
    }

    if (employeeFilters.trainingMissing && employee.art37_done) {
      return false;
    }

    return true;
  }), [filtered.employees, employeeFilters, selectedYear]);

  const sortedVisibleEmployees = useMemo(() => {
    const sorted = [...filteredVisibleEmployees];
    const directionFactor = sortDirection === 'desc' ? -1 : 1;

    sorted.sort((a, b) => {
      let result = 0;

      if (sortField === 'name') {
        result = compareStrings(getEmployeeDisplayName(a), getEmployeeDisplayName(b));
      } else if (sortField === 'contract_type') {
        result = compareStrings(getContractLabel(a.contract_type), getContractLabel(b.contract_type));
      } else if (sortField === 'hire_date_from') {
        result = compareNumbers(getComparableDateValue(a.hire_date_from), getComparableDateValue(b.hire_date_from));
      } else if (sortField === 'hire_date_to') {
        const aValue = getComparableDateValue(a.hire_date_to);
        const bValue = getComparableDateValue(b.hire_date_to);
        result = compareNumbers(aValue ?? Number.MAX_SAFE_INTEGER, bValue ?? Number.MAX_SAFE_INTEGER);
      } else if (sortField === 'expiry') {
        const aValue = getExpiryDays(a.hire_date_to);
        const bValue = getExpiryDays(b.hire_date_to);
        result = compareNumbers(aValue ?? Number.MAX_SAFE_INTEGER, bValue ?? Number.MAX_SAFE_INTEGER);
      } else if (sortField === 'daily_pay') {
        result = compareNumbers(a.daily_pay, b.daily_pay);
      }

      if (result === 0) {
        result = compareStrings(getEmployeeDisplayName(a), getEmployeeDisplayName(b));
      }

      return result * directionFactor;
    });

    return sorted;
  }, [filteredVisibleEmployees, sortDirection, sortField]);

  const activeEmployees = sortedVisibleEmployees.filter(e => e.status === 'attivo');
  const inactiveEmployees = sortedVisibleEmployees.filter(e => e.status !== 'attivo');
  const renderedEmployees = sortedVisibleEmployees;
  const archivedEmployees = filtered.employees.filter((employee) => employee.is_deleted && employeeIsActiveInYear(employee, selectedYear));
  const allVisibleEmployeeIds = sortedVisibleEmployees.map((employee) => employee.id);
  const visibleSelectedCount = allVisibleEmployeeIds.filter((id) => selectedEmployeeIds.includes(id)).length;
  const archivedVisibleEmployeeIds = archivedEmployees.map((employee) => employee.id);
  const archivedVisibleSelectedCount = archivedVisibleEmployeeIds.filter((id) => selectedArchivedEmployeeIds.includes(id)).length;

  function handleToggleSort(field) {
    if (sortField !== field) {
      setSortField(field);
      setSortDirection('asc');
      return;
    }

    if (sortDirection === 'asc') {
      setSortDirection('desc');
      return;
    }

    setSortField('name');
    setSortDirection('asc');
  }

  useEffect(() => {
    setSelectedEmployeeIds((current) => current.filter((id) => allVisibleEmployeeIds.includes(id)));
  }, [allVisibleEmployeeIds.join('|')]);

  useEffect(() => {
    setSelectedArchivedEmployeeIds((current) => current.filter((id) => archivedVisibleEmployeeIds.includes(id)));
  }, [archivedVisibleEmployeeIds.join('|')]);

  useEffect(() => {
    if (!archiveOpen || archiveTab !== 'dipendenti') {
      exitArchiveSelectionMode();
    }
  }, [archiveOpen, archiveTab]);

  const teamBuckets = useMemo(() => {
    const active = [], inactive = [], archived = [];
    filtered.teams.forEach(team => {
      const activeMembers = (team.members || []).filter(m => !m.employee?.is_deleted && m.employee?.status === 'attivo');
      if (team.is_archived) archived.push(team);
      else if (activeMembers.length > 0) active.push(team);
      else inactive.push(team);
    });
    return { active, inactive, archived };
  }, [filtered.teams]);

  const { active: activeTeams, inactive: inactiveTeams, archived: archivedTeams } = teamBuckets;
  const totalArchived = archivedEmployees.length + archivedTeams.length;

  return (
    <div className="page">
      <div className="page-sticky-stack">
        <section className="page-hero">
          <div>
            <span className="page-kicker">Archivio personale</span>
            <h1 className="page-title">Dipendenti e Squadre</h1>
            <p className="page-subtitle">
              Anagrafica, stati operativi e archivio storico nel database locale.
            </p>
          </div>
          <div className="page-actions">
            <button className="button" onClick={() => setShowForm(true)}>Nuovo Dipendente</button>
            <button className="button-secondary" onClick={() => setShowTeamForm(true)}>Nuova Squadra</button>
            <button
              className="button-secondary"
              onClick={handleOpenPdfImport}
              disabled={pdfImportLoading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                opacity: pdfImportLoading ? 0.85 : 1,
              }}
            >
              {pdfImportLoading ? (
                <>
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      border: '2px solid rgba(20, 33, 61, 0.16)',
                      borderTopColor: '#0f766e',
                      display: 'inline-block',
                      animation: 'spin 0.8s linear infinite',
                      flexShrink: 0,
                    }}
                  />
                  Analisi PDF in corso...
                </>
              ) : (
                'Importa da PDF'
              )}
            </button>
          </div>
        </section>

        <div className="toolbar" style={{ padding: '8px 10px', gap: 7 }}>
          <div className="toolbar-group">
            <input
              className="search-input"
              placeholder="Cerca per nome, mansione, contatto o datore..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ maxWidth: 280, minHeight: 34, padding: '7px 12px' }}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="panel empty-state">Caricamento...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Area Dipendenti */}
          <SectionAccordion
            title="Dipendenti"
            subtitle={`${activeEmployees.length} attivi · ${inactiveEmployees.length} inattivi`}
            count={`${activeEmployees.length + inactiveEmployees.length} totali`}
            isOpen={openSection === 'dipendenti'}
            onToggle={() => toggleSection('dipendenti')}
            color="#115e59"
            bg="rgba(15,118,110,0.08)"
            action={
              <button
                className="button"
                style={{ padding: '6px 14px', fontSize: 13 }}
                onClick={() => setShowForm(true)}
              >
                + Nuovo Dipendente
              </button>
            }
          >
            <div className="toolbar" style={compactFilterToolbarStyle}>
              <div className="toolbar-group" style={compactFilterGroupStyle}>
                <select
                  value={employeeFilters.expiry}
                  onChange={(e) => setEmployeeFilters((current) => ({ ...current, expiry: e.target.value }))}
                  style={compactFilterSelectStyle}
                >
                  <option value="tutti">Tutte le scadenze</option>
                  <option value="scadenza">In scadenza</option>
                  <option value="scaduti">Scaduti</option>
                </select>
                <select
                  value={employeeFilters.datore}
                  onChange={(e) => setEmployeeFilters((current) => ({ ...current, datore: e.target.value }))}
                  style={compactFilterSelectStyle}
                >
                  <option value="tutti">Tutti i datori</option>
                  <option value="LC">LC</option>
                  <option value="LG">LG</option>
                </select>
                <label className="communication-checkbox" style={compactFilterCheckboxStyle}>
                  <input
                    type="checkbox"
                    checked={employeeFilters.medicalMissing}
                    onChange={(e) => setEmployeeFilters((current) => ({ ...current, medicalMissing: e.target.checked }))}
                  />
                  Visita mancante
                </label>
                <label className="communication-checkbox" style={compactFilterCheckboxStyle}>
                  <input
                    type="checkbox"
                    checked={employeeFilters.trainingMissing}
                    onChange={(e) => setEmployeeFilters((current) => ({ ...current, trainingMissing: e.target.checked }))}
                  />
                  Formazione mancante
                </label>
              </div>

              <div className="toolbar-group" style={compactFilterGroupStyle}>
                <span className="soft-chip" style={{ background: 'rgba(15, 118, 110, 0.12)', color: '#115e59', minHeight: 32, padding: '0 10px', fontSize: 12 }}>
                  {filteredVisibleEmployees.length} visibili
                </span>

                {!selectionMode ? (
                  <button
                    type="button"
                    className="button-secondary"
                    style={compactFilterButtonStyle}
                    onClick={() => setSelectionMode(true)}
                  >
                    Seleziona
                  </button>
                ) : (
                  <>
                    <span className="soft-chip" style={{ background: 'rgba(15,118,110,0.12)', color: '#115e59', minHeight: 32, padding: '0 10px', fontSize: 12, fontWeight: 700 }}>
                      {visibleSelectedCount} selezionati
                    </span>
                    <button
                      type="button"
                      className="button-secondary"
                      style={compactFilterButtonStyle}
                      onClick={() => {
                        const allVisibleSelected = allVisibleEmployeeIds.length > 0 && allVisibleEmployeeIds.every((id) => selectedEmployeeIds.includes(id));
                        setSelectedEmployeeIds((current) => {
                          if (allVisibleSelected) return current.filter((id) => !allVisibleEmployeeIds.includes(id));
                          return Array.from(new Set([...current, ...allVisibleEmployeeIds]));
                        });
                      }}
                      disabled={!allVisibleEmployeeIds.length}
                    >
                      {allVisibleEmployeeIds.length > 0 && allVisibleEmployeeIds.every((id) => selectedEmployeeIds.includes(id))
                        ? 'Deseleziona tutto'
                        : 'Seleziona tutto'}
                    </button>
                    <button
                      type="button"
                      className="button-danger"
                      style={compactFilterButtonStyle}
                      onClick={handleArchiveSelectedEmployees}
                      disabled={!visibleSelectedCount}
                    >
                      Archivia selezionati
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      style={compactFilterButtonStyle}
                      onClick={exitSelectionMode}
                    >
                      Annulla
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Intestazione colonne */}
            <div style={{
              display: 'flex', gap: 12, padding: '8px 16px',
              background: '#f9fafb', borderBottom: '1px solid #e5e7eb',
              fontSize: 11, fontWeight: 700, color: '#9ca3af',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {selectionMode && <div style={{ width: 26 }} />}
              <SortHeader label="Nome" field="name" sortField={sortField} sortDirection={sortDirection} onToggle={handleToggleSort} flex={1} />
              <SortHeader label="Tipo assunzione" field="contract_type" sortField={sortField} sortDirection={sortDirection} onToggle={handleToggleSort} width={130} />
              <SortHeader label="Data assunzione" field="hire_date_from" sortField={sortField} sortDirection={sortDirection} onToggle={handleToggleSort} width={90} />
              <SortHeader label="Data chiusura" field="hire_date_to" sortField={sortField} sortDirection={sortDirection} onToggle={handleToggleSort} width={90} />
              <SortHeader label="Scadenza" field="expiry" sortField={sortField} sortDirection={sortDirection} onToggle={handleToggleSort} width={160} />
              <SortHeader label="Retribuzione" field="daily_pay" sortField={sortField} sortDirection={sortDirection} onToggle={handleToggleSort} width={110} />
              <div style={{ width: 150 }}>Compliance</div>
              <div style={{ width: 70 }} />
            </div>

            {renderedEmployees.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 16px' }}>
                Nessun dipendente. Clicca "+ Nuovo Dipendente" per aggiungerne uno.
              </div>
            ) : (
              <>
                {renderedEmployees.map(employee => (
                  <EmployeeRow
                    key={employee.id}
                    employee={employee}
                    onClick={setEditing}
                    onArchive={handleArchive}
                    selectionMode={selectionMode}
                    selected={selectedEmployeeIds.includes(employee.id)}
                    onToggleSelected={(employeeId, checked) =>
                      setSelectedEmployeeIds((current) =>
                        checked
                          ? Array.from(new Set([...current, employeeId]))
                          : current.filter((id) => id !== employeeId)
                      )
                    }
                  />
                ))}
              </>
            )}
          </SectionAccordion>

          {/* Area Squadre */}
          <SectionAccordion
            title="Squadre"
            subtitle={`${activeTeams.length} attive · ${inactiveTeams.length} inattive`}
            count={`${activeTeams.length + inactiveTeams.length} totali`}
            isOpen={openSection === 'squadre'}
            onToggle={() => toggleSection('squadre')}
            color="#1d4ed8"
            bg="rgba(37,99,235,0.08)"
            action={
              <button
                className="button-secondary"
                style={{ padding: '6px 14px', fontSize: 13 }}
                onClick={() => setShowTeamForm(true)}
              >
                + Nuova Squadra
              </button>
            }
          >
            {activeTeams.length === 0 && inactiveTeams.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 16px' }}>
                Nessuna squadra. Clicca "+ Nuova Squadra" per crearne una.
              </div>
            ) : (
              <>
                {activeTeams.map(team => (
                  <TeamRow
                    key={team.id}
                    team={team}
                    onClick={setEditingTeam}
                    onArchive={handleArchiveTeam}
                  />
                ))}
                {inactiveTeams.length > 0 && (
                  <>
                    <div style={{
                      padding: '8px 16px 4px', fontSize: 11, fontWeight: 700,
                      color: '#9ca3af', textTransform: 'uppercase',
                      background: '#fafafa', borderTop: '1px solid #f3f4f6',
                    }}>
                      Inattive
                    </div>
                    {inactiveTeams.map(team => (
                      <TeamRow
                        key={team.id}
                        team={team}
                        onClick={setEditingTeam}
                        onArchive={handleArchiveTeam}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </SectionAccordion>

          {/* Archivio — solo da qui è possibile l'eliminazione definitiva */}
          <SectionAccordion
            title="Archivio"
            subtitle="Solo dall'archivio è possibile l'eliminazione definitiva"
            count={`${totalArchived} archiviati`}
            isOpen={archiveOpen}
            onToggle={() => setArchiveOpen(p => !p)}
            color="#374151"
            bg="rgba(107,114,128,0.08)"
          >
            {/* Tab interni */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
              {[
                ['dipendenti', `Dipendenti (${archivedEmployees.length})`],
                ['squadre', `Squadre (${archivedTeams.length})`],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setArchiveTab(key)}
                  style={{
                    padding: '10px 20px', fontSize: 13, fontWeight: 700,
                    border: 'none', cursor: 'pointer',
                    borderBottom: archiveTab === key ? '2px solid #374151' : '2px solid transparent',
                    color: archiveTab === key ? '#111827' : '#9ca3af',
                    background: 'transparent',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Avviso */}
            <div style={{
              padding: '9px 16px',
              background: '#fef3c7', borderBottom: '1px solid #fde68a',
              fontSize: 12, color: '#92400e',
            }}>
              L'eliminazione definitiva cancella tutti i dati collegati (presenze, buste paga, allegati) in modo irreversibile e non può essere annullata.
            </div>

            {archiveTab === 'dipendenti' ? (
              <>
                <div className="toolbar" style={compactFilterToolbarStyle}>
                  <div className="toolbar-group" style={compactFilterGroupStyle}>
                    <span className="soft-chip" style={{ background: 'rgba(107, 114, 128, 0.12)', color: '#374151', minHeight: 32, padding: '0 10px', fontSize: 12 }}>
                      {archivedEmployees.length} archiviati visibili
                    </span>

                    {!archiveSelectionMode ? (
                      <button
                        type="button"
                        className="button-secondary"
                        style={compactFilterButtonStyle}
                        onClick={() => setArchiveSelectionMode(true)}
                        disabled={!archivedVisibleEmployeeIds.length}
                      >
                        Seleziona
                      </button>
                    ) : (
                      <>
                        <span className="soft-chip" style={{ background: 'rgba(107,114,128,0.12)', color: '#374151', minHeight: 32, padding: '0 10px', fontSize: 12, fontWeight: 700 }}>
                          {archivedVisibleSelectedCount} selezionati
                        </span>
                        <button
                          type="button"
                          className="button-secondary"
                          style={compactFilterButtonStyle}
                          onClick={() => setSelectedArchivedEmployeeIds(Array.from(new Set([...selectedArchivedEmployeeIds, ...archivedVisibleEmployeeIds])))}
                          disabled={!archivedVisibleEmployeeIds.length}
                        >
                          Seleziona tutto
                        </button>
                        <button
                          type="button"
                          className="button-secondary"
                          style={compactFilterButtonStyle}
                          onClick={() => setSelectedArchivedEmployeeIds((current) => current.filter((id) => !archivedVisibleEmployeeIds.includes(id)))}
                          disabled={!archivedVisibleSelectedCount}
                        >
                          Deseleziona tutto
                        </button>
                        <button
                          type="button"
                          className="button-secondary"
                          style={compactFilterButtonStyle}
                          onClick={handleRestoreSelectedArchivedEmployees}
                          disabled={!archivedVisibleSelectedCount}
                        >
                          Ripristina selezionati
                        </button>
                        <button
                          type="button"
                          className="button-danger"
                          style={compactFilterButtonStyle}
                          onClick={handleDeleteSelectedArchivedEmployees}
                          disabled={!archivedVisibleSelectedCount}
                        >
                          Elimina definitivamente selezionati
                        </button>
                        <button
                          type="button"
                          className="button-secondary"
                          style={compactFilterButtonStyle}
                          onClick={exitArchiveSelectionMode}
                        >
                          Annulla
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {archivedEmployees.length ? (
                  archivedEmployees.map(e => (
                  <ArchivedEmployeeRow
                    key={e.id}
                    employee={e}
                    onRestore={handleRestore}
                    onDelete={handleDeleteEmployee}
                    selectionMode={archiveSelectionMode}
                    selected={selectedArchivedEmployeeIds.includes(e.id)}
                    onToggleSelected={(employeeId, checked) =>
                      setSelectedArchivedEmployeeIds((current) =>
                        checked
                          ? Array.from(new Set([...current, employeeId]))
                          : current.filter((id) => id !== employeeId)
                      )
                    }
                  />
                  ))
                ) : (
                  <div className="empty-state" style={{ padding: '24px 16px' }}>Nessun dipendente archiviato.</div>
                )}
              </>
            ) : (
              archivedTeams.length ? (
                archivedTeams.map(t => (
                  <ArchivedTeamRow
                    key={t.id}
                    team={t}
                    onRestore={handleRestoreTeam}
                    onDelete={handleDeleteTeam}
                  />
                ))
              ) : (
                <div className="empty-state" style={{ padding: '24px 16px' }}>Nessuna squadra archiviata.</div>
              )
            )}
          </SectionAccordion>
        </div>
      )}

      {showForm && (
        <EmployeeForm
          open={showForm}
          onClose={() => setShowForm(false)}
          onSubmit={handleCreate}
        />
      )}

      {showTeamForm && (
        <TeamForm
          open={showTeamForm}
          onClose={() => setShowTeamForm(false)}
          onSubmit={handleCreateTeam}
          employees={employees.filter(e => !e.is_deleted)}
        />
      )}

      {editing && (
        <EmployeeForm
          open={!!editing}
          onClose={() => setEditing(null)}
          employee={editing}
          onSubmit={handleUpdate}
        />
      )}

      {editingTeam && (
        <TeamForm
          open={!!editingTeam}
          onClose={() => setEditingTeam(null)}
          onSubmit={handleUpdateTeam}
          team={editingTeam}
          employees={employees.filter(e => !e.is_deleted)}
        />
      )}

      <PdfImportModal
        open={showPdfImport}
        onClose={handleClosePdfImport}
        onConfirm={handleConfirmPdfImport}
        records={pdfImportData?.records || []}
      />
    </div>
  );
}
