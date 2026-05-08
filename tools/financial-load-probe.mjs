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
const TIMEOUT_MS = 60000;

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

async function main() {
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
  const electronProcess = electronApp.process?.();
  if (electronProcess?.stdout) {
    electronProcess.stdout.on('data', (chunk) => {
      const text = String(chunk).replace(/\r?\n$/, '');
      if (text) messages.push(`[main:stdout] ${text}`);
    });
  }
  if (electronProcess?.stderr) {
    electronProcess.stderr.on('data', (chunk) => {
      const text = String(chunk).replace(/\r?\n$/, '');
      if (text) messages.push(`[main:stderr] ${text}`);
    });
  }

  const page = await electronApp.firstWindow();
  page.on('console', (msg) => {
    messages.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    messages.push(`[pageerror] ${err?.stack || err?.message || String(err)}`);
  });

  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.api?.auth), null, { timeout: TIMEOUT_MS });

  // Auth
  const session = await page.evaluate(async (input) => {
    const hasUsers = await window.api.auth.hasUsers();
    if (!hasUsers) {
      await window.api.auth.createFirstAdmin({ fullName: input.fullName, username: input.username, password: input.password });
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

  // Navigate to Acconti e Rate
  const navStartedAt = Date.now();
  await page.evaluate(() => { window.location.hash = '#/acconti-rate'; });

  // Wait for heading and for the loading state to be over.
  // Loading is over when the "Caricamento..." hint disappears (count text replaces it).
  await page.waitForFunction(() => {
    const heading = [...document.querySelectorAll('h1')].find((node) => node.textContent?.trim() === 'Acconti e Rate');
    if (!heading) return false;
    const bodyText = document.body.innerText || '';
    return !bodyText.includes('Caricamento...');
  }, null, { timeout: TIMEOUT_MS });
  const navDoneAt = Date.now();
  const navMs = navDoneAt - navStartedAt;

  // Let any tail logs flush
  await delay(500);

  await electronApp.close();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(REPORT_DIR, `financial-load-probe-${stamp}.txt`);
  const relevantTags = [
    '[employee-repo-perf] listBasic:',
    '[page-perf] financial:',
    '[main:stdout] [employee-repo-perf]',
    'employees:listBasic:start',
    'employees:listBasic:end',
  ];
  const filtered = messages.filter((line) => relevantTags.some((tag) => line.includes(tag)));

  const summary = [
    'Acconti e Rate load probe',
    `generated_at: ${new Date().toISOString()}`,
    `nav_to_ready_ms: ${navMs}`,
    '',
    '--- relevant log lines ---',
    ...filtered,
    '',
    `--- total messages captured: ${messages.length} ---`,
  ].join('\n');

  fs.writeFileSync(reportPath, summary, 'utf8');
  console.log(`Probe report: ${reportPath}`);
  console.log(`nav_to_ready_ms = ${navMs}`);
  for (const line of filtered) console.log(line);
}

main().catch((err) => {
  console.error('Probe failed:', err?.stack || err?.message || err);
  process.exit(1);
});
