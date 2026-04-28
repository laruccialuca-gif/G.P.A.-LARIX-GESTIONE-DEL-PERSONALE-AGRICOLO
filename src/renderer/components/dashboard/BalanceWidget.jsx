import React from 'react';
import FilterPills from './FilterPills';
import { getBalanceVisualState } from '../../utils/dashboard';

const FILTERS = [
  { value: 'nonzero', label: 'Saldo non zero' },
  { value: 'all', label: 'Tutti' },
];

function money(value) {
  return `€ ${Number(value || 0).toFixed(2)}`;
}

export default function BalanceWidget({
  rows,
  filter,
  onFilterChange,
}) {
  return (
    <section className="panel panel-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22 }}>Situazione Debiti/Crediti</h2>
          <p style={{ margin: '6px 0 0', color: '#667085' }}>
            Saldo aperto per dipendente, con distinzione immediata tra credito e debito.
          </p>
        </div>
        <FilterPills options={FILTERS} value={filter} onChange={onFilterChange} />
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">Nessun saldo aperto.</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((row) => {
            const state = getBalanceVisualState(row.finalBalance);
            const saldoColor =
              state === 'credit' ? '#047857' :
              state === 'debit' ? '#b91c1c' :
              '#314762';

            return (
              <div key={row.employeeId} className="dashboard-balance-row">
                <div>
                  <div style={{ fontWeight: 800 }}>{row.employeeName}</div>
                  <div style={{ color: '#667085', fontSize: 13 }}>
                    Credito {money(row.totalCredit)} · Debito {money(row.totalDebit)}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: '#667085', marginBottom: 4 }}>Saldo finale</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: saldoColor }}>
                    {money(row.finalBalance)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
