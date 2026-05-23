import React, { useEffect, useMemo, useState } from 'react';
import { dispatchRouteReady } from '../utils/navigationPerf';

const DPI_ICON = '\u{1F97E}';

function formatDate(value) {
  if (!value) return '-';
  const parts = String(value).split('T')[0].split('-');
  if (parts.length !== 3) return value;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatQuantity(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/\.?0+$/, '');
}

function normalizeSortText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getEmployeeLabel(employee) {
  return `${employee?.first_name || ''} ${employee?.last_name || ''}`.trim();
}

function compareEmployees(a, b) {
  const lastCompare = normalizeSortText(a?.last_name).localeCompare(
    normalizeSortText(b?.last_name),
    'it',
    { sensitivity: 'base' }
  );
  if (lastCompare !== 0) return lastCompare;

  const firstCompare = normalizeSortText(a?.first_name).localeCompare(
    normalizeSortText(b?.first_name),
    'it',
    { sensitivity: 'base' }
  );
  if (firstCompare !== 0) return firstCompare;

  return normalizeSortText(getEmployeeLabel(a)).localeCompare(
    normalizeSortText(getEmployeeLabel(b)),
    'it',
    { sensitivity: 'base' }
  );
}

function compareItems(a, b) {
  const typeCompare = String(a?.type || a?.tipologia || '').localeCompare(
    String(b?.type || b?.tipologia || ''),
    'it',
    { sensitivity: 'base' }
  );
  if (typeCompare !== 0) return typeCompare;

  const descriptionCompare = String(a?.description || a?.descrizione || '').localeCompare(
    String(b?.description || b?.descrizione || ''),
    'it',
    { sensitivity: 'base' }
  );
  if (descriptionCompare !== 0) return descriptionCompare;

  return String(a?.size || a?.taglia || '').localeCompare(
    String(b?.size || b?.taglia || ''),
    'it',
    { numeric: true, sensitivity: 'base' }
  );
}

function compareAssignmentsByDateDesc(a, b) {
  const leftDate = new Date(String(a?.assigned_date || a?.delivery_date || a?.data_consegna || 0)).getTime() || 0;
  const rightDate = new Date(String(b?.assigned_date || b?.delivery_date || b?.data_consegna || 0)).getTime() || 0;
  const dateCompare = rightDate - leftDate;
  if (dateCompare !== 0) return dateCompare;
  return String(a?.employee_name || a?.dipendente || '').localeCompare(
    String(b?.employee_name || b?.dipendente || ''),
    'it',
    { sensitivity: 'base' }
  );
}

function createEmptyItemForm() {
  return {
    type: '',
    description: '',
    size: '',
    purchased_quantity: '',
    purchase_date: '',
    notes: '',
  };
}

function createEmptyAssignmentForm() {
  return {
    dpi_item_id: '',
    employee_id: '',
    quantity: '1',
    assigned_date: new Date().toISOString().slice(0, 10),
    notes: '',
  };
}

export default function DpiPage() {
  const [items, setItems] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingItem, setSavingItem] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingAssignmentId, setEditingAssignmentId] = useState(null);
  const [itemForm, setItemForm] = useState(createEmptyItemForm());
  const [assignmentForm, setAssignmentForm] = useState(createEmptyAssignmentForm());

  async function loadData() {
    setLoading(true);
    try {
      const [itemsData, assignmentsData, employeesData] = await Promise.all([
        window.api.dpi.listItems({ includeArchived: true }),
        window.api.dpi.listAssignments(),
        window.api.employees.listBasic(),
      ]);
      setItems(Array.isArray(itemsData) ? itemsData : []);
      setAssignments(Array.isArray(assignmentsData) ? assignmentsData : []);
      setEmployees(Array.isArray(employeesData) ? employeesData : []);
    } catch (err) {
      console.error(err);
      alert('Errore caricamento DPI');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!loading) {
      dispatchRouteReady('/dpi');
    }
  }, [loading]);

  const sortedEmployees = useMemo(
    () =>
      [...employees]
        .filter((employee) => !employee.is_deleted)
        .sort(compareEmployees),
    [employees]
  );

  const sortedItems = useMemo(() => [...items].sort(compareItems), [items]);

  const activeItems = useMemo(
    () => sortedItems.filter((item) => !item.is_archived),
    [sortedItems]
  );

  const sortedAssignments = useMemo(
    () => [...assignments].sort(compareAssignmentsByDateDesc),
    [assignments]
  );

  const sortedAvailableDpi = useMemo(() => {
    const selectedId = Number(assignmentForm.dpi_item_id || 0);
    return activeItems
      .filter((item) => item.available_quantity > 0 || Number(item.id) === selectedId)
      .sort(compareItems);
  }, [activeItems, assignmentForm.dpi_item_id]);

  function startEditItem(item) {
    setEditingItemId(item.id);
    setItemForm({
      type: item.type || '',
      description: item.description || '',
      size: item.size || '',
      purchased_quantity: String(item.purchased_quantity ?? ''),
      purchase_date: item.purchase_date || '',
      notes: item.notes || '',
    });
  }

  function resetItemForm() {
    setEditingItemId(null);
    setItemForm(createEmptyItemForm());
  }

  async function handleSaveItem(event) {
    event.preventDefault();
    setSavingItem(true);
    try {
      if (editingItemId) {
        await window.api.dpi.updateItem(editingItemId, itemForm);
      } else {
        await window.api.dpi.createItem(itemForm);
      }
      resetItemForm();
      await loadData();
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore salvataggio DPI');
    } finally {
      setSavingItem(false);
    }
  }

  async function handleArchiveItem(itemId) {
    if (!window.confirm("Confermi l'archiviazione di questo DPI?")) return;
    try {
      await window.api.dpi.archiveItem(itemId);
      await loadData();
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore archiviazione DPI');
    }
  }

  async function handleDeleteItem(itemId) {
    if (!window.confirm("Confermi l'eliminazione di questo DPI?")) return;
    try {
      await window.api.dpi.deleteItem(itemId);
      await loadData();
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore eliminazione DPI');
    }
  }

  function startEditAssignment(assignment) {
    setEditingAssignmentId(assignment.id);
    setAssignmentForm({
      dpi_item_id: String(assignment.dpi_item_id || ''),
      employee_id: String(assignment.employee_id || ''),
      quantity: String(assignment.quantity ?? '1'),
      assigned_date: assignment.assigned_date || new Date().toISOString().slice(0, 10),
      notes: assignment.notes || '',
    });
  }

  function resetAssignmentForm() {
    setEditingAssignmentId(null);
    setAssignmentForm(createEmptyAssignmentForm());
  }

  async function handleSaveAssignment(event) {
    event.preventDefault();
    setSavingAssignment(true);
    try {
      if (editingAssignmentId) {
        await window.api.dpi.updateAssignment(editingAssignmentId, assignmentForm);
      } else {
        await window.api.dpi.createAssignment(assignmentForm);
      }
      resetAssignmentForm();
      await loadData();
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore assegnazione DPI');
    } finally {
      setSavingAssignment(false);
    }
  }

  async function handleDeleteAssignment(id) {
    if (!window.confirm("Confermi l'eliminazione di questa assegnazione DPI?")) return;
    try {
      await window.api.dpi.deleteAssignment(id);
      if (editingAssignmentId === id) {
        resetAssignmentForm();
      }
      await loadData();
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore eliminazione assegnazione DPI');
    }
  }

  return (
    <div className="page dpi-page">
      <section className="page-hero dpi-page__hero">
        <div>
          <span className="page-kicker">Magazzino sicurezza</span>
          <h1 className="page-title">{DPI_ICON} DPI</h1>
          <p className="page-subtitle">Gestione dispositivi di protezione individuale.</p>
        </div>
      </section>

      <div className="dpi-page__layout">
        <div className="dpi-page__top-grid">
          <section className="dpi-card">
            <div className="dpi-card__head">
              <div>
                <h2 className="dpi-card__title">Anagrafica DPI</h2>
                <p className="dpi-card__subtitle">Crea e aggiorna gli articoli di magazzino.</p>
              </div>
            </div>

            <form onSubmit={handleSaveItem} className="dpi-form">
              <label className="dpi-field">
                <span>Tipologia DPI</span>
                <input
                  value={itemForm.type}
                  onChange={(event) => setItemForm((current) => ({ ...current, type: event.target.value }))}
                  placeholder="Scarpe"
                  required
                />
              </label>
              <label className="dpi-field">
                <span>Taglia / misura</span>
                <input
                  value={itemForm.size}
                  onChange={(event) => setItemForm((current) => ({ ...current, size: event.target.value }))}
                  placeholder="42"
                />
              </label>
              <label className="dpi-field">
                <span>Quantità acquistata</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={itemForm.purchased_quantity}
                  onChange={(event) => setItemForm((current) => ({ ...current, purchased_quantity: event.target.value }))}
                  placeholder="10"
                />
              </label>

              <label className="dpi-field">
                <span>Data acquisto</span>
                <input
                  type="date"
                  value={itemForm.purchase_date}
                  onChange={(event) => setItemForm((current) => ({ ...current, purchase_date: event.target.value }))}
                />
              </label>
              <label className="dpi-field dpi-field--span-2">
                <span>Descrizione</span>
                <input
                  value={itemForm.description}
                  onChange={(event) => setItemForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Scarpe antinfortunistiche"
                />
              </label>

              <label className="dpi-field dpi-field--full">
                <span>Note</span>
                <textarea
                  rows={2}
                  value={itemForm.notes}
                  onChange={(event) => setItemForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Dettagli acquisto o fornitore"
                />
              </label>

              <div className="dpi-form__actions">
                <button className="button-secondary" type="button" onClick={resetItemForm} disabled={savingItem}>
                  Annulla
                </button>
                <button className="button" type="submit" disabled={savingItem}>
                  {savingItem ? 'Salvataggio...' : editingItemId ? 'Salva modifica' : 'Aggiungi DPI'}
                </button>
              </div>
            </form>
          </section>

          <section className="dpi-card">
            <div className="dpi-card__head">
              <div>
                <h2 className="dpi-card__title">Assegna DPI</h2>
                <p className="dpi-card__subtitle">Registra una consegna e aggiorna la disponibilità.</p>
              </div>
            </div>

            <form onSubmit={handleSaveAssignment} className="dpi-form">
              <label className="dpi-field dpi-field--span-2">
                <span>Dipendente</span>
                <select
                  value={assignmentForm.employee_id}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, employee_id: event.target.value }))}
                  required
                >
                  <option value="">Seleziona dipendente</option>
                  {sortedEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {getEmployeeLabel(employee)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="dpi-field">
                <span>DPI</span>
                <select
                  value={assignmentForm.dpi_item_id}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, dpi_item_id: event.target.value }))}
                  required
                >
                  <option value="">Seleziona DPI</option>
                  {sortedAvailableDpi.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.type} {item.size ? `- ${item.size}` : ''} ({formatQuantity(item.available_quantity)} disp.)
                    </option>
                  ))}
                </select>
              </label>
              <label className="dpi-field">
                <span>Quantità</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={assignmentForm.quantity}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, quantity: event.target.value }))}
                  required
                />
              </label>

              <label className="dpi-field dpi-field--full">
                <span>Data consegna</span>
                <input
                  type="date"
                  value={assignmentForm.assigned_date}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, assigned_date: event.target.value }))}
                  required
                />
              </label>

              <label className="dpi-field dpi-field--full">
                <span>Note</span>
                <textarea
                  rows={2}
                  value={assignmentForm.notes}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Consegna effettuata alla firma"
                />
              </label>

              <div className="dpi-form__actions">
                <button className="button-secondary" type="button" onClick={resetAssignmentForm} disabled={savingAssignment}>
                  Annulla
                </button>
                <button className="button" type="submit" disabled={savingAssignment}>
                  {savingAssignment ? 'Salvataggio...' : editingAssignmentId ? 'Salva assegnazione' : 'Assegna DPI'}
                </button>
              </div>
            </form>
          </section>
        </div>

        <section className="dpi-card">
          <div className="dpi-card__head">
            <div>
              <h2 className="dpi-card__title">Magazzino DPI</h2>
              <p className="dpi-card__subtitle">Disponibilità, assegnazioni e acquisti ordinati per tipologia.</p>
            </div>
          </div>

          {loading ? (
            <div className="dpi-empty">Caricamento DPI...</div>
          ) : sortedItems.length ? (
            <div className="dpi-table-wrap">
              <table className="dpi-table dpi-table--inventory">
                <thead>
                  <tr>
                    <th>Tipologia</th>
                    <th>Descrizione</th>
                    <th>Taglia</th>
                    <th className="dpi-table__cell--center">Disponibili</th>
                    <th className="dpi-table__cell--center">Assegnati</th>
                    <th className="dpi-table__cell--center">Acquistati</th>
                    <th>Data acquisto</th>
                    <th>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="dpi-table__primary">
                          <strong>{item.type}</strong>
                          {item.is_archived ? <span className="soft-chip">Archiviato</span> : null}
                        </div>
                      </td>
                      <td>{item.description || '-'}</td>
                      <td>{item.size || '-'}</td>
                      <td className="dpi-table__cell--center">
                        <span
                          className={`dpi-availability-badge ${
                            Number(item.available_quantity || 0) > 0
                              ? 'dpi-availability-badge--available'
                              : 'dpi-availability-badge--empty'
                          }`}
                        >
                          {formatQuantity(item.available_quantity)}
                        </span>
                      </td>
                      <td className="dpi-table__cell--center">{formatQuantity(item.assigned_quantity)}</td>
                      <td className="dpi-table__cell--center">{formatQuantity(item.purchased_quantity)}</td>
                      <td>{formatDate(item.purchase_date)}</td>
                      <td>
                        <div className="dpi-table__actions">
                          <button className="button-secondary" type="button" onClick={() => startEditItem(item)}>
                            Modifica
                          </button>
                          {!item.is_archived ? (
                            <button className="button-secondary" type="button" onClick={() => handleArchiveItem(item.id)}>
                              Archivia
                            </button>
                          ) : null}
                          <button className="button-danger" type="button" onClick={() => handleDeleteItem(item.id)}>
                            Elimina
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="dpi-empty">Nessun DPI registrato.</div>
          )}
        </section>

        <section className="dpi-card">
          <div className="dpi-card__head">
            <div>
              <h2 className="dpi-card__title">Storico assegnazioni</h2>
              <p className="dpi-card__subtitle">Assegnazioni ordinate dal più recente al più vecchio.</p>
            </div>
          </div>

          {loading ? (
            <div className="dpi-empty">Caricamento assegnazioni...</div>
          ) : sortedAssignments.length ? (
            <div className="dpi-table-wrap">
              <table className="dpi-table dpi-table--history">
                <thead>
                  <tr>
                    <th>Dipendente</th>
                    <th>DPI</th>
                    <th>Taglia</th>
                    <th className="dpi-table__cell--center">Quantità</th>
                    <th>Data consegna</th>
                    <th>Note</th>
                    <th>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAssignments.map((assignment) => (
                    <tr key={assignment.id}>
                      <td>{assignment.employee_name}</td>
                      <td>{assignment.item_type}{assignment.item_description ? ` - ${assignment.item_description}` : ''}</td>
                      <td>{assignment.item_size || '-'}</td>
                      <td className="dpi-table__cell--center">{formatQuantity(assignment.quantity)}</td>
                      <td>{formatDate(assignment.assigned_date)}</td>
                      <td>{assignment.notes || '-'}</td>
                      <td>
                        <div className="dpi-table__actions">
                          <button className="button-secondary" type="button" onClick={() => startEditAssignment(assignment)}>
                            Modifica
                          </button>
                          <button className="button-danger" type="button" onClick={() => handleDeleteAssignment(assignment.id)}>
                            Elimina
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="dpi-empty">Nessuna assegnazione registrata.</div>
          )}
        </section>
      </div>
    </div>
  );
}
