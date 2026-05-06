const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { getDb, closeDb } = require('./db');
const { getConfigDir, getDataDir, getDocumentsDir, getBackupsDir, getUpdatesDir } = require('./storagePaths');
const { isDemoVariant } = require('./runtimeContext');
const settingsService = require('./settingsService');

const DEMO_META_KEY = 'demo_seed_version';
const DEMO_SEED_VERSION = '2026-04-20-demo-v1';
const DEMO_STATE_FILE = 'demo-state.json';

function getDemoStatePath() {
  return path.join(getConfigDir(), DEMO_STATE_FILE);
}

function readDemoState() {
  if (!fs.existsSync(getDemoStatePath())) {
    return { welcome_seen: false, reset_count: 0 };
  }

  try {
    return JSON.parse(fs.readFileSync(getDemoStatePath(), 'utf8'));
  } catch {
    return { welcome_seen: false, reset_count: 0 };
  }
}

function writeDemoState(state) {
  fs.mkdirSync(path.dirname(getDemoStatePath()), { recursive: true });
  fs.writeFileSync(
    getDemoStatePath(),
    JSON.stringify(
      {
        welcome_seen: !!state.welcome_seen,
        reset_count: Number(state.reset_count || 0),
      },
      null,
      2
    ),
    'utf8'
  );
}

function getDemoRuntimeInfo() {
  const state = readDemoState();
  return {
    is_demo: isDemoVariant(),
    seed_version: DEMO_SEED_VERSION,
    welcome_seen: !!state.welcome_seen,
    reset_count: Number(state.reset_count || 0),
  };
}

function markDemoWelcomeSeen() {
  const current = readDemoState();
  writeDemoState({
    ...current,
    welcome_seen: true,
  });
  return getDemoRuntimeInfo();
}

function ensureDemoSettings() {
  const current = settingsService.readSettings();
  settingsService.writeSettings({
    ...current,
    company: {
      ...current.company,
      name: current.company?.name || 'GPA 1.0.0 Demo',
      document_header: current.company?.document_header || 'GPA 1.0.0 Demo',
      email: current.company?.email || 'demo@cabronlab.local',
      contacts: current.company?.contacts || 'Versione demo con dati di esempio',
    },
  });
}

function createReportSnapshotHtml({
  fullName,
  month,
  datore,
  compensation,
  payrollAmount,
  previousBalance,
  diff,
}) {
  return `
    <div class="print-area" style="font-family: Arial, sans-serif; color: #111827; padding: 18px;">
      <div style="font-size: 24px; font-weight: 800; margin-bottom: 8px;">Report Demo</div>
      <div style="font-size: 14px; margin-bottom: 18px;">${fullName} · ${month} · ${datore}</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr><td style="padding: 8px; border: 1px solid #d1d5db;">Compenso</td><td style="padding: 8px; border: 1px solid #d1d5db;">€ ${Number(compensation).toFixed(2)}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #d1d5db;">Busta paga</td><td style="padding: 8px; border: 1px solid #d1d5db;">€ ${Number(payrollAmount).toFixed(2)}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #d1d5db;">Resto precedente</td><td style="padding: 8px; border: 1px solid #d1d5db;">€ ${Number(previousBalance).toFixed(2)}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #d1d5db; font-weight: 700;">Saldo finale</td><td style="padding: 8px; border: 1px solid #d1d5db; font-weight: 700;">€ ${Math.abs(Number(diff)).toFixed(2)}</td></tr>
      </table>
    </div>
  `;
}

function seedDemoData() {
  const db = getDb();
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM payroll_documents;
      DELETE FROM employee_documents;
      DELETE FROM payroll_advances;
      DELETE FROM payroll_debt_installments;
      DELETE FROM payroll_debt_plans;
      DELETE FROM communication_details;
      DELETE FROM communications;
      DELETE FROM attendance;
      DELETE FROM team_members;
      DELETE FROM teams;
      DELETE FROM employee_employment_periods;
      DELETE FROM payroll_records;
      DELETE FROM employees;
    `);

    const insertEmployee = db.prepare(`
      INSERT INTO employees (
        first_name, last_name, fiscal_code, role, contract_type, daily_pay, standard_hours,
        phone, email, hire_date, hire_date_from, hired_by, status,
        medical_visit_required, medical_visit_done, medical_visit_done_with_us, medical_visit_date, medical_visit_expiry,
        art37_required, art37_done, art37_done_with_us, art37_date, art37_expiry, notes
      ) VALUES (
        @first_name, @last_name, @fiscal_code, @role, @contract_type, @daily_pay, @standard_hours,
        @phone, @email, @hire_date, @hire_date_from, @hired_by, @status,
        1, 1, 1, @medical_visit_date, @medical_visit_expiry,
        1, 1, 1, @art37_date, @art37_expiry, @notes
      )
    `);

    const employees = [
      {
        first_name: 'Mario',
        last_name: 'Rossi',
        fiscal_code: 'RSSMRA80A01H501A',
        role: 'operaio semplice',
        contract_type: 'Tempo determinato',
        daily_pay: 60,
        standard_hours: 7,
        phone: '3331111111',
        email: 'mario.rossi@example.demo',
        hire_date: '2026-01-10',
        hire_date_from: '2026-01-10',
        hired_by: 'LC',
        status: 'attivo',
        medical_visit_date: '2026-01-05',
        medical_visit_expiry: '2027-01-05',
        art37_date: '2026-01-08',
        art37_expiry: '2027-01-08',
        notes: 'Profilo demo con storico completo',
      },
      {
        first_name: 'Luca',
        last_name: 'Bianchi',
        fiscal_code: 'BNCLCU85B12H501B',
        role: 'potatore',
        contract_type: 'Tempo determinato',
        daily_pay: 72,
        standard_hours: 7,
        phone: '3332222222',
        email: 'luca.bianchi@example.demo',
        hire_date: '2026-01-12',
        hire_date_from: '2026-01-12',
        hired_by: 'LG',
        status: 'attivo',
        medical_visit_date: '2026-01-06',
        medical_visit_expiry: '2027-01-06',
        art37_date: '2026-01-09',
        art37_expiry: '2027-01-09',
        notes: 'Profilo demo con debito rateizzato',
      },
      {
        first_name: 'Giuseppe',
        last_name: 'Verdi',
        fiscal_code: 'VRDGPP79C18H501C',
        role: 'trattorista',
        contract_type: 'Tempo determinato',
        daily_pay: 78,
        standard_hours: 7,
        phone: '3333333333',
        email: 'giuseppe.verdi@example.demo',
        hire_date: '2026-02-01',
        hire_date_from: '2026-02-01',
        hired_by: 'LC',
        status: 'inattivo',
        medical_visit_date: '2026-02-01',
        medical_visit_expiry: '2027-02-01',
        art37_date: '2026-02-02',
        art37_expiry: '2027-02-02',
        notes: 'Profilo demo inattivo',
      },
    ];

    const employeeIds = employees.map((employee) => Number(insertEmployee.run(employee).lastInsertRowid));

    const insertPeriod = db.prepare(`
      INSERT INTO employee_employment_periods (
        employee_id, hire_date_from, hired_by, status, is_current
      ) VALUES (?, ?, ?, ?, 1)
    `);
    insertPeriod.run(employeeIds[0], '2026-01-10', 'LC', 'attivo');
    insertPeriod.run(employeeIds[1], '2026-01-12', 'LG', 'attivo');
    insertPeriod.run(employeeIds[2], '2026-02-01', 'LC', 'inattivo');

    const teamId = Number(
      db.prepare(`INSERT INTO teams (name, notes) VALUES (?, ?)`).run(
        'Squadra Raccolta Demo',
        'Squadra di esempio pronta per consultazione demo'
      ).lastInsertRowid
    );
    const insertTeamMember = db.prepare(`
      INSERT INTO team_members (team_id, employee_id, compensation, manage_by_days, sort_order, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertTeamMember.run(teamId, employeeIds[0], 60, 1, 0, 'Caposquadra demo');
    insertTeamMember.run(teamId, employeeIds[1], 72, 1, 1, 'Operaio specializzato demo');

    const marchDates = Array.from({ length: 31 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return `2026-03-${day}`;
    });

    const insertAttendance = db.prepare(`
      INSERT INTO attendance (employee_id, date, status, marker_code, hours_worked, overtime_hours, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    marchDates.forEach((date, index) => {
      const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
      if (dayOfWeek !== 0) {
        insertAttendance.run(employeeIds[0], date, 'presente', index % 5 === 0 ? 'p' : null, 7, 0, null);
        insertAttendance.run(employeeIds[1], date, 'presente', index % 4 === 0 ? 'c' : null, 7, 1, null);
      }
    });

    insertAttendance.run(employeeIds[2], '2026-03-10', 'malattia', null, 0, 0, 'Assenza demo');
    insertAttendance.run(employeeIds[2], '2026-03-11', 'permesso', null, 0, 0, 'Permesso demo');

    const insertPayroll = db.prepare(`
      INSERT INTO payroll_records (
        employee_id, month, datore, giornate_effettuate, ore_totali, retribuzione_calcolata,
        giornate_busta_paga, importo_busta_paga, acconti, acconti_details, resto_precedente,
        differenza_finale, n_macchine_mese, prezzo_per_macchina, totale_trasporto,
        regalo_importo, regalo_descrizione, is_pagato, resto_pagato, resto_pagato_data,
        processed_at, report_html_snapshot, report_snapshot_json, note
      ) VALUES (
        @employee_id, @month, @datore, @giornate_effettuate, @ore_totali, @retribuzione_calcolata,
        @giornate_busta_paga, @importo_busta_paga, @acconti, @acconti_details, @resto_precedente,
        @differenza_finale, @n_macchine_mese, @prezzo_per_macchina, @totale_trasporto,
        @regalo_importo, @regalo_descrizione, @is_pagato, @resto_pagato, @resto_pagato_data,
        @processed_at, @report_html_snapshot, @report_snapshot_json, @note
      )
    `);

    const payrollRows = [
      {
        employee_id: employeeIds[0],
        month: '2026-02',
        datore: 'LC',
        giornate_effettuate: 22,
        ore_totali: 154,
        retribuzione_calcolata: 1320,
        giornate_busta_paga: 22,
        importo_busta_paga: 1200,
        acconti: 100,
        acconti_details: JSON.stringify([{ amount: 100, date: '2026-02-15', includeInReport: true }]),
        resto_precedente: 0,
        differenza_finale: 20,
        n_macchine_mese: 4,
        prezzo_per_macchina: 15,
        totale_trasporto: 60,
        regalo_importo: 0,
        regalo_descrizione: null,
        is_pagato: 1,
        resto_pagato: 0,
        resto_pagato_data: null,
        processed_at: '2026-02-28T16:30:00.000Z',
        report_html_snapshot: createReportSnapshotHtml({
          fullName: 'Mario Rossi',
          month: 'Febbraio 2026',
          datore: 'LC',
          compensation: 1320,
          payrollAmount: 1200,
          previousBalance: 0,
          diff: 80,
        }),
        report_snapshot_json: JSON.stringify({
          employee_name: 'Mario Rossi',
          current_installments_total: 0,
        }),
        note: 'Saldo demo da riportare al mese successivo',
      },
      {
        employee_id: employeeIds[1],
        month: '2026-03',
        datore: 'LG',
        giornate_effettuate: 24,
        ore_totali: 176,
        retribuzione_calcolata: 1728,
        giornate_busta_paga: 24,
        importo_busta_paga: 1500,
        acconti: 150,
        acconti_details: JSON.stringify([
          { amount: 100, date: '2026-03-08', includeInReport: true },
          { amount: 50, date: '2026-03-18', includeInReport: true },
        ]),
        resto_precedente: 0,
        differenza_finale: 128,
        n_macchine_mese: 0,
        prezzo_per_macchina: 0,
        totale_trasporto: 0,
        regalo_importo: 0,
        regalo_descrizione: null,
        is_pagato: 0,
        resto_pagato: 0,
        resto_pagato_data: null,
        processed_at: '2026-03-31T17:10:00.000Z',
        report_html_snapshot: createReportSnapshotHtml({
          fullName: 'Luca Bianchi',
          month: 'Marzo 2026',
          datore: 'LG',
          compensation: 1728,
          payrollAmount: 1500,
          previousBalance: 0,
          diff: 78,
        }),
        report_snapshot_json: JSON.stringify({
          employee_name: 'Luca Bianchi',
          current_installments_total: 0,
        }),
        note: 'Report demo con rateizzazione debito',
      },
    ];

    const payrollIds = payrollRows.map((row) => Number(insertPayroll.run(row).lastInsertRowid));

    const insertAdvance = db.prepare(`
      INSERT INTO payroll_advances (payroll_record_id, amount, advance_date, include_in_report, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertAdvance.run(payrollIds[0], 100, '2026-02-15', 1, 0);
    insertAdvance.run(payrollIds[1], 100, '2026-03-08', 1, 0);
    insertAdvance.run(payrollIds[1], 50, '2026-03-18', 1, 1);

    const debtPlanId = Number(
      db.prepare(`
        INSERT INTO payroll_debt_plans (employee_id, label, total_amount, status, created_from_month)
        VALUES (?, ?, ?, 'active', ?)
      `).run(employeeIds[1], 'Prestito attrezzatura demo', 240, '2026-03').lastInsertRowid
    );

    const insertInstallment = db.prepare(`
      INSERT INTO payroll_debt_installments (
        plan_id, employee_id, target_month, amount, note, sort_order, is_paid, paid_record_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertInstallment.run(debtPlanId, employeeIds[1], '2026-03', 80, 'Rata demo 1', 0, 1, payrollIds[1]);
    insertInstallment.run(debtPlanId, employeeIds[1], '2026-04', 80, 'Rata demo 2', 1, 0, null);
    insertInstallment.run(debtPlanId, employeeIds[1], '2026-05', 80, 'Rata demo 3', 2, 0, null);

    db.prepare(`
      INSERT INTO communications (
        period_mode, period_start, period_end, month_reference, company_name, title, recipient_email, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'monthly',
      '2026-03-01',
      '2026-03-31',
      '2026-03',
      'GPA 1.0.0 Demo',
      'Elenco giornate',
      'consulente@example.demo',
      'Comunicazione demo'
    );

    db.prepare(`
      INSERT OR REPLACE INTO app_metadata (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(DEMO_META_KEY, DEMO_SEED_VERSION);
  });

  tx();
  ensureDemoSettings();
}

function ensureDemoInitialized() {
  if (!isDemoVariant()) return getDemoRuntimeInfo();

  const db = getDb();
  const currentVersion = db.prepare(`
    SELECT value
    FROM app_metadata
    WHERE key = ?
  `).get(DEMO_META_KEY)?.value;

  if (currentVersion !== DEMO_SEED_VERSION) {
    seedDemoData();
  } else {
    ensureDemoSettings();
  }

  return getDemoRuntimeInfo();
}

function emptyDir(targetDir) {
  if (!fs.existsSync(targetDir)) return;
  for (const entry of fs.readdirSync(targetDir)) {
    const entryPath = path.join(targetDir, entry);
    fs.rmSync(entryPath, { recursive: true, force: true });
  }
}

function resetDemoData() {
  if (!isDemoVariant()) {
    throw new Error('Reset demo disponibile solo in modalità demo.');
  }

  closeDb();
  emptyDir(getDataDir());
  emptyDir(getDocumentsDir());
  emptyDir(getBackupsDir());
  emptyDir(getUpdatesDir());
  seedDemoData();

  const state = readDemoState();
  writeDemoState({
    ...state,
    reset_count: Number(state.reset_count || 0) + 1,
  });

  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 300);

  return {
    success: true,
    relaunching: true,
  };
}

module.exports = {
  ensureDemoInitialized,
  getDemoRuntimeInfo,
  markDemoWelcomeSeen,
  resetDemoData,
};
