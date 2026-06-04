const fs = require('node:fs');
const path = require('node:path');

function getAppBasePath() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getAppPath === 'function') {
      return app.getAppPath();
    }
  } catch {
    // electron app not available in plain node contexts
  }

  return path.resolve(__dirname, '../..');
}

function resolveRendererTemplatePath(fileName) {
  const candidates = [
    path.resolve(__dirname, '../../renderer/printTemplates', fileName),
    path.resolve(getAppBasePath(), 'src/renderer/printTemplates', fileName),
    path.resolve(process.cwd(), 'src/renderer/printTemplates', fileName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const error = new Error(
    `${fileName} not found in:\n${candidates.join('\n')}`
  );
  error.code = 'ENOENT';
  throw error;
}

function getTeamReportTemplatePath() {
  return resolveRendererTemplatePath('TeamReportTemplate.html');
}

function getEmployeeReportTemplatePath() {
  return resolveRendererTemplatePath('EmployeeReportTemplate.html');
}

function getEmployeeReportCssPath() {
  return resolveRendererTemplatePath('employee-report.css');
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
  const cssPath = getEmployeeReportCssPath();
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
  getEmployeeReportCssPath,
  getTeamReportTemplatePath,
  renderEmployeeReportHtml,
  renderTeamReportHtml,
  renderToPDF,
};
