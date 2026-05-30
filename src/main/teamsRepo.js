const { getDb } = require('./db');

function normalizeAttendanceMode(value) {
  return value === 'headcount' ? 'headcount' : 'details';
}

function normalizeTeamDailyRate(value) {
  const normalized = String(value ?? '')
    .replace(',', '.')
    .trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeMemberInput(member, index) {
  return {
    employee_id: Number(member.employee_id),
    compensation:
      member.compensation === '' || member.compensation === null || member.compensation === undefined
        ? null
        : Number(member.compensation),
    manage_by_days: member.manage_by_days ? 1 : 0,
    sort_order: index,
    notes: member.notes || null,
  };
}

function mapMemberRow(row) {
  return {
    id: row.member_id,
    employee_id: row.employee_id,
    compensation: row.compensation !== null && row.compensation !== undefined ? Number(row.compensation) : null,
    manage_by_days: !!row.manage_by_days,
    sort_order: Number(row.sort_order || 0),
    notes: row.member_notes || null,
    employee: {
      id: row.employee_id,
      first_name: row.first_name,
      last_name: row.last_name,
      role: row.role,
      status: row.status,
      is_deleted: !!row.is_deleted,
      daily_pay: row.daily_pay !== null && row.daily_pay !== undefined ? Number(row.daily_pay) : null,
      standard_hours: Number(row.standard_hours || 7) || 7,
      hire_date: row.hire_date || null,
      hire_date_from: row.hire_date_from || null,
      hire_date_to: row.hire_date_to || null,
      early_termination_date: row.early_termination_date || null,
      medical_visit_expiry: row.medical_visit_expiry || null,
      art37_expiry: row.art37_expiry || null,
      employment_periods: [],
    },
  };
}

function loadEmploymentPeriodsByEmployeeId(employeeIds = []) {
  const db = getDb();
  const normalizedIds = [...new Set(
    employeeIds
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  )];
  if (!normalizedIds.length) {
    return new Map();
  }

  const placeholders = normalizedIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT
      id,
      employee_id,
      hire_date_from,
      hire_date_to,
      hired_by,
      status,
      is_current
    FROM employee_employment_periods
    WHERE employee_id IN (${placeholders})
    ORDER BY employee_id ASC, is_current DESC, COALESCE(hire_date_from, created_at) DESC, id DESC
  `).all(...normalizedIds);

  const periodsByEmployeeId = new Map();
  for (const row of rows) {
    const list = periodsByEmployeeId.get(row.employee_id) || [];
    list.push({
      id: row.id,
      employee_id: row.employee_id,
      hire_date_from: row.hire_date_from || null,
      hire_date_to: row.hire_date_to || null,
      hired_by: row.hired_by || null,
      status: row.status || 'attivo',
      is_current: !!row.is_current,
    });
    periodsByEmployeeId.set(row.employee_id, list);
  }

  return periodsByEmployeeId;
}

function attachTeamMembers(teamRows) {
  const db = getDb();
  if (!teamRows.length) return [];

  const placeholders = teamRows.map(() => '?').join(', ');
  const memberRows = db.prepare(`
    SELECT
      tm.id AS member_id,
      tm.team_id,
      tm.employee_id,
      tm.compensation,
      tm.manage_by_days,
      tm.sort_order,
      tm.notes AS member_notes,
      e.first_name,
      e.last_name,
      e.role,
      e.status,
      e.is_deleted,
      e.daily_pay,
      e.standard_hours,
      e.hire_date,
      e.hire_date_from,
      e.hire_date_to,
      e.early_termination_date,
      e.medical_visit_expiry,
      e.art37_expiry
    FROM team_members tm
    JOIN employees e ON e.id = tm.employee_id
    WHERE tm.team_id IN (${placeholders})
    ORDER BY tm.team_id ASC, tm.sort_order ASC, e.last_name COLLATE NOCASE, e.first_name COLLATE NOCASE
  `).all(...teamRows.map((team) => team.id));

  const periodsByEmployeeId = loadEmploymentPeriodsByEmployeeId(memberRows.map((row) => row.employee_id));

  const membersByTeam = new Map();
  for (const row of memberRows) {
    const list = membersByTeam.get(row.team_id) || [];
    const mappedRow = mapMemberRow(row);
    mappedRow.employee.employment_periods = periodsByEmployeeId.get(row.employee_id) || [];
    list.push(mappedRow);
    membersByTeam.set(row.team_id, list);
  }

  return teamRows.map((team) => ({
    ...team,
    attendance_mode: normalizeAttendanceMode(team.attendance_mode),
    team_daily_rate: normalizeTeamDailyRate(team.team_daily_rate),
    is_archived: !!team.is_archived,
    members: membersByTeam.get(team.id) || [],
  })).map((team) => {
    console.info('[team-rate-debug] loaded team_daily_rate =', {
      teamId: team.id,
      name: team.name,
      team_daily_rate: team.team_daily_rate,
    });
    return team;
  });
}

function listTeams(options = {}) {
  const db = getDb();
  const includeArchived = !!options.includeArchived;
  const whereClause = includeArchived ? '' : 'WHERE COALESCE(is_archived, 0) = 0';

  const teamRows = db.prepare(`
    SELECT *
    FROM teams
    ${whereClause}
    ORDER BY is_archived ASC, name COLLATE NOCASE ASC
  `).all();

  return attachTeamMembers(teamRows);
}

function getTeamById(id, options = {}) {
  const db = getDb();
  const includeArchived = !!options.includeArchived;
  const teamRow = db.prepare(`
    SELECT *
    FROM teams
    WHERE id = ?
      ${includeArchived ? '' : 'AND is_archived = 0'}
    LIMIT 1
  `).get(Number(id));

  return attachTeamMembers(teamRow ? [teamRow] : [])[0] || null;
}

function createTeam(payload) {
  const db = getDb();
  const members = Array.isArray(payload.members) ? payload.members : [];

  const tx = db.transaction(() => {
    const normalizedRate = normalizeTeamDailyRate(payload.team_daily_rate);
    console.info('[team-rate-debug] repo save team_daily_rate =', {
      mode: 'create',
      name: payload.name?.trim() || '',
      team_daily_rate: normalizedRate,
    });
    const result = db.prepare(`
      INSERT INTO teams (name, notes, attendance_mode, team_daily_rate, is_archived, archived_at)
      VALUES (?, ?, ?, ?, 0, NULL)
    `).run(
      payload.name?.trim() || '',
      payload.notes || null,
      normalizeAttendanceMode(payload.attendance_mode),
      normalizedRate
    );

    const teamId = result.lastInsertRowid;
    const insertMember = db.prepare(`
      INSERT INTO team_members (
        team_id, employee_id, compensation, manage_by_days, sort_order, notes
      ) VALUES (
        @team_id, @employee_id, @compensation, @manage_by_days, @sort_order, @notes
      )
    `);

    members
      .map(normalizeMemberInput)
      .filter((member) => member.employee_id > 0)
      .forEach((member) => {
        insertMember.run({
          team_id: teamId,
          ...member,
        });
      });

    return teamId;
  });

  const teamId = tx();
  return getTeamById(teamId, { includeArchived: true });
}

function updateTeam(id, payload) {
  const db = getDb();
  const teamId = Number(id);
  const members = Array.isArray(payload.members) ? payload.members : [];

  const tx = db.transaction(() => {
    const normalizedRate = normalizeTeamDailyRate(payload.team_daily_rate);
    console.info('[team-rate-debug] repo save team_daily_rate =', {
      mode: 'update',
      teamId,
      name: payload.name?.trim() || '',
      team_daily_rate: normalizedRate,
    });
    db.prepare(`
      UPDATE teams
      SET name = ?, notes = ?, attendance_mode = ?, team_daily_rate = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      payload.name?.trim() || '',
      payload.notes || null,
      normalizeAttendanceMode(payload.attendance_mode),
      normalizedRate,
      teamId
    );

    db.prepare(`
      DELETE FROM team_members
      WHERE team_id = ?
    `).run(teamId);

    const insertMember = db.prepare(`
      INSERT INTO team_members (
        team_id, employee_id, compensation, manage_by_days, sort_order, notes
      ) VALUES (
        @team_id, @employee_id, @compensation, @manage_by_days, @sort_order, @notes
      )
    `);

    members
      .map(normalizeMemberInput)
      .filter((member) => member.employee_id > 0)
      .forEach((member) => {
        insertMember.run({
          team_id: teamId,
          ...member,
        });
      });
  });

  tx();
  return getTeamById(teamId, { includeArchived: true });
}

function archiveTeam(id) {
  const db = getDb();
  const teamId = Number(id);
  const tx = db.transaction(() => {
    const existing = db.prepare(`
      SELECT id
      FROM teams
      WHERE id = ?
      LIMIT 1
    `).get(teamId);

    if (!existing) {
      throw new Error('Squadra non trovata');
    }

    db.prepare(`
      UPDATE teams
      SET is_archived = 1,
          archived_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(teamId);
  });

  tx();

  return getTeamById(id, { includeArchived: true });
}

function restoreTeam(id) {
  const db = getDb();
  const teamId = Number(id);
  const tx = db.transaction(() => {
    const existing = db.prepare(`
      SELECT id
      FROM teams
      WHERE id = ?
      LIMIT 1
    `).get(teamId);

    if (!existing) {
      throw new Error('Squadra non trovata');
    }

    db.prepare(`
      UPDATE teams
      SET is_archived = 0,
          archived_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(teamId);
  });

  tx();

  return getTeamById(id, { includeArchived: true });
}

function deleteTeamPermanently(id) {
  const db = getDb();
  // team_members ha ON DELETE CASCADE, si elimina automaticamente
  db.prepare('DELETE FROM teams WHERE id = ?').run(id);
}

module.exports = {
  archiveTeam,
  createTeam,
  deleteTeamPermanently,
  getTeamById,
  listTeams,
  restoreTeam,
  updateTeam,
};
