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
const POST_NAV_IDLE_MS = 350;

const ROUTES = [
  { route: '#/dipendenti', page: 'Dipendenti', heading: 'Dipendenti e Squadre' },
  { route: '#/presenze', page: 'Presenze', heading: 'Foglio Presenze' },
  { route: '#/report', page: 'Report', heading: 'Report' },
  { route: '#/storico-operaio', page: 'Storico', heading: 'Storico Operaio' },
  { route: '#/buste-paga', page: 'Buste paga', heading: 'Buste paga' },
  { route: '#/comunicazione', page: 'Comunicazione', heading: 'Comunicazione' },
  { route: '#/dpi', page: 'DPI', heading: 'DPI' },
  { route: '#/impostazioni', page: 'Impostazioni', heading: 'Impostazioni' },
  { route: '#/', page: 'Dashboard', heading: 'Dashboard' },
];

const PERF_LOG_TAGS = [
  '[page-perf]',
  '[employee-repo-perf]',
  '[attendance-perf]',
  '[storico-perf]',
  '[buste-perf]',
  '[documents-perf]',
];

const NAV_PERF_RX = /\[nav-perf\]\s+route=([^\s]+)\s+loadMs=(\d+)/;

function findUnpackedExecutable() {
  const dir = path.join(ROOT, 'release', 'win-unpacked');
  if (!fs.existsSync(dir)) {
    throw new Error(`Unpacked directory not found: ${dir}`);
  }
  const exe = fs.readdirSync(dir).find((name) => name.toLowerCase().endsWith('.exe'));
  if (!exe) {
    throw new Error(`No .exe found in ${dir}`);
  }
  return path.join(dir, exe);
}

function parseArgs() {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((arg) => arg.startsWith('--'))
      .map((arg) => {
        const [key, value = ''] = arg.slice(2).split('=');
        return [key, value];
      }),
  );
  return {
    userDataPath: args['user-data-path'] || process.env.GPA_USER_DATA_PATH || '',
    supportPassword: args['support-password'] || process.env.NAV_PROBE_SUPPORT_PASSWORD || 'probe1234',
  };
}

function isPerfLine(line) {
  return PERF_LOG_TAGS.some((tag) => line.includes(tag));
}

function findNavPerf(messages, fromIndex, routePathname) {
  for (let index = fromIndex; index < messages.length; index += 1) {
    const line = messages[index];
    const match = line.match(NAV_PERF_RX);
    if (!match) continue;
    if (match[1] === routePathname) {
      return {
        index,
        line,
        loadMs: Number(match[2]),
      };
    }
  }
  return null;
}

function extractSlowPerf(messages, fromIndex, toIndex) {
  let max = null;
  const durationRegexes = [
    /duration_ms:\s*([0-9]+(?:\.[0-9]+)?)/g,
    /duration_ms['"]?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/g,
    /([0-9]+(?:\.[0-9]+)?)ms/g,
  ];

  for (let index = fromIndex; index < toIndex && index < messages.length; index += 1) {
    const line = messages[index];
    if (!isPerfLine(line)) continue;
    let lineMax = 0;
    for (const regex of durationRegexes) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(line))) {
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > lineMax) {
          lineMax = value;
        }
      }
    }
    if (lineMax > 0 && (!max || lineMax > max.ms)) {
      max = { ms: lineMax, line };
    }
  }

  return max;
}

async function loginAsSupport(page, supportPassword) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.api?.auth), null, { timeout: TIMEOUT_MS });

  const result = await page.evaluate(async ({ password }) => {
    const currentUser = await window.api.auth.getCurrentUser();
    if (currentUser) {
      return { mode: 'existing-session', currentUser };
    }

    const hints = await window.api.auth.getLoginHints();
    if (hints?.super_admin_enabled) {
      await window.api.auth.loginSuperAdmin(password);
      return { mode: 'super-admin', currentUser: await window.api.auth.getCurrentUser() };
    }

    const hasUsers = await window.api.auth.hasUsers();
    if (!hasUsers) {
      await window.api.auth.createFirstAdmin({
        fullName: 'Diagnostic Admin',
        username: 'admin',
        password: 'admin1234',
      });
      return { mode: 'first-admin', currentUser: await window.api.auth.getCurrentUser() };
    }

    return { mode: 'no-supported-login', currentUser: null };
  }, { password: supportPassword });

  if (!result?.currentUser) {
    throw new Error(`Login failed (${result?.mode || 'unknown'})`);
  }
}

async function main() {
  const { userDataPath, supportPassword } = parseArgs();
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const executablePath = findUnpackedExecutable();
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  if (userDataPath) {
    launchEnv.GPA_USER_DATA_PATH = userDataPath;
  }

  const electronApp = await electron.launch({
    executablePath,
    cwd: path.dirname(executablePath),
    args: [],
    env: launchEnv,
  });

  const messages = [];
  const pushMessage = (line) => {
    const text = String(line || '').trim();
    if (text) messages.push(text);
  };

  const electronProcess = electronApp.process?.();
  if (electronProcess?.stdout) {
    electronProcess.stdout.on('data', (chunk) => {
      String(chunk).split(/\r?\n/).forEach((line) => pushMessage(`[main:stdout] ${line}`));
    });
  }
  if (electronProcess?.stderr) {
    electronProcess.stderr.on('data', (chunk) => {
      String(chunk).split(/\r?\n/).forEach((line) => pushMessage(`[main:stderr] ${line}`));
    });
  }

  const page = await electronApp.firstWindow();
  page.on('console', (msg) => pushMessage(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => pushMessage(`[pageerror] ${err?.stack || err?.message || String(err)}`));

  await loginAsSupport(page, supportPassword);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !window.location.hash.includes('/login') && !window.location.hash.includes('/setup-admin'),
    null,
    { timeout: TIMEOUT_MS },
  );

  const results = [];

  for (const target of ROUTES) {
    const fromIndex = messages.length;
    let status = 'OK';
    let error = null;

    try {
      await page.evaluate((route) => {
        window.location.hash = route;
      }, target.route);

      await page.waitForFunction((heading) => {
        return Boolean(
          [...document.querySelectorAll('h1, h2')].find((node) => node.textContent?.trim().includes(heading)),
        );
      }, target.heading, { timeout: TIMEOUT_MS });

      const routePathname = target.route.replace(/^#/, '') || '/';
      const deadline = Date.now() + TIMEOUT_MS;
      let navPerf = null;
      while (Date.now() < deadline) {
        navPerf = findNavPerf(messages, fromIndex, routePathname);
        if (navPerf) break;
        await delay(50);
      }

      if (!navPerf) {
        throw new Error(`Missing nav-perf log for ${routePathname}`);
      }

      await delay(POST_NAV_IDLE_MS);
      const slowest = extractSlowPerf(messages, fromIndex, messages.length);
      results.push({
        page: target.page,
        route: routePathname,
        loadMs: navPerf.loadMs,
        status: navPerf.loadMs <= 1000 ? 'OK' : 'DA OTTIMIZZARE',
        slowestPerfMs: slowest?.ms ?? null,
        slowestPerfLine: slowest?.line ?? null,
      });
    } catch (err) {
      status = 'ERROR';
      error = err?.stack || err?.message || String(err);
      results.push({
        page: target.page,
        route: target.route.replace(/^#/, '') || '/',
        loadMs: null,
        status: 'DA OTTIMIZZARE',
        slowestPerfMs: null,
        slowestPerfLine: null,
        error,
      });
    }
  }

  await electronApp.close();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = path.join(REPORT_DIR, `nav-perf-unpacked-${stamp}`);
  fs.writeFileSync(`${baseName}.json`, JSON.stringify({
    generatedAt: new Date().toISOString(),
    userDataPath: userDataPath || null,
    results,
    messages,
  }, null, 2), 'utf8');
  fs.writeFileSync(`${baseName}.log`, messages.join('\n'), 'utf8');

  console.table(results.map((item) => ({
    Pagina: item.page,
    Route: item.route,
    TempoMs: item.loadMs,
    Stato: item.status,
  })));

  console.log(`JSON: ${baseName}.json`);
  console.log(`LOG: ${baseName}.log`);
}

main().catch((error) => {
  console.error('nav-perf-unpacked failed:', error?.stack || error?.message || error);
  process.exit(1);
});
