import React, { memo, useEffect, useMemo, useRef, useState } from 'react';

function formatMarkerOptionLabel(marker) {
  return [marker?.symbol, marker?.text || marker?.value].filter(Boolean).join(' ');
}

function formatDefaultPresenceValue(attendanceSettings) {
  if (attendanceSettings?.inputMode === 'hours_and_symbol') {
    return attendanceSettings?.quickSymbol || 'X';
  }

  const baseHours = Number(attendanceSettings?.baseHours || 0);
  if (!Number.isFinite(baseHours) || baseHours <= 0) {
    return '';
  }

  return Number.isInteger(baseHours)
    ? String(baseHours)
    : String(baseHours).replace('.', ',');
}

function sortRows(rows = []) {
  return [...rows].sort((left, right) =>
    `${left.employee.last_name || ''} ${left.employee.first_name || ''}`.localeCompare(
      `${right.employee.last_name || ''} ${right.employee.first_name || ''}`,
      'it',
      { sensitivity: 'base' }
    )
  );
}

function getRowDisplayName(row) {
  return `${row.employee.last_name || ''} ${row.employee.first_name || ''}`.trim();
}

function getRowTeamLabel(row) {
  if (row.teamName) {
    return row.teamName;
  }

  if (Array.isArray(row.employee?.team_names) && row.employee.team_names.length) {
    return row.employee.team_names.join(', ');
  }

  if (Array.isArray(row.employee?.team_history) && row.employee.team_history.length) {
    return row.employee.team_history.map((item) => item.name).filter(Boolean).join(', ');
  }

  return '—';
}

const QuickAttendanceSelectedRow = memo(function QuickAttendanceSelectedRow({
  row,
  checked,
  presenceValue,
  overtimeValue,
  markerSelection,
  markersByValue,
  onToggle,
  onRemove,
}) {
  const markerLabel =
    markerSelection === 'keep'
      ? 'Non modificare'
      : markerSelection
      ? formatMarkerOptionLabel(markersByValue.get(markerSelection))
      : 'Nessuno';

  return (
    <div className="quick-attendance-selected-row">
      <label className="quick-attendance-selected-row__checkbox">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle(row.employee.id, event.target.checked)}
        />
      </label>
      <div className="quick-attendance-selected-row__name">
        <div className="quick-attendance-selected-row__primary">{getRowDisplayName(row)}</div>
      </div>
      <div className="quick-attendance-selected-row__team">{getRowTeamLabel(row)}</div>
      <div className="quick-attendance-selected-row__value">{presenceValue || '—'}</div>
      <div className="quick-attendance-selected-row__value">{overtimeValue || '—'}</div>
      <div className="quick-attendance-selected-row__value">{markerLabel}</div>
      <div className="quick-attendance-selected-row__actions">
        <button
          type="button"
          className="button-danger"
          onClick={() => onRemove(row.employee.id)}
        >
          Rimuovi
        </button>
      </div>
    </div>
  );
});

export default function QuickAttendanceModal({
  open,
  quickDate,
  onClose,
  rows,
  saveState,
  onApplyHours,
  onApplyOvertime,
  onApplyMarker,
  attendanceSettings,
  markers = [],
}) {
  const searchInputRef = useRef(null);
  const resultsRef = useRef(null);
  const selectedRowsRef = useRef(null);
  const [presenceValue, setPresenceValue] = useState('');
  const [overtimeValue, setOvertimeValue] = useState('');
  const [markerSelection, setMarkerSelection] = useState('keep');
  const [searchText, setSearchText] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState([]);
  const [checkedState, setCheckedState] = useState({});
  const [highlightedEmployeeId, setHighlightedEmployeeId] = useState(null);

  const sortedRows = useMemo(() => sortRows(rows), [rows]);
  const rowsByEmployeeId = useMemo(
    () => new Map(sortedRows.map((row) => [Number(row.employee.id), row])),
    [sortedRows]
  );
  const markersByValue = useMemo(
    () => new Map(markers.map((marker) => [marker.value, marker])),
    [markers]
  );
  const normalizedSearch = useMemo(() => searchText.trim().toLowerCase(), [searchText]);

  useEffect(() => {
    if (!open) {
      setSearchText('');
      setIsSearchOpen(false);
      setSelectedRowIds([]);
      setCheckedState({});
      setHighlightedEmployeeId(null);
      return;
    }

    setPresenceValue(formatDefaultPresenceValue(attendanceSettings));
    setOvertimeValue('');
    setMarkerSelection('keep');
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, [attendanceSettings, open]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (!resultsRef.current?.contains(event.target) && !searchInputRef.current?.contains(event.target)) {
        setIsSearchOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open]);

  const searchResults = useMemo(() => {
    if (!normalizedSearch) {
      return [];
    }

    return sortedRows.filter((row) => {
      const haystack = [
        row.employee.full_name,
        row.employee.first_name,
        row.employee.last_name,
        `${row.employee.first_name || ''} ${row.employee.last_name || ''}`,
        `${row.employee.last_name || ''} ${row.employee.first_name || ''}`,
        getRowTeamLabel(row),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [normalizedSearch, sortedRows]);

  const selectedRows = useMemo(
    () => selectedRowIds
      .map((employeeId) => rowsByEmployeeId.get(Number(employeeId)))
      .filter(Boolean),
    [rowsByEmployeeId, selectedRowIds]
  );

  const checkedIds = useMemo(
    () => selectedRowIds.filter((employeeId) => checkedState[employeeId] !== false),
    [selectedRowIds, checkedState]
  );

  const saveStateTone =
    saveState === 'saving' || saveState === 'saved' || saveState === 'error'
      ? saveState
      : 'idle';

  function addEmployeeToSelection(row) {
    const employeeId = Number(row.employee.id);
    setSelectedRowIds((current) => {
      if (current.includes(employeeId)) {
        setHighlightedEmployeeId(employeeId);
        window.requestAnimationFrame(() => {
          selectedRowsRef.current
            ?.querySelector(`[data-employee-row="${employeeId}"]`)
            ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        return current;
      }
      return [...current, employeeId];
    });
    setCheckedState((current) => ({
      ...current,
      [employeeId]: true,
    }));
    setSearchText('');
    setIsSearchOpen(false);
    setHighlightedEmployeeId(employeeId);
  }

  function handleToggle(employeeId, checked) {
    setCheckedState((current) => ({
      ...current,
      [employeeId]: checked,
    }));
  }

  function handleRemove(employeeId) {
    setSelectedRowIds((current) => current.filter((id) => Number(id) !== Number(employeeId)));
    setCheckedState((current) => {
      const next = { ...current };
      delete next[employeeId];
      return next;
    });
  }

  function handleSelectAll() {
    setCheckedState((current) => {
      const next = { ...current };
      selectedRowIds.forEach((employeeId) => {
        next[employeeId] = true;
      });
      return next;
    });
  }

  function handleDeselectAll() {
    setCheckedState((current) => {
      const next = { ...current };
      selectedRowIds.forEach((employeeId) => {
        next[employeeId] = false;
      });
      return next;
    });
  }

  function handleApply() {
    if (!checkedIds.length) {
      return;
    }

    if (presenceValue.trim()) {
      onApplyHours(checkedIds, quickDate, presenceValue.trim());
    }

    if (overtimeValue.trim()) {
      onApplyOvertime?.(checkedIds, quickDate, overtimeValue.trim());
    }

    if (markerSelection !== 'keep') {
      onApplyMarker?.(checkedIds, quickDate, markerSelection);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay">
      <div className="modal-dialog quick-attendance-modal">
        <div className="quick-attendance-modal__topbar">
          <div className="quick-attendance-modal__search-wrap">
            <label className="quick-attendance-modal__field">
              <span>Cerca dipendente</span>
              <input
                ref={searchInputRef}
                type="text"
                value={searchText}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setSearchText(nextValue);
                  setIsSearchOpen(nextValue.trim().length > 0);
                }}
                onFocus={() => {
                  if (searchText.trim()) {
                    setIsSearchOpen(true);
                  }
                }}
                placeholder="Nome o cognome"
              />
            </label>

            {isSearchOpen ? (
              <div className="quick-attendance-modal__results" ref={resultsRef}>
                {searchResults.length ? (
                  searchResults.map((row) => {
                    const employeeId = Number(row.employee.id);
                    const alreadySelected = selectedRowIds.includes(employeeId);
                    return (
                      <button
                        key={`quick-result-${employeeId}`}
                        type="button"
                        className={`quick-attendance-modal__result ${alreadySelected ? 'quick-attendance-modal__result--selected' : ''}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => addEmployeeToSelection(row)}
                      >
                        <span className="quick-attendance-modal__result-name">{getRowDisplayName(row)}</span>
                        <span className="quick-attendance-modal__result-team">{getRowTeamLabel(row)}</span>
                      </button>
                    );
                  })
                ) : (
                  <div className="quick-attendance-modal__empty">Nessun dipendente trovato</div>
                )}
              </div>
            ) : null}
          </div>

          <label className="quick-attendance-modal__field">
            <span>Presenza</span>
            <input
              type="text"
              value={presenceValue}
              onChange={(event) => setPresenceValue(event.target.value)}
              placeholder={attendanceSettings?.inputMode === 'hours_and_symbol' ? `Es. ${attendanceSettings.quickSymbol}` : 'Ore'}
            />
          </label>

          <label className="quick-attendance-modal__field">
            <span>Straordinario</span>
            <input
              type="text"
              value={overtimeValue}
              onChange={(event) => setOvertimeValue(event.target.value)}
              placeholder="Ore"
            />
          </label>

          <label className="quick-attendance-modal__field">
            <span>Marker</span>
            <select value={markerSelection} onChange={(event) => setMarkerSelection(event.target.value)}>
              <option value="keep">Non modificare</option>
              <option value="">Nessun marker</option>
              {markers.map((marker) => (
                <option key={marker.value} value={marker.value}>
                  {formatMarkerOptionLabel(marker)}
                </option>
              ))}
            </select>
          </label>

          <div className="quick-attendance-modal__summary">
            <span className="quick-attendance-modal__counter">{checkedIds.length} selezionati</span>
          </div>

          <div className="quick-attendance-modal__actions">
            <button type="button" className="button" onClick={handleApply} disabled={!checkedIds.length}>
              Applica
            </button>
            <button type="button" className="button-secondary" onClick={onClose}>
              Annulla
            </button>
          </div>
        </div>

        <div className="quick-attendance-modal__info">
          Scrivi il nome del dipendente e clicca sul risultato per aggiungerlo alla lista.
        </div>

        <div className="quick-attendance-modal__list-toolbar">
          <div className="quick-attendance-modal__list-actions">
            <button type="button" className="button-secondary" onClick={handleSelectAll} disabled={!selectedRowIds.length}>
              Seleziona tutti
            </button>
            <button type="button" className="button-secondary" onClick={handleDeselectAll} disabled={!selectedRowIds.length}>
              Deseleziona tutti
            </button>
          </div>
          <span className={`quick-attendance-modal__status quick-attendance-modal__status--${saveStateTone}`}>
            {saveState === 'saving' ? 'Salvataggio...' : saveState === 'saved' ? 'Salvato' : saveState === 'error' ? 'Errore' : 'Pronto'}
          </span>
        </div>

        <div className="quick-attendance-modal__selected">
          <div className="quick-attendance-modal__selected-head">
            <div>Checkbox</div>
            <div>Nome dipendente</div>
            <div>Squadra</div>
            <div>Presenza</div>
            <div>Straordinario</div>
            <div>Marker</div>
            <div>Rimuovi</div>
          </div>

          <div className="quick-attendance-modal__selected-body" ref={selectedRowsRef}>
            {selectedRows.length ? (
              selectedRows.map((row) => {
                const employeeId = Number(row.employee.id);
                return (
                  <div
                    key={`selected-${employeeId}`}
                    data-employee-row={employeeId}
                    className={`quick-attendance-selected-row-wrap ${highlightedEmployeeId === employeeId ? 'quick-attendance-selected-row-wrap--highlighted' : ''}`}
                  >
                    <QuickAttendanceSelectedRow
                      row={row}
                      checked={checkedState[employeeId] !== false}
                      presenceValue={presenceValue.trim()}
                      overtimeValue={overtimeValue.trim()}
                      markerSelection={markerSelection}
                      markersByValue={markersByValue}
                      onToggle={handleToggle}
                      onRemove={handleRemove}
                    />
                  </div>
                );
              })
            ) : (
              <div className="quick-attendance-modal__empty-state">
                Nessun dipendente selezionato.
              </div>
            )}
          </div>
        </div>

        <div className="quick-attendance-modal__footer-note">
          Click singolo: inserisce il valore rapido • Doppio click: dettaglio avanzato
        </div>
      </div>
    </div>
  );
}
