import React, { memo, useEffect, useMemo, useRef, useState } from 'react';

function formatDateForDisplay(value) {
  const [year, month, day] = String(value || '').split('-');
  if (!year || !month || !day) return '';
  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
}

function parseDisplayDate(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';

  const [, rawDay, rawMonth, rawYear] = match;
  const day = Number(rawDay);
  const month = Number(rawMonth);
  const year = Number(rawYear);
  const parsed = new Date(year, month - 1, day);

  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return '';
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

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
    `${left.employee.last_name} ${left.employee.first_name}`.localeCompare(
      `${right.employee.last_name} ${right.employee.first_name}`,
      'it',
      { sensitivity: 'base' }
    )
  );
}

const QuickAttendanceListRow = memo(function QuickAttendanceListRow({
  employeeId,
  label,
  selected,
  onToggle,
}) {
  return (
    <label
      className={`quick-attendance-row ${selected ? 'quick-attendance-row--selected' : ''}`}
      onDoubleClick={() => onToggle(employeeId, !selected)}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(event) => onToggle(employeeId, event.target.checked)}
      />
      <span className="quick-attendance-row__name">{label}</span>
    </label>
  );
});

export default function QuickAttendanceModal({
  open,
  quickDate,
  onDateChange,
  onClose,
  rows,
  saveState,
  onApplyHours,
  onApplyOvertime,
  onApplyMarker,
  attendanceSettings,
  markers = [],
}) {
  const didInitOpenRef = useRef(false);
  const presenceInputRef = useRef(null);
  const [selectionState, setSelectionState] = useState({});
  const [presenceValue, setPresenceValue] = useState('');
  const [overtimeValue, setOvertimeValue] = useState('');
  const [markerSelection, setMarkerSelection] = useState('keep');
  const [searchText, setSearchText] = useState('');
  const [dateInput, setDateInput] = useState(formatDateForDisplay(quickDate));
  const [keepSelection, setKeepSelection] = useState(true);

  const sortedRows = useMemo(() => sortRows(rows), [rows]);
  const sortedEmployeeIds = useMemo(
    () => sortedRows.map((row) => Number(row.employee.id)),
    [sortedRows]
  );

  useEffect(() => {
    setDateInput(formatDateForDisplay(quickDate));
  }, [quickDate]);

  useEffect(() => {
    if (!open || !searchText.trim()) {
      return;
    }
    console.info('[attendance-debug] quick-entry-search', {
      query: searchText,
      total_rows: sortedRows.length,
    });
  }, [open, searchText, sortedRows.length]);

  useEffect(() => {
    if (!open) {
      didInitOpenRef.current = false;
      return;
    }

    if (didInitOpenRef.current) {
      return;
    }

    const nextSelection = {};
    for (const row of sortedRows) {
      nextSelection[row.employee.id] = true;
    }

    setSelectionState((current) => (keepSelection && Object.keys(current).length ? current : nextSelection));
    setPresenceValue(formatDefaultPresenceValue(attendanceSettings));
    setOvertimeValue('');
    setMarkerSelection('keep');
    setSearchText('');
    didInitOpenRef.current = true;
    window.requestAnimationFrame(() => {
      presenceInputRef.current?.focus();
      presenceInputRef.current?.select?.();
    });
    console.info('[attendance-debug] quick-entry-open', {
      date: quickDate,
      employees_count: sortedRows.length,
    });
  }, [attendanceSettings, keepSelection, open, quickDate, sortedRows]);

  const filteredRows = useMemo(() => {
    if (!searchText.trim()) {
      return sortedRows;
    }

    const lower = searchText.toLowerCase();
    return sortedRows.filter((row) =>
      `${row.employee.last_name} ${row.employee.first_name}`.toLowerCase().includes(lower) ||
      `${row.employee.first_name} ${row.employee.last_name}`.toLowerCase().includes(lower)
    );
  }, [searchText, sortedRows]);

  const selectedIds = useMemo(
    () => Object.entries(selectionState)
      .filter(([, selected]) => !!selected)
      .map(([employeeId]) => Number(employeeId))
      .filter((employeeId) => sortedEmployeeIds.includes(employeeId)),
    [selectionState, sortedEmployeeIds]
  );
  const saveStateTone =
    saveState === 'saving' || saveState === 'saved' || saveState === 'error'
      ? saveState
      : 'idle';

  function handleToggle(employeeId, checked) {
    setSelectionState((current) => ({
      ...current,
      [employeeId]: checked,
    }));
  }

  function handleDateInputChange(value) {
    setDateInput(value);
    const parsed = parseDisplayDate(value);
    if (parsed) {
      onDateChange(parsed);
    }
  }

  function handleDateInputBlur() {
    const parsed = parseDisplayDate(dateInput);
    setDateInput(formatDateForDisplay(parsed || quickDate));
  }

  function handleToggleAll(nextValue) {
    const next = {};
    for (const row of sortedRows) {
      next[row.employee.id] = nextValue;
    }
    setSelectionState(next);
  }

  function handleApply() {
    if (!selectedIds.length) {
      return;
    }

    console.info('[attendance-debug] quick-entry-apply', {
      date: quickDate,
      selected_count: selectedIds.length,
      presence: presenceValue.trim(),
      overtime: overtimeValue.trim(),
      marker: markerSelection,
    });

    if (presenceValue.trim()) {
      onApplyHours(selectedIds, quickDate, presenceValue.trim());
    }

    if (overtimeValue.trim()) {
      onApplyOvertime?.(selectedIds, quickDate, overtimeValue.trim());
    }

    if (markerSelection !== 'keep') {
      onApplyMarker?.(selectedIds, quickDate, markerSelection);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-dialog quick-attendance-modal">
        <div className="quick-attendance-modal__bar">
          <div className="quick-attendance-modal__field quick-attendance-modal__field--date">
            <span>Data</span>
            <input
              type="text"
              inputMode="numeric"
              value={dateInput}
              onChange={(event) => handleDateInputChange(event.target.value)}
              onBlur={handleDateInputBlur}
              placeholder="gg/mm/aaaa"
            />
          </div>

          <div className="quick-attendance-modal__field">
            <span>Presenza</span>
            <input
              ref={presenceInputRef}
              type="text"
              value={presenceValue}
              onChange={(event) => setPresenceValue(event.target.value)}
              placeholder={attendanceSettings?.inputMode === 'hours_and_symbol' ? `Es. ${attendanceSettings.quickSymbol}` : 'Ore'}
            />
          </div>

          <div className="quick-attendance-modal__field">
            <span>Straordinario</span>
            <input
              type="text"
              value={overtimeValue}
              onChange={(event) => setOvertimeValue(event.target.value)}
              placeholder="Ore"
            />
          </div>

          <div className="quick-attendance-modal__field">
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
          </div>

          <div className="quick-attendance-modal__field quick-attendance-modal__field--search">
            <span>Cerca dipendente</span>
            <input
              type="text"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Nome o cognome"
            />
          </div>

          <div className="quick-attendance-modal__summary">
            <span className="quick-attendance-modal__counter">
              {selectedIds.length} selezionati
            </span>
          </div>

          <div className="quick-attendance-modal__actions">
            <button type="button" className="button" onClick={handleApply} disabled={!selectedIds.length}>
              Applica
            </button>
            <button type="button" className="button-secondary" onClick={onClose}>
              Annulla
            </button>
          </div>
        </div>

        <div className="quick-attendance-modal__list-head">
          <button type="button" className="button-secondary" onClick={() => handleToggleAll(true)}>
            Seleziona tutti
          </button>
          <button type="button" className="button-secondary" onClick={() => handleToggleAll(false)}>
            Deseleziona tutti
          </button>
          <label className="quick-attendance-modal__keep">
            <input
              type="checkbox"
              checked={keepSelection}
              onChange={(event) => setKeepSelection(event.target.checked)}
            />
            <span>Mantieni selezione</span>
          </label>
          <span className={`quick-attendance-modal__status quick-attendance-modal__status--${saveStateTone}`}>
            {saveState === 'saving' ? 'Salvataggio...' : saveState === 'saved' ? 'Salvato' : saveState === 'error' ? 'Errore' : 'Pronto'}
          </span>
        </div>

        <div className="quick-attendance-modal__list">
          {filteredRows.map((row) => {
            const isSelected = !!selectionState[row.employee.id];
            return (
              <QuickAttendanceListRow
                key={row.employee.id}
                employeeId={row.employee.id}
                label={`${row.employee.last_name} ${row.employee.first_name}`}
                selected={isSelected}
                onToggle={handleToggle}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
