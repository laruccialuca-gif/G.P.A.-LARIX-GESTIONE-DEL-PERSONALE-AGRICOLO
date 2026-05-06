const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { app } = require('electron');
const { getDocumentsDir } = require('./storagePaths');
const employeeRepo = require('./employeeRepo');

const PLATFORM = process.platform; // 'darwin' | 'win32' | 'linux'

// Set by init() from main.js after app is ready.
// Default to __dirname/tessdata for dev; init() resolves the packaged resources/tessdata path.
let TESSDATA_DIR = path.join(__dirname, 'tessdata');
let USER_TESSDATA_DIR = TESSDATA_DIR;
let APP_IS_PACKAGED = Boolean(app?.isPackaged);
let OCR_BINARY = resolveOcrBinaryPath();
let BUNDLED_TESSDATA_DIR = resolveBundledTessdataDir();
let TESSDATA_SOURCE = 'default';
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

function createAbortError() {
  const error = new Error('Importazione annullata');
  error.name = 'AbortError';
  error.code = 'PDF_IMPORT_CANCELLED';
  return error;
}

function createOcrUnavailableError() {
  const error = new Error('OCR non disponibile su questo sistema');
  error.code = 'OCR_UNAVAILABLE';
  return error;
}

function createOcrRequiredError(reason = 'missing_tessdata') {
  const searchedPathSuffix = reason === 'missing_tessdata' && TESSDATA_DIR
    ? ` Cartella OCR cercata: ${TESSDATA_DIR}`
    : '';
  const error = new Error(
    `PDF scansionato: per leggerlo serve OCR. Installa/abilita dati OCR oppure inserisci manualmente.${searchedPathSuffix}`
  );
  error.code = 'OCR_REQUIRED';
  error.reason = reason;
  error.tessdataPath = TESSDATA_DIR;
  return error;
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'PDF_IMPORT_CANCELLED';
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
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

function resolveBundledTessdataDir() {
  if (process.resourcesPath) {
    return path.join(process.resourcesPath, 'tessdata');
  }

  return path.join(__dirname, '..', '..', 'resources', 'tessdata');
}

function buildTessdataCandidates(userDataDir) {
  const candidates = [];
  const addCandidate = (source, dir) => {
    if (!dir) return;
    const normalizedDir = path.resolve(dir);
    if (candidates.some((candidate) => candidate.dir === normalizedDir)) return;
    candidates.push({
      source,
      dir: normalizedDir,
      exists: fs.existsSync(normalizedDir),
      files: listTessdataFiles(normalizedDir),
      ita_exists: getLanguageCandidates('ita', normalizedDir).some((filePath) => fs.existsSync(filePath)),
      eng_exists: getLanguageCandidates('eng', normalizedDir).some((filePath) => fs.existsSync(filePath)),
    });
  };

  addCandidate('packaged', process.resourcesPath ? path.join(process.resourcesPath, 'tessdata') : '');
  addCandidate('resources', path.join(process.cwd(), 'resources', 'tessdata'));
  try {
    addCandidate('appPath', app?.getAppPath ? path.join(app.getAppPath(), 'resources', 'tessdata') : '');
  } catch {
    // app.getAppPath can be unavailable before Electron app init in CLI contexts.
  }
  addCandidate('dirname', path.resolve(__dirname, '../../resources/tessdata'));
  addCandidate('userData', userDataDir ? path.join(userDataDir, 'tessdata') : '');

  return candidates;
}

function resolveRuntimeTessdata(userDataDir) {
  const candidates = buildTessdataCandidates(userDataDir);
  const withLanguage = candidates.find((candidate) => candidate.exists && (candidate.ita_exists || candidate.eng_exists));
  const existing = withLanguage || candidates.find((candidate) => candidate.exists);
  const fallback = existing || candidates[candidates.length - 1] || {
    source: 'default',
    dir: path.join(__dirname, 'tessdata'),
    exists: false,
    files: [],
    ita_exists: false,
    eng_exists: false,
  };

  return {
    ...fallback,
    candidates,
  };
}

function listTessdataFiles(dir = TESSDATA_DIR) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((fileName) => /\.traineddata(?:\.gz)?$/i.test(fileName))
      .sort();
  } catch {
    return [];
  }
}

function logTessdataRuntime(reason = 'check') {
  const itaPath = path.join(TESSDATA_DIR, 'ita.traineddata.gz');
  const engPath = path.join(TESSDATA_DIR, 'eng.traineddata.gz');
  const languages = getAvailableTesseractLanguages(TESSDATA_DIR);
  logPdfImportEvent('tessdata-runtime', {
    reason,
    is_packaged: APP_IS_PACKAGED,
    cwd: process.cwd(),
    dirname: __dirname,
    process_resources_path: process.resourcesPath || '',
    tessdata_path: TESSDATA_DIR,
    tessdata_source: TESSDATA_SOURCE,
    bundled_tessdata_path: BUNDLED_TESSDATA_DIR,
    user_tessdata_path: USER_TESSDATA_DIR,
    tessdata_exists: fs.existsSync(TESSDATA_DIR),
    ita_traineddata_gz_exists: fs.existsSync(itaPath),
    eng_traineddata_gz_exists: fs.existsSync(engPath),
    files: listTessdataFiles(TESSDATA_DIR),
    ocr_available: languages.length > 0,
    reason_if_false: languages.length > 0 ? '' : `missing_tessdata: ${TESSDATA_DIR}`,
    candidates: buildTessdataCandidates(USER_TESSDATA_DIR ? path.dirname(USER_TESSDATA_DIR) : ''),
  });
}

function getLanguageCandidates(language, dir = TESSDATA_DIR) {
  return [
    path.join(dir, `${language}.traineddata.gz`),
    path.join(dir, `${language}.traineddata`),
  ];
}

function getAvailableTesseractLanguages(dir = TESSDATA_DIR) {
  return ['ita', 'eng'].filter((language) =>
    getLanguageCandidates(language, dir).some((filePath) => fs.existsSync(filePath))
  );
}

function copyBundledTessdataIfAvailable() {
  BUNDLED_TESSDATA_DIR = resolveBundledTessdataDir();
  if (!fs.existsSync(BUNDLED_TESSDATA_DIR)) {
    return false;
  }

  fs.mkdirSync(TESSDATA_DIR, { recursive: true });
  let copied = false;
  for (const language of ['ita', 'eng']) {
    for (const sourcePath of getLanguageCandidates(language, BUNDLED_TESSDATA_DIR)) {
      if (!fs.existsSync(sourcePath)) continue;
      const targetPath = path.join(TESSDATA_DIR, path.basename(sourcePath));
      if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(sourcePath, targetPath);
        copied = true;
      }
    }
  }
  if (copied) {
    logPdfImportEvent('tessdata-copied', {
      source_dir: BUNDLED_TESSDATA_DIR,
      target_dir: TESSDATA_DIR,
    });
  }
  return copied;
}

function getAvailableTesseractLanguagesWithBundledFallback() {
  const currentLanguages = getAvailableTesseractLanguages(TESSDATA_DIR);
  if (currentLanguages.length) return currentLanguages;
  if (TESSDATA_DIR !== BUNDLED_TESSDATA_DIR) {
    copyBundledTessdataIfAvailable();
  }
  return getAvailableTesseractLanguages(TESSDATA_DIR);
}

function logOcrDisabled(reason, details = {}) {
  logPdfImportEvent('ocr-disabled', {
    reason,
    bundled_dir: BUNDLED_TESSDATA_DIR,
    user_tessdata_dir: TESSDATA_DIR,
    ...details,
  });
}

function logOcrRequired(filePath, reason, details = {}) {
  logPdfImportEvent('ocr-required', {
    file_path: filePath,
    pdf_import_model: 'scanned_pdf_ocr',
    ocr_available: false,
    reason,
    ...details,
  });
}

function ensureTesseractLanguages() {
  logTessdataRuntime('ensure-languages');
  const languages = getAvailableTesseractLanguagesWithBundledFallback();
  if (languages.length) {
    process.env.TESSDATA_PREFIX = TESSDATA_DIR;
    logPdfImportEvent('ocr-enabled', {
      process_resources_path: process.resourcesPath || '',
      tessdata_path: TESSDATA_DIR,
      languages,
      files: listTessdataFiles(TESSDATA_DIR),
    });
    return languages;
  }

  const expectedFiles = ['ita', 'eng'].flatMap((language) => getLanguageCandidates(language, TESSDATA_DIR));
  logPdfImportEvent('ocr-disabled-missing-language', {
    languages: ['ita', 'eng'],
    expected_files: expectedFiles,
    bundled_dir: BUNDLED_TESSDATA_DIR,
    user_tessdata_dir: TESSDATA_DIR,
    searched_tessdata_path: TESSDATA_DIR,
    candidates: buildTessdataCandidates(USER_TESSDATA_DIR ? path.dirname(USER_TESSDATA_DIR) : ''),
  });
  logOcrDisabled('missing-language', {
    languages: ['ita', 'eng'],
    expected_files: expectedFiles,
    searched_tessdata_path: TESSDATA_DIR,
  });
  return [];
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
  USER_TESSDATA_DIR = path.join(userDataDir, 'tessdata');
  APP_IS_PACKAGED = Boolean(app?.isPackaged);
  OCR_BINARY = resolveOcrBinaryPath();
  BUNDLED_TESSDATA_DIR = resolveBundledTessdataDir();
  const resolvedTessdata = resolveRuntimeTessdata(userDataDir);
  TESSDATA_DIR = resolvedTessdata.dir;
  TESSDATA_SOURCE = resolvedTessdata.source;
  process.env.TESSDATA_PREFIX = TESSDATA_DIR;
  if (TESSDATA_DIR === USER_TESSDATA_DIR) {
    copyBundledTessdataIfAvailable();
  }
  logTessdataRuntime('init');
  ensureOcrExecutable();
}

// ── Text extraction via pdfjs-dist (no canvas, any platform) ─────────────────
// Uses PDF's embedded text when available (fast, exact).
// Returns [{pageNumber, items:[{t,x,y,w,h}]}] — normalized 0-1, origin bottom-left.
async function extractTextPages(filePath, options = {}) {
  const { signal } = options;
  try {
    const result = await withSuppressedPdfJsWarningsAsync(async () => {
      throwIfAborted(signal);
      const pdfjsLib = loadPdfJsLib();
      const data = new Uint8Array(fs.readFileSync(filePath));
      const doc = await pdfjsLib.getDocument(buildPdfJsDocumentOptions(pdfjsLib, data)).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        throwIfAborted(signal);
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
    if (isAbortError(e)) {
      throw e;
    }
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
    'cognomenome',
    'codicefiscale',
    'cf',
    'data',
    'datanascita',
    'datainizio',
    'iniziorapporto',
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
  const directPattern = /([A-Z]\s*){6}[0-9O]\s*[0-9O]\s*[A-Z]\s*[0-9O]\s*[0-9O]\s*[A-Z]\s*[0-9O]\s*[0-9O]\s*[0-9O]\s*[A-Z]/i;
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
      if (match?.[0]) {
        const value = match[0].replace(/\s+/g, '').toUpperCase();
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

function findFiscalCodeInText(value = '') {
  const text = normalizeOcrText(value).toUpperCase();
  const directPattern = /([A-Z]\s*){6}[0-9O]\s*[0-9O]\s*[A-Z]\s*[0-9O]\s*[0-9O]\s*[A-Z]\s*[0-9O]\s*[0-9O]\s*[0-9O]\s*[A-Z]/i;
  const match = text.match(directPattern);
  return match?.[0] ? match[0].replace(/\s+/g, '').toUpperCase() : null;
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

function hasWorkerCandidateSignal(lines = []) {
  const text = normalizeOcrText(lines.map((line) => line.text).join(' '));
  const token = normalizeLabelToken(text);
  return Boolean(
    findFiscalCodeInText(text) ||
      token.includes('cognome') ||
      token.includes('nome') ||
      token.includes('codicefiscale') ||
      token.includes('datainizio') ||
      token.includes('iniziorapporto')
  );
}

function buildScannedWorkerBlocks(pages = []) {
  const lines = buildDocumentLines(pages);
  const blocks = [];
  const pagesWithoutRecord = [];

  for (let pageNumber = 0; pageNumber < pages.length; pageNumber += 2) {
    const pageNumbers = [pageNumber];
    if (pages[pageNumber + 1]) pageNumbers.push(pageNumber + 1);
    const blockLines = lines.filter((line) => pageNumbers.includes(line.pageNumber));
    if (!blockLines.length) {
      pagesWithoutRecord.push(...pageNumbers);
      continue;
    }

    const hasSignal = hasWorkerCandidateSignal(blockLines);
    if (!hasSignal) {
      pagesWithoutRecord.push(...pageNumbers);
      continue;
    }

    blocks.push({
      lines: blockLines,
      page_numbers: pageNumbers,
      used_fallback: true,
      candidate_source: 'scanned_page_pair',
      original_text: normalizeOcrText(blockLines.map((entry) => entry.text).join(' ')),
    });
  }

  if (!blocks.length) {
    return {
      blocks: buildWorkerBlocks(pages).map((block) => ({
        ...block,
        candidate_source: block.candidate_source || 'section_or_default_fallback',
      })),
      pages_without_record: pagesWithoutRecord,
    };
  }

  return {
    blocks,
    pages_without_record: pagesWithoutRecord,
  };
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

function buildInlineLabelPattern(label) {
  return escapeRegExp(String(label || '').trim())
    .replace(/\\\./g, '[.]?')
    .replace(/\s+/g, '\\s+');
}

function extractLabeledInlineValue(text = '', labels = [], stopLabels = [], valueType = 'text') {
  const normalizedText = normalizeOcrText(text);
  if (!normalizedText) {
    return {
      value: valueType === 'fiscal_code' ? null : '',
      source: '',
    };
  }

  const stopPattern = Array.from(new Set(stopLabels.filter(Boolean)))
    .map(buildInlineLabelPattern)
    .join('|');

  for (const label of labels) {
    const labelPattern = buildInlineLabelPattern(label);
    const regex = new RegExp(
      `(?:^|\\b)${labelPattern}(?![a-z0-9])\\s*[:\\-]?\\s*(.+?)${stopPattern ? `(?=\\s*(?:${stopPattern})(?![a-z0-9])|$)` : '$'}`,
      'i'
    );
    const match = regex.exec(normalizedText);
    if (!match?.[1]) continue;
    const value = normalizeDetectedFieldValue(match[1], valueType);
    if (value) {
      return {
        value,
        source: 'inline_text',
      };
    }
  }

  return {
    value: valueType === 'fiscal_code' ? null : '',
    source: '',
  };
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
  const sectionText = normalizeOcrText(section2Lines.map((line) => line.text).join(' '));

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
    fiscal_code: fiscalCodeFromLines.value || fiscalCodeFromItems.value || findFiscalCodeInText(sectionText) || null,
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
  const inlineStartDateField = extractLabeledInlineValue(sectionText, ['data inizio', 'inizio rapporto'], ['data fine', 'fine rapporto', 'tipo lavorazione', 'lavorazione', 'retribuzione'], 'date');
  const inlineEndDateField = extractLabeledInlineValue(sectionText, ['data fine', 'fine rapporto'], ['data inizio', 'inizio rapporto', 'tipo lavorazione', 'lavorazione', 'retribuzione'], 'date');
  const inlineWorkTypeField = extractLabeledInlineValue(sectionText, ['tipo lavorazione', 'lavorazione'], ['giornate previste', 'data inizio', 'inizio rapporto', 'data fine', 'fine rapporto', 'retribuzione'], 'text');
  const inlineExpectedDaysField = extractLabeledInlineValue(sectionText, ['giornate previste'], ['tipo lavorazione', 'lavorazione', 'retribuzione', 'data inizio', 'data fine'], 'number');
  const payField = extractLabeledInlineValue(sectionText, ['retribuzione', 'paga giornaliera', 'importo retribuzione'], ['livello', 'qualifica', 'tipo lavorazione', 'lavorazione'], 'number');
  const sectionDates = [...new Set((sectionText.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || []))];
  const fallbackStart = startDateField.value || inlineStartDateField.value || sectionDates[0] || null;
  const fallbackEnd = endDateField.value || inlineEndDateField.value || (sectionDates.length > 1 ? sectionDates[sectionDates.length - 1] : null);

  return {
    hire_date_from: fallbackStart,
    hire_date_to: fallbackEnd,
    tipo_lavorazione: workTypeField.value || inlineWorkTypeField.value || '',
    giornate_previste: expectedDaysField.value || inlineExpectedDaysField.value || '',
    daily_pay: payField.value || '',
  };
}

function parseEmployerSection(section1Lines = []) {
  const sectionText = normalizeOcrText(section1Lines.map((line) => line.text).join(' '));
  const nameField = extractLabeledValue(
    section1Lines,
    ['denominazione', 'ragione sociale'],
    ['azienda artigiana', 'codice fiscale', 'p.iva', 'partita iva', 'comune sede legale', 'indirizzo sede legale', 'comune sede di lavoro', 'indirizzo sede di lavoro'],
    'text'
  );
  const taxCodeField = extractLabeledValue(
    section1Lines,
    ['codice fiscale'],
    ['p.iva', 'partita iva', 'denominazione', 'ragione sociale', 'comune sede legale', 'indirizzo sede legale', 'comune sede di lavoro', 'indirizzo sede di lavoro'],
    'text'
  );
  const vatField = extractLabeledValue(
    section1Lines,
    ['p.iva', 'partita iva'],
    ['denominazione', 'ragione sociale', 'comune sede legale', 'indirizzo sede legale', 'comune sede di lavoro', 'indirizzo sede di lavoro'],
    'text'
  );
  const inlineNameField = extractLabeledInlineValue(
    sectionText,
    ['denominazione', 'ragione sociale'],
    ['azienda artigiana', 'codice fiscale', 'p.iva', 'partita iva', 'comune sede legale', 'indirizzo sede legale', 'comune sede di lavoro', 'indirizzo sede di lavoro'],
    'text'
  );
  const inlineTaxCodeField = extractLabeledInlineValue(
    sectionText,
    ['codice fiscale'],
    ['p.iva', 'partita iva', 'denominazione', 'ragione sociale', 'comune sede legale', 'indirizzo sede legale', 'comune sede di lavoro', 'indirizzo sede di lavoro'],
    'text'
  );
  const inlineVatField = extractLabeledInlineValue(
    sectionText,
    ['p.iva', 'partita iva'],
    ['denominazione', 'ragione sociale', 'azienda artigiana', 'comune sede legale', 'indirizzo sede legale', 'comune sede di lavoro', 'indirizzo sede di lavoro'],
    'text'
  );
  const legalComuneField = extractLabeledValue(
    section1Lines,
    ['comune sede legale'],
    ['c.a.p. sede legale', 'indirizzo sede legale', 'telefono sede legale', 'fax sede legale'],
    'text'
  );
  const inlineLegalComuneField = extractLabeledInlineValue(
    sectionText,
    ['comune sede legale'],
    ['c.a.p. sede legale', 'indirizzo sede legale', 'telefono sede legale', 'fax sede legale'],
    'text'
  );
  const legalAddressField = extractLabeledValue(
    section1Lines,
    ['indirizzo sede legale'],
    ['telefono sede legale', 'fax sede legale', 'e-mail sede legale', 'email sede legale', 'comune sede di lavoro'],
    'text'
  );
  const inlineLegalAddressField = extractLabeledInlineValue(
    sectionText,
    ['indirizzo sede legale'],
    ['telefono sede legale', 'fax sede legale', 'e-mail sede legale', 'email sede legale', 'comune sede di lavoro'],
    'text'
  );
  const workplaceComuneField = extractLabeledValue(
    section1Lines,
    ['comune sede di lavoro'],
    ['c.a.p. sede di lavoro', 'indirizzo sede di lavoro', 'telefono sede di lavoro', 'fax sede operativa'],
    'text'
  );
  const inlineWorkplaceComuneField = extractLabeledInlineValue(
    sectionText,
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
  const inlineWorkplaceAddressField = extractLabeledInlineValue(
    sectionText,
    ['indirizzo sede di lavoro'],
    ['telefono sede di lavoro', 'fax sede operativa', 'e-mail sede di lavoro', 'email sede di lavoro'],
    'text'
  );
  const emailField = extractLabeledInlineValue(
    sectionText,
    ['e-mail sede di lavoro', 'email sede di lavoro', 'e-mail sede legale', 'email sede legale'],
    ['telefono sede di lavoro', 'telefono sede legale', 'fax sede operativa', 'fax sede legale'],
    'text'
  );
  const phoneField = extractLabeledInlineValue(
    sectionText,
    ['telefono sede di lavoro', 'telefono sede legale'],
    ['fax sede operativa', 'fax sede legale', 'e-mail sede di lavoro', 'email sede di lavoro', 'e-mail sede legale', 'email sede legale'],
    'text'
  );

  const workplace = [workplaceComuneField.value, workplaceAddressField.value].filter(Boolean).join(' · ');
  const employerTaxCode = normalizeOcrText(taxCodeField.value || inlineTaxCodeField.value).toUpperCase().match(/\b([A-Z]{6}[0-9O]{2}[A-Z][0-9O]{2}[A-Z][0-9O]{3}[A-Z])\b/i)?.[1]?.replace(/O/g, '0') || '';
  const employerVatNumber = normalizeOcrText(vatField.value || inlineVatField.value).match(/\b(\d{11})\b/)?.[1] || '';
  const employerName = sanitizeDetectedNamePart(nameField.value || inlineNameField.value);
  const employerLegalCity = sanitizeDetectedNamePart(legalComuneField.value || inlineLegalComuneField.value);
  const employerLegalAddress = sanitizeDetectedNamePart(legalAddressField.value || inlineLegalAddressField.value);
  const employerWorkCity = sanitizeDetectedNamePart(workplaceComuneField.value || inlineWorkplaceComuneField.value || employerLegalCity);
  const employerWorkAddress = sanitizeDetectedNamePart(workplaceAddressField.value || inlineWorkplaceAddressField.value || employerLegalAddress);
  const taxId = [employerTaxCode, employerVatNumber].filter(Boolean).join(' / ');
  const workplaceDisplay = [employerWorkAddress, employerWorkCity].filter(Boolean).join(' - ');

  return {
    name: employerName,
    tax_id: taxId,
    workplace: workplaceDisplay,
    tax_code: employerTaxCode,
    vat_number: employerVatNumber,
    legal_city: employerLegalCity,
    legal_address: employerLegalAddress,
    work_city: employerWorkCity,
    work_address: employerWorkAddress,
    email: normalizeOcrText(emailField.value),
    phone: normalizeOcrText(phoneField.value).match(/[\d\s/+()-]{6,}/)?.[0]?.replace(/\s+/g, '') || '',
  };
}

// ── macOS: Swift + PDFKit + Vision ───────────────────────────────────────────
// Returns [{pageNumber, items:[{t,x,y,w,h}]}]
async function runSwiftOcr(filePath, options = {}) {
  const { signal } = options;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let child = null;
    const abortHandler = () => {
      logPdfImportEvent('ocr-process-kill', {
        file_path: filePath,
        platform: PLATFORM,
        pid: child?.pid || null,
      });
      child?.kill?.('SIGTERM');
      setTimeout(() => {
        if (child && !child.killed) child.kill('SIGKILL');
      }, 1500).unref?.();
    };
    signal?.addEventListener?.('abort', abortHandler, { once: true });
    child = execFile(OCR_BINARY, [filePath], { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      signal?.removeEventListener?.('abort', abortHandler);
      if (signal?.aborted) return reject(createAbortError());
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
async function runTesseractOcr(filePath, options = {}) {
  const { signal } = options;
  return withSuppressedPdfJsWarningsAsync(async () => {
    throwIfAborted(signal);
    const languages = Array.isArray(options.languages) && options.languages.length
      ? options.languages
      : ensureTesseractLanguages();
    if (!languages.length) {
      throw createOcrUnavailableError();
    }
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

    process.env.TESSDATA_PREFIX = TESSDATA_DIR;
    logPdfImportEvent('ocr-worker-start', {
      process_resources_path: process.resourcesPath || '',
      tessdata_path: TESSDATA_DIR,
      tessdata_exists: fs.existsSync(TESSDATA_DIR),
      ita_traineddata_gz_exists: fs.existsSync(path.join(TESSDATA_DIR, 'ita.traineddata.gz')),
      eng_traineddata_gz_exists: fs.existsSync(path.join(TESSDATA_DIR, 'eng.traineddata.gz')),
      languages,
      files: listTessdataFiles(TESSDATA_DIR),
    });
    const worker = await createWorker(languages, 1, { langPath: TESSDATA_DIR });
    let workerTerminated = false;
    const terminateWorker = async () => {
      if (workerTerminated) return;
      workerTerminated = true;
      try {
        await worker.terminate();
      } catch (error) {
        logPdfImportEvent('ocr-worker-terminate-failed', {
          file_path: filePath,
          message: error?.message || String(error),
        });
      }
    };
    const abortHandler = () => {
      logPdfImportEvent('ocr-worker-terminate', {
        file_path: filePath,
        platform: PLATFORM,
      });
      terminateWorker();
    };
    signal?.addEventListener?.('abort', abortHandler, { once: true });

    const ocrPages = [];
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        throwIfAborted(signal);
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

        throwIfAborted(signal);
        const pngBuffer = canvas.toBuffer('image/png');
        const ocrResult = await worker.recognize(pngBuffer);
        const ocrData = ocrResult?.data || {};
        const ocrText = String(ocrData.text || '');
        const ocrLines = Array.isArray(ocrData.lines)
          ? ocrData.lines
          : ocrText.split('\n').map((line) => line.trim()).filter(Boolean);
        const ocrWords = Array.isArray(ocrData.words) ? ocrData.words : [];
        throwIfAborted(signal);
        logPdfImportEvent('ocr-page-result', {
          file_path: filePath,
          page_number: i - 1,
          text_length: ocrText.length,
          has_lines: Array.isArray(ocrData.lines),
          has_words: Array.isArray(ocrData.words),
          line_count: ocrLines.length,
          word_count: ocrWords.length,
        });

        // Tesseract bbox: origin top-left (y0=top, y1=bottom).
        // Convert to Vision-style: origin bottom-left (y=bottom-of-box / imgH flipped).
        const rawWords = ocrWords
          .filter((wd) => String(wd?.text || '').trim() && Number(wd?.confidence || 0) > 30 && wd?.bbox)
          .map((wd) => ({
            t: String(wd.text || '').trim(),
            x: wd.bbox.x0 / w,
            y: 1 - wd.bbox.y1 / h,
            w: (wd.bbox.x1 - wd.bbox.x0) / w,
            h: (wd.bbox.y1 - wd.bbox.y0) / h,
          }));

        const fallbackLineItems = rawWords.length
          ? []
          : ocrLines.map((line, lineIndex) => ({
              t: line,
              x: 0.05,
              y: Math.max(0.02, 0.95 - lineIndex * 0.03),
              w: 0.9,
              h: 0.025,
            }));

        const pageItems = rawWords.length ? mergeAdjacentWords(rawWords) : fallbackLineItems;
        logPdfImportEvent('ocr-page-items', {
          file_path: filePath,
          page_number: i - 1,
          ocr_text_length: ocrText.length,
          ocr_items_count: pageItems.length,
          used_text_fallback: !rawWords.length,
        });
        ocrPages.push({
          pageNumber: i - 1,
          items: pageItems,
        });
      }
    } finally {
      signal?.removeEventListener?.('abort', abortHandler);
      await terminateWorker();
    }

    return ocrPages;
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
async function extractPages(filePath, options = {}) {
  const { signal } = options;
  throwIfAborted(signal);
  const textPages = await extractTextPages(filePath, { signal });
  throwIfAborted(signal);
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
      diagnostics: buildImportDiagnostics({
        detected_model: detectedModel,
        text_length: getPagesTextLength(textPages),
        reason: 'embedded_text',
      }),
    };
  }

  const detectedModel = hasAnyText ? 'mixed_pdf' : 'scanned_pdf_ocr';

  if (PLATFORM === 'darwin') {
    const availability = ensureOcrExecutable();
    if (!availability.exists) {
      logOcrDisabled('missing-ocr-binary', {
        pdf_import_model: detectedModel,
        ocr_available: false,
        ocr_path: availability.ocr_path,
      });
      if (detectedModel === 'scanned_pdf_ocr') {
        logOcrRequired(filePath, 'missing_ocr_binary', {
          ocr_path: availability.ocr_path,
        });
        throw createOcrRequiredError('missing_ocr_binary');
      }
      logOcrFallback(filePath, 'missing-ocr-binary', {
        textual_page_count: textPages.length,
      });
      return buildTextFallbackResult(textPages, detectedModel);
    }
    if (!availability.executable) {
      logOcrDisabled('ocr-binary-not-executable', {
        pdf_import_model: detectedModel,
        ocr_available: false,
        ocr_path: availability.ocr_path,
      });
      if (detectedModel === 'scanned_pdf_ocr') {
        logOcrRequired(filePath, 'ocr_binary_not_executable', {
          ocr_path: availability.ocr_path,
        });
        throw createOcrRequiredError('ocr_binary_not_executable');
      }
      logOcrFallback(filePath, 'ocr-binary-not-executable', {
        textual_page_count: textPages.length,
      });
      return buildTextFallbackResult(textPages, detectedModel);
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
    try {
      const ocrPages = await runSwiftOcr(filePath, { signal });
      const arr = [];
      for (const p of ocrPages) arr[p.pageNumber] = p.items;
      return {
        pages: arr,
        detectedModel,
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      logOcrDisabled('ocr-execution-failed', {
        platform: PLATFORM,
        pdf_import_model: detectedModel,
        ocr_available: true,
        message: error?.message || String(error),
      });
      if (detectedModel === 'scanned_pdf_ocr') {
        logOcrRequired(filePath, 'ocr_execution_failed', {
          message: error?.message || String(error),
        });
        throw createOcrRequiredError('ocr_execution_failed');
      }
      logOcrFallback(filePath, 'ocr-execution-failed', {
        textual_page_count: textPages.length,
        message: error?.message || String(error),
      });
      return buildTextFallbackResult(textPages, detectedModel);
    }
  }

  if (PLATFORM === 'win32') {
    const availability = getOcrAvailability();
    const languages = ensureTesseractLanguages();
    if (!fs.existsSync(TESSDATA_DIR) || !languages.length) {
      if (detectedModel === 'scanned_pdf_ocr') {
        logOcrRequired(filePath, 'missing_tessdata', {
          tessdata_dir: TESSDATA_DIR,
          available_languages: languages,
        });
        throw createOcrRequiredError('missing_tessdata');
      }
      logOcrFallback(filePath, 'missing-tessdata-language', {
        tessdata_dir: TESSDATA_DIR,
        textual_page_count: textPages.length,
      });
      return buildTextFallbackResult(textPages, detectedModel);
    }
    logPdfImportEvent('extract-mode', {
      file_path: filePath,
      mode: 'tesseract_ocr',
      detected_model: detectedModel,
      ocr_path: availability.ocr_path,
      ocr_exists: availability.exists,
      ocr_executable: availability.executable,
      ocr_languages: languages,
      textual_fallback: false,
    });
    try {
      logPdfImportEvent('ocr-start', {
        file_path: filePath,
        pdf_import_model: detectedModel,
        ocr_available: true,
        ocr_enabled: true,
        tessdata_path: TESSDATA_DIR,
        tessdata_source: TESSDATA_SOURCE,
        languages,
      });
      const ocrPages = await runTesseractOcr(filePath, { signal, languages });
      const ocrTextLength = getPagesTextLength(ocrPages);
      logPdfImportEvent('ocr-success', {
        file_path: filePath,
        pdf_import_model: detectedModel,
        text_length: ocrTextLength,
        page_count: ocrPages.length,
        languages,
      });
      const arr = [];
      for (const p of ocrPages) arr[p.pageNumber] = p.items;
      if (arr.length) {
        return {
          pages: arr,
          detectedModel,
          diagnostics: buildImportDiagnostics({
            detected_model: detectedModel,
            text_length: getPagesTextLength(textPages),
            ocr_attempted: true,
            ocr_available: true,
            ocr_enabled: true,
            ocr_text_length: ocrTextLength,
            reason: 'ocr_success',
            ocr_languages: languages,
          }),
        };
      }
      logOcrDisabled('ocr-returned-no-pages', {
        platform: PLATFORM,
        pdf_import_model: detectedModel,
        ocr_available: true,
        ocr_languages: languages,
      });
      logOcrFallback(filePath, 'ocr-returned-no-pages', {
        textual_page_count: textPages.length,
      });
      return {
        ...buildTextFallbackResult(textPages, detectedModel),
        diagnostics: buildImportDiagnostics({
          detected_model: detectedModel,
          text_length: getPagesTextLength(textPages),
          ocr_attempted: true,
          ocr_available: true,
          ocr_enabled: true,
          ocr_text_length: ocrTextLength,
          fallback_used: true,
          reason: 'ocr_returned_no_pages',
          ocr_languages: languages,
        }),
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      logPdfImportEvent('ocr-error', {
        file_path: filePath,
        pdf_import_model: detectedModel,
        ocr_available: true,
        ocr_enabled: true,
        tessdata_path: TESSDATA_DIR,
        tessdata_source: TESSDATA_SOURCE,
        languages,
        message: error?.message || String(error),
        stack: error?.stack || '',
      });
      logOcrDisabled('ocr-execution-failed', {
        platform: PLATFORM,
        pdf_import_model: detectedModel,
        ocr_available: true,
        ocr_languages: languages,
        message: error?.message || String(error),
      });
      logOcrFallback(filePath, 'ocr-execution-failed', {
        textual_page_count: textPages.length,
        message: error?.message || String(error),
      });
      return {
        ...buildTextFallbackResult(textPages, detectedModel),
        ocrError: error?.message || String(error),
        diagnostics: buildImportDiagnostics({
          detected_model: detectedModel,
          text_length: getPagesTextLength(textPages),
          ocr_attempted: true,
          ocr_available: true,
          ocr_enabled: true,
          ocr_error: error?.message || String(error),
          fallback_used: true,
          reason: 'ocr_execution_failed',
          ocr_languages: languages,
        }),
      };
    }
  }

  if (PLATFORM === 'linux') {
    const availability = ensureOcrExecutable();
    logOcrDisabled('unsupported-platform', {
      platform: PLATFORM,
      pdf_import_model: detectedModel,
      ocr_available: false,
      ocr_path: availability.ocr_path,
      ocr_exists: availability.exists,
      ocr_executable: availability.executable,
    });
    if (detectedModel === 'scanned_pdf_ocr') {
      logOcrRequired(filePath, 'unsupported_platform', {
        platform: PLATFORM,
      });
      throw createOcrRequiredError('unsupported_platform');
    }
    logOcrFallback(filePath, 'unsupported-platform', {
      textual_page_count: textPages.length,
    });
    return buildTextFallbackResult(textPages, detectedModel);
  }

  logOcrDisabled('unsupported-platform', {
    platform: PLATFORM,
    pdf_import_model: detectedModel,
    ocr_available: false,
  });
  if (detectedModel === 'scanned_pdf_ocr') {
    logOcrRequired(filePath, 'unsupported_platform', {
      platform: PLATFORM,
    });
    throw createOcrRequiredError('unsupported_platform');
  }
  logOcrFallback(filePath, 'unsupported-platform', {
    textual_page_count: textPages.length,
  });
  return buildTextFallbackResult(textPages, detectedModel);
}

function buildReadableParseError(error) {
  if (error?.code === 'OCR_REQUIRED') {
    return error.message;
  }

  if (error?.code === 'OCR_UNAVAILABLE') {
    return 'OCR non disponibile su questo sistema';
  }

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
function buildTextFallbackResult(textPages, detectedModel = 'text_pdf') {
  const arr = [];
  for (const p of textPages || []) {
    arr[p.pageNumber] = p.items || [];
  }
  return {
    pages: arr,
    detectedModel,
    ocrUnavailable: true,
  };
}

function getPagesTextLength(pages = []) {
  return (pages || []).reduce((sum, page) => {
    const items = Array.isArray(page?.items) ? page.items : page || [];
    return sum + items.reduce((itemSum, item) => itemSum + String(item?.t || '').trim().length, 0);
  }, 0);
}

function buildImportDiagnostics(overrides = {}) {
  const languages = getAvailableTesseractLanguages(TESSDATA_DIR);
  return {
    detected_model: '',
    records_length: 0,
    text_length: 0,
    ocr_attempted: false,
    ocr_available: languages.length > 0,
    ocr_enabled: languages.length > 0,
    ocr_error: '',
    ocr_text_length: 0,
    fallback_used: false,
    reason: '',
    tessdata_path: TESSDATA_DIR,
    tessdata_source: TESSDATA_SOURCE,
    ocr_languages: languages,
    ...overrides,
  };
}

function logOcrFallback(filePath, reason, details = {}) {
  logPdfImportEvent('ocr-fallback-text', {
    file_path: filePath,
    reason,
    ...details,
  });
}

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
  const workerLines = section2Lines.length ? section2Lines : block.lines;
  const employmentLines = section4Lines.length ? section4Lines : block.lines;
  const workerInfo = parseWorkerSection(workerLines);
  const employmentInfo = parseEmploymentSection(employmentLines);
  const original_text = block.original_text || normalizeOcrText(block.lines.map((line) => line.text).join(' '));
  const hired_by_detected = documentEmployer || parseDatore(linesToItems(block.lines), documentEmployerInfo);
  const parserUncertainReasons = [];

  if (block.used_fallback) {
    parserUncertainReasons.push('Sezione 2 - Lavoratore non riconosciuta con certezza');
  }
  if (!section2Lines.length && !hasWorkerCandidateSignal(block.lines)) {
    parserUncertainReasons.push('Sezione 2 - Lavoratore non trovata');
  }
  if (!section4Lines.length && !employmentInfo.hire_date_from) {
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
    candidate_source: block.candidate_source || '',
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

function buildSyntheticPagesFromText(text = '') {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeOcrText(line))
    .filter(Boolean);
  const items = lines.map((line, index) => ({
    t: line,
    x: 0.05,
    y: Math.max(0.02, 0.95 - (index % 30) * 0.03),
    w: 0.9,
    h: 0.025,
  }));
  return [items];
}

function parseOcrTextAssunzioni(text = {}, options = {}) {
  const pages = buildSyntheticPagesFromText(text);
  const blockResult = buildScannedWorkerBlocks(pages);
  const documentLines = buildDocumentLines(pages);
  const documentEmployerInfo = parseEmployerSection(
    getSectionLines(documentLines, 'section1_employer', ['section2_worker', 'section5_attuatore'])
  );
  const documentEmployer = parseDatore(pages.flat(), documentEmployerInfo);
  const records = blockResult.blocks.map((block, index) =>
    parseSingleEmployee(
      { ...block, parse_model: 'online_ocr_text' },
      index,
      documentEmployer,
      documentEmployerInfo
    )
  );
  Object.defineProperty(records, 'importDiagnostics', {
    value: {
      ...buildImportDiagnostics({
        detected_model: 'online_ocr_text',
        text_length: String(text || '').length,
        ocr_attempted: true,
        ocr_available: true,
        ocr_enabled: true,
        ocr_text_length: String(text || '').length,
        reason: options.reason || 'ocr_online_success',
      }),
      pages_ocr_count: pages.length,
      candidate_blocks_count: blockResult.blocks.length,
      pages_without_record: blockResult.pages_without_record || [],
      records_length: records.length,
    },
    enumerable: false,
  });
  return records;
}

async function parsePdfAssunzioniWithProgress(filePath, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const { signal } = options;
  throwIfAborted(signal);
  logPdfImportEvent('parse-start', { file_path: filePath });
  onProgress({
    step: 'parsing_pdf',
    percent: 20,
    message: 'Parsing PDF in corso...',
  });
  let extracted;
  try {
    extracted = await extractPages(filePath, { signal });
  } catch (error) {
    if (isAbortError(error)) {
      logPdfImportEvent('parse-cancelled', { file_path: filePath });
      throw error;
    }
    const availability = getOcrAvailability();
    logPdfImportEvent('parse-failed', {
      file_path: filePath,
      ocr_path: availability.ocr_path,
      ocr_exists: availability.exists,
      ocr_executable: availability.executable,
      textual_fallback: false,
      message: error?.message || String(error),
    });
    const readableError = new Error(buildReadableParseError(error));
    if (error?.code) {
      readableError.code = error.code;
    }
    throw readableError;
  }
  throwIfAborted(signal);
  const pages = extracted.pages || [];
  const parseModel = extracted.detectedModel || 'text_pdf';
  const diagnostics = {
    ...buildImportDiagnostics(extracted.diagnostics || {}),
    detected_model: parseModel,
    text_length: Number(extracted.diagnostics?.text_length || 0),
    ocr_attempted: !!extracted.diagnostics?.ocr_attempted,
    ocr_available: !!extracted.diagnostics?.ocr_available,
    ocr_enabled: !!extracted.diagnostics?.ocr_enabled,
    ocr_error: extracted.diagnostics?.ocr_error || extracted.ocrError || '',
    ocr_text_length: Number(extracted.diagnostics?.ocr_text_length || 0),
    fallback_used: !!extracted.diagnostics?.fallback_used || !!extracted.ocrUnavailable,
    reason: extracted.diagnostics?.reason || '',
    tessdata_path: TESSDATA_DIR,
    tessdata_source: TESSDATA_SOURCE,
  };
  if (extracted.ocrUnavailable) {
    onProgress({
      step: 'parsing_pdf',
      percent: 42,
      message: 'OCR non disponibile su questo sistema. Uso parsing testuale.',
    });
  }
  logPdfImportEvent('parse-pages-ready', {
    file_path: filePath,
    page_count: pages.length,
    parse_model: parseModel,
    ocr_unavailable: !!extracted.ocrUnavailable,
    diagnostics,
  });
  onProgress({
    step: 'parsing_pdf',
    percent: 45,
    message: `PDF letto. Pagine rilevate: ${pages.length}. Modello: ${parseModel}.`,
  });

  const scannedBlockResult = parseModel === 'scanned_pdf_ocr'
    ? buildScannedWorkerBlocks(pages)
    : null;
  const baseWorkerBlocks = scannedBlockResult?.blocks || buildWorkerBlocks(pages);
  const workerBlocks = baseWorkerBlocks.map((block) => ({
    ...block,
    parse_model: parseModel,
  }));
  diagnostics.pages_ocr_count = pages.length;
  diagnostics.candidate_blocks_count = workerBlocks.length;
  diagnostics.pages_without_record = scannedBlockResult?.pages_without_record || [];
  logPdfImportEvent('candidate-blocks', {
    file_path: filePath,
    parse_model: parseModel,
    pages_ocr_count: diagnostics.pages_ocr_count,
    candidate_blocks_count: diagnostics.candidate_blocks_count,
    pages_without_record: diagnostics.pages_without_record,
    block_sources: workerBlocks.map((block) => block.candidate_source || 'section'),
  });
  const documentLines = buildDocumentLines(pages);
  const documentEmployerInfo = parseEmployerSection(
    getSectionLines(documentLines, 'section1_employer', ['section2_worker', 'section5_attuatore'])
  );
  const documentEmployer = parseDatore(pages.flat(), documentEmployerInfo);
  const records = [];
  for (let i = 0; i < workerBlocks.length; i += 1) {
    throwIfAborted(signal);
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
    diagnostics: {
      ...diagnostics,
      records_length: records.length,
      records_ready_count: records.filter((record) =>
        record.first_name && record.last_name && record.fiscal_code && record.hire_date_from
      ).length,
      records_to_fix_count: records.filter((record) =>
        !record.first_name || !record.last_name || !record.fiscal_code || !record.hire_date_from
      ).length,
    },
  });
  if (parseModel === 'scanned_pdf_ocr' && diagnostics.ocr_attempted && records.length === 0) {
    logPdfImportEvent('ocr-no-records', {
      file_path: filePath,
      pdf_import_model: parseModel,
      text_length: diagnostics.text_length,
      ocr_text_length: diagnostics.ocr_text_length,
      ocr_items_count: pages.reduce((sum, pageItems) => sum + (Array.isArray(pageItems) ? pageItems.length : 0), 0),
      records_found: records.length,
      ocr_error: diagnostics.ocr_error,
      reason: diagnostics.reason || 'parser_no_records',
      tessdata_path: TESSDATA_DIR,
      tessdata_source: TESSDATA_SOURCE,
    });
  }
  Object.defineProperty(records, 'importDiagnostics', {
    value: {
      ...diagnostics,
      records_length: records.length,
      records_ready_count: records.filter((record) =>
        record.first_name && record.last_name && record.fiscal_code && record.hire_date_from
      ).length,
      records_to_fix_count: records.filter((record) =>
        !record.first_name || !record.last_name || !record.fiscal_code || !record.hire_date_from
      ).length,
    },
    enumerable: false,
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
  createAbortError,
  createOcrUnavailableError,
  createOcrRequiredError,
  extractYearFromDate,
  init,
  isAbortError,
  logPdfImportEvent,
  normDateToISO,
  parseOcrTextAssunzioni,
  parsePdfAssunzioni,
  parsePdfAssunzioniWithProgress,
  getTargetYear,
  setLogger,
};
