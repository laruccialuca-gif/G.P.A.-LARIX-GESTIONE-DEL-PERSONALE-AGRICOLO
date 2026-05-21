const { getDb } = require('./db');

function normalizeMonth(value) {
  return String(value || '').slice(0, 7);
}

function normalizeDate(value) {
  return String(value || '').slice(0, 10);
}

function normalizeAmount(value) {
  const normalized = String(value ?? '')
    .replace(',', '.')
    .trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePayload(payload = {}) {
  const teamId = Number(payload.team_id || payload.teamId || 0);
  const month = normalizeMonth(payload.month);
  const advanceDate = normalizeDate(payload.advance_date || payload.advanceDate);
  const amount = normalizeAmount(payload.amount);
  const notes = String(payload.notes || '').trim();

  if (!teamId) {
    throw new Error('Squadra obbligatoria');
  }
  if (!month) {
    throw new Error('Mese obbligatorio');
  }
  if (!advanceDate) {
    throw new Error('Data acconto obbligatoria');
  }
  if (!(amount > 0)) {
    throw new Error('Importo acconto non valido');
  }

  return {
    team_id: teamId,
    month,
    advance_date: advanceDate,
    amount,
    notes: notes || null,
  };
}

function mapTeamAdvance(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    team_id: Number(row.team_id),
    month: row.month,
    advance_date: row.advance_date,
    amount: Number(row.amount || 0),
    notes: row.notes || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function getTeamAdvanceById(id) {
  const db = getDb();
  const row = db.prepare(`
    SELECT *
    FROM team_advances
    WHERE id = ?
    LIMIT 1
  `).get(Number(id));
  return mapTeamAdvance(row);
}

function listTeamAdvances(teamId, month) {
  const db = getDb();
  return db.prepare(`
    SELECT *
    FROM team_advances
    WHERE team_id = ?
      AND month = ?
    ORDER BY advance_date ASC, id ASC
  `).all(Number(teamId), normalizeMonth(month)).map(mapTeamAdvance);
}

function createTeamAdvance(payload) {
  const db = getDb();
  const data = normalizePayload(payload);
  const result = db.prepare(`
    INSERT INTO team_advances (
      team_id, month, advance_date, amount, notes
    ) VALUES (
      @team_id, @month, @advance_date, @amount, @notes
    )
  `).run(data);
  return getTeamAdvanceById(Number(result.lastInsertRowid));
}

function updateTeamAdvance(id, payload) {
  const db = getDb();
  const advanceId = Number(id);
  const existing = getTeamAdvanceById(advanceId);
  if (!existing) {
    throw new Error('Acconto squadra non trovato');
  }

  const data = normalizePayload({
    ...existing,
    ...payload,
    team_id: payload.team_id || payload.teamId || existing.team_id,
    month: payload.month || existing.month,
    advance_date: payload.advance_date || payload.advanceDate || existing.advance_date,
  });

  db.prepare(`
    UPDATE team_advances
    SET team_id = @team_id,
        month = @month,
        advance_date = @advance_date,
        amount = @amount,
        notes = @notes,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id: advanceId,
    ...data,
  });

  return getTeamAdvanceById(advanceId);
}

function deleteTeamAdvance(id) {
  const db = getDb();
  db.prepare(`
    DELETE FROM team_advances
    WHERE id = ?
  `).run(Number(id));
  return { success: true };
}

function getTeamAdvanceTotal(teamId, month) {
  const db = getDb();
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM team_advances
    WHERE team_id = ?
      AND month = ?
  `).get(Number(teamId), normalizeMonth(month));
  return Number(row?.total || 0);
}

module.exports = {
  listTeamAdvances,
  createTeamAdvance,
  updateTeamAdvance,
  deleteTeamAdvance,
  getTeamAdvanceTotal,
};
