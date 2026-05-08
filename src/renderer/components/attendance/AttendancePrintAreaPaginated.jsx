import React, { useMemo } from 'react';
import { formatHoursValue } from '../../utils/attendanceSummary';
import {
  fileMonthLabel,
  formatDate,
  getDayLabel,
  paginateAttendancePrintRows,
  getAttendancePrintMainValue,
  getAttendancePrintOvertimeValue,
  getAttendancePrintMarkerValue,
  formatCompactWorkedSummary,
  resolveMarkerImageSrc,
} from '../../utils/attendancePrintUtils';

const attendancePrintCardStyle = {
  background: '#fff',
  border: '1px solid #dbe4f0',
  borderRadius: 12,
  padding: 8,
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
};

const attendancePrintPageStyle = {
  width: '100%',
  display: 'grid',
  gap: 0,
};

const attendancePrintHeaderStyle = {
  marginBottom: 6,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'nowrap',
};

const attendancePrintTitleStyle = {
  margin: 0,
  fontSize: 16,
  lineHeight: 1.05,
  color: '#14213d',
  fontWeight: 800,
};

const attendancePrintSubtitleStyle = {
  marginTop: 2,
  color: '#667085',
  fontSize: 9,
  lineHeight: 1.2,
};

const attendancePrintHeaderMetaStyle = {
  display: 'grid',
  justifyItems: 'end',
  gap: 4,
};

const attendancePrintQuickSymbolBadgeStyle = {
  padding: '4px 8px',
  borderRadius: 999,
  border: '1px solid rgba(20, 33, 61, 0.12)',
  background: 'rgba(20, 33, 61, 0.05)',
  color: '#27445f',
  fontSize: 9,
  fontWeight: 800,
  whiteSpace: 'nowrap',
};

const attendancePrintModeBadgeStyle = {
  padding: '3px 7px',
  borderRadius: 999,
  border: '1px solid rgba(20, 33, 61, 0.1)',
  background: 'rgba(22, 163, 74, 0.08)',
  color: '#166534',
  fontSize: 8,
  fontWeight: 800,
  whiteSpace: 'nowrap',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const attendancePrintTableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 8.6,
};

const attendancePrintHeadCellStyle = {
  border: '1px solid #9ca3af',
  padding: '3px 2px',
  textAlign: 'center',
  fontWeight: 800,
  background: '#f8fafc',
  minWidth: 0,
  lineHeight: 1.05,
};

const attendancePrintBodyCellStyle = {
  border: '1px solid #9ca3af',
  padding: '3px 2px',
  textAlign: 'center',
  verticalAlign: 'middle',
  overflow: 'hidden',
  minWidth: 0,
};

const attendancePrintNameCellStyle = {
  minWidth: 124,
  maxWidth: 124,
};

const attendancePrintNameHeadCellStyle = {
  minWidth: 124,
};

const attendancePrintNameColumnStyle = {
  width: '124px',
};

const attendancePrintDayColumnStyle = {
  width: '21px',
};

const attendancePrintHoursColumnStyle = {
  width: '48px',
};

const attendancePrintSummaryColumnStyle = {
  width: '66px',
};

const attendancePrintDayLabelStyle = {
  fontSize: 7.2,
  fontWeight: 700,
  lineHeight: 1,
};

const attendancePrintEmployeeMetaStyle = {
  fontSize: 7.4,
  color: '#6b7280',
  marginTop: 1,
  lineHeight: 1.1,
};

const attendancePrintCellStackStyle = {
  minHeight: 18,
  display: 'grid',
  width: '100%',
  overflow: 'hidden',
  borderRadius: 2,
  background: '#ffffff',
};

const attendancePrintCellSingleStyle = {
  minHeight: 18,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  fontSize: 7.1,
  fontWeight: 800,
  lineHeight: 1.05,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const attendancePrintCellSingleUpperStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  minHeight: 0,
  fontSize: 7.1,
  fontWeight: 800,
  lineHeight: 1.05,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const attendancePrintCellLowerGroupStyle = {
  display: 'grid',
  width: 'calc(100% + 10px)',
  marginLeft: -5,
  marginRight: -5,
};

const attendancePrintCellLowerGroupDividerStyle = {
  borderTop: '1px solid rgba(156, 163, 175, 0.7)',
};

const attendancePrintCellRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  minHeight: 0,
  fontSize: 6.8,
  fontWeight: 800,
  lineHeight: 1.05,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

function getPrintDayCellInlineStyle(dayInfo) {
  if (!dayInfo?.isSpecialDay) {
    return {};
  }

  return {
    background: dayInfo.isHoliday ? '#fee2e2' : '#fff5f5',
    color: '#991b1b',
  };
}

function MarkerVisual({ marker, size = 14 }) {
  const imageSrc = resolveMarkerImageSrc(marker?.image);

  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={marker?.text || marker?.value || 'marker'}
        style={{ width: size, height: size, objectFit: 'contain', display: 'inline-block' }}
      />
    );
  }

  return <>{marker?.symbol || '•'}</>;
}

function AttendancePrintCell({ mainValue, overtimeValue, markerValue }) {
  const hasMain = !!mainValue;
  const lowerRows = [overtimeValue, markerValue].filter(Boolean);

  if (!hasMain && !lowerRows.length) {
    return <div style={attendancePrintCellSingleStyle}>—</div>;
  }

  if (hasMain && !lowerRows.length) {
    return <div style={attendancePrintCellSingleStyle}>{mainValue}</div>;
  }

  return (
    <div style={attendancePrintCellStackStyle}>
      {hasMain ? (
        <div style={attendancePrintCellSingleUpperStyle}>{mainValue}</div>
      ) : null}

      <div
        style={{
          ...attendancePrintCellLowerGroupStyle,
          ...(hasMain ? attendancePrintCellLowerGroupDividerStyle : null),
          gridTemplateRows: `repeat(${lowerRows.length}, minmax(0, 1fr))`,
        }}
      >
        {lowerRows.map((rowValue, index) => (
          <div
            key={`${rowValue}-${index}`}
            style={attendancePrintCellRowStyle}
          >
            {typeof rowValue === 'string' ? rowValue : <MarkerVisual marker={rowValue} size={14} />}
          </div>
        ))}
      </div>
    </div>
  );
}

const AttendancePrintAreaPaginated = React.forwardRef(function AttendancePrintAreaPaginated(
  { currentMonth, baseHours, hoursFormat, markers, selectedMeta, selectedTeam, displayRows, modeLabel, daysInMonth, dayInfoMap, getAtt },
  ref
) {
  const monthLabel = fileMonthLabel(currentMonth);
  const title =
    selectedMeta.type === 'team' && selectedTeam
      ? `Presenze squadra - ${selectedTeam.name}`
      : selectedMeta.type === 'employee'
      ? 'Presenze dipendente'
      : 'Presenze mensili';

  const subtitle =
    selectedMeta.type === 'team' && selectedTeam
      ? `${monthLabel} · ${displayRows.length} componenti`
      : `${monthLabel} · ${modeLabel}`;
  const quickSymbolLabel = `X = ${formatHoursValue(baseHours, hoursFormat)}`;
  const printPages = useMemo(() => paginateAttendancePrintRows(displayRows), [displayRows]);

  return (
    <div ref={ref} className="print-area attendance-print-area">
      <style>{`
        @page {
          size: A4 landscape;
          margin: 8mm;
        }
      `}</style>
      {printPages.map((page, pageIndex) => (
        <section
          key={`attendance-print-page-${pageIndex}`}
          className="attendance-print-page"
          style={attendancePrintPageStyle}
        >
          <div style={attendancePrintCardStyle}>
            <div style={attendancePrintHeaderStyle}>
              <div>
                <h2 style={attendancePrintTitleStyle}>{title}</h2>
                <div style={attendancePrintSubtitleStyle}>
                  {subtitle} · Pagina {pageIndex + 1} / {printPages.length}
                </div>
              </div>
              <div style={attendancePrintHeaderMetaStyle}>
                <div style={attendancePrintQuickSymbolBadgeStyle}>{quickSymbolLabel}</div>
                <div style={attendancePrintModeBadgeStyle}>{modeLabel}</div>
              </div>
            </div>

            <table style={attendancePrintTableStyle}>
              <colgroup>
                <col style={attendancePrintNameColumnStyle} />
                {daysInMonth.map((day) => (
                  <col key={`print-col-${pageIndex}-${formatDate(day)}`} style={attendancePrintDayColumnStyle} />
                ))}
                <col style={attendancePrintHoursColumnStyle} />
                <col style={attendancePrintSummaryColumnStyle} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...attendancePrintHeadCellStyle, ...attendancePrintNameHeadCellStyle }}>Dipendente</th>
                  {daysInMonth.map((day) => {
                    const dateStr = formatDate(day);
                    const dayInfo = dayInfoMap[dateStr];
                    return (
                      <th
                        key={`print-head-${pageIndex}-${dateStr}`}
                        style={{
                          ...attendancePrintHeadCellStyle,
                          ...getPrintDayCellInlineStyle(dayInfo),
                        }}
                      >
                        {day.getDate()}
                        <br />
                        <span style={attendancePrintDayLabelStyle}>{getDayLabel(day)}</span>
                      </th>
                    );
                  })}
                  <th style={attendancePrintHeadCellStyle}>Ore</th>
                  <th style={attendancePrintHeadCellStyle}>Riep.</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map(({ employee, teamMember }) => {
                  let totalHours = 0;

                  return (
                    <tr key={`print-row-${pageIndex}-${employee.id}`}>
                      <td style={{ ...attendancePrintBodyCellStyle, ...attendancePrintNameCellStyle, textAlign: 'left' }}>
                        <strong>{employee.last_name} {employee.first_name}</strong>
                        {employee.role ? <div style={attendancePrintEmployeeMetaStyle}>{employee.role}</div> : null}
                        {teamMember?.manage_by_days ? (
                          <div style={attendancePrintEmployeeMetaStyle}>Gestione a giornate</div>
                        ) : null}
                      </td>
                      {daysInMonth.map((day) => {
                        const dateStr = formatDate(day);
                        const att = getAtt(employee.id, dateStr);
                        const dayInfo = dayInfoMap[dateStr];
                        const hours = Number(att?.hours_worked || 0) + Number(att?.overtime_hours || 0);
                        if (hours > 0) {
                          totalHours += hours;
                        }

                        return (
                          <td
                            key={`print-cell-${pageIndex}-${employee.id}-${dateStr}`}
                            style={{
                              ...attendancePrintBodyCellStyle,
                              ...getPrintDayCellInlineStyle(dayInfo),
                            }}
                          >
                            <AttendancePrintCell
                              mainValue={getAttendancePrintMainValue(att, hoursFormat)}
                              overtimeValue={getAttendancePrintOvertimeValue(att, hoursFormat)}
                              markerValue={getAttendancePrintMarkerValue(att, markers)}
                            />
                          </td>
                        );
                      })}
                      <td style={attendancePrintBodyCellStyle}>
                        <strong>{formatHoursValue(totalHours, hoursFormat)}</strong>
                      </td>
                      <td style={attendancePrintBodyCellStyle}>
                        <strong>{formatCompactWorkedSummary(totalHours, baseHours, hoursFormat)}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
});

export default AttendancePrintAreaPaginated;
export { AttendancePrintCell, MarkerVisual };
