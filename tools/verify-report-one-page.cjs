const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const { getDb, closeDb, getDbPath } = require('../src/main/db');

function buildPdfHtml(contentHtml) {
  return `
  <!doctype html>
  <html lang="it">
    <head>
      <meta charset="UTF-8" />
      <title>Verifica Report PDF</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 5mm;
        }

        html, body {
          width: 210mm;
          height: 297mm;
          margin: 0;
          padding: 0;
          overflow: hidden;
          background: white;
          font-family: Arial, Helvetica, sans-serif;
          color: #111827;
          font-size: 10px;
          line-height: 1.3;
        }

        * {
          box-sizing: border-box;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }

        .print-root {
          width: 202mm;
          margin: 0 auto;
          padding: 0;
        }

        .print-area,
        .report-page,
        .print-report,
        .pdf-report {
          width: 202mm;
          max-width: 202mm;
          min-height: 0;
          height: auto;
          margin: 0 auto;
          padding: 0;
          box-sizing: border-box;
          overflow: hidden;
          page-break-after: avoid;
          break-after: avoid;
        }

        .print-sheet {
          width: 100%;
          max-width: 202mm;
          margin: 0 auto;
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .report-section,
        .calendar-section,
        .economic-section,
        .result-box,
        .kpi-row,
        .print-block {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .employee-print-area {
          width: 100% !important;
          max-width: 202mm !important;
          margin: 0 auto !important;
          transform: none !important;
          overflow: visible !important;
          page-break-after: avoid !important;
          break-after: avoid !important;
        }

        .employee-print-sheet {
          width: 100% !important;
          max-width: 202mm !important;
          min-height: 0 !important;
          padding: 6mm 8mm 5mm !important;
          border-radius: 8px !important;
          box-shadow: none !important;
          border: 1px solid rgba(31,41,55,0.08) !important;
          overflow: visible !important;
          page-break-after: avoid !important;
          break-after: avoid !important;
        }

        .employee-print-sheet,
        .employee-print-sheet * {
          color: #111827 !important;
        }

        .employee-print-sheet > div:first-child {
          margin-bottom: 6px !important;
          gap: 8px !important;
          align-items: center !important;
        }
        .employee-print-sheet > div:first-child > div:first-child > div:first-child {
          font-size: 19px !important;
          line-height: 1.05 !important;
        }
        .employee-print-sheet > div:first-child > div:first-child > div:nth-child(2) {
          font-size: 11px !important;
          margin-top: 2px !important;
        }
        .employee-print-sheet > div:first-child > div:last-child {
          font-size: 11px !important;
          padding: 5px 10px !important;
          white-space: nowrap !important;
          text-transform: uppercase !important;
          flex-shrink: 0 !important;
        }

        .employee-print-sheet > div:nth-child(2) {
          gap: 6px !important;
          margin-bottom: 6px !important;
        }
        .employee-print-sheet > div:nth-child(2) > div {
          padding: 6px 8px !important;
          border-radius: 8px !important;
        }
        .employee-print-sheet > div:nth-child(2) > div > div:first-child {
          font-size: 9px !important;
          margin-bottom: 2px !important;
          letter-spacing: 0.04em !important;
        }
        .employee-print-sheet > div:nth-child(2) > div > div:nth-child(2) {
          font-size: 16px !important;
          line-height: 1 !important;
          white-space: nowrap !important;
        }
        .employee-print-sheet > div:nth-child(2) > div > div:nth-child(3) {
          font-size: 9px !important;
          margin-top: 2px !important;
        }

        .employee-print-sheet > div:nth-child(3) {
          gap: 6px !important;
          margin-bottom: 2px !important;
          flex-wrap: nowrap !important;
        }
        .employee-print-sheet > div:nth-child(3) > div {
          padding: 4px 9px !important;
          font-size: 10px !important;
          gap: 6px !important;
        }

        .employee-print-sheet .employee-print-section,
        .employee-print-sheet .print-block {
          margin-top: 5px !important;
          padding: 7px 9px !important;
          border-radius: 8px !important;
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }
        .employee-print-sheet .employee-print-section > div:first-child {
          margin-bottom: 4px !important;
          font-size: 9px !important;
          letter-spacing: 0.06em !important;
        }

        .employee-print-sheet [style*="Settimana "],
        .employee-print-sheet [style*="font-size: 10px"][style*="letter-spacing: 0.08em"] {
          margin-top: 0 !important;
          margin-bottom: 0 !important;
          font-size: 8px !important;
        }
        .employee-print-sheet [style*="grid-template-columns: repeat(7"] {
          gap: 4px !important;
        }
        .employee-print-sheet [style*="border-radius: 14px"][style*="justify-items: center"] {
          padding: 4px 3px !important;
          gap: 3px !important;
          border-radius: 6px !important;
          min-height: 0 !important;
        }
        .employee-print-sheet [style*="font-size: 13px"][style*="font-weight: 800"][style*="line-height: 1"] {
          font-size: 10px !important;
        }
        .employee-print-sheet [style*="width: 28px"][style*="height: 28px"] {
          width: 18px !important;
          height: 18px !important;
          font-size: 10px !important;
        }
        .employee-print-sheet [style*="min-height: 24"] {
          min-height: 12px !important;
          font-size: 8px !important;
        }
        .employee-print-sheet [style*="font-size: 9px"][style*="line-height: 1.1"] {
          font-size: 7px !important;
          line-height: 1.05 !important;
        }
        .employee-print-sheet [style*="display: grid"][style*="gap: 6px"][style*="margin-top: 10px"] {
          gap: 2px !important;
          margin-top: 4px !important;
        }
        .employee-print-sheet [style*="display: flex"][style*="gap: 14px"][style*="margin-top: 12px"] {
          margin-top: 4px !important;
          font-size: 9px !important;
          gap: 8px !important;
        }

        .employee-print-sheet [style*="font-size: 11px"][style*="letter-spacing: 0.08em"] {
          font-size: 9px !important;
          margin-bottom: 4px !important;
        }
        .employee-print-sheet [style*="padding: 12px 0"],
        .employee-print-sheet [style*="padding: 12px 0 0"] {
          padding-top: 3px !important;
          padding-bottom: 3px !important;
        }
        .employee-print-sheet [style*="font-size: 12px"][style*="font-weight: 700"] {
          font-size: 10px !important;
        }
        .employee-print-sheet [style*="font-size: 13px"][style*="font-weight: 800"][style*="color: rgb(17, 24, 39)"] {
          font-size: 11px !important;
        }
        .employee-print-sheet [style*="font-size: 11px"][style*="margin-top: 4px"] {
          font-size: 9px !important;
          margin-top: 1px !important;
          line-height: 1.2 !important;
        }
        .employee-print-sheet [style*="font-size: 13px"][style*="font-weight: 800"][style*="white-space: nowrap"] {
          font-size: 11px !important;
        }
        .employee-print-sheet [style*="font-size: 15px"][style*="font-weight: 800"][style*="white-space: nowrap"] {
          font-size: 12px !important;
        }

        .employee-print-sheet [style*="padding: 18px 20px"] {
          padding: 9px 13px !important;
          margin-top: 5px !important;
          border-radius: 10px !important;
        }
        .employee-print-sheet [style*="font-size: 14px"][style*="font-weight: 800"] {
          font-size: 11px !important;
          margin-bottom: 1px !important;
        }
        .employee-print-sheet [style*="font-size: 28px"][style*="font-weight: 900"] {
          font-size: 19px !important;
          line-height: 1 !important;
        }

        .employee-print-sheet [style*="margin-top: 14px"][style*="padding: 12px 14px"] {
          margin-top: 4px !important;
          padding: 5px 9px !important;
          font-size: 9px !important;
        }
        .employee-print-sheet [style*="margin-top: 18px"][style*="padding-top: 14px"] {
          margin-top: 4px !important;
          padding-top: 4px !important;
          font-size: 8px !important;
        }

        .employee-print-layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: 6px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 10px;
        }

        th, td {
          padding: 4px;
        }

        thead {
          display: table-header-group;
        }

        tr {
          break-inside: avoid;
          page-break-inside: avoid;
        }
      </style>
    </head>
    <body>
      <div class="print-root">
        ${contentHtml}
      </div>
    </body>
  </html>
  `;
}

async function normalizeEmployeeReportPrintWindow(win) {
  await win.webContents.executeJavaScript(`
    (() => {
      const isEmptyAmount = (value) => {
        const text = String(value || '').trim();
        return !text || text === '-' || text === '—' || text === 'â€”';
      };
      const normalizeAmount = (value, negative = false) => {
        const text = String(value || '').trim();
        if (!negative || isEmptyAmount(text) || text.startsWith('-')) return text;
        return '- ' + text;
      };

      document.querySelectorAll('.employee-print-sheet, .employee-print-sheet *').forEach((node) => {
        if (node.style) node.style.color = '#111827';
      });

      document.querySelectorAll('.employee-print-sheet [style*="justify-items: center"]').forEach((cell) => {
        const children = Array.from(cell.children);
        const indicator = children.find((child) => child.textContent.trim() === 'X');
        if (indicator) {
          children.slice(children.indexOf(indicator) + 1).forEach((child) => {
            if (!/straord/i.test(child.textContent)) child.remove();
          });
          return;
        }

        const detail = children.find((child) => ['Riposo', 'Domenica'].includes(child.textContent.trim()));
        if (detail) {
          children.slice(children.indexOf(detail) + 1).forEach((child) => {
            if (['Riposo', 'Domenica', ''].includes(child.textContent.trim())) child.remove();
          });
        }
      });

      const sections = Array.from(document.querySelectorAll('.employee-print-section'));
      const economicSection = sections.find((section) => /Riepilogo economico/i.test(section.textContent));
      const table = economicSection?.children?.[1];
      if (!table) return;

      const orderedRows = [];
      Array.from(table.children).forEach((row) => {
        const labelNode = row.querySelector('div div:first-child');
        const amountNode = row.lastElementChild;
        const label = labelNode?.textContent.trim() || '';
        const detail = labelNode?.nextElementSibling?.textContent.trim() || '';
        const amount = amountNode?.textContent.trim() || '';
        let order = null;
        let hidden = false;
        let negative = false;

        if (/Retribuzione/i.test(label)) order = 1;
        else if (/Trasporto/i.test(label)) { order = 2; hidden = isEmptyAmount(amount) || /Non incluso/i.test(detail); }
        else if (/Crediti/i.test(label)) { order = 3; hidden = isEmptyAmount(amount) || /Nessun/i.test(detail); }
        else if (/Regalo|Extra/i.test(label)) { order = 4; hidden = isEmptyAmount(amount) || /Nessun/i.test(detail); }
        else if (/Busta paga/i.test(label)) { order = 5; hidden = isEmptyAmount(amount) || /Non inserita/i.test(detail); negative = true; }
        else if (/Rate/i.test(label)) { order = 6; hidden = isEmptyAmount(amount) || /Nessuna/i.test(detail); negative = true; }
        else if (/Acconti/i.test(label)) { order = 7; hidden = isEmptyAmount(amount) || /Nessun/i.test(detail); negative = true; }
        else if (/Debiti|debiti precedenti/i.test(label)) { order = 8; hidden = isEmptyAmount(amount) || /Nessun/i.test(detail); negative = true; }
        else hidden = true;

        if (!hidden && order !== null) {
          if (negative && amountNode) amountNode.textContent = normalizeAmount(amount, true);
          orderedRows.push({ order, row });
        } else {
          row.remove();
        }
      });

      orderedRows.sort((a, b) => a.order - b.order).forEach(({ row }) => table.appendChild(row));
    })();
  `);
}

async function createPdfBuffer(html) {
  const win = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(buildPdfHtml(html))}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await normalizeEmployeeReportPrintWindow(win);

  const buffer = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    landscape: false,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    preferCSSPageSize: true,
  });

  win.close();
  return buffer;
}

function countPdfPages(buffer) {
  const matches = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

async function main() {
  const targetMonth = '2026-04';
  const targetFirstName = 'GIUSEPPE';
  const targetLastName = 'PUGLIESE';
  const db = getDb();
  let row = db.prepare(`
    SELECT pr.id, pr.month, pr.report_html_snapshot, e.first_name, e.last_name
    FROM payroll_records pr
    JOIN employees e ON e.id = pr.employee_id
    WHERE UPPER(TRIM(e.first_name)) = ?
      AND UPPER(TRIM(e.last_name)) = ?
      AND pr.month = ?
    ORDER BY pr.id DESC
    LIMIT 1
  `).get(targetFirstName, targetLastName, targetMonth);

  if (!row?.report_html_snapshot) {
    console.warn(
      `[verify] Nessun snapshot per ${targetFirstName} ${targetLastName} ${targetMonth}, uso ultimo report disponibile`
    );
    row = db.prepare(`
      SELECT pr.id, pr.month, pr.report_html_snapshot, e.first_name, e.last_name
      FROM payroll_records pr
      JOIN employees e ON e.id = pr.employee_id
      WHERE pr.report_html_snapshot IS NOT NULL AND length(pr.report_html_snapshot) > 0
      ORDER BY pr.id DESC
      LIMIT 1
    `).get();
  }

  if (!row?.report_html_snapshot) {
    throw new Error('Nessun report snapshot disponibile nel database');
  }

  const pdfBuffer = await createPdfBuffer(row.report_html_snapshot);
  const pageCount = countPdfPages(pdfBuffer);
  const outputDir = path.join(__dirname, '..', 'tmp');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'giuseppe-pugliese-2026-04-report-verification.pdf');
  fs.writeFileSync(outputPath, pdfBuffer);

  console.log(JSON.stringify({
    dbPath: getDbPath(),
    payrollRecordId: row.id,
    month: row.month,
    outputPath,
    pageCount,
  }, null, 2));
}

app.whenReady()
  .then(main)
  .then(() => {
    closeDb();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    closeDb();
    app.exit(1);
  });
