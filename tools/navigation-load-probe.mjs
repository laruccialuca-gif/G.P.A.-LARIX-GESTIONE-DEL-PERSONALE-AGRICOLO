#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'diagnostics');
const TIMEOUT_MS = 30000;
const HEADING_TIMEOUT_MS = 15000;
const READY_SIGNAL_TIMEOUT_MS = 15000;
const POST_READY_IDLE_MS = 250;

const ROUTES = [
  { route: '#/',                page: 'Dashboard',           heading: 'Dashboard' },
  { route: '#/dipendenti',      page: 'Dipendenti e Squadre', heading: 'Dipendenti e Squadre',
    readySignal: 'employees:loadBaseData:end' },
  { route: '#/presenze',        page: 'Foglio Presenze',     heading: 'Foglio Presenze',
    readySignal: 'page:render-table:ready' },
  { route: '#/acconti-rate',    page: 'Acconti e Rate',      heading: 'Acconti e Rate',
    readySignal: 'financial:loadBaseData:end' },
  { route: '#/report',          page: 'Report',              heading: 'Report',
    readySignal: 'report:loadBaseData:end' },
  { route: '#/storico-operaio', page: 'Storico Operaio',     heading: 'Storico Operaio' },
  { route: '#/buste-paga',      page: 'Buste paga',          heading: 'Buste paga',
    readySignal: 'payroll:loadBaseData:end' },
  { route: '#/comunicazione',   page: 'Comunicazione',       heading: 'Comunicazione',
    readySignal: 'communication:loadBaseData:end' },
  { route: '#/operai-assunti',  page: 'Operai Assunti',      heading: 'Operai Assunti',
    readySignal: 'hired-workers:loadBaseData:end' },
  { route: '#/impostazioni',    page: 'Impostazioni',        heading: 'Impostazioni' },
  { route: '#/utenti',          page: 'Utenti e Permessi',   heading: 'Utenti e Permessi' },
];

const creds = {
  fullName: process.env.ATTENDANCE_DIAG_FULL_NAME || 'Diagnostic Admin',
  username: process.env.ATTENDANCE_DIAG_USERNAME || 'admin',
  password: process.env.ATTENDANCE_DIAG_PASSWORD || 'admin1234',
};

function findUnpackedExecutable() {
  const dir = path.join(ROOT, 'release', 'win-unpacked');
  if (!fs.existsSync(dir)) {
    throw new Error(`Unpacked directory not found: ${dir}`);
  }
  const exe = fs.readdirSync(dir).find((name) => name.toLowerCase().endsWith('.exe'));
  if (!exe) throw new Error(`No .exe found in ${dir}`);
  return path.join(dir, exe);
}

const PERF_LINE_RX = /\[(page-perf|employee-repo-perf|attendance-perf|attendance-perf\]\[main|license-perf)\]/;
const DURATION_RX = /(?:duration_ms|ms|totalMs|totalFlushMs|ipcCallMs|backupMs|sqliteTxMs|licenseMs)['"]?\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;

function findSlowestPerfLog(messages, fromIdx, toIdx) {
  let max = null;
  for (let i = fromIdx; i < toIdx && i < messages.length; i += 1) {
    const line = messages[i];
    if (!PERF_LINE_RX.test(line)) continue;
    DURATION_RX.lastIndex = 0;
    let m;
    let lineMax = 0;
    while ((m = DURATION_RX.exec(line))) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v > lineMax) lineMax = v;
    }
    if (lineMax > 0 && (!max || lineMax > max.ms)) {
      max = { ms: lineMax, line };
    }
  }
  return max;
}

async function runProbe() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const executablePath = findUnpackedExecutable();
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  const electronApp = await electron.launch({
    executablePath,
    cwd: path.dirname(executablePath),
    args: [],
    env: launchEnv,
  });

  const messages = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportBase = path.join(REPORT_DIR, `navigation-load-report-${stamp}`);

  function pushMsg(line) {
    messages.push(line);
  }

  const electronProcess = electronApp.process?.();
  if (electronProcess?.stdout) {
    electronProcess.stdout.on('data', (chunk) => {
      const text = String(chunk).replace(/\r?\n$/, '');
      if (text) pushMsg(`[main:stdout] ${text}`);
    });
  }
  if (electronProcess?.stderr) {
    electronProcess.stderr.on('data', (chunk) => {
      const text = String(chunk).replace(/\r?\n$/, '');
      if (text) pushMsg(`[main:stderr] ${text}`);
    });
  }

  const page = await electronApp.firstWindow();
  page.on('console', (msg) => {
    pushMsg(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    pushMsg(`[pageerror] ${err?.stack || err?.message || String(err)}`);
  });

  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.api?.auth), null, { timeout: TIMEOUT_MS });

  // Auth
  const session = await page.evaluate(async (input) => {
    const hasUsers = await window.api.auth.hasUsers();
    if (!hasUsers) {
      await window.api.auth.createFirstAdmin({
        fullName: input.fullName,
        username: input.username,
        password: input.password,
      });
    }
    let currentUser = await window.api.auth.getCurrentUser();
    if (!currentUser) {
      await window.api.auth.login({ username: input.username, password: input.password });
      currentUser = await window.api.auth.getCurrentUser();
    }
    return { currentUser };
  }, creds);
  if (!session?.currentUser) {
    throw new Error('Login failed');
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !window.location.hash.includes('/login') && !window.location.hash.includes('/setup-admin'), null, { timeout: TIMEOUT_MS });
  await page.waitForFunction(() => Boolean(window.api?.employees?.listBasic), null, { timeout: TIMEOUT_MS });

  const results = [];

  for (const target of ROUTES) {
    const fromIdx = messages.length;
    const navStartedAt = Date.now();
    let status = 'OK';
    let error = null;
    let headingVisibleAt = null;
    let readyAt = null;
    let screenshotPath = null;

    try {
      await page.evaluate((route) => { window.location.hash = route; }, target.route);

      // Wait for heading
      try {
        await page.waitForFunction((heading) => {
          return Boolean([...document.querySelectorAll('h1, h2')].find((node) => node.textContent?.trim() === heading));
        }, target.heading, { timeout: HEADING_TIMEOUT_MS });
        headingVisibleAt = Date.now();
      } catch (err) {
        status = 'TIMEOUT';
        error = `heading-not-found: ${err?.message || String(err)}`;
        screenshotPath = `${reportBase}-${target.route.replace(/[^a-z0-9]+/gi, '_')}-timeout.png`;
        try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch {}
      }

      // Wait for ready signal if defined
      if (status === 'OK' && target.readySignal) {
        const deadline = Date.now() + READY_SIGNAL_TIMEOUT_MS;
        let found = false;
        while (Date.now() < deadline) {
          if (messages.slice(fromIdx).some((line) => line.includes(target.readySignal))) { found = true; break; }
          await delay(50);
        }
        if (!found) {
          status = 'TIMEOUT';
          error = `ready-signal-missing: "${target.readySignal}"`;
          screenshotPath = `${reportBase}-${target.route.replace(/[^a-z0-9]+/gi, '_')}-timeout.png`;
          try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch {}
        }
      }

      // Brief idle to let async loaders flush their logs
      if (status === 'OK') {
        await delay(POST_READY_IDLE_MS);
        readyAt = Date.now();
      }
    } catch (err) {
      status = 'ERROR';
      error = err?.stack || err?.message || String(err);
      screenshotPath = `${reportBase}-${target.route.replace(/[^a-z0-9]+/gi, '_')}-error.png`;
      try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch {}
    }

    const toIdx = messages.length;
    const navMs = (readyAt || headingVisibleAt || Date.now()) - navStartedAt;
    const slowest = findSlowestPerfLog(messages, fromIdx, toIdx);

    results.push({
      route: target.route,
      page: target.page,
      nav_start_at: new Date(navStartedAt).toISOString(),
      heading_visible_ms: headingVisibleAt ? headingVisibleAt - navStartedAt : null,
      ready_signal: target.readySignal || null,
      ready_signal_seen: target.readySignal ? messages.slice(fromIdx, toIdx).some((line) => line.includes(target.readySignal)) : null,
      nav_to_ready_ms: navMs,
      status,
      error,
      slowest_perf_log_ms: slowest?.ms ?? null,
      slowest_perf_log_line: slowest?.line ?? null,
      screenshot: screenshotPath && fs.existsSync(screenshotPath) ? screenshotPath : null,
      relevant_log_count: messages.slice(fromIdx, toIdx).filter((line) => PERF_LINE_RX.test(line)).length,
    });

    // Small gap before next nav so leftover logs don't bleed into the next bucket
    await delay(150);
  }

  await electronApp.close();

  const report = {
    generated_at: new Date().toISOString(),
    total_messages: messages.length,
    results,
  };
  fs.writeFileSync(`${reportBase}.json`, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(`${reportBase}-full.log`, messages.join('\n'), 'utf8');

  // Build text table
  const TARGET_MS = 1000;
  const rows = [
    ['route', 'page', 'nav_to_ready_ms', 'status', 'slowest_perf_ms', 'slowest_log_excerpt'],
    ...results.map((r) => [
      r.route,
      r.page,
      String(r.nav_to_ready_ms),
      r.status,
      r.slowest_perf_log_ms != null ? String(Math.round(r.slowest_perf_log_ms)) : '-',
      (r.slowest_perf_log_line || '').replace(/\s+/g, ' ').slice(0, 120),
    ]),
  ];
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => String(r[col]).length)));
  const lines = rows.map((r) => r.map((cell, col) => String(cell).padEnd(widths[col])).join('  '));
  const summary = [
    `Navigation load probe — generated ${report.generated_at}`,
    `Target per page: < ${TARGET_MS} ms`,
    '',
    ...lines,
    '',
    `Total console messages captured: ${messages.length}`,
    `Full log: ${path.basename(reportBase)}-full.log`,
    `JSON: ${path.basename(reportBase)}.json`,
  ].join('\n');
  fs.writeFileSync(`${reportBase}.txt`, summary, 'utf8');

  console.log(summary);
  console.log(`Report: ${reportBase}.txt`);
}

runProbe().catch((err) => {
  console.error('Probe failed:', err?.stack || err?.message || err);
  process.exit(1);
});
