import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import larixLogo from '../../assets/larix-logo.png';

export default function LoginPage() {
  const { login, loginSuperAdmin, refresh } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginHints, setLoginHints] = useState({
    last_username: '',
    last_user_full_name: '',
    active_users: [],
    super_admin_enabled: false,
  });

  // Hidden SA panel — revealed after 5 clicks on the logo within 3 seconds
  const [showSAPanel, setShowSAPanel] = useState(false);
  const [saPassword, setSAPassword] = useState('');
  const [saError, setSAError] = useState('');
  const [saLoading, setSALoading] = useState(false);
  const logoClickTimestamps = useRef([]);

  React.useEffect(() => {
    let mounted = true;
    window.api.auth.getLoginHints()
      .then((hints) => {
        if (!mounted) return;
        const normalized = hints || {};
        setLoginHints(normalized);
        if (normalized.last_username) {
          setUsername(normalized.last_username);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  function handleLogoClick() {
    const now = Date.now();
    logoClickTimestamps.current = [...logoClickTimestamps.current, now].filter(
      (ts) => now - ts < 3000
    );
    if (logoClickTimestamps.current.length >= 5) {
      logoClickTimestamps.current = [];
      setShowSAPanel((prev) => !prev);
      setSAPassword('');
      setSAError('');
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({ username, password });
      await refresh();
    } catch (err) {
      setError(err?.message || 'Accesso non riuscito. Riprova.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSASubmit(event) {
    event.preventDefault();
    setSAError('');
    setSALoading(true);
    try {
      await loginSuperAdmin(saPassword);
      await refresh();
    } catch (err) {
      setSAError(err?.message || 'Accesso assistenza non riuscito.');
    } finally {
      setSALoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f3f4f6',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: '100%',
          maxWidth: 400,
        }}
      >
        {/* Main login card */}
        <div
          className="panel"
          style={{
            padding: '40px 36px',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <img
              src={larixLogo}
              alt="Larix"
              style={{ height: 52, objectFit: 'contain', cursor: 'default', userSelect: 'none' }}
              onClick={handleLogoClick}
              draggable={false}
            />
            <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
              Gestione del personale agricolo
            </div>
            {loginHints.last_username ? (
              <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
                Ultimo accesso: <strong>{loginHints.last_user_full_name || loginHints.last_username}</strong>
              </div>
            ) : null}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {loginHints.active_users?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }} htmlFor="login-user-select">
                  Seleziona utente
                </label>
                <select
                  id="login-user-select"
                  className="form-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  style={{ width: '100%' }}
                >
                  <option value="">Seleziona utente</option>
                  {loginHints.active_users.map((user) => (
                    <option key={user.id} value={user.username}>
                      {user.full_name} · {user.username}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }} htmlFor="login-username">
                Nome utente
              </label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                disabled={loading}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }} htmlFor="login-password">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
                style={{ width: '100%' }}
              />
            </div>

            {error ? (
              <div
                style={{
                  padding: '10px 14px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 8,
                  color: '#dc2626',
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              className="button"
              disabled={loading}
              style={{ width: '100%', marginTop: 4 }}
            >
              {loading ? 'Accesso in corso...' : 'Accedi'}
            </button>
          </form>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: -4 }}>
            <button
              type="button"
              onClick={() => {
                setShowSAPanel((prev) => !prev);
                setSAPassword('');
                setSAError('');
              }}
              style={{
                border: 0,
                background: 'transparent',
                color: '#6b7280',
                fontSize: 12,
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Assistenza
            </button>
          </div>
        </div>

        {/* Hidden super-admin panel */}
        {showSAPanel ? (
          <div
            className="panel"
            style={{
              padding: '20px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              borderColor: 'rgba(99, 102, 241, 0.35)',
              background: 'rgba(238, 242, 255, 0.95)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#6366f1',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Accesso assistenza sviluppatore
              </span>
            </div>

            <form onSubmit={handleSASubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!loginHints.super_admin_enabled ? (
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: 7,
                    color: '#92400e',
                    fontSize: 12,
                  }}
                >
                  Accesso assistenza non configurato su questo sistema
                </div>
              ) : null}
              <input
                type="password"
                value={saPassword}
                onChange={(e) => setSAPassword(e.target.value)}
                placeholder="Codice assistenza"
                autoComplete="off"
                required
                disabled={saLoading || !loginHints.super_admin_enabled}
                style={{ width: '100%' }}
              />

              {saError ? (
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: 7,
                    color: '#dc2626',
                    fontSize: 12,
                  }}
                >
                  {saError}
                </div>
              ) : null}

              <button
                type="submit"
                className="button"
                disabled={saLoading || !loginHints.super_admin_enabled}
                style={{ width: '100%', background: '#6366f1' }}
              >
                {saLoading ? 'Verifica in corso...' : 'Accedi come supporto'}
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
