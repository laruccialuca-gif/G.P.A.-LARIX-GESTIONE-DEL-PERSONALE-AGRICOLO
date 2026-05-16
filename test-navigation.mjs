import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROUTES = [
  { path: '/', name: 'Home' },
  { path: '#/dipendenti', name: 'Dipendenti' },
  { path: '#/presenze', name: 'Presenze' },
  { path: '#/acconti-rate', name: 'Acconti/Rate' },
  { path: '#/report', name: 'Report' },
  { path: '#/storico-operaio', name: 'Storico Operaio' },
  { path: '#/buste-paga', name: 'Buste Paga' },
  { path: '#/comunicazione', name: 'Comunicazione' },
  { path: '#/operai-assunti', name: 'Operai Assunti' },
  { path: '#/impostazioni', name: 'Impostazioni' },
  { path: '#/utenti', name: 'Utenti' },
];

const report = [];
let browser;

async function runTests() {
  console.log('Starting navigation tests...\n');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const reportPath = path.join(__dirname, `navigation-crash-report-${timestamp}.txt`);

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Collect console messages
    const consoleLogs = [];
    page.on('console', (msg) => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        args: msg.args(),
      });
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
      }
    });

    // Collect errors
    const errors = [];
    page.on('error', (err) => {
      errors.push(err.toString());
      console.log(`[PAGE ERROR] ${err}`);
    });

    page.on('pageerror', (err) => {
      errors.push(err.toString());
      console.log(`[PAGE ERROR] ${err}`);
    });

    for (const route of ROUTES) {
      const startTime = Date.now();
      const url = `http://localhost:5173${route.path}`;

      console.log(`\nTesting: ${route.name} (${route.path})...`);

      try {
        consoleLogs.length = 0;
        errors.length = 0;

        // Navigate and wait for network idle
        await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {
          console.log('  (navigation timeout, continuing)');
        });

        const loadTime = Date.now() - startTime;

        // Check for React errors
        const reactErrors = consoleLogs.filter(log =>
          log.text.includes('React') ||
          log.text.includes('Warning') ||
          log.type === 'error'
        );

        const hasErrors = errors.length > 0 || reactErrors.length > 0;
        const status = hasErrors ? 'ERRORS' : 'OK';

        report.push({
          route: route.path,
          name: route.name,
          loadTime: `${loadTime}ms`,
          consoleErrors: reactErrors.map(e => e.text).slice(0, 2),
          crashErrors: errors.slice(0, 2),
          status,
        });

        console.log(`  ✓ Loaded in ${loadTime}ms - ${status}`);
        if (reactErrors.length > 0) {
          console.log(`  React warnings: ${reactErrors.length}`);
        }
        if (errors.length > 0) {
          console.log(`  Errors: ${errors.length}`);
        }

      } catch (err) {
        report.push({
          route: route.path,
          name: route.name,
          loadTime: 'N/A',
          consoleErrors: [],
          crashErrors: [err.message],
          status: 'CRASH',
        });
        console.log(`  ✗ CRASHED: ${err.message}`);
      }
    }

    await context.close();

    // Generate report
    const reportText = generateReport(report);
    fs.writeFileSync(reportPath, reportText);
    console.log(`\n✓ Report written to: ${reportPath}\n`);
    console.log(reportText);

    // Summary
    const crashCount = report.filter(r => r.status === 'CRASH').length;
    const errorCount = report.filter(r => r.status === 'ERRORS').length;

    if (crashCount === 0 && errorCount === 0) {
      console.log('\n✓ All routes tested successfully!');
      process.exit(0);
    } else {
      console.log(`\n✗ Found ${crashCount} crashes and ${errorCount} routes with errors`);
      process.exit(1);
    }

  } catch (err) {
    console.error('Test runner error:', err);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function generateReport(data) {
  const header = 'NAVIGATION CRASH TEST REPORT\n' +
    '============================\n\n' +
    `Generated: ${new Date().toISOString()}\n\n`;

  const table = generateTable(data);
  const summary = generateSummary(data);

  return header + table + summary;
}

function generateTable(data) {
  const cols = {
    route: 15,
    name: 20,
    time: 12,
    errors: 30,
    status: 10,
  };

  const header =
    'Route'.padEnd(cols.route) +
    'Name'.padEnd(cols.name) +
    'Load Time'.padEnd(cols.time) +
    'Errors'.padEnd(cols.errors) +
    'Status\n' +
    '-'.repeat(cols.route + cols.name + cols.time + cols.errors + cols.status) + '\n';

  const rows = data.map(r => {
    const errText = r.consoleErrors[0] || r.crashErrors[0] || '-';
    const errShort = errText.substring(0, 28);
    return (
      r.route.padEnd(cols.route) +
      r.name.padEnd(cols.name) +
      r.loadTime.padEnd(cols.time) +
      errShort.padEnd(cols.errors) +
      r.status
    );
  }).join('\n');

  return header + rows + '\n\n';
}

function generateSummary(data) {
  const total = data.length;
  const ok = data.filter(r => r.status === 'OK').length;
  const errors = data.filter(r => r.status === 'ERRORS').length;
  const crashes = data.filter(r => r.status === 'CRASH').length;

  return `SUMMARY
=======
Total Routes: ${total}
OK: ${ok}
Errors: ${errors}
Crashes: ${crashes}

${crashes > 0 ? 'Crashed routes:\n' + data.filter(r => r.status === 'CRASH').map(r => `  - ${r.name}`).join('\n') : ''}
${errors > 0 ? 'Routes with errors:\n' + data.filter(r => r.status === 'ERRORS').map(r => `  - ${r.name}`).join('\n') : ''}
`;
}

runTests();
