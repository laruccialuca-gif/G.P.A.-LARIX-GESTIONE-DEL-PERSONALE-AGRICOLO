import React from 'react';

function formatSize(size) {
  const num = Number(size || 0);
  if (!num) return null;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentActions({
  document,
  onUpload,
  onOpen,
  onDelete,
  uploadLabel = 'Carica file',
  openLabel = 'Apri file',
  deleteLabel = 'Elimina file',
  emptyLabel = 'Nessun file allegato',
  missingLabel = 'File non trovato sul disco',
  compact = false,
}) {
  const hasDocument = !!document;
  const exists = !!document?.exists;
  const sizeLabel = formatSize(document?.size_bytes);
  const resolvedUploadLabel =
    hasDocument && uploadLabel === 'Carica file' ? 'Sostituisci file' : uploadLabel;

  return (
    <div
      style={{
        display: 'grid',
        gap: 10,
        padding: compact ? 10 : 12,
        borderRadius: 16,
        background: 'rgba(255,255,255,0.7)',
        border: '1px solid rgba(20, 33, 61, 0.08)',
      }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <strong style={{ fontSize: 13 }}>
          {hasDocument ? document.file_name : emptyLabel}
        </strong>
        {hasDocument ? (
          <span style={{ fontSize: 12, color: exists ? '#667085' : '#b91c1c' }}>
            {exists ? 'File disponibile localmente' : missingLabel}
            {sizeLabel ? ` · ${sizeLabel}` : ''}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: '#667085' }}>
            Supportati PDF e immagini.
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="button-secondary" type="button" onClick={onUpload}>
          {resolvedUploadLabel}
        </button>
        <button
          className="button"
          type="button"
          onClick={onOpen}
          disabled={!hasDocument}
        >
          {openLabel}
        </button>
        <button
          className="button-danger"
          type="button"
          onClick={onDelete}
          disabled={!hasDocument}
        >
          {deleteLabel}
        </button>
      </div>
    </div>
  );
}
