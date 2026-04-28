const { getDb } = require('./db');

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function listOccupations() {
  const db = getDb();
  return db.prepare(`
    SELECT id, name, created_at, updated_at
    FROM occupations
    ORDER BY name COLLATE NOCASE ASC
  `).all();
}

function ensureOccupation(name) {
  const db = getDb();
  const normalized = normalizeName(name);

  if (!normalized) {
    return null;
  }

  db.prepare(`
    INSERT INTO occupations (name)
    VALUES (?)
    ON CONFLICT(name) DO UPDATE SET
      updated_at = CURRENT_TIMESTAMP
  `).run(normalized);

  return db.prepare(`
    SELECT id, name, created_at, updated_at
    FROM occupations
    WHERE name = ?
    LIMIT 1
  `).get(normalized);
}

module.exports = {
  ensureOccupation,
  listOccupations,
};
