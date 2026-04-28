import React, { useEffect, useMemo, useRef, useState } from 'react';

function formatContextLabel(scopeType, scopeLabel) {
  if (scopeType === 'team') {
    return `Squadra selezionata: ${scopeLabel}`;
  }
  if (scopeType === 'employee') {
    return `Dipendente selezionato: ${scopeLabel}`;
  }
  return scopeLabel || 'Tutti i dipendenti attivi';
}

function getUniformInitialHours(rows) {
  const selectedRows = rows.filter((row) => row.hasExistingHours);
  if (!selectedRows.length) return '';

  const firstValue = selectedRows[0].initialHours;
  const isUniform = selectedRows.every((row) => row.initialHours === firstValue);
  return isUniform ? firstValue : '';
}

function getUniformInitialParts(rows) {
  const selectedRows = rows.filter((row) => row.hasExistingHours);
  if (!selectedRows.length) {
    return { hours: '', minutes: '' };
  }

  const firstHours = selectedRows[0].initialParts?.hours || '';
  const firstMinutes = selectedRows[0].initialParts?.minutes || '';
  const isUniform = selectedRows.every(
    (row) => (row.initialParts?.hours || '') === firstHours && (row.initialParts?.minutes || '') === firstMinutes
  );

  return isUniform ? { hours: firstHours, minutes: firstMinutes } : { hours: '', minutes: '' };
}

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

function formatDecimalInput(value) {
  const normalized = Number(value || 0);
  if (!Number.isFinite(normalized)) return '';
  return Number.isInteger(normalized) ? String(normalized) : String(normalized).replace('.', ',');
}

function splitDefaultHours(value) {
  const totalMinutes = Math.round(Number(value || 0) * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return {
    hours: String(hours),
    minutes: String(minutes),
  };
}

function getDefaultQuickValue(attendanceSettings) {
  const baseHours = attendanceSettings?.baseHours || 0;

  if (attendanceSettings?.hoursFormat === 'hours_minutes') {
    return splitDefaultHours(baseHours);
  }

  if (attendanceSettings?.inputMode === 'hours_and_symbol') {
    return {
      hours: attendanceSettings?.quickSymbol || 'X',
      minutes: '',
    };
  }

  return {
    hours: formatDecimalInput(baseHours),
    minutes: '',
  };
}

function getPresencePresetValue(preset, attendanceSettings) {
  const baseHours = attendanceSettings?.baseHours || 0;

  if (preset === 'symbol') {
    return {
      hours: attendanceSettings?.quickSymbol || 'X',
      minutes: '',
    };
  }

  if (attendanceSettings?.hoursFormat === 'hours_minutes') {
    return splitDefaultHours(baseHours);
  }

  return {
    hours: formatDecimalInput(baseHours),
    minutes: '',
  };
}

function getOvertimePresetValue(preset, attendanceSettings) {
  if (preset === 'none') {
    return { hours: '', minutes: '' };
  }

  const hoursValue = Number(preset || 0);
  if (attendanceSettings?.hoursFormat === 'hours_minutes') {
    return splitDefaultHours(hoursValue);
  }

  return {
    hours: formatDecimalInput(hoursValue),
    minutes: '',
  };
}

function formatMarkerOptionLabel(marker) {
  return [marker?.symbol, marker?.text || marker?.value].filter(Boolean).join(' ');
}

const quickPanelStyle = {
  padding: 12,
};

const quickControlsGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10,
  alignItems: 'stretch',
};

const quickControlColumnStyle = {
  display: 'grid',
  gap: 7,
  alignContent: 'start',
  minWidth: 0,
};

const quickControlTitleStyle = {
  fontSize: 12,
  fontWeight: 800,
  color: '#115e59',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const quickInlineControlsStyle = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'wrap',
};

const quickSmallButtonStyle = {
  padding: '8px 10px',
  minHeight: 0,
};

export default function QuickAttendanceModal({
  open,
  quickDate,
  onDateChange,
  onClose,
  rows,
  saveState,
  scopeType,
  scopeLabel,
  onApplyHours,
  onApplyOvertime,
  onApplyMarker,
  onClearHours,
  onUseToday,
  onMovePreviousDay,
  onMoveNextDay,
  attendanceSettings,
  markers = [],
}) {
  const wasOpenRef = useRef(false);
  const [selectionState, setSelectionState] = useState({});
  const [presencePreset, setPresencePreset] = useState('default');
  const [commonHours, setCommonHours] = useState('');
  const [commonMinutes, setCommonMinutes] = useState('');
  const [overtimePreset, setOvertimePreset] = useState('none');
  const [commonOvertimeHours, setCommonOvertimeHours] = useState('');
  const [commonOvertimeMinutes, setCommonOvertimeMinutes] = useState('');
  const [markerSelection, setMarkerSelection] = useState('keep');
  const [dateInput, setDateInput] = useState(formatDateForDisplay(quickDate));

  useEffect(() => {
    setDateInput(formatDateForDisplay(quickDate));
  }, [quickDate]);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }

    if (wasOpenRef.current) {
      return;
    }

    const next = {};
    for (const row of rows) {
      next[row.employee.id] = {
        selected: row.hasExistingHours,
      };
    }

    setSelectionState(next);
    wasOpenRef.current = true;
    if (attendanceSettings?.hoursFormat === 'hours_minutes') {
      const uniformParts = getUniformInitialParts(rows);
      const defaultParts = getDefaultQuickValue(attendanceSettings);
      setCommonHours(uniformParts.hours || defaultParts.hours);
      setCommonMinutes(uniformParts.minutes || defaultParts.minutes);
    } else {
      const defaultValue = getDefaultQuickValue(attendanceSettings);
      setCommonHours(getUniformInitialHours(rows) || defaultValue.hours);
      setCommonMinutes('');
    }

    setPresencePreset('default');
    setOvertimePreset('none');
    setCommonOvertimeHours('');
    setCommonOvertimeMinutes('');
    setMarkerSelection('keep');
  }, [open, rows, attendanceSettings]);

  const selectedIds = useMemo(
    () =>
      Object.entries(selectionState)
        .filter(([, item]) => item?.selected)
        .map(([employeeId]) => Number(employeeId)),
    [selectionState]
  );
  const allVisibleSelected = rows.length > 0 && selectedIds.length === rows.length;

  function applyActiveValues(employeeIds) {
    if (!Array.isArray(employeeIds) || !employeeIds.length) {
      return;
    }

    if (commonHours !== '' || commonMinutes !== '') {
      onApplyHours(employeeIds, quickDate, commonHours, commonMinutes);
    }

    if (overtimePreset !== 'none' || commonOvertimeHours !== '' || commonOvertimeMinutes !== '') {
      onApplyOvertime?.(employeeIds, quickDate, commonOvertimeHours, commonOvertimeMinutes);
    }

    if (markerSelection !== 'keep') {
      onApplyMarker?.(employeeIds, quickDate, markerSelection);
    }
  }

  function handleToggle(employeeId, checked) {
    setSelectionState((current) => ({
      ...current,
      [employeeId]: {
        selected: checked,
      },
    }));

    if (!checked) {
      onClearHours(employeeId, quickDate);
      return;
    }

    applyActiveValues([employeeId]);
  }

  function handlePresencePresetChange(value) {
    setPresencePreset(value);
    if (value === 'custom') {
      return;
    }

    const next = getPresencePresetValue(value, attendanceSettings);
    setCommonHours(next.hours);
    setCommonMinutes(next.minutes);

    if (selectedIds.length) {
      onApplyHours(selectedIds, quickDate, next.hours, next.minutes);
    }
  }

  function handleCommonHoursChange(value) {
    setPresencePreset('custom');
    setCommonHours(value);

    if (!selectedIds.length) {
      return;
    }

    if (value === '' && commonMinutes === '') {
      selectedIds.forEach((employeeId) => onClearHours(employeeId, quickDate));
      return;
    }

    onApplyHours(selectedIds, quickDate, value, commonMinutes);
  }

  function handleCommonMinutesChange(value) {
    setPresencePreset('custom');
    setCommonMinutes(value);

    if (!selectedIds.length) {
      return;
    }

    if (commonHours === '' && value === '') {
      selectedIds.forEach((employeeId) => onClearHours(employeeId, quickDate));
      return;
    }

    onApplyHours(selectedIds, quickDate, commonHours, value);
  }

  function handleOvertimePresetChange(value) {
    setOvertimePreset(value);
    if (value === 'custom') {
      return;
    }

    const next = getOvertimePresetValue(value, attendanceSettings);
    setCommonOvertimeHours(next.hours);
    setCommonOvertimeMinutes(next.minutes);

    if (selectedIds.length) {
      onApplyOvertime?.(selectedIds, quickDate, next.hours, next.minutes);
    }
  }

  function handleCommonOvertimeHoursChange(value) {
    setOvertimePreset('custom');
    setCommonOvertimeHours(value);

    if (selectedIds.length) {
      onApplyOvertime?.(selectedIds, quickDate, value, commonOvertimeMinutes);
    }
  }

  function handleCommonOvertimeMinutesChange(value) {
    setOvertimePreset('custom');
    setCommonOvertimeMinutes(value);

    if (selectedIds.length) {
      onApplyOvertime?.(selectedIds, quickDate, commonOvertimeHours, value);
    }
  }

  function handleMarkerSelectionChange(value) {
    setMarkerSelection(value);
    if (value !== 'keep' && selectedIds.length) {
      onApplyMarker?.(selectedIds, quickDate, value);
    }
  }

  function handleSelectAll() {
    const next = {};
    const employeeIds = rows.map((row) => row.employee.id);

    for (const row of rows) {
      next[row.employee.id] = { selected: true };
    }

    setSelectionState(next);

    applyActiveValues(employeeIds);
  }

  function handleDeselectAll() {
    const next = {};
    for (const row of rows) {
      next[row.employee.id] = { selected: false };
      onClearHours(row.employee.id, quickDate);
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

  if (!open) return null;

  return (
    <div className="modal-overlay">
      <div
        className="modal-dialog"
        style={{
          width: 'min(1380px, 100%)',
          maxHeight: '94vh',
          padding: 16,
        }}
      >
        <div className="modal-header" style={{ marginBottom: 10 }}>
          <div>
            <span className="page-kicker">Inserimento rapido giornaliero</span>
            <h2 style={{ margin: '4px 0 0', fontSize: 22 }}>Compila presenze, straordinari e marker in blocco</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="form-grid" style={{ gap: 10 }}>
          <div className="panel panel-section" style={quickPanelStyle}>
            <div style={quickControlsGridStyle}>
              <div style={quickControlColumnStyle}>
                <div style={quickControlTitleStyle}>Data</div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={dateInput}
                  onChange={(event) => handleDateInputChange(event.target.value)}
                  onBlur={handleDateInputBlur}
                  onFocus={(event) => event.currentTarget.select()}
                  placeholder="gg/mm/aaaa"
                  style={{ width: '100%' }}
                />
                <div style={quickInlineControlsStyle}>
                  <button type="button" className="button-secondary" style={quickSmallButtonStyle} onClick={onUseToday}>
                    Oggi
                  </button>
                  <button type="button" className="button-secondary" style={quickSmallButtonStyle} onClick={onMovePreviousDay}>
                    -1
                  </button>
                  <button type="button" className="button-secondary" style={quickSmallButtonStyle} onClick={onMoveNextDay}>
                    +1
                  </button>
                </div>
                <div style={{ color: '#667085', fontSize: 12, lineHeight: 1.25 }}>
                  {formatContextLabel(scopeType, scopeLabel)}
                </div>
              </div>

              <div style={quickControlColumnStyle}>
                <div style={quickControlTitleStyle}>Presenze</div>
                <div style={quickInlineControlsStyle}>
                <select
                  value={presencePreset}
                  onChange={(event) => handlePresencePresetChange(event.target.value)}
                  style={{ minWidth: 140, flex: '1 1 140px' }}
                >
                  <option value="default">Giornata base</option>
                  {attendanceSettings?.inputMode === 'hours_and_symbol' ? (
                    <option value="symbol">Simbolo {attendanceSettings.quickSymbol}</option>
                  ) : null}
                  <option value="custom">Valore manuale</option>
                </select>
                {attendanceSettings?.hoursFormat === 'hours_minutes' ? (
                  <>
                    <input
                      type="text"
                      value={commonHours}
                      onChange={(event) => handleCommonHoursChange(event.target.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      placeholder={attendanceSettings?.inputMode === 'hours_and_symbol' ? `${attendanceSettings.quickSymbol} o h` : 'Ore'}
                      style={{ width: 72, textAlign: 'center' }}
                    />
                    <input
                      type="text"
                      value={commonMinutes}
                      onChange={(event) => handleCommonMinutesChange(event.target.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      placeholder="Min"
                      style={{ width: 62, textAlign: 'center' }}
                    />
                  </>
                ) : (
                  <input
                    type="text"
                    value={commonHours}
                    onChange={(event) => handleCommonHoursChange(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    placeholder={
                      attendanceSettings?.inputMode === 'hours_and_symbol'
                        ? `Es. ${attendanceSettings.quickSymbol} o ${attendanceSettings.baseHours}`
                        : 'Ore per tutti'
                    }
                    style={{ width: 100, textAlign: 'center' }}
                  />
                )}
              </div>
              </div>

              <div style={quickControlColumnStyle}>
                <div style={quickControlTitleStyle}>Straordinari</div>
                <div style={quickInlineControlsStyle}>
                <select
                  value={overtimePreset}
                  onChange={(event) => handleOvertimePresetChange(event.target.value)}
                  style={{ minWidth: 140, flex: '1 1 140px' }}
                >
                  <option value="none">Nessuno</option>
                  <option value="0.5">30 minuti</option>
                  <option value="1">1 ora</option>
                  <option value="2">2 ore</option>
                  <option value="custom">Valore manuale</option>
                </select>
                {attendanceSettings?.hoursFormat === 'hours_minutes' ? (
                  <>
                    <input
                      type="text"
                      value={commonOvertimeHours}
                      onChange={(event) => handleCommonOvertimeHoursChange(event.target.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      placeholder="Ore"
                      style={{ width: 72, textAlign: 'center' }}
                    />
                    <input
                      type="text"
                      value={commonOvertimeMinutes}
                      onChange={(event) => handleCommonOvertimeMinutesChange(event.target.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      placeholder="Min"
                      style={{ width: 62, textAlign: 'center' }}
                    />
                  </>
                ) : (
                  <input
                    type="text"
                    value={commonOvertimeHours}
                    onChange={(event) => handleCommonOvertimeHoursChange(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    placeholder="Straordinario"
                    style={{ width: 100, textAlign: 'center' }}
                  />
                )}
              </div>
              </div>

              <div style={quickControlColumnStyle}>
                <div style={quickControlTitleStyle}>Marker</div>
              <select
                value={markerSelection}
                onChange={(event) => handleMarkerSelectionChange(event.target.value)}
                  style={{ width: '100%' }}
              >
                <option value="keep">Non modificare marker</option>
                <option value="">Nessun marker</option>
                {markers.map((marker) => (
                  <option key={marker.value} value={marker.value}>
                    {formatMarkerOptionLabel(marker)}
                  </option>
                ))}
              </select>
                <div style={quickInlineControlsStyle}>
                  <div className="soft-chip" style={{ background: 'rgba(37, 99, 235, 0.12)', color: '#1d4ed8', padding: '5px 9px' }}>
                    {selectedIds.length} selezionati
                  </div>
                  <span
                    className="soft-chip"
                    style={{
                      padding: '5px 9px',
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
                    {saveState === 'saving'
                      ? 'Salvataggio...'
                      : saveState === 'saved'
                      ? 'Salvato'
                      : saveState === 'error'
                      ? 'Errore'
                      : 'Autosave'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ color: '#667085', fontSize: 12 }}>
            Seleziona i nominativi e applica presenza, straordinario e marker con i valori comuni scelti.
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="button-secondary"
              style={quickSmallButtonStyle}
              onClick={handleSelectAll}
              disabled={!rows.length || allVisibleSelected}
            >
              Seleziona tutto
            </button>
            <button
              type="button"
              className="button-secondary"
              style={quickSmallButtonStyle}
              onClick={handleDeselectAll}
              disabled={!selectedIds.length}
            >
              Deseleziona tutto
            </button>
          </div>

          <div style={{ display: 'grid', gap: 6, maxHeight: 'calc(94vh - 265px)', overflowY: 'auto', paddingRight: 4 }}>
            {rows.map((row) => {
              const state = selectionState[row.employee.id] || { selected: false };
              const specialLabel = row.existingSpecialLabel;
              const markerLabel = row.markerLabel;

              return (
                <div
                  key={`quick-row-${row.employee.id}`}
                  className="quick-attendance-row"
                  style={{ padding: '9px 12px', borderRadius: 14, gap: 10 }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={state.selected}
                      onChange={(event) => handleToggle(row.employee.id, event.target.checked)}
                      style={{ width: 18, height: 18 }}
                    />

                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800 }}>
                        {row.employee.first_name} {row.employee.last_name}
                      </div>
                      <div style={{ fontSize: 12, color: '#667085' }}>
                        {row.employee.role || 'Nessuna mansione'}
                        {row.teamName ? ` · ${row.teamName}` : ''}
                      </div>
                    </div>
                  </label>

                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {specialLabel ? (
                      <span className="soft-chip" style={{ background: 'rgba(245, 158, 11, 0.14)', color: '#92400e' }}>
                        Stato attuale: {specialLabel}
                      </span>
                    ) : row.initialHours !== '' ? (
                      <span className="soft-chip" style={{ background: 'rgba(15, 118, 110, 0.12)', color: '#115e59' }}>
                        Ore attuali: {row.initialHours}
                      </span>
                    ) : null}
                    {markerLabel ? (
                      <span className="soft-chip" style={{ background: 'rgba(20, 33, 61, 0.06)', color: '#314762' }}>
                        Marker: {markerLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
