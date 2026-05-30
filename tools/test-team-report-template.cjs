const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const { buildMockLeonoraTeamReportData } = require('../src/main/print/buildTeamReportData');
const { renderTeamReportHtml } = require('../src/main/print/printTemplate');

const OUTPUT_DIR = path.resolve(__dirname, '../diagnostics');
const OUTPUT_PDF = path.join(OUTPUT_DIR, 'team-report-template-test.pdf');
const OUTPUT_HTML = path.join(OUTPUT_DIR, 'team-report-template-test.html');

async function createPdfBuffer(html) {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: false,
    },
  });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_HTML, html, 'utf8');
  await win.loadFile(OUTPUT_HTML);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const buffer = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    },
    preferCSSPageSize: true,
  });
  win.destroy();
  return buffer;
}

app.whenReady().then(async () => {
  try {
    const payload = buildMockLeonoraTeamReportData();
    const html = renderTeamReportHtml(payload);
    const pdfBuffer = await createPdfBuffer(html);
    fs.writeFileSync(OUTPUT_PDF, pdfBuffer);
    console.log(`[team-report-template-test] pdf=${OUTPUT_PDF}`);
    console.log(`[team-report-template-test] html=${OUTPUT_HTML}`);
    console.log(`[team-report-template-test] finalBalance=${payload.economics.finalBalanceLabel}`);
    await app.quit();
  } catch (error) {
    console.error('[team-report-template-test] failed', error);
    app.exit(1);
  }
});
