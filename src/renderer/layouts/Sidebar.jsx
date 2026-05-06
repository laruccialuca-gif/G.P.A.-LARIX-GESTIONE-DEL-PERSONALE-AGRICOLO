import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import larixLogo from '../../assets/larix-logo.png';
import { useAuth } from '../context/AuthContext';

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
  { path: '/', label: 'Dashboard', icon: 'DB' },
  { path: '/dipendenti', label: 'Dipendenti', icon: <PersonIcon /> },
  { path: '/presenze', label: 'Presenze', icon: <AttendanceIcon /> },
  { path: '/report', label: 'Report', icon: 'RP' },
  { path: '/acconti-rate', label: 'Acconti e Rate', icon: 'EUR' },
  { path: '/buste-paga', label: 'Buste paga', icon: 'BP' },
  { path: '/comunicazione', label: 'Comunicazione', icon: '@' },
  { path: '/storico-operaio', label: 'Storico', icon: 'ST' },
  { path: '/operai-assunti', label: 'Operai assunti', icon: 'OA' },
  { path: '/impostazioni', label: 'Impostazioni', icon: 'IM' },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();

  const isActive = (path) => location.pathname === path;

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
          >
            <span className="sidebar-link-label">
              <span className="sidebar-link-icon">{link.icon}</span>
              {link.label}
            </span>
            <span>{'>'}</span>
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
          </div>
        ) : (
          <span>Vista ottimizzata per desktop e tablet</span>
        )}
      </div>
    </aside>
  );
}
