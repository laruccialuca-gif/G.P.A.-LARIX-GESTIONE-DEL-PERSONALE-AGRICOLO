const fs = require('node:fs');
const path = require('node:path');

function getTeamReportTemplatePath() {
  return path.resolve(__dirname, '../../renderer/printTemplates/TeamReportTemplate.html');
}

function getEmployeeReportTemplatePath() {
  return path.resolve(__dirname, '../../renderer/printTemplates/EmployeeReportTemplate.html');
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/<\/script/gi, '<\\/script');
}

function renderTeamReportHtml(data) {
  const templatePath = getTeamReportTemplatePath();
  const template = fs.readFileSync(templatePath, 'utf8');
  const title = String(data?.title || `Report Squadra · ${data?.team?.name || ''}`).trim();

  return template
    .replaceAll('{{TEAM_REPORT_TITLE}}', title)
    .replaceAll('{{TEAM_REPORT_DATA_JSON}}', serializeForInlineScript(data));
}

function renderEmployeeReportHtml(data) {
  const templatePath = getEmployeeReportTemplatePath();
  const cssPath = path.resolve(__dirname, '../../renderer/printTemplates/employee-report.css');
  const template = fs.readFileSync(templatePath, 'utf8');
  const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
  const injectedDataScript = `<script>window.REPORT_DATA=${serializeForInlineScript(data)};</script>`;

  return template
    .replace(
      /<link\s+rel=["']stylesheet["']\s+href=["']\.\/employee-report\.css["']\s*\/?>/i,
      `<style>${css}</style>`
    )
    .replace('</head>', `${injectedDataScript}\n</head>`);
}

async function renderToPDF(templatePath, data, options = {}) {
  const { BrowserWindow } = require('electron');

  const win = new BrowserWindow({
    show: false,
    width: options.width || 1240,
    height: options.height || 1754,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  try {
    await win.loadFile(templatePath);
    await win.webContents.executeJavaScript(
      `window.loadData(${serializeForInlineScript(data)}); true;`
    );

    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(resolve).catch(resolve);
        } else {
          resolve();
        }
      });
    `);

    return await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      ...options.printOptions,
    });
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

module.exports = {
  getEmployeeReportTemplatePath,
  getTeamReportTemplatePath,
  renderEmployeeReportHtml,
  renderTeamReportHtml,
  renderToPDF,
};
