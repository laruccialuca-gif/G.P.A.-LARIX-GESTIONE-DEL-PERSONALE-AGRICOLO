import React from 'react';
import { getReportLayoutVersion } from '../config/reportLayouts';

// Mini preview HTML di una versione di stampa. Rende lo schema generale
// (header, griglia settimane, riepilogo economico) in scala ridotta, in B/N
// quando la palette del layout e' "mono". Usata in Impostazioni -> Report/PDF.

const cardStyle = {
  border: '1px solid #d0d5dd',
  borderRadius: 8,
  padding: 12,
  background: '#ffffff',
  fontSize: 9,
  color: '#1f2937',
  lineHeight: 1.25,
  width: '100%',
  maxWidth: 360,
};

const monoTitleStyle = {
  fontSize: 10,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: '#111827',
};

const monoSubtitleStyle = {
  fontSize: 8,
  color: '#4b5563',
};

const sectionBoxStyle = {
  border: '1px solid #d0d5dd',
  borderRadius: 4,
  padding: 6,
  marginTop: 6,
  background: '#fafafa',
};

const sectionTitleStyle = {
  fontSize: 8,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: '#374151',
  marginBottom: 4,
};

const summaryRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 4,
  marginTop: 6,
};

const summaryCardStyle = {
  border: '1px solid #d0d5dd',
  borderRadius: 4,
  padding: '4px 6px',
  background: '#ffffff',
  textAlign: 'center',
};

const weekHeaderStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 2,
  marginTop: 4,
  fontWeight: 700,
  fontSize: 7,
  color: '#374151',
  textAlign: 'center',
};

const weekRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 2,
  marginTop: 2,
};

const dayCellStyle = {
  border: '1px solid #e5e7eb',
  height: 12,
  borderRadius: 2,
  background: '#ffffff',
};

const econRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 8,
  marginTop: 2,
};

const totalRowStyle = {
  ...econRowStyle,
  fontWeight: 800,
  borderTop: '1px solid #111827',
  marginTop: 4,
  paddingTop: 3,
};

const featureBadgeStyle = {
  display: 'inline-block',
  border: '1px solid #d0d5dd',
  borderRadius: 999,
  padding: '1px 6px',
  fontSize: 8,
  marginRight: 4,
  marginTop: 4,
  color: '#374151',
  background: '#f9fafb',
};

function MiniLayoutV1() {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <div>
          <div style={monoTitleStyle}>Mario Rossi</div>
          <div style={monoSubtitleStyle}>Operaio · Gennaio 2026</div>
        </div>
        <div
          style={{
            border: '1px solid #111827',
            padding: '2px 6px',
            borderRadius: 4,
            fontSize: 7,
            fontWeight: 800,
            letterSpacing: 0.6,
          }}
        >
          PAGATO
        </div>
      </div>

      <div style={summaryRowStyle}>
        <div style={summaryCardStyle}>
          <div style={{ fontSize: 7, color: '#6b7280' }}>Giorni</div>
          <div style={{ fontSize: 11, fontWeight: 800 }}>22</div>
        </div>
        <div style={summaryCardStyle}>
          <div style={{ fontSize: 7, color: '#6b7280' }}>Ore</div>
          <div style={{ fontSize: 11, fontWeight: 800 }}>154</div>
        </div>
        <div style={summaryCardStyle}>
          <div style={{ fontSize: 7, color: '#6b7280' }}>Totale</div>
          <div style={{ fontSize: 11, fontWeight: 800 }}>€ 1.540</div>
        </div>
      </div>

      <div style={sectionBoxStyle}>
        <div style={sectionTitleStyle}>Presenze settimanali</div>
        <div style={weekHeaderStyle}>
          <div>L</div><div>M</div><div>M</div><div>G</div><div>V</div><div>S</div><div>D</div>
        </div>
        {[0, 1, 2, 3].map((row) => (
          <div key={`mini-week-${row}`} style={weekRowStyle}>
            {[0, 1, 2, 3, 4, 5, 6].map((col) => (
              <div key={`mini-cell-${row}-${col}`} style={dayCellStyle} />
            ))}
          </div>
        ))}
      </div>

      <div style={sectionBoxStyle}>
        <div style={sectionTitleStyle}>Riepilogo economico</div>
        <div style={econRowStyle}><span>Retribuzione calcolata</span><span>€ 1.540,00</span></div>
        <div style={econRowStyle}><span>Trasporto</span><span>€ 80,00</span></div>
        <div style={econRowStyle}><span>Acconti</span><span>− € 200,00</span></div>
        <div style={econRowStyle}><span>Busta paga</span><span>− € 1.200,00</span></div>
        <div style={totalRowStyle}><span>Differenza</span><span>€ 220,00</span></div>
      </div>
    </div>
  );
}

const MINI_LAYOUTS = {
  v1: MiniLayoutV1,
};

export default function ReportLayoutPreview({ versionId }) {
  const version = getReportLayoutVersion(versionId);
  const MiniLayout = MINI_LAYOUTS[version.id];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{version.label}</div>
        <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>{version.description}</div>
        <div>
          {(version.features || []).map((feature) => (
            <span key={feature} style={featureBadgeStyle}>{feature}</span>
          ))}
          <span style={featureBadgeStyle}>
            {version.palette === 'mono' ? 'Stile B/N' : 'Stile a colori'}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
        {MiniLayout ? (
          <MiniLayout />
        ) : (
          <div style={{ ...cardStyle, color: '#6b7280' }}>
            Anteprima non ancora disponibile per questa versione.
          </div>
        )}
      </div>
    </div>
  );
}
