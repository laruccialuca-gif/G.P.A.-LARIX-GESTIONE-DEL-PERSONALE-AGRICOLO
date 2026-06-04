import React from 'react';
import { compareAttendanceEmployees, formatAttendanceEmployeeDisplayName } from '../../utils/attendanceEmployeeNames';

function AttendanceToolbar({
  currentMonth,
  selectedYear,
  setCurrentMonth,
  setSelectedYear,
  selectedEntity,
  setSelectedEntity,
  allEmployeesCount,
  ungroupedEmployeesCount,
  activeEmployees,
  visibleTeams,
  visibleTeamCounts,
  monthString,
  parseDateValue,
  filterSlot,
}) {
  const sortedEmployeeOptions = React.useMemo(
    () =>
      activeEmployees
        .map((employee, originalIndex) => ({ employee, originalIndex }))
        .sort((a, b) => {
          const byName = compareAttendanceEmployees(a.employee, b.employee);
          return byName || a.originalIndex - b.originalIndex;
        })
        .map(({ employee }) => employee),
    [activeEmployees]
  );

  return (
    <div className="toolbar attendance-toolbar">
      <div className="toolbar-group attendance-toolbar-group attendance-toolbar-group--month">
        <button
          className="attendance-month-nav"
          onClick={() => {
            const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
            if (nextMonth.getFullYear() !== selectedYear) {
              setSelectedYear(nextMonth.getFullYear());
            }
            setCurrentMonth(nextMonth);
          }}
        >
          {'<'}
        </button>

        <strong className="attendance-month-label">
          {currentMonth.toLocaleDateString('it-IT', {
            month: 'long',
            year: 'numeric',
          })}
        </strong>

        <button
          className="attendance-month-nav"
          onClick={() => {
            const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
            if (nextMonth.getFullYear() !== selectedYear) {
              setSelectedYear(nextMonth.getFullYear());
            }
            setCurrentMonth(nextMonth);
          }}
        >
          {'>'}
        </button>
      </div>

      <div className="toolbar-group attendance-toolbar-group attendance-toolbar-group--controls">
        <input
          className="attendance-month-input"
          type="month"
          value={monthString(currentMonth)}
          onChange={(event) => {
            const parsed = parseDateValue(`${event.target.value}-01`);
            if (parsed) {
              if (parsed.getFullYear() !== selectedYear) {
                setSelectedYear(parsed.getFullYear());
              }
              setCurrentMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
            }
          }}
        />

        <select
          className="attendance-entity-select"
          value={selectedEntity}
          onChange={(event) => setSelectedEntity(event.target.value)}
        >
          <option value="all">Tutti ({allEmployeesCount})</option>
          <option value="no_team">Senza squadra ({ungroupedEmployeesCount})</option>
          <optgroup label="Dipendenti">
            {sortedEmployeeOptions.map((employee) => (
              <option key={`employee-${employee.id}`} value={`employee:${employee.id}`}>
                {formatAttendanceEmployeeDisplayName(employee)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Squadre">
            {visibleTeams.map((team) => (
              <option key={`team-${team.id}`} value={`team:${team.id}`}>
                Squadra - {team.name}
                {team.attendance_mode === 'headcount' ? ' - numero presenti' : ''}
                {' '}({visibleTeamCounts.get(Number(team.id)) || 0})
              </option>
            ))}
          </optgroup>
        </select>

        {filterSlot ? (
          <div className="attendance-toolbar-filter-slot">
            {filterSlot}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default AttendanceToolbar;
