import React from 'react';
import { formatDate, getDayLabel, getMarkerMeta, formatCompactWorkedSummary, MAIN_DAY_TYPES } from '../../utils/attendancePrintUtils';
import { formatHoursValue, formatWorkedSummary } from '../../utils/attendanceSummary';
import { getMainTypeMeta, getAttendanceHoursTone, getMainInputValue, getCalendarHeaderStyle, getDisplayedInputValue } from '../../utils/attendanceTableUtils';
import { countAttendanceDiag, recordAttendanceTiming, setAttendanceDiagValue } from '../../utils/attendanceDiagnostics';
import AttendanceRow, { readEqStats, resetEqStats } from './AttendanceRow';

function formatHeadcountSummary(value) {
  const safeValue = Number(value || 0);
  if (safeValue <= 0) {
    return '0 gg';
  }
  const normalized = Number.isInteger(safeValue)
    ? String(safeValue)
    : safeValue.toFixed(2).replace(/\.?0+$/, '');
  return `${normalized} gg`;
}

function __nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function AttendanceTable(props) {
  const __propsRef = React.useRef(null);
  const __renderCountRef = React.useRef(0);
  __renderCountRef.current += 1;
  const __previousProps = __propsRef.current;
  if (__previousProps) {
    const changed = [];
    const prevKeys = Object.keys(__previousProps);
    const curKeys = Object.keys(props);
    const allKeys = new Set([...prevKeys, ...curKeys]);
    for (const key of allKeys) {
      if (__previousProps[key] !== props[key]) {
        changed.push(key);
      }
    }
    if (changed.length === 0) {
      console.warn('[attendance-perf] AttendanceTable re-render with NO prop changes (parent forced render)', {
        renderCount: __renderCountRef.current,
      });
    } else {
      console.info('[attendance-perf] AttendanceTable props changed', {
        renderCount: __renderCountRef.current,
        changedProps: changed,
        changedCount: changed.length,
      });
    }
  } else {
    console.info('[attendance-perf] AttendanceTable initial render', {
      renderCount: __renderCountRef.current,
      propsKeys: Object.keys(props).length,
    });
  }
  __propsRef.current = props;

  const {
    isCompactLayout,
  allVisibleSelected,
  selectedMeta,
  daysInMonth,
  dayInfoMap,
  todayKey,
  attendanceRowsData,
  selectedEmployeeIds,
  dayKeys,
  availableMarkers,
  activeMarkers,
  openMarkerMenuKey,
  compactOvertimeEditorKey,
  attendanceSettings,
  displayRows,
  isWriteBlocked,
  inputDrafts,
  horizontalScrollbarRef,
  horizontalScrollbarContentRef,
  tableShellRef,
  thStyleLeftCurrent,
  thStyleCenterCurrent,
  thStyleRightHoursCurrent,
  thStyleRightSummaryCurrent,
  tdStyleLeftCurrent,
  tdStyleCenterCurrent,
  tdStyleRightHoursCurrent,
  tdStyleRightSummaryCurrent,
  todayHeaderStyle,
  todayCellStyle,
  toggleSelectAllVisible,
  toggleEmployeeSelection,
  setOpenMarkerMenuKey,
  setCompactOvertimeEditorKey,
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
  } = props;
  const isTeamHeadcountView = selectedMeta.type === 'team' && attendanceRowsData.some((row) => row.headcountMode);
  countAttendanceDiag('AttendanceTable render');
  console.count('[attendance-diag] AttendanceTable render');
  resetEqStats();
  const __attRenderStart = __nowMs();
  let __cellsTotalMs = 0;
  let __cellsRowsCount = 0;
  React.useEffect(() => {
    const elapsed = __nowMs() - __attRenderStart;
    const eq = readEqStats();
    console.info('[attendance-perf] AttendanceTable render', {
      ms: Math.round(elapsed),
      rows: __cellsRowsCount,
      cellsPrecomputeMs: Math.round(__cellsTotalMs),
      eqCalls: eq.count,
      eqSkipped: eq.skipped,
      eqRerendered: eq.count - eq.skipped,
      eqTotalMs: Math.round(eq.totalMs * 100) / 100,
    });
    recordAttendanceTiming('AttendanceTable render', elapsed, {
      rows: __cellsRowsCount,
      cellsPrecomputeMs: __cellsTotalMs,
      eqCalls: eq.count,
      eqSkipped: eq.skipped,
    });
    setAttendanceDiagValue('AttendanceTable.eqCalls', eq.count);
    setAttendanceDiagValue('AttendanceTable.eqSkipped', eq.skipped);
    if (elapsed > 100) {
      console.warn('[attendance-diag] slow AttendanceTable render', {
        ms: Math.round(elapsed * 100) / 100,
        rows: __cellsRowsCount,
        eqCalls: eq.count,
        eqSkipped: eq.skipped,
      });
    }
  });
  return (
    <div className={`attendance-table-region ${isCompactLayout ? 'attendance-table-region--compact' : ''}`}>
      <div
        className="attendance-horizontal-scrollbar"
        ref={horizontalScrollbarRef}
        aria-label="Scorrimento orizzontale giorni del foglio presenze"
      >
        <div
          className="attendance-horizontal-scrollbar-content"
          ref={horizontalScrollbarContentRef}
        />
      </div>
      <div className="attendance-table-shell" ref={tableShellRef}>
        <table className={`attendance-table ${isCompactLayout ? 'attendance-table--compact' : ''}`}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={thStyleLeftCurrent}>
              <div className="attendance-left-head">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(event) => toggleSelectAllVisible(event.target.checked)}
                  aria-label="Seleziona tutti i dipendenti visibili"
                />
                <span>
                  {isTeamHeadcountView
                    ? 'Squadra'
                    : selectedMeta.type === 'team'
                    ? 'Componente squadra'
                    : 'Dipendente'}
                </span>
              </div>
            </th>
            {daysInMonth.map((day) => (
              <th
                key={formatDate(day)}
                style={{
                  ...thStyleCenterCurrent,
                  ...getCalendarHeaderStyle(dayInfoMap[formatDate(day)]),
                  ...(formatDate(day) === todayKey ? todayHeaderStyle : {}),
                }}
                title={dayInfoMap[formatDate(day)]?.holidayLabel || undefined}
              >
                {day.getDate()}
                <br />
                <span
                  style={{
                    fontSize: isCompactLayout ? 9 : 10,
                    color: dayInfoMap[formatDate(day)]?.isSpecialDay ? '#991b1b' : '#6b7280',
                    fontWeight: dayInfoMap[formatDate(day)]?.isSpecialDay ? 800 : 500,
                  }}
                >
                  {getDayLabel(day)}
                </span>
              </th>
            ))}
            <th style={thStyleRightHoursCurrent}>{isCompactLayout ? 'Tot.' : 'Ore tot.'}</th>
            <th style={thStyleRightSummaryCurrent}>{isCompactLayout ? 'Riep.' : 'Riepilogo'}</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            let headcountSectionShown = false;
            const items = [];
            for (const rowData of attendanceRowsData) {
              const { employee, teamMember, effectiveAttendance, totals, headcountMode } = rowData;
              const employeeId = employee.id;
              const isHCTeam = !!headcountMode;

              // Inserire sezione header prima del primo headcount team (solo in modo "Tutti")
              if (isHCTeam && !headcountSectionShown && selectedMeta.type === 'all') {
                headcountSectionShown = true;
                items.push(
                  <tr key="section-headcount-teams" className="attendance-section-header-row">
                    <td
                      colSpan={daysInMonth.length + 3}
                      className="attendance-section-header-cell"
                    >
                      Squadre a numero presenti
                    </td>
                  </tr>
                );
              }

              // Per-cell precompute (timed for profiling)
              const __cellsT0 = __nowMs();
              const cells = daysInMonth.map((day, idx) => {
                const dateStr = dayKeys[idx];
                const att = effectiveAttendance[dateStr];
                const isSpecial = !!(att?.status && att.status !== 'presente' && att.status !== 'assente');
                const specialOpt = getMainTypeMeta(att?.status);
                const markerMeta = getMarkerMeta(att?.marker_code, availableMarkers);
                const dayInfo = dayInfoMap[dateStr];
                const markerMenuKey = `${employeeId}_${dateStr}`;
                const overtimeEditorKey = `${employeeId}_${dateStr}_overtime`;
                const isMainType = MAIN_DAY_TYPES.some((item) => item.value === att?.status);
                const isEditingMarker = openMarkerMenuKey === markerMenuKey || !markerMeta;
                const isEditingCompactOvertime = compactOvertimeEditorKey === overtimeEditorKey;
                const mainInputValue = getDisplayedInputValue(inputDrafts, employeeId, dateStr, 'main', getMainInputValue(att));
                const overtimeInputValue = getDisplayedInputValue(inputDrafts, employeeId, dateStr, 'overtime', att?.overtime_hours ? String(att.overtime_hours).replace('.', ',') : '');
                const mainInputTone = getAttendanceHoursTone(mainInputValue, attendanceSettings);
                const overtimeHasValue = String(overtimeInputValue || '').trim() !== '';
                return {
                  dateStr, att, dayInfo,
                  isSpecial, specialOpt, markerMeta, isMainType,
                  markerMenuKey, overtimeEditorKey,
                  isEditingMarker, isEditingCompactOvertime,
                  mainInputValue, overtimeInputValue, mainInputTone, overtimeHasValue,
                };
              });
              __cellsTotalMs += __nowMs() - __cellsT0;
              __cellsRowsCount += 1;

              const totalHoursLabel = formatHoursValue(totals.totalHours, attendanceSettings.hoursFormat);
              const summaryLabel = totals.isHeadcountMode
                ? formatHeadcountSummary(totals.totalHeadcount)
                : isCompactLayout
                ? formatCompactWorkedSummary(totals.totalHours, attendanceSettings.baseHours, attendanceSettings.hoursFormat)
                : formatWorkedSummary(totals.totalHours, attendanceSettings.baseHours, attendanceSettings.hoursFormat);
              const isSelected = selectedEmployeeIds.includes(employeeId);

              items.push(
                <AttendanceRow
                  key={employeeId}
                  employee={employee}
                  teamMember={teamMember}
                  isSelected={isSelected}
                  cells={cells}
                  totalHoursLabel={totalHoursLabel}
                  summaryLabel={summaryLabel}
                  isCompactLayout={isCompactLayout}
                  isWriteBlocked={isWriteBlocked}
                  activeMarkers={activeMarkers}
                  todayKey={todayKey}
                  todayCellStyle={todayCellStyle}
                  tdStyleLeftCurrent={tdStyleLeftCurrent}
                  tdStyleCenterCurrent={tdStyleCenterCurrent}
                  tdStyleRightHoursCurrent={tdStyleRightHoursCurrent}
                  tdStyleRightSummaryCurrent={tdStyleRightSummaryCurrent}
                  setOpenMarkerMenuKey={setOpenMarkerMenuKey}
                  setCompactOvertimeEditorKey={setCompactOvertimeEditorKey}
                  toggleEmployeeSelection={toggleEmployeeSelection}
                  handleMainValueChange={handleMainValueChange}
                  handleMainValueBlur={handleMainValueBlur}
                  handleGridInputFocus={handleGridInputFocus}
                  handleGridKeyDown={handleGridKeyDown}
                  updateLiveHoursPreview={updateLiveHoursPreview}
                  handleAttendanceCellFocus={handleAttendanceCellFocus}
                  handleMarkerChange={handleMarkerChange}
                  handleOvertimeValueChange={handleOvertimeValueChange}
                  handleOvertimeValueBlur={handleOvertimeValueBlur}
                  onCellSingleClick={onCellSingleClick}
                  onCellDoubleClick={onCellDoubleClick}
                />
              );
            }
            return items;
          })()}
        </tbody>
      </table>

      {!displayRows.length ? (
        <div className="empty-state">Nessun dipendente disponibile per la selezione corrente.</div>
      ) : null}
      </div>
    </div>
  );
}

export default React.memo(AttendanceTable);
