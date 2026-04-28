const { getDb } = require('./db');
const {
  describeStoredFile,
  openStoredDocument,
  removeStoredFile,
  selectLocalFile,
  storeSelectedFile,
} = require('./documentService');

const PAYROLL_DOCUMENT_CATEGORY = 'payroll_slip';

function normalizeAdvances(advances = []) {
  return (Array.isArray(advances) ? advances : [])
    .map((advance, index) => ({
      id: advance.id || null,
      amount: Number(advance.amount || 0),
      date: advance.date || '',
      includeInReport: !!advance.includeInReport,
      sort_order: index,
    }))
    .filter((advance) => advance.amount > 0);
}

function normalizeInstallments(installments = []) {
  return (Array.isArray(installments) ? installments : [])
    .map((installment, index) => ({
      id: installment.id || null,
      target_month: String(installment.target_month || '').slice(0, 7),
      amount: Number(installment.amount || 0),
      note: String(installment.note || '').trim(),
      sort_order: index,
    }))
    .filter((installment) => installment.target_month && installment.amount > 0);
}

function loadAdvancesMap(payrollRecordIds) {
  const db = getDb();
  if (!payrollRecordIds.length) {
    return new Map();
  }

  const placeholders = payrollRecordIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT id, payroll_record_id, amount, advance_date, include_in_report, sort_order
    FROM payroll_advances
    WHERE payroll_record_id IN (${placeholders})
    ORDER BY sort_order ASC, id ASC
  `).all(...payrollRecordIds);

  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.payroll_record_id) || [];
    list.push({
      id: row.id,
      amount: Number(row.amount || 0),
      date: row.advance_date || '',
      includeInReport: !!row.include_in_report,
    });
    map.set(row.payroll_record_id, list);
  }

  return map;
}

function attachAdvances(records) {
  const advancesMap = loadAdvancesMap(records.map((record) => record.id));

  return records.map((record) => ({
    ...record,
    is_pagato: !!record.is_pagato,
    resto_pagato: !!record.resto_pagato,
    is_processed: !!record.processed_at,
    is_archived: !!record.archived_at,
    advances: advancesMap.get(record.id) || [],
    payroll_document: record.payroll_document_id
      ? describeStoredFile({
          id: record.payroll_document_id,
          file_name: record.payroll_document_file_name,
          stored_name: record.payroll_document_stored_name,
          relative_path: record.payroll_document_relative_path,
          mime_type: record.payroll_document_mime_type,
          size_bytes: record.payroll_document_size_bytes,
          uploaded_at: record.payroll_document_uploaded_at,
          updated_at: record.payroll_document_updated_at,
        })
      : null,
  }));
}

function getJoinedRecordSql(whereClause) {
  return `
    SELECT
      pr.*,
      pd.id AS payroll_document_id,
      pd.file_name AS payroll_document_file_name,
      pd.stored_name AS payroll_document_stored_name,
      pd.relative_path AS payroll_document_relative_path,
      pd.mime_type AS payroll_document_mime_type,
      pd.size_bytes AS payroll_document_size_bytes,
      pd.uploaded_at AS payroll_document_uploaded_at,
      pd.updated_at AS payroll_document_updated_at
    FROM payroll_records pr
    LEFT JOIN payroll_documents pd
      ON pd.payroll_record_id = pr.id
      AND pd.category = '${PAYROLL_DOCUMENT_CATEGORY}'
    ${whereClause}
  `;
}

function syncAdvances(payrollRecordId, advances) {
  const db = getDb();
  const normalizedAdvances = normalizeAdvances(advances);

  db.prepare(`
    DELETE FROM payroll_advances
    WHERE payroll_record_id = ?
  `).run(payrollRecordId);

  const insertStmt = db.prepare(`
    INSERT INTO payroll_advances (
      payroll_record_id, amount, advance_date, include_in_report, sort_order
    ) VALUES (
      @payroll_record_id, @amount, @advance_date, @include_in_report, @sort_order
    )
  `);

  normalizedAdvances.forEach((advance) => {
    insertStmt.run({
      payroll_record_id: payrollRecordId,
      amount: advance.amount,
      advance_date: advance.date || '',
      include_in_report: advance.includeInReport ? 1 : 0,
      sort_order: advance.sort_order,
    });
  });
}

function getDebtPlansByEmployee(employeeId, options = {}) {
  const db = getDb();
  const includeArchived = !!options.includeArchived;
  const plans = db.prepare(`
    SELECT *
    FROM payroll_debt_plans
    WHERE employee_id = ?
      ${includeArchived ? '' : "AND status = 'active'"}
    ORDER BY id DESC
  `).all(employeeId);

  if (!plans.length) {
    return [];
  }

  const placeholders = plans.map(() => '?').join(', ');
  const installments = db.prepare(`
    SELECT *
    FROM payroll_debt_installments
    WHERE plan_id IN (${placeholders})
    ORDER BY sort_order ASC, id ASC
  `).all(...plans.map((plan) => plan.id));

  const byPlan = new Map();
  for (const installment of installments) {
    const list = byPlan.get(installment.plan_id) || [];
    list.push({
      id: installment.id,
      target_month: installment.target_month,
      amount: Number(installment.amount || 0),
      note: installment.note || '',
      sort_order: installment.sort_order || 0,
      is_paid: !!installment.is_paid,
      paid_record_id: installment.paid_record_id || null,
    });
    byPlan.set(installment.plan_id, list);
  }

  return plans.map((plan) => {
    const planInstallments = byPlan.get(plan.id) || [];
    const paidAmount = planInstallments
      .filter((item) => item.is_paid)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      ...plan,
      total_amount: Number(plan.total_amount || 0),
      paid_amount: paidAmount,
      residual_amount: Math.max(Number(plan.total_amount || 0) - paidAmount, 0),
      installments: planInstallments,
    };
  });
}

function syncDebtPlans(employeeId, debtPlans = []) {
  const db = getDb();
  const normalizedPlans = (Array.isArray(debtPlans) ? debtPlans : [])
    .map((plan) => ({
      id: plan.id ? Number(plan.id) : null,
      label: String(plan.label || '').trim(),
      total_amount: Number(plan.total_amount || 0),
      status: plan.status || 'active',
      created_from_month: String(plan.created_from_month || '').slice(0, 7) || null,
      installments: normalizeInstallments(plan.installments || []),
    }))
    .filter((plan) => plan.total_amount > 0 && plan.installments.length);

  const existingPlans = db.prepare(`
    SELECT id
    FROM payroll_debt_plans
    WHERE employee_id = ?
  `).all(employeeId);
  const keepIds = new Set();

  for (const plan of normalizedPlans) {
    let planId = plan.id;

    if (planId) {
      db.prepare(`
        UPDATE payroll_debt_plans
        SET label = ?,
            total_amount = ?,
            status = ?,
            created_from_month = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(plan.label || null, plan.total_amount, plan.status, plan.created_from_month, planId);
    } else {
      const result = db.prepare(`
        INSERT INTO payroll_debt_plans (
          employee_id, label, total_amount, status, created_from_month
        ) VALUES (?, ?, ?, ?, ?)
      `).run(employeeId, plan.label || null, plan.total_amount, plan.status, plan.created_from_month);
      planId = Number(result.lastInsertRowid);
    }

    keepIds.add(planId);

    db.prepare(`
      DELETE FROM payroll_debt_installments
      WHERE plan_id = ?
    `).run(planId);

    const insertInstallment = db.prepare(`
      INSERT INTO payroll_debt_installments (
        plan_id, employee_id, target_month, amount, note, sort_order, is_paid, paid_record_id
      ) VALUES (
        @plan_id, @employee_id, @target_month, @amount, @note, @sort_order, 0, NULL
      )
    `);

    plan.installments.forEach((installment) => {
      insertInstallment.run({
        plan_id: planId,
        employee_id: employeeId,
        target_month: installment.target_month,
        amount: installment.amount,
        note: installment.note || null,
        sort_order: installment.sort_order,
      });
    });
  }

  for (const existing of existingPlans) {
    if (!keepIds.has(existing.id)) {
      db.prepare(`
        UPDATE payroll_debt_plans
        SET status = 'archived',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(existing.id);
    }
  }
}

function syncInstallmentPayments(employeeId, month, payrollRecordId) {
  const db = getDb();

  db.prepare(`
    UPDATE payroll_debt_installments
    SET is_paid = 0,
        paid_record_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE employee_id = ?
      AND paid_record_id = ?
  `).run(employeeId, payrollRecordId);

  db.prepare(`
    UPDATE payroll_debt_installments
    SET is_paid = 1,
        paid_record_id = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE employee_id = ?
      AND target_month = ?
      AND EXISTS (
        SELECT 1
        FROM payroll_debt_plans p
        WHERE p.id = payroll_debt_installments.plan_id
          AND p.status = 'active'
      )
  `).run(payrollRecordId, employeeId, month);
}

function upsertPayrollRecord(data) {
  const db = getDb();
  const normalizedAdvances = normalizeAdvances(data.advances || data.acconti_details || []);
  const totalAdvances = normalizedAdvances.reduce((sum, advance) => sum + advance.amount, 0);

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO payroll_records (
        employee_id,
        month,
        datore,
        giornate_effettuate,
        ore_totali,
        retribuzione_calcolata,
        giornate_busta_paga,
        importo_busta_paga,
        acconti,
        acconti_details,
        resto_precedente,
        differenza_finale,
        n_macchine_mese,
        prezzo_per_macchina,
        totale_trasporto,
        regalo_importo,
        regalo_descrizione,
        is_pagato,
        resto_pagato,
        resto_pagato_data,
        processed_at,
        archived_at,
        report_html_snapshot,
        report_snapshot_json,
        note
      )
      VALUES (
        @employee_id,
        @month,
        @datore,
        @giornate_effettuate,
        @ore_totali,
        @retribuzione_calcolata,
        @giornate_busta_paga,
        @importo_busta_paga,
        @acconti,
        @acconti_details,
        @resto_precedente,
        @differenza_finale,
        @n_macchine_mese,
        @prezzo_per_macchina,
        @totale_trasporto,
        @regalo_importo,
        @regalo_descrizione,
        @is_pagato,
        @resto_pagato,
        @resto_pagato_data,
        @processed_at,
        NULL,
        @report_html_snapshot,
        @report_snapshot_json,
        @note
      )
      ON CONFLICT(employee_id, month)
      DO UPDATE SET
        datore = excluded.datore,
        giornate_effettuate = excluded.giornate_effettuate,
        ore_totali = excluded.ore_totali,
        retribuzione_calcolata = excluded.retribuzione_calcolata,
        giornate_busta_paga = excluded.giornate_busta_paga,
        importo_busta_paga = excluded.importo_busta_paga,
        acconti = excluded.acconti,
        acconti_details = excluded.acconti_details,
        resto_precedente = excluded.resto_precedente,
        differenza_finale = excluded.differenza_finale,
        n_macchine_mese = excluded.n_macchine_mese,
        prezzo_per_macchina = excluded.prezzo_per_macchina,
        totale_trasporto = excluded.totale_trasporto,
        regalo_importo = excluded.regalo_importo,
        regalo_descrizione = excluded.regalo_descrizione,
        is_pagato = excluded.is_pagato,
        resto_pagato = excluded.resto_pagato,
        resto_pagato_data = excluded.resto_pagato_data,
        processed_at = excluded.processed_at,
        archived_at = NULL,
        report_html_snapshot = excluded.report_html_snapshot,
        report_snapshot_json = excluded.report_snapshot_json,
        note = excluded.note,
        updated_at = CURRENT_TIMESTAMP
    `).run({
      employee_id: data.employee_id,
      month: data.month,
      datore: data.datore || null,
      giornate_effettuate: data.giornate_effettuate ?? 0,
      ore_totali: data.ore_totali ?? 0,
      retribuzione_calcolata: data.retribuzione_calcolata ?? 0,
      giornate_busta_paga: data.giornate_busta_paga ?? 0,
      importo_busta_paga: data.importo_busta_paga ?? 0,
      acconti: totalAdvances,
      acconti_details: JSON.stringify(
        normalizedAdvances.map((advance) => ({
          amount: advance.amount,
          date: advance.date,
          includeInReport: advance.includeInReport,
        }))
      ),
      resto_precedente: data.resto_precedente ?? 0,
      differenza_finale: data.differenza_finale ?? 0,
      n_macchine_mese: data.n_macchine_mese ?? 0,
      prezzo_per_macchina: data.prezzo_per_macchina ?? 0,
      totale_trasporto: data.totale_trasporto ?? 0,
      regalo_importo: data.regalo_importo ?? 0,
      regalo_descrizione: data.regalo_descrizione || null,
      is_pagato: data.is_pagato ? 1 : 0,
      resto_pagato: data.resto_pagato ? 1 : 0,
      resto_pagato_data: data.resto_pagato_data || null,
      processed_at: data.processed_at || new Date().toISOString(),
      report_html_snapshot: data.report_html_snapshot || null,
      report_snapshot_json: data.report_snapshot_json
        ? JSON.stringify(data.report_snapshot_json)
        : null,
      note: data.note || null,
    });

    const record = db.prepare(`
      SELECT id
      FROM payroll_records
      WHERE employee_id = ? AND month = ?
      LIMIT 1
    `).get(data.employee_id, data.month);

    syncAdvances(record.id, normalizedAdvances);
    if (Array.isArray(data.debt_plans)) {
      syncDebtPlans(data.employee_id, data.debt_plans);
    }
    syncInstallmentPayments(data.employee_id, data.month, record.id);
  });

  tx();
  return getPayrollRecord(data.employee_id, data.month);
}

function listPayrollRecordsByEmployee(employeeId) {
  const db = getDb();
  const rows = db.prepare(`
    ${getJoinedRecordSql('WHERE pr.employee_id = ? AND pr.archived_at IS NULL ORDER BY pr.month DESC')}
  `).all(employeeId);

  return attachAdvances(rows).map((record) => ({
    ...record,
    debt_plans: getDebtPlansByEmployee(employeeId, { includeArchived: true }),
  }));
}

function listPayrollHistory() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      history_rows.*,
      e.first_name AS employee_first_name,
      e.last_name AS employee_last_name,
      e.role AS employee_role,
      e.status AS employee_status,
      e.is_deleted AS employee_is_deleted,
      e.hired_by AS employee_hired_by,
      team_lookup.team_names
    FROM (
      ${getJoinedRecordSql('')}
    ) AS history_rows
    JOIN employees e ON e.id = history_rows.employee_id
    LEFT JOIN (
      SELECT
        tm.employee_id,
        GROUP_CONCAT(DISTINCT t.name) AS team_names
      FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      GROUP BY tm.employee_id
    ) AS team_lookup ON team_lookup.employee_id = history_rows.employee_id
    ORDER BY history_rows.archived_at IS NOT NULL ASC, history_rows.month DESC, e.last_name COLLATE NOCASE ASC, e.first_name COLLATE NOCASE ASC
  `).all();

  return attachAdvances(rows).map((record) => ({
    ...record,
    employee: {
      id: record.employee_id,
      first_name: record.employee_first_name,
      last_name: record.employee_last_name,
      role: record.employee_role || '',
      status: record.employee_status || 'attivo',
      is_deleted: !!record.employee_is_deleted,
      hired_by: record.employee_hired_by || '',
      team_names: record.team_names
        ? String(record.team_names)
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
    },
    debt_plans: getDebtPlansByEmployee(record.employee_id, { includeArchived: true }),
  }));
}

function listPayrollYears() {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT CAST(substr(month, 1, 4) AS INTEGER) AS year
    FROM payroll_records
    WHERE month IS NOT NULL
      AND length(month) >= 4
    ORDER BY year DESC
  `).all()
    .map((row) => Number(row.year))
    .filter((year) => Number.isInteger(year) && year > 1900);
}

function getPayrollRecord(employeeId, month) {
  const db = getDb();
  const row = db.prepare(`
    ${getJoinedRecordSql('WHERE pr.employee_id = ? AND pr.month = ? AND pr.archived_at IS NULL LIMIT 1')}
  `).get(employeeId, month);

  const record = attachAdvances(row ? [row] : [])[0] || null;
  if (!record) return null;
  return {
    ...record,
    debt_plans: getDebtPlansByEmployee(employeeId, { includeArchived: true }),
  };
}

function getPreviousBalance(employeeId, month) {
  const db = getDb();

  const previous = db.prepare(`
    SELECT
      pr.month,
      pr.resto_pagato,
      (
        COALESCE(pr.retribuzione_calcolata, 0) +
        COALESCE(pr.resto_precedente, 0) +
        COALESCE(pr.totale_trasporto, 0) +
        COALESCE(pr.regalo_importo, 0) -
        COALESCE(pr.acconti, 0) -
        COALESCE(pr.importo_busta_paga, 0) -
        COALESCE(installments.current_installments_total, 0)
      ) AS effective_balance
    FROM payroll_records pr
    LEFT JOIN (
      SELECT paid_record_id, SUM(amount) AS current_installments_total
      FROM payroll_debt_installments
      WHERE paid_record_id IS NOT NULL
      GROUP BY paid_record_id
    ) installments
      ON installments.paid_record_id = pr.id
    WHERE pr.employee_id = ?
      AND pr.month < ?
      AND pr.archived_at IS NULL
      AND COALESCE(pr.resto_pagato, 0) = 0
      AND (
        COALESCE(pr.retribuzione_calcolata, 0) +
        COALESCE(pr.resto_precedente, 0) +
        COALESCE(pr.totale_trasporto, 0) +
        COALESCE(pr.regalo_importo, 0) -
        COALESCE(pr.acconti, 0) -
        COALESCE(pr.importo_busta_paga, 0) -
        COALESCE(installments.current_installments_total, 0)
      ) > 0
    ORDER BY pr.month DESC
    LIMIT 1
  `).get(employeeId, month);

  if (!previous) {
    return {
      previousMonth: null,
      previousBalance: 0,
    };
  }

  return {
    previousMonth: previous.month,
    previousBalance: Number(previous.effective_balance || 0),
  };
}

function getPayrollRecordById(id) {
  const db = getDb();
  const row = db.prepare(`
    ${getJoinedRecordSql('WHERE pr.id = ? LIMIT 1')}
  `).get(id);

  const record = attachAdvances(row ? [row] : [])[0] || null;
  if (!record) return null;
  return {
    ...record,
    debt_plans: getDebtPlansByEmployee(record.employee_id, { includeArchived: true }),
  };
}

function archivePayrollRecord(id) {
  const db = getDb();
  db.prepare(`
    UPDATE payroll_records
    SET archived_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);

  return getPayrollRecordById(id);
}

function restorePayrollRecord(id) {
  const db = getDb();
  db.prepare(`
    UPDATE payroll_records
    SET archived_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);

  return getPayrollRecordById(id);
}

function deletePayrollRecord(id) {
  const db = getDb();
  const record = getPayrollRecordById(id);
  if (!record) {
    return { success: false, message: 'Report storico non trovato.' };
  }

  if (record.payroll_document?.relative_path) {
    removeStoredFile(record.payroll_document.relative_path);
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE payroll_debt_installments
      SET is_paid = 0,
          paid_record_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE paid_record_id = ?
    `).run(id);

    db.prepare(`
      DELETE FROM payroll_documents
      WHERE payroll_record_id = ?
    `).run(id);

    db.prepare(`
      DELETE FROM payroll_advances
      WHERE payroll_record_id = ?
    `).run(id);

    db.prepare(`
      DELETE FROM payroll_records
      WHERE id = ?
    `).run(id);
  });

  tx();
  return { success: true };
}

async function uploadPayrollDocument(browserWindow, employeeId, month) {
  const db = getDb();
  const record = getPayrollRecord(employeeId, month);

  if (!record) {
    throw new Error('Salva prima il record mensile prima di allegare la busta paga.');
  }

  const selectedPath = await selectLocalFile(browserWindow, 'Seleziona busta paga');
  if (!selectedPath) {
    return { canceled: true };
  }

  const stored = storeSelectedFile(
    selectedPath,
    ['employees', String(employeeId), 'payroll', String(month)],
    `busta-paga-${month}`
  );

  const existing = db.prepare(`
    SELECT *
    FROM payroll_documents
    WHERE payroll_record_id = ? AND category = ?
    LIMIT 1
  `).get(record.id, PAYROLL_DOCUMENT_CATEGORY);

  if (existing?.relative_path && existing.relative_path !== stored.relative_path) {
    removeStoredFile(existing.relative_path);
  }

  if (existing) {
    db.prepare(`
      UPDATE payroll_documents
      SET file_name = @file_name,
          stored_name = @stored_name,
          relative_path = @relative_path,
          mime_type = @mime_type,
          size_bytes = @size_bytes,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({
      id: existing.id,
      ...stored,
    });
  } else {
    db.prepare(`
      INSERT INTO payroll_documents (
        payroll_record_id, category, file_name, stored_name, relative_path, mime_type, size_bytes
      ) VALUES (
        @payroll_record_id, @category, @file_name, @stored_name, @relative_path, @mime_type, @size_bytes
      )
    `).run({
      payroll_record_id: record.id,
      category: PAYROLL_DOCUMENT_CATEGORY,
      ...stored,
    });
  }

  return {
    canceled: false,
    record: getPayrollRecord(employeeId, month),
  };
}

async function openPayrollDocument(employeeId, month) {
  const db = getDb();
  const record = getPayrollRecord(employeeId, month);
  if (!record) {
    return {
      success: false,
      message: 'Record mensile non trovato.',
    };
  }

  const row = db.prepare(`
    SELECT relative_path
    FROM payroll_documents
    WHERE payroll_record_id = ? AND category = ?
    LIMIT 1
  `).get(record.id, PAYROLL_DOCUMENT_CATEGORY);

  return openStoredDocument(row?.relative_path || null);
}

function deletePayrollDocument(employeeId, month) {
  const db = getDb();
  const record = getPayrollRecord(employeeId, month);
  if (!record) {
    return {
      success: false,
      message: 'Record mensile non trovato.',
      record: null,
    };
  }

  const existing = db.prepare(`
    SELECT id, relative_path
    FROM payroll_documents
    WHERE payroll_record_id = ? AND category = ?
    LIMIT 1
  `).get(record.id, PAYROLL_DOCUMENT_CATEGORY);

  if (!existing) {
    return {
      success: false,
      message: 'Nessuna busta paga allegata da eliminare.',
      record,
    };
  }

  removeStoredFile(existing.relative_path);

  db.prepare(`
    DELETE FROM payroll_documents
    WHERE id = ?
  `).run(existing.id);

  return {
    success: true,
    record: getPayrollRecord(employeeId, month),
  };
}

module.exports = {
  archivePayrollRecord,
  deletePayrollRecord,
  getDebtPlansByEmployee,
  deletePayrollDocument,
  getPayrollRecord,
  getPayrollRecordById,
  getPreviousBalance,
  listPayrollHistory,
  listPayrollYears,
  listPayrollRecordsByEmployee,
  openPayrollDocument,
  restorePayrollRecord,
  updatePayrollRecord: upsertPayrollRecord,
  upsertPayrollRecord,
  uploadPayrollDocument,
};
