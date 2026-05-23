import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import larixLogo from '../../assets/larix-logo.png';
import { getSoftwareBrandingLabel } from '../config/branding';
import { useAuth } from '../context/AuthContext';
import { dispatchNavigationStart } from '../utils/navigationPerf';

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

function MoneyIcon() {
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
      <rect x="3.75" y="6.25" width="16.5" height="11.5" rx="2.25" />
      <path d="M7 12h.01" />
      <path d="M17 12h.01" />
      <circle cx="12" cy="12" r="2.65" />
    </svg>
  );
}

const links = [
  { path: '/', label: 'Dashboard', icon: '\u25eb' },
  { path: '/dipendenti', label: 'Dipendenti', icon: <PersonIcon /> },
  { path: '/presenze', label: 'Presenze', icon: <AttendanceIcon /> },
  { path: '/acconti-rate', label: 'Acconti e Rate', icon: <MoneyIcon /> },
  { path: '/report', label: 'Report', icon: '\u25ea' },
  { path: '/storico-operaio', label: 'Storico', icon: '\u25ce' },
  { path: '/stampa-documenti', label: 'Stampa e Documenti', icon: '\u{1F4C4}' },
  { path: '/buste-paga', label: 'Buste paga', icon: '\u25a4' },
  { path: '/comunicazione', label: 'Comunicazione', icon: '\u2709' },
  { path: '/dpi', label: 'DPI', icon: '\u{1F97E}' },
  { path: '/operai-assunti', label: 'Operai assunti', icon: '\u25a3' },
  { path: '/impostazioni', label: 'Impostazioni', icon: '\u2699' },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const [pendingPath, setPendingPath] = useState('');

  const isActive = (path) => location.pathname === path;

  useEffect(() => {
    setPendingPath('');
  }, [location.pathname]);

  function handleLinkClick(event, path) {
    if (path === location.pathname) {
      return;
    }

    if (pendingPath) {
      event.preventDefault();
      console.info('[route-lifecycle] navigation skipped while transition pending', {
        currentPath: location.pathname,
        pendingPath,
        attemptedPath: path,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    setPendingPath(path);
    dispatchNavigationStart(path);
    console.info('[route-lifecycle] navigation requested', {
      from: location.pathname,
      to: path,
      timestamp: new Date().toISOString(),
    });
  }

  const visibleLinks = [
    ...links,
    ...(currentUser?.role === 'admin' || currentUser?.role === 'super_admin'
      ? [{ path: '/utenti', label: 'Utenti', icon: <PersonIcon /> }]
      : []),
  ];

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
        {visibleLinks.map((link) => (
          <Link
            key={link.path}
            to={link.path}
            className={`sidebar-link ${isActive(link.path) ? 'sidebar-link-active' : ''}`}
            aria-disabled={!!pendingPath && !isActive(link.path)}
            onClick={(event) => handleLinkClick(event, link.path)}
            style={pendingPath && !isActive(link.path) ? { pointerEvents: 'none', opacity: 0.72 } : undefined}
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
        {currentUser ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', letterSpacing: '0.05em' }}>
              Accesso come
            </div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{currentUser.fullName}</div>
            <div style={{ fontSize: 11, color: currentUser.role === 'super_admin' ? '#818cf8' : '#9ca3af' }}>
              {currentUser.role === 'super_admin' ? 'Amm. Sistema' : currentUser.role === 'admin' ? 'Amministratore' : 'Operatore'}
            </div>
            <button
              type="button"
              className="button-secondary"
              style={{ marginTop: 4, padding: '5px 10px', minHeight: 0, fontSize: 12, width: '100%' }}
              onClick={async () => { await logout(); navigate('/login'); }}
            >
              Esci
            </button>
            <span style={{ marginTop: 6, fontSize: 11, color: '#9ca3af' }}>{getSoftwareBrandingLabel()}</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>Vista ottimizzata per desktop e tablet</span>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>{getSoftwareBrandingLabel()}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
