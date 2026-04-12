import { useState, useEffect, useRef } from 'react';
import { validateVideo } from '../api/claude';
import { fetchChannel } from '../api/youtube';
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
const EMOTIONS   = ['Curiosity','Surprise','Amusement','Trust','Relatability','Fear','Inspiration'];

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
    uploadFreq: 'Weekly', hook: '', midVideo: '', ending: '',
    primaryEmotion: 'Curiosity',
  });
  const [thumbPreview, setThumbPreview]       = useState(null);
  const [thumbDescription, setThumbDescription] = useState('');
  const [chQuery, setChQuery]                 = useState('');
  const [chSearching, setChSearching]         = useState(false);
  const [chResult, setChResult]               = useState(null);   // fetched channel object
  const [chError, setChError]                 = useState('');
  const [loading, setLoading]                 = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [result, setResult]             = useState(null);
  const [error, setError]               = useState('');
  const [history, setHistory]           = useState(loadHistory);
  const [showHistory, setShowHistory]   = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [checklist, setChecklist]       = useState({});
  const [copiedIdx, setCopiedIdx]       = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [lastThumbInputType, setLastThumbInputType] = useState('none');
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
      thumb:      !!thumbPreview || !!thumbDescription.trim(),
      hook:       form.hook.trim().length > 20,
      desc_keys:  form.description.length > 30,
      tags:       form.tags.split(',').filter(t => t.trim()).length >= 5,
      end_screen: c.end_screen  ?? false,
      cards:      c.cards       ?? false,
      best_time:  c.best_time   ?? false,
    }));
  }, [form, thumbPreview, thumbDescription]);

  if (!isPro) return <ProGate onUpgrade={onUpgrade} />;

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleChannelSearch = async () => {
    if (!chQuery.trim()) return;
    setChSearching(true);
    setChError('');
    setChResult(null);
    try {
      const ch = await fetchChannel(chQuery.trim());
      const avgV = (() => {
        const subs = parseInt(ch.statistics?.subscriberCount || 0);
        const vids = parseInt(ch.statistics?.videoCount || 0);
        const views = parseInt(ch.statistics?.viewCount || 0);
        return vids > 0 ? Math.round(views / vids) : 0;
      })();
      setChResult(ch);
      setForm(f => ({
        ...f,
        channelName: ch.snippet?.title || f.channelName,
        subscribers: ch.statistics?.subscriberCount || f.subscribers,
        avgViews:    avgV ? String(avgV) : f.avgViews,
      }));
    } catch (e) {
      setChError(e.message);
    } finally {
      setChSearching(false);
    }
  };

  const handleThumb = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setThumbPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!form.title.trim() || !form.hook.trim() || !form.midVideo.trim() || !form.ending.trim()) {
      setError('Please fill Hook, Mid Video, and Ending to analyze your video accurately.');
      return;
    }
    if (!canUseAI || !canUseAI()) {
      setError('No AI calls remaining. Upgrade your plan to continue.');
      return;
    }

    const contentDescription = `HOOK:\n${form.hook.trim()}\n\nMID:\n${form.midVideo.trim()}\n\nENDING:\n${form.ending.trim()}`;
    const thumbInputType = thumbPreview ? 'image' : thumbDescription.trim() ? 'text' : 'none';
    setLastThumbInputType(thumbInputType);
    const cacheKey = CACHE_PREFIX + 'v13_' + hashString(form.title + contentDescription + (thumbInputType === 'text' ? thumbDescription.trim() : thumbInputType));
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
      const data = await validateVideo({
        ...form,
        contentDescription,
        hasThumbnail: !!thumbPreview,
        thumbDescription: thumbPreview ? '' : thumbDescription.trim(),
        thumbInputType,
      });
      timers.forEach(clearTimeout);
      setProgressStep(6);
      consumeAICall();
      setResult(data);
      try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch {}
      saveHistory({ title: form.title, score: data.viralScore, grade: data.grade, date: new Date().toISOString(), result: data });
      setHistory(loadHistory());
      if ((data.viralScore ?? 0) >= 85) {
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

            {/* Thumbnail Description */}
            {!thumbPreview && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 10px' }}>
                  <div style={{ flex: 1, height: 1, background: '#1e1e1e' }} />
                  <span style={{ fontSize: 11, color: '#444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>or</span>
                  <div style={{ flex: 1, height: 1, background: '#1e1e1e' }} />
                </div>
                <label className="form-label">Describe Thumbnail <span style={{ color: '#444', fontWeight: 400 }}>(Optional)</span></label>
                <textarea className="form-input form-textarea"
                  placeholder={`Example: Close-up shocked face, dark background, red text "I LOST EVERYTHING"`}
                  value={thumbDescription}
                  onChange={e => setThumbDescription(e.target.value)}
                  rows={2}
                />
                <div style={{ fontSize: 11, color: '#555', marginTop: 5, fontStyle: 'italic' }}>
                  For most accurate results, upload your actual thumbnail image above.
                </div>
              </div>
            )}

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <h3 className="chart-title" style={{ margin: 0 }}>Section B — Channel Context</h3>
            <span style={{ fontSize: 12, color: '#555' }}>Optional — improves prediction accuracy</span>
          </div>

          {/* Channel search bar */}
          <div style={{ marginBottom: 16 }}>
            <label className="form-label">Search Your Channel</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                type="text"
                placeholder="@handle, channel name, or YouTube URL"
                value={chQuery}
                onChange={e => { setChQuery(e.target.value); setChError(''); }}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleChannelSearch())}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={handleChannelSearch}
                disabled={chSearching || !chQuery.trim()}
                className="btn-primary"
                style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                {chSearching ? <><span className="btn-spinner" /> Searching…</> : '🔍 Search'}
              </button>
            </div>
            {chError && (
              <div className="search-error" style={{ marginTop: 8 }}>{chError}</div>
            )}
          </div>

          {/* Channel result card */}
          {chResult && (() => {
            const subs  = parseInt(chResult.statistics?.subscriberCount || 0);
            const thumb = chResult.snippet?.thumbnails?.default?.url;
            const fmtSubs = subs >= 1e6 ? (subs/1e6).toFixed(1)+'M' : subs >= 1e3 ? (subs/1e3).toFixed(1)+'K' : String(subs);
            return (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
                background: '#00c85310', border: '1px solid #00c85333', borderRadius: 10, padding: '10px 14px',
              }}>
                {thumb && <img src={thumb} alt="" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#eee', marginBottom: 2 }}>
                    {chResult.snippet?.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#00c853' }}>{fmtSubs} subscribers · auto-filled below</div>
                </div>
                <button type="button" onClick={() => { setChResult(null); setChQuery(''); }} style={{
                  background: 'transparent', border: 'none', color: '#555', fontSize: 16, cursor: 'pointer', flexShrink: 0,
                }}>✕</button>
              </div>
            );
          })()}

          {/* Manual fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Channel Name <span style={{ color: '#555', fontWeight: 400 }}>(or leave blank)</span></label>
              <input className="form-input" type="text"
                placeholder="e.g. My Channel or @handle"
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
          <h3 className="chart-title" style={{ marginBottom: 4 }}>Section C — Content Details</h3>
          <p className="chart-subtitle" style={{ marginBottom: 16 }}>Describe your video in 3 stages so the AI can model hook strength, retention, and payoff accurately.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div>
              <label className="form-label">
                Hook (First 30 Seconds) <span style={{ color: '#ff1744' }}>*</span>
              </label>
              <textarea className="form-input form-textarea"
                placeholder="Describe the exact opening moment. What happens in the first 30 seconds that grabs attention?"
                value={form.hook}
                onChange={e => setField('hook', e.target.value)}
                rows={3}
              />
            </div>

            <div>
              <label className="form-label">
                Mid Video (Retention Structure) <span style={{ color: '#ff1744' }}>*</span>
              </label>
              <textarea className="form-input form-textarea"
                placeholder="What keeps the viewer watching? Is there a twist, escalation, or reversal? Or is it linear and predictable?"
                value={form.midVideo}
                onChange={e => setField('midVideo', e.target.value)}
                rows={4}
              />
            </div>

            <div>
              <label className="form-label">
                Ending / Payoff <span style={{ color: '#ff1744' }}>*</span>
              </label>
              <textarea className="form-input form-textarea"
                placeholder="What is the final outcome? Is there a surprising result, emotional payoff, or predictable ending?"
                value={form.ending}
                onChange={e => setField('ending', e.target.value)}
                rows={3}
              />
            </div>

            <div>
              <label className="form-label">Primary Emotion Target</label>
              <select className="form-input" value={form.primaryEmotion} onChange={e => setField('primaryEmotion', e.target.value)}>
                {EMOTIONS.map(em => <option key={em}>{em}</option>)}
              </select>
            </div>

          </div>
        </div>

        {error && <div className="search-error" style={{ marginBottom: 12 }}>{error}</div>}

        {/* Submit */}
        <div style={{ marginBottom: 32 }}>
          <button
            type="submit"
            disabled={loading || !form.title.trim() || !form.hook.trim() || !form.midVideo.trim() || !form.ending.trim()}
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

          {/* FINAL VERDICT BANNER */}
          {result.finalVerdict && (() => {
            const isBlock = result.finalVerdict === 'DO NOT UPLOAD';
            const color  = isBlock ? '#ff1744' : '#00c853';
            const bg     = isBlock ? '#ff174410' : '#00c85310';
            const border = isBlock ? '#ff174440' : '#00c85340';
            const icon   = isBlock ? '🚫' : '✅';
            const sub    = result.structuralStatus?.status === 'FAIL' ? result.structuralStatus.reason : null;
            return (
              <div style={{ background: bg, border: `2px solid ${border}`, borderRadius: 12, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <span style={{ fontSize: 24, flexShrink: 0, lineHeight: 1 }}>{icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 900, color, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: sub ? 4 : 0 }}>
                    {result.finalVerdict}
                  </div>
                  {sub && <div style={{ fontSize: 11, color: color + 'aa', lineHeight: 1.5 }}>{sub}</div>}
                </div>
              </div>
            );
          })()}

          {/* A — Dual Score + Verdict */}
          <div className="chart-card" style={{ marginBottom: 16, borderTop: `3px solid ${scoreColor(result.viralScore)}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
              <BigScoreRing score={result.viralScore} grade={result.grade} />
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  {result.formatStrength && (
                    <span style={{
                      fontSize: 11, fontWeight: 700,
                      color: result.formatStrength === 'High (Proven Pattern)' ? '#7c4dff' : '#555',
                      background: result.formatStrength === 'High (Proven Pattern)' ? '#7c4dff18' : '#55555518',
                      border: `1px solid ${result.formatStrength === 'High (Proven Pattern)' ? '#7c4dff44' : '#55555533'}`,
                      borderRadius: 20, padding: '3px 10px',
                    }}>
                      {result.formatStrength === 'High (Proven Pattern)' ? '⚡ ' : ''}{result.formatStrength}
                    </span>
                  )}
                  {result.contentType && (() => {
                    const ctColor = result.contentType === 'Viral' ? '#ff9100' : result.contentType === 'Value-Driven' ? '#00bcd4' : '#7c4dff';
                    return (
                      <span style={{ fontSize: 11, fontWeight: 700, color: ctColor, background: ctColor + '18', border: `1px solid ${ctColor}44`, borderRadius: 20, padding: '3px 10px' }}>
                        {result.contentType === 'Viral' ? '🔥' : result.contentType === 'Value-Driven' ? '💎' : '⚖️'} {result.contentType}
                      </span>
                    );
                  })()}
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: scoreColor(result.viralScore), marginBottom: 8, lineHeight: 1.3 }}>
                  {result.verdict || 'Analysis Complete'}
                </div>
                {/* Dual score row */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                  <div style={{ background: '#0f0f0f', borderRadius: 8, padding: '8px 14px', border: '1px solid #1e1e1e', flex: '1 1 100px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>Viral Score</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: scoreColor(result.viralScore) }}>{result.viralScore ?? '—'}<span style={{ fontSize: 11, color: '#444', fontWeight: 400 }}>/100</span></div>
                  </div>
                  {result.valueScore != null && (
                    <div style={{ background: '#0f0f0f', borderRadius: 8, padding: '8px 14px', border: '1px solid #00bcd422', flex: '1 1 100px' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#00bcd4', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>Value Score</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: barColor10(result.valueScore / 10) }}>{result.valueScore}<span style={{ fontSize: 11, color: '#444', fontWeight: 400 }}>/100</span></div>
                    </div>
                  )}
                </div>
                {result.contentVerdict && (() => {
                  const cvMap = {
                    'High Potential':                    { color: '#00c853', bg: '#00c85318', border: '#00c85333', icon: '✅' },
                    'Viral Candidate':                   { color: '#ff9100', bg: '#ff910018', border: '#ff910033', icon: '🔥' },
                    'Strong Value, Limited Reach':       { color: '#00bcd4', bg: '#00bcd418', border: '#00bcd433', icon: '💎' },
                    'Mid Performance — Needs Direction': { color: '#ffd600', bg: '#ffd60018', border: '#ffd60033', icon: '⚙️' },
                    'Weak Content':                      { color: '#ff1744', bg: '#ff174418', border: '#ff174433', icon: '🚫' },
                  };
                  const cv = cvMap[result.contentVerdict] || { color: '#666', bg: '#66666618', border: '#66666633', icon: '—' };
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#333' }}>Content Verdict</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: cv.color, background: cv.bg, border: `1px solid ${cv.border}`, borderRadius: 8, padding: '4px 14px' }}>
                        {cv.icon} {result.contentVerdict}
                      </span>
                      {result.contentVerdictDetail && (
                        <span style={{ fontSize: 10, color: '#555', fontStyle: 'italic' }}>{result.contentVerdictDetail}</span>
                      )}
                      {result.predictionConfidence && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: result.predictionConfidence === 'High' ? '#00c853' : result.predictionConfidence === 'Medium' ? '#ff9100' : '#ff1744', background: '#11111188', border: '1px solid #2a2a2a', borderRadius: 6, padding: '3px 8px' }}>
                          {result.predictionConfidence} Confidence
                        </span>
                      )}
                    </div>
                  );
                })()}
                <div style={{ fontSize: 11, color: '#3a3a3a', lineHeight: 1.5 }}>
                  Viral Score: algorithmic reach potential. Value Score: human impact + audience trust.
                </div>
              </div>
            </div>
            {/* Value Score breakdown */}
            {result.valueScoreBreakdown && (
              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[
                  { label: 'Insight Depth', value: result.valueScoreBreakdown.insightDepth },
                  { label: 'Authenticity', value: result.valueScoreBreakdown.authenticity },
                  { label: 'Relatability', value: result.valueScoreBreakdown.relatability },
                  { label: 'Takeaway', value: result.valueScoreBreakdown.takeaway },
                ].map(({ label, value }) => {
                  const c = barColor10(value);
                  return (
                    <div key={label} style={{ background: '#0f0f0f', borderRadius: 6, padding: '8px 10px', border: `1px solid ${c}22`, textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 900, color: c }}>{value ?? '—'}</div>
                      <div style={{ fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{label}</div>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Performance Prediction */}
            {result.performancePrediction && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {result.performancePrediction.algorithmOutlook && (
                  <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#888', lineHeight: 1.5 }}>
                    <span style={{ color: '#ff9100', fontWeight: 700, flexShrink: 0, minWidth: 90 }}>Algorithm:</span>
                    <span>{result.performancePrediction.algorithmOutlook}</span>
                  </div>
                )}
                {result.performancePrediction.audienceValueOutlook && (
                  <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#888', lineHeight: 1.5 }}>
                    <span style={{ color: '#00bcd4', fontWeight: 700, flexShrink: 0, minWidth: 90 }}>Audience:</span>
                    <span>{result.performancePrediction.audienceValueOutlook}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* A2 — Upload Decision */}
          {result.uploadDecision && (() => {
            const dec = result.uploadDecision.decision || '';
            const isReady = dec === 'Ready to Upload';
            const isDont  = dec === 'Do Not Upload';
            const color = isReady ? '#00c853' : isDont ? '#ff1744' : '#ffd600';
            const bg    = isReady ? '#00c85312' : isDont ? '#ff174412' : '#ffd60012';
            const border= isReady ? '#00c85333' : isDont ? '#ff174433' : '#ffd60033';
            const retentionLow = result.retentionEngine?.retentionPotential === 'Low';
            return (
              <div style={{ marginBottom: 16 }}>
                <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ fontSize: 22, flexShrink: 0 }}>{isReady ? '🚀' : isDont ? '🛑' : '⚙️'}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 900, color, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>{dec}</div>
                    <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5 }}>{result.uploadDecision.reason}</div>
                  </div>
                </div>
                {retentionLow && !isDont && (
                  <div style={{ marginTop: 6, background: '#ff174408', border: '1px solid #ff174422', borderRadius: 8, padding: '8px 14px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ color: '#ff6666', flexShrink: 0 }}>⚠</span>
                    <span style={{ fontSize: 11, color: '#cc6666', lineHeight: 1.5 }}>High retention risk — algorithm test likely to fail even with strong CTR.</span>
                  </div>
                )}
                {(() => {
                  const cdm = result.clickDeliveryMismatch;
                  const detected = cdm?.detected ?? (cdm === true);
                  if (!detected || !cdm?.conclusion) return null;
                  const sevColor = cdm.severity === 'Critical' ? '#ff1744' : cdm.severity === 'High' ? '#ff6d00' : '#ff9100';
                  return (
                    <div style={{ marginTop: 6, background: sevColor + '08', border: `1px solid ${sevColor}22`, borderRadius: 8, padding: '8px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: sevColor }}>Click Delivery Mismatch</span>
                        <span style={{ fontSize: 9, fontWeight: 800, color: sevColor, background: sevColor + '18', border: `1px solid ${sevColor}33`, borderRadius: 4, padding: '1px 6px' }}>{cdm.severity}</span>
                      </div>
                      <div style={{ fontSize: 11, color: sevColor + 'cc', lineHeight: 1.5 }}>{cdm.conclusion}</div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {/* A2b — Final Decision Intelligence */}
          {(result.dominantFactor || result.killMoment || result.topFix || result.expectedShift) && (() => {
            const domColor = result.dominantFactor === 'CTR' ? '#ff9100' : result.dominantFactor === 'Retention' ? '#ff1744' : '#555';
            const impactColor = result.topFix?.impact === 'High' ? '#00c853' : result.topFix?.impact === 'Medium' ? '#ff9100' : '#ff1744';
            return (
              <div style={{ background: '#08080e', border: '1px solid #7c4dff33', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#7c4dff', marginBottom: 14 }}>
                  🧠 Final Decision Intelligence
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                  {/* Row 1: Dominant Factor + Kill Moment */}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {result.dominantFactor && (
                      <div style={{ flex: '0 0 auto', background: '#111', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#333' }}>Dominant Factor</span>
                        <span style={{ fontSize: 13, fontWeight: 900, color: domColor, background: domColor + '18', border: `1px solid ${domColor}33`, borderRadius: 5, padding: '2px 10px' }}>
                          {result.dominantFactor}
                        </span>
                      </div>
                    )}
                    {result.killMoment && (
                      <div style={{ flex: 1, minWidth: 200, background: '#ff174408', border: '1px solid #ff174422', borderRadius: 8, padding: '10px 14px' }}>
                        <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#ff6666', marginBottom: 6 }}>☠ Kill Moment</div>
                        {typeof result.killMoment === 'string' ? (
                          <div style={{ fontSize: 12, color: '#cc8888', lineHeight: 1.4 }}>{result.killMoment}</div>
                        ) : (
                          <>
                            {result.killMoment.timestampEstimate && (
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#ff6666', marginBottom: 4 }}>⏱ {result.killMoment.timestampEstimate}</div>
                            )}
                            {result.killMoment.cause && (
                              <div style={{ fontSize: 12, color: '#cc8888', lineHeight: 1.4, marginBottom: 4 }}>{result.killMoment.cause}</div>
                            )}
                            {result.killMoment.viewerThought && (
                              <div style={{ fontSize: 11, color: '#666', fontStyle: 'italic', lineHeight: 1.4 }}>"{result.killMoment.viewerThought}"</div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Single Point of Failure */}
                  {result.singlePointOfFailure && (
                    <div style={{ background: '#ff174410', border: '1px solid #ff174440', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#ff4444', marginBottom: 5 }}>⚠️ Single Point of Failure</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#ff6666', lineHeight: 1.4 }}>{result.singlePointOfFailure}</div>
                    </div>
                  )}

                  {/* Row 2: Top Fix */}
                  {result.topFix && (
                    <div style={{ background: '#111', borderRadius: 8, padding: '12px 14px', border: `1px solid ${impactColor}22` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#555' }}>⚡ Top Fix</span>
                        <span style={{ fontSize: 10, fontWeight: 800, color: impactColor, background: impactColor + '18', border: `1px solid ${impactColor}33`, borderRadius: 4, padding: '1px 7px' }}>
                          {result.topFix.impact} Impact
                        </span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0', marginBottom: 4, lineHeight: 1.4 }}>{result.topFix.change}</div>
                      <div style={{ fontSize: 11, color: '#555', lineHeight: 1.4, marginBottom: (result.topFix.ctrDelta || result.topFix.distributionDelta || result.topFix.ifIgnored) ? 8 : 0 }}>{result.topFix.reason}</div>
                      {(result.topFix.ctrDelta || result.topFix.distributionDelta) && (
                        <div style={{ background: '#00c85308', border: '1px solid #00c85320', borderRadius: 6, padding: '7px 10px', marginBottom: result.topFix.ifIgnored ? 6 : 0 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#00c853', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Expected Impact If Applied</div>
                          {result.topFix.ctrDelta && <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>CTR: <span style={{ color: '#00c853', fontWeight: 700 }}>{result.topFix.ctrDelta}</span></div>}
                          {result.topFix.distributionDelta && <div style={{ fontSize: 11, color: '#666' }}>Distribution: <span style={{ color: '#00c853', fontWeight: 700 }}>{result.topFix.distributionDelta}</span></div>}
                        </div>
                      )}
                      {result.topFix.ifIgnored && (
                        <div style={{ background: '#ff174408', border: '1px solid #ff174422', borderRadius: 6, padding: '7px 10px' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#ff4444', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>If Ignored</div>
                          <div style={{ fontSize: 11, color: '#cc6666', lineHeight: 1.4 }}>{result.topFix.ifIgnored}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Row 3: Expected Shift */}
                  {result.expectedShift && (
                    <div style={{ background: '#00c85308', border: '1px solid #00c85322', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#00c853', marginBottom: 4 }}>→ Expected Shift</div>
                      <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5, fontStyle: 'italic' }}>{result.expectedShift}</div>
                    </div>
                  )}

                </div>
              </div>
            );
          })()}

          {/* A3 — Decision Engine: Failure Type + Conflict */}
          {(result.primaryFailureType || result.conflictLabel) && (() => {
            const failureColors = {
              'CTR Problem':        { color: '#ff9100', bg: '#ff910012', border: '#ff910033', icon: '📉' },
              'Retention Problem':  { color: '#ff1744', bg: '#ff174412', border: '#ff174433', icon: '📺' },
              'Packaging Mismatch': { color: '#7c4dff', bg: '#7c4dff12', border: '#7c4dff33', icon: '📦' },
              'Audience Mismatch':  { color: '#2196f3', bg: '#2196f312', border: '#2196f333', icon: '👥' },
            };
            const conflictColors = {
              'Click Trap':       { color: '#ff9100', bg: '#ff910012', border: '#ff910033' },
              'Hidden Gem':       { color: '#00c853', bg: '#00c85312', border: '#00c85333' },
              'Low Potential':    { color: '#ff1744', bg: '#ff174412', border: '#ff174433' },
              'Strong Candidate': { color: '#00c853', bg: '#00c85312', border: '#00c85333' },
              'Uneven':           { color: '#ff9100', bg: '#ff910012', border: '#ff910033' },
            };
            const ft = failureColors[result.primaryFailureType] || { color: '#7c4dff', bg: '#7c4dff12', border: '#7c4dff33', icon: '⚠️' };
            const cl = conflictColors[result.conflictLabel] || { color: '#888', bg: '#88888812', border: '#88888833' };
            return (
              <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                {result.primaryFailureType && (
                  <div style={{ flex: 1, minWidth: 180, background: ft.bg, border: `1px solid ${ft.border}`, borderRadius: 10, padding: '12px 16px' }}>
                    <div style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#444', marginBottom: 5 }}>Primary Failure Type</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 16 }}>{ft.icon}</span>
                      <span style={{ fontSize: 14, fontWeight: 900, color: ft.color }}>{result.primaryFailureType}</span>
                    </div>
                  </div>
                )}
                {result.conflictLabel && (
                  <div style={{ flex: 1, minWidth: 180, background: cl.bg, border: `1px solid ${cl.border}`, borderRadius: 10, padding: '12px 16px' }}>
                    <div style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#444', marginBottom: 5 }}>Signal</div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: cl.color, marginBottom: result.conflictExplanation ? 4 : 0 }}>{result.conflictLabel}</div>
                    {result.conflictExplanation && (
                      <div style={{ fontSize: 11, color: '#666', lineHeight: 1.4 }}>{result.conflictExplanation}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* B — Biggest Problem */}
          {result.biggestProblem && (
            <div style={{ background: '#ff174408', border: '1px solid #ff174433', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ff6666', marginBottom: 6 }}>🚨 Biggest Problem</div>
              <div style={{ fontSize: 13, color: '#ffaaaa', lineHeight: 1.5, fontWeight: 600 }}>{result.biggestProblem}</div>
            </div>
          )}

          {/* C — Why It Will Underperform */}
          {result.whyUnderperform?.length > 0 && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ff9100', marginBottom: 10 }}>🔍 Why It Will Underperform</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {result.whyUnderperform.map((point, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: '#888', lineHeight: 1.5 }}>
                    <span style={{ color: '#ff9100', flexShrink: 0, fontWeight: 700 }}>•</span>
                    <span>{point}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* D — Growth Levers */}
          {result.growthLevers?.length > 0 && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7c4dff' }}>⚡ Biggest Growth Levers</div>
                {result.primaryFailureType && (
                  <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#444', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, padding: '1px 7px' }}>
                    rooted in: {result.primaryFailureType}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.growthLevers.map((l, i) => {
                  const impactColor = l.impact === 'High' ? '#00c853' : l.impact === 'Medium' ? '#ff9100' : '#ff1744';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#111', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: '0.68rem', fontWeight: 900, color: '#7c4dff', flexShrink: 0, minWidth: 20, marginTop: 1 }}>#{l.rank}</div>
                      <div style={{ flex: 1, fontSize: 12, color: '#ccc', lineHeight: 1.5 }}>{l.lever}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: impactColor, background: impactColor + '18', border: `1px solid ${impactColor}33`, borderRadius: 4, padding: '1px 6px' }}>{l.impact}</span>
                        <span style={{ fontSize: 9, color: '#444', fontWeight: 600 }}>conf: {l.confidence}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* E — What To Fix */}
          {result.topFixes?.length > 0 && (
            <div className="chart-card" style={{ marginBottom: 16, borderTop: '3px solid #ffd600', background: 'linear-gradient(135deg, #0a0900 0%, #0f0f0a 100%)' }}>
              <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ffd600', marginBottom: 10 }}>
                ⚡ What To Fix (Highest Impact)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.topFixes.map((fix, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#e0e0e0', lineHeight: 1.5 }}>
                    <span style={{ color: '#ffd600', fontWeight: 900, flexShrink: 0 }}>{i + 1}.</span>
                    <span>{fix}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* E2 — CTR Engine + Retention Engine breakdown */}
          {(result.ctrEngine || result.retentionEngine) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              {result.ctrEngine && (
                <div style={{ background: '#09090f', border: '1px solid #1e1e2e', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7c4dff' }}>CTR Engine</div>
                    {result.ctrEngine.ctrPotential && (
                      <span style={{
                        fontSize: 10, fontWeight: 800, borderRadius: 4, padding: '1px 7px',
                        color: result.ctrEngine.ctrPotential === 'High' ? '#00c853' : result.ctrEngine.ctrPotential === 'Medium' ? '#ff9100' : '#ff1744',
                        background: result.ctrEngine.ctrPotential === 'High' ? '#00c85318' : result.ctrEngine.ctrPotential === 'Medium' ? '#ff910018' : '#ff174418',
                        border: `1px solid ${result.ctrEngine.ctrPotential === 'High' ? '#00c85333' : result.ctrEngine.ctrPotential === 'Medium' ? '#ff910033' : '#ff174433'}`,
                      }}>{result.ctrEngine.ctrPotential}</span>
                    )}
                  </div>
                  {result.ctrEngine.clickDrivers?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#00c853', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Click Drivers</div>
                      {result.ctrEngine.clickDrivers.map((d, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, fontSize: 11, color: '#888', lineHeight: 1.4, marginBottom: 3 }}>
                          <span style={{ color: '#00c853', flexShrink: 0 }}>+</span><span>{d}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {result.ctrEngine.clickKillers?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#ff6666', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Click Killers</div>
                      {result.ctrEngine.clickKillers.map((k, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, fontSize: 11, color: '#888', lineHeight: 1.4, marginBottom: 3 }}>
                          <span style={{ color: '#ff6666', flexShrink: 0 }}>−</span><span>{k}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {result.retentionEngine && (
                <div style={{ background: '#09090f', border: '1px solid #1e1e2e', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ff9100' }}>Retention Engine</div>
                    {result.retentionEngine.retentionPotential && (
                      <span style={{
                        fontSize: 10, fontWeight: 800, borderRadius: 4, padding: '1px 7px',
                        color: result.retentionEngine.retentionPotential === 'High' ? '#00c853' : result.retentionEngine.retentionPotential === 'Medium' ? '#ff9100' : '#ff1744',
                        background: result.retentionEngine.retentionPotential === 'High' ? '#00c85318' : result.retentionEngine.retentionPotential === 'Medium' ? '#ff910018' : '#ff174418',
                        border: `1px solid ${result.retentionEngine.retentionPotential === 'High' ? '#00c85333' : result.retentionEngine.retentionPotential === 'Medium' ? '#ff910033' : '#ff174433'}`,
                      }}>{result.retentionEngine.retentionPotential}</span>
                    )}
                  </div>
                  {result.retentionEngine.dropRisks?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#ff6666', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Drop Risks</div>
                      {result.retentionEngine.dropRisks.map((r, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, fontSize: 11, color: '#888', lineHeight: 1.4, marginBottom: 3 }}>
                          <span style={{ color: '#ff6666', flexShrink: 0 }}>↓</span><span>{r}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {result.retentionEngine.engagementDrivers?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#00c853', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Engagement Drivers</div>
                      {result.retentionEngine.engagementDrivers.map((d, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, fontSize: 11, color: '#888', lineHeight: 1.4, marginBottom: 3 }}>
                          <span style={{ color: '#00c853', flexShrink: 0 }}>↑</span><span>{d}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Viewer Experience Simulation */}
              {result.viewerExperience && (
                <div style={{ background: '#09090f', border: '1px solid #1e1e2e', borderRadius: 10, padding: '14px 16px', marginTop: 10 }}>
                  <div style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7c4dff', marginBottom: 10 }}>👁 Viewer Experience Simulation</div>
                  {result.viewerExperience.expectedEmotion && (
                    <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#888', lineHeight: 1.5, marginBottom: 5 }}>
                      <span style={{ color: '#ff9100', fontWeight: 700, flexShrink: 0, minWidth: 70 }}>Expected:</span>
                      <span>{result.viewerExperience.expectedEmotion}</span>
                    </div>
                  )}
                  {result.viewerExperience.actualEmotion && (
                    <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#888', lineHeight: 1.5, marginBottom: 5 }}>
                      <span style={{ color: '#00bcd4', fontWeight: 700, flexShrink: 0, minWidth: 70 }}>Actual:</span>
                      <span>{result.viewerExperience.actualEmotion}</span>
                    </div>
                  )}
                  {result.viewerExperience.emotionalJourney && (
                    <div style={{ fontSize: 12, color: result.viewerExperience.emotionalJourney.includes('misled') ? '#ff6666' : '#00c853', fontStyle: 'italic', lineHeight: 1.5, marginBottom: 5 }}>
                      → {result.viewerExperience.emotionalJourney}
                    </div>
                  )}
                  {result.viewerExperience.dropReason && (
                    <div style={{ background: '#ff174408', border: '1px solid #ff174422', borderRadius: 6, padding: '7px 10px', fontSize: 11, color: '#cc8888', fontStyle: 'italic', lineHeight: 1.4 }}>
                      "{result.viewerExperience.dropReason}"
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* F — Category Scores */}
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

          {/* G — Hook Analysis */}
          {result.hookAnalysis && (() => {
            const hq = result.hookAnalysis.hookQuality || '';
            const pq = result.hookAnalysis.pacingQuality || '';
            const hc = result.hookAnalysis.hookConfidence;
            const signals = result.hookAnalysis.detectedSignals || [];
            const overridden = result.hookAnalysis.overrideApplied;
            const hqColor = (hq === 'Strong') ? '#00c853' : hq === 'Medium' ? '#ff9100' : '#ff1744';
            const pqColor = (pq === 'Fast') ? '#00c853' : pq === 'Average' ? '#ff9100' : '#ff6d00';
            const hcColor = hc >= 70 ? '#00c853' : hc >= 50 ? '#ff9100' : '#ff1744';
            return (
              <div className="chart-card" style={{ marginBottom: 16 }}>
                <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7c4dff', marginBottom: 12 }}>
                  🎣 Hook Analysis
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: signals.length > 0 ? 10 : 0 }}>
                  <span style={{
                    background: hqColor + '22', border: `1px solid ${hqColor}44`,
                    borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 800, color: hqColor,
                  }}>
                    Hook: {hq || '—'}
                  </span>
                  {pq && (
                    <span style={{
                      background: pqColor + '22', border: `1px solid ${pqColor}44`,
                      borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, color: pqColor,
                    }}>
                      Pacing: {pq}
                    </span>
                  )}
                  {hc != null && (
                    <span style={{
                      background: hcColor + '18', border: `1px solid ${hcColor}33`,
                      borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, color: hcColor,
                    }}>
                      Confidence: {hc}
                    </span>
                  )}
                </div>
                {/* Hook confidence bar */}
                {hc != null && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ background: '#1a1a1a', borderRadius: 4, height: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${hc}%`, background: hcColor, borderRadius: 4, transition: 'width 0.6s' }} />
                    </div>
                    {result.hookAnalysis.reasoning && (
                      <div style={{ fontSize: 11, color: '#555', marginTop: 4, lineHeight: 1.4, fontStyle: 'italic' }}>{result.hookAnalysis.reasoning}</div>
                    )}
                  </div>
                )}
                {signals.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: overridden ? 10 : 0 }}>
                    {signals.map((s, i) => (
                      <span key={i} style={{
                        background: '#7c4dff18', border: '1px solid #7c4dff33',
                        borderRadius: 20, padding: '2px 10px', fontSize: 11, color: '#7c4dff', fontWeight: 600,
                      }}>{s}</span>
                    ))}
                  </div>
                )}
                {overridden && (
                  <div style={{
                    marginTop: 8, background: '#ff910014', border: '1px solid #ff910033',
                    borderRadius: 8, padding: '7px 12px', fontSize: 12, color: '#ff9100',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span>⚠️</span> Hook strength overridden based on content analysis{hc != null && hc < 50 ? ` (confidence: ${hc})` : ''}
                  </div>
                )}

                {/* Emotion Analysis sub-section */}
                {result.emotionAnalysis && (() => {
                  const ea = result.emotionAnalysis;
                  const ecColor = (ea.confidence >= 75) ? '#00c853' : (ea.confidence >= 50) ? '#ff9100' : '#ff1744';
                  const lowConf = ea.confidence != null && ea.confidence < 60;
                  return (
                    <div style={{ marginTop: 12, background: '#0a0a0a', borderRadius: 8, padding: '12px 14px', border: '1px solid #1e1e1e' }}>
                      <div style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ff4081', marginBottom: 10 }}>🎭 Emotion Analysis</div>

                      {/* Detected emotion badges */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                        {ea.detectedEmotion && (
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#ff4081', background: '#ff408118', border: '1px solid #ff408133', borderRadius: 6, padding: '3px 10px' }}>
                            {ea.detectedEmotion}
                          </span>
                        )}
                        {ea.detectedEmotionSecondary && ea.detectedEmotionSecondary !== 'null' && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#ff9100', background: '#ff910018', border: '1px solid #ff910033', borderRadius: 6, padding: '2px 8px' }}>
                            + {ea.detectedEmotionSecondary}
                          </span>
                        )}
                        {ea.confidence != null && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: ecColor, background: ecColor + '18', border: `1px solid ${ecColor}33`, borderRadius: 6, padding: '2px 8px' }}>
                            {ea.confidence}% signal confidence
                          </span>
                        )}
                      </div>

                      {/* Confidence bar */}
                      {ea.confidence != null && (
                        <div style={{ background: '#1a1a1a', borderRadius: 3, height: 3, marginBottom: 8, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${ea.confidence}%`, background: ecColor, borderRadius: 3, transition: 'width 0.6s' }} />
                        </div>
                      )}

                      {/* User emotion comparison */}
                      {ea.userEmotion && ea.userEmotion !== 'Not specified' && (
                        <div style={{ display: 'flex', gap: 8, fontSize: 11, color: '#555', marginBottom: ea.mismatchNote ? 6 : 0 }}>
                          <span style={{ color: '#444', flexShrink: 0 }}>User selected:</span>
                          <span style={{ color: '#666' }}>{ea.userEmotion}</span>
                        </div>
                      )}

                      {/* Mismatch note */}
                      {ea.mismatchNote && ea.mismatchNote !== 'null' && (
                        <div style={{ fontSize: 11, color: '#ff9100', fontStyle: 'italic', marginBottom: 6 }}>
                          ↻ {ea.mismatchNote}
                        </div>
                      )}

                      {/* Low confidence warning */}
                      {lowConf && ea.warningNote && ea.warningNote !== 'null' && (
                        <div style={{ background: '#ff174408', border: '1px solid #ff174422', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#ff6666', marginTop: 4 }}>
                          ⚠ {ea.warningNote}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {/* G2 — Hook Rewrite Engine */}
          {result.hookRewrites?.length > 0 && (() => {
            const stratColor = { 'Curiosity Gap': '#7c4dff', 'Conflict': '#ff1744', 'Emotion': '#ff4081', 'Payoff': '#00bcd4', 'Curiosity': '#7c4dff', 'Emotional': '#ff4081' };
            return (
              <div className="chart-card" style={{ marginBottom: 16, borderTop: '3px solid #7c4dff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                  <h3 className="chart-title" style={{ margin: 0 }}>🎣 Hook Rewrite Engine</h3>
                  {result.primaryFixStrategy && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#7c4dff', background: '#7c4dff18', border: '1px solid #7c4dff33', borderRadius: 20, padding: '3px 10px' }}>
                      Fix: {result.primaryFixStrategy}
                    </span>
                  )}
                </div>

                {/* Hook Rewrites */}
                <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Hook Scripts</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {result.hookRewrites.map((h, i) => {
                    const tc = stratColor[h.type] || '#7c4dff';
                    return (
                      <div key={i} style={{ background: '#0f0f0f', borderRadius: 8, padding: '12px 14px', border: `1px solid ${tc}33` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: tc, background: tc + '18', borderRadius: 10, padding: '2px 8px', border: `1px solid ${tc}33`, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h.type}</span>
                        </div>
                        <div style={{ fontSize: 13, color: '#ddd', lineHeight: 1.5, marginBottom: 6 }}>"{h.hook}"</div>
                        <div style={{ fontSize: 11, color: '#555' }}>{h.whyItWorks}</div>
                      </div>
                    );
                  })}
                </div>

              </div>
            );
          })()}

          {/* G3 — Thumbnail Rewrite Engine */}
          {result.thumbnailIdeas?.length > 0 && (() => {
            const stratColor = { 'Face Emotion': '#ff4081', 'Moment Snapshot': '#ff9100', 'Curiosity Object': '#00bcd4' };
            return (
              <div className="chart-card" style={{ marginBottom: 16, borderTop: '3px solid #00bcd4' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                  <h3 className="chart-title" style={{ margin: 0 }}>🖼️ Thumbnail Rewrite Engine</h3>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#00bcd4', background: '#00bcd418', border: '1px solid #00bcd433', borderRadius: 20, padding: '3px 10px' }}>
                    3 Strategies
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {result.thumbnailIdeas.map((t, i) => {
                    const tc = stratColor[t.strategy] || '#00bcd4';
                    return (
                      <div key={i} style={{ background: '#0f0f0f', borderRadius: 8, padding: '12px 14px', border: `1px solid ${tc}33` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: tc, background: tc + '18', borderRadius: 10, padding: '2px 8px', border: `1px solid ${tc}33`, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t.strategy}</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#ccc', marginBottom: 5 }}>{t.concept}</div>
                        {t.visual && <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>🎨 Visual: {t.visual}</div>}
                        {t.textOverlay && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>Text overlay:</span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, padding: '2px 8px', letterSpacing: 0.5 }}>"{t.textOverlay}"</span>
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{t.whyItWorks}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* G4 — Packaging Sync Engine */}
          {result.packagingAnalysis && (() => {
            const pa = result.packagingAnalysis;
            const score = pa.packagingScore ?? 0;
            const barColor = score >= 8 ? '#00c853' : score >= 5 ? '#ff9100' : '#ff1744';
            const issueColor = { 'Clickbait Mismatch': '#ff1744', 'Hook Delivery Failure': '#ff1744', 'Curiosity Gap Break': '#ff9100', 'Emotional Disconnect': '#ff9100', 'Dual Focus Conflict': '#ff9100', 'Weak Reinforcement': '#555' };
            const stratColor = { 'Curiosity': '#7c4dff', 'Conflict': '#ff1744', 'Emotion': '#ff4081', 'Payoff': '#00bcd4' };
            const fixColor = stratColor[pa.primaryFixStrategy] || '#7c4dff';
            return (
              <div className="chart-card" style={{ marginBottom: 16, borderTop: `3px solid ${barColor}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                  <h3 className="chart-title" style={{ margin: 0 }}>📦 Packaging Sync</h3>
                  <span style={{ fontSize: 22, fontWeight: 800, color: barColor }}>{score}<span style={{ fontSize: 13, color: '#555', fontWeight: 400 }}>/10</span></span>
                </div>

                {/* Score bar */}
                <div style={{ background: '#1a1a1a', borderRadius: 4, height: 6, marginBottom: 10, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${score * 10}%`, background: barColor, borderRadius: 4, transition: 'width 0.4s' }} />
                </div>

                {/* Summary */}
                {pa.summary && <div style={{ fontSize: 12, color: '#888', lineHeight: 1.6, marginBottom: 12 }}>{pa.summary}</div>}

                {/* Mismatch type tags */}
                {pa.detectedIssues?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                    {pa.detectedIssues.map((issue, i) => {
                      const ic = issueColor[issue] || '#555';
                      return (
                        <span key={i} style={{ fontSize: 10, fontWeight: 700, color: ic, background: ic + '18', border: `1px solid ${ic}33`, borderRadius: 10, padding: '3px 10px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          {issue}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Recommended Packaging */}
                {pa.recommendedPackaging && (
                  <div style={{ background: '#0a0a0a', borderRadius: 8, padding: '14px', border: '1px solid #1e1e1e' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Unified Direction</span>
                      {pa.primaryFixStrategy && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: fixColor, background: fixColor + '18', border: `1px solid ${fixColor}33`, borderRadius: 10, padding: '2px 8px' }}>
                          {pa.primaryFixStrategy}
                        </span>
                      )}
                    </div>
                    {[
                      { label: '🎯 Title', value: pa.recommendedPackaging.title },
                      { label: '🖼️ Thumbnail', value: pa.recommendedPackaging.thumbnailConcept },
                      { label: '🎣 Hook', value: pa.recommendedPackaging.hook },
                    ].map(({ label, value }) => value ? (
                      <div key={label} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.5, background: '#111', borderRadius: 6, padding: '8px 12px', border: '1px solid #1e1e1e' }}>{value}</div>
                      </div>
                    ) : null)}
                    {pa.recommendedPackaging.whyThisWorks && (
                      <div style={{ fontSize: 11, color: '#555', marginTop: 4, fontStyle: 'italic' }}>{pa.recommendedPackaging.whyThisWorks}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* H — Title Analysis */}
          {result.titleAnalysis && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <div className="chart-title-row">
                <h3 className="chart-title">🎯 Title Analysis</h3>
                <span style={{ background: '#7c4dff22', border: '1px solid #7c4dff44', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#b39ddb', fontWeight: 700 }}>
                  {result.titleAnalysis.rating}
                </span>
              </div>
              <div style={{ fontStyle: 'italic', color: '#888', fontSize: 13, margin: '8px 0 14px', padding: '10px 14px', background: '#0f0f0f', borderRadius: 8, border: '1px solid #1a1a1a' }}>
                "{form.title}"
              </div>

              {/* Strength / Problem / Fix */}
              {(result.titleAnalysis.strength || result.titleAnalysis.problem || result.titleAnalysis.fix) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                  {result.titleAnalysis.strength && (
                    <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#888', lineHeight: 1.5 }}>
                      <span style={{ color: '#00c853', fontWeight: 700, flexShrink: 0, minWidth: 64 }}>Strength:</span>
                      <span>{result.titleAnalysis.strength}</span>
                    </div>
                  )}
                  {result.titleAnalysis.problem && (
                    <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#888', lineHeight: 1.5 }}>
                      <span style={{ color: '#ff6666', fontWeight: 700, flexShrink: 0, minWidth: 64 }}>Problem:</span>
                      <span>{result.titleAnalysis.problem}</span>
                    </div>
                  )}
                  {result.titleAnalysis.fix && (
                    <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#888', lineHeight: 1.5 }}>
                      <span style={{ color: '#ffd600', fontWeight: 700, flexShrink: 0, minWidth: 64 }}>Fix:</span>
                      <span>{result.titleAnalysis.fix}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Issues */}
              {result.titleAnalysis.issues?.length > 0 && (
                <div style={{ background: '#ff174408', border: '1px solid #ff174422', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#ff6666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Issues Detected</div>
                  {result.titleAnalysis.issues.map((w, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'flex', gap: 6 }}>
                      <span style={{ color: '#ff6666', flexShrink: 0 }}>✗</span><span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 12, fontWeight: 700, color: '#7c4dff', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                {result.titleRewrites?.length > 0 ? '🎣 Hook-Driven Title Rewrites' : '3 Improved Title Alternatives'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(result.titleRewrites?.length > 0 ? result.titleRewrites : result.titleAnalysis.improvedTitles)?.map((t, i) => {
                  const titleText = t.title;
                  const subText   = t.strategy || t.reason || '';
                  const isRewrite = !!t.strategy;
                  return (
                    <div key={i} style={{ background: '#0f0f0f', borderRadius: 8, padding: '12px 14px', border: `1px solid ${isRewrite ? '#7c4dff33' : '#1e1e1e'}`, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        {isRewrite && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#7c4dff', background: '#7c4dff18', border: '1px solid #7c4dff33', borderRadius: 10, padding: '1px 8px', display: 'inline-block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            {t.strategy}
                          </span>
                        )}
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0', marginBottom: 4 }}>"{titleText}"</div>
                        <div style={{ fontSize: 12, color: '#666' }}>{isRewrite ? t.whyItWorks : subText}</div>
                      </div>
                      <button
                        onClick={() => copyTitle(titleText, i)}
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
                  );
                })}
              </div>
            </div>
          )}

          {/* I — Thumbnail Analysis */}
          {thumbPreview && result.thumbnailAnalysis && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <h3 className="chart-title" style={{ marginBottom: 14 }}>🖼️ Thumbnail Analysis</h3>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <img src={thumbPreview} alt="thumb" style={{ width: 180, height: 102, objectFit: 'cover', borderRadius: 8, border: '1px solid #2a2a2a', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    {[
                      { label: 'Focal Point',      value: result.thumbnailAnalysis.focalPoint },
                      { label: 'Text Load',         value: result.thumbnailAnalysis.textLoad },
                      { label: 'Curiosity Gap',     value: result.thumbnailAnalysis.curiosityGap },
                      { label: 'Visual Hierarchy',  value: result.thumbnailAnalysis.visualHierarchy },
                    ].filter(m => m.value).map(m => (
                      <div key={m.label} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.5 }}>
                        <span style={{ color: '#444', fontWeight: 700, flexShrink: 0, minWidth: 106 }}>{m.label}:</span>
                        <span style={{ color: '#888' }}>{m.value}</span>
                      </div>
                    ))}
                  </div>
                  {(result.thumbnailAnalysis.faceSizeNote || result.thumbnailAnalysis.elementCountNote || result.thumbnailAnalysis.contrastNote) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                      {[result.thumbnailAnalysis.faceSizeNote, result.thumbnailAnalysis.elementCountNote, result.thumbnailAnalysis.contrastNote].filter(Boolean).map((note, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#ff9100', background: '#ff910010', border: '1px solid #ff910022', borderRadius: 5, padding: '4px 8px' }}>
                          ⚠ {note}
                        </div>
                      ))}
                    </div>
                  )}
                  {result.thumbnailAnalysis.issues?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#ff6666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Issues</div>
                      {result.thumbnailAnalysis.issues.map((issue, i) => (
                        <div key={i} style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'flex', gap: 6 }}>
                          <span style={{ color: '#ff6666' }}>✗</span><span>{issue}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {result.thumbnailAnalysis.fixes?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#ff9100', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Fix</div>
                      {result.thumbnailAnalysis.fixes.map((fix, i) => (
                        <div key={i} style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'flex', gap: 6 }}>
                          <span style={{ color: '#ff9100' }}>→</span><span>{fix}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Legacy improvements field */}
                  {!result.thumbnailAnalysis.fixes && result.thumbnailAnalysis.improvements?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#ff9100', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Improvements</div>
                      {result.thumbnailAnalysis.improvements.map((tip, i) => (
                        <div key={i} style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'flex', gap: 6 }}>
                          <span style={{ color: '#ff9100' }}>#{i+1}</span><span>{tip}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* J — Retention Analysis */}
          {result.retentionAnalysis && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <h3 className="chart-title" style={{ marginBottom: 12 }}>🎥 Retention Analysis</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { label: 'Hook (0–30s)', value: result.retentionAnalysis.hook },
                  { label: 'Mid',          value: result.retentionAnalysis.mid },
                  { label: 'Ending',       value: result.retentionAnalysis.ending },
                ].filter(r => r.value).map(r => (
                  <div key={r.label} style={{ display: 'flex', gap: 10, background: '#111', borderRadius: 8, padding: '9px 12px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0, minWidth: 80, marginTop: 1 }}>{r.label}</span>
                    <span style={{ fontSize: 12, color: '#888', lineHeight: 1.5 }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* K — Viral Outlook */}
          {result.viralOutlook && (
            <div className="chart-card" style={{ marginBottom: 16, borderTop: '3px solid #7c4dff' }}>
              <h3 className="chart-title" style={{ marginBottom: 14 }}>📊 Viral Outlook</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
                {[
                  { label: 'CTR Potential',       value: result.viralOutlook.ctrPotential },
                  { label: 'Retention Potential', value: result.viralOutlook.retentionPotential },
                  { label: 'Novelty',             value: result.viralOutlook.novelty },
                ].map(m => {
                  const c = m.value === 'High' ? '#00c853' : m.value === 'Medium' ? '#ff9100' : '#ff1744';
                  return (
                    <div key={m.label} style={{ background: '#0f0f0f', borderRadius: 8, padding: '10px 12px', border: `1px solid ${c}22`, textAlign: 'center' }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: c, marginBottom: 3 }}>{m.value}</div>
                      <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5 }}>{m.label}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ fontSize: 12, color: '#555' }}>
                  Prediction confidence: <span style={{ color: result.viralOutlook.predictionConfidence === 'High' ? '#00c853' : result.viralOutlook.predictionConfidence === 'Medium' ? '#ff9100' : '#ff1744', fontWeight: 700 }}>{result.viralOutlook.predictionConfidence}</span>
                </div>
                {result.viralOutlook.finalVerdict && (
                  <span style={{
                    fontSize: 12, fontWeight: 800,
                    color: result.viralOutlook.finalVerdict === 'High Potential' ? '#00c853' : result.viralOutlook.finalVerdict === 'Flop Risk' ? '#ff1744' : '#ff9100',
                    background: result.viralOutlook.finalVerdict === 'High Potential' ? '#00c85318' : result.viralOutlook.finalVerdict === 'Flop Risk' ? '#ff174418' : '#ff910018',
                    border: `1px solid ${result.viralOutlook.finalVerdict === 'High Potential' ? '#00c85333' : result.viralOutlook.finalVerdict === 'Flop Risk' ? '#ff174433' : '#ff910033'}`,
                    borderRadius: 6, padding: '3px 10px',
                  }}>
                    {result.viralOutlook.finalVerdict}
                  </span>
                )}
              </div>
              {result.viralOutlook.viewRange7Days && (
                <div style={{ marginTop: 10, fontSize: 12, color: '#555' }}>
                  Estimated views in 7 days: <span style={{ color: '#aaa', fontWeight: 700 }}>{result.viralOutlook.viewRange7Days}</span>
                </div>
              )}
              {result.viralOutlook.spreadLimiter && (
                <div style={{ marginTop: 10, background: '#ff174408', border: '1px solid #ff174420', borderRadius: 8, padding: '9px 12px' }}>
                  <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: '#ff4444', marginBottom: 4 }}>🚧 Spread Limiter</div>
                  <div style={{ fontSize: 12, color: '#cc7777', lineHeight: 1.5 }}>{result.viralOutlook.spreadLimiter}</div>
                </div>
              )}
            </div>
          )}

          {/* L — Strategic Insight */}
          {result.strategicInsight && (
            <div style={{ background: '#0d0920', border: '1px solid #2d1060', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#a855f7', marginBottom: 6 }}>🧪 Strategic Insight</div>
              <div style={{ fontSize: 13, color: '#c4b5fd', lineHeight: 1.6 }}>{result.strategicInsight}</div>
            </div>
          )}

          {/* L2 — Strategic Recommendation */}
          {result.strategicRecommendation && (() => {
            const sr = result.strategicRecommendation;
            const priorityColor = sr.priority === 'Critical' ? '#ff1744' : sr.priority === 'High' ? '#ff9100' : '#00c853';
            const impactColor = sr.impact === 'High' ? '#00c853' : sr.impact === 'Medium' ? '#ff9100' : '#555';
            return (
              <div style={{ background: '#08080e', border: '1px solid #7c4dff44', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7c4dff' }}>🎯 Strategic Recommendation</span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: priorityColor, background: priorityColor + '18', border: `1px solid ${priorityColor}33`, borderRadius: 10, padding: '2px 8px' }}>
                    {sr.priority} Priority
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: impactColor, background: impactColor + '18', border: `1px solid ${impactColor}33`, borderRadius: 10, padding: '2px 8px' }}>
                    {sr.impact} Impact
                  </span>
                </div>
                {sr.direction && (
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#c4b5fd', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{sr.direction}</div>
                )}
                {sr.action && (
                  <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>{sr.action}</div>
                )}
              </div>
            );
          })()}

          {/* M — Topic Timing */}
          {result.topicTiming && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <h3 className="chart-title" style={{ marginBottom: 14 }}>📅 Topic Timing</h3>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                {[
                  { label: 'Topic Status',    value: result.topicTiming.status,           color: timingColor(result.topicTiming.status) },
                  { label: 'Best Day',         value: result.topicTiming.bestPublishDay,   color: '#7c4dff' },
                  { label: 'Best Time',        value: result.topicTiming.bestPublishTime,  color: '#7c4dff' },
                  { label: 'Niche Saturation', value: result.topicTiming.nicheSaturation,  color: result.topicTiming.nicheSaturation === 'High' ? '#ff1744' : result.topicTiming.nicheSaturation === 'Low' ? '#00c853' : '#ff9100' },
                ].map(m => (
                  <div key={m.label} style={{ background: '#0f0f0f', border: `1px solid ${m.color}33`, borderRadius: 8, padding: '10px 14px', minWidth: 110 }}>
                    <div style={{ fontSize: 10, color: '#444', marginBottom: 3 }}>{m.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>
              {result.topicTiming.saturationNote && (
                <div className="ai-text-block">{result.topicTiming.saturationNote}</div>
              )}
            </div>
          )}

          {/* N — What You're Doing Right */}
          {result.strengths?.length > 0 && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <h3 className="chart-title" style={{ marginBottom: 14 }}>✅ What You're Doing Right</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.strengths.map((s, i) => (
                  <div key={i} style={{ background: '#00c85308', border: '1px solid #00c85322', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ color: '#00c853', fontSize: 14, flexShrink: 0 }}>✓</span>
                    <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.6 }}>{s}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* O — Competitor Intelligence */}
          {result.competitorIntelligence?.length > 0 && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <h3 className="chart-title" style={{ marginBottom: 14 }}>⚔️ Competitor Intelligence</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {result.competitorIntelligence.map((v, i) => (
                  <div key={i} style={{ background: '#0f0f0f', borderRadius: 10, padding: '14px 16px', border: '1px solid #1e1e1e' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0', lineHeight: 1.4 }}>{v.title}</div>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#ff9100', flexShrink: 0 }}>{v.estimatedViews}</span>
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

          {/* Q — Distribution Potential */}
          {result.uploadReadiness && (() => {
            const ur = result.uploadReadiness;
            const rawScore = ur.score ?? 0;

            // UI Score Authority: re-sum from breakdown when present
            let displayScore = rawScore;
            let scoreOverridden = false;
            if (ur.scoreBreakdown) {
              const bd = ur.scoreBreakdown;
              const bonuses = (bd.baseline || 0) + (bd.hookQuality || 0) + (bd.pacingQuality || 0) +
                (bd.thumbnailStrength || 0) + (bd.thumbnailAppeal || 0) + (bd.packagingScore || 0);
              const penaltyTotal = (bd.penalties || []).reduce((s, p) => s + (p.value || 0), 0);
              const resum = Math.min(100, Math.max(0, bonuses + penaltyTotal));
              displayScore = resum;
              if (Math.abs(resum - rawScore) > 5) scoreOverridden = true;
            }

            // Apply emotion confidence cap (75 max when confidence < 60)
            const emotionConf = result.emotionAnalysis?.confidence;
            if (emotionConf != null && emotionConf < 60 && displayScore > 75) displayScore = 75;

            // Derive confidence from hookQuality + packagingScore (deterministic)
            const hookQ = result.hookAnalysis?.hookQuality;
            const pkgScore = result.packagingAnalysis?.packagingScore ?? null;
            let displayConfidence = (hookQ === 'Strong' && pkgScore >= 7) ? 'High'
              : (hookQ === 'Weak' || pkgScore < 6 || pkgScore === null) ? 'Low'
              : 'Medium';
            if (emotionConf != null && emotionConf < 60) {
              if (displayConfidence === 'High') displayConfidence = 'Medium';
              else if (displayConfidence === 'Medium') displayConfidence = 'Low';
            }

            const barColor = displayScore >= 80 ? '#00c853' : displayScore >= 60 ? '#ff9100' : '#ff1744';
            const confColor = { High: '#00c853', Medium: '#ff9100', Low: '#ff1744' };
            const cc = confColor[displayConfidence];

            return (
              <div className="chart-card" style={{ marginBottom: 16, borderTop: `3px solid ${barColor}` }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
                  <h3 className="chart-title" style={{ margin: 0 }}>📡 Distribution Potential</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: cc, background: cc + '18', border: `1px solid ${cc}33`, borderRadius: 10, padding: '2px 8px' }}>
                      {displayConfidence} Confidence
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: '#3a3a3a', marginBottom: 14, lineHeight: 1.5 }}>
                  Predicts algorithm testing potential — CTR + packaging only. Not a success guarantee.
                </div>

                {/* Score bar + clickable score */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: scoreOverridden ? 4 : 10 }}>
                  <button
                    onClick={() => setShowBreakdown(s => !s)}
                    title={ur.scoreBreakdown ? 'Click to see score breakdown' : ''}
                    style={{ background: 'none', border: 'none', cursor: ur.scoreBreakdown ? 'pointer' : 'default', padding: 0, lineHeight: 1 }}
                  >
                    <span style={{ fontSize: 28, fontWeight: 900, color: barColor }}>{displayScore}</span>
                    <span style={{ fontSize: 13, color: '#444', fontWeight: 400 }}>/100</span>
                    {ur.scoreBreakdown && <span style={{ fontSize: 10, color: '#444', marginLeft: 4 }}>{showBreakdown ? '▲' : '▼'}</span>}
                  </button>
                  <div style={{ flex: 1, background: '#1a1a1a', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${displayScore}%`, background: barColor, borderRadius: 4, transition: 'width 0.5s' }} />
                  </div>
                </div>

                {/* Adjusted for accuracy indicator */}
                {scoreOverridden && (
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 6, fontStyle: 'italic' }}>
                    Adjusted for accuracy (AI score: {rawScore})
                  </div>
                )}
                {/* Thumbnail description caution */}
                {lastThumbInputType === 'text' && (
                  <div style={{ fontSize: 10, color: '#ff910088', marginBottom: 10, fontStyle: 'italic' }}>
                    ⚠ Thumbnail score based on description — upload image for full accuracy.
                  </div>
                )}

                {/* Score breakdown (click-to-expand) */}
                {showBreakdown && ur.scoreBreakdown && (() => {
                  const bd = ur.scoreBreakdown;
                  const bonusRows = [
                    { label: 'Baseline', value: bd.baseline || 50 },
                    { label: 'Hook Quality', value: bd.hookQuality || 0 },
                    { label: 'Pacing', value: bd.pacingQuality || 0 },
                    { label: 'Thumbnail Strength', value: bd.thumbnailStrength || 0 },
                    { label: 'Thumbnail Appeal', value: bd.thumbnailAppeal || 0 },
                    { label: 'Packaging Score', value: bd.packagingScore || 0 },
                  ];
                  return (
                    <div style={{ background: '#0a0a0a', borderRadius: 8, padding: '10px 14px', marginBottom: 12, border: '1px solid #1e1e1e' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Score Breakdown</div>
                      {bonusRows.map(({ label, value }) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#666', marginBottom: 3 }}>
                          <span>{label}</span>
                          <span style={{ color: value > 0 ? '#00c853' : '#444', fontWeight: 700 }}>{value > 0 ? '+' : ''}{value}</span>
                        </div>
                      ))}
                      {(bd.penalties || []).map((p, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#666', marginBottom: 3 }}>
                          <span>{p.issue}</span>
                          <span style={{ color: '#ff1744', fontWeight: 700 }}>{p.value}</span>
                        </div>
                      ))}
                      <div style={{ borderTop: '1px solid #1a1a1a', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, color: barColor }}>
                        <span>Total</span>
                        <span>{displayScore}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Summary */}
                {ur.summary && <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6, marginBottom: 12 }}>{ur.summary}</div>}

                {/* Top Fix */}
                {ur.topFix && (
                  <div style={{ background: '#ffd60008', border: '1px solid #ffd60033', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#ffd600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Top Fix</div>
                    <div style={{ fontSize: 13, color: '#e0c700', lineHeight: 1.5 }}>{ur.topFix}</div>
                  </div>
                )}

                {/* Risk Flags */}
                {(() => {
                  const allFlags = [
                    ...(ur.riskFlags || []),
                    ...((result.clickDeliveryMismatch?.detected ?? result.clickDeliveryMismatch === true) ? ['Click Delivery Mismatch'] : []),
                  ];
                  if (!allFlags.length) return null;
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {allFlags.map((flag, i) => (
                        <span key={i} style={{ fontSize: 10, fontWeight: 700, color: '#ff6666', background: '#ff174410', border: '1px solid #ff174430', borderRadius: 10, padding: '3px 10px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          ⚠ {flag}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {/* R — Consequence Simulation */}
          {result.consequenceSimulation && (() => {
            const cs = result.consequenceSimulation;
            const distColor = cs.distributionState === 'Not Tested' ? '#555'
              : cs.distributionState === 'Limited' ? '#ff9100'
              : '#ff1744';
            return (
              <div className="chart-card" style={{ marginBottom: 16, borderTop: '3px solid #ff1744' }}>
                <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ff4444', marginBottom: 14 }}>
                  ⚡ If You Upload Now (Without Fixes)
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: cs.retentionDropPoint ? 8 : 12 }}>
                  {cs.expectedCTR && (
                    <div style={{ background: '#0f0f0f', borderRadius: 8, padding: '10px 14px', border: '1px solid #1e1e1e', flex: '1 1 120px' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Expected CTR</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: '#ff6666' }}>{cs.expectedCTR}</div>
                    </div>
                  )}
                  {cs.distributionState && (
                    <div style={{ background: '#0f0f0f', borderRadius: 8, padding: '10px 14px', border: `1px solid ${distColor}33`, flex: '1 1 140px' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Distribution</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: distColor }}>{cs.distributionState}</div>
                    </div>
                  )}
                </div>
                {cs.retentionDropPoint && cs.retentionDropPoint !== 'null' && (
                  <div style={{ background: '#ff174408', border: '1px solid #ff174420', borderRadius: 8, padding: '8px 12px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#ff4444', flexShrink: 0, marginTop: 1 }}>Drop Point</span>
                    <span style={{ fontSize: 11, color: '#cc7777', lineHeight: 1.5 }}>{cs.retentionDropPoint}</span>
                  </div>
                )}
                {cs.likelyOutcome && (
                  <div style={{ background: '#ff174408', border: '1px solid #ff174422', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#ff4444', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Likely Outcome</div>
                    <div style={{ fontSize: 13, color: '#cc7777', lineHeight: 1.5 }}>{cs.likelyOutcome}</div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* P — Pre-Publish Checklist */}
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
                        background: scoreColor(h.viralScore) + '22', border: `2px solid ${scoreColor(h.viralScore)}44`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 900, color: scoreColor(h.viralScore),
                      }}>{h.grade}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</div>
                        <div style={{ fontSize: 11, color: '#444' }}>{h.viralScore}/100 · {new Date(h.date).toLocaleDateString()}</div>
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
