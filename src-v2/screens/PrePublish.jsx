import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from '../tokens';
import { validateVideo } from '../../src-shared/prepublish/validateVideo.js';

const SCORING_URL = import.meta.env.VITE_SCORING_URL ?? 'http://localhost:3002';

const VIDEO_LENGTH_SECONDS = {
  'Under 1 min': 45,
  '1–5 mins':    180,
  '5–15 mins':   600,
  '15–30 mins':  1200,
  '30+ mins':    2400,
};

const CONFIDENCE_COLOR = { high: '#12D98A', medium: '#9D6FFF', low: '#F9A825', none: '#888' };
const CONFIDENCE_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence', none: 'No data' };

const TIER_COLOR = { rising: '#12D98A', emerging: '#9D6FFF', stable: '#888', peaking: '#F9A825', noise: '#F05252' };
const TIER_LABEL = { rising: 'Rising', emerging: 'Emerging', stable: 'Stable', peaking: 'Peaking', noise: 'Declining' };

const CATEGORIES = [
  'Entertainment','Education','Gaming','Music','News & Politics',
  'Science & Technology','Sports','Travel & Events','Film & Animation',
  'Howto & Style','People & Blogs','Pets & Animals','Comedy',
  'Autos & Vehicles','Nonprofits & Activism','Finance','Business',
  'Health & Fitness','Food','Fashion','Motivational',
];

const EMOTIONS = ['Curiosity','Shock','Inspiration','Humor','Fear','Nostalgia','Anger','Joy','Sadness','Awe'];
const VIDEO_LENGTHS = ['Under 1 min','1–5 mins','5–15 mins','15–30 mins','30+ mins'];
const UPLOAD_FREQS  = ['Daily','3–4x/week','Weekly','Biweekly','Monthly'];
const LANGUAGES     = ['Hindi','English','Telugu','Tamil','Bengali','Marathi','Kannada','Malayalam','Gujarati','Punjabi','Other'];

function ScoreDial({ value, label, color }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const r   = 26;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={72} height={72} viewBox="0 0 72 72">
        <circle cx={36} cy={36} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
        <circle
          cx={36} cy={36} r={r} fill="none"
          stroke={color} strokeWidth={5}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
          style={{ transition: 'stroke-dasharray 0.7s cubic-bezier(0.16,1,0.3,1)' }}
        />
        <text x={36} y={40} textAnchor="middle" fill={color}
          style={{ fontSize: '1.1rem', fontWeight: 800, fontFamily: 'inherit' }}>
          {pct}
        </text>
      </svg>
      <span style={{ fontSize: '0.68rem', color: T.muted, textAlign: 'center', lineHeight: 1.25 }}>{label}</span>
    </div>
  );
}

function GradeChip({ grade }) {
  const colors = { 'A+':'#12D98A','A':'#12D98A','B+':'#9D6FFF','B':'#9D6FFF','C':'#F9A825','D':'#F05252','F':'#F05252' };
  const c = colors[grade] ?? T.muted;
  return (
    <div style={{
      width: 48, height: 48, borderRadius: 12, border: `2px solid ${c}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `${c}18`, fontSize: '1.3rem', fontWeight: 900, color: c,
    }}>{grade ?? '—'}</div>
  );
}

function VerdictBanner({ finalVerdict, uploadDecision }) {
  const safe = finalVerdict === 'SAFE TO TEST';
  const dec  = uploadDecision?.decision;
  const color = dec === 'Ready to Upload' ? T.success
    : dec === 'Optimize Before Upload' ? T.warning
    : T.danger;
  const bg    = dec === 'Ready to Upload' ? T.successDim
    : dec === 'Optimize Before Upload' ? T.warningDim
    : T.dangerDim;
  const icon  = dec === 'Ready to Upload' ? '✓' : dec === 'Optimize Before Upload' ? '⚡' : '✕';

  return (
    <div style={{
      padding: '12px 16px', borderRadius: 10,
      background: bg, border: `1px solid ${color}44`,
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      <span style={{ fontSize: '1rem', color, flexShrink: 0, fontWeight: 900, lineHeight: 1.4 }}>{icon}</span>
      <div>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color }}>{dec ?? (safe ? 'Safe to Test' : 'Do Not Upload')}</div>
        {uploadDecision?.reason && (
          <div style={{ fontSize: '0.75rem', color: T.muted, marginTop: 2, lineHeight: 1.4 }}>{uploadDecision.reason}</div>
        )}
      </div>
    </div>
  );
}

function ScoreBar({ label, value, max = 10 }) {
  const pct = Math.max(0, Math.min(max, value ?? 0)) / max * 100;
  const color = pct >= 70 ? T.success : pct >= 50 ? T.accent : T.danger;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: '0.72rem', color: T.muted, width: 110, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
      <span style={{ fontSize: '0.72rem', color, width: 18, textAlign: 'right', fontWeight: 700 }}>{value ?? 0}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: T.subtle, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: '0.72rem', color: T.muted, marginBottom: 4, fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`,
  borderRadius: 8, padding: '8px 10px',
  color: T.text, fontSize: '0.82rem', fontFamily: 'inherit',
  outline: 'none', resize: 'vertical',
  transition: 'border-color 0.15s',
};

const selectStyle = {
  ...inputStyle,
  resize: 'none',
  appearance: 'none',
  cursor: 'pointer',
};

function ResultRewrite({ items, label, colorKey }) {
  if (!items?.length) return null;
  return (
    <Section title={label}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item, i) => {
          const text = item.hook || item.title || '';
          const note = item.whyItWorks || '';
          const tag  = item.type || item.strategy || '';
          return (
            <div key={i} style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'rgba(157,111,255,0.06)', border: `1px solid ${T.accentBorder}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: '0.8rem', color: T.text, lineHeight: 1.45, flex: 1 }}>{text}</span>
                {tag && (
                  <span style={{ fontSize: '0.6rem', color: T.accent, background: T.accentGlow, border: `1px solid ${T.accentBorder}`, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {tag}
                  </span>
                )}
              </div>
              {note && <div style={{ fontSize: '0.7rem', color: T.muted, lineHeight: 1.4 }}>{note}</div>}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function ThumbnailIdeas({ ideas }) {
  if (!ideas?.length) return null;
  return (
    <Section title="Thumbnail ideas">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ideas.map((idea, i) => (
          <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(18,217,138,0.05)', border: '1px solid rgba(18,217,138,0.18)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: T.success, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{idea.strategy}</span>
              {idea.textOverlay && (
                <span style={{ fontSize: '0.65rem', color: T.muted }}>"{idea.textOverlay}"</span>
              )}
            </div>
            <div style={{ fontSize: '0.78rem', color: T.text, lineHeight: 1.45, marginBottom: 4 }}>{idea.concept}</div>
            {idea.visual && <div style={{ fontSize: '0.7rem', color: T.muted, marginBottom: 4 }}>{idea.visual}</div>}
            {idea.whyItWorks && <div style={{ fontSize: '0.7rem', color: T.subtle }}>{idea.whyItWorks}</div>}
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function PrePublish({ channel, prefill = null }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    tags: '',
    category: 'Entertainment',
    videoLength: '5–15 mins',
    language: 'Hindi',
    channelName: '',
    subscribers: '',
    avgViews: '',
    uploadFreq: 'Weekly',
    hook: '',
    midVideo: '',
    ending: '',
    primaryEmotion: 'Curiosity',
  });
  const [thumbPreview,      setThumbPreview]      = useState(null);
  const [thumbDesc,         setThumbDesc]         = useState('');
  const [loading,           setLoading]           = useState(false);
  const [progress,          setProgress]          = useState(0);
  const [result,            setResult]            = useState(null);
  const [intelligenceResult, setIntelligenceResult] = useState(null);
  const [error,             setError]             = useState('');
  const resultsRef = useRef(null);

  // Auto-fill from v2 channel context
  useEffect(() => {
    if (!channel) return;
    setForm(f => ({
      ...f,
      channelName: f.channelName || channel.name || '',
      subscribers: f.subscribers || (channel.subsRaw ? String(channel.subsRaw) : ''),
    }));
  }, [channel]);

  // Prefill from WhatToPost "Validate idea"
  useEffect(() => {
    if (!prefill) return;
    setForm(f => ({
      ...f,
      title:    prefill.title    || f.title,
      hook:     prefill.hook     || f.hook,
      midVideo: prefill.midVideo || f.midVideo,
      ending:   prefill.ending   || f.ending,
      category: prefill.category || f.category,
    }));
  }, [prefill]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleThumb = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setThumbPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!form.title.trim()) { setError('Title is required.'); return; }
    if (!form.hook.trim() || !form.midVideo.trim() || !form.ending.trim()) {
      setError('Please fill in Hook, Mid Video, and Ending to analyse accurately.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    setIntelligenceResult(null);
    setProgress(1);

    const steps = [2200, 4500, 7500, 10500];
    const timers = steps.map((d, i) => setTimeout(() => setProgress(i + 2), d));

    const contentDescription = `HOOK:\n${form.hook.trim()}\n\nMID:\n${form.midVideo.trim()}\n\nENDING:\n${form.ending.trim()}`;
    const thumbInputType = thumbPreview ? 'image' : thumbDesc.trim() ? 'text' : 'none';
    const duration_seconds = VIDEO_LENGTH_SECONDS[form.videoLength] ?? null;

    try {
      // Run semantic nearest + intelligence in parallel before validateVideo
      const [semanticNeighbors, intelData] = await Promise.all([
        (async () => {
          try {
            const ac = new AbortController();
            const tid = setTimeout(() => ac.abort(), 2000);
            const r = await fetch(`${SCORING_URL}/api/semantic/nearest`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: form.title, limit: 8, useCache: true }),
              signal: ac.signal,
            });
            clearTimeout(tid);
            if (r.ok) return (await r.json()).neighbors ?? [];
          } catch {}
          return [];
        })(),
        (async () => {
          try {
            const ac = new AbortController();
            const tid = setTimeout(() => ac.abort(), 3000);
            const r = await fetch(`${SCORING_URL}/api/intel/prepublish/intelligence`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: form.title,
                channel_id: channel?.channelId ?? channel?.id ?? null,
                duration_seconds,
              }),
              signal: ac.signal,
            });
            clearTimeout(tid);
            if (r.ok) return await r.json();
          } catch {}
          return null;
        })(),
      ]);

      const data = await validateVideo({
        ...form,
        contentDescription,
        hasThumbnail: !!thumbPreview,
        thumbDescription: thumbPreview ? '' : thumbDesc.trim(),
        thumbInputType,
        semanticNeighbors,
      }, thumbPreview || null);

      timers.forEach(clearTimeout);
      setProgress(6);
      setResult(data);
      setIntelligenceResult(intelData);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (err) {
      timers.forEach(clearTimeout);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const PROGRESS_LABELS = [
    '', 'Fetching semantic references…', 'Running CTR engine…',
    'Running retention engine…', 'Computing packaging sync…',
    'Applying decision engine…', 'Analysis complete',
  ];

  const sc            = result?.categoryScores ?? {};
  const creativeScore = result?.uploadReadiness?.score ?? null;
  const intelAdj      = intelligenceResult?.data_adjustment ?? 0;
  // Backtest 834K rows showed adj>0 underperformed neutral; adjustment disabled until empirical calibration.
  // TODO: re-enable once per-niche calibration validates signal direction.
  const adjustedScore = creativeScore; // intentionally equals creativeScore — adj not applied

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 20px 60px' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: T.text, margin: 0 }}>Pre-Publish Validator</h2>
        <p style={{ fontSize: '0.78rem', color: T.muted, margin: '4px 0 0' }}>
          Score your video against the 7-layer decision engine before you upload.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

          {/* Left: Content details */}
          <div style={{ ...T.glassCard, borderRadius: 14, padding: '18px 20px' }}>
            <Section title="Content">
              <Field label="Title *">
                <input style={inputStyle} value={form.title}
                  onChange={e => set('title', e.target.value)}
                  placeholder="Your video title" />
              </Field>
              <Field label="Description">
                <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description}
                  onChange={e => set('description', e.target.value)}
                  placeholder="Brief description or paste first paragraph" />
              </Field>
              <Field label="Tags">
                <input style={inputStyle} value={form.tags}
                  onChange={e => set('tags', e.target.value)}
                  placeholder="tag1, tag2, tag3" />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Category">
                  <select style={selectStyle} value={form.category} onChange={e => set('category', e.target.value)}>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Language">
                  <select style={selectStyle} value={form.language} onChange={e => set('language', e.target.value)}>
                    {LANGUAGES.map(l => <option key={l}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Video Length">
                  <select style={selectStyle} value={form.videoLength} onChange={e => set('videoLength', e.target.value)}>
                    {VIDEO_LENGTHS.map(l => <option key={l}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Primary Emotion">
                  <select style={selectStyle} value={form.primaryEmotion} onChange={e => set('primaryEmotion', e.target.value)}>
                    {EMOTIONS.map(em => <option key={em}>{em}</option>)}
                  </select>
                </Field>
              </div>
            </Section>
          </div>

          {/* Right: Channel + thumbnail */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ ...T.glassCard, borderRadius: 14, padding: '18px 20px' }}>
              <Section title="Channel">
                <Field label="Channel name">
                  <input style={inputStyle} value={form.channelName}
                    onChange={e => set('channelName', e.target.value)}
                    placeholder="Your channel name" />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <Field label="Subscribers">
                    <input style={inputStyle} value={form.subscribers}
                      onChange={e => set('subscribers', e.target.value)}
                      placeholder="50000" />
                  </Field>
                  <Field label="Avg views">
                    <input style={inputStyle} value={form.avgViews}
                      onChange={e => set('avgViews', e.target.value)}
                      placeholder="5000" />
                  </Field>
                  <Field label="Upload freq">
                    <select style={selectStyle} value={form.uploadFreq} onChange={e => set('uploadFreq', e.target.value)}>
                      {UPLOAD_FREQS.map(f => <option key={f}>{f}</option>)}
                    </select>
                  </Field>
                </div>
              </Section>
            </div>

            <div style={{ ...T.glassCard, borderRadius: 14, padding: '18px 20px', flex: 1 }}>
              <Section title="Thumbnail">
                <div style={{ display: 'flex', gap: 10, marginBottom: thumbPreview ? 8 : 0 }}>
                  <label style={{
                    flex: 1, padding: '7px 12px', borderRadius: 8,
                    background: T.accentGlow, border: `1px solid ${T.accentBorder}`,
                    color: T.accent, fontSize: '0.74rem', fontWeight: 600,
                    cursor: 'pointer', textAlign: 'center',
                  }}>
                    Upload image
                    <input type="file" accept="image/*" onChange={handleThumb} style={{ display: 'none' }} />
                  </label>
                  {thumbPreview && (
                    <button type="button" onClick={() => setThumbPreview(null)}
                      style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, fontSize: '0.72rem', cursor: 'pointer' }}>
                      Remove
                    </button>
                  )}
                </div>
                {thumbPreview ? (
                  <img src={thumbPreview} alt="Thumbnail preview"
                    style={{ width: '100%', borderRadius: 8, objectFit: 'cover', maxHeight: 110 }} />
                ) : (
                  <textarea style={{ ...inputStyle, minHeight: 68, marginTop: 4 }}
                    value={thumbDesc}
                    onChange={e => setThumbDesc(e.target.value)}
                    placeholder="Or describe your thumbnail concept — include subject, emotion, text overlay, colors…" />
                )}
              </Section>
            </div>
          </div>
        </div>

        {/* Content description */}
        <div style={{ ...T.glassCard, borderRadius: 14, padding: '18px 20px', marginBottom: 16 }}>
          <Section title="Content description — required for accurate scoring">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="Hook (first 30 s) *">
                <textarea style={{ ...inputStyle, minHeight: 90 }} value={form.hook}
                  onChange={e => set('hook', e.target.value)}
                  placeholder="How does your video open? What happens in the first 30 seconds?" />
              </Field>
              <Field label="Mid video *">
                <textarea style={{ ...inputStyle, minHeight: 90 }} value={form.midVideo}
                  onChange={e => set('midVideo', e.target.value)}
                  placeholder="What happens in the middle? Key moments, structure, tension." />
              </Field>
              <Field label="Ending *">
                <textarea style={{ ...inputStyle, minHeight: 90 }} value={form.ending}
                  onChange={e => set('ending', e.target.value)}
                  placeholder="How does it end? Payoff, reveal, CTA." />
              </Field>
            </div>
          </Section>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{ padding: '10px 14px', borderRadius: 8, background: T.dangerDim, border: `1px solid ${T.danger}44`, color: T.danger, fontSize: '0.78rem', marginBottom: 12 }}>
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit */}
        <motion.button
          type="submit"
          disabled={loading}
          whileHover={!loading ? { scale: 1.02, boxShadow: `0 0 24px ${T.accent}55` } : {}}
          whileTap={!loading ? { scale: 0.98 } : {}}
          style={{
            width: '100%', padding: '13px', borderRadius: 10,
            background: loading ? 'rgba(157,111,255,0.2)' : T.accent,
            border: `1px solid ${T.accentBorder}`,
            color: '#fff', fontSize: '0.9rem', fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
          }}
        >
          {loading ? PROGRESS_LABELS[progress] || 'Analysing…' : 'Analyse video'}
        </motion.button>
      </form>

      {/* Results */}
      <AnimatePresence>
        {result && (
          <motion.div
            ref={resultsRef}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease }}
            style={{ marginTop: 28 }}
          >
            {/* Hero scores */}
            <div style={{ ...T.glassCard, borderRadius: 14, padding: '22px 24px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                <ScoreDial value={result.viralScore} label="Viral score" color={T.accent} />
                <ScoreDial value={result.valueScore} label="Value score" color={T.success} />
                <ScoreDial value={result.uploadReadiness?.score} label="Upload readiness" color={T.warning} />
                <GradeChip grade={result.grade} />
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: '0.68rem', color: T.subtle, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    {result.contentVerdict}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: T.text, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 }}>
                    {result.verdict}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: T.muted }}>{result.predictionConfidence && `Confidence: ${result.predictionConfidence}`}</div>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <VerdictBanner finalVerdict={result.finalVerdict} uploadDecision={result.uploadDecision} />
              </div>
            </div>

            {/* Launch Intelligence card */}
            {intelligenceResult && (
              <div style={{ ...T.glassCard, borderRadius: 14, padding: '18px 20px', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: T.subtle, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    Launch Intelligence
                  </div>
                  <div style={{
                    fontSize: '0.6rem', fontWeight: 600,
                    color: CONFIDENCE_COLOR[intelligenceResult.data_confidence] ?? T.muted,
                    background: `${CONFIDENCE_COLOR[intelligenceResult.data_confidence] ?? T.muted}18`,
                    border: `1px solid ${CONFIDENCE_COLOR[intelligenceResult.data_confidence] ?? T.muted}44`,
                    borderRadius: 4, padding: '1px 7px',
                  }}>
                    {CONFIDENCE_LABEL[intelligenceResult.data_confidence] ?? 'No data'}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', marginBottom: 10 }}>
                  {/* Creative score (pure 7-layer — authoritative) */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, color: T.warning, lineHeight: 1 }}>{creativeScore ?? '—'}</div>
                    <div style={{ fontSize: '0.62rem', color: T.muted, marginTop: 3 }}>Creative score</div>
                  </div>

                  {/* Suggested adjustment — shown as experimental, not applied to score */}
                  {intelAdj !== 0 && (
                    <div style={{
                      fontSize: '0.68rem', padding: '4px 10px', borderRadius: 6,
                      color: T.subtle, background: 'rgba(255,255,255,0.04)',
                      border: `1px solid ${T.border}`,
                    }}>
                      Suggested adj: <span style={{ fontWeight: 700, color: intelAdj > 0 ? T.success : T.danger }}>
                        {intelAdj > 0 ? `+${intelAdj}` : `${intelAdj}`}
                      </span>
                      <span style={{ color: T.subtle, marginLeft: 4 }}>(experimental)</span>
                    </div>
                  )}

                  <div style={{ flex: 1, minWidth: 180 }}>
                    {/* Intelligence fit score bar */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: '0.68rem', color: T.muted, width: 90, flexShrink: 0 }}>Intel fit</span>
                      <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${intelligenceResult.intelligence_fit_score ?? 0}%`, background: T.accent, borderRadius: 3, transition: 'width 0.6s ease' }} />
                      </div>
                      <span style={{ fontSize: '0.68rem', color: T.accent, width: 24, textAlign: 'right', fontWeight: 700 }}>{intelligenceResult.intelligence_fit_score}</span>
                    </div>
                    {/* Semantic cluster */}
                    {intelligenceResult.semantic_cluster && (
                      <div style={{ fontSize: '0.7rem', color: T.muted }}>
                        Archetype: <span style={{ color: T.text, fontWeight: 600 }}>{intelligenceResult.semantic_cluster}</span>
                        {intelligenceResult.cluster_avg_vph && (
                          <span style={{ color: T.subtle }}> · {Math.round(intelligenceResult.cluster_avg_vph)} VPH avg</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Topic signal + saturation */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: intelligenceResult.adjustment_reasons?.length ? 10 : 0 }}>
                  {intelligenceResult.topic_signals && (
                    <div style={{
                      fontSize: '0.68rem', padding: '3px 10px', borderRadius: 20,
                      color: TIER_COLOR[intelligenceResult.topic_signals.tier] ?? T.muted,
                      background: `${TIER_COLOR[intelligenceResult.topic_signals.tier] ?? T.muted}15`,
                      border: `1px solid ${TIER_COLOR[intelligenceResult.topic_signals.tier] ?? T.muted}44`,
                    }}>
                      {TIER_LABEL[intelligenceResult.topic_signals.tier]} · {intelligenceResult.topic_signals.topic}
                    </div>
                  )}
                  {intelligenceResult.saturation_level && (
                    <div style={{ fontSize: '0.68rem', padding: '3px 10px', borderRadius: 20, color: T.muted, background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.border}` }}>
                      Saturation: {intelligenceResult.saturation_level.replace('_', ' ')}
                    </div>
                  )}
                  {intelligenceResult.lifecycle_stage && (
                    <div style={{ fontSize: '0.68rem', padding: '3px 10px', borderRadius: 20, color: T.subtle, background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}` }}>
                      Stage: {intelligenceResult.lifecycle_stage}
                    </div>
                  )}
                  {intelligenceResult.niche_benchmark?.median_vph != null && (
                    <div style={{ fontSize: '0.68rem', padding: '3px 10px', borderRadius: 20, color: T.subtle, background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}` }}>
                      Niche median: {Math.round(intelligenceResult.niche_benchmark.median_vph)} VPH
                    </div>
                  )}
                </div>

                {/* Adjustment reasons */}
                {intelligenceResult.adjustment_reasons?.length > 0 && (
                  <div style={{ borderTop: `1px solid rgba(255,255,255,0.08)`, paddingTop: 10, marginTop: 4 }}>
                    {intelligenceResult.adjustment_reasons.map((r, i) => (
                      <div key={i} style={{ fontSize: '0.71rem', color: T.muted, marginBottom: 3, lineHeight: 1.4 }}>
                        · {r}
                      </div>
                    ))}
                  </div>
                )}

                {/* Calibration shadow notice */}
                {(() => {
                  const empAdj = intelligenceResult.empirical_adjustment;
                  const negStatus = intelligenceResult.negative_adjustment_status;
                  if (empAdj > 0) {
                    return (
                      <div style={{ marginTop: 10, fontSize: '0.67rem', color: T.success, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ opacity: 0.6 }}>◉</span>
                        Calibrated corpus signal: <span style={{ fontWeight: 700 }}>+{empAdj} shadow</span>
                        <span style={{ color: T.subtle }}> — Not applied to score yet</span>
                      </div>
                    );
                  }
                  if (negStatus === 'shadow_only_unsafe') {
                    return (
                      <div style={{ marginTop: 10, fontSize: '0.64rem', color: T.subtle, lineHeight: 1.4 }}>
                        Negative calibration is being tested and not applied.
                      </div>
                    );
                  }
                  return (
                    <div style={{ marginTop: 10, fontSize: '0.64rem', color: T.subtle, lineHeight: 1.4 }}>
                      Corpus intelligence is informational while calibration is in progress.
                    </div>
                  );
                })()}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

              {/* Left column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Single point of failure */}
                {result.singlePointOfFailure && (
                  <div style={{ ...T.glassCard, borderRadius: 12, padding: '14px 16px' }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: T.danger, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                      Single point of failure
                    </div>
                    <div style={{ fontSize: '0.82rem', color: T.text, lineHeight: 1.45 }}>
                      {result.singlePointOfFailure}
                    </div>
                  </div>
                )}

                {/* Top fix */}
                {result.topFix && (
                  <div style={{ ...T.glassCard, borderRadius: 12, padding: '14px 16px', background: 'rgba(157,111,255,0.06)' }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: T.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                      Top fix · {result.topFix.impact}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: T.text, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 }}>
                      {result.topFix.change}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: T.muted, lineHeight: 1.4, marginBottom: result.topFix.ifIgnored ? 6 : 0 }}>
                      {result.topFix.reason}
                    </div>
                    {result.topFix.ifIgnored && (
                      <div style={{ fontSize: '0.7rem', color: T.danger, lineHeight: 1.4, borderTop: `1px solid ${T.border}`, paddingTop: 6, marginTop: 2 }}>
                        If ignored: {result.topFix.ifIgnored}
                      </div>
                    )}
                  </div>
                )}

                {/* Category scores */}
                <div style={{ ...T.glassCard, borderRadius: 12, padding: '14px 16px' }}>
                  <Section title="Category scores">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <ScoreBar label="Title strength"   value={sc.titleStrength} />
                      <ScoreBar label="Hook potential"   value={sc.hookPotential} />
                      <ScoreBar label="Topic timing"     value={sc.topicTiming} />
                      <ScoreBar label="SEO strength"     value={sc.seoStrength} />
                      <ScoreBar label="Viral probability" value={sc.viralProbability} />
                      <ScoreBar label="Audience match"   value={sc.audienceMatch} />
                      <ScoreBar label="Competition"      value={sc.competitionLevel} />
                    </div>
                  </Section>
                </div>

                {/* CTR + Retention engines */}
                {result.ctrEngine && (
                  <div style={{ ...T.glassCard, borderRadius: 12, padding: '14px 16px' }}>
                    <Section title={`CTR Engine · ${result.ctrEngine.ctrPotential}`}>
                      {result.ctrEngine.clickDrivers?.map((d, i) => (
                        <div key={i} style={{ fontSize: '0.74rem', color: T.success, marginBottom: 4 }}>+ {d}</div>
                      ))}
                      {result.ctrEngine.clickKillers?.map((k, i) => (
                        <div key={i} style={{ fontSize: '0.74rem', color: T.danger, marginBottom: 4 }}>− {k}</div>
                      ))}
                    </Section>
                    {result.retentionEngine && (
                      <Section title={`Retention Engine · ${result.retentionEngine.retentionPotential}`}>
                        {result.retentionEngine.dropRisks?.map((d, i) => (
                          <div key={i} style={{ fontSize: '0.74rem', color: T.danger, marginBottom: 4 }}>⚠ {d}</div>
                        ))}
                        {result.retentionEngine.engagementDrivers?.map((d, i) => (
                          <div key={i} style={{ fontSize: '0.74rem', color: T.success, marginBottom: 4 }}>+ {d}</div>
                        ))}
                      </Section>
                    )}
                  </div>
                )}

                {/* Consequence simulation */}
                {result.consequenceSimulation && (
                  <div style={{ ...T.glassCard, borderRadius: 12, padding: '14px 16px' }}>
                    <Section title="If you upload now">
                      {[
                        ['Expected CTR', result.consequenceSimulation.expectedCTR],
                        ['Distribution', result.consequenceSimulation.distributionState],
                        ['Drop point', result.consequenceSimulation.retentionDropPoint],
                        ['Outcome', result.consequenceSimulation.likelyOutcome],
                      ].map(([k, v]) => v && (
                        <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                          <span style={{ fontSize: '0.68rem', color: T.subtle, width: 80, flexShrink: 0, paddingTop: 2 }}>{k}</span>
                          <span style={{ fontSize: '0.74rem', color: T.text, lineHeight: 1.4 }}>{v}</span>
                        </div>
                      ))}
                    </Section>
                  </div>
                )}
              </div>

              {/* Right column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Hook rewrites */}
                {result.hookRewrites?.length > 0 && (
                  <div style={{ ...T.glassCard, borderRadius: 12, padding: '14px 16px' }}>
                    <ResultRewrite items={result.hookRewrites} label="Hook rewrites" />
                  </div>
                )}

                {/* Title rewrites */}
                {result.titleRewrites?.length > 0 && (
                  <div style={{ ...T.glassCard, borderRadius: 12, padding: '14px 16px' }}>
                    <ResultRewrite items={result.titleRewrites} label="Title rewrites" />
                  </div>
                )}

                {/* Thumbnail ideas */}
                {result.thumbnailIdeas?.length > 0 && (
                  <div style={{ ...T.glassCard, borderRadius: 12, padding: '14px 16px' }}>
                    <ThumbnailIdeas ideas={result.thumbnailIdeas} />
                  </div>
                )}

                {/* Packaging analysis */}
                {result.packagingAnalysis && (
                  <div style={{ ...T.glassCard, borderRadius: 12, padding: '14px 16px' }}>
                    <Section title={`Packaging sync · ${result.packagingAnalysis.packagingScore}/10`}>
                      <div style={{ fontSize: '0.78rem', color: T.text, marginBottom: 6, lineHeight: 1.4 }}>
                        {result.packagingAnalysis.summary}
                      </div>
                      {result.packagingAnalysis.detectedIssues?.map((issue, i) => (
                        <div key={i} style={{ fontSize: '0.72rem', color: T.danger, marginBottom: 3 }}>⚠ {issue}</div>
                      ))}
                      {result.packagingAnalysis.recommendedPackaging && (
                        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: T.accentGlow, border: `1px solid ${T.accentBorder}` }}>
                          <div style={{ fontSize: '0.65rem', color: T.accent, fontWeight: 700, marginBottom: 4 }}>Recommended packaging</div>
                          {result.packagingAnalysis.recommendedPackaging.title && (
                            <div style={{ fontSize: '0.74rem', color: T.text, marginBottom: 3 }}>Title: {result.packagingAnalysis.recommendedPackaging.title}</div>
                          )}
                          {result.packagingAnalysis.recommendedPackaging.hook && (
                            <div style={{ fontSize: '0.72rem', color: T.muted }}>Hook: {result.packagingAnalysis.recommendedPackaging.hook}</div>
                          )}
                        </div>
                      )}
                    </Section>
                  </div>
                )}

                {/* Growth levers */}
                {result.growthLevers?.length > 0 && (
                  <div style={{ ...T.glassCard, borderRadius: 12, padding: '14px 16px' }}>
                    <Section title="Growth levers">
                      {result.growthLevers.map((gl, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                          <div style={{ width: 20, height: 20, borderRadius: 6, background: T.accentGlow, border: `1px solid ${T.accentBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 800, color: T.accent, flexShrink: 0 }}>
                            {gl.rank}
                          </div>
                          <div>
                            <div style={{ fontSize: '0.76rem', color: T.text, lineHeight: 1.4 }}>{gl.lever}</div>
                            <div style={{ fontSize: '0.67rem', color: T.muted, marginTop: 2 }}>Impact: {gl.impact} · Confidence: {gl.confidence}</div>
                          </div>
                        </div>
                      ))}
                    </Section>
                  </div>
                )}

                {/* Strategic insight */}
                {result.strategicInsight && (
                  <div style={{ ...T.glassCard, borderRadius: 12, padding: '14px 16px' }}>
                    <Section title="Strategic insight">
                      <div style={{ fontSize: '0.78rem', color: T.text, lineHeight: 1.5 }}>{result.strategicInsight}</div>
                    </Section>
                  </div>
                )}
              </div>
            </div>

            {/* Reset */}
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button
                type="button"
                onClick={() => { setResult(null); setProgress(0); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                style={{ padding: '8px 20px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, fontSize: '0.76rem', cursor: 'pointer' }}
              >
                Analyse another video
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
