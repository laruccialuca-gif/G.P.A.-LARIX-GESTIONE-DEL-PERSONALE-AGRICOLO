import React from 'react';

export default function LarixLauncher({ isOpen, onToggle }) {
  return (
    <button
      type="button"
      className={`larix-launcher no-print ${isOpen ? 'larix-launcher--open' : ''}`}
      onClick={onToggle}
      aria-label={isOpen ? 'Chiudi Larix' : 'Apri Larix'}
      title={isOpen ? 'Chiudi Larix' : 'Apri Larix'}
    >
      <span className="larix-launcher__icon">L</span>
      <span className="larix-launcher__label">Larix</span>
    </button>
  );
}
