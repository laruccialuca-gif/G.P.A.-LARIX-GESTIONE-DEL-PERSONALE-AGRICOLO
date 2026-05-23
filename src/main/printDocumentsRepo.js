const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const { execFile } = require('child_process');
const { getDb } = require('./db');
const { getAbsolutePath, openStoredDocument } = require('./documentService');

const EMPLOYEE_CATEGORY_LABELS = {
  hire_attachment: 'Assunzione',
  art37_attachment: 'Formazione Art. 37',
  medical_visit_attachment: 'Visita medica',
  dpi_delivery_attachment: 'DPI',
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeDate(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  return raw.slice(0, 10);
}

function buildEmployeeName(firstName, lastName) {
  return `${normalizeText(lastName)} ${normalizeText(firstName)}`.trim() || normalizeText(firstName) || normalizeText(lastName);
}

function getEmployeeDocumentTypeLabel(category) {
  const normalized = normalizeText(category);
  if (normalized.startsWith('hire_attachment__period__')) {
    return 'Assunzione rapporto';
  }
  return EMPLOYEE_CATEGORY_LABELS[normalized] || 'Allegato dipendente';
}

function listPrintableDocuments(filters = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (Number(filters.employeeId || 0) > 0) {
    conditions.push('documents.employee_id = ?');
    params.push(Number(filters.employeeId));
  }

  const documentType = normalizeText(filters.documentType);
  if (documentType) {
    conditions.push('documents.document_type = ?');
    params.push(documentType);
  }

  const monthReference = normalizeDate(filters.monthReference).slice(0, 7);
  if (monthReference) {
    conditions.push('documents.month_reference = ?');
    params.push(monthReference);
  }

  const uploadDate = normalizeDate(filters.uploadDate);
  if (uploadDate) {
    conditions.push('documents.upload_date = ?');
    params.push(uploadDate);
  }

  const search = normalizeText(filters.search).toLowerCase();
  if (search) {
    conditions.push(`
      LOWER(
        COALESCE(documents.employee_name, '') || ' ' ||
        COALESCE(documents.document_type_label, '') || ' ' ||
        COALESCE(documents.file_name, '') || ' ' ||
        COALESCE(documents.origin_label, '')
      ) LIKE ?
    `);
    params.push(`%${search}%`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT *
    FROM (
      SELECT
        'employee_document' AS source_kind,
        ed.id AS source_id,
        e.id AS employee_id,
        e.first_name,
        e.last_name,
        CASE
          WHEN ed.category LIKE 'hire_attachment__period__%' THEN 'hire_period_attachment'
          ELSE ed.category
        END AS document_type,
        ed.category AS source_category,
        ed.file_name,
        ed.relative_path,
        ed.mime_type,
        COALESCE(ed.file_created_at, ed.uploaded_at, ed.updated_at, '') AS source_date,
        substr(COALESCE(ed.file_created_at, ed.uploaded_at, ed.updated_at, ''), 1, 10) AS upload_date,
        CASE
          WHEN ed.category LIKE 'hire_attachment__period__%' THEN substr(COALESCE(ed.file_created_at, ed.uploaded_at, ed.updated_at, ''), 1, 7)
          ELSE substr(COALESCE(ed.file_created_at, ed.uploaded_at, ed.updated_at, ''), 1, 7)
        END AS month_reference,
        CASE
          WHEN ed.category LIKE 'hire_attachment__period__%' THEN 'Rapporto di lavoro'
          ELSE 'Scheda dipendente'
        END AS origin_label
      FROM employee_documents ed
      JOIN employees e ON e.id = ed.employee_id

      UNION ALL

      SELECT
        'payroll_document' AS source_kind,
        pd.id AS source_id,
        e.id AS employee_id,
        e.first_name,
        e.last_name,
        'payroll_slip' AS document_type,
        pd.category AS source_category,
        pd.file_name,
        pd.relative_path,
        pd.mime_type,
        COALESCE(pd.file_created_at, pd.uploaded_at, pd.updated_at, '') AS source_date,
        substr(COALESCE(pd.file_created_at, pd.uploaded_at, pd.updated_at, ''), 1, 10) AS upload_date,
        pr.month AS month_reference,
        'Buste paga' AS origin_label
      FROM payroll_documents pd
      JOIN payroll_records pr ON pr.id = pd.payroll_record_id
      JOIN employees e ON e.id = pr.employee_id
      WHERE pd.category = 'payroll_slip'

      UNION ALL

      SELECT
        'communication_pdf' AS source_kind,
        c.id AS source_id,
        NULL AS employee_id,
        '' AS first_name,
        '' AS last_name,
        'communication_pdf' AS document_type,
        'communication_pdf' AS source_category,
        '' AS file_name,
        c.pdf_relative_path AS relative_path,
        'application/pdf' AS mime_type,
        COALESCE(c.pdf_created_at, c.updated_at, c.created_at, '') AS source_date,
        substr(COALESCE(c.pdf_created_at, c.updated_at, c.created_at, ''), 1, 10) AS upload_date,
        COALESCE(NULLIF(c.month_reference, ''), substr(COALESCE(c.pdf_created_at, c.updated_at, c.created_at, ''), 1, 7)) AS month_reference,
        'Comunicazioni' AS origin_label
      FROM communications c
      WHERE COALESCE(c.pdf_relative_path, '') <> ''

      UNION ALL

      SELECT
        'communication_excel' AS source_kind,
        c.id AS source_id,
        NULL AS employee_id,
        '' AS first_name,
        '' AS last_name,
        'communication_excel' AS document_type,
        'communication_excel' AS source_category,
        '' AS file_name,
        c.excel_relative_path AS relative_path,
        'application/vnd.ms-excel' AS mime_type,
        COALESCE(c.excel_created_at, c.updated_at, c.created_at, '') AS source_date,
        substr(COALESCE(c.excel_created_at, c.updated_at, c.created_at, ''), 1, 10) AS upload_date,
        COALESCE(NULLIF(c.month_reference, ''), substr(COALESCE(c.excel_created_at, c.updated_at, c.created_at, ''), 1, 7)) AS month_reference,
        'Comunicazioni' AS origin_label
      FROM communications c
      WHERE COALESCE(c.excel_relative_path, '') <> ''
    ) AS documents
    ${whereClause}
    ORDER BY
      COALESCE(documents.month_reference, '') DESC,
      COALESCE(documents.upload_date, '') DESC,
      documents.last_name COLLATE NOCASE ASC,
      documents.first_name COLLATE NOCASE ASC,
      documents.file_name COLLATE NOCASE ASC
  `).all(...params);

  return rows
    .filter((row) => normalizeText(row.relative_path))
    .map((row) => {
      const absolutePath = getAbsolutePath(row.relative_path);
      const fallbackFileName = path.basename(row.relative_path || '') || 'documento';
      return {
        source_kind: row.source_kind,
        source_id: Number(row.source_id || 0),
        employee_id: row.employee_id ? Number(row.employee_id) : null,
        employee_name: buildEmployeeName(row.first_name, row.last_name) || '',
        document_type: row.document_type,
        document_type_label:
          row.source_kind === 'employee_document'
            ? getEmployeeDocumentTypeLabel(row.source_category)
            : row.document_type === 'payroll_slip'
            ? 'Busta paga'
            : row.document_type === 'communication_pdf'
            ? 'Comunicazione PDF'
            : row.document_type === 'communication_excel'
            ? 'Comunicazione Excel'
            : 'Documento',
        file_name: normalizeText(row.file_name) || fallbackFileName,
        mime_type: normalizeText(row.mime_type) || 'application/octet-stream',
        relative_path: row.relative_path,
        upload_date: normalizeDate(row.upload_date),
        month_reference: normalizeDate(row.month_reference).slice(0, 7),
        origin_label: row.origin_label || 'Gestionale',
        exists: fs.existsSync(absolutePath),
      };
    });
}

function openPrintableDocument(relativePath) {
  return openStoredDocument(relativePath);
}

function printPrintableDocument(relativePath) {
  if (!relativePath) {
    return Promise.resolve({
      success: false,
      message: 'Nessun file allegato.',
    });
  }

  const absolutePath = getAbsolutePath(relativePath);
  if (!fs.existsSync(absolutePath)) {
    return Promise.resolve({
      success: false,
      message: 'Il file allegato non esiste piu sul disco.',
    });
  }

  if (process.platform !== 'win32') {
    return Promise.resolve(openStoredDocument(relativePath));
  }

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Start-Process -LiteralPath $args[0] -Verb Print',
        absolutePath,
      ],
      (error) => {
        if (error) {
          resolve({
            success: false,
            message: error.message || 'Impossibile inviare il file alla stampa.',
          });
          return;
        }

        resolve({
          success: true,
          message: null,
        });
      }
    );
  });
}

async function exportPrintableDocument(browserWindow, relativePath, suggestedFileName = '') {
  if (!relativePath) {
    return {
      canceled: true,
      message: 'Nessun file da esportare.',
    };
  }

  const absolutePath = getAbsolutePath(relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      canceled: true,
      message: 'Il file allegato non esiste piu sul disco.',
    };
  }

  const defaultPath = normalizeText(suggestedFileName) || path.basename(absolutePath);

  const result = await dialog.showSaveDialog(browserWindow || null, {
    title: 'Esporta documento',
    defaultPath,
  });

  if (result.canceled || !result.filePath) {
    return {
      canceled: true,
    };
  }

  fs.copyFileSync(absolutePath, result.filePath);
  return {
    canceled: false,
    file_path: result.filePath,
  };
}

module.exports = {
  exportPrintableDocument,
  listPrintableDocuments,
  openPrintableDocument,
  printPrintableDocument,
};
