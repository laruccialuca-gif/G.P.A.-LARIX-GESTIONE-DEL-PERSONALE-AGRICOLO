import React from 'react';
import FilterPills from './FilterPills';
import { formatDaysLeft } from '../../utils/dashboard';

const FILTERS = [
  { value: '30days', label: 'Entro 30 giorni' },
  { value: 'expired', label: 'Scadute' },
  { value: 'all', label: 'Tutte' },
];

function stateStyles(state) {
  if (state === 'expired') {
    return { background: '#fee2e2', color: '#b91c1c', borderColor: '#fecaca', label: 'Scaduta' };
  }
  if (state === 'warning') {
    return { background: '#fef3c7', color: '#92400e', borderColor: '#fde68a', label: 'In scadenza' };
  }
  return { background: '#dcfce7', color: '#166534', borderColor: '#bbf7d0', label: 'Regolare' };
}

export default function ExpiryWidget({
  title,
  subtitle,
  items,
  filter,
  onFilterChange,
  emptyMessage,
}) {
  return (
    <section className="panel panel-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2>
          <p style={{ margin: '6px 0 0', color: '#667085' }}>{subtitle}</p>
        </div>
        <FilterPills options={FILTERS} value={filter} onChange={onFilterChange} />
      </div>

      {items.length === 0 ? (
        <div className="empty-state">{emptyMessage}</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((item) => {
            const styles = stateStyles(item.state);

            return (
              <div key={`${item.employeeId}_${item.label}_${item.expiry}`} className="dashboard-list-row">
                <div>
                  <div style={{ fontWeight: 800 }}>{item.employeeName}</div>
                  <div style={{ color: '#667085', fontSize: 13 }}>{item.label}</div>
                </div>

                <div style={{ display: 'grid', gap: 2, textAlign: 'right' }}>
                  <div style={{ fontWeight: 700 }}>{item.expiry}</div>
                  <div style={{ color: '#667085', fontSize: 13 }}>{formatDaysLeft(item.daysLeft)}</div>
                </div>

                <span
                  className="soft-chip"
                  style={{
                    background: styles.background,
                    color: styles.color,
                    borderColor: styles.borderColor,
                    justifySelf: 'end',
                  }}
                >
                  {styles.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
