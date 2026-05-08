import React from 'react';
import { formatDate, getDayLabel, getMarkerMeta, formatCompactWorkedSummary, MAIN_DAY_TYPES } from '../../utils/attendancePrintUtils';
import { formatHoursValue, formatWorkedSummary } from '../../utils/attendanceSummary';
import { MarkerVisual } from './AttendancePrintAreaPaginated';
import { getMainTypeMeta, selectAllInputText, getAttendanceHoursTone, getMainInputValue, getCalendarHeaderStyle, getCalendarCellStyle, getDisplayedInputValue } from '../../utils/attendanceTableUtils';

function AttendanceTable({
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
}) {
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
                <span>{selectedMeta.type === 'team' ? 'Componente squadra' : 'Dipendente'}</span>
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
          {attendanceRowsData.map(({ employee, teamMember, effectiveAttendance, totals }) => {
            return (
              <tr key={employee.id}>
                <td style={tdStyleLeftCurrent}>
                  <div className="attendance-left-cell">
                    <input
                      type="checkbox"
                      checked={selectedEmployeeIds.includes(employee.id)}
                      onChange={(event) => toggleEmployeeSelection(employee.id, event.target.checked)}
                      aria-label={`Seleziona ${employee.first_name} ${employee.last_name}`}
                    />
                    <div>
                      <div className="attendance-employee-name">{employee.first_name} {employee.last_name}</div>
                      <div style={{ fontSize: isCompactLayout ? 9 : 10, color: '#6b7280' }}>
                        {employee.role || ''}
                        {teamMember?.manage_by_days ? ' · gestione a giornate' : ''}
                      </div>
                    </div>
                  </div>
                </td>

                {daysInMonth.map((day, index) => {
                  const dateStr = dayKeys[index];
                  const att = effectiveAttendance[dateStr];
                  const isSpecial = att?.status && att.status !== 'presente' && att.status !== 'assente';
                  const specialOpt = getMainTypeMeta(att?.status);
                  const markerMeta = getMarkerMeta(att?.marker_code, availableMarkers);
                  const dayInfo = dayInfoMap[dateStr];
                  const markerMenuKey = `${employee.id}_${dateStr}`;
                  const overtimeEditorKey = `${employee.id}_${dateStr}_overtime`;
                  const isMainType = MAIN_DAY_TYPES.some((item) => item.value === att?.status);
                  const isEditingMarker = openMarkerMenuKey === markerMenuKey || !markerMeta;
                  const isEditingCompactOvertime = compactOvertimeEditorKey === overtimeEditorKey;
                  const mainInputValue = getDisplayedInputValue(inputDrafts, employee.id, dateStr, 'main', getMainInputValue(att));
                  const overtimeInputValue = getDisplayedInputValue(
                    employee.id,
                    dateStr,
                    'overtime',
                    att?.overtime_hours ? String(att.overtime_hours).replace('.', ',') : ''
                  );
                  const mainInputTone = getAttendanceHoursTone(mainInputValue, attendanceSettings);
                  const overtimeHasValue = String(overtimeInputValue || '').trim() !== '';

                  return (
                    <td
                      key={dateStr}
                      style={{
                        ...tdStyleCenterCurrent,
                        ...getCalendarCellStyle(dayInfo),
                        ...(dateStr === todayKey ? todayCellStyle : {}),
                      }}
                      title={dayInfo?.holidayLabel || undefined}
                    >
                      <div className={`attendance-cell-stack ${isCompactLayout ? 'attendance-cell-stack--compact' : ''}`}>
                        <div className={`attendance-day-cell ${isCompactLayout ? 'attendance-day-cell--compact' : ''}`}>
                          <input
                            className={`attendance-hours-input ${isCompactLayout ? 'attendance-hours-input--compact' : ''} ${mainInputTone ? `attendance-hours-input--${mainInputTone}` : ''}`}
                            type="text"
                            inputMode="decimal"
                            value={mainInputValue}
                            onChange={(event) => handleMainValueChange(employee.id, dateStr, event.target.value)}
                            onBlur={() => handleMainValueBlur(employee.id, dateStr)}
                            onFocus={(event) => {
                              handleGridInputFocus(dateStr, event);
                              updateLiveHoursPreview(event.currentTarget.value);
                            }}
                            onClick={selectAllInputText}
                            onKeyDown={handleGridKeyDown}
                            data-attendance-focus="true"
                            placeholder=""
                            disabled={isWriteBlocked}
                            title={isSpecial ? specialOpt?.text : 'Inserisci ore decimali oppure F / P / M'}
                          />

                          {isCompactLayout ? (
                            <>
                              {!isMainType ? (
                                markerMeta && !isEditingMarker ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleAttendanceCellFocus(dateStr);
                                      setOpenMarkerMenuKey(markerMenuKey);
                                    }}
                                    title={`Marcatore ${markerMeta.text}. Clicca per modificare.`}
                                    className="attendance-compact-marker-badge"
                                    style={{ background: markerMeta.background, color: markerMeta.color }}
                                    disabled={isWriteBlocked}
                                  >
                                    <MarkerVisual marker={markerMeta} size={11} />
                                  </button>
                                ) : (
                                  <select
                                    className="attendance-compact-marker-select"
                                    value={att?.marker_code || ''}
                                    onChange={(event) => {
                                      const nextValue = event.target.value || null;
                                      handleMarkerChange(employee.id, dateStr, nextValue);
                                      setOpenMarkerMenuKey(nextValue ? null : markerMenuKey);
                                    }}
                                    onFocus={() => handleAttendanceCellFocus(dateStr)}
                                    onBlur={() => {
                                      if (att?.marker_code) {
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

                              {!isSpecial ? (
                                isEditingCompactOvertime ? (
                                  <input
                                    className={`attendance-compact-overtime-input ${overtimeHasValue ? 'attendance-hours-input--overtime-filled' : ''}`}
                                    type="text"
                                    inputMode="decimal"
                                    value={overtimeInputValue}
                                    onChange={(event) => handleOvertimeValueChange(employee.id, dateStr, event.target.value)}
                                    onBlur={() => {
                                      handleOvertimeValueBlur(employee.id, dateStr);
                                      setCompactOvertimeEditorKey(null);
                                    }}
                                    onFocus={(event) => handleGridInputFocus(dateStr, event)}
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
                                    className={`attendance-compact-overtime-badge ${overtimeHasValue ? 'attendance-compact-overtime-badge--filled' : ''}`}
                                    onClick={() => {
                                      handleAttendanceCellFocus(dateStr);
                                      setCompactOvertimeEditorKey(overtimeEditorKey);
                                    }}
                                    disabled={isWriteBlocked}
                                    title={overtimeHasValue ? `Straordinario ${overtimeInputValue} h. Clicca per modificare.` : 'Aggiungi straordinario'}
                                  >
                                    {overtimeHasValue ? `+${overtimeInputValue}` : '+STR'}
                                  </button>
                                )
                              ) : null}
                            </>
                          ) : (
                            <>
                              <input
                                className={`attendance-hours-input attendance-hours-input--overtime ${overtimeHasValue ? 'attendance-hours-input--overtime-filled' : ''}`}
                                type="text"
                                inputMode="decimal"
                                value={overtimeInputValue}
                                onChange={(event) => handleOvertimeValueChange(employee.id, dateStr, event.target.value)}
                                onBlur={() => handleOvertimeValueBlur(employee.id, dateStr)}
                                onFocus={(event) => handleGridInputFocus(dateStr, event)}
                                onClick={selectAllInputText}
                                onKeyDown={handleGridKeyDown}
                                data-attendance-focus="true"
                                placeholder="str"
                                disabled={isWriteBlocked || isSpecial}
                                title="Straordinario decimale separato dalle ore normali"
                              />

                              {isMainType ? (
                                <span className="attendance-marker-placeholder" />
                              ) : markerMeta && !isEditingMarker ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleAttendanceCellFocus(dateStr);
                                    setOpenMarkerMenuKey(markerMenuKey);
                                  }}
                                  title={`Marcatore ${markerMeta.text}. Clicca per modificare.`}
                                  className="attendance-marker-button"
                                  style={{ background: markerMeta.background, color: markerMeta.color }}
                                  disabled={isWriteBlocked}
                                >
                                  <MarkerVisual marker={markerMeta} size={16} />
                                </button>
                              ) : (
                                <select
                                  className="attendance-marker-select"
                                  value={att?.marker_code || ''}
                                  onChange={(event) => {
                                    const nextValue = event.target.value || null;
                                    handleMarkerChange(employee.id, dateStr, nextValue);
                                    setOpenMarkerMenuKey(nextValue ? null : markerMenuKey);
                                  }}
                                  onFocus={() => handleAttendanceCellFocus(dateStr)}
                                  onKeyDown={handleGridKeyDown}
                                  data-attendance-focus="true"
                                  onBlur={() => {
                                    if (att?.marker_code) {
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
                  );
                })}

                <td style={tdStyleRightHoursCurrent}>{formatHoursValue(totals.totalHours, attendanceSettings.hoursFormat)}</td>
                <td style={tdStyleRightSummaryCurrent}>
                  {isCompactLayout
                    ? formatCompactWorkedSummary(totals.totalHours, attendanceSettings.baseHours, attendanceSettings.hoursFormat)
                    : formatWorkedSummary(totals.totalHours, attendanceSettings.baseHours, attendanceSettings.hoursFormat)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!displayRows.length ? (
        <div className="empty-state">Nessun dipendente disponibile per la selezione corrente.</div>
      ) : null}
      </div>
    </div>
  );
}

export default AttendanceTable;
