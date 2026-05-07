import { useState, useCallback } from 'react';
import jsPDF from 'jspdf';
import { searchTrendingVideos, searchTopVideos } from '../api/youtube';
import { analyzeNiche, analyzeWhatWorks, analyzeVoice, generateScript, generateTitlesAndSEO, validateVideoBrief } from '../api/claude';
import { formatNum } from '../utils/analysis';
import * as storage from '../utils/storage';

const PLAN_KEY = 'tubeintel_plan_v1';

const STEPS = [
  { id: 1, label: 'Niche Research',    icon: '🔥', desc: 'Trending topics and content gaps in your niche' },
  { id: 2, label: 'Decode What Works', icon: '🧬', desc: 'Viral patterns from top competitor videos' },
  { id: 3, label: 'Voice Calibration', icon: '🎤', desc: 'Auto-detect your channel tone and writing style' },
  { id: 4, label: 'Script + Hooks',    icon: '✍️', desc: 'Hook, chapter outline, and closing CTA' },
  { id: 5, label: 'Title & SEO',       icon: '⚡', desc: 'Title variants, thumbnail concept, and tags' },
  { id: 6, label: 'Validate & Export', icon: '🚀', desc: 'Final quality gate and Video Brief PDF export' },
];

const BRIEF_FIELDS = [
  { key: 'topic',    label: 'Topic',          icon: '📝' },
  { key: 'niche',    label: 'Niche Insights', icon: '🔥' },
  { key: 'patterns', label: 'What Works',     icon: '🧬' },
  { key: 'voice',    label: 'Voice Profile',  icon: '🎤' },
  { key: 'script',   label: 'Script Outline', icon: '✍️' },
  { key: 'titles',   label: 'Title Options',  icon: '⚡' },
  { key: 'seo',      label: 'SEO Tags',       icon: '🏷️' },
];

const DEFAULT_BRIEF = { topic: null, niche: null, patterns: null, voice: null, script: null, titles: null, seo: null, validation: null };
const DEFAULT_PLAN  = { topic: '', audience: '', currentStep: 1, completedSteps: [], brief: { ...DEFAULT_BRIEF } };

function loadPlan() {
  const saved = storage.getJSON(PLAN_KEY);
  if (saved) return { ...DEFAULT_PLAN, ...saved, brief: { ...DEFAULT_BRIEF, ...(saved.brief || {}) } };
  return { ...DEFAULT_PLAN };
}

function savePlan(plan) {
  storage.setJSON(PLAN_KEY, { ...plan, savedAt: Date.now() });
}

function briefSummary(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw.titles)) {
    const sel = raw.selectedTitle ?? 0;
    return raw.titles[sel]?.title || null;
  }
  if (raw.primary_keyword) return `${raw.primary_keyword} · ${(raw.tags || []).slice(0, 3).join(', ')}`;
  return raw.opening_line || raw.voice_summary || raw.steal_this || raw.recommended_angle || raw.niche || JSON.stringify(raw).slice(0, 80);
}

// Topic Entry
function TopicEntry({ channel, onStart, onBack }) {
  const [topic, setTopic]       = useState('');
  const [audience, setAudience] = useState('');
  const canStart = topic.trim().length > 5;

  return (
    <div style={{ maxWidth: 640, margin: '60px auto', padding: '0 16px' }}>
      <button onClick={onBack} style={{ background: 'none', border: '1px solid #222', borderRadius: 8, color: '#555', fontSize: 13, padding: '7px 14px', cursor: 'pointer', marginBottom: 36 }}>
        &larr; Back
      </button>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#00b894', marginBottom: 8 }}>Plan My Video</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', marginBottom: 10, lineHeight: 1.25 }}>What's your next video about?</div>
      <div style={{ fontSize: 14, color: '#555', marginBottom: 36, lineHeight: 1.6 }}>
        Describe your topic and we'll research, script, and validate it step by step.
      </div>
      {channel && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, background: '#0a1a0f', border: '1px solid #00b89422', borderRadius: 10, padding: '10px 14px' }}>
          {channel.snippet?.thumbnails?.default?.url && (
            <img src={channel.snippet.thumbnails.default.url} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
          )}
          <div style={{ fontSize: 12, color: '#00b894' }}>
            Channel-aware AI &mdash; using <strong>{channel.snippet?.title}</strong>'s data
          </div>
        </div>
      )}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Video Topic *</label>
        <textarea
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="e.g. How I grew my channel to 10k subscribers in 3 months using Shorts"
          rows={3}
          style={{ width: '100%', boxSizing: 'border-box', background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 10, color: '#e0e0e0', fontSize: 15, padding: '14px 16px', resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
          onFocus={e => e.target.style.borderColor = '#00b894'}
          onBlur={e => e.target.style.borderColor = '#2a2a2a'}
        />
        <div style={{ fontSize: 11, color: '#333', marginTop: 6 }}>Be specific &mdash; the more detail, the better the AI outputs</div>
      </div>
      <div style={{ marginBottom: 32 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Target Audience <span style={{ fontWeight: 400, textTransform: 'none', color: '#333' }}>(optional)</span>
        </label>
        <input
          value={audience}
          onChange={e => setAudience(e.target.value)}
          placeholder="e.g. beginner creators, 18-30, interested in passive income"
          style={{ width: '100%', boxSizing: 'border-box', background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 10, color: '#e0e0e0', fontSize: 14, padding: '12px 16px', outline: 'none', fontFamily: 'inherit' }}
          onFocus={e => e.target.style.borderColor = '#00b894'}
          onBlur={e => e.target.style.borderColor = '#2a2a2a'}
        />
      </div>
      <button
        onClick={() => canStart && onStart(topic.trim(), audience.trim())}
        disabled={!canStart}
        style={{ width: '100%', padding: '15px 24px', background: canStart ? '#00b894' : '#111', border: 'none', borderRadius: 12, cursor: canStart ? 'pointer' : 'not-allowed', fontSize: 15, fontWeight: 800, color: canStart ? '#000' : '#333', transition: 'all 0.15s' }}
      >
        Start Planning &rarr;
      </button>
    </div>
  );
}

// Shared loading/error/idle sub-components
function StepIdle({ icon, title, desc, bullets, ctaLabel, onCta, note }) {
  return (
    <div style={{ padding: '48px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 48, marginBottom: 20 }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 14, color: '#555', lineHeight: 1.7, maxWidth: 380, marginBottom: 8 }}>{desc}</div>
      {note && <div style={{ fontSize: 12, color: '#333', marginBottom: 28 }}>{note}</div>}
      {bullets && (
        <div style={{ background: '#0a1a0f', border: '1px solid #00b89422', borderRadius: 12, padding: '16px 22px', marginBottom: 28, textAlign: 'left', width: '100%', maxWidth: 380 }}>
          <div style={{ fontSize: 11, color: '#00b894', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Will analyze</div>
          {bullets.map((b, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
              <span style={{ color: '#00b894', fontSize: 12, flexShrink: 0, marginTop: 1 }}>&#10003;</span>
              <span style={{ fontSize: 13, color: '#888' }}>{b}</span>
            </div>
          ))}
        </div>
      )}
      <button onClick={onCta} style={{ padding: '13px 32px', background: '#00b894', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, color: '#000', cursor: 'pointer' }}>
        {ctaLabel}
      </button>
    </div>
  );
}

function StepLoading({ lines }) {
  return (
    <div style={{ padding: '80px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
      <div className="btn-spinner" style={{ width: 32, height: 32, marginBottom: 20 }} />
      {lines.map((l, i) => (
        <div key={i} style={{ fontSize: i === 0 ? 15 : 13, fontWeight: i === 0 ? 700 : 400, color: i === 0 ? '#e0e0e0' : '#444', marginBottom: 4 }}>{l}</div>
      ))}
    </div>
  );
}

function StepError({ message, onRetry }) {
  return (
    <div style={{ padding: '60px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 36, marginBottom: 16 }}>&#9888;&#65039;</div>
      <div style={{ fontSize: 14, color: '#f87171', marginBottom: 20 }}>{message}</div>
      <button onClick={onRetry} style={{ padding: '10px 24px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#ccc', fontSize: 13, cursor: 'pointer' }}>Try Again</button>
    </div>
  );
}

function SavedBanner({ onRerun, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', background: '#0a1a0f', border: '1px solid #00b89422', borderRadius: 10 }}>
      <span style={{ color: '#00b894' }}>&#10003;</span>
      <span style={{ fontSize: 13, color: '#00b894', fontWeight: 600 }}>{label || 'Saved to brief'}</span>
      {onRerun && <button onClick={onRerun} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #1a2a1a', borderRadius: 6, color: '#444', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>&#8635; Re-run</button>}
    </div>
  );
}

// Step 1: Niche Research
function NicheResearchStep({ channel, videos, plan, onComplete, canUseAI, consumeAICall, onUpgrade }) {
  const cached = plan.brief.niche;
  const [status,        setStatus]        = useState(cached ? 'done' : 'idle');
  const [result,        setResult]        = useState(cached || null);
  const [error,         setError]         = useState('');
  const [selectedAngle, setSelectedAngle] = useState(null);

  const channelName     = channel?.snippet?.title || 'your channel';
  const subscriberCount = formatNum(parseInt(channel?.statistics?.subscriberCount || 0));
  const recentTitles    = (videos || []).slice(0, 10).map(v => v.snippet?.title || '').filter(Boolean);
  const isDone          = plan.completedSteps.includes(1);

  async function run() {
    if (!canUseAI()) { onUpgrade(); return; }
    consumeAICall();
    setStatus('loading'); setError('');
    try {
      const topicQuery = plan.topic.split(/\s+/).slice(0, 6).join(' ');
      const raw = await searchTrendingVideos(topicQuery, 20);
      const trendingVideos = raw.map(v => ({
        title: v.snippet?.title || '', channelTitle: v.snippet?.channelTitle || '',
        views: formatNum(parseInt(v.statistics?.viewCount || 0)),
      }));
      const parsed = await analyzeNiche({ topic: plan.topic, audience: plan.audience, channelName, subscriberCount, recentTitles, trendingVideos });
      setResult(parsed); setSelectedAngle(null); setStatus('done');
    } catch (e) { setError(e.message || 'Analysis failed.'); setStatus('error'); }
  }

  const SIGNAL_COLOR = { high: '#00b894', medium: '#f59e0b', low: '#555' };

  if (status === 'idle') return (
    <StepIdle icon="&#128293;" title="Niche Research"
      desc="Analyzes trending videos in your niche to identify content gaps and the best angle for your specific video."
      note="Uses your channel data + YouTube search - burns 1 AI call"
      bullets={[`Topic: "${plan.topic.slice(0, 55)}${plan.topic.length > 55 ? '...' : ''}"`, `Channel: ${channelName}`, 'Trending videos: last 30 days']}
      ctaLabel="Analyze My Niche" onCta={run} />
  );
  if (status === 'loading') return <StepLoading lines={['Scanning your niche...', 'Fetching trending videos + running AI analysis']} />;
  if (status === 'error')   return <StepError message={error} onRetry={run} />;

  return (
    <div style={{ padding: '22px 26px', flex: 1, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
        <div style={{ background: '#00b89422', border: '1px solid #00b89444', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, color: '#00b894' }}>
          {result.niche || 'Your Niche'}
        </div>
        {isDone && <span style={{ fontSize: 11, background: '#00b89422', color: '#00b894', borderRadius: 4, padding: '2px 8px', fontWeight: 700 }}>SAVED TO BRIEF</span>}
        <button onClick={run} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #1a1a1a', borderRadius: 6, color: '#444', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>&#8635; Re-run</button>
      </div>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Trending Angles</div>
          <div style={{ fontSize: 11, color: '#333' }}>— click one to select it as your angle</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(result.trends || []).map((t, i) => {
            const isSel = selectedAngle === i;
            return (
              <div key={i} onClick={() => !isDone && setSelectedAngle(isSel ? null : i)}
                style={{ background: isSel ? '#0a1a0f' : '#111', border: `1px solid ${isSel ? '#00b894' : '#1a1a1a'}`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 12, cursor: isDone ? 'default' : 'pointer', transition: 'all 0.12s' }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: isSel ? '#00b89433' : '#1a1a1a', border: `1px solid ${isSel ? '#00b894' : '#2a2a2a'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: isSel ? '#00b894' : '#555', flexShrink: 0, marginTop: 1 }}>
                  {isSel ? '&#10003;' : i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: isSel ? '#fff' : '#e0e0e0', marginBottom: 4 }}>{t.angle}</div>
                  <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>{t.why}</div>
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, color: SIGNAL_COLOR[t.signal] || '#555', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{t.signal}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Content Gaps</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {(result.gaps || []).map((gap, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#111', border: '1px solid #1a3a2a', borderRadius: 8, padding: '10px 14px' }}>
              <span style={{ color: '#00b894', fontSize: 14, flexShrink: 0, marginTop: 1 }}>&#9670;</span>
              <span style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{gap}</span>
            </div>
          ))}
        </div>
      </div>
      {result.recommended_angle && (
        <div onClick={() => !isDone && setSelectedAngle(null)}
          style={{ marginBottom: 22, background: '#0a1a0f', border: `1px solid ${selectedAngle === null ? '#00b894' : '#00b89433'}`, borderRadius: 12, padding: '16px 18px', cursor: isDone ? 'default' : 'pointer', transition: 'border-color 0.12s' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#00b894', letterSpacing: '0.1em', textTransform: 'uppercase' }}>AI Recommended Angle</div>
            {selectedAngle === null && <span style={{ fontSize: 9, fontWeight: 800, background: '#00b89422', color: '#00b894', borderRadius: 4, padding: '2px 6px' }}>SELECTED</span>}
          </div>
          <div style={{ fontSize: 14, color: '#e0e0e0', lineHeight: 1.6 }}>{result.recommended_angle}</div>
        </div>
      )}
      {result.hook_idea && (
        <div style={{ marginBottom: 26, background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Hook Idea</div>
          <div style={{ fontSize: 14, color: '#bbb', fontStyle: 'italic', lineHeight: 1.6 }}>"{result.hook_idea}"</div>
        </div>
      )}
      {isDone
        ? <SavedBanner onRerun={run} />
        : <button
            onClick={() => onComplete(1, 'niche', {
              ...result,
              recommended_angle: selectedAngle !== null ? result.trends?.[selectedAngle]?.angle : result.recommended_angle,
            })}
            style={{ width: '100%', padding: '14px', background: '#00b894', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, color: '#000', cursor: 'pointer' }}>
            {selectedAngle !== null ? `Save Angle ${selectedAngle + 1} to Brief` : 'Save AI Recommendation to Brief'} &amp; Continue &rarr;
          </button>
      }
    </div>
  );
}

// Step 2: Decode What Works
function DecodeWhatWorksStep({ channel, plan, onComplete, canUseAI, consumeAICall, onUpgrade }) {
  const cached = plan.brief.patterns;
  const [status,  setStatus]  = useState(cached ? 'done' : 'idle');
  const [result,  setResult]  = useState(cached || null);
  const [topVids, setTopVids] = useState([]);
  const [error,   setError]   = useState('');

  const channelName = channel?.snippet?.title || 'your channel';
  const nicheLabel  = plan.brief.niche?.niche || null;
  const searchQuery = nicheLabel || plan.topic.split(/\s+/).slice(0, 5).join(' ');
  const isDone      = plan.completedSteps.includes(2);

  async function run() {
    if (!canUseAI()) { onUpgrade(); return; }
    consumeAICall();
    setStatus('loading'); setError('');
    try {
      const raw = await searchTopVideos(searchQuery, 15);
      const videos = raw.map(v => ({
        title:        v.snippet?.title || '',
        channelTitle: v.snippet?.channelTitle || '',
        views:        formatNum(parseInt(v.statistics?.viewCount || 0)),
      }));
      setTopVids(videos);
      const parsed = await analyzeWhatWorks({ topic: plan.topic, niche: nicheLabel, channelName, topVideos: videos });
      setResult(parsed); setStatus('done');
    } catch (e) { setError(e.message || 'Analysis failed.'); setStatus('error'); }
  }

  if (status === 'idle') return (
    <StepIdle icon="&#129516;" title="Decode What Works"
      desc="Fetches top-performing videos in your niche and extracts the hook formulas, title patterns, and thumbnail strategies driving the most views."
      note="YouTube all-time top videos + AI analysis - burns 1 AI call"
      bullets={[
        `Search: "${searchQuery.slice(0, 50)}${searchQuery.length > 50 ? '...' : ''}"`,
        nicheLabel ? `Niche from Step 1: ${nicheLabel}` : 'Run Step 1 first for richer niche context',
        'Analyzes up to 15 top videos',
      ]}
      ctaLabel="Decode Top Videos" onCta={run} />
  );
  if (status === 'loading') return <StepLoading lines={['Fetching top videos in your niche...', 'Extracting hooks, title patterns & thumbnail strategies']} />;
  if (status === 'error')   return <StepError message={error} onRetry={run} />;

  return (
    <div style={{ padding: '22px 26px', flex: 1, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
        <div style={{ background: '#0d1f3a', border: '1px solid #1e3a5f44', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, color: '#60a5fa' }}>
          {topVids.length || 15} videos analyzed
        </div>
        {isDone && <span style={{ fontSize: 11, background: '#00b89422', color: '#00b894', borderRadius: 4, padding: '2px 8px', fontWeight: 700 }}>SAVED TO BRIEF</span>}
        <button onClick={run} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #1a1a1a', borderRadius: 6, color: '#444', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>&#8635; Re-run</button>
      </div>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Hook Formulas</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(result.hooks || []).map((h, i) => (
            <div key={i} style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#1a1a1a', border: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#555', flexShrink: 0 }}>{i + 1}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0' }}>{h.formula}</div>
              </div>
              {h.example && <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic', marginBottom: 8, paddingLeft: 28 }}>"{h.example}"</div>}
              {h.template && <div style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 7, padding: '8px 12px', fontSize: 12, color: '#60a5fa', fontFamily: 'monospace', marginLeft: 28 }}>{h.template}</div>}
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Title Patterns</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(result.title_patterns || []).map((t, i) => (
            <div key={i} style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0', marginBottom: 6 }}>{t.pattern}</div>
              {t.example && <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>e.g. "{t.example}"</div>}
              {t.template && <div style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 7, padding: '8px 12px', fontSize: 12, color: '#a78bfa', fontFamily: 'monospace' }}>{t.template}</div>}
            </div>
          ))}
        </div>
      </div>
      {(result.thumbnail_strategy || []).length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Thumbnail Strategy</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {result.thumbnail_strategy.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#111', border: '1px solid #1a1a1a', borderRadius: 8, padding: '10px 14px' }}>
                <span style={{ color: '#a78bfa', fontSize: 14, flexShrink: 0, marginTop: 1 }}>&#9656;</span>
                <span style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {result.format_insights && (
        <div style={{ marginBottom: 22, background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Format Insights</div>
          <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.6 }}>{result.format_insights}</div>
        </div>
      )}
      {result.steal_this && (
        <div style={{ marginBottom: 26, background: '#0d1f3a', border: '1px solid #1e3a5f', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Steal This for Your Video</div>
          <div style={{ fontSize: 14, color: '#e0e0e0', lineHeight: 1.6 }}>{result.steal_this}</div>
        </div>
      )}
      {isDone
        ? <SavedBanner onRerun={run} />
        : <button onClick={() => onComplete(2, 'patterns', result)} style={{ width: '100%', padding: '14px', background: '#00b894', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, color: '#000', cursor: 'pointer' }}>Save to Brief &amp; Continue &rarr;</button>
      }
    </div>
  );
}

// Step 3: Voice Calibration
function VoiceCalibrationStep({ channel, videos, plan, onComplete, canUseAI, consumeAICall, onUpgrade }) {
  const cached = plan.brief.voice;
  const [status, setStatus] = useState(cached ? 'done' : 'idle');
  const [result, setResult] = useState(cached || null);
  const [error,  setError]  = useState('');

  const isDone      = plan.completedSteps.includes(3);
  const channelName = channel?.snippet?.title || '';
  const hasChannel  = !!channel;
  const videoCount  = Math.min((videos || []).length, 20);
  const topByViews  = [...(videos || [])]
    .sort((a, b) => parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0))
    .slice(0, 20);

  async function run() {
    if (!canUseAI()) { onUpgrade(); return; }
    consumeAICall();
    setStatus('loading'); setError('');
    try {
      const topTitles = topByViews.map(v => v.snippet?.title || '').filter(Boolean);
      const sampleDescriptions = topByViews.slice(0, 5)
        .map(v => (v.snippet?.description || '').slice(0, 200).replace(/\n/g, ' ').trim())
        .filter(Boolean);
      const channelDescription = (channel?.snippet?.description || '').slice(0, 400);
      const parsed = await analyzeVoice({ channelName, channelDescription, topTitles, sampleDescriptions });
      setResult(parsed); setStatus('done');
    } catch (e) { setError(e.message || 'Analysis failed.'); setStatus('error'); }
  }

  if (!hasChannel) return (
    <div style={{ padding: '60px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 48, marginBottom: 20 }}>&#127908;</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Voice Calibration</div>
      <div style={{ fontSize: 14, color: '#555', lineHeight: 1.7, maxWidth: 340 }}>Load your channel from the dashboard first. Voice Calibration reads your existing video patterns to match your tone.</div>
    </div>
  );

  if (status === 'idle') return (
    <StepIdle icon="&#127908;" title="Voice Calibration"
      desc="Reads your top videos to extract your unique tone, writing style, and content personality so everything generated sounds like you."
      note="No extra API calls - uses already-loaded channel data - burns 1 AI call"
      bullets={[`Channel: ${channelName}`, `Analyzing top ${videoCount} videos by view count`, 'Extracts: tone, title style, pacing, vocabulary patterns']}
      ctaLabel="Calibrate My Voice" onCta={run} />
  );
  if (status === 'loading') return <StepLoading lines={['Reading your channel content patterns...', 'Extracting tone, style and vocabulary signals']} />;
  if (status === 'error')   return <StepError message={error} onRetry={run} />;

  return (
    <div style={{ padding: '22px 26px', flex: 1, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
        <div style={{ background: '#1a0a2e', border: '1px solid #6d28d944', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, color: '#c084fc' }}>
          {result.tone}
        </div>
        {(result.personality_tags || []).map(tag => (
          <div key={tag} style={{ background: '#111', border: '1px solid #222', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: '#888' }}>{tag}</div>
        ))}
        {isDone && <span style={{ fontSize: 11, background: '#00b89422', color: '#00b894', borderRadius: 4, padding: '2px 8px', fontWeight: 700 }}>SAVED</span>}
        <button onClick={run} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #1a1a1a', borderRadius: 6, color: '#444', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>&#8635; Re-run</button>
      </div>
      {result.voice_summary && (
        <div style={{ marginBottom: 22, background: '#1a0a2e', border: '1px solid #6d28d933', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#c084fc', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Voice Summary</div>
          <div style={{ fontSize: 14, color: '#e0e0e0', lineHeight: 1.7 }}>{result.voice_summary}</div>
        </div>
      )}
      {result.title_style && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Title Style</div>
          <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 10, padding: '14px 16px', fontSize: 13, color: '#ccc', lineHeight: 1.6 }}>{result.title_style}</div>
        </div>
      )}
      {(result.common_patterns || []).length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Content Patterns</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {result.common_patterns.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#111', border: '1px solid #1a1a1a', borderRadius: 8, padding: '10px 14px' }}>
                <span style={{ color: '#c084fc', fontSize: 14, flexShrink: 0, marginTop: 1 }}>&#9656;</span>
                <span style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{p}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {(result.avoid || []).length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Avoid (Off-Brand)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {result.avoid.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#1a0d0d', border: '1px solid #3a1a1a', borderRadius: 8, padding: '10px 14px' }}>
                <span style={{ color: '#f87171', fontSize: 12, flexShrink: 0, marginTop: 1 }}>&#10005;</span>
                <span style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{a}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {result.script_style_guide && (
        <div style={{ marginBottom: 26, background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Script Style Guide</div>
          <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.8, whiteSpace: 'pre-line' }}>{result.script_style_guide}</div>
        </div>
      )}
      {isDone
        ? <SavedBanner onRerun={run} />
        : <button onClick={() => onComplete(3, 'voice', result)} style={{ width: '100%', padding: '14px', background: '#00b894', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, color: '#000', cursor: 'pointer' }}>Save to Brief &amp; Continue &rarr;</button>
      }
    </div>
  );
}

// Step 4: Script + Hooks
function ScriptHooksStep({ channel, plan, onComplete, canUseAI, consumeAICall, onUpgrade }) {
  const cached      = plan.brief.script;
  const [status,   setStatus]  = useState(cached ? 'done' : 'idle');
  const [result,   setResult]  = useState(cached || null);
  const [selected, setSelected] = useState(cached?.selectedHook ?? 0);
  const [error,    setError]   = useState('');
  const isDone = plan.completedSteps.includes(4);

  const nicheData    = plan.brief.niche    || {};
  const patternsData = plan.brief.patterns || {};
  const voiceData    = plan.brief.voice    || {};

  const contextBullets = [
    `Topic: "${plan.topic.slice(0, 55)}${plan.topic.length > 55 ? '...' : ''}"`,
    nicheData.recommended_angle ? 'Niche angle from Step 1' : 'Step 1 not run (richer output if complete)',
    patternsData.hooks?.length  ? 'Hook formulas from Step 2' : 'Step 2 not run (richer output if complete)',
    voiceData.tone              ? `Voice profile: ${voiceData.tone}` : 'Step 3 not run (richer output if complete)',
  ];

  async function run() {
    if (!canUseAI()) { onUpgrade(); return; }
    consumeAICall();
    setStatus('loading'); setError('');
    try {
      const parsed = await generateScript({
        topic:            plan.topic,
        audience:         plan.audience,
        channelName:      channel?.snippet?.title || '',
        niche:            nicheData.niche,
        recommendedAngle: nicheData.recommended_angle,
        hookIdea:         nicheData.hook_idea,
        hookFormulas:     patternsData.hooks,
        tone:             voiceData.tone,
        scriptStyleGuide: voiceData.script_style_guide,
      });
      setResult(parsed); setSelected(0); setStatus('done');
    } catch (e) { setError(e.message || 'Generation failed.'); setStatus('error'); }
  }

  if (status === 'idle') return (
    <StepIdle icon="&#9997;&#65039;" title="Script + Hooks"
      desc="Writes 3 hook variations and a full chapter outline in your voice, using niche research and viral pattern data from the previous steps."
      note="Burns 1 AI call - richer output if Steps 1-3 are complete"
      bullets={contextBullets}
      ctaLabel="Generate Script" onCta={run} />
  );
  if (status === 'loading') return <StepLoading lines={['Writing your script outline...', 'Crafting 3 hook variations in your voice']} />;
  if (status === 'error')   return <StepError message={error} onRetry={run} />;

  const hooks   = result.hooks   || [];
  const outline = result.outline || [];

  return (
    <div style={{ padding: '22px 26px', flex: 1, overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0' }}>Pick your hook</div>
        {isDone && <span style={{ fontSize: 11, background: '#00b89422', color: '#00b894', borderRadius: 4, padding: '2px 8px', fontWeight: 700 }}>SAVED</span>}
        <button onClick={run} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #1a1a1a', borderRadius: 6, color: '#444', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>&#8635; Re-run</button>
      </div>

      {/* Hook selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 26 }}>
        {hooks.map((h, i) => {
          const isSel = selected === i;
          return (
            <div key={i} onClick={() => !isDone && setSelected(i)}
              style={{ background: isSel ? '#0a1a0f' : '#111', border: `1px solid ${isSel ? '#00b894' : '#1a1a1a'}`, borderRadius: 12, padding: '16px 18px', cursor: isDone ? 'default' : 'pointer', transition: 'all 0.15s' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, background: isSel ? '#00b894' : '#1a1a1a', color: isSel ? '#000' : '#555' }}>
                  {i + 1}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: isSel ? '#00b894' : '#888', flex: 1 }}>{h.type}</div>
                {isSel && <span style={{ fontSize: 10, fontWeight: 800, background: '#00b89422', color: '#00b894', borderRadius: 4, padding: '2px 8px' }}>SELECTED</span>}
              </div>
              <div style={{ fontSize: 13, color: isSel ? '#e0e0e0' : '#666', lineHeight: 1.7, fontStyle: 'italic' }}>"{h.script}"</div>
            </div>
          );
        })}
      </div>

      {/* Chapter outline */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Chapter Outline</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {outline.map((sec, i) => (
            <div key={i} style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#1a1a1a', border: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#555', flexShrink: 0 }}>{i + 1}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0', flex: 1 }}>{sec.section}</div>
                {sec.duration && <span style={{ fontSize: 10, color: '#555', background: '#1a1a1a', borderRadius: 4, padding: '2px 8px' }}>{sec.duration}</span>}
              </div>
              <div style={{ paddingLeft: 30, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(sec.talking_points || []).map((pt, j) => (
                  <div key={j} style={{ display: 'flex', gap: 8, fontSize: 12, color: '#888', lineHeight: 1.5 }}>
                    <span style={{ color: '#333', flexShrink: 0 }}>-</span>
                    <span>{pt}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Closing CTA */}
      {result.cta && (
        <div style={{ marginBottom: 26, background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Closing CTA</div>
          <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.7, fontStyle: 'italic' }}>"{result.cta}"</div>
        </div>
      )}

      {isDone
        ? <SavedBanner onRerun={run} label={`Saved - Hook ${selected + 1} selected`} />
        : <button onClick={() => onComplete(4, 'script', { ...result, selectedHook: selected })}
            style={{ width: '100%', padding: '14px', background: '#00b894', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, color: '#000', cursor: 'pointer' }}>
            Save Hook {selected + 1} to Brief &amp; Continue &rarr;
          </button>
      }
    </div>
  );
}

// Step 5: Title & SEO
function TitleSEOStep({ channel, plan, onComplete, canUseAI, consumeAICall, onUpgrade }) {
  const cachedTitles = plan.brief.titles;
  const [status,   setStatus]   = useState(cachedTitles ? 'done' : 'idle');
  const [result,   setResult]   = useState(cachedTitles || null);
  const [selected, setSelected] = useState(cachedTitles?.selectedTitle ?? 0);
  const [copied,   setCopied]   = useState('');
  const [error,    setError]    = useState('');
  const isDone = plan.completedSteps.includes(5);

  const nicheData    = plan.brief.niche    || {};
  const patternsData = plan.brief.patterns || {};
  const voiceData    = plan.brief.voice    || {};
  const scriptData   = plan.brief.script   || {};

  const openingLine = scriptData.hooks?.[scriptData.selectedHook ?? 0]?.script || scriptData.opening_line;

  const contextBullets = [
    `Topic: "${plan.topic.slice(0, 50)}${plan.topic.length > 50 ? '...' : ''}"`,
    nicheData.niche         ? `Niche: ${nicheData.niche}`              : 'Step 1 not run (add for SEO depth)',
    patternsData.title_patterns?.length ? 'Title formulas from Step 2' : 'Step 2 not run (add for proven formulas)',
    voiceData.title_style   ? 'Title style from Step 3'                : 'Step 3 not run (add for voice match)',
    openingLine             ? 'Script hook from Step 4'                : 'Step 4 not run (add for hook alignment)',
  ];

  async function run() {
    if (!canUseAI()) { onUpgrade(); return; }
    consumeAICall();
    setStatus('loading'); setError('');
    try {
      const parsed = await generateTitlesAndSEO({
        topic:          plan.topic,
        audience:       plan.audience,
        channelName:    channel?.snippet?.title || '',
        niche:          nicheData.niche,
        recommendedAngle: nicheData.recommended_angle,
        titlePatterns:  patternsData.title_patterns,
        titleStyle:     voiceData.title_style,
        tone:           voiceData.tone,
        openingLine,
      });
      setResult(parsed); setSelected(0); setStatus('done');
    } catch (e) { setError(e.message || 'Generation failed.'); setStatus('error'); }
  }

  function copyText(text, key) {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  }

  function save() {
    const titleData = { titles: result.titles, selectedTitle: selected, thumbnail_concept: result.thumbnail_concept };
    const seoData   = { primary_keyword: result.primary_keyword, tags: result.tags, description_opening: result.description_opening };
    onComplete(5, 'titles', titleData, { seo: seoData });
  }

  if (status === 'idle') return (
    <StepIdle icon="&#9889;&#65039;" title="Title &amp; SEO"
      desc="Generates 5 high-CTR title variants, a thumbnail concept, primary keyword, 15 SEO tags, and an optimised description opening."
      note="Burns 1 AI call - richer output if Steps 1-4 are complete"
      bullets={contextBullets}
      ctaLabel="Generate Titles &amp; SEO" onCta={run} />
  );
  if (status === 'loading') return <StepLoading lines={['Crafting title variants and SEO package...', 'Optimising for search + click-through rate']} />;
  if (status === 'error')   return <StepError message={error} onRetry={run} />;

  const titles = result.titles || [];
  const tags   = result.tags   || [];

  return (
    <div style={{ padding: '22px 26px', flex: 1, overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0' }}>Pick your title</div>
        {isDone && <span style={{ fontSize: 11, background: '#00b89422', color: '#00b894', borderRadius: 4, padding: '2px 8px', fontWeight: 700 }}>SAVED</span>}
        <button onClick={run} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #1a1a1a', borderRadius: 6, color: '#444', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>&#8635; Re-run</button>
      </div>

      {/* Title selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 26 }}>
        {titles.map((t, i) => {
          const isSel = selected === i;
          return (
            <div key={i} onClick={() => !isDone && setSelected(i)}
              style={{ background: isSel ? '#0a1a0f' : '#111', border: `1px solid ${isSel ? '#00b894' : '#1a1a1a'}`, borderRadius: 12, padding: '14px 16px', cursor: isDone ? 'default' : 'pointer', transition: 'all 0.15s' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, background: isSel ? '#00b894' : '#1a1a1a', color: isSel ? '#000' : '#555' }}>{i + 1}</div>
                {t.formula && <span style={{ fontSize: 10, color: isSel ? '#00b894' : '#555', background: isSel ? '#00b89411' : '#1a1a1a', borderRadius: 4, padding: '2px 8px', fontWeight: 700 }}>{t.formula}</span>}
                {isSel && <span style={{ fontSize: 10, fontWeight: 800, background: '#00b89422', color: '#00b894', borderRadius: 4, padding: '2px 8px', marginLeft: 'auto' }}>SELECTED</span>}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: isSel ? '#fff' : '#aaa', marginBottom: t.angle ? 6 : 0, lineHeight: 1.4 }}>{t.title}</div>
              {t.angle && <div style={{ fontSize: 12, color: isSel ? '#00b89488' : '#333', lineHeight: 1.5 }}>{t.angle}</div>}
            </div>
          );
        })}
      </div>

      {/* Thumbnail concept */}
      {result.thumbnail_concept && (
        <div style={{ marginBottom: 22, background: '#0d1f3a', border: '1px solid #1e3a5f', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Thumbnail Concept</div>
          <div style={{ fontSize: 13, color: '#c0d4f0', lineHeight: 1.7 }}>{result.thumbnail_concept}</div>
        </div>
      )}

      {/* Primary keyword + tags */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase' }}>SEO Tags</div>
          {result.primary_keyword && (
            <span style={{ fontSize: 11, background: '#00b89422', color: '#00b894', borderRadius: 4, padding: '2px 8px', fontWeight: 700 }}>
              Primary: {result.primary_keyword}
            </span>
          )}
          <button
            onClick={() => copyText(tags.join(', '), 'tags')}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid #1a1a1a', borderRadius: 6, color: copied === 'tags' ? '#00b894' : '#555', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}
          >
            {copied === 'tags' ? '&#10003; Copied' : 'Copy All'}
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tags.map((tag, i) => (
            <span key={i} style={{ background: '#111', border: '1px solid #222', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#888' }}>{tag}</span>
          ))}
        </div>
      </div>

      {/* Description opening */}
      {result.description_opening && (
        <div style={{ marginBottom: 26, background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Description Opening</div>
            <button
              onClick={() => copyText(result.description_opening, 'desc')}
              style={{ marginLeft: 'auto', background: 'none', border: '1px solid #2a2a2a', borderRadius: 6, color: copied === 'desc' ? '#00b894' : '#555', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}
            >
              {copied === 'desc' ? '&#10003; Copied' : 'Copy'}
            </button>
          </div>
          <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.7 }}>{result.description_opening}</div>
        </div>
      )}

      {isDone
        ? <SavedBanner onRerun={run} label={`Saved - "${titles[selected]?.title?.slice(0, 40)}..."`} />
        : <button onClick={save} style={{ width: '100%', padding: '14px', background: '#00b894', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, color: '#000', cursor: 'pointer' }}>
            Save Title {selected + 1} to Brief &amp; Continue &rarr;
          </button>
      }
    </div>
  );
}

// Step 6: Validate & Export
function buildBriefText(plan, validation) {
  const b = plan.brief;
  const lines = [`VIDEO BRIEF — ${plan.topic}`, '='.repeat(56)];
  if (plan.audience) lines.push(`Audience: ${plan.audience}`);

  if (b.niche) {
    lines.push(`\nNICHE: ${b.niche.niche || ''}`);
    if (b.niche.recommended_angle) lines.push(`Angle: ${b.niche.recommended_angle}`);
  }
  if (b.patterns?.steal_this) lines.push(`\nWHAT WORKS\n${b.patterns.steal_this}`);
  if (b.voice?.voice_summary)  lines.push(`\nVOICE (${b.voice.tone})\n${b.voice.voice_summary}`);

  if (b.script) {
    const hi = b.script.selectedHook ?? 0;
    const hook = b.script.hooks?.[hi];
    if (hook) lines.push(`\nOPENING HOOK (${hook.type})\n"${hook.script}"`);
    if (b.script.outline?.length) {
      const ol = b.script.outline.map((s, i) =>
        `${i + 1}. ${s.section} (${s.duration || ''})\n${(s.talking_points || []).map(p => `   - ${p}`).join('\n')}`
      ).join('\n');
      lines.push(`\nCHAPTER OUTLINE\n${ol}`);
    }
    if (b.script.cta) lines.push(`\nCLOSING CTA\n"${b.script.cta}"`);
  }

  if (b.titles) {
    const ti = b.titles.selectedTitle ?? 0;
    const t  = b.titles.titles?.[ti];
    if (t) lines.push(`\nTITLE\n${t.title}`);
    if (b.titles.thumbnail_concept) lines.push(`\nTHUMBNAIL\n${b.titles.thumbnail_concept}`);
  }
  if (b.seo) {
    if (b.seo.primary_keyword)     lines.push(`\nPRIMARY KEYWORD\n${b.seo.primary_keyword}`);
    if (b.seo.tags?.length)        lines.push(`\nSEO TAGS\n${b.seo.tags.join(', ')}`);
    if (b.seo.description_opening) lines.push(`\nDESCRIPTION OPENING\n${b.seo.description_opening}`);
  }
  if (validation) {
    lines.push(`\nVALIDATION: ${validation.score}/100 — ${validation.decision}`);
    if (validation.brief_summary) lines.push(validation.brief_summary);
  }
  return lines.join('\n');
}

function buildBriefPDF(plan, validation) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = 595, M = 40, CW = W - M * 2;
  let y = 0;

  doc.setFillColor('#00b894');
  doc.rect(0, 0, W, 5, 'F');
  doc.setFillColor('#0d0d0d');
  doc.rect(0, 5, W, 75, 'F');
  doc.setTextColor('#00b894');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('TUBEINTEL — PLAN MY VIDEO', M, 26);
  doc.setTextColor('#ffffff');
  doc.setFontSize(18);
  doc.text('Video Brief', M, 54);
  doc.setTextColor('#555555');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), W - M, 54, { align: 'right' });
  y = 104;

  doc.setTextColor('#111111');
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  const topicLines = doc.splitTextToSize(plan.topic, CW);
  doc.text(topicLines, M, y);
  y += topicLines.length * 19 + 4;

  if (plan.audience) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#666666');
    doc.text('Audience: ' + plan.audience, M, y);
    y += 16;
  }
  doc.setDrawColor('#e5e5e5');
  doc.line(M, y + 6, W - M, y + 6);
  y += 22;

  function addSection(title, content) {
    if (!content) return;
    if (y > 740) { doc.addPage(); y = 48; }
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor('#00b894');
    doc.text(title.toUpperCase(), M, y);
    y += 13;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#333333');
    const lines = doc.splitTextToSize(String(content), CW);
    if (y + lines.length * 13 > 800) { doc.addPage(); y = 48; }
    doc.text(lines, M, y);
    y += lines.length * 13 + 16;
  }

  const b = plan.brief;
  if (b.niche) {
    const parts = [b.niche.niche].filter(Boolean);
    if (b.niche.recommended_angle) parts.push('Angle: ' + b.niche.recommended_angle);
    if (b.niche.hook_idea) parts.push('Hook idea: ' + b.niche.hook_idea);
    addSection('Niche Research', parts.join('\n'));
  }
  if (b.patterns?.steal_this) addSection('What Works', b.patterns.steal_this);
  if (b.voice) {
    const parts = ['Tone: ' + (b.voice.tone || '')];
    if (b.voice.voice_summary) parts.push(b.voice.voice_summary);
    addSection('Voice Profile', parts.join('\n'));
  }
  if (b.script) {
    const hi = b.script.selectedHook ?? 0;
    const hook = b.script.hooks?.[hi];
    if (hook) addSection('Opening Hook (' + hook.type + ')', '"' + hook.script + '"');
    if (b.script.outline?.length) {
      const ol = b.script.outline.map((s, i) =>
        (i + 1) + '. ' + s.section + (s.duration ? ' (' + s.duration + ')' : '') +
        (s.talking_points?.length ? '\n' + s.talking_points.map(p => '  - ' + p).join('\n') : '')
      ).join('\n\n');
      addSection('Chapter Outline', ol);
    }
    if (b.script.cta) addSection('Closing CTA', '"' + b.script.cta + '"');
  }
  if (b.titles) {
    const ti = b.titles.selectedTitle ?? 0;
    const t = b.titles.titles?.[ti];
    if (t) addSection('Title', t.title);
    if (b.titles.thumbnail_concept) addSection('Thumbnail Concept', b.titles.thumbnail_concept);
  }
  if (b.seo) {
    if (b.seo.primary_keyword) addSection('Primary Keyword', b.seo.primary_keyword);
    if (b.seo.tags?.length) addSection('SEO Tags', b.seo.tags.join(', '));
    if (b.seo.description_opening) addSection('Description Opening', b.seo.description_opening);
  }
  if (validation?.score != null) {
    addSection('Validation Score', validation.score + '/100 — ' + validation.decision + '\n' + (validation.decision_reason || ''));
    if (validation.strengths?.length) addSection('Strengths', validation.strengths.map(s => '• ' + s).join('\n'));
    if (validation.improvements?.length) addSection('Improvements', validation.improvements.map(imp => '• ' + imp.issue + ': ' + imp.fix).join('\n'));
  }

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#aaaaaa');
    doc.text('TubeIntel — Video Brief', M, 830);
    doc.text('Page ' + i + ' of ' + pageCount, W - M, 830, { align: 'right' });
  }

  const slug = plan.topic.slice(0, 40).replace(/[^a-z0-9]/gi, '-').toLowerCase();
  doc.save('video-brief-' + slug + '.pdf');
}

const SCORE_COLOR = s => s >= 75 ? '#00b894' : s >= 50 ? '#f59e0b' : '#ef4444';
const DECISION_META = {
  GO:       { color: '#00b894', bg: '#0a1a0f', border: '#00b89433', label: 'GO' },
  ALMOST:   { color: '#f59e0b', bg: '#1a1200', border: '#f59e0b33', label: 'ALMOST' },
  'NOT YET':{ color: '#ef4444', bg: '#1a0808', border: '#ef444433', label: 'NOT YET' },
};

function ValidateExportStep({ plan, onComplete, canUseAI, consumeAICall, onUpgrade }) {
  const cached = plan.brief.validation;
  const [status,  setStatus]  = useState(cached ? 'done' : 'idle');
  const [result,  setResult]  = useState(cached || null);
  const [copied,  setCopied]  = useState(false);
  const [error,   setError]   = useState('');
  const isDone = plan.completedSteps.includes(6);

  const b = plan.brief;
  const completedFields = [
    { label: 'Topic',           done: !!plan.topic },
    { label: 'Niche Research',  done: !!b.niche },
    { label: 'Decode What Works', done: !!b.patterns },
    { label: 'Voice Profile',   done: !!b.voice },
    { label: 'Script + Hooks',  done: !!b.script },
    { label: 'Title & SEO',     done: !!(b.titles && b.seo) },
  ];
  const doneCount = completedFields.filter(f => f.done).length;

  async function run() {
    if (!canUseAI()) { onUpgrade(); return; }
    consumeAICall();
    setStatus('loading'); setError('');
    try {
      const hookIdx   = b.script?.selectedHook ?? 0;
      const titleIdx  = b.titles?.selectedTitle ?? 0;
      const parsed = await validateVideoBrief({
        topic:               plan.topic,
        audience:            plan.audience,
        niche:               b.niche?.niche,
        recommendedAngle:    b.niche?.recommended_angle,
        chosenHook:          b.script?.hooks?.[hookIdx]?.script,
        chosenTitle:         b.titles?.titles?.[titleIdx]?.title,
        thumbnailConcept:    b.titles?.thumbnail_concept,
        primaryKeyword:      b.seo?.primary_keyword,
        tags:                b.seo?.tags,
        descriptionOpening:  b.seo?.description_opening,
        voiceTone:           b.voice?.tone,
        voiceSummary:        b.voice?.voice_summary,
        hasScript:           !!b.script?.outline?.length,
      });
      setResult(parsed); setStatus('done');
    } catch (e) { setError(e.message || 'Validation failed.'); setStatus('error'); }
  }

  function copyBrief() {
    const text = buildBriefText(plan, result);
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  if (status === 'idle') return (
    <div style={{ padding: '30px 32px', flex: 1, overflowY: 'auto' }}>
      <div style={{ fontSize: 36, marginBottom: 16, textAlign: 'center' }}>&#128640;</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 8, textAlign: 'center' }}>Validate &amp; Export</div>
      <div style={{ fontSize: 14, color: '#555', lineHeight: 1.7, marginBottom: 28, textAlign: 'center' }}>
        AI scores your brief across 6 dimensions and gives a launch decision with specific improvements.
      </div>
      <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 12, padding: '18px 20px', marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>
          Brief Status &mdash; {doneCount}/6 complete
        </div>
        {completedFields.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, background: f.done ? '#00b89433' : '#111', border: `1px solid ${f.done ? '#00b894' : '#2a2a2a'}`, color: f.done ? '#00b894' : '#444' }}>
              {f.done ? '&#10003;' : i + 1}
            </div>
            <span style={{ fontSize: 13, color: f.done ? '#ccc' : '#444' }}>{f.label}</span>
            {!f.done && <span style={{ fontSize: 10, color: '#333', marginLeft: 'auto' }}>incomplete</span>}
          </div>
        ))}
        {doneCount < 4 && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#555', fontStyle: 'italic' }}>
            Complete at least Steps 1&ndash;4 for a meaningful validation score.
          </div>
        )}
      </div>
      <button onClick={run} style={{ width: '100%', padding: '14px', background: '#00b894', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, color: '#000', cursor: 'pointer' }}>
        Run Final Validation &rarr;
      </button>
    </div>
  );

  if (status === 'loading') return <StepLoading lines={['Running final validation...', 'Scoring your brief across 6 dimensions']} />;
  if (status === 'error')   return <StepError message={error} onRetry={run} />;

  const dm     = DECISION_META[result.decision] || DECISION_META['NOT YET'];
  const scores = result.dimension_scores || {};
  const DIM_LABELS = { angle: 'Angle', hook: 'Hook', title: 'Title CTR', seo: 'SEO', voice: 'Voice', readiness: 'Readiness' };

  return (
    <div style={{ padding: '22px 26px', flex: 1, overflowY: 'auto' }}>
      {/* Score + decision */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24 }}>
        <div style={{ width: 80, height: 80, borderRadius: '50%', flexShrink: 0, border: `3px solid ${SCORE_COLOR(result.score)}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0d0d0d' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: SCORE_COLOR(result.score), lineHeight: 1 }}>{result.score}</div>
          <div style={{ fontSize: 9, color: '#444', fontWeight: 700, letterSpacing: '0.06em' }}>/ 100</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, background: dm.bg, border: `1px solid ${dm.border}`, color: dm.color, borderRadius: 6, padding: '4px 12px', letterSpacing: '0.06em' }}>{dm.label}</span>
            {isDone && <span style={{ fontSize: 10, background: '#00b89422', color: '#00b894', borderRadius: 4, padding: '2px 8px', fontWeight: 700 }}>SAVED</span>}
            <button onClick={run} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #1a1a1a', borderRadius: 6, color: '#444', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>&#8635; Re-run</button>
          </div>
          <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.5 }}>{result.decision_reason}</div>
        </div>
      </div>

      {/* Dimension bars */}
      <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px', marginBottom: 22 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Dimension Breakdown</div>
        {Object.entries(scores).map(([dim, val]) => (
          <div key={dim} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: '#888' }}>{DIM_LABELS[dim] || dim}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: SCORE_COLOR(val) }}>{val}</span>
            </div>
            <div style={{ height: 4, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${val}%`, height: '100%', background: SCORE_COLOR(val), borderRadius: 2, transition: 'width 0.6s ease' }} />
            </div>
          </div>
        ))}
      </div>

      {/* Strengths */}
      {(result.strengths || []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Strengths</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {result.strengths.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, background: '#0a1a0f', border: '1px solid #00b89422', borderRadius: 8, padding: '9px 14px' }}>
                <span style={{ color: '#00b894', flexShrink: 0, marginTop: 1 }}>&#10003;</span>
                <span style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Improvements */}
      {(result.improvements || []).length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Improvements</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {result.improvements.map((imp, i) => (
              <div key={i} style={{ background: '#1a1200', border: '1px solid #f59e0b22', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>{imp.issue}</div>
                <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>{imp.fix}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Brief summary */}
      {result.brief_summary && (
        <div style={{ marginBottom: 24, background: '#0d1f3a', border: '1px solid #1e3a5f', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Brief Summary</div>
          <div style={{ fontSize: 13, color: '#c0d4f0', lineHeight: 1.7 }}>{result.brief_summary}</div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={copyBrief}
          style={{ flex: 1, padding: '13px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, fontSize: 13, fontWeight: 700, color: copied ? '#00b894' : '#ccc', cursor: 'pointer', transition: 'color 0.2s', minWidth: 110 }}>
          {copied ? '&#10003; Copied!' : '&#128203; Copy Brief'}
        </button>
        <button onClick={() => buildBriefPDF(plan, result)}
          style={{ flex: 1, padding: '13px', background: '#0d1f3a', border: '1px solid #1e3a5f', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#60a5fa', cursor: 'pointer', minWidth: 110 }}>
          &#128196; Download PDF
        </button>
        {isDone
          ? <div style={{ flex: 1, padding: '13px', background: '#0a1a0f', border: '1px solid #00b89422', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#00b894', textAlign: 'center' }}>
              &#10003; Plan Complete
            </div>
          : <button onClick={() => onComplete(6, 'validation', result)}
              style={{ flex: 1, padding: '13px', background: '#00b894', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 800, color: '#000', cursor: 'pointer' }}>
              Mark Complete &rarr;
            </button>
        }
      </div>
    </div>
  );
}

// Generic Placeholder for unbuilt steps
function StepPlaceholder({ step }) {
  const PHASE_MAP = { 5: 6, 6: 7 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 40px', textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 52, marginBottom: 20 }}>{step.icon}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>{step.label}</div>
      <div style={{ fontSize: 14, color: '#555', lineHeight: 1.7, maxWidth: 380, marginBottom: 32 }}>{step.desc}</div>
      <div style={{ background: '#0a1a0f', border: '1px solid #00b89422', borderRadius: 10, padding: '16px 24px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#00b894', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
          Building in Phase {PHASE_MAP[step.id] || step.id + 1}
        </div>
        <div style={{ fontSize: 13, color: '#444' }}>This step is under construction. Check back soon.</div>
      </div>
    </div>
  );
}

// Video Brief Panel
function BriefPanel({ plan }) {
  return (
    <div style={{ width: 256, flexShrink: 0, background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 14 }}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>&#128203;</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0' }}>Video Brief</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#333', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {plan.completedSteps.length}/6
        </span>
      </div>
      <div style={{ padding: '14px 18px' }}>
        {BRIEF_FIELDS.map(field => {
          const raw    = field.key === 'topic' ? plan.topic : plan.brief[field.key];
          const value  = briefSummary(raw);
          const filled = value != null && value !== '';
          return (
            <div key={field.key} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <span style={{ fontSize: 11 }}>{field.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: filled ? '#888' : '#2a2a2a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{field.label}</span>
                {filled && <span style={{ marginLeft: 'auto', fontSize: 9, background: '#00b89422', color: '#00b894', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>DONE</span>}
              </div>
              <div style={{ background: filled ? '#0a1a0f' : '#111', border: `1px solid ${filled ? '#00b89422' : '#1a1a1a'}`, borderRadius: 8, padding: '8px 10px', minHeight: 34, fontSize: 12, color: filled ? '#bbb' : '#2a2a2a', lineHeight: 1.5 }}>
                {filled ? String(value).slice(0, 90) + (String(value).length > 90 ? '...' : '') : 'Fills after this step'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Main Component
export default function PlanMyVideo({ channel, videos, onNavigate, tier, canUseAI, consumeAICall, remainingCalls, onUpgrade }) {
  const [plan, setPlan] = useState(loadPlan);

  const updatePlan = useCallback((updates) => {
    setPlan(prev => { const next = { ...prev, ...updates }; savePlan(next); return next; });
  }, []);

  const setStep = useCallback((stepId) => updatePlan({ currentStep: stepId }), [updatePlan]);

  const handleStepComplete = useCallback((stepId, briefKey, data, extraBrief = {}) => {
    setPlan(prev => {
      const completed = prev.completedSteps.includes(stepId) ? prev.completedSteps : [...prev.completedSteps, stepId];
      const next = { ...prev, completedSteps: completed, currentStep: Math.min(stepId + 1, 6), brief: { ...prev.brief, [briefKey]: data, ...extraBrief } };
      savePlan(next);
      return next;
    });
  }, []);

  const startNewPlan = useCallback(() => {
    const fresh = { ...DEFAULT_PLAN, brief: { ...DEFAULT_BRIEF } };
    savePlan(fresh); setPlan(fresh);
  }, []);

  const hasTopic = plan.topic.trim().length > 0;

  if (!hasTopic) {
    return (
      <TopicEntry
        channel={channel}
        onBack={() => onNavigate('dashboard')}
        onStart={(topic, audience) => updatePlan({ topic, audience, brief: { ...plan.brief, topic } })}
      />
    );
  }

  const currentStepDef = STEPS.find(s => s.id === plan.currentStep) || STEPS[0];
  const progress = plan.completedSteps.length / STEPS.length;

  function renderStepContent() {
    const shared = { plan, onComplete: handleStepComplete, canUseAI, consumeAICall, onUpgrade };
    switch (plan.currentStep) {
      case 1: return <NicheResearchStep    key={plan.topic} channel={channel} videos={videos} {...shared} />;
      case 2: return <DecodeWhatWorksStep  key={plan.topic} channel={channel} {...shared} />;
      case 3: return <VoiceCalibrationStep key={plan.topic} channel={channel} videos={videos} {...shared} />;
      case 4: return <ScriptHooksStep key={plan.topic} channel={channel} {...shared} />;
      case 5: return <TitleSEOStep         key={plan.topic} channel={channel} {...shared} />;
      case 6: return <ValidateExportStep   key={plan.topic} {...shared} />;
      default: return <StepPlaceholder step={currentStepDef} />;
    }
  }

  return (
    <div style={{ maxWidth: 1160, margin: '0 auto' }}>
      <style>{`
        @keyframes planFadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 900px) { .plan-brief-panel { display: none !important; } }
        @media (max-width: 660px) { .plan-layout { flex-direction: column !important; } .plan-step-nav { width: 100% !important; display: flex !important; flex-direction: row !important; overflow-x: auto !important; padding-bottom: 4px; gap: 6px !important; } .plan-step-nav > button { width: auto !important; flex-shrink: 0 !important; padding: 8px 10px !important; } }
      `}</style>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        <button onClick={() => onNavigate('dashboard')} style={{ background: 'none', border: '1px solid #222', borderRadius: 8, color: '#555', fontSize: 13, padding: '7px 14px', cursor: 'pointer', flexShrink: 0 }}>
          &larr; Back
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: '#00b894', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 3 }}>Plan My Video</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plan.topic}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: '#555' }}>{plan.completedSteps.length}/6</div>
          <div style={{ width: 72, height: 5, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', background: '#00b894', borderRadius: 3, transition: 'width 0.4s' }} />
          </div>
          <button onClick={startNewPlan} style={{ background: 'none', border: '1px solid #1a1a1a', borderRadius: 6, color: '#333', fontSize: 11, padding: '5px 10px', cursor: 'pointer' }}>New Plan</button>
        </div>
      </div>

      {plan.completedSteps.length === 6 && (
        <div style={{ background: '#0a1a0f', border: '1px solid #00b89444', borderRadius: 12, padding: '13px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>&#127881;</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#00b894' }}>Plan Complete &mdash; all 6 steps done!</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>Go to Step 6 to download your Video Brief PDF.</div>
          </div>
        </div>
      )}
      {/* 3-column layout */}
      <div className="plan-layout" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {/* Step navigator */}
        <div className="plan-step-nav" style={{ width: 210, flexShrink: 0 }}>
          {STEPS.map(step => {
            const done   = plan.completedSteps.includes(step.id);
            const active = plan.currentStep === step.id;
            return (
              <button key={step.id} onClick={() => setStep(step.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', marginBottom: 3, background: active ? '#0a1a0f' : 'transparent', border: `1px solid ${active ? '#00b89444' : 'transparent'}`, borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s' }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#111'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, background: done ? '#00b89433' : active ? '#0d2a1a' : '#111', border: `1px solid ${done ? '#00b894' : active ? '#00b89466' : '#222'}`, color: done ? '#00b894' : active ? '#00b894' : '#555' }}>
                  {done ? '✓' : step.id}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: done ? '#00b894' : active ? '#e0e0e0' : '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {step.label}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Step content */}
        <div style={{ flex: 1, minWidth: 0, background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 14, minHeight: 480, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 22px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 20 }}>{currentStepDef.icon}</span>
            <div>
              <div style={{ fontSize: 10, color: '#444', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Step {currentStepDef.id} of 6</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#e0e0e0' }}>{currentStepDef.label}</div>
            </div>
          </div>
          <div key={plan.currentStep} style={{ animation: 'planFadeIn 0.2s ease', flex: 1, display: 'flex', flexDirection: 'column' }}>
            {renderStepContent()}
          </div>
        </div>

        {/* Brief */}
        <div className="plan-brief-panel">
          <BriefPanel plan={plan} />
        </div>
      </div>
    </div>
  );
}
