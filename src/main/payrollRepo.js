const { getDb } = require('./db');
const {
  describeStoredFile,
  openStoredDocument,
  removeStoredFile,
  selectLocalFile,
  storeSelectedFile,
} = require('./documentService');

const PAYROLL_DOCUMENT_CATEGORY = 'payroll_slip';

function parseJsonValue(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

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

function loadLiveInstallmentsMap(payrollRecordIds) {
  const db = getDb();
  if (!payrollRecordIds.length) {
    return new Map();
  }

  const placeholders = payrollRecordIds.map(() => '?').join(', ');

  const rows = db.prepare(`
    SELECT i.paid_record_id AS record_id,
           COALESCE(SUM(i.amount), 0) AS total,
           COUNT(*) AS count
    FROM payroll_debt_installments i
    JOIN payroll_debt_plans p ON p.id = i.plan_id
    WHERE i.paid_record_id IN (${placeholders})
      AND p.status = 'active'
    GROUP BY i.paid_record_id
  `).all(...payrollRecordIds);

  const map = new Map();
  for (const row of rows) {
    map.set(row.record_id, {
      total: Number(row.total || 0),
      count: Number(row.count || 0),
    });
  }
  return map;
}

function attachAdvances(records, options = {}) {
  const advancesMap = loadAdvancesMap(records.map((record) => record.id));
  const liveInstallmentsMap = loadLiveInstallmentsMap(records.map((record) => record.id));
  const includePreviewData = options.includePreviewData !== false;

  return records.map((record) => {
    const snapshot = includePreviewData
      ? parseJsonValue(record.report_snapshot_json, null)
      : null;
    const snapshotInstallments = Number(snapshot?.current_installments_total || 0);
    const liveInfo = liveInstallmentsMap.get(record.id) || { total: 0, count: 0 };

    return {
      ...record,
      is_pagato: !!record.is_pagato,
      resto_pagato: !!record.resto_pagato,
      partial_paid_amount: Number(record.partial_paid_amount || 0),
      remaining_balance: Number(record.remaining_balance || 0),
      is_processed: !!record.processed_at,
      is_archived: !!record.archived_at,
      report_snapshot_json: includePreviewData ? snapshot : null,
      report_html_snapshot: includePreviewData ? (record.report_html_snapshot || null) : null,
      live_installments_total: liveInfo.total,
      live_installments_count: liveInfo.count,
      snapshot_installments_total: snapshotInstallments,
      installments_snapshot_mismatch: Math.abs(snapshotInstallments - liveInfo.total) > 0.009,
      advances: advancesMap.get(record.id) || [],
      payroll_document: record.payroll_document_id
        ? describeStoredFile({
            id: record.payroll_document_id,
            file_name: record.payroll_document_file_name,
            stored_name: record.payroll_document_stored_name,
            relative_path: record.payroll_document_relative_path,
            mime_type: record.payroll_document_mime_type,
            size_bytes: record.payroll_document_size_bytes,
            sha256: record.payroll_document_sha256,
            file_created_at: record.payroll_document_file_created_at,
            uploaded_at: record.payroll_document_uploaded_at,
            updated_at: record.payroll_document_updated_at,
          })
        : null,
    };
  });
}

function normalizeBalanceStatus(status, fallbackBalance = 0, fallbackClosed = false) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'saldato' || fallbackClosed || Math.abs(Number(fallbackBalance || 0)) <= 0.009) {
    return 'saldato';
  }
  if (normalized === 'parziale') {
    return 'parziale';
  }
  return 'non_pagato';
}

function getCarriedForwardBalance(record) {
  const effectiveBalance = Number(record.effective_balance || 0);
  const normalizedStatus = normalizeBalanceStatus(
    record.balance_status,
    effectiveBalance,
    !!record.resto_pagato
  );

  if (normalizedStatus === 'saldato') {
    return 0;
  }

  if (normalizedStatus === 'parziale') {
    const explicitRemaining = Number(record.remaining_balance || 0);
    if (Math.abs(explicitRemaining) > 0.009) {
      return explicitRemaining;
    }

    const paidAbs = Math.max(0, Number(record.partial_paid_amount || 0));
    const residualAbs = Math.max(Math.abs(effectiveBalance) - paidAbs, 0);
    return Math.sign(effectiveBalance || 1) * residualAbs;
  }

  return effectiveBalance;
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
      pd.sha256 AS payroll_document_sha256,
      pd.file_created_at AS payroll_document_file_created_at,
      pd.uploaded_at AS payroll_document_uploaded_at,
      pd.updated_at AS payroll_document_updated_at
    FROM payroll_records pr
    LEFT JOIN payroll_documents pd
      ON pd.payroll_record_id = pr.id
      AND pd.category = '${PAYROLL_DOCUMENT_CATEGORY}'
    ${whereClause}
  `;
}

function getHistoryListSql(whereClause) {
  return `
    SELECT
      pr.id,
      pr.employee_id,
      pr.month,
      pr.datore,
      pr.giornate_effettuate,
      pr.ore_totali,
      pr.retribuzione_calcolata,
      pr.giornate_busta_paga,
      pr.importo_busta_paga,
      pr.acconti,
      pr.acconti_details,
      pr.resto_precedente,
      pr.differenza_finale,
      pr.n_macchine_mese,
      pr.prezzo_per_macchina,
      pr.totale_trasporto,
      pr.regalo_importo,
      pr.regalo_descrizione,
      pr.is_pagato,
      pr.payroll_payment_status,
      pr.payroll_payment_method,
      pr.payroll_payment_date,
      pr.resto_pagato,
      pr.resto_pagato_data,
      pr.balance_status,
      pr.partial_paid_amount,
      pr.remaining_balance,
      pr.balance_closed_at,
      pr.balance_notes,
      pr.processed_at,
      pr.archived_at,
      pr.note,
      pr.created_at,
      pr.updated_at,
      CASE WHEN EXISTS (
        SELECT 1 FROM payroll_documents pd
        WHERE pd.payroll_record_id = pr.id
          AND pd.category = '${PAYROLL_DOCUMENT_CATEGORY}'
        LIMIT 1
      ) THEN 1 ELSE 0 END AS has_payroll_document,
      NULL AS payroll_document_id,
      NULL AS payroll_document_file_name,
      NULL AS payroll_document_stored_name,
      NULL AS payroll_document_relative_path,
      NULL AS payroll_document_mime_type,
      NULL AS payroll_document_size_bytes,
      NULL AS payroll_document_sha256,
      NULL AS payroll_document_file_created_at,
      NULL AS payroll_document_uploaded_at,
      NULL AS payroll_document_updated_at
    FROM payroll_records pr
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
  const existingRecord = db.prepare(`
    SELECT id, datore
    FROM payroll_records
    WHERE employee_id = ? AND month = ?
    LIMIT 1
  `).get(data.employee_id, data.month);
  const effectiveDatore = String(data.datore || '').trim() || existingRecord?.datore || null;

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
        payroll_payment_status,
        payroll_payment_method,
        payroll_payment_date,
        resto_pagato,
        resto_pagato_data,
        balance_status,
        partial_paid_amount,
        remaining_balance,
        balance_closed_at,
        balance_notes,
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
        @payroll_payment_status,
        @payroll_payment_method,
        @payroll_payment_date,
        @resto_pagato,
        @resto_pagato_data,
        @balance_status,
        @partial_paid_amount,
        @remaining_balance,
        @balance_closed_at,
        @balance_notes,
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
        payroll_payment_status = excluded.payroll_payment_status,
        payroll_payment_method = excluded.payroll_payment_method,
        payroll_payment_date = excluded.payroll_payment_date,
        resto_pagato = excluded.resto_pagato,
        resto_pagato_data = excluded.resto_pagato_data,
        balance_status = excluded.balance_status,
        partial_paid_amount = excluded.partial_paid_amount,
        remaining_balance = excluded.remaining_balance,
        balance_closed_at = excluded.balance_closed_at,
        balance_notes = excluded.balance_notes,
        processed_at = excluded.processed_at,
        archived_at = NULL,
        report_html_snapshot = excluded.report_html_snapshot,
        report_snapshot_json = excluded.report_snapshot_json,
        note = excluded.note,
        updated_at = CURRENT_TIMESTAMP
    `).run({
      employee_id: data.employee_id,
      month: data.month,
      datore: effectiveDatore,
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
      payroll_payment_status:
        String(data.payroll_payment_status || '').trim().toLowerCase() === 'non_pagato'
          ? 'non_pagato'
          : 'pagato',
      payroll_payment_method: data.payroll_payment_method || 'bonifico',
      payroll_payment_date: data.payroll_payment_date || null,
      resto_pagato: data.resto_pagato ? 1 : 0,
      resto_pagato_data: data.resto_pagato_data || null,
      balance_status: data.balance_status || 'non_pagato',
      partial_paid_amount: data.partial_paid_amount ?? 0,
      remaining_balance: data.remaining_balance ?? 0,
      balance_closed_at: data.balance_closed_at || null,
      balance_notes: data.balance_notes || null,
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
  const queryStart = Date.now();
  const db = getDb();

  const sqlStart = Date.now();
  const rows = db.prepare(`
    ${getJoinedRecordSql('WHERE pr.employee_id = ? AND pr.archived_at IS NULL ORDER BY pr.month DESC')}
  `).all(employeeId);
  const sqlDuration = Date.now() - sqlStart;
  console.log(`[buste-perf-main] SQL query: ${sqlDuration}ms, rows: ${rows.length}, employee_id: ${employeeId}`);

  const attachStart = Date.now();
  const result = attachAdvances(rows).map((record) => ({
    ...record,
    debt_plans: [],
  }));
  const attachDuration = Date.now() - attachStart;
  console.log(`[buste-perf-main] attachAdvances + mapping: ${attachDuration}ms`);

  const totalDuration = Date.now() - queryStart;
  console.log(`[buste-perf-main] listByEmployee complete: ${totalDuration}ms`);

  return result;
}

function listPayrollRecordsForEmployees(options = {}) {
  const queryStart = Date.now();
  const db = getDb();
  const employeeIds = Array.isArray(options.employeeIds) ? options.employeeIds : [];

  if (!employeeIds.length) {
    console.log(`[buste-perf-main] bulk payroll query: empty employee list`);
    return {};
  }

  console.log(`[buste-perf-main] bulk payroll query start: employees=${employeeIds.length}, year=${options.year}, month=${options.month}`);

  const sqlStart = Date.now();
  const placeholders = employeeIds.map(() => '?').join(', ');

  const query = `
    SELECT
      pr.id,
      pr.employee_id,
      pr.month,
      pr.datore,
      pr.giornate_effettuate,
      pr.ore_totali,
      pr.retribuzione_calcolata,
      pr.giornate_busta_paga,
      pr.importo_busta_paga,
      pr.acconti,
      pr.acconti_details,
      pr.resto_precedente,
      pr.differenza_finale,
      pr.n_macchine_mese,
      pr.prezzo_per_macchina,
      pr.totale_trasporto,
      pr.regalo_importo,
      pr.regalo_descrizione,
      pr.is_pagato,
      pr.payroll_payment_status,
      pr.payroll_payment_method,
      pr.payroll_payment_date,
      pr.resto_pagato,
      pr.resto_pagato_data,
      pr.balance_status,
      pr.balance_closed_at,
      pr.balance_notes,
      pr.processed_at,
      pr.archived_at,
      pr.note,
      pr.created_at,
      pr.updated_at,
      CASE WHEN EXISTS (
        SELECT 1 FROM payroll_documents pd
        WHERE pd.payroll_record_id = pr.id
          AND pd.category = 'payroll_slip'
        LIMIT 1
      ) THEN 1 ELSE 0 END AS has_payroll_document
    FROM payroll_records pr
    WHERE pr.employee_id IN (${placeholders})
      AND pr.archived_at IS NULL
    ORDER BY pr.employee_id ASC, pr.month DESC
  `;

  const rows = db.prepare(query).all(...employeeIds);
  const sqlDuration = Date.now() - sqlStart;
  console.log(`[buste-perf-main] bulk SQL query: ${sqlDuration}ms, rows: ${rows.length}`);

  const mappingStart = Date.now();
  const resultMap = {};

  for (const row of rows) {
    if (!resultMap[row.employee_id]) {
      resultMap[row.employee_id] = [];
    }

    resultMap[row.employee_id].push({
      ...row,
      payroll_document: !!row.has_payroll_document ? {} : null,
      advances: [],
      debt_plans: [],
      is_pagato: !!row.is_pagato,
      payroll_payment_status:
        String(row.payroll_payment_status || '').trim().toLowerCase() === 'non_pagato'
          ? 'non_pagato'
          : (row.payroll_payment_status ? 'pagato' : row.is_pagato ? 'pagato' : 'non_pagato'),
      payroll_payment_method: row.payroll_payment_method || 'bonifico',
      payroll_payment_date: row.payroll_payment_date || null,
      resto_pagato: !!row.resto_pagato,
      balance_status:
        row.balance_status ||
        (Math.abs(Number(row.differenza_finale || 0)) <= 0.009 || row.resto_pagato ? 'saldato' : 'non_pagato'),
      partial_paid_amount: Number(row.partial_paid_amount || 0),
      remaining_balance:
        row.remaining_balance !== null && row.remaining_balance !== undefined
          ? Number(row.remaining_balance || 0)
          : Number(row.differenza_finale || 0),
      balance_closed_at: row.balance_closed_at || row.resto_pagato_data || null,
      balance_notes: row.balance_notes ?? row.note ?? null,
      is_processed: !!row.processed_at,
      is_archived: !!row.archived_at,
      report_snapshot_json: null,
      report_html_snapshot: null,
      live_installments_total: 0,
      live_installments_count: 0,
      snapshot_installments_total: 0,
      installments_snapshot_mismatch: false,
    });
  }

  const mappingDuration = Date.now() - mappingStart;
  console.log(`[buste-perf-main] bulk mapping: ${mappingDuration}ms`);

  const totalDuration = Date.now() - queryStart;
  console.log(`[buste-perf-main] bulk payroll query end: ${totalDuration}ms`);

  return resultMap;
}

function listPayrollHistory(options = {}) {
  const queryStart = Date.now();
  const db = getDb();
  const conditions = [];
  const params = [];
  const requestedLimit = Number(options.limit || 0) || 0;
  const limit = requestedLimit > 0 ? Math.max(1, Math.min(requestedLimit, 200)) : 0;
  const offset = Math.max(0, Number(options.offset || 0) || 0);
  const search = String(options.search || '').trim().toLowerCase();

  console.log(`[storico-perf-main] listHistory query start: year=${options.year}, month=${options.month}`);

  if (options.year) {
    conditions.push(`substr(history_rows.month, 1, 4) = ?`);
    params.push(String(options.year));
  }

  if (options.month) {
    conditions.push(`history_rows.month = ?`);
    params.push(String(options.month).slice(0, 7));
  }

  if (options.employee_id) {
    conditions.push(`history_rows.employee_id = ?`);
    params.push(Number(options.employee_id));
  }

  if (search) {
    conditions.push(`
      LOWER(
        COALESCE(e.first_name, '') || ' ' ||
        COALESCE(e.last_name, '') || ' ' ||
        COALESCE(e.role, '') || ' ' ||
        COALESCE(e.fiscal_code, '') || ' ' ||
        COALESCE(history_rows.datore, '') || ' ' ||
        COALESCE(history_rows.month, '')
      ) LIKE ?
    `);
    params.push(`%${search}%`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countStart = Date.now();
  const totalRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM (
      ${getHistoryListSql('')}
    ) AS history_rows
    JOIN employees e ON e.id = history_rows.employee_id
    ${whereClause}
  `).get(...params);
  const countDuration = Date.now() - countStart;
  console.log(`[storico-perf-main] COUNT query: ${countDuration}ms`);

  const total = Number(totalRow?.total || 0);
  const paginationSql = limit ? 'LIMIT ? OFFSET ?' : '';
  const queryParams = limit ? [...params, limit, offset] : params;

  const selectStart = Date.now();
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
      ${getHistoryListSql('')}
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
    ${whereClause}
    ORDER BY history_rows.archived_at IS NOT NULL ASC, history_rows.month DESC, e.last_name COLLATE NOCASE ASC, e.first_name COLLATE NOCASE ASC
    ${paginationSql}
  `).all(...queryParams);
  const selectDuration = Date.now() - selectStart;
  console.log(`[storico-perf-main] SELECT query: ${selectDuration}ms, rows: ${rows.length}`);

  const processStart = Date.now();
  const items = attachAdvances(rows, {
    includePreviewData: false,
  }).map((record) => ({
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
    debt_plans: [],
    payroll_document: !!record.has_payroll_document ? {} : null,
  }));
  const processDuration = Date.now() - processStart;
  console.log(`[storico-perf-main] attachAdvances + mapping: ${processDuration}ms`);

  const queryDuration = Date.now() - queryStart;
  const returnCount = Array.isArray(items) ? items.length : 0;
  console.log(`[storico-perf-main] listHistory query end: ${queryDuration}ms, records: ${returnCount}, total available: ${total}`);

  if (!limit) {
    return items;
  }

  return {
    items,
    total,
    limit,
    offset,
    has_more: offset + items.length < total,
  };
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
  const effectiveBalanceSql = `
    (
      COALESCE(pr.retribuzione_calcolata, 0) +
      COALESCE(pr.resto_precedente, 0) +
      COALESCE(pr.totale_trasporto, 0) +
      COALESCE(pr.regalo_importo, 0) -
      COALESCE(pr.acconti, 0) -
      COALESCE(pr.importo_busta_paga, 0) -
      COALESCE(installments.current_installments_total, 0)
    )
  `;

  const openPrevious = db.prepare(`
    SELECT
      pr.month,
      pr.resto_pagato,
      pr.balance_status,
      pr.partial_paid_amount,
      pr.remaining_balance,
      ${effectiveBalanceSql} AS effective_balance
    FROM payroll_records pr
    LEFT JOIN (
      SELECT i.paid_record_id, SUM(i.amount) AS current_installments_total
      FROM payroll_debt_installments i
      JOIN payroll_debt_plans p ON p.id = i.plan_id
      WHERE i.paid_record_id IS NOT NULL
        AND p.status = 'active'
      GROUP BY i.paid_record_id
    ) installments
      ON installments.paid_record_id = pr.id
    WHERE pr.employee_id = ?
      AND pr.month < ?
      AND pr.archived_at IS NULL
      AND (
        CASE
          WHEN COALESCE(pr.balance_status, '') = 'saldato' OR COALESCE(pr.resto_pagato, 0) = 1 THEN 0
          WHEN COALESCE(pr.balance_status, '') = 'parziale' THEN
            CASE
              WHEN ABS(COALESCE(pr.remaining_balance, 0)) > 0.009 THEN COALESCE(pr.remaining_balance, 0)
              ELSE
                CASE
                  WHEN (${effectiveBalanceSql}) < 0 THEN -MAX(ABS(${effectiveBalanceSql}) - COALESCE(pr.partial_paid_amount, 0), 0)
                  ELSE MAX(ABS(${effectiveBalanceSql}) - COALESCE(pr.partial_paid_amount, 0), 0)
                END
            END
          ELSE ${effectiveBalanceSql}
        END
      ) <> 0
    ORDER BY pr.month DESC
    LIMIT 1
  `).get(employeeId, month);

  if (openPrevious) {
    const carriedBalance = getCarriedForwardBalance(openPrevious);
    console.info('[year-rollover] previous=%s current=%s previousBalance=%s carriedBalance=%s', openPrevious.month, month, Number(openPrevious.effective_balance || 0), carriedBalance);
    return {
      previousMonth: openPrevious.month,
      previousBalance: carriedBalance,
      balanceStatus: normalizeBalanceStatus(
        openPrevious.balance_status,
        openPrevious.effective_balance,
        !!openPrevious.resto_pagato
      ),
      alreadyPaid: false,
    };
  }

  const latestPrevious = db.prepare(`
    SELECT
      pr.month,
      pr.resto_pagato,
      pr.balance_status,
      pr.partial_paid_amount,
      pr.remaining_balance,
      ${effectiveBalanceSql} AS effective_balance
    FROM payroll_records pr
    LEFT JOIN (
      SELECT i.paid_record_id, SUM(i.amount) AS current_installments_total
      FROM payroll_debt_installments i
      JOIN payroll_debt_plans p ON p.id = i.plan_id
      WHERE i.paid_record_id IS NOT NULL
        AND p.status = 'active'
      GROUP BY i.paid_record_id
    ) installments
      ON installments.paid_record_id = pr.id
    WHERE pr.employee_id = ?
      AND pr.month < ?
      AND pr.archived_at IS NULL
      AND ${effectiveBalanceSql} <> 0
    ORDER BY pr.month DESC
    LIMIT 1
  `).get(employeeId, month);

  if (!latestPrevious) {
    console.info('[year-rollover] previous=%s current=%s previousBalance=%s carriedBalance=%s', null, month, 0, 0);
    return {
      previousMonth: null,
      previousBalance: 0,
      alreadyPaid: false,
    };
  }

  const paidCarriedBalance = getCarriedForwardBalance(latestPrevious);
  console.info('[year-rollover] previous=%s current=%s previousBalance=%s carriedBalance=%s', latestPrevious.month, month, Number(latestPrevious.effective_balance || 0), paidCarriedBalance);
  return {
    previousMonth: null,
    previousBalance: 0,
    alreadyPaid: Math.abs(paidCarriedBalance) <= 0.009,
    paidPreviousMonth: latestPrevious.month,
    paidPreviousBalance: paidCarriedBalance,
    balanceStatus: normalizeBalanceStatus(
      latestPrevious.balance_status,
      latestPrevious.effective_balance,
      !!latestPrevious.resto_pagato
    ),
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

function updatePayrollReportPaymentStatus(id, paymentStatus, paymentDate, partialPaidAmount = 0, remainingBalance = null) {
  const db = getDb();
  const record = getPayrollRecordById(id);
  if (!record) {
    throw new Error('Report storico non trovato.');
  }

  const normalizedStatus = String(paymentStatus || 'non_pagato').trim().toLowerCase();
  const normalizedPaymentDate = String(paymentDate || '').trim();
  const closedPaymentDate = normalizedPaymentDate || new Date().toISOString().slice(0, 10);

  const balanceStatus =
    normalizedStatus === 'pagato' ? 'saldato' :
    normalizedStatus === 'parziale' ? 'parziale' :
    normalizedStatus === 'saldato' ? 'saldato' :
    'non_pagato';
  const balanceClosedAt = closedPaymentDate;
  const restoPagato = balanceStatus === 'saldato' ? 1 : 0;
  const effectiveBalance = Number(record.differenza_finale || 0);
  const normalizedPartialPaidAmount =
    balanceStatus === 'parziale'
      ? Math.min(Math.max(Number(partialPaidAmount || 0), 0), Math.abs(effectiveBalance))
      : balanceStatus === 'saldato'
      ? Math.abs(effectiveBalance)
      : 0;
  const normalizedRemainingBalance =
    balanceStatus === 'saldato'
      ? 0
      : balanceStatus === 'parziale'
      ? Number(remainingBalance ?? effectiveBalance)
      : effectiveBalance;

  db.prepare(`
    UPDATE payroll_records
    SET resto_pagato = ?,
        resto_pagato_data = ?,
        balance_status = ?,
        partial_paid_amount = ?,
        remaining_balance = ?,
        balance_closed_at = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    restoPagato,
    balanceClosedAt,
    balanceStatus,
    normalizedPartialPaidAmount,
    normalizedRemainingBalance,
    balanceClosedAt,
    id
  );

  return getPayrollRecordById(id);
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
      UPDATE employee_financial_movements
      SET inserted_report_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE inserted_report_id = ?
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

  const stored = await storeSelectedFile(
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
          sha256 = @sha256,
          file_created_at = @file_created_at,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({
      id: existing.id,
      ...stored,
    });
  } else {
    db.prepare(`
      INSERT INTO payroll_documents (
        payroll_record_id, category, file_name, stored_name, relative_path, mime_type, size_bytes, sha256, file_created_at
      ) VALUES (
        @payroll_record_id, @category, @file_name, @stored_name, @relative_path, @mime_type, @size_bytes, @sha256, @file_created_at
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
  listPayrollRecordsForEmployees,
  openPayrollDocument,
  restorePayrollRecord,
  updatePayrollReportPaymentStatus,
  updatePayrollRecord: upsertPayrollRecord,
  upsertPayrollRecord,
  uploadPayrollDocument,
};
