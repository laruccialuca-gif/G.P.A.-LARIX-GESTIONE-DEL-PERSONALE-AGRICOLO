const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb, isReadOnlyMode } = require('./db');
const { getConfigDir } = require('./storagePaths');

// Super-admin is NOT stored in the database.
// Hash is read from the GESTIONALE_SA_SECRET env var at runtime.
// Format: scryptSync(password, SA_SALT, 64).toString('hex')
// Generate: node -e "const c=require('crypto');console.log(c.scryptSync('YOUR_PASS','larix-sa-v1',64).toString('hex'))"
const SA_SALT = 'larix-sa-v1';
const SA_USERNAME = '_larix_support_';
const SA_FULL_NAME = 'Amministratore Sistema';
// Reserved prefixes that cannot be used as regular usernames
const RESERVED_USERNAME_PREFIXES = ['_larix_', '__'];

let currentSession = null;
const AUTH_STATE_FILE = 'auth-state.json';

function getAuthStateFilePath() {
  return path.join(getConfigDir(), AUTH_STATE_FILE);
}

function readAuthState() {
  try {
    const filePath = getAuthStateFilePath();
    if (!fs.existsSync(filePath)) {
      return { last_username: '' };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { last_username: String(raw?.last_username || '').trim() };
  } catch {
    return { last_username: '' };
  }
}

function writeAuthState(nextState = {}) {
  const filePath = getAuthStateFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    last_username: String(nextState?.last_username || '').trim(),
  }, null, 2), 'utf8');
}

function validatePasswordStrength(password) {
  if (String(password || '').length < 4) {
    throw new Error('La password deve contenere almeno 4 caratteri.');
  }
}

// ---------------------------------------------------------------------------
// Password helpers (regular users)
// ---------------------------------------------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':');
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hash, 'hex');
  return crypto.timingSafeEqual(derived, storedBuf);
}

// ---------------------------------------------------------------------------
// Super-admin helpers
// ---------------------------------------------------------------------------

function getSAHash() {
  const h = process.env.GESTIONALE_SA_SECRET || '';
  return h.trim();
}

function isSAEnabled() {
  const h = getSAHash();
  return h.length === 128 && /^[0-9a-f]+$/.test(h);
}

function verifySuperAdminPassword(password) {
  if (!isSAEnabled()) return false;
  try {
    const derived = crypto.scryptSync(password, SA_SALT, 64);
    const stored = Buffer.from(getSAHash(), 'hex');
    if (derived.length !== stored.length) return false;
    return crypto.timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}

function isSuperAdmin() {
  return currentSession?.role === 'super_admin';
}

// ---------------------------------------------------------------------------
// Regular-user session
// ---------------------------------------------------------------------------

function getUserCount() {
  return getDb().prepare('SELECT COUNT(*) AS count FROM users WHERE is_active = 1').get()?.count || 0;
}

function listActiveUsersForLogin() {
  return getDb().prepare(
    `SELECT id, full_name, username, role
     FROM users
     WHERE is_active = 1 AND role != 'super_admin'
     ORDER BY LOWER(full_name) ASC, LOWER(username) ASC`
  ).all();
}

function getLoginHints() {
  const authState = readAuthState();
  const activeUsers = listActiveUsersForLogin();
  const lastUser = activeUsers.find((user) => user.username === authState.last_username) || null;
  return {
    last_username: authState.last_username || '',
    last_user_full_name: lastUser?.full_name || '',
    active_users: activeUsers,
    super_admin_enabled: isSAEnabled(),
  };
}

function login(username, password) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);

  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new Error('Credenziali non valide. Verifica username e password.');
  }

  if (!isReadOnlyMode()) {
    db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    writeAuthState({ last_username: user.username });
  }

  currentSession = {
    userId: user.id,
    username: user.username,
    role: user.role,
    fullName: user.full_name,
  };

  if (!isReadOnlyMode()) {
    try { audit('auth:login', 'user', user.id, { username: user.username }); } catch {}
  }

  return { ...currentSession };
}

// ---------------------------------------------------------------------------
// Super-admin session
// ---------------------------------------------------------------------------

function loginSuperAdmin(password) {
  const { isDemoVariant } = require('./runtimeContext');

  if (isDemoVariant()) {
    throw new Error('Accesso assistenza non disponibile in modalità demo.');
  }

  if (!isSAEnabled()) {
    throw new Error('Accesso assistenza non configurato su questo sistema.');
  }

  if (!verifySuperAdminPassword(password)) {
    throw new Error('Credenziali assistenza non valide.');
  }

  currentSession = {
    userId: null,
    username: SA_USERNAME,
    role: 'super_admin',
    fullName: SA_FULL_NAME,
  };

  if (!isReadOnlyMode()) {
    try { audit('auth:login_super_admin', 'session', null, { mode: 'super_admin' }); } catch {}
  }

  return { ...currentSession };
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

function logout() {
  if (currentSession) {
    if (!isReadOnlyMode()) {
      try { audit('auth:logout', 'user', currentSession.userId, { username: currentSession.username }); } catch {}
    }
  }
  currentSession = null;
}

function getCurrentUser() {
  return currentSession ? { ...currentSession } : null;
}

// ---------------------------------------------------------------------------
// Auth guards
// ---------------------------------------------------------------------------

function requireAuth() {
  if (!currentSession) {
    const error = new Error('Autenticazione richiesta.');
    error.code = 'AUTH_REQUIRED';
    throw error;
  }
}

// Accepts both admin and super_admin
function requireAdmin() {
  requireAuth();
  if (currentSession.role !== 'admin' && currentSession.role !== 'super_admin') {
    const error = new Error('Accesso riservato agli amministratori.');
    error.code = 'AUTH_FORBIDDEN';
    throw error;
  }
}

function requireSuperAdmin() {
  requireAuth();
  if (currentSession.role !== 'super_admin') {
    const error = new Error('Accesso riservato all\'assistenza di sistema.');
    error.code = 'AUTH_FORBIDDEN';
    throw error;
  }
}

// ---------------------------------------------------------------------------
// User CRUD
// ---------------------------------------------------------------------------

function isReservedUsername(username) {
  return RESERVED_USERNAME_PREFIXES.some((prefix) => username.startsWith(prefix));
}

function listUsers() {
  return getDb().prepare(
    `SELECT id, full_name, username, role, is_active, created_by_user_id, created_at, updated_at, last_login_at
     FROM users
     WHERE role != 'super_admin'
     ORDER BY id ASC`
  ).all();
}

function createUser({ fullName, username, password, role }) {
  validatePasswordStrength(password);
  if (isReservedUsername(username)) {
    throw new Error(`Il nome utente "${username}" è riservato al sistema.`);
  }
  if (role === 'super_admin') {
    throw new Error('Il ruolo super_admin non può essere assegnato tramite questa interfaccia.');
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) throw new Error(`Il nome utente "${username}" è già in uso.`);

  const passwordHash = hashPassword(password);
  const result = db.prepare(`
    INSERT INTO users (full_name, username, password_hash, role, created_by_user_id)
    VALUES (@fullName, @username, @passwordHash, @role, @createdByUserId)
  `).run({
    fullName,
    username,
    passwordHash,
    role: role || 'operatore',
    createdByUserId: currentSession?.userId || null,
  });

  return db.prepare(
    'SELECT id, full_name, username, role, is_active, created_by_user_id, created_at, updated_at, last_login_at FROM users WHERE id = ?'
  ).get(result.lastInsertRowid);
}

function updateUser(id, { fullName, role }) {
  if (role === 'super_admin') {
    throw new Error('Il ruolo super_admin non può essere assegnato tramite questa interfaccia.');
  }
  const db = getDb();
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
  if (target?.role === 'super_admin') {
    throw new Error('Impossibile modificare l\'account amministratore di sistema.');
  }
  db.prepare(
    'UPDATE users SET full_name = @fullName, role = @role, updated_at = CURRENT_TIMESTAMP WHERE id = @id'
  ).run({ fullName, role, id });
}

function disableUser(id) {
  if (currentSession && currentSession.userId === id) {
    throw new Error('Non puoi disattivare il tuo account.');
  }
  const db = getDb();
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
  if (target?.role === 'super_admin') {
    throw new Error('Impossibile disattivare l\'account amministratore di sistema.');
  }
  db.prepare('UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

function enableUser(id) {
  const db = getDb();
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
  if (target?.role === 'super_admin') {
    throw new Error('Impossibile modificare l\'account amministratore di sistema.');
  }
  db.prepare('UPDATE users SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

function changePassword(id, newPassword) {
  validatePasswordStrength(newPassword);
  const db = getDb();
  const target = db.prepare('SELECT id, role, created_by_user_id FROM users WHERE id = ?').get(id);
  if (!target) {
    throw new Error('Utente non trovato.');
  }
  if (target?.role === 'super_admin') {
    throw new Error('Impossibile modificare l\'account amministratore di sistema.');
  }
  const passwordHash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, id);
}

function changeOwnPassword(newPassword) {
  requireAuth();
  if (!currentSession?.userId) {
    throw new Error('Operazione non disponibile per questo account.');
  }
  changePassword(currentSession.userId, newPassword);
}

function changeManagedUserPassword(id, newPassword) {
  requireAdmin();
  const db = getDb();
  const target = db.prepare('SELECT id, role, created_by_user_id FROM users WHERE id = ?').get(id);
  if (!target) {
    throw new Error('Utente non trovato.');
  }
  if (target.role === 'super_admin') {
    throw new Error('Impossibile modificare l\'account amministratore di sistema.');
  }
  if (currentSession.role === 'super_admin') {
    changePassword(id, newPassword);
    return;
  }
  const isLegacyUserWithoutCreator = target.created_by_user_id == null;
  if (!isLegacyUserWithoutCreator && Number(target.created_by_user_id || 0) !== Number(currentSession.userId || 0) && Number(target.id) !== Number(currentSession.userId || 0)) {
    throw new Error('Puoi modificare solo la password degli utenti creati da te.');
  }
  changePassword(id, newPassword);
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

function audit(action, entityType, entityId, details) {
  const db = getDb();
  db.prepare(`
    INSERT INTO audit_logs (user_id, username_snapshot, action, entity_type, entity_id, details_json)
    VALUES (@userId, @usernameSnapshot, @action, @entityType, @entityId, @detailsJson)
  `).run({
    userId: currentSession?.userId || null,
    usernameSnapshot: currentSession?.username || null,
    action,
    entityType: entityType || null,
    entityId: entityId != null ? String(entityId) : null,
    detailsJson: details != null ? JSON.stringify(details) : null,
  });
}

function getAuditLogs({ limit = 50, offset = 0 } = {}) {
  return getDb().prepare(`
    SELECT id, user_id, username_snapshot, action, entity_type, entity_id, details_json, created_at
    FROM audit_logs
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

module.exports = {
  getUserCount,
  login,
  loginSuperAdmin,
  logout,
  getCurrentUser,
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  isSuperAdmin,
  isSAEnabled,
  getLoginHints,
  listUsers,
  listActiveUsersForLogin,
  createUser,
  updateUser,
  disableUser,
  enableUser,
  changePassword,
  changeOwnPassword,
  changeManagedUserPassword,
  audit,
  getAuditLogs,
};
