import React, { useEffect, useMemo, useState } from 'react';
import BalanceWidget from '../components/dashboard/BalanceWidget';
import ExpiryWidget from '../components/dashboard/ExpiryWidget';
import {
  buildBalanceRows,
  buildMedicalExpiries,
  buildTrainingExpiries,
  filterBalanceRows,
  filterExpiryItems,
  formatTodayLabel,
} from '../utils/dashboard';
import { dispatchRouteReady } from '../utils/navigationPerf';

function StatusBadge({ status }) {
  const styles = {
    presente: { background: '#d1fae5', color: '#065f46' },
    assente: { background: '#fee2e2', color: '#991b1b' },
    ferie: { background: '#dbeafe', color: '#1d4ed8' },
    malattia: { background: '#fef3c7', color: '#92400e' },
    permesso: { background: '#ede9fe', color: '#6d28d9' },
    infortunio: { background: '#fed7aa', color: '#9a3412' },
    riposo: { background: '#e5e7eb', color: '#374151' },
  };

  const style = styles[status] || styles.riposo;

  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'capitalize',
        ...style,
      }}
    >
      {status}
    </span>
  );
}

function StatCard({ title, value }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{title}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState({
    employees: [],
    todayAttendance: [],
    payrollBalances: [],
  });
  const [loading, setLoading] = useState(true);
  const [medicalFilter, setMedicalFilter] = useState('30days');
  const [trainingFilter, setTrainingFilter] = useState('30days');
  const [balanceFilter, setBalanceFilter] = useState('nonzero');

  async function loadData() {
    setLoading(true);
    try {
      const data = await window.api.dashboard.summary();
      setSummary(data || { employees: [], todayAttendance: [], payrollBalances: [] });
    } catch (err) {
      console.error(err);
      alert('Errore caricamento dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!loading) {
      dispatchRouteReady('/');
    }
  }, [loading]);

  const employees = summary.employees || [];
  const todayAttendance = summary.todayAttendance || [];
  const payrollBalances = summary.payrollBalances || [];

  const medicalExpiries = useMemo(() => buildMedicalExpiries(employees), [employees]);
  const trainingExpiries = useMemo(() => buildTrainingExpiries(employees), [employees]);
  const balanceRows = useMemo(() => buildBalanceRows(payrollBalances), [payrollBalances]);

  const filteredMedicalExpiries = useMemo(
    () => filterExpiryItems(medicalExpiries, medicalFilter),
    [medicalExpiries, medicalFilter]
  );
  const filteredTrainingExpiries = useMemo(
    () => filterExpiryItems(trainingExpiries, trainingFilter),
    [trainingExpiries, trainingFilter]
  );
  const filteredBalanceRows = useMemo(
    () => filterBalanceRows(balanceRows, balanceFilter),
    [balanceRows, balanceFilter]
  );

  const activeEmployees = employees.filter((employee) => employee.status !== 'inattivo');
  const presentToday = todayAttendance.filter((item) => item.status === 'presente').length;
  const absentToday = todayAttendance.filter((item) =>
    ['assente', 'malattia', 'infortunio'].includes(item.status)
  ).length;
  const totalHoursToday = todayAttendance.reduce(
    (sum, item) => sum + Number(item.hours_worked || 0) + Number(item.overtime_hours || 0),
    0
  );

  return (
    <div className="page">
      <div className="page-sticky-stack">
        <section className="page-hero">
          <div>
            <span className="page-kicker">Panoramica operativa</span>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>
              {formatTodayLabel(new Date())}
            </p>
          </div>
        </section>
      </div>

      <div className="stats-grid">
        <StatCard title="Dipendenti attivi" value={loading ? '...' : activeEmployees.length} />
        <StatCard title="Presenti oggi" value={loading ? '...' : presentToday} />
        <StatCard title="Assenti oggi" value={loading ? '...' : absentToday} />
        <StatCard
          title="Ore totali oggi"
          value={loading ? '...' : Number.isInteger(totalHoursToday) ? totalHoursToday : totalHoursToday.toFixed(1)}
        />
      </div>

      <div className="dashboard-grid">
        <ExpiryWidget
          title="Visite Mediche in Scadenza"
          subtitle="Priorita alle visite gia scadute o in scadenza ravvicinata."
          items={loading ? [] : filteredMedicalExpiries}
          filter={medicalFilter}
          onFilterChange={setMedicalFilter}
          emptyMessage="Nessuna scadenza imminente per le visite mediche."
        />

        <ExpiryWidget
          title="Formazione in Scadenza"
          subtitle="Corsi e abilitazioni ordinati dalle scadenze piu vicine."
          items={loading ? [] : filteredTrainingExpiries}
          filter={trainingFilter}
          onFilterChange={setTrainingFilter}
          emptyMessage="Nessuna scadenza imminente per la formazione."
        />
      </div>

      <BalanceWidget
        rows={loading ? [] : filteredBalanceRows}
        filter={balanceFilter}
        onFilterChange={setBalanceFilter}
      />

      <div className="panel panel-section">
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Presenze di oggi</h2>

        {loading ? (
          <p>Caricamento...</p>
        ) : todayAttendance.length === 0 ? (
          <p style={{ color: '#6b7280' }}>
            Nessuna presenza registrata per oggi. Vai nella sezione Presenze.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {todayAttendance.map((att, index) => {
              const employee = employees.find((item) => String(item.id) === String(att.employee_id));
              const initials = employee
                ? `${employee.first_name?.[0] || ''}${employee.last_name?.[0] || ''}`
                : '?';

              return (
                <div
                  key={att.id || `${att.employee_id}_${att.date}_${index}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 0',
                    borderTop: index === 0 ? 'none' : '1px solid #f3f4f6',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        background: '#eef2ff',
                        color: '#4338ca',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 'bold',
                      }}
                    >
                      {initials}
                    </div>

                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {employee ? `${employee.first_name} ${employee.last_name}` : 'Sconosciuto'}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {employee?.role || '-'}
                        {' · '}
                        {Number(att.hours_worked || 0)} h
                      </div>
                    </div>
                  </div>

                  <StatusBadge status={att.status} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
