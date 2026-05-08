import React from 'react';
import { selectAllInputText, getCalendarCellStyle } from '../../utils/attendanceTableUtils';
import { countAttendanceDiag, recordAttendanceTiming } from '../../utils/attendanceDiagnostics';
import { MarkerVisual } from './AttendancePrintAreaPaginated';

function AttendanceRow({
  employee,
  teamMember,
  isSelected,
  cells,
  totalHoursLabel,
  summaryLabel,
  isCompactLayout,
  isWriteBlocked,
  activeMarkers,
  todayKey,
  todayCellStyle,
  tdStyleLeftCurrent,
  tdStyleCenterCurrent,
  tdStyleRightHoursCurrent,
  tdStyleRightSummaryCurrent,
  setOpenMarkerMenuKey,
  setCompactOvertimeEditorKey,
  toggleEmployeeSelection,
  handleMainValueChange,
  handleMainValueBlur,
  handleGridInputFocus,
  handleGridKeyDown,
  updateLiveHoursPreview,
  handleAttendanceCellFocus,
  handleMarkerChange,
  handleOvertimeValueChange,
  handleOvertimeValueBlur,
}) {
  const renderStartedAt = __eqNow();
  countAttendanceDiag('AttendanceRow render');
  console.count('[attendance-diag] AttendanceRow render');
  React.useEffect(() => {
    recordAttendanceTiming('AttendanceRow render', __eqNow() - renderStartedAt, {
      employeeId: employee.id,
    });
  });
  return (
    <tr>
      <td style={tdStyleLeftCurrent}>
        <div className="attendance-left-cell">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(event) => toggleEmployeeSelection(employee.id, event.target.checked)}
            aria-label={`Seleziona ${employee.first_name} ${employee.last_name}`}
          />
          <div>
            <div className="attendance-employee-name">{employee.first_name} {employee.last_name}</div>
            <div style={{ fontSize: isCompactLayout ? 9 : 10, color: '#6b7280' }}>
              {employee.role || ''}
              {teamMember?.manage_by_days ? ' - gestione a giornate' : ''}
            </div>
          </div>
        </div>
      </td>

      {cells.map((cell) => (
        <td
          key={cell.dateStr}
          style={{
            ...tdStyleCenterCurrent,
            ...getCalendarCellStyle(cell.dayInfo),
            ...(cell.dateStr === todayKey ? todayCellStyle : {}),
          }}
          title={cell.dayInfo?.holidayLabel || undefined}
        >
          <div className={`attendance-cell-stack ${isCompactLayout ? 'attendance-cell-stack--compact' : ''}`}>
            <div className={`attendance-day-cell ${isCompactLayout ? 'attendance-day-cell--compact' : ''}`}>
              <input
                className={`attendance-hours-input ${isCompactLayout ? 'attendance-hours-input--compact' : ''} ${cell.mainInputTone ? `attendance-hours-input--${cell.mainInputTone}` : ''}`}
                type="text"
                inputMode="decimal"
                value={cell.mainInputValue}
                onChange={(event) => handleMainValueChange(employee.id, cell.dateStr, event.target.value)}
                onBlur={() => handleMainValueBlur(employee.id, cell.dateStr)}
                onFocus={(event) => {
                  handleGridInputFocus(cell.dateStr, event);
                  updateLiveHoursPreview(event.currentTarget.value);
                }}
                onClick={selectAllInputText}
                onKeyDown={handleGridKeyDown}
                data-attendance-focus="true"
                placeholder=""
                disabled={isWriteBlocked}
                title={cell.isSpecial ? cell.specialOpt?.text : 'Inserisci ore decimali oppure F / P / M'}
              />

              {isCompactLayout ? (
                <>
                  {!cell.isMainType ? (
                    cell.markerMeta && !cell.isEditingMarker ? (
                      <button
                        type="button"
                        onClick={() => {
                          handleAttendanceCellFocus(cell.dateStr);
                          setOpenMarkerMenuKey(cell.markerMenuKey);
                        }}
                        title={`Marcatore ${cell.markerMeta.text}. Clicca per modificare.`}
                        className="attendance-compact-marker-badge"
                        style={{ background: cell.markerMeta.background, color: cell.markerMeta.color }}
                        disabled={isWriteBlocked}
                      >
                        <MarkerVisual marker={cell.markerMeta} size={11} />
                      </button>
                    ) : (
                      <select
                        className="attendance-compact-marker-select"
                        value={cell.att?.marker_code || ''}
                        onChange={(event) => {
                          const nextValue = event.target.value || null;
                          handleMarkerChange(employee.id, cell.dateStr, nextValue);
                          setOpenMarkerMenuKey(nextValue ? null : cell.markerMenuKey);
                        }}
                        onFocus={() => handleAttendanceCellFocus(cell.dateStr)}
                        onBlur={() => {
                          if (cell.att?.marker_code) {
                            setOpenMarkerMenuKey(null);
                          }
                        }}
                        title="Seleziona un marcatore grafico"
                        disabled={isWriteBlocked}
                      >
                        <option value="">+</option>
                        {activeMarkers.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.image ? item.text : item.symbol}
                          </option>
                        ))}
                      </select>
                    )
                  ) : null}

                  {!cell.isSpecial ? (
                    cell.isEditingCompactOvertime ? (
                      <input
                        className={`attendance-compact-overtime-input ${cell.overtimeHasValue ? 'attendance-hours-input--overtime-filled' : ''}`}
                        type="text"
                        inputMode="decimal"
                        value={cell.overtimeInputValue}
                        onChange={(event) => handleOvertimeValueChange(employee.id, cell.dateStr, event.target.value)}
                        onBlur={() => {
                          handleOvertimeValueBlur(employee.id, cell.dateStr);
                          setCompactOvertimeEditorKey(null);
                        }}
                        onFocus={(event) => handleGridInputFocus(cell.dateStr, event)}
                        onClick={selectAllInputText}
                        onKeyDown={handleGridKeyDown}
                        data-attendance-focus="true"
                        placeholder="str"
                        autoFocus
                        disabled={isWriteBlocked}
                        title="Straordinario decimale separato dalle ore normali"
                      />
                    ) : (
                      <button
                        type="button"
                        className={`attendance-compact-overtime-badge ${cell.overtimeHasValue ? 'attendance-compact-overtime-badge--filled' : ''}`}
                        onClick={() => {
                          handleAttendanceCellFocus(cell.dateStr);
                          setCompactOvertimeEditorKey(cell.overtimeEditorKey);
                        }}
                        disabled={isWriteBlocked}
                        title={cell.overtimeHasValue ? `Straordinario ${cell.overtimeInputValue} h. Clicca per modificare.` : 'Aggiungi straordinario'}
                      >
                        {cell.overtimeHasValue ? `+${cell.overtimeInputValue}` : '+STR'}
                      </button>
                    )
                  ) : null}
                </>
              ) : (
                <>
                  <input
                    className={`attendance-hours-input attendance-hours-input--overtime ${cell.overtimeHasValue ? 'attendance-hours-input--overtime-filled' : ''}`}
                    type="text"
                    inputMode="decimal"
                    value={cell.overtimeInputValue}
                    onChange={(event) => handleOvertimeValueChange(employee.id, cell.dateStr, event.target.value)}
                    onBlur={() => handleOvertimeValueBlur(employee.id, cell.dateStr)}
                    onFocus={(event) => handleGridInputFocus(cell.dateStr, event)}
                    onClick={selectAllInputText}
                    onKeyDown={handleGridKeyDown}
                    data-attendance-focus="true"
                    placeholder="str"
                    disabled={isWriteBlocked || cell.isSpecial}
                    title="Straordinario decimale separato dalle ore normali"
                  />

                  {cell.isMainType ? (
                    <span className="attendance-marker-placeholder" />
                  ) : cell.markerMeta && !cell.isEditingMarker ? (
                    <button
                      type="button"
                      onClick={() => {
                        handleAttendanceCellFocus(cell.dateStr);
                        setOpenMarkerMenuKey(cell.markerMenuKey);
                      }}
                      title={`Marcatore ${cell.markerMeta.text}. Clicca per modificare.`}
                      className="attendance-marker-button"
                      style={{ background: cell.markerMeta.background, color: cell.markerMeta.color }}
                      disabled={isWriteBlocked}
                    >
                      <MarkerVisual marker={cell.markerMeta} size={16} />
                    </button>
                  ) : (
                    <select
                      className="attendance-marker-select"
                      value={cell.att?.marker_code || ''}
                      onChange={(event) => {
                        const nextValue = event.target.value || null;
                        handleMarkerChange(employee.id, cell.dateStr, nextValue);
                        setOpenMarkerMenuKey(nextValue ? null : cell.markerMenuKey);
                      }}
                      onFocus={() => handleAttendanceCellFocus(cell.dateStr)}
                      onKeyDown={handleGridKeyDown}
                      data-attendance-focus="true"
                      onBlur={() => {
                        if (cell.att?.marker_code) {
                          setOpenMarkerMenuKey(null);
                        }
                      }}
                      title="Seleziona un marcatore grafico"
                      disabled={isWriteBlocked}
                    >
                      <option value="">+</option>
                      {activeMarkers.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.image ? item.text : item.symbol}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>
          </div>
        </td>
      ))}

      <td style={tdStyleRightHoursCurrent}>{totalHoursLabel}</td>
      <td style={tdStyleRightSummaryCurrent}>{summaryLabel}</td>
    </tr>
  );
}

const CELL_FIELDS = [
  'dateStr',
  'att',
  'dayInfo',
  'isSpecial',
  'specialOpt',
  'markerMeta',
  'isMainType',
  'markerMenuKey',
  'overtimeEditorKey',
  'isEditingMarker',
  'isEditingCompactOvertime',
  'mainInputValue',
  'overtimeInputValue',
  'mainInputTone',
  'overtimeHasValue',
];

function areCellsEqual(prev, next) {
  if (prev === next) return true;
  if (!prev || !next) return false;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (a === b) continue;
    if (!a || !b) return false;
    for (let k = 0; k < CELL_FIELDS.length; k += 1) {
      const key = CELL_FIELDS[k];
      if (a[key] !== b[key]) return false;
    }
  }
  return true;
}

let __eqCount = 0;
let __eqSkipped = 0;
let __eqTotalMs = 0;

export function readEqStats() {
  return { count: __eqCount, skipped: __eqSkipped, totalMs: __eqTotalMs };
}

export function resetEqStats() {
  __eqCount = 0;
  __eqSkipped = 0;
  __eqTotalMs = 0;
}

function __eqNow() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function arePropsEqualImpl(prev, next) {
  if (prev.employee !== next.employee) return false;
  if (prev.teamMember !== next.teamMember) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.totalHoursLabel !== next.totalHoursLabel) return false;
  if (prev.summaryLabel !== next.summaryLabel) return false;
  if (prev.isCompactLayout !== next.isCompactLayout) return false;
  if (prev.isWriteBlocked !== next.isWriteBlocked) return false;
  if (prev.todayKey !== next.todayKey) return false;
  if (prev.activeMarkers !== next.activeMarkers) return false;
  if (prev.todayCellStyle !== next.todayCellStyle) return false;
  if (prev.tdStyleLeftCurrent !== next.tdStyleLeftCurrent) return false;
  if (prev.tdStyleCenterCurrent !== next.tdStyleCenterCurrent) return false;
  if (prev.tdStyleRightHoursCurrent !== next.tdStyleRightHoursCurrent) return false;
  if (prev.tdStyleRightSummaryCurrent !== next.tdStyleRightSummaryCurrent) return false;
  if (!areCellsEqual(prev.cells, next.cells)) return false;
  return true;
}

function arePropsEqual(prev, next) {
  const t0 = __eqNow();
  countAttendanceDiag('AttendanceRow equality');
  console.count('[attendance-diag] AttendanceRow equality');
  __eqCount += 1;
  const result = arePropsEqualImpl(prev, next);
  const dt = __eqNow() - t0;
  __eqTotalMs += dt;
  if (dt > 100) {
    console.warn('[attendance-diag] slow AttendanceRow equality', {
      ms: Math.round(dt * 100) / 100,
      employeeId: prev.employee?.id,
    });
  }
  if (result) __eqSkipped += 1;
  return result;
}

export default React.memo(AttendanceRow, arePropsEqual);
