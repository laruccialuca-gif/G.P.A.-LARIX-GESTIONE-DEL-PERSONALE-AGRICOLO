const fs = require('fs');
const path = require('path');
const { dialog, shell } = require('electron');
const { ensureAppStorageStructure, getDocumentsDir } = require('./storagePaths');

const DOCUMENT_FILTERS = [
  { name: 'Documenti', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
  { name: 'PDF', extensions: ['pdf'] },
  { name: 'Immagini', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeSegment(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function getDocumentsRoot() {
  ensureAppStorageStructure();
  return getDocumentsDir();
}

function getAbsolutePath(relativePath) {
  return path.join(getDocumentsRoot(), relativePath);
}

function detectMimeType(extension) {
  const ext = extension.toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

async function selectLocalFile(browserWindow, title) {
  const result = await dialog.showOpenDialog(browserWindow, {
    title,
    properties: ['openFile'],
    filters: DOCUMENT_FILTERS,
  });

  if (result.canceled || !result.filePaths?.length) {
    return null;
  }

  return result.filePaths[0];
}

function storeSelectedFile(sourcePath, targetDirSegments, targetBaseName) {
  const sourceName = path.basename(sourcePath);
  const extension = path.extname(sourceName) || '';
  const storedName = `${sanitizeSegment(targetBaseName) || 'documento'}${extension.toLowerCase()}`;
  const relativeDir = path.join(...targetDirSegments.map(sanitizeSegment).filter(Boolean));
  const relativePath = path.join(relativeDir, storedName);
  const absolutePath = getAbsolutePath(relativePath);

  ensureDir(path.dirname(absolutePath));
  fs.copyFileSync(sourcePath, absolutePath);

  const stats = fs.statSync(absolutePath);

  return {
    file_name: sourceName,
    stored_name: storedName,
    relative_path: relativePath,
    mime_type: detectMimeType(extension),
    size_bytes: stats.size,
  };
}

function removeStoredFile(relativePath) {
  if (!relativePath) return;

  const absolutePath = getAbsolutePath(relativePath);
  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
}

function describeStoredFile(documentRow) {
  if (!documentRow) {
    return null;
  }

  const absolutePath = getAbsolutePath(documentRow.relative_path);

  return {
    id: documentRow.id,
    file_name: documentRow.file_name,
    stored_name: documentRow.stored_name,
    mime_type: documentRow.mime_type,
    size_bytes: documentRow.size_bytes,
    uploaded_at: documentRow.uploaded_at,
    updated_at: documentRow.updated_at,
    relative_path: documentRow.relative_path,
    exists: fs.existsSync(absolutePath),
  };
}

function openStoredDocument(relativePath) {
  if (!relativePath) {
    return {
      success: false,
      message: 'Nessun file allegato.',
    };
  }

  const absolutePath = getAbsolutePath(relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      success: false,
      message: 'Il file allegato non esiste piu sul disco.',
    };
  }

  const error = shell.openPath(absolutePath);

  if (error && typeof error.then === 'function') {
    return error.then((result) => ({
      success: !result,
      message: result || null,
    }));
  }

  return {
    success: !error,
    message: error || null,
  };
}

module.exports = {
  describeStoredFile,
  getAbsolutePath,
  openStoredDocument,
  removeStoredFile,
  sanitizeSegment,
  selectLocalFile,
  storeSelectedFile,
};
