import React from 'react';

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
}) {
  return (
    <div className="toolbar attendance-toolbar">
      <div className="toolbar-group attendance-toolbar-group">
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
          {activeEmployees.map((employee) => (
            <option key={`employee-${employee.id}`} value={`employee:${employee.id}`}>
              {employee.first_name} {employee.last_name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Squadre">
          {visibleTeams.map((team) => (
            <option key={`team-${team.id}`} value={`team:${team.id}`}>
              Squadra • {team.name} ({visibleTeamCounts.get(Number(team.id)) || 0})
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}

export default AttendanceToolbar;
