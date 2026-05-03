const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { app } = require('electron');
const { getDocumentsDir } = require('./storagePaths');
const employeeRepo = require('./employeeRepo');

const PLATFORM = process.platform; // 'darwin' | 'win32' | 'linux'

// Set by init() from main.js after app is ready.
// Default to __dirname/tessdata for dev; init() overrides with app.getPath('userData')/tessdata.
let TESSDATA_DIR = path.join(__dirname, 'tessdata');
let APP_IS_PACKAGED = Boolean(app?.isPackaged);
let OCR_BINARY = resolveOcrBinaryPath();
let canvasLib = null;
let canvasLoadAttempted = false;
let logWriter = () => {};
let pdfJsWarningsSuppressedLogged = false;

function setLogger(logger) {
  logWriter = typeof logger === 'function' ? logger : () => {};
}

function logPdfImportEvent(event, details = {}) {
  try {
    logWriter(`pdf-import:${event}`, details);
  } catch {
    // Best effort.
  }
}

function shouldSuppressPdfJsWarning(message) {
  const normalized = String(message || '');
  return (
    normalized.includes('Cannot polyfill') ||
    normalized.includes('fetchStandardFontData') ||
    normalized.startsWith('Warning: TT:')
  );
}

function withSuppressedPdfJsWarnings(callback) {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (shouldSuppressPdfJsWarning(args[0])) {
      if (!pdfJsWarningsSuppressedLogged) {
        pdfJsWarningsSuppressedLogged = true;
        logPdfImportEvent('pdfjs-warnings-suppressed', {
          reason: 'canvas-or-font-polyfill-warning',
        });
      }
      return;
    }
    originalWarn(...args);
  };

  try {
    return callback();
  } finally {
    console.warn = originalWarn;
  }
}

async function withSuppressedPdfJsWarningsAsync(callback) {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (shouldSuppressPdfJsWarning(args[0])) {
      if (!pdfJsWarningsSuppressedLogged) {
        pdfJsWarningsSuppressedLogged = true;
        logPdfImportEvent('pdfjs-warnings-suppressed', {
          reason: 'canvas-or-font-polyfill-warning',
        });
      }
      return;
    }
    originalWarn(...args);
  };

  try {
    return await callback();
  } finally {
    console.warn = originalWarn;
  }
}

function loadPdfJsLib() {
  return withSuppressedPdfJsWarnings(() => {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    return pdfjsLib;
  });
}

function buildPdfJsDocumentOptions(pdfjsLib, data) {
  return {
    data,
    disableRange: true,
    disableStream: true,
    verbosity: pdfjsLib?.VerbosityLevel?.ERRORS ?? 0,
  };
}

function hashBuffer(buffer) {
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  return hash.digest('hex');
}

function resolveOcrBinaryPath() {
  if (app?.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'pdf-ocr');
  }

  return path.join(__dirname, 'pdf-ocr');
}

function isExecutable(targetPath) {
  try {
    fs.accessSync(targetPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getOcrAvailability() {
  const exists = fs.existsSync(OCR_BINARY);
  const executable = exists ? isExecutable(OCR_BINARY) : false;
  const info = {
    ocr_path: OCR_BINARY,
    exists,
    executable,
    packaged: APP_IS_PACKAGED,
    platform: PLATFORM,
  };
  logPdfImportEvent('ocr-check', info);
  return info;
}

function ensureOcrExecutable() {
  const availability = getOcrAvailability();
  if (!availability.exists || availability.executable || PLATFORM === 'win32') {
    return availability;
  }

  if (!APP_IS_PACKAGED && (PLATFORM === 'darwin' || PLATFORM === 'linux')) {
    try {
      fs.chmodSync(availability.ocr_path, 0o755);
      const updated = getOcrAvailability();
      logPdfImportEvent('ocr-chmod-applied', {
        ocr_path: availability.ocr_path,
        executable: updated.executable,
      });
      return updated;
    } catch (error) {
      logPdfImportEvent('ocr-chmod-failed', {
        ocr_path: availability.ocr_path,
        message: error?.message || String(error),
      });
    }
  }

  return getOcrAvailability();
}

function loadCanvasLib() {
  if (canvasLoadAttempted) return canvasLib;
  canvasLoadAttempted = true;
  try {
    canvasLib = require('@napi-rs/canvas');
  } catch (e) {
    logPdfImportEvent('canvas-unavailable', {
      message: e?.message || String(e),
    });
  }
  return canvasLib;
}

// Called once from main.js inside app.whenReady() so TESSDATA_DIR points to a writable location.
function init({ userDataDir }) {
  TESSDATA_DIR = path.join(userDataDir, 'tessdata');
  APP_IS_PACKAGED = Boolean(app?.isPackaged);
  OCR_BINARY = resolveOcrBinaryPath();
  ensureOcrExecutable();
}

// ── Text extraction via pdfjs-dist (no canvas, any platform) ─────────────────
// Uses PDF's embedded text when available (fast, exact).
// Returns [{pageNumber, items:[{t,x,y,w,h}]}] — normalized 0-1, origin bottom-left.
async function extractTextPages(filePath) {
  try {
    const result = await withSuppressedPdfJsWarningsAsync(async () => {
      const pdfjsLib = loadPdfJsLib();
      const data = new Uint8Array(fs.readFileSync(filePath));
      const doc = await pdfjsLib.getDocument(buildPdfJsDocumentOptions(pdfjsLib, data)).promise;
      const pages = [];
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
        pages.push({ pageNumber: i - 1, items });
      }
      return pages;
    });
    logPdfImportEvent('text-parse-complete', {
      file_path: filePath,
      page_count: result.length,
      substantial_text: hasSubstantialText(result),
    });
    return result;
  } catch (e) {
    logPdfImportEvent('text-parse-failed', {
      file_path: filePath,
      message: e?.message || String(e),
    });
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

function getPageTextCharCount(page) {
  return (page?.items || []).reduce((sum, item) => sum + String(item.t || '').replace(/\s/g, '').length, 0);
}

function normalizeOcrText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[|]/g, 'I')
    .trim();
}

function joinItemTexts(items) {
  return items.map((item) => normalizeOcrText(item.t)).filter(Boolean).join(' ');
}

function normalizeLabelToken(value) {
  return normalizeOcrText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isFieldLabelValue(value) {
  const token = normalizeLabelToken(value);
  return [
    'nome',
    'cognome',
    'codicefiscale',
    'cf',
    'data',
    'datanascita',
    'datore',
  ].includes(token);
}

function sanitizeDetectedNamePart(value) {
  const normalized = normalizeOcrText(value);
  if (!normalized || isFieldLabelValue(normalized)) {
    return '';
  }
  return normalized;
}

function findLabelItem(items, labels = []) {
  const normalizedLabels = labels.map((label) => normalizeLabelToken(label));
  return items.find((item) => normalizedLabels.includes(normalizeLabelToken(item.t)));
}

function findFiscalCodeInItems(items = []) {
  const directPattern = /\b([A-Z]{6}\s*[0-9]{2}\s*[A-Z]\s*[0-9]{2}\s*[A-Z]\s*[0-9]{3}\s*[A-Z])\b/i;
  const labelItem = findLabelItem(items, ['codice fiscale', 'c.f.', 'cf']);
  const candidates = [];

  if (labelItem) {
    const nearbyCandidates = items.filter((item) => {
      const text = normalizeOcrText(item.t);
      if (!text || item === labelItem) return false;
      if (isFieldLabelValue(text)) return false;
      const yDistance = Math.abs(item.y - labelItem.y);
      const xStartsAfterLabel = item.x >= (labelItem.x + Math.max(labelItem.w, 0.05) - 0.02);
      const isBelowLabel = item.y < labelItem.y && yDistance <= 0.07 && Math.abs(item.x - labelItem.x) <= 0.12;
      return (yDistance <= 0.032 && xStartsAfterLabel) || isBelowLabel;
    });

    for (const candidate of nearbyCandidates) {
      const match = normalizeOcrText(candidate.t).toUpperCase().match(directPattern);
      if (match?.[1]) {
        const value = match[1].replace(/\s+/g, '').toUpperCase();
        return {
          value,
          source: `label:${normalizeOcrText(labelItem.t)}`,
          block_text: normalizeOcrText(candidate.t),
        };
      }

      candidates.push(normalizeOcrText(candidate.t));
    }

    return {
      value: null,
      source: `label:${normalizeOcrText(labelItem.t)}`,
      block_text: candidates.join(' | '),
    };
  }

  return {
    value: null,
    source: 'missing-specific-label',
    block_text: '',
  };
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sortItemsForReading(items = []) {
  return [...items].sort((a, b) => {
    if (Math.abs((b.y || 0) - (a.y || 0)) > 0.012) {
      return (b.y || 0) - (a.y || 0);
    }
    return (a.x || 0) - (b.x || 0);
  });
}

function buildLinesFromItems(items = [], pageNumber = 0, yTolerance = 0.012) {
  const sorted = sortItemsForReading(items);
  const lines = [];

  for (const item of sorted) {
    const text = normalizeOcrText(item.t);
    if (!text) continue;

    const existingLine = lines.find((line) => Math.abs((line.y || 0) - (item.y || 0)) <= yTolerance);
    if (existingLine) {
      existingLine.items.push(item);
      existingLine.y = Math.max(existingLine.y, item.y || 0);
    } else {
      lines.push({
        pageNumber,
        y: item.y || 0,
        items: [item],
      });
    }
  }

  return lines
    .map((line, index) => {
      const lineItems = [...line.items].sort((a, b) => (a.x || 0) - (b.x || 0));
      return {
        pageNumber,
        lineIndex: index,
        y: line.y,
        items: lineItems,
        text: joinItemTexts(lineItems),
      };
    })
    .sort((a, b) => {
      if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
      return b.y - a.y;
    });
}

function getSectionTypeFromText(value) {
  const text = normalizeOcrText(value).toLowerCase();
  if (/sezione\s*2\b.*lavorator/.test(text) || /lavorator.*sezione\s*2\b/.test(text)) {
    return 'section2_worker';
  }
  if (/sezione\s*4\b.*rapporto/.test(text) || /rapporto di lavoro/.test(text) || /sezione\s*4\b/.test(text)) {
    return 'section4_employment';
  }
  if (/sezione\s*1\b/.test(text)) {
    return 'section1_employer';
  }
  if (/sezione\s*5\b/.test(text)) {
    return 'section5_attuatore';
  }
  return null;
}

function buildDocumentLines(pages = []) {
  const lines = [];
  for (let pageNumber = 0; pageNumber < pages.length; pageNumber += 1) {
    lines.push(...buildLinesFromItems(pages[pageNumber] || [], pageNumber));
  }
  return lines;
}

function buildWorkerBlocks(pages = []) {
  const lines = buildDocumentLines(pages);
  const blocks = [];
  let currentBlock = null;

  for (const line of lines) {
    const sectionType = getSectionTypeFromText(line.text);
    if (sectionType === 'section2_worker') {
      if (currentBlock) {
        blocks.push({
          ...currentBlock,
          original_text: normalizeOcrText(currentBlock.lines.map((entry) => entry.text).join(' ')),
          page_numbers: [...currentBlock.pageNumbers].sort((a, b) => a - b),
        });
      }
      currentBlock = {
        lines: [line],
        pageNumbers: new Set([line.pageNumber]),
        used_fallback: false,
      };
      continue;
    }

    if (currentBlock) {
      currentBlock.lines.push(line);
      currentBlock.pageNumbers.add(line.pageNumber);
    }
  }

  if (currentBlock) {
    blocks.push({
      ...currentBlock,
      original_text: normalizeOcrText(currentBlock.lines.map((entry) => entry.text).join(' ')),
      page_numbers: [...currentBlock.pageNumbers].sort((a, b) => a - b),
    });
  }

  if (blocks.length) {
    return blocks;
  }

  const fallbackBlocks = [];
  for (let pageNumber = 0; pageNumber < pages.length; pageNumber += 2) {
    const pageNumbers = [pageNumber];
    if (pages[pageNumber + 1]) pageNumbers.push(pageNumber + 1);
    const blockLines = lines.filter((line) => pageNumbers.includes(line.pageNumber));
    if (!blockLines.length) continue;
    fallbackBlocks.push({
      lines: blockLines,
      page_numbers: pageNumbers,
      used_fallback: true,
      original_text: normalizeOcrText(blockLines.map((entry) => entry.text).join(' ')),
    });
  }

  return fallbackBlocks;
}

function linesToItems(lines = []) {
  return lines.flatMap((line) => line.items || []);
}

function getSectionLines(blockLines = [], startType, stopTypes = []) {
  const startIndex = blockLines.findIndex((line) => getSectionTypeFromText(line.text) === startType);
  if (startIndex < 0) {
    return [];
  }

  let endIndex = blockLines.length;
  for (let index = startIndex + 1; index < blockLines.length; index += 1) {
    const sectionType = getSectionTypeFromText(blockLines[index].text);
    if (sectionType && stopTypes.includes(sectionType)) {
      endIndex = index;
      break;
    }
  }

  return blockLines.slice(startIndex, endIndex);
}

function trimAtNextKnownLabel(value, stopLabels = []) {
  const normalized = normalizeOcrText(value);
  if (!normalized) return '';

  let cutIndex = normalized.length;
  for (const label of stopLabels) {
    const regex = new RegExp(`\\b${escapeRegExp(label)}\\b`, 'i');
    const match = regex.exec(normalized);
    if (match?.index >= 0) {
      cutIndex = Math.min(cutIndex, match.index);
    }
  }

  return normalizeOcrText(normalized.slice(0, cutIndex));
}

function buildLabelRegex(label, captureRest = true) {
  const normalizedLabel = escapeRegExp(String(label || '').trim()).replace(/\s+/g, '\\s+');
  return new RegExp(
    `(?:^|\\b)${normalizedLabel}(?![a-z0-9])\\s*[:\\-]?\\s*${captureRest ? '(.+)$' : ''}`,
    'i'
  );
}

function extractLabeledValue(lines = [], labels = [], stopLabels = [], valueType = 'text') {
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = normalizeOcrText(lines[lineIndex].text);
    if (!lineText) continue;

    for (const label of labels) {
      const regex = buildLabelRegex(label, true);
      const match = lineText.match(regex);
      if (match?.[1]) {
        const candidate = trimAtNextKnownLabel(match[1], stopLabels);
        const value = normalizeDetectedFieldValue(candidate, valueType);
        if (value) {
          return {
            value,
            source: `line:${lines[lineIndex].pageNumber + 1}:${lineIndex + 1}`,
          };
        }
      }

      if (buildLabelRegex(label, false).test(lineText) && !match?.[1]) {
        for (let offset = 1; offset <= 2; offset += 1) {
          const nextLine = lines[lineIndex + offset];
          if (!nextLine) break;
          const candidate = trimAtNextKnownLabel(nextLine.text, stopLabels);
          const value = normalizeDetectedFieldValue(candidate, valueType);
          if (value) {
            return {
              value,
              source: `line:${nextLine.pageNumber + 1}:${lineIndex + offset + 1}`,
            };
          }
        }
      }
    }
  }

  return {
    value: valueType === 'fiscal_code' ? null : '',
    source: '',
  };
}

function normalizeDetectedFieldValue(value, valueType = 'text') {
  if (valueType === 'fiscal_code') {
    const match = normalizeOcrText(value).toUpperCase().match(/\b([A-Z]{6}\s*[0-9]{2}\s*[A-Z]\s*[0-9]{2}\s*[A-Z]\s*[0-9]{3}\s*[A-Z])\b/i);
    return match?.[1] ? match[1].replace(/\s+/g, '').toUpperCase() : null;
  }

  if (valueType === 'date') {
    return normalizeOcrText(value).match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0] || '';
  }

  if (valueType === 'number') {
    return normalizeOcrText(value).match(/\b\d+(?:[.,]\d+)?\b/)?.[0] || '';
  }

  return sanitizeDetectedNamePart(value);
}

function cleanWorkerLabelArtifacts(value) {
  let normalized = normalizeOcrText(value);
  if (!normalized) return '';

  normalized = normalized
    .replace(/\b(cognome|nome|codice fiscale|c\.f\.|cf|data(?: di)? nascita)\b\s*:?\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitizeDetectedNamePart(normalized);
}

function parseWorkerSection(section2Lines = []) {
  const items = linesToItems(section2Lines);
  const section2Labels = ['cognome', 'nome', 'codice fiscale', 'c.f.', 'cf', 'data nascita'];

  const surnameField = extractLabeledValue(section2Lines, ['cognome'], section2Labels.filter((label) => label !== 'cognome'), 'text');
  const nameField = extractLabeledValue(section2Lines, ['nome'], section2Labels.filter((label) => label !== 'nome'), 'text');
  const birthDateField = extractLabeledValue(section2Lines, ['data nascita', 'data di nascita'], [], 'date');
  const fiscalCodeFromLines = extractLabeledValue(
    section2Lines,
    ['codice fiscale', 'c.f.', 'cf'],
    section2Labels.filter((label) => !['codice fiscale', 'c.f.', 'cf'].includes(label)),
    'fiscal_code'
  );
  const fiscalCodeFromItems = findFiscalCodeInItems(items);

  return {
    first_name: cleanWorkerLabelArtifacts(nameField.value || findValueAt(items, 'Nome', 0.45, 1.0)),
    last_name: cleanWorkerLabelArtifacts(surnameField.value || findValueAt(items, 'Cognome', 0.1, 0.55)),
    fiscal_code: fiscalCodeFromLines.value || fiscalCodeFromItems.value || null,
    fiscal_code_source: fiscalCodeFromLines.value ? fiscalCodeFromLines.source : fiscalCodeFromItems.source,
    fiscal_code_block: fiscalCodeFromLines.value ? '' : fiscalCodeFromItems.block_text,
    birth_date: birthDateField.value || '',
  };
}

function parseEmploymentSection(section4Lines = []) {
  const startDateField = extractLabeledValue(section4Lines, ['data inizio', 'inizio rapporto'], ['data fine', 'tipo lavorazione', 'giornate previste'], 'date');
  const endDateField = extractLabeledValue(section4Lines, ['data fine', 'fine rapporto'], ['data inizio', 'tipo lavorazione', 'giornate previste'], 'date');
  const workTypeField = extractLabeledValue(section4Lines, ['tipo lavorazione', 'lavorazione'], ['giornate previste', 'data inizio', 'data fine'], 'text');
  const expectedDaysField = extractLabeledValue(section4Lines, ['giornate previste'], ['tipo lavorazione', 'data inizio', 'data fine'], 'number');

  const sectionText = normalizeOcrText(section4Lines.map((line) => line.text).join(' '));
  const sectionDates = [...new Set((sectionText.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || []))];
  const fallbackStart = startDateField.value || sectionDates[0] || null;
  const fallbackEnd = endDateField.value || (sectionDates.length > 1 ? sectionDates[sectionDates.length - 1] : null);

  return {
    hire_date_from: fallbackStart,
    hire_date_to: fallbackEnd,
    tipo_lavorazione: workTypeField.value || '',
    giornate_previste: expectedDaysField.value || '',
  };
}

function parseEmployerSection(section1Lines = []) {
  const nameField = extractLabeledValue(
    section1Lines,
    ['denominazione', 'ragione sociale'],
    ['codice fiscale', 'p.iva', 'partita iva', 'comune sede di lavoro', 'indirizzo sede di lavoro'],
    'text'
  );
  const taxCodeField = extractLabeledValue(
    section1Lines,
    ['codice fiscale', 'p.iva', 'partita iva'],
    ['denominazione', 'comune sede di lavoro', 'indirizzo sede di lavoro'],
    'text'
  );
  const workplaceComuneField = extractLabeledValue(
    section1Lines,
    ['comune sede di lavoro'],
    ['c.a.p. sede di lavoro', 'indirizzo sede di lavoro', 'telefono sede di lavoro', 'fax sede operativa'],
    'text'
  );
  const workplaceAddressField = extractLabeledValue(
    section1Lines,
    ['indirizzo sede di lavoro'],
    ['telefono sede di lavoro', 'fax sede operativa', 'e - mail sede di lavoro', 'email sede di lavoro'],
    'text'
  );

  const workplace = [workplaceComuneField.value, workplaceAddressField.value].filter(Boolean).join(' · ');
  const taxIdMatch = normalizeOcrText(taxCodeField.value).toUpperCase().match(/\b([A-Z0-9]{11,16})\b/);

  return {
    name: sanitizeDetectedNamePart(nameField.value),
    tax_id: taxIdMatch?.[1] || '',
    workplace,
  };
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
  return withSuppressedPdfJsWarningsAsync(async () => {
    const pdfjsLib = loadPdfJsLib();
    const { createCanvas } = loadCanvasLib() || {};
    if (!createCanvas) {
      logPdfImportEvent('ocr-image-skip', {
        file_path: filePath,
        reason: 'canvas_unavailable',
        textual_fallback: false,
      });
      return [];
    }
    const { createWorker } = require('tesseract.js');

    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjsLib.getDocument(buildPdfJsDocumentOptions(pdfjsLib, data)).promise;

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
  });
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
// Returns { pages, detectedModel } where pages is items[][] indexed by page number (0-based)
async function extractPages(filePath) {
  const textPages = await extractTextPages(filePath);
  const pageTextCounts = textPages.map((page) => getPageTextCharCount(page));
  const hasAnyText = pageTextCounts.some((count) => count > 0);
  const hasSparseText = pageTextCounts.some((count) => count > 0 && count <= 30);

  if (hasSubstantialText(textPages)) {
    const availability = getOcrAvailability();
    const detectedModel = hasSparseText ? 'mixed_pdf' : 'text_pdf';
    logPdfImportEvent('extract-mode', {
      file_path: filePath,
      mode: 'embedded_text',
      detected_model: detectedModel,
      ocr_path: availability.ocr_path,
      ocr_exists: availability.exists,
      ocr_executable: availability.executable,
      textual_fallback: true,
    });
    const arr = [];
    for (const p of textPages) arr[p.pageNumber] = p.items;
    return {
      pages: arr,
      detectedModel,
    };
  }

  const detectedModel = hasAnyText ? 'mixed_pdf' : 'scanned_pdf_ocr';

  if (PLATFORM === 'darwin') {
    const availability = ensureOcrExecutable();
    if (!availability.exists) {
      throw new Error(
        `OCR non disponibile. Percorso OCR: ${availability.ocr_path}. Esiste: no. Fallback parsing testuale: no.`
      );
    }
    if (!availability.executable) {
      throw new Error(
        `OCR non eseguibile. Percorso OCR: ${availability.ocr_path}. Esiste: si. Eseguibile: no.`
      );
    }
    logPdfImportEvent('extract-mode', {
      file_path: filePath,
      mode: 'swift_vision_ocr',
      detected_model: detectedModel,
      ocr_path: availability.ocr_path,
      ocr_exists: availability.exists,
      ocr_executable: availability.executable,
      textual_fallback: false,
    });
    const ocrPages = await runSwiftOcr(filePath);
    const arr = [];
    for (const p of ocrPages) arr[p.pageNumber] = p.items;
    return {
      pages: arr,
      detectedModel,
    };
  }

  if (PLATFORM === 'win32') {
    const availability = getOcrAvailability();
    logPdfImportEvent('extract-mode', {
      file_path: filePath,
      mode: 'tesseract_ocr',
      detected_model: detectedModel,
      ocr_path: availability.ocr_path,
      ocr_exists: availability.exists,
      ocr_executable: availability.executable,
      textual_fallback: false,
    });
    const ocrPages = await runTesseractOcr(filePath);
    const arr = [];
    for (const p of ocrPages) arr[p.pageNumber] = p.items;
    if (arr.length) {
      return {
        pages: arr,
        detectedModel,
      };
    }
    throw new Error('OCR immagini non disponibile su Windows e il PDF non contiene testo estraibile.');
  }

  if (PLATFORM === 'linux') {
    const availability = ensureOcrExecutable();
    throw new Error(
      `OCR non supportato su Linux. Percorso OCR: ${availability.ocr_path}. ` +
      `Esiste: ${availability.exists ? 'si' : 'no'}. Eseguibile: ${availability.executable ? 'si' : 'no'}.`
    );
  }

  throw new Error('OCR non supportato su questa piattaforma.');
}

function buildReadableParseError(error) {
  const message = error?.message || String(error);
  if (message.includes('EACCES')) {
    const availability = getOcrAvailability();
    return (
      `OCR non eseguibile. Percorso OCR: ${availability.ocr_path}. ` +
      `Esiste: ${availability.exists ? 'si' : 'no'}. ` +
      `Eseguibile: ${availability.executable ? 'si' : 'no'}.`
    );
  }

  return message;
}

// ── Spatial helpers (same coordinate system for all extraction modes) ─────────

// Find the text item at the same y-level as `labelText`, within x range [xMin, xMax].
// Picks the candidate closest in Y to the label (handles rows close together).
function findValueAt(items, labelText, xMin, xMax, yTolerance = 0.028) {
  const label = findLabelItem(items, [labelText]);
  if (!label) return null;
  const candidates = items.filter(
    (i) =>
      Math.abs(i.y - label.y) < yTolerance &&
      i.x >= xMin &&
      i.x <= xMax &&
      normalizeLabelToken(i.t) !== normalizeLabelToken(labelText) &&
      !isFieldLabelValue(i.t)
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(a.y - label.y) - Math.abs(b.y - label.y));
  return candidates[0].t;
}

function parseDatore(items, employerInfo = null) {
  const text = normalizeOcrText(items.map((i) => i.t).join(' ')).toLowerCase();
  const textToInspect = normalizeOcrText(
    `${employerInfo?.name || ''} ${employerInfo?.tax_id || ''} ${employerInfo?.workplace || ''} ${text}`
  ).toLowerCase();
  const hasLaruccia = textToInspect.includes('laruccia');
  const hasGiuseppe = textToInspect.includes('giuseppe');
  const hasCosimo = textToInspect.includes('cosimo');
  if (!hasLaruccia && !hasGiuseppe && !hasCosimo) return null;
  if (hasGiuseppe && hasCosimo) return null;
  if (hasGiuseppe) return 'LG';
  if (hasCosimo) return 'LC';
  return null;
}

function parseSingleEmployee(block, pageIndex, documentEmployer, documentEmployerInfo) {
  const warnings = [];
  const section2Lines = getSectionLines(block.lines, 'section2_worker', ['section4_employment', 'section5_attuatore']);
  const section4Lines = getSectionLines(block.lines, 'section4_employment', ['section5_attuatore']);
  const workerInfo = parseWorkerSection(section2Lines);
  const employmentInfo = parseEmploymentSection(section4Lines);
  const original_text = block.original_text || normalizeOcrText(block.lines.map((line) => line.text).join(' '));
  const hired_by_detected = documentEmployer || parseDatore(linesToItems(block.lines), documentEmployerInfo);
  const parserUncertainReasons = [];

  if (block.used_fallback) {
    parserUncertainReasons.push('Sezione 2 - Lavoratore non riconosciuta con certezza');
  }
  if (!section2Lines.length) {
    parserUncertainReasons.push('Sezione 2 - Lavoratore non trovata');
  }
  if (!section4Lines.length) {
    parserUncertainReasons.push('Sezione 4 - Rapporto di lavoro non trovata');
  }

  const fiscal_code = workerInfo.fiscal_code;
  if (!fiscal_code) warnings.push('Codice fiscale non trovato');

  const last_name = workerInfo.last_name;
  if (!last_name) warnings.push('Cognome non trovato o non valido');

  const first_name = workerInfo.first_name;
  if (!first_name) warnings.push('Nome non trovato o non valido');

  const hire_date_from = employmentInfo.hire_date_from || null;
  const hire_date_to = employmentInfo.hire_date_to || null;
  if (!hire_date_from) warnings.push('Data inizio non trovata');

  logPdfImportEvent('record-parsed', {
    page_index: pageIndex,
    fiscal_code: fiscal_code || '',
    fiscal_code_source: workerInfo.fiscal_code_source,
    fiscal_code_block: workerInfo.fiscal_code_block,
    last_name: last_name || '',
    first_name: first_name || '',
    hired_by_detected: hired_by_detected || '',
    pdf_employer_name: documentEmployerInfo?.name || '',
    pdf_employer_tax_id: documentEmployerInfo?.tax_id || '',
    pdf_employer_workplace: documentEmployerInfo?.workplace || '',
    hire_date_from: hire_date_from || '',
    hire_date_to: hire_date_to || '',
    parse_model: block.parse_model || '',
    page_numbers: block.page_numbers || [],
    discarded_reasons: [...warnings, ...parserUncertainReasons],
  });

  return {
    first_name,
    last_name,
    fiscal_code,
    birth_date: workerInfo.birth_date || '',
    hire_date_from,
    hire_date_to,
    tipo_lavorazione: employmentInfo.tipo_lavorazione || '',
    giornate_previste: employmentInfo.giornate_previste || '',
    hired_by_detected,
    pdf_employer: documentEmployerInfo || { name: '', tax_id: '', workplace: '' },
    page_index: pageIndex,
    page_numbers: block.page_numbers || [],
    parse_model: block.parse_model || '',
    parse_warnings: warnings,
    parser_uncertain_reason: parserUncertainReasons.join(' · '),
    original_text,
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
  return parsePdfAssunzioniWithProgress(filePath, {});
}

async function parsePdfAssunzioniWithProgress(filePath, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  logPdfImportEvent('parse-start', { file_path: filePath });
  onProgress({
    step: 'parsing_pdf',
    percent: 20,
    message: 'Parsing PDF in corso...',
  });
  let extracted;
  try {
    extracted = await extractPages(filePath);
  } catch (error) {
    const availability = getOcrAvailability();
    logPdfImportEvent('parse-failed', {
      file_path: filePath,
      ocr_path: availability.ocr_path,
      ocr_exists: availability.exists,
      ocr_executable: availability.executable,
      textual_fallback: false,
      message: error?.message || String(error),
    });
    throw new Error(buildReadableParseError(error));
  }
  const pages = extracted.pages || [];
  const parseModel = extracted.detectedModel || 'text_pdf';
  logPdfImportEvent('parse-pages-ready', {
    file_path: filePath,
    page_count: pages.length,
    parse_model: parseModel,
  });
  onProgress({
    step: 'parsing_pdf',
    percent: 45,
    message: `PDF letto. Pagine rilevate: ${pages.length}. Modello: ${parseModel}.`,
  });

  const workerBlocks = buildWorkerBlocks(pages).map((block) => ({
    ...block,
    parse_model: parseModel,
  }));
  const documentLines = buildDocumentLines(pages);
  const documentEmployerInfo = parseEmployerSection(
    getSectionLines(documentLines, 'section1_employer', ['section2_worker', 'section5_attuatore'])
  );
  const documentEmployer = parseDatore(pages.flat(), documentEmployerInfo);
  const records = [];
  for (let i = 0; i < workerBlocks.length; i += 1) {
    const record = parseSingleEmployee(workerBlocks[i], i, documentEmployer, documentEmployerInfo);
    records.push(record);
    onProgress({
      step: 'employee_recognition',
      percent: 45 + Math.round(((i + 1) / Math.max(1, workerBlocks.length)) * 25),
      message: `Riconoscimento dipendente ${i + 1} di ${Math.max(1, workerBlocks.length)}.`,
    });
  }
  logPdfImportEvent('parse-complete', {
    file_path: filePath,
    record_count: records.length,
    parse_model: parseModel,
  });
  onProgress({
    step: 'employee_recognition',
    percent: 70,
    message: `Riconoscimento completato. Schede trovate: ${records.length}.`,
  });
  return records;
}

function checkDuplicates(records, options = {}) {
  const targetYear = getTargetYear(options);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const duplicateKeys = new Set();
  const fiscalCodeNameMap = new Map();

  for (const record of records) {
    const fiscalCode = String(record.fiscal_code || '').trim().toUpperCase();
    const fullName = normalizeOcrText(`${record.last_name || ''} ${record.first_name || ''}`);
    if (!fiscalCode || !fullName) continue;
    if (!fiscalCodeNameMap.has(fiscalCode)) {
      fiscalCodeNameMap.set(fiscalCode, new Set());
    }
    fiscalCodeNameMap.get(fiscalCode).add(fullName);
  }

  const totalDetected = records.length;
  const items = records.map((record) => {
    const baseClassification = employeeRepo.classifyImportedEmployeeRecord({
      ...record,
      hire_date_from: normDateToISO(record.hire_date_from),
      hire_date_to: normDateToISO(record.hire_date_to),
      hired_by: record.hired_by || record.hired_by_detected,
    });
    const hireYear = extractYearFromDate(baseClassification.hire_date_from);
    const yearMismatch = hireYear !== null && hireYear < targetYear;
    const yearWarning = yearMismatch
      ? `Assunzione riferita all'anno ${hireYear}, non all'anno corrente ${targetYear}`
      : '';
    const exactDuplicateKey = baseClassification.exact_duplicate_key;

    let nextStatus = baseClassification.status;
    let nextAction = baseClassification.import_action;
    let correctionReasons = [...(baseClassification.correction_reasons || [])];

    if (exactDuplicateKey && duplicateKeys.has(exactDuplicateKey)) {
      nextStatus = 'duplicato';
      nextAction = 'duplicato';
      correctionReasons = [...correctionReasons, 'record duplicato nello stesso import'];
    } else if (exactDuplicateKey) {
      duplicateKeys.add(exactDuplicateKey);
    }

    if (yearMismatch && nextStatus !== 'già_presente') {
      nextStatus = 'da_correggere';
      nextAction = 'scartato';
      correctionReasons = [...correctionReasons, 'anno non coerente'];
    }

    if (record.parser_uncertain_reason) {
      nextStatus = 'da_correggere';
      nextAction = 'scartato';
      correctionReasons = [...correctionReasons, record.parser_uncertain_reason];
    }

    const duplicateNamesForFiscalCode = fiscalCodeNameMap.get(String(baseClassification.fiscal_code || '').trim().toUpperCase());
    if (duplicateNamesForFiscalCode && duplicateNamesForFiscalCode.size > 1) {
      nextStatus = 'da_correggere';
      nextAction = 'scartato';
      correctionReasons = [...correctionReasons, 'Codice fiscale duplicato nel PDF con nominativi diversi'];
    }

    const selected = nextStatus === 'pronto' || nextStatus === 'nuovo_rapporto_datore';
    const enriched = {
      ...record,
      ...baseClassification,
      status: nextStatus,
      import_action: nextAction,
      selected,
      correction_reasons: correctionReasons,
      hire_year: hireYear,
      target_year: targetYear,
      year_mismatch: yearMismatch,
      year_warning: yearWarning,
    };
    logPdfImportEvent('record-evaluated', {
      page_index: enriched.page_index,
      fiscal_code: enriched.fiscal_code || '',
      first_name: enriched.first_name || '',
      last_name: enriched.last_name || '',
      hired_by: enriched.hired_by || enriched.hired_by_detected || '',
      parse_model: enriched.parse_model || '',
      parse_warnings: enriched.parse_warnings || [],
      correction_reasons: enriched.correction_reasons || [],
      status: enriched.status,
      decision: enriched.decision,
    });
    return enriched;
  }).map((item, index, source) => {
    onProgress({
      step: 'duplicate_check',
      percent: 70 + Math.round(((index + 1) / Math.max(1, source.length)) * 25),
      message: `Controllo duplicati ${index + 1} di ${source.length}.`,
    });
    return item;
  });
  const readyItems = items.filter((i) => i.status === 'pronto' || i.status === 'nuovo_rapporto_datore');
  const toFixItems = items.filter((i) => i.status === 'da_correggere' || i.status === 'duplicato');
  const alreadyPresentItems = items.filter((i) => i.status === 'già_presente');
  logPdfImportEvent('check-duplicates-summary', {
    total_detected: totalDetected,
    ready: readyItems.length,
    to_fix: toFixItems.length,
    already_present: alreadyPresentItems.length,
    to_fix_details: toFixItems.map((i) => ({
      page_index: i.page_index,
      fiscal_code: i.fiscal_code || '',
      last_name: i.last_name || '',
      first_name: i.first_name || '',
      reasons: i.correction_reasons || [],
    })),
  });
  return items;
}

function normDateToISO(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split(/[\/\-\.]/);
  if (parts.length === 3 && parts[0].length === 2) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}

async function attachEmployeePages(pdfPath, pageReference, employeeId, firstName, lastName, targets = []) {
  try {
    const { PDFDocument } = require('pdf-lib');
    const srcBytes = fs.readFileSync(pdfPath);
    const srcPdf = await PDFDocument.load(srcBytes);
    const totalPages = srcPdf.getPageCount();

    const pageIndexes = Array.isArray(pageReference)
      ? [...new Set(pageReference.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value < totalPages))].sort((a, b) => a - b)
      : [Number(pageReference) * 2, Number(pageReference) * 2 + 1].filter((value) => Number.isInteger(value) && value >= 0 && value < totalPages);
    if (!pageIndexes.length) return false;

    const newPdf = await PDFDocument.create();
    const toCopy = pageIndexes;
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
        sha256: hashBuffer(Buffer.from(outBytes)),
        file_created_at: new Date().toISOString(),
      });
    }

    return true;
  } catch (err) {
    console.error('[pdfImportService] attachEmployeePages error:', err.message);
    return false;
  }
}

module.exports = {
  attachEmployeePages,
  checkDuplicates,
  extractYearFromDate,
  init,
  logPdfImportEvent,
  normDateToISO,
  parsePdfAssunzioni,
  parsePdfAssunzioniWithProgress,
  getTargetYear,
  setLogger,
};
