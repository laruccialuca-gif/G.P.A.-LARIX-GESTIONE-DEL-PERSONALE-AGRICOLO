const { getDb } = require('./db');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeDate(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parts = raw.split(/[\/\-.]/);
  if (parts.length === 3 && parts[0].length === 2) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return raw;
}

function normalizeQuantity(value, defaultValue = 0) {
  const normalized = String(value ?? '').replace(',', '.').trim();
  if (!normalized) return defaultValue;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function buildEmployeeLabel(row) {
  return `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.employee_label || `Dipendente ${row.employee_id}`;
}

function mapItemRow(row) {
  const purchasedQuantity = Number(row.purchased_quantity || 0);
  const assignedQuantity = Number(row.assigned_quantity || 0);
  return {
    id: Number(row.id),
    type: row.type || '',
    description: row.description || '',
    size: row.size || '',
    purchased_quantity: purchasedQuantity,
    assigned_quantity: assignedQuantity,
    available_quantity: purchasedQuantity - assignedQuantity,
    purchase_date: row.purchase_date || null,
    notes: row.notes || '',
    is_archived: Number(row.is_archived || 0) === 1,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function mapAssignmentRow(row) {
  return {
    id: Number(row.id),
    dpi_item_id: Number(row.dpi_item_id),
    employee_id: Number(row.employee_id),
    assigned_date: row.assigned_date || null,
    quantity: Number(row.quantity || 0),
    notes: row.notes || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    item_type: row.item_type || '',
    item_description: row.item_description || '',
    item_size: row.item_size || '',
    item_is_archived: Number(row.item_is_archived || 0) === 1,
    employee_name: buildEmployeeLabel(row),
    employee_fiscal_code: row.fiscal_code || '',
  };
}

function normalizeItemPayload(payload = {}) {
  const type = normalizeText(payload.type);
  if (!type) {
    throw new Error('Tipologia DPI obbligatoria');
  }

  return {
    type,
    description: normalizeText(payload.description) || null,
    size: normalizeText(payload.size) || null,
    purchased_quantity: normalizeQuantity(payload.purchased_quantity ?? payload.purchasedQuantity, 0),
    purchase_date: normalizeDate(payload.purchase_date ?? payload.purchaseDate),
    notes: normalizeText(payload.notes) || null,
  };
}

function normalizeAssignmentPayload(payload = {}) {
  const dpiItemId = Number(payload.dpi_item_id ?? payload.dpiItemId ?? 0);
  const employeeId = Number(payload.employee_id ?? payload.employeeId ?? 0);
  const assignedDate = normalizeDate(payload.assigned_date ?? payload.assignedDate);
  const quantity = normalizeQuantity(payload.quantity, 1);

  if (!dpiItemId) {
    throw new Error('DPI obbligatorio');
  }
  if (!employeeId) {
    throw new Error('Dipendente obbligatorio');
  }
  if (!assignedDate) {
    throw new Error('Data consegna obbligatoria');
  }
  if (!(quantity > 0)) {
    throw new Error('Quantita non valida');
  }

  return {
    dpi_item_id: dpiItemId,
    employee_id: employeeId,
    assigned_date: assignedDate,
    quantity,
    notes: normalizeText(payload.notes) || null,
  };
}

function getItemById(id) {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      i.*,
      COALESCE(SUM(a.quantity), 0) AS assigned_quantity
    FROM dpi_items i
    LEFT JOIN dpi_assignments a ON a.dpi_item_id = i.id
    WHERE i.id = ?
    GROUP BY i.id
    LIMIT 1
  `).get(Number(id));

  return row ? mapItemRow(row) : null;
}

function getAssignmentById(id) {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      a.*,
      i.type AS item_type,
      i.description AS item_description,
      i.size AS item_size,
      i.is_archived AS item_is_archived,
      e.first_name,
      e.last_name,
      e.fiscal_code
    FROM dpi_assignments a
    JOIN dpi_items i ON i.id = a.dpi_item_id
    JOIN employees e ON e.id = a.employee_id
    WHERE a.id = ?
    LIMIT 1
  `).get(Number(id));

  return row ? mapAssignmentRow(row) : null;
}

function getAssignedQuantityForItem(itemId, excludeAssignmentId = null) {
  const db = getDb();
  const baseSql = `
    SELECT COALESCE(SUM(quantity), 0) AS total
    FROM dpi_assignments
    WHERE dpi_item_id = ?
  `;

  if (excludeAssignmentId) {
    return Number(
      db.prepare(`${baseSql} AND id != ?`).get(Number(itemId), Number(excludeAssignmentId))?.total || 0
    );
  }

  return Number(db.prepare(baseSql).get(Number(itemId))?.total || 0);
}

function assertAssignmentAvailability(itemId, quantity, excludeAssignmentId = null) {
  const item = getItemById(itemId);
  if (!item) {
    throw new Error('DPI non trovato');
  }

  const assignedWithoutCurrent = getAssignedQuantityForItem(itemId, excludeAssignmentId);
  const available = Number(item.purchased_quantity || 0) - assignedWithoutCurrent;

  if (quantity > available + 0.0001) {
    throw new Error(`Quantita non disponibile. Disponibili: ${available}`);
  }
}

function listItems(options = {}) {
  const db = getDb();
  const includeArchived = !!options.includeArchived;
  const rows = db.prepare(`
    SELECT
      i.*,
      COALESCE(SUM(a.quantity), 0) AS assigned_quantity
    FROM dpi_items i
    LEFT JOIN dpi_assignments a ON a.dpi_item_id = i.id
    ${includeArchived ? '' : 'WHERE COALESCE(i.is_archived, 0) = 0'}
    GROUP BY i.id
    ORDER BY COALESCE(i.is_archived, 0) ASC, i.type COLLATE NOCASE ASC, i.size COLLATE NOCASE ASC, i.id DESC
  `).all();

  return rows.map(mapItemRow);
}

function createItem(payload) {
  const db = getDb();
  const data = normalizeItemPayload(payload);
  const result = db.prepare(`
    INSERT INTO dpi_items (
      type, description, size, purchased_quantity, purchase_date, notes, is_archived
    ) VALUES (
      @type, @description, @size, @purchased_quantity, @purchase_date, @notes, 0
    )
  `).run(data);

  return getItemById(result.lastInsertRowid);
}

function updateItem(id, payload) {
  const itemId = Number(id);
  const existing = getItemById(itemId);
  if (!existing) {
    throw new Error('DPI non trovato');
  }

  const data = normalizeItemPayload({
    ...existing,
    ...payload,
  });

  const assignedQuantity = getAssignedQuantityForItem(itemId);
  if (data.purchased_quantity < assignedQuantity - 0.0001) {
    throw new Error(`Quantita acquistata insufficiente. Gia assegnati: ${assignedQuantity}`);
  }

  getDb().prepare(`
    UPDATE dpi_items
    SET type = @type,
        description = @description,
        size = @size,
        purchased_quantity = @purchased_quantity,
        purchase_date = @purchase_date,
        notes = @notes,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id: itemId,
    ...data,
  });

  return getItemById(itemId);
}

function archiveItem(id) {
  const itemId = Number(id);
  const existing = getItemById(itemId);
  if (!existing) {
    throw new Error('DPI non trovato');
  }

  getDb().prepare(`
    UPDATE dpi_items
    SET is_archived = 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(itemId);

  return getItemById(itemId);
}

function deleteItem(id) {
  const itemId = Number(id);
  const assignmentsCount = Number(
    getDb().prepare(`
      SELECT COUNT(*) AS count
      FROM dpi_assignments
      WHERE dpi_item_id = ?
    `).get(itemId)?.count || 0
  );

  if (assignmentsCount > 0) {
    throw new Error('Impossibile eliminare un DPI gia assegnato. Archiviarlo invece.');
  }

  getDb().prepare('DELETE FROM dpi_items WHERE id = ?').run(itemId);
  return { success: true };
}

function listAssignments(options = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (options.employeeId || options.employee_id) {
    conditions.push('a.employee_id = ?');
    params.push(Number(options.employeeId || options.employee_id));
  }
  if (options.itemId || options.dpi_item_id) {
    conditions.push('a.dpi_item_id = ?');
    params.push(Number(options.itemId || options.dpi_item_id));
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT
      a.*,
      i.type AS item_type,
      i.description AS item_description,
      i.size AS item_size,
      i.is_archived AS item_is_archived,
      e.first_name,
      e.last_name,
      e.fiscal_code
    FROM dpi_assignments a
    JOIN dpi_items i ON i.id = a.dpi_item_id
    JOIN employees e ON e.id = a.employee_id
    ${whereClause}
    ORDER BY a.assigned_date DESC, a.id DESC
  `).all(...params);

  return rows.map(mapAssignmentRow);
}

function createAssignment(payload) {
  const db = getDb();
  const data = normalizeAssignmentPayload(payload);
  assertAssignmentAvailability(data.dpi_item_id, data.quantity);

  const result = db.prepare(`
    INSERT INTO dpi_assignments (
      dpi_item_id, employee_id, assigned_date, quantity, notes
    ) VALUES (
      @dpi_item_id, @employee_id, @assigned_date, @quantity, @notes
    )
  `).run(data);

  return getAssignmentById(result.lastInsertRowid);
}

function updateAssignment(id, payload) {
  const assignmentId = Number(id);
  const existing = getAssignmentById(assignmentId);
  if (!existing) {
    throw new Error('Assegnazione DPI non trovata');
  }

  const data = normalizeAssignmentPayload({
    ...existing,
    ...payload,
    dpi_item_id: payload.dpi_item_id ?? payload.dpiItemId ?? existing.dpi_item_id,
    employee_id: payload.employee_id ?? payload.employeeId ?? existing.employee_id,
    assigned_date: payload.assigned_date ?? payload.assignedDate ?? existing.assigned_date,
  });
  assertAssignmentAvailability(data.dpi_item_id, data.quantity, assignmentId);

  getDb().prepare(`
    UPDATE dpi_assignments
    SET dpi_item_id = @dpi_item_id,
        employee_id = @employee_id,
        assigned_date = @assigned_date,
        quantity = @quantity,
        notes = @notes,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id: assignmentId,
    ...data,
  });

  return getAssignmentById(assignmentId);
}

function deleteAssignment(id) {
  getDb().prepare('DELETE FROM dpi_assignments WHERE id = ?').run(Number(id));
  return { success: true };
}

function getEmployeeAssignments(employeeId) {
  return listAssignments({ employeeId: Number(employeeId) });
}

module.exports = {
  listItems,
  createItem,
  updateItem,
  archiveItem,
  deleteItem,
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  getEmployeeAssignments,
};
