#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gpa-year-rollover-'));
process.env.GPA_USER_DATA_PATH = tempRoot;

const { app } = require('electron');

async function main() {
  await app.whenReady();

  const { getDb, closeDb, getDbPath } = require('../src/main/db');
  const payrollRepo = require('../src/main/payrollRepo');
  const teamPayrollRepo = require('../src/main/teamPayrollRepo');

  const db = getDb();

  try {
    const employeeId = seedEmployee(db, {
      first_name: 'Mario',
      last_name: 'Rossi',
      contract_type: 'tempo_determinato',
      status: 'attivo',
    });

    const decemberMonth = '2026-12';
    const januaryMonth = '2027-01';

    const nonPagato = createPayrollRecord(payrollRepo, employeeId, decemberMonth, {
      differenza_finale: 672.86,
      balance_status: 'non_pagato',
      partial_paid_amount: 0,
      remaining_balance: 672.86,
      balance_closed_at: null,
    });
    const januaryAfterNonPagato = payrollRepo.getPreviousBalance(employeeId, januaryMonth);
    assert.equal(januaryAfterNonPagato.previousMonth, decemberMonth);
    assert.ok(Math.abs(januaryAfterNonPagato.previousBalance - 672.86) < 0.001);

    const parziale = createPayrollRecord(payrollRepo, employeeId, decemberMonth, {
      differenza_finale: 672.86,
      balance_status: 'parziale',
      partial_paid_amount: 300,
      remaining_balance: 372.86,
      balance_closed_at: '2026-12-29',
    });
    const januaryAfterParziale = payrollRepo.getPreviousBalance(employeeId, januaryMonth);
    assert.equal(januaryAfterParziale.previousMonth, decemberMonth);
    assert.ok(Math.abs(januaryAfterParziale.previousBalance - 372.86) < 0.001);

    const saldato = createPayrollRecord(payrollRepo, employeeId, decemberMonth, {
      differenza_finale: 672.86,
      balance_status: 'saldato',
      partial_paid_amount: 672.86,
      remaining_balance: 0,
      resto_pagato: true,
      balance_closed_at: '2026-12-30',
      resto_pagato_data: '2026-12-30',
    });
    const januaryAfterSaldato = payrollRepo.getPreviousBalance(employeeId, januaryMonth);
    assert.equal(januaryAfterSaldato.previousBalance, 0);
    assert.equal(januaryAfterSaldato.paidPreviousMonth, decemberMonth);

    const teamId = seedTeam(db, 'KLEDI');
    seedTeamMember(db, teamId, employeeId);
    const decemberTeam = teamPayrollRepo.saveTeamReportRecord({
      team_id: teamId,
      month: decemberMonth,
      transport_enabled: 1,
      transport_description: 'Dicembre',
      transport_amount: 120,
      note: 'Report dicembre 2026',
      processed_at: '2026-12-31T10:00:00.000Z',
      report_snapshot_json: {
        team_id: teamId,
        month: decemberMonth,
        final_balance: 1000,
      },
    });
    const januaryTeam = teamPayrollRepo.saveTeamReportRecord({
      team_id: teamId,
      month: januaryMonth,
      transport_enabled: 0,
      transport_description: '',
      transport_amount: 0,
      note: 'Report gennaio 2027',
      processed_at: '2027-01-31T10:00:00.000Z',
      report_snapshot_json: {
        team_id: teamId,
        month: januaryMonth,
        final_balance: 800,
      },
    });

    assert.equal(teamPayrollRepo.getTeamReportRecord(teamId, decemberMonth)?.note, 'Report dicembre 2026');
    assert.equal(teamPayrollRepo.getTeamReportRecord(teamId, januaryMonth)?.note, 'Report gennaio 2027');
    assert.notEqual(decemberTeam.id, januaryTeam.id);

    const backupService = require('../src/main/backupService');
    const retentionSnapshot = backupService.BACKUP_RETENTION || null;
    assert.deepEqual(retentionSnapshot, {
      automatic: 20,
      'pre-operation': 30,
      manual: null,
    });

    const documentResult = db.prepare(`
      INSERT INTO employee_documents (
        employee_id, category, file_name, stored_name, relative_path, mime_type, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      employeeId,
      'medical_visit_attachment',
      'visita.pdf',
      'visita.pdf',
      'employees/1/visita.pdf',
      'application/pdf',
      1234
    );
    assert.ok(Number(documentResult.lastInsertRowid) > 0);
    const documentCount = db.prepare(`
      SELECT COUNT(*) AS total
      FROM employee_documents
      WHERE employee_id = ?
    `).get(employeeId);
    assert.equal(Number(documentCount?.total || 0), 1);

    const summary = {
      dbPath: getDbPath(),
      tempRoot,
      december: {
        nonPagato: januaryAfterNonPagato,
        parziale: januaryAfterParziale,
        saldato: januaryAfterSaldato,
      },
      team: {
        decemberId: decemberTeam.id,
        januaryId: januaryTeam.id,
      },
      backupRetention: retentionSnapshot,
    };

    console.log('[verify-year-rollover] OK');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    closeDb();
    await app.quit();
  }
}

function seedEmployee(db, employee) {
  const result = db.prepare(`
    INSERT INTO employees (
      first_name, last_name, contract_type, status, standard_hours, daily_pay
    ) VALUES (?, ?, ?, ?, 7, 55)
  `).run(
    employee.first_name,
    employee.last_name,
    employee.contract_type,
    employee.status
  );
  return Number(result.lastInsertRowid);
}

function seedTeam(db, name) {
  const result = db.prepare(`
    INSERT INTO teams (name, attendance_mode, team_daily_rate)
    VALUES (?, 'details', 65)
  `).run(name);
  return Number(result.lastInsertRowid);
}

function seedTeamMember(db, teamId, employeeId) {
  db.prepare(`
    INSERT INTO team_members (team_id, employee_id, sort_order)
    VALUES (?, ?, 0)
  `).run(teamId, employeeId);
}

function createPayrollRecord(payrollRepo, employeeId, month, overrides = {}) {
  const targetBalance = overrides.differenza_finale ?? 672.86;
  return payrollRepo.upsertPayrollRecord({
    employee_id: employeeId,
    month,
    datore: 'FASANO',
    giornate_effettuate: 10,
    ore_totali: 70,
    retribuzione_calcolata: targetBalance + 300,
    giornate_busta_paga: 10,
    importo_busta_paga: 200,
    acconti: 100,
    advances: [{ amount: 100, date: `${month}-15`, includeInReport: true }],
    importedFinancialMovementIds: [],
    resto_precedente: 0,
    differenza_finale: targetBalance,
    n_macchine_mese: 0,
    prezzo_per_macchina: 0,
    totale_trasporto: 0,
    regalo_importo: 0,
    regalo_descrizione: null,
    is_pagato: false,
    payroll_payment_status: 'non_pagato',
    payroll_payment_method: 'bonifico',
    payroll_payment_date: null,
    resto_pagato: overrides.resto_pagato ? 1 : 0,
    resto_pagato_data: overrides.resto_pagato_data || null,
    balance_status: overrides.balance_status || 'non_pagato',
    partial_paid_amount: overrides.partial_paid_amount ?? 0,
    remaining_balance: overrides.remaining_balance ?? targetBalance,
    balance_closed_at: overrides.balance_closed_at || null,
    balance_notes: overrides.balance_notes || null,
    processed_at: `${month}-28T10:00:00.000Z`,
    report_html_snapshot: null,
    report_snapshot_json: {
      month,
      balance_status: overrides.balance_status || 'non_pagato',
      partial_paid_amount: overrides.partial_paid_amount ?? 0,
      remaining_balance: overrides.remaining_balance ?? targetBalance,
    },
    debt_plans: [],
    note: null,
  });
}

main().catch(async (error) => {
  console.error('[verify-year-rollover] FAILED');
  console.error(error);
  try {
    const { closeDb } = require('../src/main/db');
    closeDb();
  } catch {}
  try {
    await app.quit();
  } catch {}
  process.exit(1);
});
