import { useState } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────
const METRIC_LABELS = {
  engagement: 'Engagement',
  seo:        'SEO',
  hook:       'Hook & Retention',
  emotion:    'Emotional Impact',
  title:      'Title & Thumbnail',
};

const QUICK_ACTIONS = {
  seo:        'Add target keyword to title and description for better discoverability',
  hook:       'Rewrite first 3 seconds with a curiosity or shock hook',
  engagement: 'Replace CTA with a stronger emotional call to action',
  emotion:    'Add a personal story or emotional trigger in the middle section',
  title:      'Rewrite title using power words and a clear value proposition',
};

const CURIOSITY_BULLETS = [
  'Hidden reason this video isn\'t reaching its full viral potential',
  'Exact title formula to increase CTR by 20%+',
  'The retention drop-off point killing your algorithm reach',
  '3 packaging mistakes that are limiting your growth right now',
];

// ── getQuickSignal ────────────────────────────────────────────────────────────
export function getQuickSignal(videoData) {
  const stats       = videoData?.statistics || {};
  const views       = parseInt(stats.viewCount   || 0);
  const likes       = parseInt(stats.likeCount   || 0);
  const comments    = parseInt(stats.commentCount || 0);
  const publishedAt = videoData?.snippet?.publishedAt;

  if (!views || !publishedAt) return null;

  const hoursSinceUpload = Math.max(1, (Date.now() - new Date(publishedAt).getTime()) / 3_600_000);
  const engagementRate   = (likes + comments) / views;
  const velocity         = views / hoursSinceUpload;

  let score = 0;
  if (engagementRate >= 0.03)      score += 50;
  else if (engagementRate >= 0.01) score += 30;
  else                             score += 10;
  if (velocity >= 1000)      score += 50;
  else if (velocity >= 100)  score += 35;
  else if (velocity >= 10)   score += 20;
  else                       score += 8;

  const engPct = (engagementRate * 100).toFixed(2);
  if (score >= 75) return { level: 'STRONG',  color: '#22c55e', bgColor: '#0d1f13', borderColor: '#1a3d22', explanation: `High engagement (${engPct}%) and strong early velocity suggest good performance.` };
  if (score >= 45) return { level: 'AVERAGE', color: '#eab308', bgColor: '#1a1700', borderColor: '#3a3200', explanation: `Moderate engagement (${engPct}%) — video is performing around the channel norm.` };
  return               { level: 'WEAK',    color: '#f97316', bgColor: '#1a0e00', borderColor: '#3d2200', explanation: `Low engagement (${engPct}%) detected. AI analysis may surface the root cause.` };
}

// ── getShockInsight ───────────────────────────────────────────────────────────
export function getShockInsight(videoData) {
  const stats    = videoData?.statistics || {};
  const views    = parseInt(stats.viewCount   || 0);
  const likes    = parseInt(stats.likeCount   || 0);
  const comments = parseInt(stats.commentCount || 0);
  const pubAt    = videoData?.snippet?.publishedAt;
  const title    = videoData?.snippet?.title || '';

  if (!views) return 'Run AI analysis to uncover this video\'s hidden growth potential.';
  const engRate  = (likes + comments) / views;
  const hours    = pubAt ? Math.max(1, (Date.now() - new Date(pubAt).getTime()) / 3_600_000) : 1;
  const velocity = views / hours;

  if (engRate >= 0.04 && velocity < 200)
    return 'Strong engagement but poor reach — likely limited by title or SEO. Analysis will pinpoint the gap.';
  if (velocity >= 1000 && engRate < 0.02)
    return 'High views but weak engagement — surface interest only. Find out why viewers aren\'t converting.';
  if (engRate >= 0.05)
    return 'Exceptional engagement detected. This video has strong viral signals worth decoding now.';
  if (engRate < 0.01)
    return 'This video is underperforming vs its potential. AI analysis may reveal what\'s holding it back.';
  if (title.length < 30)
    return 'This video could perform 2× better with title and hook optimization. Run analysis to confirm.';
  return 'This video has untapped growth potential — full analysis takes just 3–5 seconds.';
}

// ── Post-analysis helpers ─────────────────────────────────────────────────────
function getEmotionalHero(score, bp) {
  const eng  = bp?.scores?.engagement         ?? 0;
  const hook = bp?.scores?.hookRetention      ?? 0;
  const seo  = bp?.scores?.seoDiscoverability ?? 0;

  if (score >= 80 && eng >= 70)  return { emoji: '🚀', label: 'Ready to Explode',         sub: 'Strong viral signals — small packaging tweaks could trigger explosive reach',       col: '#22c55e' };
  if (score >= 70 && hook >= 65) return { emoji: '⚡', label: 'High Growth Potential',     sub: 'Strong foundation — one or two targeted fixes could 2× your reach this week',       col: '#22c55e' };
  if (score >= 60)               return { emoji: '📈', label: 'Above Average Performer',   sub: 'Performing well but leaving views on the table — easy wins available below',        col: '#eab308' };
  if (score >= 50 && seo < 50)   return { emoji: '🎯', label: 'Hidden from the Algorithm', sub: `SEO score of ${seo}/100 is the main barrier to growth — fixable in minutes`,       col: '#f97316' };
  if (score >= 40)               return { emoji: '⚠️', label: 'Underperforming Potential',  sub: 'Content quality exists — packaging is holding back your reach',                    col: '#f97316' };
  return                                { emoji: '🔥', label: 'Missed Viral Opportunity',   sub: 'Multiple growth signals are weak — the fixes are in the breakdown below',          col: '#ef4444' };
}

function getCoreInsights(sorted) {
  const weakKey       = sorted[sorted.length - 1]?.[0] ?? '';
  const strongKey     = sorted[0]?.[0] ?? '';
  const secondWeakKey = sorted[sorted.length - 2]?.[0] ?? weakKey;

  const PROBLEMS = {
    seo:        'Low SEO — video isn\'t reaching new viewers organically',
    hook:       'Weak hook — viewers are leaving in the first 30 seconds',
    engagement: 'Low engagement — content isn\'t triggering emotional response',
    emotion:    'Low emotional impact — viewers aren\'t compelled to share',
    title:      'Weak title/thumbnail — low click-through rate',
  };
  const OPPORTUNITIES = {
    engagement: 'High engagement — content resonates, ready to scale',
    hook:       'Strong hook — viewers commit early, great retention base',
    emotion:    'High emotional impact — highly shareable content',
    title:      'Strong title/thumbnail — excellent CTR foundation',
    seo:        'Good SEO base — content is discoverable in search',
  };
  const FAST_WINS = {
    seo:        'Add primary keyword to title → est. +20% organic reach',
    hook:       'Rewrite first 3 seconds with bold claim → cut early drop-off',
    engagement: 'Add "Comment your answer" CTA → lift engagement rate',
    emotion:    'Add 1 personal story → increase shareability',
    title:      'Add a number + power word to title → +15% CTR potential',
  };

  return {
    problem:     PROBLEMS[weakKey]        ?? 'Multiple areas limiting growth',
    opportunity: OPPORTUNITIES[strongKey] ?? 'Strong core metrics to build on',
    fastestWin:  FAST_WINS[secondWeakKey] ?? FAST_WINS[weakKey] ?? 'Optimize title for quick CTR boost',
  };
}

function getCreatorPsych(score, bp) {
  const eng  = bp?.scores?.engagement    ?? 0;
  const hook = bp?.scores?.hookRetention ?? 0;
  const gap  = Math.max(0, 75 - score);

  if (score >= 75) return `You're in the top ${Math.max(1, Math.round(100 - score * 0.85))}% of creators for overall video quality`;
  if (eng >= 70)   return `Your engagement beats ${Math.round(eng * 0.9)}% of creators — your audience genuinely connects with this content`;
  if (hook >= 70)  return `Your hook strength is top-tier — most creators lose 40% of viewers at second 5, you don't`;
  if (gap <= 10)   return `You're only ${gap} points from the viral threshold — one targeted fix could push you over`;
  return `Your content style works — it's the packaging (title, thumbnail, SEO) holding back the reach`;
}

// ── Shared primitives ─────────────────────────────────────────────────────────
const LS = { fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase' };

const KEYFRAMES = `
@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}
@keyframes ti-pulse-glow {
  0%, 100% { box-shadow: 0 0 18px rgba(124,58,237,0.45), 0 0 36px rgba(124,58,237,0.15); }
  50%       { box-shadow: 0 0 32px rgba(124,58,237,0.75), 0 0 64px rgba(124,58,237,0.30); }
}`;

function ShimmerBar({ width = '100%', height = 14, radius = 6 }) {
  return (
    <div style={{
      width, height, borderRadius: radius,
      background:     'linear-gradient(90deg, #1a1a1a 25%, #2a2a2a 50%, #1a1a1a 75%)',
      backgroundSize: '800px 100%',
      animation:      'shimmer 1.4s infinite linear',
    }} />
  );
}

function Card({ accentColor = '#333', children }) {
  return (
    <div style={{
      background:   '#0f0f0f',
      border:       '1px solid #2a2a2a',
      borderRadius: 16,
      boxShadow:    'inset 0 0 0 1px rgba(255,255,255,0.04), 0 2px 24px rgba(0,0,0,0.6)',
      padding:      '28px 28px 24px',
      display:      'flex',
      flexDirection:'column',
      gap:          20,
      position:     'relative',
      overflow:     'hidden',
    }}>
      <style>{KEYFRAMES}</style>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, transparent, ${accentColor}88, ${accentColor}, ${accentColor}88, transparent)`,
        borderRadius: '16px 16px 0 0',
      }} />
      {children}
    </div>
  );
}

function AnalyzeButton({ onClick, loading, label = '🔥 Unlock Full Viral Breakdown' }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        width: '100%', padding: '14px 0', borderRadius: 10,
        border:      loading ? '1px solid #2a2a40' : '1px solid #9d6efd99',
        background:  loading ? '#1a1a2e' : hovered
          ? 'linear-gradient(135deg, #2d1060 0%, #5b21b6 100%)'
          : 'linear-gradient(135deg, #1e1040 0%, #3b0f8c 100%)',
        color:       loading ? '#555' : '#f3e8ff',
        fontWeight:  800, fontSize: '0.92rem', letterSpacing: '0.03em',
        cursor:      loading ? 'not-allowed' : 'pointer',
        transition:  'all 0.2s ease',
        animation:   loading ? 'none' : 'ti-pulse-glow 2.5s ease-in-out infinite',
        transform:   hovered && !loading ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      {loading
        ? <><span className="btn-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> AI analyzing video…</>
        : label}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// Props: video, aiData, aiLoading, onAnalyze
// ═══════════════════════════════════════════════════════════════════════════════
export default function SummaryBox({ video, aiData, aiLoading, onAnalyze }) {
  const quickSignal = getQuickSignal(video);
  const bp          = aiData?.blueprint;
  const hasAI       = bp != null;

  // ── STATE 2: Loading ──────────────────────────────────────────────────────
  if (aiLoading) {
    return (
      <Card accentColor="#7c3aed">
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#a78bfa' }}>
            <span className="btn-spinner" style={{ width: 36, height: 36, borderWidth: 3, borderColor: '#7c3aed44', borderTopColor: '#a78bfa' }} />
            <span style={{ fontSize: '0.9rem', fontWeight: 700, letterSpacing: '0.06em' }}>🧠 AI analyzing video…</span>
            <span style={{ fontSize: '0.75rem', color: '#555' }}>This usually takes 15–30 seconds</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ShimmerBar height={20} />
          <ShimmerBar width="70%" height={14} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 4 }}>
            <ShimmerBar height={80} radius={10} />
            <ShimmerBar height={80} radius={10} />
            <ShimmerBar height={80} radius={10} />
          </div>
          <ShimmerBar height={72} radius={10} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <ShimmerBar height={64} radius={10} />
            <ShimmerBar height={64} radius={10} />
          </div>
        </div>
      </Card>
    );
  }

  // ── STATE 3: Full AI result ───────────────────────────────────────────────
  if (hasAI) {
    const score  = bp.overallScore ?? 0;
    const hero   = getEmotionalHero(score, bp);

    const metricsObj = {
      engagement: bp.scores?.engagement          ?? 0,
      seo:        bp.scores?.seoDiscoverability  ?? 0,
      hook:       bp.scores?.hookRetention       ?? 0,
      emotion:    bp.scores?.emotionalImpact     ?? 0,
      title:      bp.scores?.titleThumbnail      ?? 0,
    };

    const sorted      = Object.entries(metricsObj).sort(([, a], [, b]) => b - a);
    const top2S       = sorted.slice(0, 2);
    const top2W       = [...sorted].reverse().slice(0, 2);
    const strongest   = sorted[0]?.[0] ?? '';
    const weakest     = sorted[sorted.length - 1]?.[0] ?? '';
    const insights    = getCoreInsights(sorted);
    const psychLine   = getCreatorPsych(score, bp);

    const weakKeys    = [...sorted].reverse().map(([k]) => k);
    const actionKeys  = [...new Set(weakKeys)].slice(0, 3);
    const quickActions = actionKeys.map(k => QUICK_ACTIONS[k]).filter(Boolean);

    const summaryLine = strongest && weakest
      ? `Performing well due to ${METRIC_LABELS[strongest] ?? strongest} but limited by ${METRIC_LABELS[weakest] ?? weakest}.`
      : 'AI analysis complete.';

    return (
      <Card accentColor={hero.col}>

        {/* ── Emotional hero ── */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            background: `${hero.col}0e`, border: `1px solid ${hero.col}35`,
            borderRadius: 14, padding: '18px 32px',
            boxShadow: `0 0 36px ${hero.col}1a`,
          }}>
            <span style={{ fontSize: '2rem', lineHeight: 1 }}>{hero.emoji}</span>
            <span style={{ fontSize: '1.3rem', fontWeight: 900, color: hero.col, lineHeight: 1.15, letterSpacing: '-0.3px' }}>
              {hero.label}
            </span>
            <span style={{ fontSize: '0.76rem', color: '#777', maxWidth: 230, lineHeight: 1.55, textAlign: 'center' }}>
              {hero.sub}
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: '2.2rem', fontWeight: 900, color: hero.col, lineHeight: 1 }}>{score}</span>
              <span style={{ fontSize: '0.8rem', color: '#444' }}>/ 100</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: hero.col, marginLeft: 4 }}>{bp.grade}</span>
            </div>
          </div>
        </div>

        {/* ── Core insight strip ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[
            { icon: '📉', label: 'Biggest Problem',     text: insights.problem,     bg: '#140808', border: '#2e1010', col: '#f87171' },
            { icon: '🚀', label: 'Best Opportunity',    text: insights.opportunity, bg: '#08140a', border: '#1a3d22', col: '#4ade80' },
            { icon: '⚡', label: 'Fastest Win',         text: insights.fastestWin,  bg: '#141000', border: '#3a3000', col: '#facc15' },
          ].map(({ icon, label, text, bg, border, col }) => (
            <div key={label} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '10px 10px 12px' }}>
              <div style={{ fontSize: '1.1rem', marginBottom: 5 }}>{icon}</div>
              <div style={{ fontSize: '0.57rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: col, marginBottom: 5 }}>{label}</div>
              <div style={{ fontSize: '0.72rem', color: '#999', lineHeight: 1.45 }}>{text}</div>
            </div>
          ))}
        </div>

        {/* ── Creator psychology ── */}
        <div style={{
          background: '#0a0a12', border: '1px solid #1e1e2e', borderRadius: 10,
          padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>🧠</span>
          <div>
            <div style={{ ...LS, color: '#7c3aed', marginBottom: 5 }}>Creator Insight</div>
            <div style={{ fontSize: '0.82rem', color: '#ccc', lineHeight: 1.6, fontWeight: 500 }}>{psychLine}</div>
          </div>
        </div>

        {/* ── Summary line ── */}
        <p style={{ margin: 0, fontStyle: 'italic', fontSize: '0.82rem', color: '#666', textAlign: 'center', lineHeight: 1.55 }}>
          {summaryLine}
        </p>

        {/* ── Strengths + Weaknesses ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: '#0d1f13', border: '1px solid #1a3d22', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ ...LS, color: '#4ade80', marginBottom: 8 }}>Strengths</div>
            {top2S.map(([key, val]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.78rem', color: '#86efac', marginBottom: 5 }}>
                <span style={{ color: '#22c55e' }}>✔</span>
                <span>{METRIC_LABELS[key] ?? key}</span>
                <span style={{ marginLeft: 'auto', color: '#4ade80', fontWeight: 700, fontSize: '0.76rem' }}>{val}</span>
              </div>
            ))}
          </div>
          <div style={{ background: '#1a0d0d', border: '1px solid #3d1a1a', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ ...LS, color: '#f87171', marginBottom: 8 }}>Weaknesses</div>
            {top2W.map(([key, val]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.78rem', color: '#fca5a5', marginBottom: 5 }}>
                <span style={{ color: '#ef4444' }}>✗</span>
                <span>{METRIC_LABELS[key] ?? key}</span>
                <span style={{ marginLeft: 'auto', color: '#f87171', fontWeight: 700, fontSize: '0.76rem' }}>{val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Quick actions ── */}
        {quickActions.length > 0 && (
          <div style={{ background: '#0a0a14', border: '1px solid #1a1a2e', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ ...LS, color: '#a855f7', marginBottom: 10 }}>Quick Actions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {quickActions.map((action, i) => (
                <div key={i} style={{ display: 'flex', gap: 9, fontSize: '0.78rem', color: '#ccc', lineHeight: 1.45 }}>
                  <span style={{ flexShrink: 0 }}>🚀</span>
                  <span>{action}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Re-analyze ── */}
        <AnalyzeButton onClick={onAnalyze} loading={false} label="↻ Re-run Analysis" />

      </Card>
    );
  }

  // ── STATE 1: Pre-analysis hook screen ─────────────────────────────────────
  const qs        = quickSignal;
  const shockText = getShockInsight(video);

  return (
    <Card accentColor={qs ? qs.color : '#7c3aed'}>

      {/* 1. Quick Signal badge */}
      {qs ? (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            background: qs.bgColor, border: `1px solid ${qs.borderColor}`,
            borderRadius: 12, padding: '16px 36px',
            boxShadow: `0 0 28px ${qs.color}28`,
          }}>
            <span style={{ ...LS, color: '#555', fontSize: '0.58rem', letterSpacing: '0.18em' }}>⚡ Quick Signal</span>
            <span style={{ fontSize: '2.8rem', fontWeight: 900, color: qs.color, lineHeight: 1, letterSpacing: '-0.5px' }}>
              {qs.level}
            </span>
            <span style={{ fontSize: '0.7rem', color: '#555', marginTop: 2 }}>Based on engagement &amp; velocity</span>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <span style={{ fontSize: '0.85rem', color: '#555' }}>Not enough data for quick signal</span>
        </div>
      )}

      {/* 2. Shock insight */}
      {shockText && (
        <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 500, color: '#c0c0c0', textAlign: 'center', lineHeight: 1.6, padding: '0 4px' }}>
          {shockText}
        </p>
      )}

      {/* 3. Curiosity block — locked bullets */}
      <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden' }}>
        {/* Lock overlay */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2,
          backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
          background: 'rgba(6,6,6,0.68)', borderRadius: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <span style={{ fontSize: '1.5rem' }}>🔒</span>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#444', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            Unlocks after analysis
          </span>
        </div>
        {/* Dummy bullets behind blur */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 10, overflow: 'hidden' }}>
          {CURIOSITY_BULLETS.map((b, i) => (
            <div key={i} style={{
              display: 'flex', gap: 10, padding: '10px 14px', alignItems: 'flex-start',
              borderBottom: i < CURIOSITY_BULLETS.length - 1 ? '1px solid #131313' : 'none',
            }}>
              <span style={{ color: '#1e1e1e', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>•</span>
              <span style={{ fontSize: '0.78rem', color: '#1a1a1a', lineHeight: 1.5, fontWeight: 500, userSelect: 'none' }}>{b}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ borderTop: '1px solid #1a1a1a', margin: '0 -4px' }} />

      {/* 4. CTA + time indicator */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <AnalyzeButton onClick={onAnalyze} loading={false} />
        <p style={{ margin: 0, fontSize: '0.7rem', color: '#3a3a3a', textAlign: 'center', letterSpacing: '0.02em' }}>
          ⏱ Takes 3–5 seconds · No credit card required
        </p>
      </div>

    </Card>
  );
}
