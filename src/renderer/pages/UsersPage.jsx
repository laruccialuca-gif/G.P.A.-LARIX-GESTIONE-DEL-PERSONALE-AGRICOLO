import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

function formatDate(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('it-IT');
  } catch {
    return ts;
  }
}

function InlineMessage({ message, type = 'error' }) {
  if (!message) return null;
  const isError = type === 'error';
  return (
    <div
      style={{
        padding: '8px 12px',
        background: isError ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
        border: `1px solid ${isError ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
        borderRadius: 6,
        color: isError ? '#dc2626' : '#166534',
        fontSize: 13,
        marginBottom: 8,
      }}
    >
      {message}
    </div>
  );
}

function CreateUserForm({ onCreated }) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('operatore');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      await window.api.users.create({ fullName, username, password, role });
      setFullName('');
      setUsername('');
      setPassword('');
      setRole('operatore');
      setSuccess('Utente creato con successo.');
      onCreated();
    } catch (err) {
      setError(err?.message || 'Errore durante la creazione dell\'utente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <InlineMessage message={error} type="error" />
      <InlineMessage message={success} type="success" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Nome completo</label>
          <input
            type="text"
            className="form-input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Nome utente</label>
          <input
            type="text"
            className="form-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Password</label>
          <input
            type="password"
            className="form-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Ruolo</label>
          <select
            className="form-input"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={loading}
          >
            <option value="operatore">Operatore</option>
            <option value="admin">Amministratore</option>
          </select>
        </div>
      </div>
      <div>
        <button type="submit" className="button" disabled={loading} style={{ minWidth: 160 }}>
          {loading ? 'Creazione...' : 'Crea utente'}
        </button>
      </div>
    </form>
  );
}

function ResetPasswordForm({ user, onDone }) {
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await window.api.users.resetPassword(user.id, newPassword);
      setNewPassword('');
      onDone();
    } catch (err) {
      setError(err?.message || 'Errore durante il reset della password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {error ? <span style={{ color: '#dc2626', fontSize: 12 }}>{error}</span> : null}
      <input
        type="password"
        className="form-input"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder="Nuova password"
        required
        disabled={loading}
        style={{ minWidth: 160, flex: 1 }}
      />
      <button type="submit" className="button" disabled={loading} style={{ padding: '5px 12px', minHeight: 0, fontSize: 12 }}>
        {loading ? '...' : 'Salva'}
      </button>
      <button
        type="button"
        className="button-secondary"
        onClick={onDone}
        style={{ padding: '5px 12px', minHeight: 0, fontSize: 12 }}
      >
        Annulla
      </button>
    </form>
  );
}

function UserRow({ user, currentUser, onRefresh }) {
  const [showResetPwd, setShowResetPwd] = useState(false);
  const [roleValue, setRoleValue] = useState(user.role);
  const [actionError, setActionError] = useState('');

  const isSelf = currentUser?.userId === user.id;
  const canResetPassword = currentUser?.role === 'super_admin';

  async function handleToggleActive() {
    setActionError('');
    try {
      if (user.is_active) {
        await window.api.users.disable(user.id);
      } else {
        await window.api.users.enable(user.id);
      }
      onRefresh();
    } catch (err) {
      setActionError(err?.message || 'Errore.');
    }
  }

  async function handleRoleChange(newRole) {
    setRoleValue(newRole);
    setActionError('');
    try {
      await window.api.users.update(user.id, { fullName: user.full_name, role: newRole });
      onRefresh();
    } catch (err) {
      setActionError(err?.message || 'Errore aggiornamento ruolo.');
    }
  }

  return (
    <>
      <tr>
        <td style={{ padding: '10px 12px', fontWeight: 500 }}>{user.full_name}</td>
        <td style={{ padding: '10px 12px', color: '#6b7280' }}>{user.username}</td>
        <td style={{ padding: '10px 12px' }}>
          <select
            className="form-input"
            value={roleValue}
            onChange={(e) => handleRoleChange(e.target.value)}
            style={{ padding: '3px 8px', minHeight: 0, fontSize: 12 }}
          >
            <option value="operatore">Operatore</option>
            <option value="admin">Amministratore</option>
          </select>
        </td>
        <td style={{ padding: '10px 12px' }}>
          <span
            className="soft-chip"
            style={{
              background: user.is_active ? 'rgba(22,101,52,0.1)' : 'rgba(239,68,68,0.1)',
              color: user.is_active ? '#166534' : '#dc2626',
            }}
          >
            {user.is_active ? 'Attivo' : 'Disattivato'}
          </span>
        </td>
        <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>{formatDate(user.last_login_at)}</td>
        <td style={{ padding: '10px 12px' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {!isSelf ? (
              <button
                type="button"
                className="button-secondary"
                style={{ padding: '4px 10px', minHeight: 0, fontSize: 12 }}
                onClick={handleToggleActive}
              >
                {user.is_active ? 'Disattiva' : 'Attiva'}
              </button>
            ) : null}
            {canResetPassword ? (
              <button
                type="button"
                className="button-secondary"
                style={{ padding: '4px 10px', minHeight: 0, fontSize: 12 }}
                onClick={() => setShowResetPwd((v) => !v)}
              >
                Reset password
              </button>
            ) : null}
          </div>
          {actionError ? <div style={{ color: '#dc2626', fontSize: 11, marginTop: 4 }}>{actionError}</div> : null}
        </td>
      </tr>
      {showResetPwd && canResetPassword ? (
        <tr>
          <td colSpan={6} style={{ padding: '6px 12px 12px 12px', background: '#f9fafb' }}>
            <ResetPasswordForm user={user} onDone={() => { setShowResetPwd(false); onRefresh(); }} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function UsersPage() {
  const { currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadError, setLoadError] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      const data = await window.api.users.list();
      setUsers(data || []);
    } catch (err) {
      setLoadError(err?.message || 'Errore caricamento utenti.');
    }
  }, []);

  const loadAuditLogs = useCallback(async () => {
    try {
      const data = await window.api.users.getAuditLogs({ limit: 50 });
      setAuditLogs(data || []);
    } catch {
      // silently fail for audit logs
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadAuditLogs();
  }, [loadUsers, loadAuditLogs]);

  function handleRefresh() {
    loadUsers();
    loadAuditLogs();
  }

  if (currentUser?.role !== 'admin' && currentUser?.role !== 'super_admin') {
    return (
      <div className="panel" style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 16, color: '#dc2626', fontWeight: 600 }}>Accesso negato</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>
          Questa sezione è riservata agli amministratori.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <div className="page-kicker">Amministrazione</div>
        <h1 className="page-title">Utenti e Permessi</h1>
      </div>

      {loadError ? <InlineMessage message={loadError} type="error" /> : null}

      <div className="panel" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: '#111827' }}>Lista utenti</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Nome</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Username</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Ruolo</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Stato</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Ultimo accesso</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  currentUser={currentUser}
                  onRefresh={handleRefresh}
                />
              ))}
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>
                    Nessun utente trovato.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: '#111827' }}>Crea nuovo utente</h2>
        <CreateUserForm onCreated={handleRefresh} />
      </div>

      <div className="panel" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: '#111827' }}>
          Registro attività (ultimi 50)
        </h2>
        <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Data e ora</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Utente</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Azione</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Entità</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Dettagli</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 10px', color: '#6b7280', whiteSpace: 'nowrap' }}>{formatDate(log.created_at)}</td>
                  <td style={{ padding: '6px 10px' }}>{log.username_snapshot || '—'}</td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11 }}>{log.action}</td>
                  <td style={{ padding: '6px 10px', color: '#6b7280' }}>
                    {log.entity_type ? `${log.entity_type}${log.entity_id ? ` #${log.entity_id}` : ''}` : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', color: '#9ca3af', fontSize: 11 }}>
                    {log.details_json || ''}
                  </td>
                </tr>
              ))}
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#9ca3af' }}>
                    Nessuna attività registrata.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
