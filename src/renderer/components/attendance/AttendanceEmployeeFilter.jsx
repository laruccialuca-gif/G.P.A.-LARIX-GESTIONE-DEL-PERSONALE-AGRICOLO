import React, { useEffect, useMemo, useState } from 'react';
import { compareAttendanceEmployees, formatAttendanceEmployeeDisplayName } from '../../utils/attendanceEmployeeNames';

function sortEmployees(employees = []) {
  return [...employees].sort((a, b) => compareAttendanceEmployees(a, b));
}

function getEmployeeTeamNames(employee = {}) {
  const directTeamName = String(employee.team_name || employee.teamName || '').trim();
  const groupedNames = Array.isArray(employee.team_names)
    ? employee.team_names
    : typeof employee.team_names === 'string'
    ? employee.team_names.split(',')
    : [];
  const historyNames = Array.isArray(employee.team_history)
    ? employee.team_history.map((item) => item?.name).filter(Boolean)
    : [];

  return [...new Set(
    [
      ...(directTeamName ? [directTeamName] : []),
      ...groupedNames,
      ...historyNames,
    ]
      .map((name) => String(name || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
}

export default function AttendanceEmployeeFilter({ availableEmployees, selectedIds, onChange, onOpen = null }) {
  const [showModal, setShowModal] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [draftSelectedIds, setDraftSelectedIds] = useState(selectedIds);

  const sortedEmployees = useMemo(() => sortEmployees(availableEmployees), [availableEmployees]);
  const totalEmployees = sortedEmployees.length;

  useEffect(() => {
    if (!showModal) {
      setDraftSelectedIds(selectedIds);
    }
  }, [selectedIds, showModal]);

  const filteredEmployees = useMemo(() => {
    if (!searchText.trim()) {
      return sortedEmployees;
    }

    const lower = searchText.toLowerCase();
    return sortedEmployees.filter((employee) =>
      formatAttendanceEmployeeDisplayName(employee).toLowerCase().includes(lower) ||
      `${employee.first_name} ${employee.last_name}`.toLowerCase().includes(lower) ||
      getEmployeeTeamNames(employee).some((teamName) => teamName.toLowerCase().includes(lower))
    );
  }, [searchText, sortedEmployees]);

  const selectedSet = useMemo(() => new Set(draftSelectedIds.map((id) => Number(id))), [draftSelectedIds]);
  const selectedCount = draftSelectedIds.length;
  const teamGroups = useMemo(() => {
    const map = new Map();
    filteredEmployees.forEach((employee) => {
      const teamNames = getEmployeeTeamNames(employee);
      teamNames.forEach((teamName) => {
        const list = map.get(teamName) || [];
        list.push(Number(employee.id));
        map.set(teamName, list);
      });
    });

    return [...map.entries()]
      .map(([teamName, employeeIds]) => ({
        teamName,
        employeeIds: [...new Set(employeeIds)].sort((a, b) => a - b),
      }))
      .sort((left, right) => left.teamName.localeCompare(right.teamName, 'it', { sensitivity: 'base' }));
  }, [filteredEmployees]);

  function handleOpen() {
    if (typeof onOpen === 'function') {
      onOpen();
    }
    setDraftSelectedIds(selectedIds);
    setSearchText('');
    setShowModal(true);
  }

  function handleClose() {
    setDraftSelectedIds(selectedIds);
    setSearchText('');
    setShowModal(false);
  }

  function handleToggle(employeeId) {
    setDraftSelectedIds((current) =>
      current.includes(employeeId)
        ? current.filter((id) => id !== employeeId)
        : [...current, employeeId]
    );
  }

  function handleSelectAll() {
    setDraftSelectedIds(sortedEmployees.map((employee) => employee.id));
  }

  function handleDeselectAll() {
    setDraftSelectedIds([]);
  }

  function handleToggleTeam(employeeIds) {
    const numericIds = [...new Set((employeeIds || []).map((id) => Number(id)).filter(Number.isFinite))];
    if (!numericIds.length) return;

    const allSelected = numericIds.every((employeeId) => selectedSet.has(employeeId));
    setDraftSelectedIds((current) => {
      const currentSet = new Set(current.map((id) => Number(id)));
      if (allSelected) {
        numericIds.forEach((employeeId) => currentSet.delete(employeeId));
      } else {
        numericIds.forEach((employeeId) => currentSet.add(employeeId));
      }
      return sortEmployees(
        sortedEmployees.filter((employee) => currentSet.has(Number(employee.id)))
      ).map((employee) => employee.id);
    });
  }

  function handleConfirm() {
    onChange(sortEmployees(
      sortedEmployees.filter((employee) => selectedSet.has(Number(employee.id)))
    ).map((employee) => employee.id));
    setSearchText('');
    setShowModal(false);
  }

  return (
    <>
      <button type="button" className="button-secondary attendance-filter-trigger" onClick={handleOpen}>
        Seleziona dipendenti
        <span className="attendance-filter-trigger__count">
          {selectedCount === 0 ? 'Tutti' : `${selectedCount}/${totalEmployees}`}
        </span>
      </button>

      {showModal ? (
        <div className="modal-overlay" onClick={handleClose}>
          <div className="modal-dialog attendance-filter-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header attendance-filter-modal__header">
              <div>
                <span className="page-kicker">Filtro dipendenti</span>
                <h2 style={{ margin: '4px 0 0', fontSize: 20 }}>Seleziona i nominativi da mostrare</h2>
              </div>
              <button type="button" className="modal-close" onClick={handleClose}>x</button>
            </div>

            <div className="attendance-filter-modal__toolbar">
              <input
                type="text"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Cerca dipendente"
                autoFocus
              />
              <button type="button" className="button-secondary" onClick={handleSelectAll}>
                Seleziona tutti
              </button>
              <button type="button" className="button-secondary" onClick={handleDeselectAll}>
                Deseleziona tutti
              </button>
            </div>

            {teamGroups.length > 0 ? (
              <div className="attendance-filter-modal__teams">
                <div className="attendance-filter-modal__section-title">Squadre</div>
                <div className="attendance-filter-modal__team-list">
                  {teamGroups.map((group) => {
                    const allTeamSelected = group.employeeIds.every((employeeId) => selectedSet.has(employeeId));
                    return (
                      <label
                        key={group.teamName}
                        className={`attendance-filter-modal__row ${allTeamSelected ? 'attendance-filter-modal__row--selected' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={allTeamSelected}
                          onChange={() => handleToggleTeam(group.employeeIds)}
                        />
                        <span className="attendance-filter-modal__name">
                          Squadra {group.teamName}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="attendance-filter-modal__list">
              <div className="attendance-filter-modal__section-title">Dipendenti</div>
              {filteredEmployees.map((employee) => {
                const isSelected = selectedSet.has(Number(employee.id));
                const teamNames = getEmployeeTeamNames(employee);
                return (
                  <label
                    key={employee.id}
                    className={`attendance-filter-modal__row ${isSelected ? 'attendance-filter-modal__row--selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggle(employee.id)}
                    />
                    <span className="attendance-filter-modal__name-wrap">
                      <span className="attendance-filter-modal__name">
                        {formatAttendanceEmployeeDisplayName(employee)}
                      </span>
                      {teamNames.length > 0 ? (
                        <span className="attendance-filter-modal__meta">
                          {teamNames.join(' • ')}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="attendance-filter-modal__footer">
              <button type="button" className="button-secondary" onClick={handleClose}>
                Annulla
              </button>
              <button type="button" className="button" onClick={handleConfirm}>
                Conferma
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
