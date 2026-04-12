import { useState } from 'react';

// ── ScoreRing ─────────────────────────────────────────────────────────────────
export function ScoreRing({ score, label, size = 72 }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const pct = score != null ? Math.max(0, Math.min(100, score)) : null;
  const filled = pct != null ? (pct / 100) * circ : 0;
  const color = pct == null ? '#2a2a2a'
    : pct >= 75 ? '#00c853'
    : pct >= 55 ? '#ff9100'
    : pct >= 40 ? '#ff6d00' : '#ff1744';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a1a1a" strokeWidth={8} />
        {pct != null && (
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={color} strokeWidth={8}
            strokeDasharray={`${filled} ${circ - filled}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dasharray 0.8s ease' }}
          />
        )}
        <text
          x={size / 2} y={size / 2 + 5}
          textAnchor="middle"
          fill={color} fontSize={13} fontWeight="700"
          fontFamily="Inter, sans-serif"
        >
          {pct != null ? pct : '—'}
        </text>
      </svg>
      <div style={{ fontSize: 10, color: '#555', textAlign: 'center', lineHeight: 1.2, maxWidth: size + 10 }}>
        {label}
      </div>
    </div>
  );
}

// ── BigScoreRing ──────────────────────────────────────────────────────────────
export function BigScoreRing({ score, grade }) {
  const size = 150;
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score || 0));
  const filled = (pct / 100) * circ;
  const color = pct >= 75 ? '#00c853' : pct >= 55 ? '#ff9100' : pct >= 40 ? '#ff6d00' : '#ff1744';
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a1a1a" strokeWidth={14} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={14}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 1s ease' }}
      />
      <text x={size / 2} y={size / 2 - 8} textAnchor="middle" fill={color}
        fontSize={34} fontWeight="900" fontFamily="Inter, sans-serif">
        {grade || '?'}
      </text>
      <text x={size / 2} y={size / 2 + 18} textAnchor="middle" fill="#666"
        fontSize={13} fontFamily="Inter, sans-serif">
        {score}/100
      </text>
    </svg>
  );
}

// ── SkeletonCard ──────────────────────────────────────────────────────────────
export function SkeletonCard({ lines = 4 }) {
  return (
    <div className="chart-card">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="skeleton-line" style={{ width: `${95 - i * 12}%`, height: i === 0 ? 20 : 14 }} />
        ))}
      </div>
    </div>
  );
}

// ── AiRunPrompt ───────────────────────────────────────────────────────────────
export function AiRunPrompt({ onRun, loading, noAI, onUpgrade, tabLabel }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '60px 20px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 44, marginBottom: 14 }}>🧠</div>
      <h3 style={{ fontSize: 17, fontWeight: 800, color: '#e0e0e0', marginBottom: 8 }}>
        {tabLabel} — AI Analysis Pending
      </h3>
      <p style={{ fontSize: 13, color: '#555', maxWidth: 380, marginBottom: 24, lineHeight: 1.7 }}>
        Click "Run Deep Analysis" to unlock insights for all 5 AI dimensions in one single call.
      </p>
      {noAI ? (
        <button
          onClick={onUpgrade}
          style={{
            background: 'linear-gradient(135deg, #7c4dff, #651fff)',
            border: 'none', borderRadius: 8, padding: '11px 26px',
            fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer',
          }}
        >
          ⬆ Upgrade to Unlock
        </button>
      ) : (
        <button
          onClick={onRun}
          disabled={loading}
          className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: loading ? 0.6 : 1 }}
        >
          {loading && <span className="btn-spinner" />}
          🧠 Run Deep Analysis
        </button>
      )}
    </div>
  );
}

// ── GradeCircle ───────────────────────────────────────────────────────────────
export function GradeCircle({ grade, score }) {
  const color = score >= 75 ? '#00c853' : score >= 55 ? '#ff9100' : score >= 40 ? '#ff6d00' : '#ff1744';
  return (
    <div className="grade-circle" style={{ borderColor: color }}>
      <div className="grade-letter" style={{ color }}>{grade}</div>
      <div className="grade-score" style={{ color }}>{score}/100</div>
    </div>
  );
}

// ── InsightItem ───────────────────────────────────────────────────────────────
export function InsightItem({ item }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="insight-item" onClick={() => setOpen(o => !o)}>
      <div className="insight-header">
        <span className="insight-icon">{item.icon}</span>
        <div className="insight-content">
          <div className="insight-category">{item.category}</div>
          <div className="insight-title">{item.title}</div>
        </div>
        <span className="insight-chevron">{open ? '▲' : '▼'}</span>
      </div>
      {open && <div className="insight-detail">{item.detail}</div>}
    </div>
  );
}

// ── ChartTooltip ──────────────────────────────────────────────────────────────
export const ChartTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-label">{label}</div>
        {payload.map(p => (
          <div key={p.name} className="chart-tooltip-row">
            <span style={{ color: p.fill || p.color }}>{p.name}:</span>
            <span>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};
