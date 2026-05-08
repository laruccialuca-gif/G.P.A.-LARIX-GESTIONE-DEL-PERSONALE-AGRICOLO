#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'diagnostics');

const args = parseArgs(process.argv.slice(2));
const target = args.target || 'dev';
const prepare = args.prepare || 'none';
const timeoutMs = Number(args.timeout || 120000);
const creds = {
  fullName: args.fullName || process.env.ATTENDANCE_DIAG_FULL_NAME || 'Diagnostic Admin',
  username: args.username || process.env.ATTENDANCE_DIAG_USERNAME || 'admin',
  password: args.password || process.env.ATTENDANCE_DIAG_PASSWORD || 'admin1234',
};

let viteProcess = null;
let electronApp = null;

async function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  if (prepare === 'build') {
    await runCommand(getNpmCommand(), ['run', 'build'], { cwd: ROOT });
  } else if (prepare === 'dist') {
    await runCommand(getNpmCommand(), ['run', 'dist:win:dir'], { cwd: ROOT });
  }

  if (target === 'dev') {
    viteProcess = startViteServer();
    await waitForHttp('http://127.0.0.1:5173', timeoutMs);
    const launchEnv = { ...process.env };
    delete launchEnv.ELECTRON_RUN_AS_NODE;
    electronApp = await electron.launch({
      args: ['.'],
      cwd: ROOT,
      env: launchEnv,
    });
  } else if (target === 'unpacked') {
    const executablePath = findUnpackedExecutable();
    const launchEnv = { ...process.env };
    delete launchEnv.ELECTRON_RUN_AS_NODE;
    electronApp = await electron.launch({
      executablePath,
      cwd: path.dirname(executablePath),
      args: [],
      env: launchEnv,
    });
  } else {
    throw new Error(`Unsupported target "${target}". Use "dev" or "unpacked".`);
  }

  const page = await electronApp.firstWindow();
  const consoleMessages = [];
  let currentReportBasePath = null;
  page.on('console', (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (error) => {
    consoleMessages.push(`[pageerror] ${error?.stack || error?.message || String(error)}`);
  });
  try {
    const electronProcess = electronApp.process?.();
    if (electronProcess?.stdout) {
      electronProcess.stdout.on('data', (chunk) => {
        const text = String(chunk).replace(/\r?\n$/, '');
        if (text) consoleMessages.push(`[main:stdout] ${text}`);
      });
    }
    if (electronProcess?.stderr) {
      electronProcess.stderr.on('data', (chunk) => {
        const text = String(chunk).replace(/\r?\n$/, '');
        if (text) consoleMessages.push(`[main:stderr] ${text}`);
      });
    }
  } catch {
    // ignore stdout capture failures
  }

  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.api?.auth), null, { timeout: timeoutMs });

  await bootstrapAuth(page, creds);
  await installPageDiagnostics(page);
  const openAttendanceStartedAt = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  currentReportBasePath = path.join(REPORT_DIR, `attendance-freeze-report-${stamp}`);
  await page.evaluate(() => {
    window.__attendanceDiag = {
      createdAt: new Date().toISOString(),
      counters: {},
      timings: {},
      values: {},
      events: [],
    };
    window.location.hash = '#/presenze';
  });

  try {
    await page.waitForFunction(() => {
      const heading = [...document.querySelectorAll('h1')].find((node) => node.textContent?.includes('Foglio Presenze'));
      const loading = document.body.innerText.includes('Caricamento anagrafica presenze...') ||
        document.body.innerText.includes('Caricamento presenze mese...');
      const readyCell = document.querySelector('.attendance-hours-input:not([disabled])');
      const emptyState = document.querySelector('.empty-state');
      return Boolean(heading) && !loading && (readyCell || emptyState);
    }, null, { timeout: timeoutMs });
  } catch (error) {
    await writeTimeoutDiagnostics(page, {
      reportBasePath: currentReportBasePath,
      stage: 'wait-for-attendance-ready',
      target,
      prepare,
      timeoutMs,
      consoleMessages,
      error,
    });
    throw error;
  }
  const openAttendanceMs = Date.now() - openAttendanceStartedAt;

  const inputLocator = page.locator('.attendance-hours-input:not([disabled])').first();
  await inputLocator.waitFor({ timeout: timeoutMs });
  await inputLocator.click();
  await inputLocator.press('Control+A');
  await inputLocator.press('Delete');

  // Use a value that changes each run so we never match a previously-saved
  // value (which would short-circuit queuePendingEntry and skip the flush).
  const __runDigits = String((Date.now() % 89) + 10); // 10..98
  const textToType = `${__runDigits[0]}.${__runDigits[1]}`;
  const keypressMetrics = [];
  let expectedValue = '';
  for (const ch of textToType) {
    expectedValue += ch;
    const keyStartedAt = Date.now();
    await page.keyboard.press(ch);
    await page.waitForFunction((expected) => {
      const active = document.activeElement;
      return Boolean(active && 'value' in active && active.value === expected);
    }, expectedValue, { timeout: timeoutMs });
    keypressMetrics.push({
      key: ch,
      ms: Date.now() - keyStartedAt,
    });
    await delay(25);
  }

  // Wait long enough for autosave debounce (500ms) + flushPendingChanges to complete.
  await delay(2500);

  // Second wave: append one more digit so a second pending flush fires.
  // This lets us measure the license-guard cache hit on the subsequent flush.
  const extraChar = '5';
  expectedValue += extraChar;
  await page.keyboard.press(extraChar);
  await page.waitForFunction((expected) => {
    const active = document.activeElement;
    return Boolean(active && 'value' in active && active.value === expected);
  }, expectedValue, { timeout: timeoutMs });
  await delay(2500);

  const diagSnapshot = await page.evaluate(() => ({
    attendance: window.__attendanceDiag || null,
    automation: window.__attendanceAutomation || null,
    route: window.location.hash,
  }));

  const report = buildReport({
    target,
    prepare,
    openAttendanceMs,
    keypressMetrics,
    diag: diagSnapshot.attendance,
    automation: diagSnapshot.automation,
    route: diagSnapshot.route,
    consoleMessages,
  });

  const jsonPath = `${currentReportBasePath}.json`;
  const txtPath = `${currentReportBasePath}.txt`;
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(txtPath, formatTextReport(report), 'utf8');

  console.log(`Attendance diagnostic report saved: ${jsonPath}`);
  console.log(`Attendance diagnostic summary saved: ${txtPath}`);
  console.log(report.summary.conclusion);
}

async function writeTimeoutDiagnostics(page, {
  reportBasePath,
  stage,
  target,
  prepare,
  timeoutMs,
  consoleMessages,
  error,
}) {
  const screenshotPath = `${reportBasePath}-timeout.png`;
  const txtPath = `${reportBasePath}-timeout.txt`;
  const jsonPath = `${reportBasePath}-timeout.json`;

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch {
    // ignore screenshot failures
  }

  let snapshot = null;
  try {
    snapshot = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const attendanceInput = document.querySelector('.attendance-hours-input');
      const loginUsername = document.querySelector('#login-username');
      const loginPassword = document.querySelector('#login-password');
      const headingTexts = [...document.querySelectorAll('h1, h2, h3')].map((node) => node.textContent?.trim()).filter(Boolean);
      const partialHtml = (document.body?.innerHTML || '').slice(0, 12000);
      return {
        href: window.location.href,
        hash: window.location.hash,
        title: document.title,
        headingTexts,
        bodyTextPreview: bodyText.slice(0, 4000),
        bodyHtmlPreview: partialHtml,
        hasAttendanceInput: Boolean(attendanceInput),
        hasAttendanceText: bodyText.includes('Presenze') || bodyText.includes('Foglio Presenze'),
        hasLoginScreen: Boolean(loginUsername || loginPassword) || bodyText.includes('Accedi') || bodyText.includes('Nome utente'),
        loginUsernamePresent: Boolean(loginUsername),
        loginPasswordPresent: Boolean(loginPassword),
      };
    });
  } catch (evalError) {
    snapshot = {
      href: page.url(),
      hash: '',
      title: '',
      headingTexts: [],
      bodyTextPreview: '',
      bodyHtmlPreview: '',
      hasAttendanceInput: false,
      hasAttendanceText: false,
      hasLoginScreen: false,
      evaluationError: evalError?.message || String(evalError),
    };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    stage,
    target,
    prepare,
    timeoutMs,
    error: {
      message: error?.message || String(error),
      stack: error?.stack || '',
    },
    page: snapshot,
    consoleTail: consoleMessages.slice(-100),
    screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : null,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(txtPath, formatTimeoutDiagnostics(payload), 'utf8');
}

async function bootstrapAuth(page, credentials) {
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
      await window.api.auth.login({
        username: input.username,
        password: input.password,
      });
      currentUser = await window.api.auth.getCurrentUser();
    }

    return {
      hasUsersBefore: Boolean(hasUsers),
      currentUser,
    };
  }, credentials);

  if (!session?.currentUser) {
    throw new Error('Unable to establish an authenticated session for the diagnostic run.');
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !window.location.hash.includes('/login') && !window.location.hash.includes('/setup-admin'), null, {
    timeout: 30000,
  });
}

async function installPageDiagnostics(page) {
  await page.evaluate(() => {
    window.__attendanceAutomation = {
      installedAt: new Date().toISOString(),
      longTasks: [],
      rafDrifts: [],
      routeChanges: [],
    };

    if (typeof PerformanceObserver === 'function') {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__attendanceAutomation.longTasks.push({
              name: entry.name,
              duration: Math.round(entry.duration * 100) / 100,
              startTime: Math.round(entry.startTime * 100) / 100,
            });
          }
        });
        observer.observe({ type: 'longtask', buffered: true });
      } catch {
        // no-op on unsupported environments
      }
    }

    let lastFrameAt = performance.now();
    function trackFrame() {
      const now = performance.now();
      const drift = now - lastFrameAt - 16.7;
      if (drift > 50) {
        window.__attendanceAutomation.rafDrifts.push({
          driftMs: Math.round(drift * 100) / 100,
          at: Math.round(now * 100) / 100,
        });
      }
      lastFrameAt = now;
      window.requestAnimationFrame(trackFrame);
    }
    window.requestAnimationFrame(trackFrame);

    window.addEventListener('hashchange', () => {
      window.__attendanceAutomation.routeChanges.push({
        hash: window.location.hash,
        at: new Date().toISOString(),
      });
    });
  });
}

function buildReport({ target, prepare, openAttendanceMs, keypressMetrics, diag, automation, route, consoleMessages }) {
  const timings = diag?.timings || {};
  const counters = diag?.counters || {};
  const values = diag?.values || {};
  const longTasks = automation?.longTasks || [];
  const rafDrifts = automation?.rafDrifts || [];
  const maxKeypressMs = Math.max(...keypressMetrics.map((item) => item.ms), 0);
  const avgKeypressMs = keypressMetrics.length
    ? keypressMetrics.reduce((sum, item) => sum + item.ms, 0) / keypressMetrics.length
    : 0;

  const effectCounts = Object.entries(counters)
    .filter(([name]) => name.startsWith('effect:'))
    .sort((a, b) => b[1] - a[1]);

  const suspects = [
    candidateFromTiming('save attendance IPC', timings['save attendance IPC']),
    candidateFromTiming('flushPendingChanges', timings.flushPendingChanges),
    candidateFromTiming('AttendanceTable render', timings['AttendanceTable render']),
    candidateFromTiming('AttendanceRow render', timings['AttendanceRow render']),
    candidateFromTiming('AttendanceRow equality', timings['AttendanceRow equality']),
    candidateFromTiming('attendanceRowsData useMemo', timings['attendanceRowsData useMemo']),
    candidateFromTiming('displayRows useMemo', timings['displayRows useMemo']),
    candidateFromTiming('loadAttendanceMonthData', timings.loadAttendanceMonthData),
  ].filter(Boolean).sort((a, b) => b.maxMs - a.maxMs);

  const topSuspect = suspects[0] || null;
  const worstLongTask = longTasks.reduce((worst, current) => current.duration > (worst?.duration || 0) ? current : worst, null);
  const worstRafDrift = rafDrifts.reduce((worst, current) => current.driftMs > (worst?.driftMs || 0) ? current : worst, null);

  const conclusion = topSuspect
    ? `Il freeze piu probabile avviene qui: ${topSuspect.name} chiamato ${topSuspect.count} volte, max ${round(topSuspect.maxMs)} ms, totale ${round(topSuspect.totalMs)} ms.`
    : 'Nessun sospetto dominante emerso: controlla il report completo.';

  return {
    generatedAt: new Date().toISOString(),
    target,
    prepare,
    route,
    openAttendanceMs,
    keypressMetrics,
    maxKeypressMs: round(maxKeypressMs),
    avgKeypressMs: round(avgKeypressMs),
    diag: {
      counters,
      timings,
      values,
    },
    automation: {
      longTasks,
      rafDrifts,
    },
    summary: {
      conclusion,
      topSuspect,
      worstLongTask,
      worstRafDrift,
      effectCounts,
      attendanceTableRender: summarizeTiming(timings['AttendanceTable render']),
      attendanceRowRender: summarizeTiming(timings['AttendanceRow render']),
      attendanceRowEquality: summarizeTiming(timings['AttendanceRow equality']),
      handleMainValueChangeCalls: counters.handleMainValueChange || 0,
      flushPendingChangesCalls: counters.flushPendingChanges || 0,
      bulkUpsertCalls: counters['save attendance IPC'] || 0,
      saveAttendanceIpc: summarizeTiming(timings['save attendance IPC']),
      consoleTail: consoleMessages.slice(-40),
      perfMessages: consoleMessages.filter((line) => line.includes('[attendance-perf]') || line.includes('[main:stdout]') || line.includes('[main:stderr]')),
    },
  };
}

function candidateFromTiming(name, timing) {
  if (!timing) {
    return null;
  }

  return {
    name,
    count: timing.count || 0,
    maxMs: timing.maxMs || 0,
    totalMs: timing.totalMs || 0,
  };
}

function summarizeTiming(timing) {
  if (!timing) {
    return null;
  }

  return {
    count: timing.count,
    avgMs: round(timing.totalMs / Math.max(timing.count || 1, 1)),
    maxMs: round(timing.maxMs),
    totalMs: round(timing.totalMs),
    slowCount: timing.slowCount || 0,
  };
}

function formatTextReport(report) {
  const lines = [];
  lines.push('Attendance Freeze Diagnostic');
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Target: ${report.target}`);
  lines.push(`Prepare: ${report.prepare}`);
  lines.push(`Route: ${report.route}`);
  lines.push('');
  lines.push(`Tempo apertura Presenze: ${report.openAttendanceMs} ms`);
  lines.push(`Tempo medio keypress: ${report.avgKeypressMs} ms`);
  lines.push(`Tempo massimo keypress: ${report.maxKeypressMs} ms`);
  lines.push(`AttendanceTable render: ${formatTimingLine(report.summary.attendanceTableRender)}`);
  lines.push(`AttendanceRow render: ${formatTimingLine(report.summary.attendanceRowRender)}`);
  lines.push(`AttendanceRow equality: ${formatTimingLine(report.summary.attendanceRowEquality)}`);
  lines.push(`handleMainValueChange chiamato: ${report.summary.handleMainValueChangeCalls} volte`);
  lines.push(`flushPendingChanges chiamato: ${report.summary.flushPendingChangesCalls} volte`);
  lines.push(`attendance.bulkUpsert chiamato: ${report.summary.bulkUpsertCalls} volte`);
  lines.push(`Durata IPC save: ${formatTimingLine(report.summary.saveAttendanceIpc)}`);
  lines.push('');
  lines.push(report.summary.conclusion);
  lines.push('');
  lines.push('Effect counts:');
  for (const [name, count] of report.summary.effectCounts) {
    lines.push(`- ${name}: ${count}`);
  }
  lines.push('');
  lines.push(`Worst long task: ${report.summary.worstLongTask ? `${report.summary.worstLongTask.duration} ms` : 'none'}`);
  lines.push(`Worst RAF drift: ${report.summary.worstRafDrift ? `${report.summary.worstRafDrift.driftMs} ms` : 'none'}`);
  return `${lines.join('\n')}\n`;
}

function formatTimeoutDiagnostics(payload) {
  const lines = [];
  lines.push('Attendance Freeze Diagnostic Timeout');
  lines.push(`Generated at: ${payload.generatedAt}`);
  lines.push(`Stage: ${payload.stage}`);
  lines.push(`Target: ${payload.target}`);
  lines.push(`Prepare: ${payload.prepare}`);
  lines.push(`Timeout: ${payload.timeoutMs} ms`);
  lines.push(`Error: ${payload.error.message}`);
  lines.push('');
  lines.push(`URL corrente: ${payload.page?.href || ''}`);
  lines.push(`Hash corrente: ${payload.page?.hash || ''}`);
  lines.push(`Titolo pagina: ${payload.page?.title || ''}`);
  lines.push(`Input presenze nel DOM: ${payload.page?.hasAttendanceInput ? 'si' : 'no'}`);
  lines.push(`Testo "Presenze" presente: ${payload.page?.hasAttendanceText ? 'si' : 'no'}`);
  lines.push(`Schermata login presente: ${payload.page?.hasLoginScreen ? 'si' : 'no'}`);
  lines.push(`Login username input: ${payload.page?.loginUsernamePresent ? 'si' : 'no'}`);
  lines.push(`Login password input: ${payload.page?.loginPasswordPresent ? 'si' : 'no'}`);
  lines.push(`Screenshot: ${payload.screenshotPath || 'non disponibile'}`);
  lines.push('');
  lines.push('Headings:');
  for (const text of payload.page?.headingTexts || []) {
    lines.push(`- ${text}`);
  }
  lines.push('');
  lines.push('Console tail:');
  for (const line of payload.consoleTail || []) {
    lines.push(line);
  }
  lines.push('');
  lines.push('Body text preview:');
  lines.push(payload.page?.bodyTextPreview || '');
  lines.push('');
  lines.push('Body HTML preview:');
  lines.push(payload.page?.bodyHtmlPreview || '');
  return `${lines.join('\n')}\n`;
}

function formatTimingLine(timing) {
  if (!timing) {
    return 'n/a';
  }
  return `count=${timing.count}, avg=${timing.avgMs} ms, max=${timing.maxMs} ms, total=${timing.totalMs} ms`;
}

function round(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function startViteServer() {
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  return child;
}

async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function findUnpackedExecutable() {
  const unpackedDir = path.join(ROOT, 'release', 'win-unpacked');
  const names = fs.existsSync(unpackedDir) ? fs.readdirSync(unpackedDir) : [];
  const exeName = names.find((name) => name.toLowerCase().endsWith('.exe'));
  if (!exeName) {
    throw new Error(`No unpacked executable found in ${unpackedDir}`);
  }
  return path.join(unpackedDir, exeName);
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: 'inherit',
      shell: false,
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${commandArgs.join(' ')} exited with code ${code}`));
      }
    });
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      continue;
    }
    const normalized = item.slice(2);
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex >= 0) {
      parsed[normalized.slice(0, separatorIndex)] = normalized.slice(separatorIndex + 1);
      continue;
    }
    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith('--')) {
      parsed[normalized] = 'true';
      continue;
    }
    parsed[normalized] = nextValue;
    index += 1;
  }
  return parsed;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await electronApp?.close();
    } catch {
      // ignore close failures
    }
    if (viteProcess && !viteProcess.killed) {
      viteProcess.kill();
    }
  });
