import React, { useEffect, useMemo, useState } from 'react';

function sortEmployees(employees = []) {
  return [...employees].sort((a, b) =>
    `${a.last_name} ${a.first_name}`.localeCompare(
      `${b.last_name} ${b.first_name}`,
      'it',
      { sensitivity: 'base' }
    )
  );
}

export default function AttendanceEmployeeFilter({ availableEmployees, selectedIds, onChange }) {
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
      `${employee.last_name} ${employee.first_name}`.toLowerCase().includes(lower) ||
      `${employee.first_name} ${employee.last_name}`.toLowerCase().includes(lower)
    );
  }, [searchText, sortedEmployees]);

  const selectedSet = useMemo(() => new Set(draftSelectedIds.map((id) => Number(id))), [draftSelectedIds]);
  const selectedCount = draftSelectedIds.length;

  function handleOpen() {
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

            <div className="attendance-filter-modal__list">
              {filteredEmployees.map((employee) => {
                const isSelected = selectedSet.has(Number(employee.id));
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
                    <span className="attendance-filter-modal__name">
                      {employee.last_name} {employee.first_name}
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
