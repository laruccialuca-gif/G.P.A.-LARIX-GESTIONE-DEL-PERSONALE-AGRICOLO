import React from 'react';
import { getCalendarCellStyle } from '../../utils/attendanceTableUtils';
import { countAttendanceDiag, recordAttendanceTiming } from '../../utils/attendanceDiagnostics';

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
  onCellClick,
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

      {cells.map((cell) => {
        const hasSecondaryDetails = Boolean(cell.overtimeHasValue || cell.markerMeta || cell.att?.notes);

        return (
          <td
            key={cell.dateStr}
            style={{
              ...tdStyleCenterCurrent,
              ...getCalendarCellStyle(cell.dayInfo),
              ...(cell.dateStr === todayKey ? todayCellStyle : {}),
            }}
            title={cell.dayInfo?.holidayLabel || undefined}
          >
            <button
              type="button"
              className={`attendance-compact-cell ${cell.mainInputValue ? 'attendance-compact-cell--filled' : ''} ${cell.isSpecial ? 'attendance-compact-cell--special' : ''} ${hasSecondaryDetails ? 'attendance-compact-cell--detailed' : ''}`}
              onClick={() => !isWriteBlocked && onCellClick(Number(employee.id), cell.dateStr)}
              title={cell.dateStr}
              style={{ cursor: isWriteBlocked ? 'default' : 'pointer' }}
              disabled={isWriteBlocked}
              aria-label={`Modifica presenza del ${cell.dateStr} per ${employee.first_name} ${employee.last_name}`}
            >
              <span className="attendance-compact-cell__value">{cell.mainInputValue || ''}</span>
              {hasSecondaryDetails ? <span className="attendance-compact-cell__dot" aria-hidden="true" /> : null}
            </button>
          </td>
        );
      })}

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
  if (prev.onCellClick !== next.onCellClick) return false;
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
