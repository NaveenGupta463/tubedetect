import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from '../tokens';

const API = import.meta.env.VITE_SCORING_URL ?? 'http://localhost:3002';

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractVideoId(raw) {
  const s = (raw ?? '').trim();
  const m1 = s.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
  if (m1) return m1[1];
  const m2 = s.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
  if (m2) return m2[1];
  if (/^[a-zA-Z0-9_-]{6,64}$/.test(s)) return s;
  return null;
}

function derivePrimaryProblem(r) {
  if (!r) return 'none';
  if ((r.packaging_risk_score ?? 0) >= 70) return 'packaging';
  if (r.trajectory_status === 'stalled' || r.trajectory_status === 'declining') return 'trajectory';
  if ((r.audience_response_score ?? 100) < 30) return 'audience_response';
  if ((r.expected_performance_score ?? 100) < 30) return 'underperformance';
  return 'none';
}

function fmt(n, decimals = 1) {
  if (n == null) return '—';
  return typeof n === 'number' ? n.toFixed(decimals) : String(n);
}

function windowColor(w) {
  if (w === 'launch_rescue') return T.danger;
  if (w === 'active_fix')    return '#FF9D42';
  if (w === 'recovery')      return T.warning;
  if (w === 'follow_up')     return T.accent;
  if (w === 'viral_decode')  return T.success;
  return T.muted;
}

function windowLabel(w) {
  const MAP = {
    launch_rescue: 'Launch Rescue',
    active_fix:    'Active Fix',
    recovery:      'Recovery',
    follow_up:     'Follow-Up',
    learning:      'Learning',
    viral_decode:  'Viral — Decode Only',
    unknown:       'Unknown',
  };
  return MAP[w] ?? w;
}

function windowAdvice(w, doNotTouch) {
  if (doNotTouch) return 'Video is performing well — observe, do not change.';
  if (w === 'launch_rescue') return 'Act within 24 h — thumbnail and title changes have maximum impact right now.';
  if (w === 'active_fix')    return 'Act within 48 h — packaging updates can still rescue the launch window.';
  if (w === 'recovery')      return 'Recovery window — a packaging refresh may still recover reach.';
  if (w === 'follow_up')     return 'Too late for major recovery — extract learning for the next video.';
  if (w === 'learning')      return 'Video is aged — document what worked and what did not.';
  if (w === 'viral_decode')  return 'Video is outperforming. Decode why — replicate the format.';
  return 'Analyse and learn.';
}

function riskColor(r) {
  if (r === 'low')    return T.success;
  if (r === 'medium') return T.warning;
  if (r === 'high')   return T.danger;
  return T.muted;
}

function timeSensitivityColor(ts) {
  if (ts === 'hours') return T.danger;
  if (ts === 'days')  return T.warning;
  return T.muted;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScoreBar({ label, value, color }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: '0.68rem', color: T.muted, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: '0.82rem', fontWeight: 800, color }}>{pct}</span>
      </div>
      <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease }}
          style={{ height: '100%', borderRadius: 99, background: color }}
        />
      </div>
    </div>
  );
}

function Badge({ label, color }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 99,
      fontSize: '0.63rem', fontWeight: 700, letterSpacing: '0.04em',
      background: `${color}18`, border: `1px solid ${color}44`, color,
    }}>
      {label}
    </span>
  );
}

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ ...T.glassSurface, borderRadius: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
          color: T.text,
        }}
      >
        <span style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</span>
        <span style={{ fontSize: '0.7rem', color: T.muted, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease }}
          >
            <div style={{ padding: '0 16px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TitleRecommendation({ rec }) {
  const risk = rec.risk ?? 'medium';
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10,
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${riskColor(risk)}28`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: T.text, lineHeight: 1.35 }}>
          {rec.title}
        </span>
        <Badge label={risk} color={riskColor(risk)} />
      </div>
      <p style={{ fontSize: '0.72rem', color: T.muted, margin: 0, lineHeight: 1.5 }}>{rec.why}</p>
    </div>
  );
}

function ThumbnailRecommendation({ rec }) {
  const risk = rec.risk ?? 'medium';
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10,
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${riskColor(risk)}28`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: '0.83rem', fontWeight: 600, color: T.text, lineHeight: 1.35 }}>
          {rec.concept}
        </span>
        <Badge label={risk} color={riskColor(risk)} />
      </div>
      <p style={{ fontSize: '0.72rem', color: T.muted, margin: 0, lineHeight: 1.5 }}>{rec.why}</p>
    </div>
  );
}

function FixPlanItem({ item, idx }) {
  const ts = item.time_sensitivity ?? 'none';
  const col = timeSensitivityColor(ts);
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '10px 0',
      borderBottom: idx > 0 ? `1px solid rgba(255,255,255,0.06)` : 'none',
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
        background: `${col}18`, border: `1px solid ${col}44`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.6rem', fontWeight: 800, color: col,
      }}>
        {idx + 1}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: T.text }}>{item.action}</span>
          <Badge label={ts} color={col} />
        </div>
        <p style={{ fontSize: '0.72rem', color: T.muted, margin: 0, lineHeight: 1.5 }}>{item.reason}</p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function VideoRepair() {
  const [urlInput,           setUrlInput]           = useState('');
  const [contentDesc,        setContentDesc]        = useState('');
  const [thumbDesc,          setThumbDesc]          = useState('');
  const [showExtra,          setShowExtra]          = useState(false);

  const [status,   setStatus]   = useState('idle');   // idle | loading | ready | error | no_snapshots
  const [repair,   setRepair]   = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const [aiStatus,  setAiStatus]  = useState('idle'); // idle | loading | ready | error
  const [aiResult,  setAiResult]  = useState(null);
  const [aiError,   setAiError]   = useState('');

  const videoId = extractVideoId(urlInput);

  async function runAnalysis() {
    const vid = extractVideoId(urlInput);
    if (!vid) { setErrorMsg('Enter a valid YouTube URL or video ID.'); setStatus('error'); return; }

    setStatus('loading');
    setRepair(null);
    setAiResult(null);
    setAiStatus('idle');
    setErrorMsg('');

    try {
      const res  = await fetch(`${API}/api/repair/${encodeURIComponent(vid)}`);
      const data = await res.json();

      if (data.error === 'video_not_found') { setStatus('error'); setErrorMsg('Video not found in the database.'); return; }
      if (data.error)                        { setStatus('error'); setErrorMsg(data.error); return; }

      const buckets = data.evidence?.trajectory?.buckets_available ?? [];
      if (buckets.length === 0) { setRepair(data); setStatus('no_snapshots'); return; }

      setRepair(data);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
      setErrorMsg('Could not reach the scoring server. Is it running on port 3002?');
    }
  }

  async function runAi() {
    if (!repair) return;
    const vid = extractVideoId(urlInput);
    if (!vid) return;

    setAiStatus('loading');
    setAiError('');
    setAiResult(null);

    try {
      const res = await fetch(`${API}/api/repair/${encodeURIComponent(vid)}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:              repair.evidence?.trajectory?.latest_bucket ?? '',
          contentDescription: contentDesc || undefined,
          thumbnailDescription: thumbDesc || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) { setAiStatus('error'); setAiError(data.error); return; }
      setAiResult(data);
      setAiStatus('ready');
    } catch (e) {
      setAiStatus('error');
      setAiError('AI call failed — check server logs.');
    }
  }

  const primaryProblem = derivePrimaryProblem(repair);
  const wColor         = repair ? windowColor(repair.repair_window) : T.muted;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 80px' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: T.text, margin: '0 0 4px', letterSpacing: '-0.03em' }}>
          Video Repair
        </h1>
        <p style={{ fontSize: '0.78rem', color: T.muted, margin: 0 }}>
          Diagnose why a posted video underperformed and get a data-backed fix plan.
        </p>
      </div>

      {/* Input card */}
      <div style={{ ...T.glassCard, borderRadius: 14, padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runAnalysis()}
            placeholder="YouTube URL or video ID  (e.g. dQw4w9WgXcQ)"
            style={{
              flex: 1, background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${T.border}`, borderRadius: 9,
              padding: '9px 13px', color: T.text,
              fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => { e.target.style.borderColor = T.accentBorder; }}
            onBlur={e =>  { e.target.style.borderColor = T.border; }}
          />
          <motion.button
            onClick={runAnalysis}
            disabled={status === 'loading'}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            style={{
              padding: '9px 20px', borderRadius: 9,
              background: status === 'loading' ? 'rgba(157,111,255,0.25)' : 'linear-gradient(135deg, #7C3AED, #4F46E5)',
              border: 'none', color: '#fff',
              fontSize: '0.82rem', fontWeight: 700, cursor: status === 'loading' ? 'default' : 'pointer',
              letterSpacing: '-0.01em', whiteSpace: 'nowrap',
            }}
          >
            {status === 'loading' ? 'Analysing…' : 'Analyse'}
          </motion.button>
        </div>

        {/* Optional fields toggle */}
        <button
          onClick={() => setShowExtra(o => !o)}
          style={{
            marginTop: 10, background: 'none', border: 'none', cursor: 'pointer',
            color: T.muted, fontSize: '0.72rem', padding: '2px 0', display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <span style={{ transform: showExtra ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
          {showExtra ? 'Hide' : 'Add'} content &amp; thumbnail description (improves AI advice)
        </button>

        <AnimatePresence initial={false}>
          {showExtra && (
            <motion.div
              key="extra"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                <textarea
                  value={contentDesc}
                  onChange={e => setContentDesc(e.target.value)}
                  placeholder="Content description — what the video is about, key talking points"
                  rows={2}
                  style={{
                    background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`,
                    borderRadius: 8, padding: '8px 12px', color: T.text,
                    fontSize: '0.8rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                  }}
                />
                <textarea
                  value={thumbDesc}
                  onChange={e => setThumbDesc(e.target.value)}
                  placeholder="Thumbnail description — what is shown, text overlay, color scheme"
                  rows={2}
                  style={{
                    background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`,
                    borderRadius: 8, padding: '8px 12px', color: T.text,
                    fontSize: '0.8rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                  }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── States ─────────────────────────────────────────────────────────── */}

      {status === 'error' && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease }}
          style={{
            padding: '14px 16px', borderRadius: 10,
            background: T.dangerDim, border: `1px solid ${T.danger}44`,
            fontSize: '0.82rem', color: T.danger,
          }}
        >
          {errorMsg}
        </motion.div>
      )}

      {status === 'no_snapshots' && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease }}
          style={{
            padding: '16px', borderRadius: 10,
            background: T.warningDim, border: `1px solid ${T.warning}44`,
          }}
        >
          <p style={{ fontSize: '0.85rem', fontWeight: 700, color: T.warning, margin: '0 0 4px' }}>
            No growth snapshots yet
          </p>
          <p style={{ fontSize: '0.75rem', color: T.muted, margin: 0 }}>
            The video is in the database but no hourly snapshots have been collected yet.
            Snapshots are taken automatically — check back after the next snapshot run.
          </p>
        </motion.div>
      )}

      {(status === 'ready' || status === 'no_snapshots') && repair && (
        <AnimatePresence>
          <motion.div
            key="repair-panel"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >

            {/* ── Status header ───────────────────────────────────────────── */}
            <div style={{ ...T.glassCard, borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                <Badge label={windowLabel(repair.repair_window)} color={wColor} />
                {repair.age_hours != null && (
                  <span style={{ fontSize: '0.7rem', color: T.muted }}>
                    {repair.age_hours < 24
                      ? `${repair.age_hours}h old`
                      : `${Math.round(repair.age_hours / 24)}d old`}
                  </span>
                )}
                {repair.do_not_touch && (
                  <Badge label="Do Not Touch" color={T.success} />
                )}
                {primaryProblem !== 'none' && !repair.do_not_touch && (
                  <Badge label={`Problem: ${primaryProblem.replace(/_/g, ' ')}`} color={T.danger} />
                )}
                {repair._cached && (
                  <span style={{ fontSize: '0.63rem', color: T.subtle }}>cached</span>
                )}
              </div>
              <p style={{ fontSize: '0.78rem', color: T.muted, margin: 0, lineHeight: 1.5 }}>
                {windowAdvice(repair.repair_window, repair.do_not_touch)}
              </p>
            </div>

            {/* ── Score cards ─────────────────────────────────────────────── */}
            {status === 'ready' && (
              <div style={{ ...T.glassCard, borderRadius: 14, padding: '16px 18px' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: T.subtle, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
                  Scores
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 24px' }}>
                  <ScoreBar label="Trajectory"           value={repair.trajectory_score}            color={repair.trajectory_score >= 60 ? T.success : repair.trajectory_score >= 35 ? T.warning : T.danger} />
                  <ScoreBar label="Expected Performance" value={repair.expected_performance_score}  color={repair.expected_performance_score >= 60 ? T.success : repair.expected_performance_score >= 35 ? T.warning : T.danger} />
                  <ScoreBar label="Audience Response"    value={repair.audience_response_score}     color={repair.audience_response_score >= 60 ? T.success : repair.audience_response_score >= 35 ? T.warning : T.danger} />
                  <ScoreBar label="Packaging Risk"       value={repair.packaging_risk_score}        color={repair.packaging_risk_score >= 60 ? T.danger : repair.packaging_risk_score >= 35 ? T.warning : T.success} />
                  <ScoreBar label="Fixability"           value={repair.fixability_score}            color={repair.fixability_score >= 50 ? T.success : repair.fixability_score >= 25 ? T.warning : T.muted} />
                  <ScoreBar label="Urgency"              value={repair.urgency_score}               color={repair.urgency_score >= 70 ? T.danger : repair.urgency_score >= 40 ? T.warning : T.muted} />
                </div>
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid rgba(255,255,255,0.06)` }}>
                  <span style={{ fontSize: '0.7rem', color: T.muted }}>
                    Trajectory: <strong style={{ color: T.text }}>{repair.trajectory_status}</strong>
                  </span>
                </div>
              </div>
            )}

            {/* ── Evidence ─────────────────────────────────────────────────── */}
            {status === 'ready' && repair.evidence?.trajectory && (
              <Section title="Evidence" defaultOpen={false}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px 20px', paddingTop: 12 }}>
                  {[
                    ['Buckets available', (repair.evidence.trajectory.buckets_available ?? []).join(', ') || '—'],
                    ['Latest bucket',     repair.evidence.trajectory.latest_bucket ?? '—'],
                    ['Latest VPH',        fmt(repair.evidence.trajectory.latest_vph, 2)],
                    ['Slope (VPH/day)',   fmt(repair.evidence.trajectory.slope ?? null, 4)],
                    ['Latest accel',      fmt(repair.evidence.trajectory.latest_accel, 4)],
                    ['Snapshots',         repair.evidence.trajectory.snapshot_count ?? '—'],
                    ['Actual VPH',        fmt(repair.evidence.expected_performance?.actual_vph, 2)],
                    ['Median VPH',        fmt(repair.evidence.expected_performance?.benchmark_context?.median_vph ?? repair.benchmark_context?.median_vph, 2)],
                    ['Benchmark niche',   repair.benchmark_context?.niche ?? repair.evidence.expected_performance?.benchmark_context?.niche ?? '—'],
                    ['Age hours',         repair.age_hours != null ? `${repair.age_hours} h` : '—'],
                    ['VSR ratio',         fmt(repair.evidence.packaging_risk?.vsr_ratio, 3)],
                    ['VSR trend',         fmt(repair.evidence.packaging_risk?.vsr_trend, 3)],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: '0.63rem', color: T.subtle, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</span>
                      <span style={{ fontSize: '0.78rem', color: T.text, fontWeight: 500 }}>{String(v)}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── AI Recommendations ───────────────────────────────────────── */}
            <div style={{ ...T.glassCard, borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: aiResult ? 16 : 0 }}>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: T.text, marginBottom: 2 }}>AI Repair Recommendations</div>
                  {!aiResult && (
                    <div style={{ fontSize: '0.7rem', color: T.muted }}>Claude analyses the repair context and suggests specific fixes.</div>
                  )}
                </div>
                {aiStatus !== 'ready' && (
                  <motion.button
                    onClick={runAi}
                    disabled={aiStatus === 'loading'}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    style={{
                      padding: '8px 16px', borderRadius: 8,
                      background: aiStatus === 'loading'
                        ? 'rgba(157,111,255,0.18)'
                        : T.accentGlow,
                      border: `1px solid ${T.accentBorder}`,
                      color: T.accent, fontSize: '0.78rem', fontWeight: 700,
                      cursor: aiStatus === 'loading' ? 'default' : 'pointer',
                      letterSpacing: '-0.01em', whiteSpace: 'nowrap', flexShrink: 0,
                    }}
                  >
                    {aiStatus === 'loading' ? 'Generating…' : 'Generate recommendations'}
                  </motion.button>
                )}
              </div>

              {aiStatus === 'error' && (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: T.dangerDim, border: `1px solid ${T.danger}44`, fontSize: '0.78rem', color: T.danger, marginTop: 12 }}>
                  {aiError}
                </div>
              )}

              {aiStatus === 'loading' && (
                <div style={{ padding: '20px 0', display: 'flex', alignItems: 'center', gap: 10, color: T.muted, fontSize: '0.8rem' }}>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${T.accentBorder}`, borderTopColor: T.accent }}
                  />
                  Calling Claude…
                </div>
              )}

              <AnimatePresence>
                {aiStatus === 'ready' && aiResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.25, ease }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
                  >
                    {aiResult._cached && (
                      <div style={{ fontSize: '0.65rem', color: T.subtle, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>Cached result</span>
                        <motion.button
                          onClick={() => { setAiResult(null); setAiStatus('idle'); }}
                          style={{ background: 'none', border: 'none', color: T.accent, fontSize: '0.65rem', cursor: 'pointer', padding: 0 }}
                        >
                          Regenerate
                        </motion.button>
                      </div>
                    )}

                    {aiResult.do_not_touch_explanation && (
                      <div style={{ padding: '12px 14px', borderRadius: 10, background: T.successDim, border: `1px solid ${T.success}44` }}>
                        <p style={{ fontSize: '0.8rem', color: T.success, margin: 0, lineHeight: 1.5, fontWeight: 600 }}>
                          {aiResult.do_not_touch_explanation}
                        </p>
                      </div>
                    )}

                    {aiResult.fix_plan_copy?.length > 0 && (
                      <div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: T.subtle, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Fix Plan</div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          {aiResult.fix_plan_copy.map((item, i) => (
                            <FixPlanItem key={i} item={item} idx={i} />
                          ))}
                        </div>
                      </div>
                    )}

                    {aiResult.title_recommendations?.length > 0 && (
                      <div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: T.subtle, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Title Alternatives</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {aiResult.title_recommendations.map((rec, i) => (
                            <TitleRecommendation key={i} rec={rec} />
                          ))}
                        </div>
                      </div>
                    )}

                    {aiResult.thumbnail_recommendations?.length > 0 && (
                      <div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: T.subtle, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Thumbnail Concepts</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {aiResult.thumbnail_recommendations.map((rec, i) => (
                            <ThumbnailRecommendation key={i} rec={rec} />
                          ))}
                        </div>
                      </div>
                    )}

                    {aiResult.follow_up_video?.topic && (
                      <div style={{ padding: '14px 16px', borderRadius: 10, background: T.accentGlow, border: `1px solid ${T.accentBorder}` }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: T.accent, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Follow-Up Video Idea</div>
                        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: T.text, marginBottom: 4 }}>{aiResult.follow_up_video.title}</div>
                        <div style={{ fontSize: '0.75rem', color: T.muted, marginBottom: 6 }}>
                          <strong style={{ color: T.text }}>Topic:</strong> {aiResult.follow_up_video.topic}
                          {aiResult.follow_up_video.angle ? ` · ${aiResult.follow_up_video.angle}` : ''}
                        </div>
                        {aiResult.follow_up_video.reasoning && (
                          <p style={{ fontSize: '0.72rem', color: T.muted, margin: 0, lineHeight: 1.5 }}>{aiResult.follow_up_video.reasoning}</p>
                        )}
                      </div>
                    )}

                    <button
                      onClick={() => { setAiResult(null); setAiStatus('idle'); }}
                      style={{
                        alignSelf: 'flex-start', background: 'none',
                        border: `1px solid ${T.border}`, borderRadius: 7,
                        padding: '5px 12px', cursor: 'pointer',
                        color: T.muted, fontSize: '0.7rem',
                      }}
                    >
                      Regenerate
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
