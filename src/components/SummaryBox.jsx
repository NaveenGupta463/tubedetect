import { useState } from 'react';

// ── Score helpers ─────────────────────────────────────────────────────────────
export function getGrade(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function gradeColor(score) {
  if (score >= 70) return '#22c55e';
  if (score >= 55) return '#eab308';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

// ── Constants ─────────────────────────────────────────────────────────────────
const METRIC_LABELS = {
  packaging:  'Packaging',
  engagement: 'Engagement',
  seo:        'SEO',
  velocity:   'Velocity',
};

const QUICK_ACTIONS = {
  packaging:  'Rewrite title with a specific outcome + number, update thumbnail contrast',
  seo:        'Add primary keyword to the first 5 words of title and description',
  engagement: 'Replace generic CTA with a specific question tied to the video content',
  velocity:   'Promote in the first 24 hours — early velocity drives recommendation placement',
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

// ── deriveTeaser ─────────────────────────────────────────────────────────────
function deriveTeaser(video, metrics, channelBaseline) {
  const viewsRatio = metrics?.viewsRatio;

  if (viewsRatio == null) {
    const stats    = video?.statistics || {};
    const views    = parseInt(stats.viewCount    || 0);
    if (!views) return { signal: null, growthRisk: false, message: 'This video is getting traction… but something is off.' };
    const likes    = parseInt(stats.likeCount    || 0);
    const comments = parseInt(stats.commentCount || 0);
    const pubAt    = video?.snippet?.publishedAt;
    const hours    = pubAt ? Math.max(1, (Date.now() - new Date(pubAt).getTime()) / 3_600_000) : 1;
    const velocity = views / hours;
    const engRate  = (likes + comments) / views;
    const signal     = velocity >= 500 || (engRate >= 0.03 && velocity >= 100) ? 'STRONG' : 'WEAK';
    const growthRisk = signal === 'STRONG' && (engRate < 0.02 || comments === 0);
    return { signal, growthRisk, message: _teaserMessage(signal, growthRisk) };
  }

  // Distribution signal — same thresholds as SignalNarrative
  const signal = viewsRatio > 3 ? 'STRONG' : viewsRatio >= 1.5 ? 'STABLE' : 'WEAK';

  // Growth risk: compare this video's like/comment rate against channel's own average
  // for this format — a channel-relative drop of >40% flags risk
  const likeRate    = metrics?.likeRate    ?? 0;
  const commentRate = metrics?.commentRate ?? 0;
  const chLikeRate    = channelBaseline?.likeRate    ?? null;
  const chCommentRate = channelBaseline?.commentRate ?? null;

  const likeRisk = chLikeRate != null
    ? likeRate < chLikeRate * 0.6
    : likeRate < 2;

  const commentRisk = chCommentRate != null
    ? commentRate < chCommentRate * 0.6
    : commentRate < 0.02;

  const growthRisk = (signal === 'STRONG' || signal === 'STABLE') && (likeRisk || commentRisk);

  return { signal, growthRisk, message: _teaserMessage(signal, growthRisk) };
}

function _teaserMessage(signal, growthRisk) {
  if (signal === 'STRONG' && growthRisk)
    return 'YouTube is pushing this video right now — but without certain fixes, it will die after the initial push.';
  if (signal === 'STRONG')
    return 'YouTube is actively pushing this video and early signals look strong.';
  if (signal === 'STABLE' && growthRisk)
    return 'This video has steady reach, but engagement isn\'t converting — it needs fixes to avoid fading out.';
  if (signal === 'STABLE')
    return 'This video is holding steady — there\'s clear room to push it further.';
  return 'This video is underperforming its distribution potential — AI analysis will pinpoint why.';
}

const SIGNAL_BADGE_STYLES = {
  'STRONG': { color: '#22c55e', bg: '#052e16', border: '#14532d' },
  'STABLE': { color: '#eab308', bg: '#1c1400', border: '#713f12' },
  'WEAK':   { color: '#ef4444', bg: '#1c0505', border: '#7f1d1d' },
};

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

// ── CONTEXT mode hero ─────────────────────────────────────────────────────────
function getContextHero(videoType) {
  if (videoType === 'EARLY') return {
    col: '#3b82f6',
    sub: 'Signals are not yet stable — data will become reliable after 48–72 hours of distribution',
  };
  // LEGACY_VIRAL
  return {
    col: '#7c3aed',
    sub: 'This video has reached peak distribution — metrics reflect long-term audience saturation, not current opportunity',
  };
}

// ── DIAGNOSE mode hero ────────────────────────────────────────────────────────
function getDiagnoseHero(videoType) {
  if (videoType === 'DORMANT') return {
    col: '#6b7280',
    sub: 'This video is no longer in active distribution — analysis reflects its final performance state',
  };
  return { col: '#6b7280', sub: 'This video is not in an active growth phase' };
}

// ── OPTIMIZE mode hero ────────────────────────────────────────────────────────
function getEmotionalHero(score, bp) {
  const eng  = bp?.scores?.engagement ?? 0;
  const pkg  = bp?.scores?.packaging  ?? 0;
  const seo  = bp?.scores?.seo        ?? 0;

  if (score >= 80 && eng >= 70)  return { emoji: '🚀', label: 'Ready to Explode',         sub: 'Strong signals across all dimensions — small packaging tweaks could trigger explosive reach', col: '#22c55e' };
  if (score >= 70 && pkg >= 65)  return { emoji: '⚡', label: 'High Growth Potential',     sub: 'Strong packaging foundation — one or two targeted fixes could 2× your reach this week',      col: '#22c55e' };
  if (score >= 60)               return { emoji: '📈', label: 'Above Average Performer',   sub: 'Performing well but leaving views on the table — easy wins available below',                 col: '#eab308' };
  if (score >= 50 && seo < 50)   return { emoji: '🎯', label: 'Hidden from the Algorithm', sub: `SEO score of ${seo}/100 is the main barrier to growth — fixable in minutes`,                col: '#f97316' };
  if (score >= 40)               return { emoji: '⚠️', label: 'Underperforming Potential',  sub: 'Content has potential — packaging and SEO are limiting reach',                             col: '#f97316' };
  return                                { emoji: '🔥', label: 'Missed Viral Opportunity',   sub: 'Multiple growth signals are weak — the fixes are in the breakdown below',                   col: '#ef4444' };
}

function getCoreInsights(sorted) {
  const weakKey       = sorted[sorted.length - 1]?.[0] ?? '';
  const strongKey     = sorted[0]?.[0] ?? '';
  const secondWeakKey = sorted[sorted.length - 2]?.[0] ?? weakKey;

  const PROBLEMS = {
    packaging:  'Weak packaging — title and thumbnail aren\'t generating clicks',
    engagement: 'Low engagement — content isn\'t driving likes or comments',
    seo:        'Low SEO — video isn\'t reaching new viewers organically',
    velocity:   'Slow velocity — view momentum is trailing the channel average',
  };
  const OPPORTUNITIES = {
    packaging:  'Strong packaging — excellent title and thumbnail foundation',
    engagement: 'High engagement — content resonates, ready to scale reach',
    seo:        'Good SEO base — content is discoverable in search',
    velocity:   'Strong velocity — video is gaining momentum fast',
  };
  const FAST_WINS = {
    packaging:  'Add a specific number + outcome to title → +15% CTR potential',
    engagement: 'Add "Comment your answer" CTA tied to the content → lift engagement',
    seo:        'Add primary keyword to the first 5 words of title → +20% organic reach',
    velocity:   'Promote within first 24 hours → early velocity drives recommendations',
  };

  return {
    problem:     PROBLEMS[weakKey]        ?? 'Multiple areas limiting growth',
    opportunity: OPPORTUNITIES[strongKey] ?? 'Strong core metrics to build on',
    fastestWin:  FAST_WINS[secondWeakKey] ?? FAST_WINS[weakKey] ?? 'Optimize title for quick CTR boost',
  };
}

function getCreatorPsych(score, bp) {
  const eng = bp?.scores?.engagement ?? 0;
  const pkg = bp?.scores?.packaging  ?? 0;
  const gap = Math.max(0, 75 - score);

  if (score >= 75) return `You're in the top ${Math.max(1, Math.round(100 - score * 0.85))}% of creators for overall video quality`;
  if (eng >= 70)   return `Your engagement beats ${Math.round(eng * 0.9)}% of creators — your audience genuinely connects with this content`;
  if (pkg >= 70)   return `Your packaging is strong — title and thumbnail are doing their job. The gap is in SEO and distribution`;
  if (gap <= 10)   return `You're only ${gap} points from the High Performer threshold — one targeted fix could push you over`;
  return `Your content has potential — it's the packaging and SEO holding back the reach, not the content itself`;
}

// ── Implication map (successModel → strategic implication) ───────────────────
const IMPLICATION_MAP = {
  'Viral Spike':           'Act within the distribution window — momentum decays after 48–72 hours. Prioritize follow-up content while the algorithm is still pushing.',
  'Evergreen Search Loop': 'This video will compound over time. Each related video you publish reinforces this one — build a topic cluster around it.',
  'Authority Builder':     'Individual video performance matters less than publishing cadence. Trust builds cumulatively — consistency is the growth lever here.',
  'Utility Engine':        'Traffic will be steady but slow to build. SEO optimization and cross-linking extend reach without relying on viral momentum.',
  'Early-stage Breakout':  'The content quality is validated by engagement. The gap is distribution — a targeted push now could unlock the algorithmic traction this video is ready for.',
};

// ── Milestone system ──────────────────────────────────────────────────────────
const MILESTONES = [
  { min: 0,  max: 49,  label: 'Needs Work',     next: 'Average',         nextScore: 50 },
  { min: 50, max: 59,  label: 'Average',         next: 'Improving',       nextScore: 60 },
  { min: 60, max: 74,  label: 'Improving',       next: 'High Performer',  nextScore: 75 },
  { min: 75, max: 89,  label: 'High Performer',  next: 'Viral Potential', nextScore: 90 },
  { min: 90, max: 100, label: 'Viral Potential', next: null,              nextScore: null },
];

function getMilestone(score) {
  const m = MILESTONES.find(m => score >= m.min && score <= m.max) || MILESTONES[0];
  const ptsAway = m.nextScore != null ? m.nextScore - score : 0;
  const pct = m.nextScore != null
    ? Math.round((score - m.min) / (m.nextScore - m.min) * 100)
    : 100;
  return { current: m.label, next: m.next, nextScore: m.nextScore, ptsAway, pct };
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
const MISMATCH_CONFIG = {
  WEAK_CONTENT:       { icon: '🚨', color: '#ef4444', bg: '#1c0505', border: '#7f1d1d', text: 'High reach but weak engagement' },
  UNDER_DISTRIBUTED:  { icon: '💎', color: '#818cf8', bg: '#0d0f1f', border: '#312e81', text: 'Strong engagement but low distribution' },
  ALIGNED:            { icon: '🔥', color: '#22c55e', bg: '#052e16', border: '#14532d', text: 'Strong performance — engagement matches distribution' },
  NO_SIGNAL:          { icon: '⚪', color: '#6b7280', bg: '#111827', border: '#374151', text: 'No clear signal yet — video hasn\'t gained traction or engagement' },
};

export default function SummaryBox({ video, aiData, aiLoading, onAnalyze, insightMode, metrics, channelAvg, channelBaseline, sampleLevel, lowVolume, signalState, engagementQuality, mismatch }) {
  const bp               = aiData?.blueprint ?? {};
  const diag             = aiData?.diagnosis ?? null;
  const hasValidAnalysis = !!diag && !aiData?._diagnosisOutdated;
  const score            = bp.finalScore ?? bp.baseScore ?? null;

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

  // ── NOT VALID: no analysis, outdated cache, or failed diagnosis ──────────
  // Renders before STATE 3 — NO legacy scores (grade / viralScore / Momentum
  // Signal) are accessible below this point without hasValidAnalysis === true.
  if (!hasValidAnalysis) {
    const isOutdated   = !!aiData && !!aiData._diagnosisOutdated;
    const isFailed     = !!aiData && !diag && !isOutdated;
    const accentColor  = isOutdated ? '#f97316' : isFailed ? '#374151' : '#7c3aed';
    const shockText    = getShockInsight(video);
    const _views       = parseInt(video?.statistics?.viewCount || 0);
    const _pubAt       = video?.snippet?.publishedAt;
    const _ageDays     = _pubAt ? (Date.now() - new Date(_pubAt).getTime()) / 86400000 : 0;
    const isLikelyLegacyViral = _views > 10_000_000 && _ageDays > 365;

    if (isOutdated || isFailed) {
      return (
        <Card accentColor={accentColor}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '12px 0 4px', textAlign: 'center' }}>
            <span style={{ fontSize: '1.5rem' }}>{isOutdated ? '⚠️' : '🔄'}</span>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: isOutdated ? '#f97316' : '#9ca3af' }}>
              {isOutdated ? 'Analysis Outdated' : 'Analysis Incomplete'}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#666', lineHeight: 1.6, maxWidth: 280 }}>
              {isOutdated
                ? 'This video was analysed with a previous version of the engine. Re-run to get mechanism, insights, and recommendations.'
                : 'The diagnosis engine did not return a result. Re-run to generate mechanism, insights, and recommendations.'}
            </div>
            {onAnalyze && (
              <button
                onClick={onAnalyze}
                style={{
                  marginTop: 4, padding: '10px 28px',
                  background: isOutdated
                    ? 'linear-gradient(135deg, #f97316, #ea580c)'
                    : 'linear-gradient(135deg, #4b5563, #374151)',
                  border: 'none', borderRadius: 10,
                  color: '#fff', fontSize: '0.85rem',
                  fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em',
                }}
              >
                Re-run Deep Analysis
              </button>
            )}
          </div>
        </Card>
      );
    }

    // Pre-analysis: no aiData at all — signal + narrative CTA
    const { signal, growthRisk, message } = deriveTeaser(video, metrics, channelBaseline);
    console.log('[SummaryBox teaser]', { signal, growthRisk, viewsRatio: metrics?.viewsRatio, likeRate: metrics?.likeRate, commentRate: metrics?.commentRate });
    const badgeStyle = signal ? SIGNAL_BADGE_STYLES[signal] : null;

    return (
      <Card accentColor="#7c3aed">

        {/* Very-low sample warning */}
        {sampleLevel === 'very_low' && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            background: '#1a0e00', border: '1px solid #92400e',
            borderRadius: 8, padding: '10px 14px',
          }}>
            <span style={{ flexShrink: 0, fontSize: '0.85rem' }}>⚠️</span>
            <span style={{ fontSize: '0.75rem', color: '#fbbf24', lineHeight: 1.5 }}>
              <strong>Very low data</strong> — fewer than 500 views. Signals are not yet stable and may shift significantly as the video accumulates data.
            </span>
          </div>
        )}

        {/* Signal badges + headline message */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '8px 0 10px' }}>

          {/* Primary signal badge — large */}
          {badgeStyle && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{
                fontSize: '1.1rem', fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase',
                color: badgeStyle.color, background: badgeStyle.bg,
                border: `2px solid ${badgeStyle.border}`,
                borderRadius: 10, padding: '10px 28px',
                boxShadow: `0 0 20px ${badgeStyle.color}44, 0 0 40px ${badgeStyle.color}18`,
                display: 'inline-block',
              }}>
                {signal}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#52525b', fontWeight: 500, letterSpacing: '0.01em' }}>
                {metrics?.viewsRatio != null
                  ? `This video got ${Math.round(metrics.viewsRatio * 100)}% of your channel's average views`
                  : 'Based on views vs channel average'}
              </div>
              {signalState === 'EARLY' && (
                <div style={{
                  fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: '#f59e0b', background: '#1c1000', border: '1px solid #78350f',
                  borderRadius: 6, padding: '4px 10px', marginTop: 2,
                }}>
                  Engagement signal preliminary
                </div>
              )}
            </div>
          )}

          {/* Growth risk secondary badge */}
          {growthRisk && (
            <div style={{
              fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: '#f97316', background: '#1a0800', border: '1px solid #c2410c',
              borderRadius: 8, padding: '7px 16px',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <span>⚠️</span>
              <span>Growth Risk Detected</span>
            </div>
          )}

          {/* Mismatch badge */}
          {mismatch && MISMATCH_CONFIG[mismatch] && (() => {
            const cfg = MISMATCH_CONFIG[mismatch];
            return (
              <div style={{
                fontSize: '0.76rem', fontWeight: 700, letterSpacing: '0.08em',
                color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
                borderRadius: 8, padding: '7px 16px',
                display: 'inline-flex', alignItems: 'center', gap: 7,
              }}>
                <span>{cfg.icon}</span>
                <span>{cfg.text}</span>
              </div>
            );
          })()}

          {/* Engagement quality warning */}
          {engagementQuality === 'LOW' && (
            <div style={{
              fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.04em',
              color: '#d97706', background: '#1c1000', border: '1px solid #92400e',
              borderRadius: 7, padding: '6px 14px',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <span>⚠️</span>
              <span>Engagement signals may not reflect real audience behavior</span>
            </div>
          )}

          <p style={{
            margin: 0, fontSize: '1.05rem', fontWeight: 600, color: '#e4e4e7',
            textAlign: 'center', lineHeight: 1.6, padding: '0 4px',
          }}>
            {message}
          </p>
        </div>

        {/* Opportunity / Risk block */}
        <div style={{
          borderRadius: 12, padding: '18px 20px',
          background: growthRisk ? '#0a0300' : '#00080a',
          border: `1px solid ${growthRisk ? '#7c2d12' : '#0e3a2f'}`,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>{growthRisk ? '⚠️' : '🧠'}</span>
            <div style={{
              fontSize: '0.8rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
              color: growthRisk ? '#f97316' : '#22c55e',
            }}>
              {growthRisk ? 'Growth Risk Detected' : 'Opportunity Detected'}
            </div>
          </div>
          <p style={{
            margin: 0, fontSize: '0.85rem', lineHeight: 1.65,
            color: growthRisk ? '#fed7aa' : '#bbf7d0',
          }}>
            {growthRisk
              ? 'YouTube is pushing this video right now — but without certain fixes, momentum will drop after the initial push.'
              : 'This video has real growth potential. Run analysis to find the exact levers to scale it further.'}
          </p>
        </div>

        <div style={{ borderTop: '1px solid #1a1a1a', margin: '0 -4px' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <AnalyzeButton
            onClick={onAnalyze}
            loading={false}
            label={isLikelyLegacyViral ? '🔍 Analyze Viral Patterns' : 'Unlock What\'s Killing Your Growth →'}
          />
          <p style={{ margin: 0, fontSize: '0.7rem', color: '#3a3a3a', textAlign: 'center', letterSpacing: '0.02em' }}>
            AI will break down EXACTLY what to fix in your video
          </p>
        </div>

      </Card>
    );
  }

  // ── STATE 3: Diagnosis (mechanism-first) ─────────────────────────────────
  if (diag) {
    const CONF_COLOR = { HIGH: '#22c55e', MEDIUM: '#eab308', LOW: '#f97316' };
    const confColor  = CONF_COLOR[diag.confidence] || '#555';
    const implication = IMPLICATION_MAP[diag.successModel] || null;
    const mech = diag.mechanism || {};

    const mechSections = [
      { label: 'ENTRY',     text: mech.entry },
      { label: 'RETENTION', text: mech.retention },
      { label: 'LOOP',      text: mech.loop },
    ].filter(s => s.text);

    return (
      <Card accentColor="#7c3aed">

        {/* Very-low sample warning */}
        {sampleLevel === 'very_low' && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            background: '#1a0e00', border: '1px solid #92400e',
            borderRadius: 8, padding: '10px 14px',
          }}>
            <span style={{ flexShrink: 0, fontSize: '0.85rem' }}>⚠️</span>
            <span style={{ fontSize: '0.75rem', color: '#fbbf24', lineHeight: 1.5 }}>
              <strong>Very low data</strong> — fewer than 500 views. Analysis language reflects this uncertainty. Re-check after the video accumulates more data.
            </span>
          </div>
        )}

        {/* Header row: score pill + content type + confidence */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {score != null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: `${gradeColor(score)}12`, border: `1px solid ${gradeColor(score)}44`,
              borderRadius: 8, padding: '5px 12px',
              transition: 'all 0.3s ease',
            }}>
              <span style={{ fontSize: '1rem', fontWeight: 900, color: gradeColor(score), lineHeight: 1 }}>
                {getGrade(score)}
              </span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: gradeColor(score), opacity: 0.8 }}>
                {Math.round(score)}/100
              </span>
            </div>
          )}
          {diag.contentType && (
            <span style={{
              fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              background: '#160d30', border: '1px solid #3b1a7a', color: '#c4b5fd',
              borderRadius: 6, padding: '4px 10px',
            }}>
              {diag.contentType}
            </span>
          )}
          {diag.confidence && (
            <span style={{
              fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              background: `${confColor}14`, border: `1px solid ${confColor}44`, color: confColor,
              borderRadius: 6, padding: '4px 10px',
            }}>
              {diag.confidence} confidence
            </span>
          )}
        </div>

        {/* Mechanism — 3 labeled sections with progressive emphasis */}
        <div style={{
          background: '#080814', border: '1px solid #1e1a3a',
          borderRadius: 12, padding: '18px 20px',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          <div style={{ ...LS, color: '#6d28d9' }}>Why this video works</div>
          {mechSections.length > 0 ? mechSections.map(({ label, text }) => {
            const isLoop = label === 'LOOP';
            const isRetention = label === 'RETENTION';
            const labelColor = isLoop ? '#a78bfa' : isRetention ? '#7c5cbf' : '#4c1d95';
            const textColor  = isLoop ? '#e8e0ff' : isRetention ? '#d4d4d8' : '#a8a8b3';
            const textWeight = isLoop ? 500 : 400;
            return (
              <div key={label}>
                <div style={{
                  fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.16em',
                  textTransform: 'uppercase', color: labelColor, marginBottom: 6,
                }}>
                  {label}
                </div>
                <p style={{ margin: 0, fontSize: '0.84rem', color: textColor, lineHeight: 1.7, fontWeight: textWeight }}>
                  {text}
                </p>
              </div>
            );
          }) : (
            <p style={{ margin: 0, fontSize: '0.84rem', color: '#555', lineHeight: 1.7 }}>
              Analysis unavailable. Re-run to generate mechanism.
            </p>
          )}
        </div>

        {/* What this means — always rendered */}
        <div style={{
          background: '#060f06', border: '1px solid #1a2e1a',
          borderRadius: 10, padding: '14px 16px',
        }}>
          <div style={{ ...LS, color: '#166534', marginBottom: 8 }}>What this means</div>
          <p style={{ margin: 0, fontSize: '0.82rem', color: implication ? '#86efac' : '#3a5a3a', lineHeight: 1.65 }}>
            {implication || 'No clear strategic implication detected yet.'}
          </p>
        </div>

        {/* Verdict — with divider and stronger weight */}
        {diag.verdict && (
          <>
            <div style={{ borderTop: '1px solid #1e1e2e', margin: '0 2px' }} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ color: '#7c3aed', flexShrink: 0, marginTop: 3, fontSize: '0.85rem' }}>▸</span>
              <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: '#f4f4f5', lineHeight: 1.65 }}>
                {diag.verdict}
              </p>
            </div>
          </>
        )}

        <AnalyzeButton onClick={onAnalyze} loading={false} label="↻ Re-run Analysis" />

      </Card>
    );
  }

  // ── LEGACY STATE 4a — unreachable, kept as tombstone ────────────────────
  if (false) {
    const hero  = null;
    const score = 0;
    const isEarly = false;

    return (
      <Card accentColor={hero.col}>

        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            background: `${hero.col}12`, border: `1px solid ${hero.col}30`,
            borderRadius: 14, padding: '18px 32px',
          }}>
            <span style={{ fontSize: '1.25rem', fontWeight: 900, color: hero.col, letterSpacing: '-0.2px' }}>
              {isEarly ? 'Early Distribution Phase' : 'Peak Distribution Reached'}
            </span>
            <span style={{ fontSize: '0.76rem', color: '#777', maxWidth: 280, lineHeight: 1.55, textAlign: 'center' }}>
              {hero.sub}
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: '2.2rem', fontWeight: 900, color: hero.col, lineHeight: 1 }}>{score}</span>
              <span style={{ fontSize: '0.8rem', color: '#444' }}>/ 100</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: hero.col, marginLeft: 4 }}>{bp.grade}</span>
            </div>
            <span style={{ ...LS, color: '#444', marginTop: 2 }}>
              {isEarly ? 'Preliminary Score' : 'Historical Performance Score'}
            </span>
          </div>
        </div>

        {/* Pattern Strength Indicators (LEGACY_VIRAL only) */}
        {!isEarly && aiData?.intelligence?.patternStrengths && (() => {
          const ps = aiData.intelligence.patternStrengths;
          const STRENGTH_COLOR = { 'Extreme': '#c084fc', 'Very High': '#a78bfa', 'High': '#7c3aed', 'Moderate': '#6d28d9', 'Low': '#4c1d95' };
          const indicators = [
            { label: 'Overall',   value: ps.overallStrength },
            { label: 'Title',     value: ps.titleStrength },
            { label: 'Hook',      value: ps.hookStrength },
            { label: 'Emotion',   value: ps.emotionalResonance },
            { label: 'Shareable', value: ps.shareability },
            { label: 'Longevity', value: ps.longevity },
          ].filter(i => i.value);
          if (!indicators.length) return null;
          return (
            <div style={{ background: '#0a0814', border: '1px solid #2a1060', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ ...LS, color: '#7c3aed', marginBottom: 10 }}>Pattern Strength Indicators</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {indicators.map((ind, i) => (
                  <div key={i} style={{ textAlign: 'center', background: '#0f0f1a', border: '1px solid #1e1040', borderRadius: 8, padding: '8px 6px' }}>
                    <div style={{ fontSize: '0.68rem', color: '#555', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{ind.label}</div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 800, color: STRENGTH_COLOR[ind.value] || '#7c3aed' }}>{ind.value}</div>
                  </div>
                ))}
              </div>
              {ps.summary && <div style={{ fontSize: '0.76rem', color: '#777', marginTop: 10, lineHeight: 1.55 }}>{ps.summary}</div>}
            </div>
          );
        })()}

        {/* Context explanation */}
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ ...LS, color: hero.col, marginBottom: 10 }}>
            {isEarly ? 'Why signals are limited' : 'Why this data looks different'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(bp.diagnostics || []).map((d, i) => (
              <div key={i} style={{ display: 'flex', gap: 9, fontSize: '0.78rem', color: '#999', lineHeight: 1.5 }}>
                <span style={{ color: hero.col, flexShrink: 0 }}>·</span>
                <span>{typeof d === 'string' ? d : d.message ?? ''}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Strengths + Weaknesses (informational only) */}
        {(bp.strengths || bp.weaknesses) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ background: '#0d1f13', border: '1px solid #1a3d22', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ ...LS, color: '#4ade80', marginBottom: 8 }}>Strengths</div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#86efac', lineHeight: 1.55 }}>
                {bp.strengths || 'None identified'}
              </p>
            </div>
            <div style={{ background: '#1a0d0d', border: '1px solid #3d1a1a', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ ...LS, color: '#f87171', marginBottom: 8 }}>Weaknesses</div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#fca5a5', lineHeight: 1.55 }}>
                {bp.weaknesses || 'None identified'}
              </p>
            </div>
          </div>
        )}

        {/* Re-analyze */}
        <AnalyzeButton onClick={onAnalyze} loading={false} label="↻ Re-run Analysis" />

      </Card>
    );
  }

  // ── LEGACY STATE 4c — unreachable, kept as tombstone ────────────────────
  if (false) {
    const hero  = getDiagnoseHero(bp.videoType);
    const score = bp.viralScore ?? 0;

    return (
      <Card accentColor={hero.col}>

        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            background: `${hero.col}12`, border: `1px solid ${hero.col}30`,
            borderRadius: 14, padding: '18px 32px',
          }}>
            <span style={{ fontSize: '1.25rem', fontWeight: 900, color: hero.col, letterSpacing: '-0.2px' }}>
              Performance Breakdown
            </span>
            <span style={{ fontSize: '0.76rem', color: '#777', maxWidth: 260, lineHeight: 1.55, textAlign: 'center' }}>
              {hero.sub}
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: '2.2rem', fontWeight: 900, color: hero.col, lineHeight: 1 }}>{score}</span>
              <span style={{ fontSize: '0.8rem', color: '#444' }}>/ 100</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: hero.col, marginLeft: 4 }}>{bp.grade}</span>
            </div>
            <span style={{ ...LS, color: '#444', marginTop: 2 }}>Historical Performance Score</span>
          </div>
        </div>

        {/* Primary finding */}
        {bp.primaryIssue?.message && (
          <div style={{
            background: '#111', border: '1px solid #2a2a2a', borderRadius: 10,
            padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>📊</span>
            <div>
              <div style={{ ...LS, color: hero.col, marginBottom: 5 }}>Primary Finding</div>
              <div style={{ fontSize: '0.82rem', color: '#ccc', lineHeight: 1.6 }}>
                {bp.primaryIssue.message}
              </div>
            </div>
          </div>
        )}

        {/* Analysis notes */}
        {bp.diagnostics?.length > 0 && (
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ ...LS, color: '#6b7280', marginBottom: 10 }}>Analysis Notes</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {bp.diagnostics.map((d, i) => (
                <div key={i} style={{ display: 'flex', gap: 9, fontSize: '0.78rem', color: '#999', lineHeight: 1.45 }}>
                  <span style={{ color: '#4b5563', flexShrink: 0 }}>—</span>
                  <span>{typeof d === 'string' ? d : d.message ?? ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Strengths + Weaknesses */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: '#0d1f13', border: '1px solid #1a3d22', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ ...LS, color: '#4ade80', marginBottom: 8 }}>Strengths</div>
            <p style={{ margin: 0, fontSize: '0.78rem', color: '#86efac', lineHeight: 1.55 }}>
              {bp.strengths || 'None identified'}
            </p>
          </div>
          <div style={{ background: '#1a0d0d', border: '1px solid #3d1a1a', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ ...LS, color: '#f87171', marginBottom: 8 }}>Weaknesses</div>
            <p style={{ margin: 0, fontSize: '0.78rem', color: '#fca5a5', lineHeight: 1.55 }}>
              {bp.weaknesses || 'None identified'}
            </p>
          </div>
        </div>

        {/* Re-analyze */}
        <AnalyzeButton onClick={onAnalyze} loading={false} label="↻ Re-run Analysis" />

      </Card>
    );
  }

  // ── LEGACY STATE 4d — unreachable, kept as tombstone ────────────────────
  if (false) {
    const score  = bp.viralScore ?? 0;
    const hero   = getEmotionalHero(score, bp);

    const metricsObj = {
      packaging:  bp.scores?.packaging  ?? 0,
      engagement: bp.scores?.engagement ?? 0,
      seo:        bp.scores?.seo        ?? 0,
      velocity:   bp.scores?.velocity   ?? 0,
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
            <span style={{ fontSize: '0.62rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Content Quality Score</span>
          </div>
        </div>

        {/* ── Milestone strip ── */}
        {(() => {
          const ms = getMilestone(score);
          const barColor = ms.pct >= 80 ? '#22c55e' : ms.pct >= 50 ? '#7c3aed' : '#f97316';
          return (
            <div style={{ background: '#0a0a12', border: '1px solid #1a1a2a', borderRadius: 10, padding: '12px 16px' }}>
              {/* Label above bar */}
              {ms.next && (
                <div style={{ fontSize: '0.64rem', color: '#555', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ color: barColor, fontWeight: 700 }}>{score}</span>
                  <span style={{ color: '#333' }}>→</span>
                  <span style={{ color: '#a78bfa', fontWeight: 700 }}>{ms.nextScore}</span>
                  <span style={{ color: '#444' }}>({ms.next})</span>
                </div>
              )}
              {/* Bar with markers */}
              <div style={{ position: 'relative', height: 4, background: '#1a1a2a', borderRadius: 2, marginBottom: 14 }}>
                {/* Fill */}
                <div style={{ height: '100%', width: `${ms.pct}%`, background: barColor, borderRadius: 2, transition: 'width 0.6s ease' }} />
                {/* Current position dot */}
                <div style={{
                  position: 'absolute', left: `${ms.pct}%`, top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 10, height: 10, borderRadius: '50%',
                  background: barColor, border: '2px solid #0a0a12',
                  transition: 'left 0.6s ease',
                  boxShadow: `0 0 8px ${barColor}88`,
                  zIndex: 1,
                }} />
                {/* Next milestone tick at end of bar */}
                {ms.next && (
                  <div style={{
                    position: 'absolute', right: 0, top: -4,
                    width: 2, height: 12,
                    background: '#7c3aed99', borderRadius: 1,
                  }} />
                )}
              </div>
              {ms.next
                ? <div style={{ fontSize: '0.72rem', color: '#666' }}>
                    You are{' '}
                    <span style={{ color: '#c4b5fd', fontWeight: 700 }}>{ms.ptsAway} point{ms.ptsAway !== 1 ? 's' : ''}</span>
                    {' '}away from{' '}
                    <span style={{ color: '#c4b5fd', fontWeight: 700 }}>{ms.next} ({ms.nextScore})</span>
                  </div>
                : <div style={{ fontSize: '0.72rem', color: '#22c55e', fontWeight: 700 }}>🎉 You've reached Viral Potential</div>
              }
            </div>
          );
        })()}

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

}
