import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CRITICAL_ROUTES = [
  { path: '#/presenze', name: 'Presenze', timeout: 3000 },
  { path: '#/storico-operaio', name: 'Storico Operaio', timeout: 4000 },
  { path: '#/report', name: 'Report', timeout: 3000 },
  { path: '#/buste-paga', name: 'Buste Paga', timeout: 3000 },
];

const report = [];
let browser;
let context;
let page;

async function runProductionTests() {
  console.log('Starting production Electron app tests...\n');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const reportPath = path.join(__dirname, `production-navigation-crash-report-1.0.4-${timestamp}.txt`);

  try {
    // Connetti a Electron app via CDP
    const endpoints = await chromium.connectOverCDP('http://127.0.0.1:9222').catch(() => null);
    if (!endpoints) {
      console.error('Cannot connect to Electron app on CDP port 9222');
      console.log('App might not be running or CDP not enabled');
      process.exit(1);
    }

    browser = await chromium.connect('http://127.0.0.1:9222');
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      context = await browser.newContext();
    } else {
      context = contexts[0];
    }

    const pages = context.pages();
    if (pages.length === 0) {
      console.error('No page in context');
      process.exit(1);
    }

    page = pages[0];
    console.log(`✓ Connected to Electron app on CDP port 9222\n`);

    // Collect console messages and errors
    const consoleLogs = [];
    const pageErrors = [];

    page.on('console', (msg) => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
      });
      if (msg.type() === 'error') {
        console.log(`[ERROR CONSOLE] ${msg.text()}`);
      }
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.toString());
      console.log(`[PAGE ERROR] ${err}`);
    });

    page.on('crash', () => {
      console.log('[CRASH] Renderer process crashed!');
    });

    // Test critical routes
    for (const route of CRITICAL_ROUTES) {
      console.log(`\nTesting: ${route.name} (${route.path})...`);
      const startTime = Date.now();

      try {
        consoleLogs.length = 0;
        pageErrors.length = 0;

        // Navigate
        await page.goto(`file:///${__dirname}#${route.path}`, { waitUntil: 'networkidle', timeout: route.timeout });

        // Wait a bit more for rendering
        await page.waitForTimeout(500);

        const loadTime = Date.now() - startTime;

        // Check for freeze by trying to evaluate JS
        try {
          await page.evaluate(() => {
            return document.title;
          }).catch(() => {
            throw new Error('Page unresponsive');
          });
        } catch (err) {
          throw new Error(`Page freeze detected: ${err.message}`);
        }

        // Check for white screen
        const hasContent = await page.evaluate(() => {
          const body = document.body;
          return body && body.children.length > 0;
        });

        if (!hasContent) {
          throw new Error('White screen detected');
        }

        const hasErrors = pageErrors.length > 0;
        const status = hasErrors ? 'ERRORS' : 'OK';

        report.push({
          page: route.name,
          openTime: `${loadTime}ms`,
          consoleErrors: consoleLogs.filter(l => l.type === 'error').length,
          pageErrors: pageErrors.length,
          freeze: 'No',
          whiteScreen: 'No',
          status,
        });

        console.log(`  ✓ ${route.name} loaded in ${loadTime}ms - ${status}`);
        if (hasErrors) {
          console.log(`    Errors: ${pageErrors.length}`);
        }

      } catch (err) {
        report.push({
          page: route.name,
          openTime: 'N/A',
          consoleErrors: 0,
          pageErrors: pageErrors.length,
          freeze: err.message.includes('freeze') ? 'Yes' : 'Maybe',
          whiteScreen: err.message.includes('white') ? 'Yes' : 'No',
          status: 'CRASH',
        });
        console.log(`  ✗ ${route.name} CRASHED: ${err.message}`);
      }
    }

    // Test rapid navigation sequence
    console.log('\n\nTesting rapid navigation sequence...');
    const rapidRoutes = ['#/presenze', '#/report', '#/storico-operaio', '#/buste-paga', '#/report'];
    let rapidFailed = false;

    for (const r of rapidRoutes) {
      try {
        await page.goto(`file:///${__dirname}${r}`, { waitUntil: 'domcontentloaded', timeout: 2000 });
        await page.waitForTimeout(200);
        console.log(`  → ${r}`);
      } catch (err) {
        console.log(`  ✗ Failed at ${r}: ${err.message}`);
        rapidFailed = true;
        break;
      }
    }

    if (!rapidFailed) {
      console.log('  ✓ Rapid navigation successful');
    } else {
      console.log('  ✗ Rapid navigation failed');
    }

    // Generate report
    const reportText = generateReport(report, rapidFailed);
    fs.writeFileSync(reportPath, reportText);
    console.log(`\n✓ Report written to: ${reportPath}\n`);
    console.log(reportText);

    // Summary
    const crashCount = report.filter(r => r.status === 'CRASH').length;
    const errorCount = report.filter(r => r.status === 'ERRORS').length;

    if (crashCount === 0 && errorCount === 0 && !rapidFailed) {
      console.log('\n✓ All production tests passed!');
      process.exit(0);
    } else {
      console.log(`\n✗ Found issues: ${crashCount} crashes, ${errorCount} routes with errors`);
      if (rapidFailed) console.log('  + Rapid navigation failed');
      process.exit(1);
    }

  } catch (err) {
    console.error('Test runner error:', err);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

function generateReport(data, rapidFailed) {
  const header = 'PRODUCTION ELECTRON APP TEST REPORT\n' +
    '====================================\n\n' +
    `Generated: ${new Date().toISOString()}\n` +
    `Database: C:\\Users\\llaru\\AppData\\Roaming\\Gestionale\\data\\presenze.sqlite\n\n`;

  const table = generateTable(data);
  const summary = generateSummary(data, rapidFailed);

  return header + table + summary;
}

function generateTable(data) {
  const cols = {
    page: 18,
    time: 12,
    errors: 10,
    freeze: 10,
    status: 10,
  };

  const header =
    'Pagina'.padEnd(cols.page) +
    'Tempo'.padEnd(cols.time) +
    'Errori'.padEnd(cols.errors) +
    'Freeze'.padEnd(cols.freeze) +
    'Status\n' +
    '-'.repeat(cols.page + cols.time + cols.errors + cols.freeze + cols.status) + '\n';

  const rows = data.map(r => {
    const errCount = r.consoleErrors + r.pageErrors;
    return (
      r.page.padEnd(cols.page) +
      r.openTime.padEnd(cols.time) +
      String(errCount).padEnd(cols.errors) +
      r.freeze.padEnd(cols.freeze) +
      r.status
    );
  }).join('\n');

  return header + rows + '\n\n';
}

function generateSummary(data, rapidFailed) {
  const total = data.length;
  const ok = data.filter(r => r.status === 'OK').length;
  const errors = data.filter(r => r.status === 'ERRORS').length;
  const crashes = data.filter(r => r.status === 'CRASH').length;

  let freezeCount = 0;
  data.forEach(r => {
    if (r.freeze === 'Yes' || r.freeze === 'Maybe') freezeCount++;
  });

  return `SUMMARY
=======
Pages Tested: ${total}
OK: ${ok}
With Errors: ${errors}
Crashes: ${crashes}
Freeze Detected: ${freezeCount}
Rapid Navigation: ${rapidFailed ? 'FAILED' : 'PASSED'}

${crashes > 0 ? 'Crashed pages:\n' + data.filter(r => r.status === 'CRASH').map(r => `  - ${r.page}: ${r.status}`).join('\n') + '\n' : ''}
${freezeCount > 0 ? 'Pages with potential freeze:\n' + data.filter(r => r.freeze !== 'No').map(r => `  - ${r.page}`).join('\n') + '\n' : ''}

CONCLUSION
==========
${crashes === 0 && errors === 0 && !rapidFailed ? '✓ Production build is STABLE' : '✗ Production build has ISSUES'}
`;
}

runProductionTests();
