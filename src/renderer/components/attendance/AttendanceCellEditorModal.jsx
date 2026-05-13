import React, { useState, useEffect } from 'react';
import { parseMainInputValue } from '../../utils/attendanceTableUtils';

export default function AttendanceCellEditorModal({
  open,
  employee,
  date,
  att,
  markers,
  attendanceSettings,
  onSave,
  onClose,
}) {
  const [mainValue, setMainValue] = useState('');
  const [overtimeValue, setOvertimeValue] = useState('');
  const [markerCode, setMarkerCode] = useState(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (att) {
      setMainValue(att.entry_code || String(att.hours_worked || ''));
      setOvertimeValue(String(att.overtime_hours || ''));
      setMarkerCode(att.marker_code || null);
      setNotes(att.notes || '');
    } else {
      setMainValue('');
      setOvertimeValue('');
      setMarkerCode(null);
      setNotes('');
    }
  }, [att, open]);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      onClose();
    }
  };

  const handleSave = () => {
    console.log('[attendance-debug] save-cell-editor', {
      employee_id: employee?.id,
      date,
      mainValue,
      overtimeValue,
      markerCode,
      notes,
    });

    const parsed = parseMainInputValue(mainValue, attendanceSettings);
    let patch = {};

    if (parsed.kind === 'empty') {
      patch = {
        status: 'presente',
        entry_code: null,
        hours_worked: '',
        overtime_hours: Number(overtimeValue || 0),
        marker_code: markerCode || null,
        notes: notes || null,
      };
    } else if (parsed.kind === 'invalid') {
      alert('Valore presenza non valido');
      return;
    } else if (parsed.kind === 'type') {
      patch = {
        status: parsed.status,
        entry_code: null,
        hours_worked: 0,
        overtime_hours: 0,
        marker_code: markerCode || null,
        notes: notes || null,
      };
    } else if (parsed.kind === 'symbol') {
      patch = {
        status: 'presente',
        entry_code: parsed.symbol,
        hours_worked: parsed.hours,
        overtime_hours: Number(overtimeValue || 0),
        marker_code: markerCode || null,
        notes: notes || null,
      };
    } else if (parsed.kind === 'hours') {
      patch = {
        status: parsed.hours === 0 ? 'assente' : 'presente',
        entry_code: null,
        hours_worked: parsed.hours,
        overtime_hours: Number(overtimeValue || 0),
        marker_code: markerCode || null,
        notes: notes || null,
      };
    }

    onSave(patch);
  };

  if (!open || !employee) {
    return null;
  }

  const modalStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const dialogStyle = {
    background: 'white',
    borderRadius: 12,
    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
    width: '90%',
    maxWidth: 420,
    maxHeight: '90vh',
    overflowY: 'auto',
    padding: 24,
  };

  const headerStyle = {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 20,
    color: '#111827',
  };

  const fieldStyle = {
    marginBottom: 16,
  };

  const labelStyle = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#475569',
    marginBottom: 6,
  };

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  const selectStyle = {
    ...inputStyle,
    cursor: 'pointer',
  };

  const textareaStyle = {
    ...inputStyle,
    minHeight: 60,
    resize: 'vertical',
    fontFamily: 'inherit',
  };

  const footerStyle = {
    display: 'flex',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 24,
    paddingTop: 16,
    borderTop: '1px solid #e5e7eb',
  };

  const buttonStyle = {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 6,
    border: '1px solid #d1d5db',
    background: 'white',
    cursor: 'pointer',
    transition: 'all 150ms',
  };

  const buttonPrimaryStyle = {
    ...buttonStyle,
    background: '#2563eb',
    color: 'white',
    border: 'none',
  };

  return (
    <div style={modalStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div style={headerStyle}>
          {employee.first_name} {employee.last_name} · {date}
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Presenza</label>
          <input
            type="text"
            value={mainValue}
            onChange={(e) => setMainValue(e.target.value)}
            placeholder="es. 8, X, R, FE, ML"
            style={inputStyle}
            autoFocus
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Straordinario (ore)</label>
          <input
            type="number"
            step="0.5"
            min="0"
            value={overtimeValue}
            onChange={(e) => setOvertimeValue(e.target.value)}
            placeholder="0"
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Marker</label>
          <select value={markerCode || ''} onChange={(e) => setMarkerCode(e.target.value || null)} style={selectStyle}>
            <option value="">Nessuno</option>
            {markers && markers.map((marker) => (
              <option key={marker.code} value={marker.code}>
                {marker.label}
              </option>
            ))}
          </select>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Note</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Note opzionali..."
            style={textareaStyle}
          />
        </div>

        <div style={footerStyle}>
          <button
            type="button"
            onClick={onClose}
            style={buttonStyle}
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={buttonPrimaryStyle}
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}
