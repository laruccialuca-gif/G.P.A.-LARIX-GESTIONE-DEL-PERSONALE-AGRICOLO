import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useYearContext } from '../context/YearContext';
import { employeeIsActiveInYear, isDateRangeActiveInYear } from '../utils/yearScope';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthIso() {
  return todayIso().slice(0, 7);
}

function monthIsoForYear(year, month = new Date().getMonth() + 1) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthToRange(value) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ''))) {
    const today = todayIso();
    return { start: today, end: today };
  }

  const [year, month] = value.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    start: formatDateInput(start),
    end: formatDateInput(end),
  };
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    return '—';
  }

  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function formatPeriodLabel(start, end) {
  if (!start || !end) return 'Periodo non definito';
  if (start === end) return formatDateLabel(start);
  return `${formatDateLabel(start)} - ${formatDateLabel(end)}`;
}

function formatCreatedAt(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function normalizeNumberInput(value) {
  if (value === '') return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : '';
}

function normalizeIntegerInput(value) {
  const raw = String(value ?? '');
  if (raw === '') return '';
  return raw.replace(/\D+/g, '');
}

function toNumericValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIntegerValue(value) {
  const normalized = normalizeIntegerInput(value);
  if (normalized === '') return 0;
  return Number(normalized);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(Number(value || 0));
}

function getCommunicationMonth(draft, effectivePeriod) {
  if (draft.period_mode === 'monthly' && /^\d{4}-\d{2}$/.test(String(draft.month_reference || ''))) {
    return draft.month_reference;
  }
  return String(effectivePeriod.start || monthIso()).slice(0, 7);
}

function getCurrentInstallments(record, month) {
  return (record?.debt_plans || []).flatMap((plan) =>
    (plan.installments || [])
      .map((installment, index) => ({
        ...installment,
        planLabel: plan.label || 'Rateizzazione debito',
        installmentNumber: index + 1,
      }))
      .filter((installment) => installment.target_month === month)
  );
}

function buildCompensationSummary(record, month) {
  if (!record) {
    return null;
  }

  const retribuzione = Number(record.retribuzione_calcolata || 0);
  const acconti = Number(record.acconti || 0);
  const installments = getCurrentInstallments(record, month);
  const rateDebiti = installments.reduce((sum, installment) => sum + Number(installment.amount || 0), 0);
  const restoPrecedente = Number(record.resto_precedente || 0);
  const crediti = Math.max(restoPrecedente, 0);
  const debitiPrecedenti = Math.abs(Math.min(restoPrecedente, 0));
  const trasporto = Number(record.totale_trasporto || 0);
  const aggiunte = Number(record.regalo_importo || 0);
  const totale = retribuzione + aggiunte + crediti + trasporto - rateDebiti - debitiPrecedenti - acconti;

  return {
    retribuzione,
    acconti,
    rateDebiti,
    crediti,
    debitiPrecedenti,
    trasporto,
    aggiunte,
    totale,
    installments,
    record,
  };
}

function getCompensationPopoverPosition(anchorRect) {
  const width = 300;
  const estimatedHeight = 245;
  const margin = 12;
  const gap = 8;

  let left = anchorRect.right + gap;
  if (left + width > window.innerWidth - margin) {
    left = anchorRect.left - width - gap;
  }
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

  let top = anchorRect.top;
  if (top + estimatedHeight > window.innerHeight - margin) {
    top = anchorRect.bottom - estimatedHeight;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - estimatedHeight - margin));

  return { left, top };
}

function buildEmployeeRows(employees, existingRows = []) {
  const existingMap = new Map(existingRows.map((row) => [String(row.employee_id), row]));

  return [...employees]
    .sort((a, b) => {
      const lastCompare = String(a.last_name || '').localeCompare(String(b.last_name || ''), 'it');
      if (lastCompare !== 0) return lastCompare;
      return String(a.first_name || '').localeCompare(String(b.first_name || ''), 'it');
    })
    .map((employee, index) => {
      const existing = existingMap.get(String(employee.id));
      return {
        employee_id: employee.id,
        employee_label: `${employee.last_name || ''} ${employee.first_name || ''}`.trim(),
        giornate_primo: existing ? normalizeIntegerInput(existing.giornate_primo) : '',
        giornate_secondo: existing ? normalizeIntegerInput(existing.giornate_secondo) : '',
        detail_note: existing?.detail_note || '',
        sort_order: existing?.sort_order ?? index,
      };
    });
}

function historyToDraftRows(details = []) {
  return details.map((detail, index) => ({
    employee_id: detail.employee_id || null,
    employee_label: detail.employee_label,
    giornate_primo: normalizeIntegerInput(detail.giornate_primo),
    giornate_secondo: normalizeIntegerInput(detail.giornate_secondo),
    detail_note: detail.detail_note || '',
    sort_order: detail.sort_order ?? index,
  }));
}

function blankDraft(employees, settings = null) {
  const defaultMonth = monthIso();
  const employerOptions = settings?.employer_options || [];
  const rows = buildEmployeeRows(employees);
  return {
    id: null,
    company_name: settings?.company?.document_header || settings?.company?.name || 'GPA versione 1',
    title: 'Elenco giornate',
    recipient_email: '',
    show_compensation_in_pdf: true,
    selected_employee_ids: rows.map((row) => row.employee_id).filter(Boolean),
    notes: '',
    employer_labels: employerOptions,
    period_mode: 'monthly',
    month_reference: defaultMonth,
    period_start: monthToRange(defaultMonth).start,
    period_end: monthToRange(defaultMonth).end,
    details: rows,
  };
}

function getCommunicationReferenceRange(communication) {
  if (communication?.period_mode === 'monthly' && /^\d{4}-\d{2}$/.test(String(communication?.month_reference || ''))) {
    return monthToRange(communication.month_reference);
  }

  return {
    start: communication?.period_start || '',
    end: communication?.period_end || '',
  };
}

function extractYear(value) {
  const year = Number(String(value || '').slice(0, 4));
  return Number.isInteger(year) && year > 1900 ? year : null;
}

function getDraftReferenceYear(draft, effectivePeriod, fallbackYear) {
  if (draft?.period_mode === 'monthly') {
    return extractYear(draft?.month_reference) ?? fallbackYear;
  }

  return extractYear(effectivePeriod?.start) ?? extractYear(effectivePeriod?.end) ?? fallbackYear;
}

export default function CommunicationPage() {
  const COMMUNICATION_PAGE_SIZE = 24;
  const navigate = useNavigate();
  const { selectedYear } = useYearContext();
  const [employees, setEmployees] = useState([]);
  const [communications, setCommunications] = useState([]);
  const [communicationTotal, setCommunicationTotal] = useState(0);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyOffset, setHistoryOffset] = useState(0);
  const [includeExcelInEmail, setIncludeExcelInEmail] = useState(true);
  const [draft, setDraft] = useState(blankDraft([]));
  const [emailContacts, setEmailContacts] = useState([]);
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [contactForm, setContactForm] = useState({ id: '', name: '', email: '' });
  const [payrollByEmployee, setPayrollByEmployee] = useState({});
  const [activeCompensationKey, setActiveCompensationKey] = useState(null);
  const [lockedCompensationKey, setLockedCompensationKey] = useState(null);
  const [compensationPopoverPosition, setCompensationPopoverPosition] = useState({ left: 12, top: 12 });
  const compensationCloseTimerRef = useRef(null);
  const deferredHistorySearch = useDeferredValue(historySearch);

  async function loadData() {
    setLoading(true);
    try {
      const [employeeData, communicationData, settingsData] = await Promise.all([
        window.api.employees.list(),
        window.api.communications.list({
          year: selectedYear,
          search: deferredHistorySearch,
          limit: COMMUNICATION_PAGE_SIZE,
          offset: historyOffset,
        }),
        window.api.settings.get(),
      ]);
      const contacts = await window.api.communications.listContacts();

      const employeeList = employeeData || [];
      setSettings(settingsData || null);
      setEmailContacts(contacts || []);
      setEmployees(employeeList);
      if (Array.isArray(communicationData)) {
        setCommunications(communicationData || []);
        setCommunicationTotal((communicationData || []).length);
      } else {
        setCommunications(communicationData?.items || []);
        setCommunicationTotal(Number(communicationData?.total || 0));
      }
      setDraft((current) => ({
        ...(() => {
          const rebuiltRows = current.id
            ? current.details
            : buildEmployeeRows(employeeList, current.details);
          const rebuiltEmployeeIds = rebuiltRows.map((row) => row.employee_id).filter(Boolean);
          return {
            ...current,
            company_name: current.id ? current.company_name : settingsData?.company?.document_header || settingsData?.company?.name || current.company_name,
            employer_labels: settingsData?.employer_options || current.employer_labels || [],
            details: rebuiltRows,
            selected_employee_ids: current.id
              ? current.selected_employee_ids || rebuiltEmployeeIds
              : rebuiltEmployeeIds.filter((id) =>
                  (current.selected_employee_ids || rebuiltEmployeeIds).includes(id)
                ),
          };
        })(),
      }));
    } catch (err) {
      console.error(err);
      alert('Errore caricamento sezione Comunicazione');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [selectedYear, deferredHistorySearch, historyOffset]);

  useEffect(() => {
    setHistoryOffset(0);
  }, [selectedYear, deferredHistorySearch]);

  useEffect(() => {
    setDraft((current) => {
      if (current.id || current.period_mode !== 'monthly') {
        return current;
      }

      const currentMonth = /^\d{4}-\d{2}$/.test(String(current.month_reference || ''))
        ? Number(String(current.month_reference).slice(5, 7))
        : 1;
      const nextMonthReference = monthIsoForYear(selectedYear, currentMonth);
      if (current.month_reference === nextMonthReference) {
        return current;
      }

      const range = monthToRange(nextMonthReference);
      return {
        ...current,
        month_reference: nextMonthReference,
        period_start: range.start,
        period_end: range.end,
      };
    });
  }, [selectedYear]);

  useEffect(() => () => {
    if (compensationCloseTimerRef.current) {
      clearTimeout(compensationCloseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (draft.period_mode !== 'monthly') return;
    const range = monthToRange(draft.month_reference);
    setDraft((current) => ({
      ...current,
      period_start: range.start,
      period_end: range.end,
    }));
  }, [draft.month_reference, draft.period_mode]);

  const effectivePeriod = useMemo(() => {
    if (draft.period_mode === 'monthly') {
      return monthToRange(draft.month_reference);
    }

    return {
      start: draft.period_start,
      end: draft.period_end,
    };
  }, [draft.month_reference, draft.period_end, draft.period_mode, draft.period_start]);

  const employerOptions = settings?.employer_options || draft.employer_labels || [];
  const hasSecondEmployer = employerOptions.length > 1;
  const communicationMonth = getCommunicationMonth(draft, effectivePeriod);
  const communicationYear = useMemo(
    () => getDraftReferenceYear(draft, effectivePeriod, selectedYear),
    [draft, effectivePeriod, selectedYear]
  );
  const visibleEmployees = useMemo(
    () => employees.filter((employee) => employeeIsActiveInYear(employee, communicationYear)),
    [employees, communicationYear]
  );
  const visibleCommunications = communications;
  const communicationCurrentPage = Math.floor(historyOffset / COMMUNICATION_PAGE_SIZE) + 1;
  const communicationTotalPages = Math.max(1, Math.ceil(communicationTotal / COMMUNICATION_PAGE_SIZE));
  const communicationEmployeeIdsKey = useMemo(
    () => draft.details.map((row) => row.employee_id).filter(Boolean).join('|'),
    [draft.details]
  );

  useEffect(() => {
    setDraft((current) => {
      if (current.id) {
        return current;
      }

      return {
        ...current,
        details: buildEmployeeRows(visibleEmployees, current.details),
        selected_employee_ids: (() => {
          const nextIds = visibleEmployees.map((employee) => employee.id);
          const currentIds = current.selected_employee_ids || nextIds;
          return nextIds.filter((id) => currentIds.includes(id));
        })(),
      };
    });
  }, [visibleEmployees]);

  useEffect(() => {
    let cancelled = false;

    async function loadMonthlyPayroll() {
      const employeeIds = communicationEmployeeIdsKey
        ? communicationEmployeeIdsKey.split('|').map((value) => Number(value))
        : [];

      if (!employeeIds.length || !communicationMonth) {
        setPayrollByEmployee({});
        return;
      }

      try {
        const records = await Promise.all(
          employeeIds.map(async (employeeId) => ({
            employeeId,
            record: await window.api.payroll.getRecord(employeeId, communicationMonth),
          }))
        );

        if (cancelled) return;

        setPayrollByEmployee(
          Object.fromEntries(records.map((item) => [String(item.employeeId), item.record || null]))
        );
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setPayrollByEmployee({});
        }
      }
    }

    loadMonthlyPayroll();

    return () => {
      cancelled = true;
    };
  }, [communicationEmployeeIdsKey, communicationMonth]);

  function handleOpenEmployeeReport(employeeId) {
    if (!employeeId) {
      return;
    }
    navigate(`/report?employee=${employeeId}&month=${communicationMonth}`);
  }

  function clearCompensationCloseTimer() {
    if (compensationCloseTimerRef.current) {
      clearTimeout(compensationCloseTimerRef.current);
      compensationCloseTimerRef.current = null;
    }
  }

  function openCompensationPopover(rowKey, event, lock = false) {
    clearCompensationCloseTimer();
    setCompensationPopoverPosition(getCompensationPopoverPosition(event.currentTarget.getBoundingClientRect()));
    setActiveCompensationKey(rowKey);
    if (lock) {
      setLockedCompensationKey(rowKey);
    }
  }

  function scheduleCompensationClose(rowKey) {
    clearCompensationCloseTimer();
    if (lockedCompensationKey === rowKey) {
      return;
    }

    compensationCloseTimerRef.current = setTimeout(() => {
      setActiveCompensationKey(null);
      compensationCloseTimerRef.current = null;
    }, 120);
  }

  function closeCompensationPopover() {
    clearCompensationCloseTimer();
    setActiveCompensationKey(null);
    setLockedCompensationKey(null);
  }

  async function persistDraft() {
    if (!draft.selected_employee_ids?.length) {
      alert('Seleziona almeno un dipendente');
      return null;
    }

    const basePayload = {
      id: draft.id,
      company_name: draft.company_name,
      title: draft.title,
      recipient_email: draft.recipient_email,
      selected_employee_ids: draft.selected_employee_ids || [],
      show_compensation_in_pdf: draft.show_compensation_in_pdf !== false,
      notes: draft.notes,
      employer_labels: employerOptions,
      period_mode: draft.period_mode,
      month_reference: draft.period_mode === 'monthly' ? draft.month_reference : null,
      period_start: effectivePeriod.start,
      period_end: effectivePeriod.end,
      details: draft.details.map((row, index) => ({
        employee_id: row.employee_id,
        employee_label: row.employee_label,
        giornate_primo: toIntegerValue(row.giornate_primo),
        giornate_secondo: toIntegerValue(row.giornate_secondo),
        detail_note: row.detail_note || '',
        sort_order: row.sort_order ?? index,
      })),
    };

    setSaving(true);
    try {
      let saved;

      try {
        saved = await window.api.communications.save(basePayload);
      } catch (err) {
        if (err?.code === 'COMMUNICATION_MONTH_EXISTS' || String(err?.message || '').includes('Esiste già una comunicazione per questo mese')) {
          const confirmed = window.confirm('Esiste già una comunicazione per questo mese. Vuoi sovrascriverla?');
          if (!confirmed) {
            return null;
          }
          saved = await window.api.communications.save({
            ...basePayload,
            overwrite_existing: true,
          });
        } else {
          throw err;
        }
      }

      setDraft((current) => ({
        ...current,
        id: saved.id,
      }));
      await loadData();
      return saved;
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore salvataggio comunicazione');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    const saved = await persistDraft();
    if (saved) {
      alert('Comunicazione salvata nello storico con PDF ed Excel aggiornati.');
    }
  }

  async function handleOpenGenerated(type) {
    const saved = await persistDraft();
    if (!saved) return;

    try {
      const result = await window.api.communications.openFile(saved.id, type);
      if (result && !result.success && result.message) {
        alert(result.message);
      } else if (result?.senderNotice) {
        alert(result.senderNotice);
      }
    } catch (err) {
      console.error(err);
      alert(`Errore apertura ${type === 'pdf' ? 'PDF' : 'Excel'}`);
    }
  }

  async function handleSendEmail() {
    const saved = await persistDraft();
    if (!saved) return;

    setEmailing(true);
    try {
      const result = await window.api.communications.sendEmail(saved.id, {
        recipient_email: draft.recipient_email,
        includeExcel: includeExcelInEmail,
      });

      if (result && !result.success && result.message) {
        alert(result.message);
      } else if (result?.senderNotice) {
        alert(result.senderNotice);
      }
    } catch (err) {
      console.error(err);
      alert('Errore apertura email');
    } finally {
      setEmailing(false);
    }
  }

  function resetDraft() {
    const nextEmployees = employees.filter((employee) => employeeIsActiveInYear(employee, selectedYear));
    const next = blankDraft(nextEmployees, settings);
    const monthReference = monthIsoForYear(selectedYear);
    const range = monthToRange(monthReference);
    setDraft({
      ...next,
      month_reference: monthReference,
      period_start: range.start,
      period_end: range.end,
    });
  }

  function loadHistoryCommunication(communication) {
    const communicationRange = getCommunicationReferenceRange(communication);
    setDraft({
      id: communication.id,
      company_name: communication.company_name || 'AZIENDA AGRICOLA LARUCCIA',
      title: communication.title || 'Elenco giornate',
      recipient_email: communication.recipient_email || '',
      show_compensation_in_pdf: communication.show_compensation_in_pdf !== false,
      selected_employee_ids: communication.selected_employee_ids?.length
        ? communication.selected_employee_ids
        : (communication.details || []).map((detail) => detail.employee_id).filter(Boolean),
      notes: communication.notes || '',
      employer_labels: communication.employer_labels || employerOptions,
      period_mode: communication.period_mode || 'monthly',
      month_reference: communication.month_reference || '',
      period_start: communicationRange.start || todayIso(),
      period_end: communicationRange.end || todayIso(),
      details: historyToDraftRows(communication.details || []),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateDraftField(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function togglePdfEmployee(employeeId) {
    setDraft((current) => {
      const currentIds = current.selected_employee_ids || [];
      const nextIds = currentIds.includes(employeeId)
        ? currentIds.filter((id) => id !== employeeId)
        : [...currentIds, employeeId];
      return {
        ...current,
        selected_employee_ids: nextIds,
      };
    });
  }

  function selectAllPdfEmployees() {
    setDraft((current) => ({
      ...current,
      selected_employee_ids: current.details.map((row) => row.employee_id).filter(Boolean),
    }));
  }

  function clearAllPdfEmployees() {
    setDraft((current) => ({
      ...current,
      selected_employee_ids: [],
    }));
  }

  function updateDetailRow(index, field, value) {
    setDraft((current) => ({
      ...current,
      details: current.details.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]:
                field === 'employee_label' || field === 'detail_note'
                  ? value
                  : normalizeIntegerInput(value),
            }
          : row
      ),
    }));
  }

  async function handleSaveContact() {
    try {
      const contacts = await window.api.communications.saveContact(contactForm);
      setEmailContacts(contacts || []);
      setContactForm({ id: '', name: '', email: '' });
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore salvataggio contatto');
    }
  }

  async function handleDeleteContact(contactId) {
    const confirmed = window.confirm('Eliminare questo contatto dalla rubrica?');
    if (!confirmed) return;
    try {
      const contacts = await window.api.communications.deleteContact(contactId);
      setEmailContacts(contacts || []);
      if (String(contactForm.id || '') === String(contactId)) {
        setContactForm({ id: '', name: '', email: '' });
      }
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore eliminazione contatto');
    }
  }

  async function handleHistoryOpen(communicationId, type) {
    try {
      const result = await window.api.communications.openFile(communicationId, type);
      if (result && !result.success && result.message) {
        alert(result.message);
      }
    } catch (err) {
      console.error(err);
      alert(`Errore apertura ${type === 'pdf' ? 'PDF' : 'Excel'} storico`);
    }
  }

  async function handleHistoryEmail(communication) {
    setEmailing(true);
    try {
      const result = await window.api.communications.sendEmail(communication.id, {
        recipient_email: communication.recipient_email || draft.recipient_email,
        includeExcel: includeExcelInEmail,
      });

      if (result && !result.success && result.message) {
        alert(result.message);
      }
    } catch (err) {
      console.error(err);
      alert('Errore apertura email storico');
    } finally {
      setEmailing(false);
    }
  }

  async function handleDeleteCommunication(communication) {
    const confirmed = window.confirm("Confermi l'eliminazione di questa comunicazione?");
    if (!confirmed) return;

    try {
      const result = await window.api.communications.delete(communication.id);
      if (result?.success === false && result.message) {
        alert(result.message);
        return;
      }
      if (draft.id === communication.id) {
        resetDraft();
      }
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Errore eliminazione comunicazione');
    }
  }

  return (
    <div className="page">
      <div className="page-sticky-stack">
        <section className="page-hero">
          <div>
            <span className="page-kicker">Documento consulente</span>
            <h1 className="page-title">Comunicazione</h1>
            <p className="page-subtitle">
              Documento ufficiale manuale per il consulente: compili LC, LG e note riga per riga,
              generi PDF ed Excel e conservi uno storico permanente indipendente dalle presenze.
            </p>
          </div>

          <div className="page-actions">
            <button className="button-secondary" onClick={resetDraft}>Nuova comunicazione</button>
            <button className="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Salvataggio...' : 'Salva nello storico'}
            </button>
          </div>
        </section>

        <div className="toolbar">
          <div className="toolbar-group">
            <span className="soft-chip" style={softInfoStyle}>
              Periodo: {formatPeriodLabel(effectivePeriod.start, effectivePeriod.end)}
            </span>
            <span className="soft-chip" style={softInfoStyle}>
              Anno attivo: {selectedYear}
            </span>
            <span className="soft-chip" style={softInfoStyle}>
              Documento manuale indipendente dalle presenze
            </span>
          </div>

          <div className="toolbar-group">
            <button className="button-secondary" onClick={() => handleOpenGenerated('pdf')} disabled={saving}>
              Genera PDF
            </button>
            <button className="button-secondary" onClick={() => handleOpenGenerated('excel')} disabled={saving}>
              Esporta Excel
            </button>
            <label className="communication-checkbox">
              <input
                type="checkbox"
                checked={draft.show_compensation_in_pdf !== false}
                onChange={(e) => updateDraftField('show_compensation_in_pdf', e.target.checked)}
              />
              Mostra colonna compenso nel PDF
            </label>
            <label className="communication-checkbox">
              <input
                type="checkbox"
                checked={includeExcelInEmail}
                onChange={(e) => setIncludeExcelInEmail(e.target.checked)}
              />
              Allega anche Excel
            </label>
            <button className="button-secondary" onClick={handleSendEmail} disabled={saving || emailing}>
              {emailing ? 'Preparazione email...' : 'Invia tramite email'}
            </button>
          </div>
        </div>
      </div>

      <section className="panel panel-section">
        <div className="communication-editor-grid">
          <div className="communication-card">
            <h2 className="communication-section-title">Intestazione</h2>
            <div className="communication-form-grid">
              <div className="communication-period-box">
                <span className="communication-field-label">Azienda</span>
                <strong>{draft.company_name}</strong>
              </div>
              <div className="communication-period-box">
                <span className="communication-field-label">Titolo documento</span>
                <strong>{draft.title}</strong>
              </div>
              <label>
                <span className="communication-field-label">Email destinatario</span>
                <div style={recipientRowStyle}>
                  <input
                    type="email"
                    placeholder="consulente@azienda.it"
                    value={draft.recipient_email}
                    onChange={(e) => updateDraftField('recipient_email', e.target.value)}
                  />
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setShowAddressBook((current) => !current)}
                  >
                    Rubrica
                  </button>
                </div>
              </label>
            </div>
            {showAddressBook ? (
              <div style={addressBookPanelStyle}>
                <div style={addressBookHeaderStyle}>
                  <strong>Rubrica destinatari</strong>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      setShowAddressBook(false);
                      setContactForm({ id: '', name: '', email: '' });
                    }}
                  >
                    Chiudi
                  </button>
                </div>

                <div style={addressBookFormStyle}>
                  <input
                    placeholder="Nome contatto"
                    value={contactForm.name}
                    onChange={(e) => setContactForm((current) => ({ ...current, name: e.target.value }))}
                  />
                  <input
                    type="email"
                    placeholder="Email contatto"
                    value={contactForm.email}
                    onChange={(e) => setContactForm((current) => ({ ...current, email: e.target.value }))}
                  />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="button" onClick={handleSaveContact}>
                      {contactForm.id ? 'Aggiorna contatto' : 'Salva contatto'}
                    </button>
                    {contactForm.id ? (
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => setContactForm({ id: '', name: '', email: '' })}
                      >
                        Annulla modifica
                      </button>
                    ) : null}
                  </div>
                </div>

                <div style={addressBookListStyle}>
                  {emailContacts.length ? emailContacts.map((contact) => (
                    <div key={contact.id} style={addressBookItemStyle}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>{contact.name}</div>
                        <div style={{ fontSize: 12, color: '#667085', overflowWrap: 'anywhere' }}>{contact.email}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => {
                            updateDraftField('recipient_email', contact.email);
                            setShowAddressBook(false);
                          }}
                        >
                          Usa
                        </button>
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => setContactForm(contact)}
                        >
                          Modifica
                        </button>
                        <button
                          type="button"
                          className="button-danger"
                          onClick={() => handleDeleteContact(contact.id)}
                        >
                          Elimina
                        </button>
                      </div>
                    </div>
                  )) : (
                    <div className="empty-state" style={{ padding: 16 }}>Nessun contatto salvato.</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="communication-card">
            <h2 className="communication-section-title">Periodo</h2>
            <div className="communication-form-grid">
              <label>
                <span className="communication-field-label">Modalita</span>
                <select
                  value={draft.period_mode}
                  onChange={(e) => updateDraftField('period_mode', e.target.value)}
                >
                  <option value="monthly">Mensile</option>
                  <option value="custom">Intervallo personalizzato</option>
                </select>
              </label>

              {draft.period_mode === 'monthly' ? (
                <label>
                  <span className="communication-field-label">Mese</span>
                  <input
                    type="month"
                    value={draft.month_reference}
                    onChange={(e) => updateDraftField('month_reference', e.target.value)}
                  />
                </label>
              ) : (
                <>
                  <label>
                    <span className="communication-field-label">Da data</span>
                    <input
                      type="date"
                      value={draft.period_start}
                      onChange={(e) => updateDraftField('period_start', e.target.value)}
                    />
                  </label>
                  <label>
                    <span className="communication-field-label">A data</span>
                    <input
                      type="date"
                      value={draft.period_end}
                      onChange={(e) => updateDraftField('period_end', e.target.value)}
                    />
                  </label>
                </>
              )}

              <div className="communication-period-box">
                <span className="communication-field-label">Periodo visibile nel documento</span>
                <strong>{formatPeriodLabel(effectivePeriod.start, effectivePeriod.end)}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="communication-card" style={{ marginTop: 18 }}>
          <div className="communication-table-head">
            <div>
              <h2 className="communication-section-title" style={{ marginBottom: 4 }}>Tabella giornate</h2>
              <p className="page-subtitle" style={{ marginTop: 0, maxWidth: 'none' }}>
                Documento indipendente dalle presenze: i valori qui sono manuali e completamente modificabili.
              </p>
            </div>
          </div>

          <div style={pdfSelectionPanelStyle}>
            <div style={pdfSelectionHeaderStyle}>
              <div>
                <div className="communication-field-label">Dipendenti inclusi nel PDF</div>
                <strong>
                  {(draft.selected_employee_ids || []).length} su {draft.details.filter((r) => r.employee_id).length} selezionati
                </strong>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="button-secondary" onClick={selectAllPdfEmployees}>
                  Seleziona tutti
                </button>
                <button type="button" className="button-secondary" onClick={clearAllPdfEmployees}>
                  Deseleziona tutti
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="empty-state" style={{ padding: '24px 0' }}>Caricamento dipendenti...</div>
          ) : (
            <div className="communication-table-shell communication-days-table-shell">
              <div className="communication-days-grid-header">
                <div
                  className="communication-select-cell"
                  title="Includi nel PDF"
                  aria-label="Includi nel PDF"
                >
                      <input
                        type="checkbox"
                        aria-label="Seleziona tutti"
                        checked={
                          draft.details.filter((r) => r.employee_id).length > 0 &&
                          (draft.selected_employee_ids || []).length ===
                            draft.details.filter((r) => r.employee_id).length
                        }
                        ref={(el) => {
                          if (el) {
                            const total = draft.details.filter((r) => r.employee_id).length;
                            const sel = (draft.selected_employee_ids || []).length;
                            el.indeterminate = sel > 0 && sel < total;
                          }
                        }}
                        onChange={(e) => (e.target.checked ? selectAllPdfEmployees() : clearAllPdfEmployees())}
                      />
                </div>
                <div className="communication-name-cell">Nome dipendente</div>
                <div>{employerOptions[0] ? employerOptions[0].short_name : 'LC'}</div>
                <div>{employerOptions[1] ? employerOptions[1].short_name : 'LG'}</div>
                <div>Compenso mese</div>
                <div>Note</div>
              </div>
              <div className="communication-days-grid-body">
                  {draft.details.map((row, index) => {
                    const rowKey = `${row.employee_id || 'manual'}_${index}`;
                    const compensation = buildCompensationSummary(payrollByEmployee[String(row.employee_id)], communicationMonth);
                    const isCompensationOpen = activeCompensationKey === rowKey || lockedCompensationKey === rowKey;
                    const isSelected = (draft.selected_employee_ids || []).includes(row.employee_id);

                    return (
                      <div
                        key={rowKey}
                        className={`communication-days-grid-row${isSelected ? ' communication-row-selected' : ''}`}
                        onClick={(e) => {
                          if (!row.employee_id) return;
                          const tag = (e.target.tagName || '').toLowerCase();
                          if (['input', 'textarea', 'button', 'select', 'label', 'a'].includes(tag)) return;
                          togglePdfEmployee(row.employee_id);
                        }}
                      >
                        <div className="communication-select-cell" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Includi ${row.employee_label || 'dipendente'} nel PDF`}
                            checked={isSelected}
                            disabled={!row.employee_id}
                            onChange={() => togglePdfEmployee(row.employee_id)}
                          />
                        </div>
                        <div className="communication-name-cell">
                          <input
                            value={row.employee_label}
                            onChange={(e) => updateDetailRow(index, 'employee_label', e.target.value)}
                          />
                        </div>
                        <div className="communication-days-grid-input-cell">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={row.giornate_primo}
                            onFocus={(e) => e.target.select()}
                            onClick={(e) => e.target.select()}
                            onChange={(e) => updateDetailRow(index, 'giornate_primo', e.target.value)}
                          />
                        </div>
                        <div className="communication-days-grid-input-cell">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={row.giornate_secondo}
                            onFocus={(e) => e.target.select()}
                            onClick={(e) => e.target.select()}
                            onChange={(e) => updateDetailRow(index, 'giornate_secondo', e.target.value)}
                          />
                        </div>
                        <div
                          className="communication-compensation-cell"
                          style={compensationCellStyle}
                          onMouseEnter={(event) => openCompensationPopover(rowKey, event)}
                          onMouseLeave={() => scheduleCompensationClose(rowKey)}
                          onDoubleClick={(event) => {
                            if (lockedCompensationKey === rowKey) {
                              closeCompensationPopover();
                              return;
                            }
                            openCompensationPopover(rowKey, event, true);
                          }}
                          title="Passa sopra o doppio clic per il riepilogo economico"
                        >
                          <button
                            type="button"
                            className="button-secondary"
                            style={compensationButtonStyle}
                            onClick={(event) => openCompensationPopover(rowKey, event, true)}
                          >
                            {compensation ? formatCurrency(compensation.totale) : '—'}
                          </button>

                          {isCompensationOpen ? createPortal(
                            <div
                              style={{
                                ...compensationPopoverStyle,
                                left: compensationPopoverPosition.left,
                                top: compensationPopoverPosition.top,
                              }}
                              onMouseEnter={clearCompensationCloseTimer}
                              onMouseLeave={() => scheduleCompensationClose(rowKey)}
                            >
                              <div style={compensationPopoverHeaderStyle}>
                                <strong>Riepilogo mese {communicationMonth}</strong>
                                <button
                                  type="button"
                                  className="modal-close"
                                  style={compensationCloseStyle}
                                  onClick={closeCompensationPopover}
                                >
                                  ×
                                </button>
                              </div>

                              {compensation ? (
                                <>
                                  <SummaryMoneyRow label="Retribuzione mese" value={compensation.retribuzione} />
                                  <SummaryMoneyRow label="Regali / extra" value={compensation.aggiunte} />
                                  <SummaryMoneyRow label="Crediti precedenti" value={compensation.crediti} />
                                  <SummaryMoneyRow label="Trasporto/macchina" value={compensation.trasporto} />
                                  <SummaryMoneyRow label="Rate/debiti" value={-compensation.rateDebiti} />
                                  <SummaryMoneyRow label="Debiti precedenti" value={-compensation.debitiPrecedenti} />
                                  <SummaryMoneyRow label="Acconti" value={-compensation.acconti} />
                                  <div style={compensationTotalRowStyle}>
                                    <span>Compenso del mese</span>
                                    <strong>{formatCurrency(compensation.totale)}</strong>
                                  </div>
                                </>
                              ) : (
                                <div style={{ color: '#667085', fontSize: 13 }}>
                                  Nessun report salvato per questo dipendente nel mese selezionato.
                                </div>
                              )}

                              <button
                                type="button"
                                className="button"
                                style={{ width: '100%', marginTop: 10 }}
                                onClick={() => handleOpenEmployeeReport(row.employee_id)}
                                disabled={!row.employee_id}
                              >
                                Apri report
                              </button>
                            </div>,
                            document.body
                          ) : null}
                        </div>
                        <div className="communication-note-cell">
                          <textarea
                            rows={2}
                            className="communication-note-input"
                            value={row.detail_note}
                            onChange={(e) => updateDetailRow(index, 'detail_note', e.target.value)}
                            placeholder="Nota libera"
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="panel panel-section">
        <div className="communication-history-head">
          <div>
            <span className="page-kicker" style={{ marginBottom: 8 }}>Storico permanente</span>
            <h2 style={{ margin: 0, fontSize: 24 }}>Comunicazioni salvate</h2>
          </div>
          <span className="soft-chip" style={softInfoStyle}>
            {communicationTotal} documenti archiviati
          </span>
        </div>

        <div className="toolbar" style={{ marginBottom: 16 }}>
          <div className="toolbar-group" style={{ flex: 1 }}>
            <input
              className="search-input"
              placeholder="Cerca per oggetto, azienda, periodo, file..."
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
            />
          </div>
          <div className="toolbar-group">
            <span className="soft-chip" style={softInfoStyle}>
              Pagina {communicationCurrentPage} / {communicationTotalPages}
            </span>
            <button
              type="button"
              className="button-secondary"
              disabled={historyOffset === 0 || loading}
              onClick={() => setHistoryOffset((current) => Math.max(0, current - COMMUNICATION_PAGE_SIZE))}
            >
              Pagina precedente
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={historyOffset + COMMUNICATION_PAGE_SIZE >= communicationTotal || loading}
              onClick={() => setHistoryOffset((current) => current + COMMUNICATION_PAGE_SIZE)}
            >
              Pagina successiva
            </button>
          </div>
        </div>

        {!visibleCommunications.length ? (
          <div className="empty-state">
            Nessuna comunicazione salvata per l'anno {selectedYear}. Compila la tabella e usa "Salva nello storico".
          </div>
        ) : (
          <div className="communication-history-list">
            {visibleCommunications.map((communication) => (
              <details className="communication-history-card" key={communication.id}>
                <summary className="communication-history-summary">
                  <div>
                    <div className="communication-history-title">{communication.title}</div>
                    <div className="communication-history-meta">
                      {communication.company_name || 'GPA versione 1'}
                      {' · '}
                      {formatPeriodLabel(communication.period_start, communication.period_end)}
                      {' · '}
                      Creata il {formatCreatedAt(communication.created_at)}
                    </div>
                  </div>

                  <div className="communication-history-actions">
                    <button
                      type="button"
                      className="button-danger"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDeleteCommunication(communication);
                      }}
                    >
                      Elimina
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        loadHistoryCommunication(communication);
                      }}
                    >
                      Usa come base
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleHistoryOpen(communication.id, 'pdf');
                      }}
                    >
                      Apri PDF
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleHistoryOpen(communication.id, 'excel');
                      }}
                    >
                      Apri Excel
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleHistoryEmail(communication);
                      }}
                    >
                      Email
                    </button>
                  </div>
                </summary>

                <div className="communication-history-body">
                  <div className="communication-history-info">
                    <div>
                      <span className="communication-field-label">Periodo</span>
                      <strong>{formatPeriodLabel(communication.period_start, communication.period_end)}</strong>
                    </div>
                    <div>
                      <span className="communication-field-label">Destinatario</span>
                      <strong>{communication.recipient_email || 'Non impostato'}</strong>
                    </div>
                    <div>
                      <span className="communication-field-label">Creata il</span>
                      <strong>{formatCreatedAt(communication.created_at)}</strong>
                    </div>
                  </div>

                  <div className="communication-table-shell">
                    <table className="table communication-table">
                      <thead>
                        <tr>
                          <th>Nome dipendente</th>
                          <th>{employerOptions[0] ? `${employerOptions[0].short_name} (${employerOptions[0].name})` : 'Datore 1'}</th>
                          {hasSecondEmployer ? <th>{`${employerOptions[1].short_name} (${employerOptions[1].name})`}</th> : null}
                          <th>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(communication.details || []).map((detail) => (
                          <tr key={detail.id}>
                            <td>{detail.employee_label}</td>
                            <td>{detail.giornate_primo}</td>
                            {hasSecondEmployer ? <td>{detail.giornate_secondo}</td> : null}
                            <td>{detail.detail_note || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryMoneyRow({ label, value }) {
  return (
    <div style={compensationSummaryRowStyle}>
      <span>{label}</span>
      <strong>{formatCurrency(value)}</strong>
    </div>
  );
}

const softInfoStyle = {
  background: 'rgba(22, 163, 74, 0.12)',
  color: '#14532d',
  borderColor: 'rgba(22, 101, 52, 0.16)',
};

const compensationCellStyle = {
  position: 'relative',
  minWidth: 150,
  textAlign: 'right',
};

const compensationButtonStyle = {
  width: '100%',
  justifyContent: 'flex-end',
  fontWeight: 900,
  whiteSpace: 'nowrap',
};

const compensationPopoverStyle = {
  position: 'fixed',
  zIndex: 2500,
  width: 300,
  padding: 10,
  borderRadius: 16,
  border: '1px solid rgba(20, 33, 61, 0.12)',
  background: '#fff',
  boxShadow: '0 18px 48px rgba(20, 33, 61, 0.22)',
  textAlign: 'left',
  overflow: 'visible',
};

const compensationPopoverHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  marginBottom: 8,
};

const compensationCloseStyle = {
  width: 26,
  height: 26,
  minHeight: 0,
  borderRadius: 8,
};

const compensationSummaryRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  padding: '4px 0',
  fontSize: 13,
  borderBottom: '1px solid rgba(20, 33, 61, 0.06)',
};

const compensationTotalRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  marginTop: 8,
  paddingTop: 8,
  borderTop: '1px solid rgba(20, 33, 61, 0.14)',
  fontSize: 14,
};

const recipientRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 8,
  alignItems: 'center',
};

const addressBookPanelStyle = {
  marginTop: 14,
  display: 'grid',
  gap: 12,
  padding: 14,
  borderRadius: 16,
  border: '1px solid rgba(20, 33, 61, 0.08)',
  background: 'rgba(248, 250, 252, 0.96)',
};

const addressBookHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  alignItems: 'center',
  flexWrap: 'wrap',
};

const addressBookFormStyle = {
  display: 'grid',
  gap: 10,
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
};

const addressBookListStyle = {
  display: 'grid',
  gap: 10,
};

const addressBookItemStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 12,
  alignItems: 'center',
  padding: 12,
  borderRadius: 14,
  border: '1px solid rgba(20, 33, 61, 0.08)',
  background: '#fff',
};

const pdfSelectionPanelStyle = {
  display: 'grid',
  gap: 12,
  marginBottom: 16,
  padding: 14,
  borderRadius: 16,
  border: '1px solid rgba(20, 33, 61, 0.08)',
  background: 'rgba(248, 250, 252, 0.9)',
};

const pdfSelectionHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center',
  flexWrap: 'wrap',
};

