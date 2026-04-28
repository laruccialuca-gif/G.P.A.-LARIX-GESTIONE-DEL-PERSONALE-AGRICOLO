const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getDocumentsDir } = require('./storagePaths');
const employeeRepo = require('./employeeRepo');

// In production the file lives in app.asar.unpacked, not app.asar (execFile requires a real fs path).
// In dev __dirname has no 'app.asar' component, so the replace is a no-op.
const OCR_BINARY = path.join(
  __dirname.replace('app.asar' + path.sep + 'src' + path.sep + 'main', 'app.asar.unpacked' + path.sep + 'src' + path.sep + 'main'),
  'pdf-ocr'
);
const PLATFORM = process.platform; // 'darwin' | 'win32' | 'linux'

// Set by init() from main.js after app is ready.
// Default to __dirname/tessdata for dev; init() overrides with app.getPath('userData')/tessdata.
let TESSDATA_DIR = path.join(__dirname, 'tessdata');

// Called once from main.js inside app.whenReady() so TESSDATA_DIR points to a writable location.
function init({ userDataDir }) {
  TESSDATA_DIR = path.join(userDataDir, 'tessdata');
}

// ── Text extraction via pdfjs-dist (no canvas, any platform) ─────────────────
// Uses PDF's embedded text when available (fast, exact).
// Returns [{pageNumber, items:[{t,x,y,w,h}]}] — normalized 0-1, origin bottom-left.
async function extractTextPages(filePath) {
  try {
    // Suppress pdfjs-dist warnings about missing 'canvas' package (not needed for text-only extraction)
    const origWarn = console.warn;
    console.warn = (...args) => { if (typeof args[0] === 'string' && args[0].includes('Cannot polyfill')) return; origWarn(...args); };
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    console.warn = origWarn;
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjsLib.getDocument({ data, disableRange: true, disableStream: true }).promise;
    const result = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });
      const textContent = await page.getTextContent();
      const items = textContent.items
        .filter((item) => item.str && item.str.trim())
        .map((item) => ({
          t: item.str.trim(),
          // transform[4]=x, transform[5]=y in PDF points (origin bottom-left)
          x: item.transform[4] / viewport.width,
          y: item.transform[5] / viewport.height,
          w: (item.width || 0) / viewport.width,
          h: (item.height || 0) / viewport.height,
        }));
      result.push({ pageNumber: i - 1, items });
    }
    return result;
  } catch (e) {
    console.warn('[pdfImport] text extraction failed:', e.message);
    return [];
  }
}

function hasSubstantialText(pages) {
  if (!pages.length) return false;
  const totalChars = pages.reduce(
    (sum, p) => sum + p.items.reduce((s, i) => s + i.t.replace(/\s/g, '').length, 0),
    0
  );
  return totalChars > pages.length * 30;
}

// ── macOS: Swift + PDFKit + Vision ───────────────────────────────────────────
// Returns [{pageNumber, items:[{t,x,y,w,h}]}]
async function runSwiftOcr(filePath) {
  return new Promise((resolve, reject) => {
    execFile(OCR_BINARY, [filePath], { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`OCR error: ${err.message}\n${stderr}`));
      const pages = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          pages.push({ pageNumber: obj.page, items: obj.items || [] });
        } catch (e) { /* skip malformed lines */ }
      }
      resolve(pages);
    });
  });
}

// ── Windows: pdfjs-dist + @napi-rs/canvas → Tesseract.js ─────────────────────
// Returns [{pageNumber, items:[{t,x,y,w,h}]}]
async function runTesseractOcr(filePath) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  const { createCanvas } = require('@napi-rs/canvas');
  const { createWorker } = require('tesseract.js');

  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data, disableRange: true, disableStream: true }).promise;

  fs.mkdirSync(TESSDATA_DIR, { recursive: true });
  const worker = await createWorker(['ita', 'eng'], 1, { langPath: TESSDATA_DIR });

  const result = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const scale = 2.0;
      const viewport = page.getViewport({ scale });
      const w = Math.ceil(viewport.width);
      const h = Math.ceil(viewport.height);
      const canvas = createCanvas(w, h);
      const ctx = canvas.getContext('2d');

      await page.render({
        canvasContext: ctx,
        viewport,
        canvasFactory: {
          create: (cw, ch) => { const c = createCanvas(cw, ch); return { canvas: c, context: c.getContext('2d') }; },
          reset: (pair, cw, ch) => { pair.canvas.width = cw; pair.canvas.height = ch; },
          destroy: () => {},
        },
      }).promise;

      const pngBuffer = canvas.toBuffer('image/png');
      const { data: ocrData } = await worker.recognize(pngBuffer);

      // Tesseract bbox: origin top-left (y0=top, y1=bottom).
      // Convert to Vision-style: origin bottom-left (y=bottom-of-box / imgH flipped).
      const rawWords = ocrData.words
        .filter((wd) => wd.text.trim() && wd.confidence > 30)
        .map((wd) => ({
          t: wd.text.trim(),
          x: wd.bbox.x0 / w,
          y: 1 - wd.bbox.y1 / h,
          w: (wd.bbox.x1 - wd.bbox.x0) / w,
          h: (wd.bbox.y1 - wd.bbox.y0) / h,
        }));

      result.push({ pageNumber: i - 1, items: mergeAdjacentWords(rawWords) });
    }
  } finally {
    await worker.terminate();
  }

  return result;
}

// Merge adjacent Tesseract word items on the same row into phrase items
// so multi-word names ("SIAKA BOYE", "MD A MUMIN MIAH") become a single item
// matching the granularity of Vision OCR observations.
function mergeAdjacentWords(words, xGapThreshold = 0.06, yTolerance = 0.015) {
  if (!words.length) return [];
  const sorted = [...words].sort((a, b) => (b.y - a.y) !== 0 ? b.y - a.y : a.x - b.x);
  const phrases = [];
  let curr = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const wd = sorted[i];
    const sameRow = Math.abs(wd.y - curr.y) < yTolerance;
    const gap = wd.x - (curr.x + curr.w);
    if (sameRow && gap < xGapThreshold && gap > -0.02) {
      curr.t += ' ' + wd.t;
      curr.w = (wd.x + wd.w) - curr.x;
    } else {
      phrases.push(curr);
      curr = { ...wd };
    }
  }
  phrases.push(curr);
  return phrases;
}

// ── Orchestrator: text first, then platform OCR ───────────────────────────────
// Returns items[][] indexed by page number (0-based)
async function extractPages(filePath) {
  // Step 1: Try embedded text (no OCR needed, any platform)
  const textPages = await extractTextPages(filePath);
  if (hasSubstantialText(textPages)) {
    console.log('[pdfImport] mode: embedded text');
    const arr = [];
    for (const p of textPages) arr[p.pageNumber] = p.items;
    return arr;
  }

  // Step 2: Scanned PDF — platform OCR
  if (PLATFORM === 'darwin') {
    if (!fs.existsSync(OCR_BINARY)) {
      throw new Error(
        `OCR binary non trovato: ${OCR_BINARY}\nRicompila con:\n  swiftc pdf-ocr.swift -o pdf-ocr`
      );
    }
    console.log('[pdfImport] mode: Swift Vision OCR');
    const ocrPages = await runSwiftOcr(filePath);
    const arr = [];
    for (const p of ocrPages) arr[p.pageNumber] = p.items;
    return arr;
  }

  if (PLATFORM === 'win32') {
    console.log('[pdfImport] mode: Tesseract.js OCR');
    const ocrPages = await runTesseractOcr(filePath);
    const arr = [];
    for (const p of ocrPages) arr[p.pageNumber] = p.items;
    return arr;
  }

  throw new Error('OCR non supportato su questa piattaforma. Usa macOS o Windows.');
}

// ── Spatial helpers (same coordinate system for all extraction modes) ─────────

// Find the text item at the same y-level as `labelText`, within x range [xMin, xMax].
// Picks the candidate closest in Y to the label (handles rows close together).
function findValueAt(items, labelText, xMin, xMax, yTolerance = 0.028) {
  const label = items.find((i) => i.t === labelText);
  if (!label) return null;
  const candidates = items.filter(
    (i) => Math.abs(i.y - label.y) < yTolerance && i.x >= xMin && i.x <= xMax && i.t !== labelText
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(a.y - label.y) - Math.abs(b.y - label.y));
  return candidates[0].t;
}

function parseDatore(items) {
  const s2 = items.find((i) => i.t && i.t.includes('Sezione 2'));
  const s2y = s2 ? s2.y : 0;
  const text = items.filter((i) => i.y > s2y).map((i) => i.t).join(' ').toLowerCase();
  const hasGiuseppe = text.includes('giuseppe');
  const hasCosimo = text.includes('cosimo');
  if (hasGiuseppe && hasCosimo) return null;
  if (hasGiuseppe) return 'LG';
  if (hasCosimo) return 'LC';
  return null;
}

function parseSingleEmployee(page1Items, page2Items, pageIndex) {
  const warnings = [];

  const hired_by_detected = parseDatore(page1Items);

  const cfPattern = /\b([A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z])\b/;
  const s2Item = page1Items.find((i) => i.t && i.t.includes('Sezione 2'));
  const s2y = s2Item ? s2Item.y : 1;
  const belowS2 = page1Items.filter((i) => i.y <= s2y);
  let fiscal_code = null;
  for (const item of belowS2) {
    const m = item.t.match(cfPattern);
    if (m) { fiscal_code = m[1]; break; }
  }
  if (!fiscal_code) warnings.push('Codice fiscale non trovato');

  // Cognome label ≈ x=0.064; value ≈ x=0.28 (between label and Nome label at 0.506)
  const last_name = findValueAt(page1Items, 'Cognome', 0.15, 0.50);
  if (!last_name) warnings.push('Cognome non trovato');

  // Nome label ≈ x=0.506; value ≈ x=0.72 (right side)
  const first_name = findValueAt(page1Items, 'Nome', 0.60, 1.0);

  const datePattern = /\b(\d{2}\/\d{2}\/\d{4})\b/;
  const timePattern = /\d{2}[.:]\d{2}/;
  const collectedDates = [];
  for (const item of page2Items) {
    const m = item.t.match(datePattern);
    if (m && !timePattern.test(item.t) && !collectedDates.includes(m[1])) {
      collectedDates.push(m[1]);
    }
  }

  function dateToNum(d) {
    const p = d.split('/');
    return parseInt(p[2]) * 10000 + parseInt(p[1]) * 100 + parseInt(p[0]);
  }
  const sortedDates = collectedDates.sort((a, b) => dateToNum(a) - dateToNum(b));
  const hire_date_from = sortedDates[0] || null;
  const hire_date_to = sortedDates.length > 1 ? sortedDates[sortedDates.length - 1] : null;

  if (!hire_date_from) warnings.push('Data inizio non trovata');

  console.log(
    `[pdfImport] emp${pageIndex}: CF=${fiscal_code} cognome=${last_name} nome=${first_name}` +
    ` datore=${hired_by_detected} inizio=${hire_date_from} fine=${hire_date_to}`
  );

  return {
    first_name,
    last_name,
    fiscal_code,
    hire_date_from,
    hire_date_to,
    hired_by_detected,
    page_index: pageIndex,
    parse_warnings: warnings,
  };
}

function extractYearFromDate(dateStr) {
  const isoDate = normDateToISO(dateStr);
  if (!isoDate) return null;
  const year = Number(String(isoDate).slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function getTargetYear(options = {}) {
  return Number(options?.targetYear) || new Date().getFullYear();
}

// ── Public API ────────────────────────────────────────────────────────────────

async function parsePdfAssunzioni(filePath) {
  console.log('[pdfImport] extracting pages from', filePath);
  const pages = await extractPages(filePath);
  console.log('[pdfImport] pages received:', pages.length);

  const records = [];
  for (let i = 0; i + 1 < pages.length; i += 2) {
    const record = parseSingleEmployee(pages[i] || [], pages[i + 1] || [], i / 2);
    records.push(record);
  }
  console.log('[pdfImport] total records:', records.length);
  return records;
}

function checkDuplicates(records, options = {}) {
  const { findEmployeeHistoryMatches } = require('./employeeRepo');
  const targetYear = getTargetYear(options);
  return records.map((record) => {
    const hireYear = extractYearFromDate(record.hire_date_from);
    const yearMismatch = hireYear !== null && hireYear < targetYear;
    const yearWarning = yearMismatch
      ? `Assunzione riferita all'anno ${hireYear}, non all'anno corrente ${targetYear}`
      : '';

    if (!record.fiscal_code) {
      return {
        ...record,
        status: 'da_verificare',
        existing_employee_id: null,
        hire_year: hireYear,
        target_year: targetYear,
        year_mismatch: yearMismatch,
        year_warning: yearWarning,
      };
    }

    const matches = findEmployeeHistoryMatches({ fiscal_code: record.fiscal_code });
    let nextStatus = 'da_verificare';
    let importAction = 'nuovo';
    let existingEmployeeId = null;
    let existingIsDeleted = false;
    let existingName = null;

    if (matches.length === 0) {
      nextStatus = 'nuovo';
      importAction = 'nuovo';
    } else {
      const active = matches.find((m) => !m.is_deleted);
      const archived = matches.find((m) => m.is_deleted);
      const match = active || archived;
      existingEmployeeId = match.id;
      existingIsDeleted = !!match.is_deleted;
      existingName = `${match.first_name} ${match.last_name}`;

      const pdfFrom = normDateToISO(record.hire_date_from) || null;
      const pdfTo = normDateToISO(record.hire_date_to) || null;
      const allPeriods = match.employment_periods || [];
      const exactPeriod = allPeriods.find(
        (p) => (p.hire_date_from || null) === pdfFrom && (p.hire_date_to || null) === pdfTo
      );

      if (exactPeriod) {
        nextStatus = 'già_presente';
        importAction = 'già_presente';
      } else {
        nextStatus = 'esistente';
        importAction = 'esistente';
      }
    }

    if (yearMismatch && importAction !== 'già_presente') {
      nextStatus = 'da_verificare';
    }

    return {
      ...record,
      status: nextStatus,
      existing_employee_id: existingEmployeeId,
      existing_is_deleted: existingIsDeleted,
      existing_name: existingName,
      import_action: importAction,
      hire_year: hireYear,
      target_year: targetYear,
      year_mismatch: yearMismatch,
      year_warning: yearWarning,
    };
  });
}

function normDateToISO(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split(/[\/\-\.]/);
  if (parts.length === 3 && parts[0].length === 2) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}

async function attachEmployeePages(pdfPath, pageIndex, employeeId, firstName, lastName, targets = []) {
  try {
    const { PDFDocument } = require('pdf-lib');
    const srcBytes = fs.readFileSync(pdfPath);
    const srcPdf = await PDFDocument.load(srcBytes);
    const totalPages = srcPdf.getPageCount();

    const page1Idx = pageIndex * 2;
    const page2Idx = pageIndex * 2 + 1;
    if (page1Idx >= totalPages) return false;

    const newPdf = await PDFDocument.create();
    const toCopy = page2Idx < totalPages ? [page1Idx, page2Idx] : [page1Idx];
    const copied = await newPdf.copyPages(srcPdf, toCopy);
    for (const p of copied) newPdf.addPage(p);

    const outBytes = await newPdf.save();
    const safeLastName = (lastName || 'dipendente').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const safeFirstName = (firstName || '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const resolvedTargets = Array.isArray(targets) && targets.length
      ? targets
      : [{ employmentPeriodId: null, hiredBy: null }];

    for (const target of resolvedTargets) {
      if (!target?.employmentPeriodId) continue;

      const employerLabel = String(target.hiredBy || 'rapporto').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      const fileName = `${safeLastName}-${safeFirstName}-assunzione-${employerLabel}.pdf`;
      const subdir = path.join('employees', String(employeeId), 'hire-documents', `period-${target.employmentPeriodId}`);
      const fullDir = path.join(getDocumentsDir(), subdir);
      fs.mkdirSync(fullDir, { recursive: true });
      fs.writeFileSync(path.join(fullDir, fileName), outBytes);

      employeeRepo.upsertEmploymentPeriodHireDocument(employeeId, target.employmentPeriodId, {
        file_name: fileName,
        stored_name: fileName,
        relative_path: path.join(subdir, fileName),
        mime_type: 'application/pdf',
        size_bytes: outBytes.length,
      });
    }

    return true;
  } catch (err) {
    console.error('[pdfImportService] attachEmployeePages error:', err.message);
    return false;
  }
}

module.exports = {
  init,
  parsePdfAssunzioni,
  checkDuplicates,
  attachEmployeePages,
  extractYearFromDate,
  getTargetYear,
  normDateToISO,
};
