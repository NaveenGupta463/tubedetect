import { useState, useEffect, useRef } from 'react';
import { validateVideo } from '../api/claude';
import { meetsRequirement } from '../utils/tierConfig';
import { formatNum } from '../utils/analysis';

// ── Helpers ───────────────────────────────────────────────────────────────────
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 8);
}

const CACHE_PREFIX  = 'tubeintel_validator_';
const HISTORY_KEY   = 'tubeintel_validator_history';

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistory(item) {
  const hist = loadHistory().filter(h => h.title !== item.title).slice(0, 4);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify([item, ...hist])); } catch {}
}

// ── Score helpers ─────────────────────────────────────────────────────────────
function scoreColor(s) {
  return s >= 86 ? '#00c853' : s >= 66 ? '#ffd600' : s >= 41 ? '#ff9100' : '#ff1744';
}
function barColor10(v) {
  return v >= 8 ? '#00c853' : v >= 6 ? '#ff9100' : '#ff1744';
}

// ── Confetti ──────────────────────────────────────────────────────────────────
const CONF_COLORS = ['#ff0000','#ff9100','#ffd600','#00c853','#2196f3','#7c4dff','#e91e63'];
function Confetti() {
  const particles = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 2.5,
    dur: 2.2 + Math.random() * 1.8,
    color: CONF_COLORS[i % CONF_COLORS.length],
    size: 6 + Math.floor(Math.random() * 8),
    round: Math.random() > 0.5,
  }));
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, overflow: 'hidden' }}>
      {particles.map(p => (
        <div key={p.id} style={{
          position: 'absolute', left: `${p.left}%`, top: -20,
          width: p.size, height: p.size,
          background: p.color, borderRadius: p.round ? '50%' : 2,
          animation: `confettiFall ${p.dur}s ${p.delay}s ease-in forwards`,
        }} />
      ))}
    </div>
  );
}

// ── BigScoreRing ──────────────────────────────────────────────────────────────
function BigScoreRing({ score, grade }) {
  const size = 140; const r = (size - 14) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score || 0));
  const color = scoreColor(pct);
  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a1a1a" strokeWidth={13} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={13}
        strokeDasharray={`${(pct/100)*circ} ${circ-(pct/100)*circ}`}
        strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: 'stroke-dasharray 1s ease' }} />
      <text x={size/2} y={size/2-8} textAnchor="middle" fill={color}
        fontSize={32} fontWeight="900" fontFamily="Inter, sans-serif">{grade || '?'}</text>
      <text x={size/2} y={size/2+16} textAnchor="middle" fill="#666"
        fontSize={12} fontFamily="Inter, sans-serif">{score}/100</text>
    </svg>
  );
}

// ── Progress Steps ────────────────────────────────────────────────────────────
const STEPS = [
  'Analyzing your title…',
  'Evaluating thumbnail…',
  'Scanning competitor videos in your niche…',
  'Calculating viral probability…',
  'Generating recommendations…',
];
function ProgressSteps({ step }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '20px 0' }}>
      {STEPS.map((s, i) => {
        const done    = step > i + 1;
        const active  = step === i + 1;
        const pending = step < i + 1;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
              background: done ? '#00c85322' : active ? '#7c4dff22' : '#111',
              border: `2px solid ${done ? '#00c853' : active ? '#7c4dff' : '#222'}`,
            }}>
              {done ? <span style={{ color: '#00c853' }}>✓</span>
                : active ? <span className="btn-spinner" style={{ width: 12, height: 12 }} />
                : <span style={{ color: '#333', fontSize: 10 }}>{i+1}</span>}
            </div>
            <span style={{
              fontSize: 13,
              color: done ? '#00c853' : active ? '#e0e0e0' : '#333',
              fontWeight: active ? 700 : 400,
            }}>{s}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── ProGate ───────────────────────────────────────────────────────────────────
function ProGate({ onUpgrade }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 56, marginBottom: 16 }}>🚀</div>
      <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8, color: '#fff' }}>Pre-Publish Validator</h2>
      <p style={{ fontSize: 14, color: '#555', maxWidth: 400, lineHeight: 1.7, marginBottom: 24 }}>
        Validate your video before publishing — predict view counts, get title rewrites,
        competitor intel, and a full launch checklist.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28, textAlign: 'left', maxWidth: 360 }}>
        {[
          '🎯 Overall launch score out of 100 with letter grade',
          '📊 8-dimension category scores (Title, Hook, SEO, Viral…)',
          '✍️ 3 improved title alternatives with copy buttons',
          '📈 7-day view range and viral probability prediction',
          '⚔️ Competitor intelligence — what top videos did better',
          '🔴 Critical fixes ranked by impact before you hit publish',
          '☑️ Interactive pre-launch checklist',
        ].map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#888' }}>
            <span style={{ color: '#00c853', flexShrink: 0 }}>✓</span><span>{item}</span>
          </div>
        ))}
      </div>
      <button onClick={onUpgrade} style={{
        background: 'linear-gradient(135deg,#ff0000,#cc0000)', border: 'none',
        borderRadius: 8, padding: '13px 32px', fontSize: 14, fontWeight: 800,
        color: '#fff', cursor: 'pointer',
      }}>
        Upgrade to Pro — Unlock Validator
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORIES = ['Entertainment','Education','Gaming','Tech','Finance','Comedy','Lifestyle','News','Sports','Other'];
const LENGTHS    = ['Under 1 min (Short)','1–5 mins','5–15 mins','15–30 mins','30+ mins'];
const LANGUAGES  = ['Hindi','English','Hinglish','Other'];
const FREQS      = ['Daily','2–3 per week','Weekly','Bi-weekly','Monthly'];
const EMOTIONS   = ['Entertained','Educated','Inspired','Shocked','Amused','Curious'];
const HOOK_OPTS  = ['Yes','No','Not sure'];

const CHECKLIST_ITEMS = [
  { id: 'title_len',   text: 'Title under 60 characters' },
  { id: 'thumb',       text: 'Thumbnail has clear focal point' },
  { id: 'hook',        text: 'First 30 seconds hook is strong' },
  { id: 'desc_keys',   text: 'Description has relevant keywords' },
  { id: 'tags',        text: 'Tags added (5–15 tags)' },
  { id: 'end_screen',  text: 'End screen added' },
  { id: 'cards',       text: 'Cards added at key moments' },
  { id: 'best_time',   text: 'Best time to post selected' },
];

export default function PrePublishValidator({ tier, canUseAI, consumeAICall, remainingCalls, onUpgrade, channel, videos }) {
  const isPro = meetsRequirement(tier, 'pro');
  const isAgency = meetsRequirement(tier, 'agency');

  const avgChannelViews = videos?.length
    ? Math.round(videos.reduce((s, v) => s + parseInt(v.statistics?.viewCount || 0), 0) / videos.length)
    : '';

  const [form, setForm] = useState({
    title: '', description: '', tags: '', category: 'Entertainment',
    videoLength: '5–15 mins', language: 'Hindi',
    channelName: '', subscribers: '', avgViews: '',
    uploadFreq: 'Weekly', contentDescription: '',
    primaryEmotion: 'Entertained', hasHook: 'Yes', hasPacing: 'Yes',
  });
  const [thumbPreview, setThumbPreview] = useState(null);
  const [loading, setLoading]           = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [result, setResult]             = useState(null);
  const [error, setError]               = useState('');
  const [history, setHistory]           = useState(loadHistory);
  const [showHistory, setShowHistory]   = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [checklist, setChecklist]       = useState({});
  const [copiedIdx, setCopiedIdx]       = useState(null);
  const resultsRef = useRef(null);

  // Auto-fill from loaded channel
  useEffect(() => {
    if (!channel) return;
    setForm(f => ({
      ...f,
      channelName: f.channelName || channel.snippet?.title || '',
      subscribers: f.subscribers || channel.statistics?.subscriberCount || '',
      avgViews:    f.avgViews    || (avgChannelViews ? String(avgChannelViews) : ''),
    }));
  }, [channel]);

  // Auto-check checklist from form state
  useEffect(() => {
    setChecklist(c => ({
      title_len:  form.title.length > 0 && form.title.length <= 60,
      thumb:      !!thumbPreview,
      hook:       form.hasHook === 'Yes',
      desc_keys:  form.description.length > 30,
      tags:       form.tags.split(',').filter(t => t.trim()).length >= 5,
      end_screen: c.end_screen  ?? false,
      cards:      c.cards       ?? false,
      best_time:  c.best_time   ?? false,
    }));
  }, [form, thumbPreview]);

  if (!isPro) return <ProGate onUpgrade={onUpgrade} />;

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleThumb = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setThumbPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!form.title.trim() || !form.contentDescription.trim()) {
      setError('Please fill in the Title and Content Description fields.');
      return;
    }
    if (!canUseAI || !canUseAI()) {
      setError('No AI calls remaining. Upgrade your plan to continue.');
      return;
    }

    const cacheKey = CACHE_PREFIX + hashString(form.title + form.contentDescription);
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setResult(JSON.parse(cached));
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        return;
      }
    } catch {}

    setLoading(true);
    setError('');
    setResult(null);
    setProgressStep(1);

    const delays = [2200, 4500, 7500, 10500];
    const timers = delays.map((d, i) => setTimeout(() => setProgressStep(i + 2), d));

    try {
      const data = await validateVideo({ ...form, hasThumbnail: !!thumbPreview });
      timers.forEach(clearTimeout);
      setProgressStep(6);
      consumeAICall();
      setResult(data);
      try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch {}
      saveHistory({ title: form.title, score: data.overallScore, grade: data.grade, date: new Date().toISOString(), result: data });
      setHistory(loadHistory());
      if ((data.overallScore ?? 0) >= 85) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 5000);
      }
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth' }), 300);
    } catch (err) {
      timers.forEach(clearTimeout);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyTitle = (title, idx) => {
    navigator.clipboard.writeText(title).catch(() => {});
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const priorityIcon  = (p) => p === 'critical' ? '🔴' : p === 'important' ? '🟡' : '🟢';
  const priorityColor = (p) => p === 'critical' ? '#ff1744' : p === 'important' ? '#ffd600' : '#00c853';
  const timingColor   = (s) => s === 'Hot' ? '#ff1744' : s === 'Warm' ? '#ff9100' : '#2196f3';

  const sc = result?.categoryScores || {};
  const catScores = result ? [
    { label: 'Title Strength',      value: sc.titleStrength     ?? 0 },
    { label: 'Hook Potential',       value: sc.hookPotential     ?? 0 },
    { label: 'Topic Timing',         value: sc.topicTiming       ?? 0 },
    { label: 'SEO Strength',         value: sc.seoStrength       ?? 0 },
    { label: 'Viral Probability',    value: sc.viralProbability  ?? 0 },
    { label: 'Audience Match',       value: sc.audienceMatch     ?? 0 },
    { label: 'Competition Level',    value: sc.competitionLevel  ?? 0 },
    ...(thumbPreview ? [{ label: 'Thumbnail Appeal', value: sc.thumbnailAppeal ?? Math.round((result?.thumbnailAnalysis?.scrollStoppingPower ?? 60) / 10) }] : []),
  ] : [];

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="analysis-page" style={{ maxWidth: 860, margin: '0 auto' }}>
      {showConfetti && <Confetti />}

      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: '#fff', marginBottom: 4 }}>
          🚀 Pre-Publish Validator
        </h1>
        <p style={{ fontSize: 14, color: '#666', lineHeight: 1.6 }}>
          Evaluate your video before publishing and predict its chances of success
        </p>
        {isAgency && (
          <span style={{ display: 'inline-block', marginTop: 6, background: '#00c85322', border: '1px solid #00c85344', borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 700, color: '#69f0ae' }}>
            ⚡ Agency — Priority Analysis
          </span>
        )}
      </div>

      {/* Warning Banner */}
      <div style={{
        background: '#ffd60011', border: '1px solid #ffd60033', borderRadius: 10,
        padding: '12px 16px', marginBottom: 24,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>⚠</span>
        <p style={{ fontSize: 13, color: '#ffd600cc', lineHeight: 1.6, margin: 0 }}>
          This evaluation is based on analysis of previously published videos in your niche and current trending patterns. Actual results after publishing may vary depending on factors like timing, algorithm changes, and audience behavior.
        </p>
      </div>

      {/* ── FORM ─────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit}>

        {/* Section A */}
        <div className="chart-card" style={{ marginBottom: 16 }}>
          <h3 className="chart-title" style={{ marginBottom: 16 }}>Section A — Video Details</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Title */}
            <div>
              <label className="form-label">
                Video Title <span style={{ color: '#ff1744' }}>*</span>
                <span style={{ marginLeft: 8, fontWeight: 400, color: form.title.length > 60 ? '#ff1744' : '#555' }}>
                  {form.title.length}/60 {form.title.length > 60 ? '— too long' : ''}
                </span>
              </label>
              <input
                className="form-input"
                style={{ borderColor: form.title.length > 60 ? '#ff174466' : undefined }}
                type="text"
                placeholder="Enter your video title exactly as you plan to publish it"
                value={form.title}
                onChange={e => setField('title', e.target.value)}
              />
            </div>

            {/* Thumbnail */}
            <div>
              <label className="form-label">Thumbnail Upload (JPG/PNG)</label>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <label style={{
                  background: '#111', border: '1px dashed #2a2a2a', borderRadius: 8,
                  padding: '10px 18px', fontSize: 13, color: '#666', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                }}>
                  <input type="file" accept="image/jpeg,image/png" onChange={handleThumb} style={{ display: 'none' }} />
                  📷 {thumbPreview ? 'Change Thumbnail' : 'Upload Thumbnail'}
                </label>
                {thumbPreview && (
                  <div style={{ position: 'relative' }}>
                    <img src={thumbPreview} alt="thumb" style={{ height: 72, borderRadius: 6, border: '1px solid #2a2a2a' }} />
                    <button type="button" onClick={() => setThumbPreview(null)} style={{
                      position: 'absolute', top: -6, right: -6, background: '#ff1744',
                      border: 'none', borderRadius: '50%', width: 18, height: 18,
                      fontSize: 10, color: '#fff', cursor: 'pointer', lineHeight: 1,
                    }}>✕</button>
                  </div>
                )}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="form-label">Video Description (optional)</label>
              <textarea className="form-input form-textarea"
                placeholder="Paste your video description here"
                value={form.description}
                onChange={e => setField('description', e.target.value)}
                rows={3}
              />
            </div>

            {/* Tags */}
            <div>
              <label className="form-label">Tags (comma separated, optional)</label>
              <input className="form-input" type="text"
                placeholder="e.g. youtube tips, grow channel, content strategy"
                value={form.tags} onChange={e => setField('tags', e.target.value)} />
            </div>

            {/* Row: Category, Length, Language */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label className="form-label">Category</label>
                <select className="form-input" value={form.category} onChange={e => setField('category', e.target.value)}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Video Length</label>
                <select className="form-input" value={form.videoLength} onChange={e => setField('videoLength', e.target.value)}>
                  {LENGTHS.map(l => <option key={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Language</label>
                <select className="form-input" value={form.language} onChange={e => setField('language', e.target.value)}>
                  {LANGUAGES.map(l => <option key={l}>{l}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Section B */}
        <div className="chart-card" style={{ marginBottom: 16 }}>
          <h3 className="chart-title" style={{ marginBottom: 16 }}>Section B — Channel Context</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Channel Name or URL</label>
              <input className="form-input" type="text"
                placeholder="@handle or channel name"
                value={form.channelName} onChange={e => setField('channelName', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Subscriber Count</label>
              <input className="form-input" type="number" min="0"
                placeholder="e.g. 50000"
                value={form.subscribers} onChange={e => setField('subscribers', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Average Views Per Video</label>
              <input className="form-input" type="number" min="0"
                placeholder="e.g. 12000"
                value={form.avgViews} onChange={e => setField('avgViews', e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Upload Frequency</label>
              <select className="form-input" value={form.uploadFreq} onChange={e => setField('uploadFreq', e.target.value)}>
                {FREQS.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Section C */}
        <div className="chart-card" style={{ marginBottom: 16 }}>
          <h3 className="chart-title" style={{ marginBottom: 16 }}>Section C — Content Details</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div>
              <label className="form-label">
                What happens in this video? <span style={{ color: '#ff1744' }}>*</span>
                <span style={{ marginLeft: 8, fontWeight: 400, color: form.contentDescription.length > 480 ? '#ff9100' : '#555' }}>
                  {form.contentDescription.length}/500
                </span>
              </label>
              <textarea className="form-input form-textarea"
                placeholder="Describe your video content: What's the hook? What's the main topic? What's the payoff? The more detail you give, the more accurate the prediction."
                value={form.contentDescription}
                onChange={e => setField('contentDescription', e.target.value.slice(0, 500))}
                rows={5}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label className="form-label">Primary Emotion Target</label>
                <select className="form-input" value={form.primaryEmotion} onChange={e => setField('primaryEmotion', e.target.value)}>
                  {EMOTIONS.map(em => <option key={em}>{em}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Strong Hook (first 30s)?</label>
                <select className="form-input" value={form.hasHook} onChange={e => setField('hasHook', e.target.value)}>
                  {HOOK_OPTS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Good Pacing / Editing?</label>
                <select className="form-input" value={form.hasPacing} onChange={e => setField('hasPacing', e.target.value)}>
                  {HOOK_OPTS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        {error && <div className="search-error" style={{ marginBottom: 12 }}>{error}</div>}

        {/* Submit */}
        <div style={{ marginBottom: 32 }}>
          <button
            type="submit"
            disabled={loading || !form.title.trim() || !form.contentDescription.trim()}
            style={{
              width: '100%', padding: '16px 0',
              background: loading ? '#1a1a1a' : 'linear-gradient(135deg,#ff0000,#cc0000)',
              border: '1px solid #ff000033', borderRadius: 10,
              fontSize: 16, fontWeight: 900, color: loading ? '#555' : '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}
          >
            {loading ? <><span className="btn-spinner" />Analyzing…</> : '🚀 Validate My Video'}
          </button>
          <div style={{ textAlign: 'center', fontSize: 12, color: '#444', marginTop: 8 }}>
            {loading ? '' : `Analysis takes ~15 seconds · ${remainingCalls ? remainingCalls() : '?'} AI calls remaining`}
          </div>
        </div>

        {/* Progress */}
        {loading && (
          <div className="chart-card" style={{ marginBottom: 20 }}>
            <h3 className="chart-title" style={{ marginBottom: 4 }}>
              🧠 TubeIntel is validating your video…
            </h3>
            <p className="chart-subtitle">Scanning your niche and generating predictions</p>
            <ProgressSteps step={progressStep} />
          </div>
        )}
      </form>

      {/* ── RESULTS ──────────────────────────────────────────────────────── */}
      {result && (
        <div ref={resultsRef}>

          {/* A — Overall Score */}
          <div className="chart-card" style={{ marginBottom: 16, borderTop: `3px solid ${scoreColor(result.overallScore)}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
              <BigScoreRing score={result.overallScore} grade={result.grade} />
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 24, fontWeight: 900, color: scoreColor(result.overallScore), marginBottom: 4 }}>
                  {result.verdict || 'Analysis Complete'}
                </div>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 12, lineHeight: 1.6 }}>
                  {result.overallScore >= 86 ? 'This video has strong launch potential. Go for it!' :
                   result.overallScore >= 66 ? 'Solid foundation. Address the flagged issues for better performance.' :
                   result.overallScore >= 41 ? 'Several key areas need attention before publishing.' :
                   'High risk. Significant improvements needed before launch.'}
                </div>
                <div style={{ fontSize: 11, color: '#3a3a3a', lineHeight: 1.5 }}>
                  Score is based on analysis of similar videos in your niche and current trending patterns. Actual results may vary after publishing.
                </div>
              </div>
            </div>
          </div>

          {/* B — Category Scores */}
          <div className="chart-card" style={{ marginBottom: 16 }}>
            <h3 className="chart-title" style={{ marginBottom: 14 }}>📊 Category Scores</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {catScores.map(s => {
                const color = barColor10(s.value);
                return (
                  <div key={s.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13, color: '#aaa' }}>
                      <span>{s.label}</span>
                      <span style={{ color, fontWeight: 700 }}>{s.value}/10</span>
                    </div>
                    <div style={{ height: 8, background: '#1a1a1a', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${s.value * 10}%`, background: color, borderRadius: 4, transition: 'width 0.8s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* C — Title Analysis */}
          {result.titleAnalysis && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <div className="chart-title-row">
                <h3 className="chart-title">✍️ Title Analysis</h3>
                <span style={{
                  background: '#7c4dff22', border: '1px solid #7c4dff44',
                  borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#b39ddb', fontWeight: 700,
                }}>
                  {result.titleAnalysis.rating}
                </span>
              </div>
              <div style={{ fontStyle: 'italic', color: '#888', fontSize: 13, margin: '8px 0 14px', padding: '10px 14px', background: '#0f0f0f', borderRadius: 8, border: '1px solid #1a1a1a' }}>
                "{form.title}"
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ background: '#00c85308', border: '1px solid #00c85322', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#00c853', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>What Works</div>
                  {result.titleAnalysis.strengths?.map((s, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'flex', gap: 6 }}>
                      <span style={{ color: '#00c853' }}>✓</span><span>{s}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background: '#ff174408', border: '1px solid #ff174422', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#ff6666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>What's Weak</div>
                  {result.titleAnalysis.weaknesses?.map((w, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'flex', gap: 6 }}>
                      <span style={{ color: '#ff6666' }}>✗</span><span>{w}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ fontSize: 12, fontWeight: 700, color: '#7c4dff', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                3 Improved Title Alternatives
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.titleAnalysis.improvedTitles?.map((t, i) => (
                  <div key={i} style={{ background: '#0f0f0f', borderRadius: 8, padding: '12px 14px', border: '1px solid #1e1e1e', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0', marginBottom: 4 }}>"{t.title}"</div>
                      <div style={{ fontSize: 12, color: '#666' }}>{t.reason}</div>
                    </div>
                    <button
                      onClick={() => copyTitle(t.title, i)}
                      style={{
                        background: copiedIdx === i ? '#00c85322' : '#1a1a1a',
                        border: `1px solid ${copiedIdx === i ? '#00c853' : '#2a2a2a'}`,
                        borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 700,
                        color: copiedIdx === i ? '#00c853' : '#666', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      {copiedIdx === i ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* D — Thumbnail Analysis (only if uploaded) */}
          {thumbPreview && result.thumbnailAnalysis && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <h3 className="chart-title" style={{ marginBottom: 14 }}>🖼️ Thumbnail Analysis</h3>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <img src={thumbPreview} alt="thumb" style={{ width: 180, height: 102, objectFit: 'cover', borderRadius: 8, border: '1px solid #2a2a2a', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                    {[
                      { label: 'Emotional Trigger', value: result.thumbnailAnalysis.emotionalTrigger },
                      { label: 'Scroll-Stop Power', value: `${result.thumbnailAnalysis.scrollStoppingPower ?? '—'}/100` },
                      { label: 'Color Contrast',    value: result.thumbnailAnalysis.colorContrast },
                      { label: 'Text Clarity',      value: result.thumbnailAnalysis.textClarity },
                    ].map(m => (
                      <div key={m.label} style={{ background: '#0f0f0f', borderRadius: 6, padding: '8px 10px' }}>
                        <div style={{ fontSize: 10, color: '#444', marginBottom: 2 }}>{m.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#ccc' }}>{m.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#ff9100', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Improvements</div>
                  {result.thumbnailAnalysis.improvements?.map((tip, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'flex', gap: 6 }}>
                      <span style={{ color: '#ff9100' }}>#{i+1}</span><span>{tip}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* E — Topic Timing */}
          {result.topicTiming && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <h3 className="chart-title" style={{ marginBottom: 14 }}>📅 Topic Timing</h3>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                {[
                  { label: 'Topic Status',   value: result.topicTiming.status,     color: timingColor(result.topicTiming.status) },
                  { label: 'Best Day',        value: result.topicTiming.bestPublishDay,  color: '#7c4dff' },
                  { label: 'Best Time',       value: result.topicTiming.bestPublishTime, color: '#7c4dff' },
                  { label: 'Niche Saturation',value: result.topicTiming.nicheSaturation, color: result.topicTiming.nicheSaturation === 'High' ? '#ff1744' : result.topicTiming.nicheSaturation === 'Low' ? '#00c853' : '#ff9100' },
                ].map(m => (
                  <div key={m.label} style={{ background: '#0f0f0f', border: `1px solid ${m.color}33`, borderRadius: 8, padding: '10px 14px', minWidth: 110 }}>
                    <div style={{ fontSize: 10, color: '#444', marginBottom: 3 }}>{m.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>
              {result.topicTiming.saturationNote && (
                <div className="ai-text-block" style={{ marginBottom: 14 }}>{result.topicTiming.saturationNote}</div>
              )}
              {result.topicTiming.competitorVideos?.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                    Reference Videos in Your Niche
                  </div>
                  {result.topicTiming.competitorVideos.map((v, i) => (
                    <div key={i} style={{ background: '#0f0f0f', borderRadius: 8, padding: '10px 14px', marginBottom: 6, border: '1px solid #1a1a1a' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#ddd' }}>{v.title}</div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#ff9100', flexShrink: 0, marginLeft: 8 }}>{v.estimatedViews}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#666' }}>✓ {v.whatWorked}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* F — Success Prediction */}
          {result.successPrediction && (
            <div className="chart-card" style={{ marginBottom: 16, borderTop: '3px solid #7c4dff' }}>
              <h3 className="chart-title" style={{ marginBottom: 14 }}>📈 Success Prediction</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
                {[
                  { label: 'Views in First 7 Days',  value: result.successPrediction.viewRange7Days,     color: '#7c4dff' },
                  { label: 'Engagement Rate Range',  value: result.successPrediction.engagementRateRange, color: '#00c853' },
                  { label: 'Viral Probability',      value: result.successPrediction.viralProbability,   color: '#ff9100' },
                  { label: 'Growth Impact',          value: result.successPrediction.growthImpact,       color: result.successPrediction.growthImpact === 'positive' ? '#00c853' : result.successPrediction.growthImpact === 'negative' ? '#ff1744' : '#ff9100' },
                ].map(m => (
                  <div key={m.label} style={{ background: '#0f0f0f', borderRadius: 10, padding: '14px', border: `1px solid ${m.color}22` }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: m.color, marginBottom: 4 }}>{m.value}</div>
                    <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>{m.label}</div>
                  </div>
                ))}
              </div>
              {result.successPrediction.growthImpactNote && (
                <div className="ai-text-block" style={{ marginBottom: 10 }}>{result.successPrediction.growthImpactNote}</div>
              )}
              <div style={{ background: '#ffd60008', border: '1px solid #ffd60022', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#ffd600aa', lineHeight: 1.5 }}>
                ⚠ These predictions are estimates based on historical data from similar videos. Actual performance depends on many factors including YouTube algorithm, posting time, promotion, and viewer behavior. Use these as guidance only, not guarantees.
              </div>
            </div>
          )}

          {/* G — Fix Before Publishing */}
          {result.fixBeforePublishing?.length > 0 && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <h3 className="chart-title" style={{ marginBottom: 14 }}>🛠️ Fix Before Publishing</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {result.fixBeforePublishing.map((item, i) => (
                  <div key={i} style={{
                    background: '#0f0f0f', borderRadius: 10, padding: '14px 16px',
                    border: `1px solid ${priorityColor(item.priority)}22`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span>{priorityIcon(item.priority)}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: priorityColor(item.priority) }}>
                        {item.priority?.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0' }}>— {item.issue}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 6, lineHeight: 1.5 }}>
                      <strong style={{ color: '#888' }}>Why it matters:</strong> {item.why}
                    </div>
                    <div style={{ fontSize: 12, color: '#aaa', background: '#111', borderRadius: 6, padding: '8px 10px', lineHeight: 1.5 }}>
                      <strong style={{ color: '#00c853' }}>How to fix:</strong> {item.fix}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* H — What You're Doing Right */}
          {result.strengths?.length > 0 && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <h3 className="chart-title" style={{ marginBottom: 14 }}>✅ What You're Doing Right</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.strengths.map((s, i) => (
                  <div key={i} style={{
                    background: '#00c85308', border: '1px solid #00c85322',
                    borderRadius: 8, padding: '12px 14px',
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                  }}>
                    <span style={{ color: '#00c853', fontSize: 16, flexShrink: 0 }}>✓</span>
                    <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.6 }}>{s}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* I — Competitor Intelligence */}
          {result.competitorIntelligence?.length > 0 && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <h3 className="chart-title" style={{ marginBottom: 14 }}>⚔️ Competitor Intelligence</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {result.competitorIntelligence.map((v, i) => (
                  <div key={i} style={{ background: '#0f0f0f', borderRadius: 10, padding: '14px 16px', border: '1px solid #1e1e1e' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0', lineHeight: 1.4 }}>{v.title}</div>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#ff9100', flexShrink: 0 }}>{v.estimatedViews}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>
                      <span style={{ color: '#00c853' }}>Why it worked: </span>{v.successReason}
                    </div>
                    <div style={{ fontSize: 12, color: '#666', background: '#ff174408', borderRadius: 6, padding: '6px 10px' }}>
                      <span style={{ color: '#ff6666' }}>They did better: </span>{v.theyDidBetter}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* J — Relaunch Checklist */}
          <div className="chart-card" style={{ marginBottom: 16 }}>
            <h3 className="chart-title" style={{ marginBottom: 4 }}>☑️ Pre-Publish Checklist</h3>
            <p className="chart-subtitle" style={{ marginBottom: 14 }}>
              Check off each item before hitting publish.{' '}
              <span style={{ color: '#00c853' }}>{Object.values(checklist).filter(Boolean).length}/{CHECKLIST_ITEMS.length} done</span>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {CHECKLIST_ITEMS.map(item => (
                <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '8px 12px', borderRadius: 8, background: checklist[item.id] ? '#00c85308' : '#0f0f0f', border: `1px solid ${checklist[item.id] ? '#00c85322' : '#1a1a1a'}` }}>
                  <input
                    type="checkbox"
                    checked={!!checklist[item.id]}
                    onChange={() => setChecklist(c => ({ ...c, [item.id]: !c[item.id] }))}
                    style={{ width: 16, height: 16, accentColor: '#00c853', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 13, color: checklist[item.id] ? '#00c853' : '#888', textDecoration: checklist[item.id] ? 'line-through' : 'none' }}>
                    {item.text}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Save & Compare */}
          <div className="chart-card" style={{ marginBottom: 16 }}>
            <div className="chart-title-row">
              <h3 className="chart-title">💾 Save & Compare</h3>
              <button
                onClick={() => setShowHistory(h => !h)}
                style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#777', cursor: 'pointer' }}
              >
                {showHistory ? 'Hide' : 'View'} History ({history.length})
              </button>
            </div>
            <p className="chart-subtitle">Report auto-saved. Click below to review previous validations.</p>

            {showHistory && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.length === 0
                  ? <div style={{ fontSize: 13, color: '#444', textAlign: 'center', padding: '20px 0' }}>No saved reports yet.</div>
                  : history.map((h, i) => (
                    <div key={i} style={{
                      background: '#0f0f0f', borderRadius: 8, padding: '10px 14px',
                      border: '1px solid #1a1a1a', display: 'flex',
                      alignItems: 'center', gap: 10, cursor: 'pointer',
                    }} onClick={() => { setResult(h.result); setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth' }), 100); }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                        background: scoreColor(h.score) + '22', border: `2px solid ${scoreColor(h.score)}44`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 900, color: scoreColor(h.score),
                      }}>{h.grade}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</div>
                        <div style={{ fontSize: 11, color: '#444' }}>{h.score}/100 · {new Date(h.date).toLocaleDateString()}</div>
                      </div>
                      <span style={{ fontSize: 11, color: '#555' }}>Load →</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
