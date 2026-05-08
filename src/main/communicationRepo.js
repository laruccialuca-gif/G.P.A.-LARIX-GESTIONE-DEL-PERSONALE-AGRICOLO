const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

const { getDb } = require('./db');
const payrollRepo = require('./payrollRepo');
const settingsService = require('./settingsService');
const {
  describeStoredFile,
  getAbsolutePath,
  openStoredDocument,
  sanitizeSegment,
} = require('./documentService');
const { getDocumentsDir } = require('./storagePaths');

function normalizeString(value) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value) {
  const trimmed = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function ensureCommunicationFilesDir(communicationId) {
  const dirPath = path.join(getDocumentsDir(), 'communications', String(communicationId));
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function buildRelativePath(communicationId, fileName) {
  return path.join('communications', String(communicationId), fileName);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDateLabel(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return '—';
  }

  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function formatPeriodLabel(periodStart, periodEnd) {
  if (!periodStart || !periodEnd) {
    return 'Periodo non definito';
  }

  if (periodStart === periodEnd) {
    return formatDateLabel(periodStart);
  }

  return `${formatDateLabel(periodStart)} - ${formatDateLabel(periodEnd)}`;
}

function formatDateTimeLabel(value) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDecimal(value) {
  const amount = normalizeNumber(value);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.00$/, '');
}

function formatCurrency(value) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(normalizeNumber(value));
}

function formatMonthYearUppercase(monthValue) {
  if (!/^\d{4}-\d{2}$/.test(String(monthValue || ''))) {
    return String(monthValue || '').trim().toUpperCase();
  }

  const [year, month] = String(monthValue).split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  const label = new Intl.DateTimeFormat('it-IT', {
    month: 'long',
    year: 'numeric',
  }).format(date);
  return label.toUpperCase();
}

function getCommunicationMonth(communication) {
  if (communication.period_mode === 'monthly' && /^\d{4}-\d{2}$/.test(String(communication.month_reference || ''))) {
    return communication.month_reference;
  }
  return String(communication.period_start || '').slice(0, 7);
}

function getCurrentInstallments(record, month) {
  return (record?.debt_plans || []).flatMap((plan) =>
    (plan.installments || [])
      .filter((installment) => installment.target_month === month)
  );
}

function buildCompensationSummary(record, month) {
  if (!record) {
    return null;
  }

  const retribuzione = normalizeNumber(record.retribuzione_calcolata);
  const acconti = normalizeNumber(record.acconti);
  const rateDebiti = getCurrentInstallments(record, month)
    .reduce((sum, installment) => sum + normalizeNumber(installment.amount), 0);
  const restoPrecedente = normalizeNumber(record.resto_precedente);
  const crediti = Math.max(restoPrecedente, 0);
  const debitiPrecedenti = Math.abs(Math.min(restoPrecedente, 0));
  const trasporto = normalizeNumber(record.totale_trasporto);
  const aggiunte = normalizeNumber(record.regalo_importo);
  const totale = retribuzione + aggiunte + crediti + trasporto - rateDebiti - debitiPrecedenti - acconti;

  return {
    totale,
  };
}

function getDetailCompensation(detail, month) {
  if (!detail.employee_id || !month) {
    return null;
  }

  return buildCompensationSummary(
    payrollRepo.getPayrollRecord(detail.employee_id, month),
    month
  );
}

function normalizeDetailNote(value) {
  return String(value || '').trim();
}

function getCommunicationBaseSelect() {
  return `
    SELECT
      c.*,
      COUNT(cd.id) AS detail_count
    FROM communications c
    LEFT JOIN communication_details cd ON cd.communication_id = c.id
  `;
}

function parseJsonArray(value, fallback = []) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function ensureCommunicationsSchema(db) {
  const columns = db.prepare("PRAGMA table_info(communications)").all();
  const existingColumns = new Set(columns.map((column) => column.name));
  const requiredColumns = [
    { name: 'selected_employee_ids_json', definition: "TEXT DEFAULT '[]'" },
    { name: 'show_compensation_in_pdf', definition: 'INTEGER DEFAULT 1' },
    { name: 'period_mode', definition: "TEXT NOT NULL DEFAULT 'monthly'" },
    { name: 'period_start', definition: 'TEXT' },
    { name: 'period_end', definition: 'TEXT' },
    { name: 'month_reference', definition: 'TEXT' },
    { name: 'company_name', definition: 'TEXT' },
    { name: 'title', definition: 'TEXT' },
    { name: 'employer_labels_json', definition: 'TEXT' },
    { name: 'recipient_email', definition: 'TEXT' },
    { name: 'notes', definition: 'TEXT' },
  ];

  for (const column of requiredColumns) {
    if (!existingColumns.has(column.name)) {
      db.prepare(
        `ALTER TABLE communications ADD COLUMN ${column.name} ${column.definition}`
      ).run();
      console.log(`communications schema: ${column.name} added`);
    } else {
      console.log(`communications schema: ${column.name} already exists`);
    }
  }
}

function mapCommunicationRow(row, details = []) {
  const employerLabels = parseJsonArray(row.employer_labels_json, []);
  const selectedEmployeeIds = parseJsonArray(row.selected_employee_ids_json, []);

  return {
    ...row,
    detail_count: Number(row.detail_count || details.length || 0),
    employer_labels: Array.isArray(employerLabels) ? employerLabels : [],
    selected_employee_ids: Array.isArray(selectedEmployeeIds) ? selectedEmployeeIds.map((value) => Number(value)).filter(Number.isFinite) : [],
    show_compensation_in_pdf: row.show_compensation_in_pdf !== 0,
    details,
    pdf_file: row.pdf_relative_path
      ? describeStoredFile({
          id: `communication_pdf_${row.id}`,
          file_name: path.basename(row.pdf_relative_path),
          stored_name: path.basename(row.pdf_relative_path),
          relative_path: row.pdf_relative_path,
          mime_type: 'application/pdf',
          size_bytes: 0,
          sha256: row.pdf_sha256 || '',
          file_created_at: row.pdf_created_at || row.updated_at,
          uploaded_at: row.updated_at,
          updated_at: row.updated_at,
        })
      : null,
    excel_file: row.excel_relative_path
      ? describeStoredFile({
          id: `communication_excel_${row.id}`,
          file_name: path.basename(row.excel_relative_path),
          stored_name: path.basename(row.excel_relative_path),
          relative_path: row.excel_relative_path,
          mime_type: 'application/vnd.ms-excel',
          size_bytes: 0,
          sha256: row.excel_sha256 || '',
          file_created_at: row.excel_created_at || row.updated_at,
          uploaded_at: row.updated_at,
          updated_at: row.updated_at,
        })
      : null,
  };
}

function getCommunicationDetails(communicationId) {
  const db = getDb();
  ensureCommunicationsSchema(db);
  return db.prepare(`
    SELECT
      id,
      communication_id,
      employee_id,
      employee_label,
      giornate_primo,
      giornate_secondo,
      detail_note,
      sort_order,
      created_at,
      updated_at
    FROM communication_details
    WHERE communication_id = ?
    ORDER BY sort_order ASC, employee_label COLLATE NOCASE ASC, id ASC
  `).all(communicationId).map((row) => ({
    ...row,
    giornate_primo: normalizeNumber(row.giornate_primo),
    giornate_secondo: normalizeNumber(row.giornate_secondo),
    detail_note: row.detail_note || '',
  }));
}

function getCommunicationById(id) {
  const db = getDb();
  ensureCommunicationsSchema(db);
  const row = db.prepare(`
    ${getCommunicationBaseSelect()}
    WHERE c.id = ?
    GROUP BY c.id
    LIMIT 1
  `).get(id);

  if (!row) return null;
  return mapCommunicationRow(row, getCommunicationDetails(id));
}

function listCommunications(options = {}) {
  const db = getDb();
  ensureCommunicationsSchema(db);
  const conditions = [];
  const params = [];
  const requestedLimit = Number(options.limit || 0) || 0;
  const limit = requestedLimit > 0 ? Math.max(1, Math.min(requestedLimit, 200)) : 0;
  const offset = Math.max(0, Number(options.offset || 0) || 0);
  const search = String(options.search || '').trim().toLowerCase();

  if (options.year) {
    conditions.push(`
      (
        substr(COALESCE(c.month_reference, ''), 1, 4) = ?
        OR substr(COALESCE(c.period_start, ''), 1, 4) = ?
        OR substr(COALESCE(c.period_end, ''), 1, 4) = ?
      )
    `);
    params.push(String(options.year), String(options.year), String(options.year));
  }

  if (search) {
    conditions.push(`
      LOWER(
        COALESCE(c.company_name, '') || ' ' ||
        COALESCE(c.subject, '') || ' ' ||
        COALESCE(c.month_reference, '') || ' ' ||
        COALESCE(c.period_start, '') || ' ' ||
        COALESCE(c.period_end, '') || ' ' ||
        COALESCE(c.file_name_pdf, '') || ' ' ||
        COALESCE(c.file_name_excel, '')
      ) LIKE ?
    `);
    params.push(`%${search}%`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const totalRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM communications c
    ${whereClause}
  `).get(...params);
  const total = Number(totalRow?.total || 0);
  const paginationSql = limit ? 'LIMIT ? OFFSET ?' : '';
  const queryParams = limit ? [...params, limit, offset] : params;
  const rows = db.prepare(`
    ${getCommunicationBaseSelect()}
    ${whereClause}
    GROUP BY c.id
    ORDER BY COALESCE(c.month_reference, substr(c.period_start, 1, 7)) DESC, c.created_at DESC, c.id DESC
    ${paginationSql}
  `).all(...queryParams);

  const detailsMap = new Map();
  if (rows.length) {
    const placeholders = rows.map(() => '?').join(', ');
    const detailRows = db.prepare(`
      SELECT
        id,
        communication_id,
        employee_id,
        employee_label,
        giornate_primo,
        giornate_secondo,
        detail_note,
        sort_order,
        created_at,
        updated_at
      FROM communication_details
      WHERE communication_id IN (${placeholders})
      ORDER BY communication_id ASC, sort_order ASC, employee_label COLLATE NOCASE ASC, id ASC
    `).all(...rows.map((row) => row.id));

    for (const row of detailRows) {
      const list = detailsMap.get(row.communication_id) || [];
      list.push({
        ...row,
        giornate_primo: normalizeNumber(row.giornate_primo),
        giornate_secondo: normalizeNumber(row.giornate_secondo),
        detail_note: row.detail_note || '',
      });
      detailsMap.set(row.communication_id, list);
    }
  }

  const items = rows.map((row) => mapCommunicationRow(row, detailsMap.get(row.id) || []));

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

function listCommunicationYears() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT month_reference, period_start, period_end
    FROM communications
  `).all();

  const years = new Set();
  for (const row of rows) {
    const values = [row.month_reference, row.period_start, row.period_end];
    for (const value of values) {
      const year = Number(String(value || '').slice(0, 4));
      if (Number.isInteger(year) && year > 1900) {
        years.add(year);
      }
    }
  }

  return [...years].sort((a, b) => b - a);
}

function normalizeCommunicationPayload(payload = {}) {
  const settings = settingsService.getSettings();
  const employerOptions = settingsService.getEmployerOptions(settings);
  const periodStart = normalizeDate(payload.period_start);
  const periodEnd = normalizeDate(payload.period_end);

  if (!periodStart || !periodEnd) {
    throw new Error('Periodo comunicazione non valido.');
  }

  if (periodEnd < periodStart) {
    throw new Error('La data finale non puo essere precedente alla data iniziale.');
  }

  const details = Array.isArray(payload.details)
    ? payload.details.map((detail, index) => ({
        employee_id: detail.employee_id ? Number(detail.employee_id) : null,
        employee_label: String(detail.employee_label || '').trim(),
        giornate_primo: normalizeNumber(detail.giornate_primo),
        giornate_secondo: normalizeNumber(detail.giornate_secondo),
        detail_note: normalizeDetailNote(detail.detail_note),
        sort_order: Number.isFinite(Number(detail.sort_order)) ? Number(detail.sort_order) : index,
      }))
    : [];

  const validDetails = details.filter((detail) => detail.employee_label);

  if (!validDetails.length) {
    throw new Error('Inserisci almeno un dipendente nella comunicazione.');
  }

  return {
    id: payload.id ? Number(payload.id) : null,
    period_mode: payload.period_mode === 'custom' ? 'custom' : 'monthly',
    period_start: periodStart,
    period_end: periodEnd,
    month_reference: normalizeString(payload.month_reference),
    company_name: normalizeString(payload.company_name) || settings.company.document_header || settings.company.name,
    title: normalizeString(payload.title) || 'Elenco giornate',
    employer_labels_json: JSON.stringify(
      (Array.isArray(payload.employer_labels) && payload.employer_labels.length
        ? payload.employer_labels
        : employerOptions)
    ),
    recipient_email: normalizeString(payload.recipient_email),
    selected_employee_ids_json: JSON.stringify(
      (Array.isArray(payload.selected_employee_ids) ? payload.selected_employee_ids : [])
        .map((value) => Number(value))
        .filter(Number.isFinite)
    ),
    show_compensation_in_pdf: payload.show_compensation_in_pdf !== false ? 1 : 0,
    notes: normalizeString(payload.notes),
    details: validDetails,
  };
}

function saveCommunication(payload = {}) {
  const db = getDb();
  ensureCommunicationsSchema(db);
  const communicationColumns = db.prepare("PRAGMA table_info(communications)").all();
  console.log(
    'communications schema columns before save:',
    communicationColumns.map((column) => column.name)
  );
  const normalized = normalizeCommunicationPayload(payload);
  const overwriteExisting = !!payload.overwrite_existing;

  if (normalized.period_mode === 'monthly' && normalized.month_reference) {
    const existing = db.prepare(`
      SELECT id
      FROM communications
      WHERE period_mode = 'monthly'
        AND month_reference = ?
        AND id != COALESCE(?, -1)
      LIMIT 1
    `).get(normalized.month_reference, normalized.id || null);

    if (existing && !overwriteExisting) {
      const error = new Error('Esiste già una comunicazione per questo mese.');
      error.code = 'COMMUNICATION_MONTH_EXISTS';
      error.existingId = existing.id;
      throw error;
    }

    if (existing && overwriteExisting && !normalized.id) {
      normalized.id = existing.id;
    }
  }

  const upsertTx = db.transaction((input) => {
    let communicationId = input.id;

    if (communicationId) {
      db.prepare(`
        UPDATE communications
        SET period_mode = @period_mode,
            period_start = @period_start,
            period_end = @period_end,
            month_reference = @month_reference,
            company_name = @company_name,
            title = @title,
            employer_labels_json = @employer_labels_json,
            recipient_email = @recipient_email,
            selected_employee_ids_json = @selected_employee_ids_json,
            show_compensation_in_pdf = @show_compensation_in_pdf,
            notes = @notes,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
      `).run(input);

      db.prepare(`
        DELETE FROM communication_details
        WHERE communication_id = ?
      `).run(communicationId);
    } else {
      const result = db.prepare(`
        INSERT INTO communications (
          period_mode, period_start, period_end, month_reference, company_name, title, employer_labels_json, recipient_email, selected_employee_ids_json, show_compensation_in_pdf, notes
        ) VALUES (
          @period_mode, @period_start, @period_end, @month_reference, @company_name, @title, @employer_labels_json, @recipient_email, @selected_employee_ids_json, @show_compensation_in_pdf, @notes
        )
      `).run(input);
      communicationId = result.lastInsertRowid;
    }

    const insertDetail = db.prepare(`
      INSERT INTO communication_details (
        communication_id, employee_id, employee_label, giornate_primo, giornate_secondo, detail_note, sort_order
      ) VALUES (
        @communication_id, @employee_id, @employee_label, @giornate_primo, @giornate_secondo, @detail_note, @sort_order
      )
    `);

    input.details.forEach((detail, index) => {
      insertDetail.run({
        communication_id: communicationId,
        employee_id: detail.employee_id || null,
        employee_label: detail.employee_label,
        giornate_primo: detail.giornate_primo,
        giornate_secondo: detail.giornate_secondo,
        detail_note: detail.detail_note,
        sort_order: Number.isFinite(detail.sort_order) ? detail.sort_order : index,
      });
    });

    return Number(communicationId);
  });

  const id = upsertTx(normalized);
  return getCommunicationById(id);
}

function deleteCommunication(id) {
  const db = getDb();
  const communication = getCommunicationById(id);
  if (!communication) {
    return {
      success: false,
      message: 'Comunicazione non trovata.',
    };
  }

  [communication.pdf_relative_path, communication.excel_relative_path].forEach((relativePath) => {
    if (!relativePath) return;
    const absolutePath = getAbsolutePath(relativePath);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  });

  db.prepare(`
    DELETE FROM communications
    WHERE id = ?
  `).run(id);

  return { success: true };
}

function updateCommunicationFiles(id, files = {}) {
  const db = getDb();
  db.prepare(`
    UPDATE communications
    SET pdf_relative_path = COALESCE(@pdf_relative_path, pdf_relative_path),
        pdf_sha256 = COALESCE(@pdf_sha256, pdf_sha256),
        pdf_created_at = COALESCE(@pdf_created_at, pdf_created_at),
        excel_relative_path = COALESCE(@excel_relative_path, excel_relative_path),
        excel_sha256 = COALESCE(@excel_sha256, excel_sha256),
        excel_created_at = COALESCE(@excel_created_at, excel_created_at),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id,
    pdf_relative_path: files.pdf_relative_path || null,
    pdf_sha256: files.pdf_sha256 || null,
    pdf_created_at: files.pdf_created_at || null,
    excel_relative_path: files.excel_relative_path || null,
    excel_sha256: files.excel_sha256 || null,
    excel_created_at: files.excel_created_at || null,
  });

  return getCommunicationById(id);
}

function buildFileBaseName(communication) {
  const company = sanitizeSegment(communication.company_name || 'comunicazione');
  const start = sanitizeSegment(communication.period_start);
  const end = sanitizeSegment(communication.period_end);
  return `${company || 'comunicazione'}-${start}-${end}-id-${communication.id}`;
}

function getCommunicationFileTargets(communication) {
  const baseName = buildFileBaseName(communication);
  const pdfFileName = `${baseName}.pdf`;
  const excelFileName = `${baseName}.xls`;

  ensureCommunicationFilesDir(communication.id);

  return {
    pdf: {
      fileName: pdfFileName,
      relativePath: buildRelativePath(communication.id, pdfFileName),
      absolutePath: getAbsolutePath(buildRelativePath(communication.id, pdfFileName)),
    },
    excel: {
      fileName: excelFileName,
      relativePath: buildRelativePath(communication.id, excelFileName),
      absolutePath: getAbsolutePath(buildRelativePath(communication.id, excelFileName)),
    },
  };
}

function buildCommunicationPdfHtml(communication) {
  const settings = settingsService.getSettings();
  const employerLabels = Array.isArray(communication.employer_labels) && communication.employer_labels.length
    ? communication.employer_labels
    : settingsService.getEmployerOptions(settings);
  const secondaryEmployer = employerLabels[1] || null;
  const periodLabel = formatPeriodLabel(communication.period_start, communication.period_end);
  const createdLabel = formatDateTimeLabel(communication.created_at || communication.updated_at);
  const communicationMonth = getCommunicationMonth(communication);
  const selectedIds = Array.isArray(communication.selected_employee_ids) ? communication.selected_employee_ids : [];
  const filteredDetails = selectedIds.length
    ? communication.details.filter((detail) => selectedIds.includes(Number(detail.employee_id)))
    : communication.details;
  const showCompensationColumn = communication.show_compensation_in_pdf !== false;
  const rowsHtml = filteredDetails.map((detail) => {
    const compensation = getDetailCompensation(detail, communicationMonth);

    return `
      <tr>
        <td>${escapeHtml(detail.employee_label)}</td>
        <td style="text-align:center;">${escapeHtml(formatDecimal(detail.giornate_primo))}</td>
        ${secondaryEmployer ? `<td style="text-align:center;">${escapeHtml(formatDecimal(detail.giornate_secondo))}</td>` : ''}
        ${showCompensationColumn ? `<td style="text-align:right; white-space:nowrap; font-weight:700;">${compensation ? escapeHtml(formatCurrency(compensation.totale)) : '&mdash;'}</td>` : ''}
        <td>${escapeHtml(detail.detail_note || '')}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #14213d; padding: 18px 22px;">
      <div style="display:flex; justify-content:space-between; gap:18px; align-items:flex-start; margin-bottom:18px;">
        <div>
          <div style="font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:#0f766e; font-weight:800;">
            ${escapeHtml(communication.company_name || settings.company.document_header || settings.company.name)}
          </div>
          <h1 style="margin:8px 0 6px; font-size:24px;">${escapeHtml(communication.title || 'Elenco giornate')}</h1>
          <div style="font-size:13px; color:#52606d;">Periodo: ${escapeHtml(periodLabel)}</div>
        </div>
        <div style="min-width:220px; border:1px solid #d7e2e8; border-radius:16px; padding:12px 14px; background:#f8fbfb;">
          <div style="font-size:12px; color:#52606d; margin-bottom:6px;">Creato il</div>
          <div style="font-size:15px; font-weight:700;">${escapeHtml(createdLabel)}</div>
        </div>
      </div>

      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead>
          <tr>
            <th style="padding:10px 12px; text-align:left;">Nome dipendente</th>
            <th style="padding:10px 12px; text-align:center;">${escapeHtml(`${employerLabels[0]?.short_name || 'D1'} (${employerLabels[0]?.name || 'Datore 1'})`)}</th>
            ${secondaryEmployer ? `<th style="padding:10px 12px; text-align:center;">${escapeHtml(`${secondaryEmployer.short_name} (${secondaryEmployer.name})`)}</th>` : ''}
            ${showCompensationColumn ? '<th style="padding:10px 12px; text-align:right;">Compenso</th>' : ''}
            <th style="padding:10px 12px; text-align:left;">Note</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <style>
        table, th, td { border: 1px solid #d7e2e8; }
        th { background: #eff5f5; font-weight: 700; }
        td { padding: 9px 12px; }
      </style>
    </div>
  `;
}

function buildCommunicationExcelXml(communication) {
  const settings = settingsService.getSettings();
  const employerLabels = Array.isArray(communication.employer_labels) && communication.employer_labels.length
    ? communication.employer_labels
    : settingsService.getEmployerOptions(settings);
  const secondaryEmployer = employerLabels[1] || null;
  const communicationMonth = getCommunicationMonth(communication);
  const mergeAcross = secondaryEmployer ? 4 : 3;
  const rows = communication.details.map((detail) => {
    const compensation = getDetailCompensation(detail, communicationMonth);

    return `
        <Row>
          <Cell><Data ss:Type="String">${escapeXml(detail.employee_label)}</Data></Cell>
          <Cell><Data ss:Type="Number">${normalizeNumber(detail.giornate_primo)}</Data></Cell>
          ${secondaryEmployer ? `<Cell><Data ss:Type="Number">${normalizeNumber(detail.giornate_secondo)}</Data></Cell>` : ''}
          ${compensation ? `<Cell ss:StyleID="Money"><Data ss:Type="Number">${normalizeNumber(compensation.totale)}</Data></Cell>` : '<Cell><Data ss:Type="String">-</Data></Cell>'}
          <Cell><Data ss:Type="String">${escapeXml(detail.detail_note || '')}</Data></Cell>
        </Row>
    `;
  }).join('');

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Author>GPA 1.0.2</Author>
    <Created>${new Date().toISOString()}</Created>
  </DocumentProperties>
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#EAF4F2" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="Title">
      <Font ss:Bold="1" ss:Size="14"/>
    </Style>
    <Style ss:ID="Money">
      <NumberFormat ss:Format="&quot;€&quot; #,##0.00"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Comunicazione">
    <Table>
      <Column ss:Width="220"/>
      <Column ss:Width="120"/>
      ${secondaryEmployer ? '<Column ss:Width="120"/>' : ''}
      <Column ss:Width="130"/>
      <Column ss:Width="240"/>
      <Row>
        <Cell ss:MergeAcross="${mergeAcross}" ss:StyleID="Title"><Data ss:Type="String">${escapeXml(communication.company_name || settings.company.document_header || settings.company.name)}</Data></Cell>
      </Row>
      <Row>
        <Cell ss:MergeAcross="${mergeAcross}" ss:StyleID="Title"><Data ss:Type="String">${escapeXml(communication.title || 'Elenco giornate')}</Data></Cell>
      </Row>
      <Row>
        <Cell ss:MergeAcross="${mergeAcross}"><Data ss:Type="String">Periodo ${escapeXml(formatPeriodLabel(communication.period_start, communication.period_end))}</Data></Cell>
      </Row>
      <Row/>
      <Row>
        <Cell ss:StyleID="Header"><Data ss:Type="String">Nome dipendente</Data></Cell>
        <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(`${employerLabels[0]?.short_name || 'D1'} (${employerLabels[0]?.name || 'Datore 1'})`)}</Data></Cell>
        ${secondaryEmployer ? `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(`${secondaryEmployer.short_name} (${secondaryEmployer.name})`)}</Data></Cell>` : ''}
        <Cell ss:StyleID="Header"><Data ss:Type="String">Compenso mese</Data></Cell>
        <Cell ss:StyleID="Header"><Data ss:Type="String">Note</Data></Cell>
      </Row>
      ${rows}
    </Table>
  </Worksheet>
</Workbook>`;
}

function openCommunicationFile(id, type) {
  const communication = getCommunicationById(id);
  if (!communication) {
    return {
      success: false,
      message: 'Comunicazione non trovata.',
    };
  }

  const relativePath = type === 'excel'
    ? communication.excel_relative_path
    : communication.pdf_relative_path;

  return openStoredDocument(relativePath);
}

function chunkBase64(buffer) {
  const base64 = buffer.toString('base64');
  return base64.match(/.{1,76}/g)?.join('\r\n') || '';
}

function sanitizeEmailHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function getAttachmentContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.xls') return 'application/vnd.ms-excel';
  if (extension === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/octet-stream';
}

async function openCommunicationEmail(id, options = {}) {
  const communication = getCommunicationById(id);
  if (!communication) {
    throw new Error('Comunicazione non trovata.');
  }

  if (!communication.pdf_relative_path) {
    throw new Error('PDF comunicazione non disponibile.');
  }

  const includeExcel = !!options.includeExcel;
  const pdfPath = getAbsolutePath(communication.pdf_relative_path);
  const attachmentPaths = [pdfPath];

  if (includeExcel) {
    if (!communication.excel_relative_path) {
      throw new Error('Excel comunicazione non disponibile.');
    }

    attachmentPaths.push(getAbsolutePath(communication.excel_relative_path));
  }

  const missing = attachmentPaths.find((filePath) => !fs.existsSync(filePath));
  if (missing) {
    throw new Error('Uno degli allegati della comunicazione non esiste piu sul disco.');
  }

  const recipient = normalizeString(options.recipient_email || communication.recipient_email) || '';
  const monthLabel = formatMonthYearUppercase(getCommunicationMonth(communication));
  const periodLabel = formatPeriodLabel(communication.period_start, communication.period_end);
  const subject = `RICHIESTA BUSTE PAGA DI ${monthLabel || String(periodLabel || '').toUpperCase()}`;
  const body = [
    `Buongiorno,`,
    ``,
    `invio la comunicazione giornate relativa al periodo ${periodLabel}.`,
    ``,
    `Cordiali saluti.`,
  ].filter(Boolean).join('\r\n');

  const boundary = `----=_Comunicazione_${Date.now()}`;
  let emlContent = '';
  emlContent += `To: ${sanitizeEmailHeader(recipient)}\r\n`;
  emlContent += `Subject: ${sanitizeEmailHeader(subject)}\r\n`;
  emlContent += `X-Unsent: 1\r\n`;
  emlContent += `MIME-Version: 1.0\r\n`;
  emlContent += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
  emlContent += `\r\n`;
  emlContent += `--${boundary}\r\n`;
  emlContent += `Content-Type: text/plain; charset="utf-8"\r\n`;
  emlContent += `Content-Transfer-Encoding: 8bit\r\n\r\n`;
  emlContent += `${body}\r\n`;

  attachmentPaths.forEach((filePath) => {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    emlContent += `--${boundary}\r\n`;
    emlContent += `Content-Type: ${getAttachmentContentType(filePath)}; name="${sanitizeEmailHeader(fileName)}"\r\n`;
    emlContent += `Content-Transfer-Encoding: base64\r\n`;
    emlContent += `Content-Disposition: attachment; filename="${sanitizeEmailHeader(fileName)}"\r\n\r\n`;
    emlContent += `${chunkBase64(fileBuffer)}\r\n`;
  });

  emlContent += `--${boundary}--\r\n`;

  const draftsDir = path.join(ensureCommunicationFilesDir(communication.id), 'emails');
  fs.mkdirSync(draftsDir, { recursive: true });
  const draftPath = path.join(draftsDir, `comunicazione-${communication.id}.eml`);
  fs.writeFileSync(draftPath, emlContent, 'utf8');

  const openResult = await shell.openPath(draftPath);
  return {
    success: !openResult,
    message: openResult || null,
    recipient,
    pdfPath,
    attachmentPaths,
    draftPath,
    method: 'eml',
    senderNotice: "Verifica il client email predefinito e l'account mittente configurato.",
  };
}

try {
  ensureCommunicationsSchema(getDb());
} catch (error) {
  console.error('communications schema init failed:', error?.message || error);
}

module.exports = {
  buildCommunicationExcelXml,
  buildCommunicationPdfHtml,
  openCommunicationEmail,
  deleteCommunication,
  ensureCommunicationsSchema,
  getCommunicationById,
  getCommunicationFileTargets,
  listCommunications,
  listCommunicationYears,
  openCommunicationFile,
  saveCommunication,
  updateCommunicationFiles,
};
