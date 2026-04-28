import React from 'react';

export default function FilterPills({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={active ? 'button' : 'button-secondary'}
            onClick={() => onChange(option.value)}
            style={active ? { minHeight: 38, padding: '0 14px' } : { minHeight: 38, padding: '0 14px' }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
