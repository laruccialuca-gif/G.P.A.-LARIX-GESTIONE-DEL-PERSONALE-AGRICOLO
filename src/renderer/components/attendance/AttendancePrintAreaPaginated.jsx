import React, { useMemo } from 'react';
import { formatHoursValue } from '../../utils/attendanceSummary';
import {
  fileMonthLabel,
  formatDate,
  getDayLabel,
  getAttendancePrintMainValue,
  getAttendancePrintOvertimeValue,
  getAttendancePrintMarkerValue,
  formatCompactWorkedSummary,
  resolveMarkerImageSrc,
} from '../../utils/attendancePrintUtils';

function getAttendanceEmployeeDisplayName(employee) {
  if (!employee) return '';
  if (employee.full_name) {
    return String(employee.full_name).trim();
  }
  return `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
}

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

const attendancePrintCardStyle = {
  background: '#fff',
  border: '1px solid #dbe4f0',
  borderRadius: 12,
  padding: '6px 7px',
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
  width: '100%',
};

const attendancePrintPageStyle = {
  width: '100%',
  display: 'grid',
  gap: 0,
  padding: 0,
  margin: 0,
  boxSizing: 'border-box',
};

const attendancePrintHeaderStyle = {
  marginBottom: 4,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'nowrap',
};

const attendancePrintTitleStyle = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.05,
  color: '#14213d',
  fontWeight: 800,
};

const attendancePrintSubtitleStyle = {
  marginTop: 1,
  color: '#667085',
  fontSize: 8.2,
  lineHeight: 1.1,
};

const attendancePrintHeaderMetaStyle = {
  display: 'grid',
  justifyItems: 'end',
  gap: 3,
};

const attendancePrintQuickSymbolBadgeStyle = {
  padding: '3px 7px',
  borderRadius: 999,
  border: '1px solid rgba(20, 33, 61, 0.12)',
  background: 'rgba(20, 33, 61, 0.05)',
  color: '#27445f',
  fontSize: 8.2,
  fontWeight: 800,
  whiteSpace: 'nowrap',
};

const attendancePrintModeBadgeStyle = {
  padding: '2px 6px',
  borderRadius: 999,
  border: '1px solid rgba(20, 33, 61, 0.1)',
  background: 'rgba(22, 163, 74, 0.08)',
  color: '#166534',
  fontSize: 7.4,
  fontWeight: 800,
  whiteSpace: 'nowrap',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const attendancePrintTableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 8.2,
  tableLayout: 'fixed',
};

const attendancePrintHeadCellStyle = {
  border: '1px solid #9ca3af',
  padding: '2px 2px',
  textAlign: 'center',
  fontWeight: 800,
  background: '#f8fafc',
  minWidth: 0,
  lineHeight: 1.05,
};

const attendancePrintBodyCellStyle = {
  border: '1px solid #9ca3af',
  padding: '2px 2px',
  textAlign: 'center',
  verticalAlign: 'middle',
  overflow: 'hidden',
  minWidth: 0,
  whiteSpace: 'nowrap',
};

const attendancePrintNameCellStyle = {
  minWidth: 116,
  maxWidth: 116,
};

const attendancePrintNameHeadCellStyle = {
  minWidth: 116,
};

const attendancePrintNameColumnStyle = {
  width: '116px',
};

const attendancePrintDayColumnStyle = {
  width: 'auto',
};

const attendancePrintHoursColumnStyle = {
  width: '50px',
};

const attendancePrintSummaryColumnStyle = {
  width: '68px',
};

const attendancePrintDayLabelStyle = {
  fontSize: 6.9,
  fontWeight: 700,
  lineHeight: 1,
};

const attendancePrintEmployeeMetaStyle = {
  fontSize: 6.9,
  color: '#6b7280',
  marginTop: 1,
  lineHeight: 1.05,
};

const attendancePrintCellStackStyle = {
  minHeight: 16,
  display: 'grid',
  width: '100%',
  overflow: 'hidden',
  borderRadius: 2,
  background: '#ffffff',
};

const attendancePrintCellSingleStyle = {
  minHeight: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  fontSize: 6.9,
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
  fontSize: 6.9,
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
  fontSize: 6.5,
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

const ATTENDANCE_PRINT_PAGE_METRICS = {
  pageHeightMm: 210,
  pageMarginMm: 6,
  cardVerticalPaddingMm: 3,
  headerHeightMm: 11,
  tableHeaderHeightMm: 8,
  footerReserveMm: 1,
  rowHeightMm: 8.8,
  minRowsPerPage: 15,
  maxRowsPerPage: 20,
};

function getAttendanceRowsPerPage() {
  const {
    pageHeightMm,
    pageMarginMm,
    cardVerticalPaddingMm,
    headerHeightMm,
    tableHeaderHeightMm,
    footerReserveMm,
    rowHeightMm,
    minRowsPerPage,
    maxRowsPerPage,
  } = ATTENDANCE_PRINT_PAGE_METRICS;

  const printableHeightMm = pageHeightMm - pageMarginMm * 2;
  const usableBodyHeightMm =
    printableHeightMm -
    cardVerticalPaddingMm -
    headerHeightMm -
    tableHeaderHeightMm -
    footerReserveMm;

  const estimatedRows = Math.floor(usableBodyHeightMm / rowHeightMm);
  return Math.max(minRowsPerPage, Math.min(maxRowsPerPage, estimatedRows));
}

function paginateAttendanceRowsForPrint(displayRows) {
  const rowsPerPage = getAttendanceRowsPerPage();
  const regularRows = [];
  const headcountRows = [];

  (displayRows || []).forEach((row) => {
    if (row?.employee?.is_headcount_team_row) {
      headcountRows.push(row);
      return;
    }
    regularRows.push(row);
  });

  const pages = [];

  for (let startIndex = 0; startIndex < regularRows.length; startIndex += rowsPerPage) {
    pages.push({ rows: regularRows.slice(startIndex, startIndex + rowsPerPage) });
  }

  if (!pages.length) {
    pages.push({ rows: [] });
  }

  headcountRows.forEach((row) => {
    const lastPage = pages[pages.length - 1];
    if (lastPage.rows.length < rowsPerPage) {
      lastPage.rows.push(row);
    } else {
      pages.push({ rows: [row] });
    }
  });

  return { rowsPerPage, pages };
}

function computeRowHeightForPrintPage(rowCount) {
  // A4 landscape: 210mm (height) = ~793px at 96 DPI
  // 1mm ≈ 3.78px
  const MM_TO_PX = 3.78;
  const pageHeightPx = 210 * MM_TO_PX;
  const marginPx = 6 * MM_TO_PX; // 6mm margins on top and bottom
  const cardPaddingPx = 3 * MM_TO_PX; // 3mm top and bottom padding
  const headerHeightPx = 11 * MM_TO_PX; // 11mm header
  const tableHeaderHeightPx = 8 * MM_TO_PX; // 8mm table header
  const footerReservePx = 1 * MM_TO_PX; // 1mm footer

  const usableHeightPx =
    pageHeightPx -
    marginPx * 2 -
    cardPaddingPx * 2 -
    headerHeightPx -
    tableHeaderHeightPx -
    footerReservePx;

  const computedRowHeightPx = usableHeightPx / rowCount;
  // Clamp between 18px (min for readability) and 65px (max to fill page)
  const clampedRowHeightPx = Math.max(18, Math.min(computedRowHeightPx, 65));
  console.log('[attendance-print] rowHeight calculation:', {
    rowCount,
    pageHeightPx,
    usableHeightPx,
    computedRowHeightPx: parseFloat(computedRowHeightPx.toFixed(2)),
    clampedRowHeightPx: parseFloat(clampedRowHeightPx.toFixed(2)),
  });
  return clampedRowHeightPx;
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
      ? `${monthLabel} - ${displayRows.length} componenti`
      : `${monthLabel} - ${modeLabel}`;
  const quickSymbolLabel = `X = ${formatHoursValue(baseHours, hoursFormat)}`;
  const { pages: printPages } = useMemo(() => paginateAttendanceRowsForPrint(displayRows), [displayRows]);

  return (
    <div ref={ref} className="print-area attendance-print-area">
      {printPages.map((page, pageIndex) => {
        const rowHeightPx = computeRowHeightForPrintPage(page.rows.length);
        console.log('[attendance-print] applied inline row height', { pageIndex, rowCount: page.rows.length, rowHeightPx });
        return (
        <section
          key={`attendance-print-page-${pageIndex}`}
          className={`attendance-print-page ${pageIndex === printPages.length - 1 ? 'attendance-print-page-last' : ''}`}
          style={attendancePrintPageStyle}
        >
          <div style={attendancePrintCardStyle}>
            <div style={attendancePrintHeaderStyle}>
              <div>
                <h2 style={attendancePrintTitleStyle}>{title}</h2>
                <div style={attendancePrintSubtitleStyle}>
                  {subtitle} - Pagina {pageIndex + 1} / {printPages.length}
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
                  let totalHeadcount = 0;
                  const isHeadcountRow = !!employee?.is_headcount_team_row;

                  return (
                    <tr
                      key={`print-row-${pageIndex}-${employee.id}`}
                      style={{
                        height: `${rowHeightPx}px`,
                        minHeight: `${rowHeightPx}px`,
                        maxHeight: `${rowHeightPx}px`,
                      }}
                    >
                      <td
                        style={{
                          ...attendancePrintBodyCellStyle,
                          ...attendancePrintNameCellStyle,
                          textAlign: 'left',
                          height: `${rowHeightPx}px`,
                          minHeight: `${rowHeightPx}px`,
                          maxHeight: `${rowHeightPx}px`,
                          verticalAlign: 'middle',
                        }}
                      >
                        <strong>{getAttendanceEmployeeDisplayName(employee)}</strong>
                        {employee.role ? <div style={attendancePrintEmployeeMetaStyle}>{employee.role}</div> : null}
                        {teamMember?.manage_by_days ? (
                          <div style={attendancePrintEmployeeMetaStyle}>Gestione a giornate</div>
                        ) : null}
                      </td>
                      {daysInMonth.map((day) => {
                        const dateStr = formatDate(day);
                        const att = getAtt(employee.id, dateStr);
                        const dayInfo = dayInfoMap[dateStr];
                        const hours = isHeadcountRow
                          ? Number(att?.hours_worked || 0) * Number(baseHours || 0)
                          : Number(att?.hours_worked || 0) + Number(att?.overtime_hours || 0);
                        if (hours > 0) {
                          totalHours += hours;
                        }
                        if (isHeadcountRow) {
                          totalHeadcount += Number(att?.hours_worked || 0);
                        }

                        return (
                          <td
                            key={`print-cell-${pageIndex}-${employee.id}-${dateStr}`}
                            style={{
                              ...attendancePrintBodyCellStyle,
                              ...getPrintDayCellInlineStyle(dayInfo),
                              height: `${rowHeightPx}px`,
                              minHeight: `${rowHeightPx}px`,
                              maxHeight: `${rowHeightPx}px`,
                              verticalAlign: 'middle',
                            }}
                          >
                            <AttendancePrintCell
                              mainValue={isHeadcountRow
                                ? (att?.hours_worked === '' || att?.hours_worked === null || att?.hours_worked === undefined
                                  ? ''
                                  : String(Number(att.hours_worked)).replace(/\.0+$/, ''))
                                : getAttendancePrintMainValue(att, hoursFormat)}
                              overtimeValue={isHeadcountRow ? '' : getAttendancePrintOvertimeValue(att, hoursFormat)}
                              markerValue={isHeadcountRow ? '' : getAttendancePrintMarkerValue(att, markers)}
                            />
                          </td>
                        );
                      })}
                      <td
                        style={{
                          ...attendancePrintBodyCellStyle,
                          height: `${rowHeightPx}px`,
                          minHeight: `${rowHeightPx}px`,
                          maxHeight: `${rowHeightPx}px`,
                          verticalAlign: 'middle',
                        }}
                      >
                        <strong>{formatHoursValue(totalHours, hoursFormat)}</strong>
                      </td>
                      <td
                        style={{
                          ...attendancePrintBodyCellStyle,
                          height: `${rowHeightPx}px`,
                          minHeight: `${rowHeightPx}px`,
                          maxHeight: `${rowHeightPx}px`,
                          verticalAlign: 'middle',
                        }}
                      >
                        <strong>{isHeadcountRow ? formatHeadcountSummary(totalHeadcount) : formatCompactWorkedSummary(totalHours, baseHours, hoursFormat)}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        );
      })}
    </div>
  );
});

export default AttendancePrintAreaPaginated;
export { AttendancePrintCell, MarkerVisual };
