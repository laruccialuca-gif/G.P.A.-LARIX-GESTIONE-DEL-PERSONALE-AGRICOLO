import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import larixLogo from '../../assets/larix-logo.png';

function PersonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 12a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" />
      <path d="M5.5 19.25a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

function AttendanceIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 3.75v2.5" />
      <path d="M17 3.75v2.5" />
      <path d="M4.75 8.25h14.5" />
      <rect x="4.75" y="5.75" width="14.5" height="13.5" rx="2.5" />
      <path d="M12 13.9a2.15 2.15 0 1 0 0-4.3 2.15 2.15 0 0 0 0 4.3Z" />
      <path d="M9.4 17.15a3.2 3.2 0 0 1 5.2 0" />
    </svg>
  );
}

const links = [
  { path: '/', label: 'Dashboard', icon: '◫' },
  { path: '/dipendenti', label: 'Dipendenti', icon: <PersonIcon /> },
  { path: '/presenze', label: 'Presenze', icon: <AttendanceIcon /> },
  { path: '/report', label: 'Report', icon: '◪' },
  { path: '/buste-paga', label: 'Buste paga', icon: '▤' },
  { path: '/comunicazione', label: 'Comunicazione', icon: '✉' },
  { path: '/storico-operaio', label: 'Storico', icon: '◎' },
  { path: '/operai-assunti', label: 'Operai assunti', icon: '▣' },
  { path: '/impostazioni', label: 'Impostazioni', icon: '⚙' },
];

export default function Sidebar() {
  const location = useLocation();

  const isActive = (path) => location.pathname === path;

  return (
    <aside className="sidebar-panel">
      <div className="sidebar-brand">
        <div className="header-left sidebar-logo-wrap">
          <img src={larixLogo} alt="Larix" className="app-logo" />
        </div>
        <p className="sidebar-subtitle">
          Gestione del personale agricolo, semplice e sotto controllo
        </p>
      </div>

      <nav className="sidebar-nav">
        {links.map((link) => (
          <Link
            key={link.path}
            to={link.path}
            className={`sidebar-link ${isActive(link.path) ? 'sidebar-link-active' : ''}`}
          >
            <span className="sidebar-link-label">
              <span className="sidebar-link-icon">{link.icon}</span>
              {link.label}
            </span>
            <span>{'›'}</span>
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        Vista ottimizzata per desktop e tablet, con focus su leggibilita e azioni rapide.
      </div>
    </aside>
  );
}
