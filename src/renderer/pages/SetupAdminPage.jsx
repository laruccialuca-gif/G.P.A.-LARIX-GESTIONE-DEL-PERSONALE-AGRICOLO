import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import larixLogo from '../../assets/larix-logo.png';

export default function SetupAdminPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submitLockedRef = useRef(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitLockedRef.current || loading) {
      return;
    }
    setError('');

    if (password !== confirmPassword) {
      setError('Le password non coincidono.');
      return;
    }

    if (password.length < 4) {
      setError('La password deve contenere almeno 4 caratteri.');
      return;
    }

    submitLockedRef.current = true;
    setLoading(true);
    try {
      await window.api.auth.createFirstAdmin({ fullName, username, password });
      await refresh();
    } catch (err) {
      const message = err?.message || 'Errore durante la creazione dell\'account.';
      if (message.includes('Amministratore già creato')) {
        setError('Esiste già un amministratore. Verrai reindirizzato alla schermata di accesso.');
        await refresh();
        window.setTimeout(() => {
          navigate('/login', { replace: true });
        }, 400);
        return;
      }
      setError(message);
      submitLockedRef.current = false;
    } finally {
      setLoading(false);
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
        className="panel"
        style={{
          width: '100%',
          maxWidth: 440,
          padding: '40px 36px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <img src={larixLogo} alt="Larix" style={{ height: 52, objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, textAlign: 'center', color: '#111827' }}>
              Primo accesso
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 4 }}>
              Crea l&apos;account amministratore per iniziare
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }} htmlFor="setup-fullname">
              Nome completo
            </label>
            <input
              id="setup-fullname"
              type="text"
              className="form-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              disabled={loading}
              style={{ width: '100%' }}
              placeholder="es. Mario Rossi"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }} htmlFor="setup-username">
              Nome utente
            </label>
            <input
              id="setup-username"
              type="text"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              disabled={loading}
              style={{ width: '100%' }}
              placeholder="es. admin"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }} htmlFor="setup-password">
              Password
            </label>
            <input
              id="setup-password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              disabled={loading}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }} htmlFor="setup-confirm-password">
              Conferma password
            </label>
            <input
              id="setup-confirm-password"
              type="password"
              className="form-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
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
            {loading ? 'Creazione in corso...' : 'Crea account amministratore'}
          </button>
        </form>
      </div>
    </div>
  );
}
