import React from 'react';
import { getCalendarCellStyle } from '../../utils/attendanceTableUtils';
import { countAttendanceDiag, recordAttendanceTiming } from '../../utils/attendanceDiagnostics';
import { formatAttendanceEmployeeDisplayName } from '../../utils/attendanceEmployeeNames';

function getRowHoverStyle() {
  return {
    background: '#fff3b0',
  };
}

function getActiveHoverStyle() {
  return {
    background: '#fff3b0',
    boxShadow: 'inset 0 0 0 2px #d6a700',
  };
}

function AttendanceRow({
  rowKey,
  employee,
  teamMember,
  team,
  isTeamChildRow,
  isTeamExpanded,
  onToggleTeamExpanded,
  teamMismatchCount,
  isSelected,
  isHoveredRow,
  hoveredDateStr,
  cells,
  totalHoursLabel,
  summaryLabel,
  summaryTitle,
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
  onCellSingleClick,
  onCellDoubleClick,
  onHoverCell,
  canMoveUp,
  canMoveDown,
  moveVisibleEmployeeRow,
}) {
  const clickTimeoutRef = React.useRef(null);
  const renderStartedAt = __eqNow();
  countAttendanceDiag('AttendanceRow render');
  console.count('[attendance-diag] AttendanceRow render');
  React.useEffect(() => {
    recordAttendanceTiming('AttendanceRow render', __eqNow() - renderStartedAt, {
      employeeId: employee.id,
    });
  });
  React.useEffect(() => () => {
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
    }
  }, []);
  const rowHoverStyle = isHoveredRow ? getRowHoverStyle() : null;
  return (
    <tr className={`${employee.is_headcount_team_row ? 'attendance-team-parent-row' : ''} ${isTeamChildRow ? 'attendance-team-child-row' : ''} ${teamMismatchCount ? 'attendance-team-row--mismatch' : ''}`}>
      <td style={{ ...tdStyleLeftCurrent, ...(rowHoverStyle || {}) }}>
        <div className={`attendance-left-cell ${isTeamChildRow ? 'attendance-left-cell--team-child' : ''}`}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(event) => toggleEmployeeSelection(employee.id, event.target.checked)}
            aria-label={`Seleziona ${formatAttendanceEmployeeDisplayName(employee)}`}
          />
          {employee.is_headcount_team_row ? (
            <button
              type="button"
              className="attendance-team-expand-button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleTeamExpanded?.(team?.id || employee.team_id);
              }}
              aria-label={`${isTeamExpanded ? 'Chiudi' : 'Apri'} componenti ${formatAttendanceEmployeeDisplayName(employee)}`}
              title={`${isTeamExpanded ? 'Chiudi' : 'Apri'} componenti squadra`}
            >
              {isTeamExpanded ? '▾' : '▸'}
            </button>
          ) : isTeamChildRow ? (
            <span className="attendance-team-child-indent" aria-hidden="true" />
          ) : null}
          <div>
            <div className="attendance-employee-name">{formatAttendanceEmployeeDisplayName(employee)}</div>
            <div style={{ fontSize: isCompactLayout ? 9 : 10, color: '#6b7280' }}>
              {employee.role || ''}
              {teamMember?.manage_by_days ? ' - gestione a giornate' : ''}
              {isTeamChildRow && team?.name ? ` - ${team.name}` : ''}
            </div>
            {teamMismatchCount ? (
              <div className="attendance-team-warning">
                {teamMismatchCount} incongruenze componenti
              </div>
            ) : null}
          </div>
          {!employee.is_headcount_team_row && !isTeamChildRow ? (
            <div className="attendance-row-order-actions">
              <button
                type="button"
                onClick={() => moveVisibleEmployeeRow(Number(employee.id), -1)}
                disabled={!canMoveUp}
                aria-label={`Sposta su ${formatAttendanceEmployeeDisplayName(employee)}`}
                title="Sposta su"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveVisibleEmployeeRow(Number(employee.id), 1)}
                disabled={!canMoveDown}
                aria-label={`Sposta giu ${formatAttendanceEmployeeDisplayName(employee)}`}
                title="Sposta giu"
              >
                ↓
              </button>
            </div>
          ) : null}
        </div>
      </td>

      {cells.map((cell) => {
        const isTeamHeadcountCell = Boolean(employee.is_headcount_team_row || cell.att?.is_headcount_mode);
        const hasSecondaryDetails = !isTeamHeadcountCell && Boolean(cell.overtimeHasValue || cell.markerMeta || cell.att?.notes);
        const overtimeBadgeValue = Number(cell.att?.overtime_hours || 0);
        const overtimeBadgeLabel = !isTeamHeadcountCell && overtimeBadgeValue > 0
          ? `+${Number.isInteger(overtimeBadgeValue)
            ? overtimeBadgeValue
            : overtimeBadgeValue.toFixed(2).replace(/\.?0+$/, '')}`
          : '';
        const hasNonOvertimeDetails = !isTeamHeadcountCell && Boolean(cell.markerMeta || cell.att?.notes);
        const teamHoursPerPerson = Number(cell.att?.overtime_hours || 0);
        const teamHoursPerPersonLabel = Number.isInteger(teamHoursPerPerson)
          ? String(teamHoursPerPerson)
          : teamHoursPerPerson.toFixed(2).replace(/\.?0+$/, '');
        const displayedCellValue = isTeamHeadcountCell && cell.att && teamHoursPerPerson > 0
          ? `${cell.att.hours_worked}\u00d7${teamHoursPerPersonLabel}`
          : (cell.mainInputValue || '');
        const mismatchTitle = cell.teamMismatch
          ? `Dichiarati ${cell.teamMismatch.declared} presenti, compilati ${cell.teamMismatch.filled} componenti`
          : '';
        const isHoveredColumn = hoveredDateStr === cell.dateStr;
        const isActiveHover = isHoveredRow && isHoveredColumn;
        const terminationHoverStyle = cell.isAfterEmploymentEnd
          ? {
              background: '#ece7bf',
              borderColor: '#d0d7de',
              color: '#8b949e',
            }
          : null;
        const cellHoverStyle = isActiveHover
          ? {
              ...(cell.isAfterEmploymentEnd ? terminationHoverStyle : getActiveHoverStyle()),
              boxShadow: 'inset 0 0 0 2px #d6a700',
            }
          : isHoveredColumn
          ? (cell.isAfterEmploymentEnd ? terminationHoverStyle : getRowHoverStyle())
          : isHoveredRow
          ? (cell.isAfterEmploymentEnd ? terminationHoverStyle : getRowHoverStyle())
          : null;
        const tdHoverStyle = cellHoverStyle;

        return (
          <td
            key={cell.dateStr}
            className={`attendance-cell${isHoveredRow ? ' is-hovered-row' : ''}${isHoveredColumn ? ' is-hovered-column' : ''}${isActiveHover ? ' is-hovered-cell' : ''}${cell.isAfterEmploymentEnd ? ' attendance-cell--terminated' : ''}`}
            style={{
              ...tdStyleCenterCurrent,
              ...getCalendarCellStyle(cell.dayInfo),
              ...(cell.isAfterEmploymentEnd ? {
                background: '#f1f3f5',
                  borderColor: '#d0d7de',
                  color: '#8b949e',
                } : {}),
              ...(tdHoverStyle || {}),
              ...(cell.dateStr === todayKey ? todayCellStyle : {}),
            }}
            title={cell.employmentTerminationTitle || cell.dayInfo?.holidayLabel || undefined}
          >
            <button
              type="button"
              className={`attendance-compact-cell ${cell.mainInputValue ? 'attendance-compact-cell--filled' : ''} ${cell.isSpecial ? 'attendance-compact-cell--special' : ''} ${hasSecondaryDetails ? 'attendance-compact-cell--detailed' : ''} ${cell.teamMismatch ? 'attendance-compact-cell--mismatch' : ''}`}
              onClick={() => {
                if (isWriteBlocked) return;
                if (clickTimeoutRef.current) {
                  clearTimeout(clickTimeoutRef.current);
                }
                clickTimeoutRef.current = setTimeout(() => {
                  onCellSingleClick(Number(employee.id), cell.dateStr);
                  clickTimeoutRef.current = null;
                }, 220);
              }}
              onDoubleClick={() => {
                if (isWriteBlocked) return;
                if (clickTimeoutRef.current) {
                  clearTimeout(clickTimeoutRef.current);
                  clickTimeoutRef.current = null;
                }
                onCellDoubleClick(Number(employee.id), cell.dateStr);
              }}
              onMouseEnter={() => onHoverCell(rowKey, cell.dateStr)}
              title={cell.employmentTerminationTitle || mismatchTitle || `${cell.dateStr} • Click: inserisci/rimuovi giornata • Doppio click: dettagli`}
              style={{
                cursor: isWriteBlocked ? 'default' : 'pointer',
                ...(cell.isAfterEmploymentEnd ? {
                  background: '#f1f3f5',
                  borderColor: '#d0d7de',
                  color: '#8b949e',
                  boxShadow: 'inset 0 0 0 1px rgba(208, 215, 222, 0.75)',
                } : {}),
                ...(cellHoverStyle || {}),
                ...(isActiveHover ? {
                  outline: 'none',
                } : {}),
              }}
              disabled={isWriteBlocked}
              aria-label={`Modifica presenza del ${cell.dateStr} per ${formatAttendanceEmployeeDisplayName(employee)}`}
            >
              <span className="attendance-compact-cell__value">{displayedCellValue}</span>
              {overtimeBadgeLabel ? (
                <span className="attendance-compact-cell__overtime" aria-hidden="true">
                  {overtimeBadgeLabel}
                </span>
              ) : null}
              {hasNonOvertimeDetails ? <span className="attendance-compact-cell__dot" aria-hidden="true" /> : null}
              {cell.teamMismatch ? <span className="attendance-compact-cell__warning" aria-hidden="true">!</span> : null}
            </button>
          </td>
        );
      })}

      <td style={{ ...tdStyleRightHoursCurrent, ...(rowHoverStyle || {}) }}>{totalHoursLabel}</td>
      <td style={{ ...tdStyleRightSummaryCurrent, ...(rowHoverStyle || {}) }} title={summaryTitle || summaryLabel}>{summaryLabel}</td>
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
  'isAfterEmploymentEnd',
  'employmentTerminationTitle',
  'teamMismatch',
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
  if (prev.rowKey !== next.rowKey) return false;
  if (prev.employee !== next.employee) return false;
  if (prev.teamMember !== next.teamMember) return false;
  if (prev.team !== next.team) return false;
  if (prev.isTeamChildRow !== next.isTeamChildRow) return false;
  if (prev.isTeamExpanded !== next.isTeamExpanded) return false;
  if (prev.onToggleTeamExpanded !== next.onToggleTeamExpanded) return false;
  if (prev.teamMismatchCount !== next.teamMismatchCount) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isHoveredRow !== next.isHoveredRow) return false;
  if (prev.hoveredDateStr !== next.hoveredDateStr) return false;
  if (prev.totalHoursLabel !== next.totalHoursLabel) return false;
  if (prev.summaryLabel !== next.summaryLabel) return false;
  if (prev.summaryTitle !== next.summaryTitle) return false;
  if (prev.isCompactLayout !== next.isCompactLayout) return false;
  if (prev.isWriteBlocked !== next.isWriteBlocked) return false;
  if (prev.todayKey !== next.todayKey) return false;
  if (prev.activeMarkers !== next.activeMarkers) return false;
  if (prev.todayCellStyle !== next.todayCellStyle) return false;
  if (prev.tdStyleLeftCurrent !== next.tdStyleLeftCurrent) return false;
  if (prev.tdStyleCenterCurrent !== next.tdStyleCenterCurrent) return false;
  if (prev.tdStyleRightHoursCurrent !== next.tdStyleRightHoursCurrent) return false;
  if (prev.tdStyleRightSummaryCurrent !== next.tdStyleRightSummaryCurrent) return false;
  if (prev.onCellSingleClick !== next.onCellSingleClick) return false;
  if (prev.onCellDoubleClick !== next.onCellDoubleClick) return false;
  if (prev.onHoverCell !== next.onHoverCell) return false;
  if (prev.canMoveUp !== next.canMoveUp) return false;
  if (prev.canMoveDown !== next.canMoveDown) return false;
  if (prev.moveVisibleEmployeeRow !== next.moveVisibleEmployeeRow) return false;
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
