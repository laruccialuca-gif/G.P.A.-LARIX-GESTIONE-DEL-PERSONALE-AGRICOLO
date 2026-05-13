import React, { useEffect, useMemo, useRef, useState } from 'react';

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
  const [selectionState, setSelectionState] = useState({});
  const [presenceValue, setPresenceValue] = useState('');
  const [overtimeValue, setOvertimeValue] = useState('');
  const [markerSelection, setMarkerSelection] = useState('keep');
  const [searchText, setSearchText] = useState('');
  const [dateInput, setDateInput] = useState(formatDateForDisplay(quickDate));

  const sortedRows = useMemo(() => sortRows(rows), [rows]);

  useEffect(() => {
    setDateInput(formatDateForDisplay(quickDate));
  }, [quickDate]);

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

    setSelectionState(nextSelection);
    setPresenceValue(formatDefaultPresenceValue(attendanceSettings));
    setOvertimeValue('');
    setMarkerSelection('keep');
    setSearchText('');
    didInitOpenRef.current = true;
  }, [attendanceSettings, open, sortedRows]);

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
      .map(([employeeId]) => Number(employeeId)),
    [selectionState]
  );

  function handleToggle(employeeId, checked) {
    setSelectionState((current) => ({
      ...current,
      [employeeId]: checked,
    }));
  }

  function handleSelectAll() {
    const next = {};
    for (const row of sortedRows) {
      next[row.employee.id] = true;
    }
    setSelectionState(next);
  }

  function handleDeselectAll() {
    const next = {};
    for (const row of sortedRows) {
      next[row.employee.id] = false;
    }
    setSelectionState(next);
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

  function handleApply() {
    if (!selectedIds.length) {
      return;
    }

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
            <span className="soft-chip" style={{ background: 'rgba(37, 99, 235, 0.12)', color: '#1d4ed8' }}>
              {selectedIds.length} selezionati
            </span>
            <span
              className="soft-chip"
              style={{
                background:
                  saveState === 'saving'
                    ? 'rgba(15, 118, 110, 0.12)'
                    : saveState === 'saved'
                    ? 'rgba(16, 185, 129, 0.14)'
                    : saveState === 'error'
                    ? 'rgba(239, 68, 68, 0.12)'
                    : 'rgba(20, 33, 61, 0.06)',
                color:
                  saveState === 'saving'
                    ? '#115e59'
                    : saveState === 'saved'
                    ? '#047857'
                    : saveState === 'error'
                    ? '#b91c1c'
                    : '#314762',
              }}
            >
              {saveState === 'saving' ? 'Salvataggio...' : saveState === 'saved' ? 'Salvato' : saveState === 'error' ? 'Errore' : 'Pronto'}
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
          <button type="button" className="button-secondary" onClick={handleSelectAll}>
            Seleziona tutti
          </button>
          <button type="button" className="button-secondary" onClick={handleDeselectAll}>
            Deseleziona tutti
          </button>
        </div>

        <div className="quick-attendance-modal__list">
          {filteredRows.map((row) => {
            const isSelected = !!selectionState[row.employee.id];
            return (
              <label key={row.employee.id} className={`quick-attendance-row ${isSelected ? 'quick-attendance-row--selected' : ''}`}>
                <div className="quick-attendance-row__main">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(event) => handleToggle(row.employee.id, event.target.checked)}
                  />
                  <div className="quick-attendance-row__name">
                    {row.employee.last_name} {row.employee.first_name}
                  </div>
                </div>
                <div className="quick-attendance-row__meta">
                  <span>{row.employee.role || 'Nessuna mansione'}</span>
                  {row.teamName ? <span>{row.teamName}</span> : null}
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
