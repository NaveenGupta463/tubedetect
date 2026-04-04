import { useState, useEffect, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area,
} from 'recharts';
import { fetchVideoComments } from '../api/youtube';
import { predictGrowth, analyzeVideoDeep } from '../api/claude';
import { analyzeVideo, extractTimestamps, formatNum, parseDuration } from '../utils/analysis';
import { meetsRequirement } from '../utils/tierConfig';

// ── ScoreRing ─────────────────────────────────────────────────────────────────
function ScoreRing({ score, label, size = 72 }) {
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
function BigScoreRing({ score, grade }) {
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
function SkeletonCard({ lines = 4 }) {
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
function AiRunPrompt({ onRun, loading, noAI, onUpgrade, tabLabel }) {
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
function GradeCircle({ grade, score }) {
  const color = score >= 75 ? '#00c853' : score >= 55 ? '#ff9100' : score >= 40 ? '#ff6d00' : '#ff1744';
  return (
    <div className="grade-circle" style={{ borderColor: color }}>
      <div className="grade-letter" style={{ color }}>{grade}</div>
      <div className="grade-score" style={{ color }}>{score}/100</div>
    </div>
  );
}

// ── InsightItem ───────────────────────────────────────────────────────────────
function InsightItem({ item }) {
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
const ChartTooltip = ({ active, payload, label }) => {
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

// ── VideoReportCard ───────────────────────────────────────────────────────────
function VideoReportCard({ metrics, video }) {
  const [copied, setCopied] = useState(false);
  const { engagementRate, likeRate, commentRate, viewsRatio } = metrics;
  const title = video.snippet?.title || '';
  const publishedAt = video.snippet?.publishedAt;

  const viewsScore = viewsRatio >= 3 ? 95 : viewsRatio >= 1.5 ? 82 : viewsRatio >= 1.0 ? 65 : viewsRatio >= 0.7 ? 50 : viewsRatio >= 0.4 ? 35 : 20;
  const engScore   = engagementRate >= 5 ? 95 : engagementRate >= 3 ? 82 : engagementRate >= 2 ? 68 : engagementRate >= 1 ? 52 : engagementRate >= 0.5 ? 38 : 20;
  const cmtScore   = commentRate >= 0.3 ? 95 : commentRate >= 0.1 ? 82 : commentRate >= 0.05 ? 65 : commentRate >= 0.02 ? 50 : commentRate >= 0.01 ? 35 : 20;

  let titleScore = 50;
  if (title.length >= 40 && title.length <= 70) titleScore += 20;
  else if (title.length > 100 || title.length < 25) titleScore -= 15;
  if (/\?/.test(title)) titleScore += 10;
  if (/\d/.test(title)) titleScore += 10;
  const upperWords = title.match(/\b[A-Z]{3,}\b/g) || [];
  if (upperWords.length > 0 && upperWords.length <= 3) titleScore += 10;
  titleScore = Math.max(10, Math.min(100, titleScore));

  let timingScore = 58;
  if (publishedAt) {
    const day = new Date(publishedAt).getDay();
    if (day === 4 || day === 5) timingScore = 88;
    else if (day === 6 || day === 0) timingScore = 72;
    else if (day === 3) timingScore = 60;
    else timingScore = 35;
  }

  const getGrade = s => s >= 85 ? 'A+' : s >= 75 ? 'A' : s >= 65 ? 'B' : s >= 55 ? 'C' : s >= 40 ? 'D' : 'F';
  const getColor = s => s >= 75 ? '#00c853' : s >= 55 ? '#ff9100' : s >= 40 ? '#ff6d00' : '#ff1744';

  const cards = [
    { label: 'Views',      score: viewsScore,  detail: `${Math.round(viewsRatio * 100)}% of avg` },
    { label: 'Engagement', score: engScore,     detail: `${engagementRate.toFixed(2)}%` },
    { label: 'Comments',   score: cmtScore,     detail: `${commentRate.toFixed(3)}%` },
    { label: 'Title',      score: titleScore,   detail: `${title.length} chars` },
    { label: 'Timing',     score: timingScore,  detail: publishedAt ? new Date(publishedAt).toLocaleDateString('en-US', { weekday: 'short' }) : '—' },
  ];

  const handleShare = () => {
    const text = [
      `📋 Video Report Card: "${title.slice(0, 60)}"`,
      `Views: ${formatNum(metrics.views)} | Likes: ${formatNum(metrics.likes)} | Engagement: ${engagementRate.toFixed(2)}%`,
      `Grades — Views: ${getGrade(viewsScore)} | Engagement: ${getGrade(engScore)} | Comments: ${getGrade(cmtScore)} | Title: ${getGrade(titleScore)} | Timing: ${getGrade(timingScore)}`,
    ].join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="chart-card">
      <div className="chart-title-row">
        <h3 className="chart-title">📋 Video Report Card</h3>
        <button
          onClick={handleShare}
          style={{
            background: copied ? '#00c85322' : '#1a1a1a',
            border: `1px solid ${copied ? '#00c853' : '#333'}`,
            borderRadius: 6, padding: '5px 12px',
            fontSize: 12, fontWeight: 700,
            color: copied ? '#00c853' : '#888',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {copied ? '✅ Copied!' : '📤 Share Summary'}
        </button>
      </div>
      <p className="chart-subtitle">Performance grades across 5 key dimensions</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginTop: 12 }}>
        {cards.map(c => (
          <div key={c.label} style={{
            background: '#111', borderRadius: 10, padding: '14px 10px', textAlign: 'center',
            border: `1px solid ${getColor(c.score)}33`,
          }}>
            <div style={{ fontSize: 30, fontWeight: 900, color: getColor(c.score), lineHeight: 1 }}>{getGrade(c.score)}</div>
            <div style={{ fontSize: 12, color: getColor(c.score), fontWeight: 700, marginTop: 4 }}>{c.detail}</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── GrowthPrediction ──────────────────────────────────────────────────────────
function GrowthPrediction({ video, allVideos, channelAvg, canUseAI, consumeAICall, remainingCalls, onUpgrade }) {
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const stats = video.statistics || {};
  const views = parseInt(stats.viewCount || 0);
  const likes = parseInt(stats.likeCount || 0);
  const comments = parseInt(stats.commentCount || 0);

  const handlePredict = async () => {
    if (!canUseAI || !canUseAI()) {
      setError('No AI calls remaining. Upgrade to Pro for growth predictions.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const dur = parseDuration(video.contentDetails?.duration);
      const videoData = {
        title: video.snippet?.title,
        views: formatNum(views),
        likes: formatNum(likes),
        likeRate: views > 0 ? ((likes / views) * 100).toFixed(2) : '0',
        commentRate: views > 0 ? ((comments / views) * 100).toFixed(3) : '0',
        duration: dur.formatted,
        publishedAt: video.snippet?.publishedAt ? new Date(video.snippet.publishedAt).toLocaleDateString() : '',
      };
      const r = await predictGrowth(videoData, formatNum(Math.round(channelAvg.views)));
      consumeAICall();
      setPrediction(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const longevityType  = prediction?.longevityType;
  const longevityColor = longevityType === 'Evergreen' ? '#00c853' : longevityType === 'Trending' ? '#ff9100' : '#ff1744';
  const longevityIcon  = longevityType === 'Evergreen' ? '🌲' : longevityType === 'Trending' ? '🔥' : '📉';
  const growthScore    = prediction?.growthScore ?? null;
  const growthScoreColor = growthScore >= 7 ? '#00c853' : growthScore >= 5 ? '#ff9100' : '#ff1744';
  const confidence     = prediction?.confidencePercent ?? null;

  return (
    <div className="chart-card" style={{ borderTop: '3px solid #7c4dff' }}>
      <div className="chart-title-row">
        <h3 className="chart-title">📈 Growth Prediction</h3>
        {!prediction && !loading && (
          <button className="btn-primary btn-small" onClick={handlePredict} disabled={loading}>
            {loading ? <><span className="btn-spinner" /> Predicting…</> : '🔮 Predict Growth'}
          </button>
        )}
        {prediction && (
          <button className="btn-small" onClick={() => { setPrediction(null); setError(''); }}
            style={{ fontSize: 12, color: '#666', background: 'none', border: '1px solid #333', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
            ↺ Re-run
          </button>
        )}
      </div>
      <p className="chart-subtitle">AI predicts 30-day views, content longevity, and follow-up opportunity</p>

      {!prediction && !loading && !error && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#555', fontSize: 13 }}>
          {canUseAI && canUseAI()
            ? `${remainingCalls ? remainingCalls() : '?'} AI calls remaining — click to predict growth`
            : 'Upgrade to Pro to unlock growth predictions'}
        </div>
      )}

      {error && <div className="search-error" style={{ marginTop: 8 }}>{error}</div>}

      {loading && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#888', fontSize: 13 }}>
          <span className="btn-spinner" style={{ marginRight: 8 }} />
          TubeIntel is analyzing trajectory…
        </div>
      )}

      {prediction && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
            <div style={{ background: '#1a1a1a', borderRadius: 10, padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#7c4dff', marginBottom: 2, lineHeight: 1.2 }}>
                {prediction.expectedViews30Days || '—'}
              </div>
              {confidence !== null && (
                <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
                  <span style={{ color: confidence >= 70 ? '#00c853' : confidence >= 50 ? '#ff9100' : '#ff1744', fontWeight: 700 }}>
                    {confidence}%
                  </span> confidence
                </div>
              )}
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>Expected Views (30d)</div>
            </div>
            <div style={{ background: '#1a1a1a', borderRadius: 10, padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, marginBottom: 2 }}>{longevityIcon}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: longevityColor, marginBottom: 2 }}>{longevityType || '—'}</div>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>Content Longevity</div>
            </div>
            <div style={{ background: '#1a1a1a', borderRadius: 10, padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: growthScoreColor, marginBottom: 2 }}>{growthScore !== null ? growthScore : '—'}</div>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>/ 10</div>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>Growth Score</div>
            </div>
          </div>
          {prediction.vsChannelAverage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 12, color: '#666' }}>vs Channel Average:</span>
              <span style={{
                fontSize: 12, fontWeight: 700,
                color: prediction.vsChannelAverage === 'above' ? '#00c853' : prediction.vsChannelAverage === 'below' ? '#ff1744' : '#ff9100',
                background: (prediction.vsChannelAverage === 'above' ? '#00c853' : prediction.vsChannelAverage === 'below' ? '#ff1744' : '#ff9100') + '22',
                padding: '3px 10px', borderRadius: 4,
              }}>
                {prediction.vsChannelAveragePercent || prediction.vsChannelAverage}
              </span>
            </div>
          )}
          {prediction.longevityExplanation && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: longevityColor, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                {longevityIcon} Longevity Explained
              </div>
              <div className="ai-text-block" style={{ marginTop: 0 }}>{prediction.longevityExplanation}</div>
            </div>
          )}
          {prediction.followUpVideo && (
            <div style={{ background: '#111', border: '1px solid #00c85333', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#00c853', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                🎬 Follow-Up Video Suggestion
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 6, lineHeight: 1.4 }}>
                "{prediction.followUpVideo.title}"
              </div>
              {(prediction.followUpVideo.angle || prediction.followUpVideo.reason) && (
                <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>
                  {prediction.followUpVideo.angle || prediction.followUpVideo.reason}
                </div>
              )}
            </div>
          )}
          {prediction.prediction && <div className="ai-text-block">{prediction.prediction}</div>}
        </div>
      )}
    </div>
  );
}

// ── UpgradeModal ──────────────────────────────────────────────────────────────
function UpgradeModal({ onUpgrade, onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: '#0f0f0f', border: '1px solid #2a2a2a',
        borderRadius: 16, padding: '32px 28px', maxWidth: 400, width: '100%',
        boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
        textAlign: 'center',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 48, marginBottom: 12, animation: 'lockBounce 0.5s ease' }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', marginBottom: 8 }}>
          This is a Pro Feature
        </div>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 22, lineHeight: 1.7 }}>
          Upgrade to Pro to unlock the complete 6-tab deep video analysis.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24, textAlign: 'left' }}>
          {[
            '🎯 Thumbnail psychology score + 3 improved title alternatives',
            '🪝 Hook strength analysis + 7-phase structure timeline',
            '🧠 8 psychological trigger detection + retention prediction',
            '⚡ 5 virality factors + algorithm performance score',
            '🏆 Content DNA blueprint + replication steps + overall score',
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#aaa', alignItems: 'flex-start' }}>
              <span style={{ color: '#00c853', flexShrink: 0, marginTop: 1 }}>✓</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 18 }}>
          Starting at <span style={{ color: '#7c4dff', fontWeight: 700 }}>₹999/month</span> or <span style={{ color: '#7c4dff', fontWeight: 700 }}>$12/month</span>
        </div>
        <button
          onClick={() => { onClose(); onUpgrade(); }}
          style={{
            width: '100%', background: '#ff0000', border: 'none',
            borderRadius: 8, padding: '13px 0',
            fontSize: 14, fontWeight: 800, color: '#fff', cursor: 'pointer',
            marginBottom: 10,
          }}
        >
          Upgrade to Pro →
        </button>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', fontSize: 13, color: '#444', cursor: 'pointer' }}
        >
          Maybe Later
        </button>
      </div>
    </div>
  );
}

// ── LockedTabContent ──────────────────────────────────────────────────────────
function LockedTabContent({ tabLabel, onUpgrade }) {
  // Fake blurred preview cards
  const fakeRows = [4, 3, 5, 3, 4];
  return (
    <div style={{ position: 'relative' }}>
      {/* Blurred skeleton preview */}
      <div style={{ filter: 'blur(6px)', pointerEvents: 'none', userSelect: 'none', opacity: 0.35 }}>
        {fakeRows.map((lines, i) => (
          <div key={i} className="chart-card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Array.from({ length: lines }).map((_, j) => (
                <div key={j} className="skeleton-line" style={{ width: `${95 - j * 10}%`, height: j === 0 ? 18 : 13 }} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Centered upgrade card on top */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
        <div style={{
          background: 'rgba(8,8,8,0.92)', border: '1px solid #2a2a2a',
          borderRadius: 16, padding: '32px 28px', maxWidth: 380, width: '100%',
          textAlign: 'center', boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 8 }}>
            {tabLabel} — Pro Feature
          </div>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 20, lineHeight: 1.7 }}>
            Unlock AI-powered deep analysis for every video. Get actionable insights that help you create better content.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20, textAlign: 'left' }}>
            {[
              'Thumbnail psychology scores + improved title alternatives',
              'Hook strength + full video structure timeline',
              'Algorithm virality factors + content DNA blueprint',
            ].map((item, i) => (
              <div key={i} style={{ fontSize: 12, color: '#888', display: 'flex', gap: 8 }}>
                <span style={{ color: '#7c4dff' }}>→</span><span>{item}</span>
              </div>
            ))}
          </div>
          <button
            onClick={onUpgrade}
            style={{
              width: '100%', background: 'linear-gradient(135deg, #ff0000, #cc0000)',
              border: 'none', borderRadius: 8, padding: '12px 0',
              fontSize: 13, fontWeight: 800, color: '#fff', cursor: 'pointer',
            }}
          >
            🔓 Unlock Deep Video Analysis — Upgrade to Pro
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ProTeaserCard (shown on overview for free users) ──────────────────────────
function ProTeaserCard({ score, onUpgrade }) {
  // Show 3 fake blurred score rings to create curiosity
  const fakeScores = [
    { label: 'Thumbnail', value: Math.max(20, Math.min(95, score + Math.round((Math.random() - 0.4) * 20))) },
    { label: 'Hook',      value: Math.max(20, Math.min(95, score + Math.round((Math.random() - 0.5) * 25))) },
    { label: 'Algorithm', value: Math.max(20, Math.min(95, score + Math.round((Math.random() - 0.3) * 18))) },
  ];
  return (
    <div className="chart-card" style={{ border: '1px solid #7c4dff33', background: 'linear-gradient(135deg, #0d0d0d, #100d18)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 className="chart-title" style={{ marginBottom: 2 }}>🔒 Deep Analysis Preview</h3>
          <p className="chart-subtitle">Pro users get a full breakdown across 5 AI dimensions</p>
        </div>
        <span style={{ background: '#7c4dff22', border: '1px solid #7c4dff44', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: '#b39ddb' }}>
          Pro Feature
        </span>
      </div>

      {/* 3 blurred score rings */}
      <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginBottom: 18, filter: 'blur(3px)', userSelect: 'none', pointerEvents: 'none' }}>
        {fakeScores.map(s => (
          <ScoreRing key={s.label} score={s.value} label={s.label} size={72} />
        ))}
      </div>

      <div style={{ fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 16, lineHeight: 1.7 }}>
        Your video scored in <strong style={{ color: '#b39ddb' }}>Thumbnail</strong>, <strong style={{ color: '#b39ddb' }}>Hook</strong>, and <strong style={{ color: '#b39ddb' }}>Algorithm</strong> dimensions — upgrade to see the full breakdown and actionable blueprint.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 18 }}>
        {['Thumbnail Psychology', 'Hook Strength', 'Retention Curve', 'Virality Factors', 'Content DNA', 'Blueprint'].map(tag => (
          <span key={tag} style={{ background: '#111', border: '1px solid #222', borderRadius: 20, padding: '3px 10px', fontSize: 11, color: '#444' }}>
            {tag}
          </span>
        ))}
      </div>

      <button
        onClick={onUpgrade}
        className="run-analysis-glow-btn"
        style={{ width: '100%', justifyContent: 'center', padding: '12px 0', fontSize: 13 }}
      >
        🧠 Run Deep Analysis — Upgrade to Pro
      </button>
    </div>
  );
}

// ── AgencyBulkPanel ──────────────────────────────────────────────────────────
function AgencyBulkPanel({ videos, currentVideoId, bulkQueue, setBulkQueue, onVideoSelect }) {
  const [open, setOpen] = useState(false);
  const remaining = videos.filter(v => v.id !== currentVideoId).slice(0, 10);

  const toggleVideo = (id) => {
    setBulkQueue(q => q.includes(id) ? q.filter(x => x !== id) : [...q, id].slice(0, 10));
  };

  return (
    <div className="chart-card" style={{ marginTop: 16, border: '1px solid #ff990033', background: 'linear-gradient(135deg,#0d0d0d,#0f0d0a)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div>
          <h3 className="chart-title" style={{ marginBottom: 2 }}>⚡ Agency Bulk Analyze</h3>
          <p className="chart-subtitle">Analyze up to 10 videos at once — Agency tier exclusive</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: '#ff990022', border: '1px solid #ff990044', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: '#ffb74d' }}>
            Agency
          </span>
          <span style={{ color: '#555', fontSize: 14 }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>
            Select videos to add to your analysis queue. Click any queued video to jump directly to its analysis.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
            {remaining.map(v => {
              const inQueue = bulkQueue.includes(v.id);
              const thumb = v.snippet?.thumbnails?.default?.url;
              return (
                <div
                  key={v.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: inQueue ? '#ff990011' : '#0f0f0f',
                    border: `1px solid ${inQueue ? '#ff990033' : '#1a1a1a'}`,
                    borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
                  }}
                  onClick={() => toggleVideo(v.id)}
                >
                  {thumb && <img src={thumb} alt="" style={{ width: 40, height: 28, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.snippet?.title}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: inQueue ? '#ffb74d' : '#333', flexShrink: 0 }}>
                    {inQueue ? '✓ Queued' : '+ Add'}
                  </span>
                </div>
              );
            })}
          </div>
          {bulkQueue.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                {bulkQueue.length} video{bulkQueue.length > 1 ? 's' : ''} queued — click to analyze each:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {bulkQueue.map(id => {
                  const v = videos.find(v => v.id === id);
                  return v ? (
                    <button
                      key={id}
                      onClick={() => onVideoSelect(v)}
                      style={{
                        background: '#ff990022', border: '1px solid #ff990044',
                        borderRadius: 6, padding: '4px 12px', fontSize: 11,
                        fontWeight: 600, color: '#ffb74d', cursor: 'pointer',
                        maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {v.snippet?.title?.slice(0, 30)}…
                    </button>
                  ) : null;
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const DEEP_CACHE_PREFIX = 'tubeintel_deep_';

const TABS = [
  { id: 'overview',   label: '📊 Overview',           ai: false, minTier: null },
  { id: 'title',      label: '🎯 Thumbnail & Title',  ai: true,  minTier: 'pro' },
  { id: 'hook',       label: '🪝 Hook & Structure',    ai: true,  minTier: 'pro' },
  { id: 'psych',      label: '🧠 Psychology',          ai: true,  minTier: 'pro' },
  { id: 'algo',       label: '⚡ Algorithm',           ai: true,  minTier: 'pro' },
  { id: 'blueprint',  label: '🏆 Blueprint & Score',  ai: true,  minTier: 'pro' },
];

export default function VideoAnalysis({
  video, allVideos, channelStats,
  tier, canUseAI, consumeAICall, remainingCalls, onUpgrade,
  onBack, onVideoSelect,
}) {
  const isPro = meetsRequirement(tier, 'pro');
  const isAgency = meetsRequirement(tier, 'agency');

  const [activeTab, setActiveTab] = useState('overview');
  const [comments, setComments] = useState(null);
  const [loadingComments, setLoadingComments] = useState(true);
  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [progress, setProgress] = useState(0);
  const [copiedReport, setCopiedReport] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [bulkQueue, setBulkQueue] = useState([]);
  const progressTimerRef = useRef(null);
  const tabBarRef = useRef(null);

  // Load cached AI analysis
  useEffect(() => {
    setAiData(null);
    setAiError('');
    if (!video?.id) return;
    try {
      const cached = localStorage.getItem(DEEP_CACHE_PREFIX + video.id);
      if (cached) setAiData(JSON.parse(cached));
    } catch {}
  }, [video?.id]);

  // Fetch comments
  useEffect(() => {
    if (!video?.id) return;
    setComments(null);
    setLoadingComments(true);
    fetchVideoComments(video.id, 100).then(c => {
      setComments(c);
      setLoadingComments(false);
    });
  }, [video?.id]);

  // Fake progress animation
  useEffect(() => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    if (!aiLoading) { setProgress(0); return; }
    setProgress(5);
    progressTimerRef.current = setInterval(() => {
      setProgress(p => p >= 90 ? 90 : p + Math.random() * 5 + 2);
    }, 700);
    return () => clearInterval(progressTimerRef.current);
  }, [aiLoading]);

  const result = analyzeVideo(video, allVideos, channelStats);
  const { score, grade, metrics, analysis, channelAvg } = result;
  const { views, likes, comments: commentCount, engagementRate, likeRate, commentRate, duration } = metrics;

  const publishDate = video.snippet?.publishedAt
    ? new Date(video.snippet.publishedAt).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  // Prev / Next
  const vidIdx = allVideos.findIndex(v => v.id === video.id);
  const prevVid = vidIdx > 0 ? allVideos[vidIdx - 1] : null;
  const nextVid = vidIdx < allVideos.length - 1 ? allVideos[vidIdx + 1] : null;

  const handleDeepAnalysis = async () => {
    if (!canUseAI || !canUseAI()) {
      setAiError('No AI calls remaining. Upgrade to unlock deep analysis.');
      return;
    }
    setAiLoading(true);
    setAiError('');
    try {
      const dur = parseDuration(video.contentDetails?.duration);
      const stats = video.statistics || {};
      const vws = parseInt(stats.viewCount || 0);
      const lks = parseInt(stats.likeCount || 0);
      const cms = parseInt(stats.commentCount || 0);

      const videoData = {
        title: video.snippet?.title || '',
        views: formatNum(vws),
        likes: formatNum(lks),
        commentCount: formatNum(cms),
        engagementRate: vws > 0 ? ((lks + cms) / vws * 100).toFixed(2) : '0',
        likeRate: vws > 0 ? (lks / vws * 100).toFixed(2) : '0',
        commentRate: vws > 0 ? (cms / vws * 100).toFixed(3) : '0',
        duration: dur.formatted,
        publishedAt: video.snippet?.publishedAt ? new Date(video.snippet.publishedAt).toLocaleDateString() : '',
        vsChannelAvg: Math.round(metrics.viewsRatio * 100),
        tags: (video.snippet?.tags || []).slice(0, 10).join(', ') || 'none',
      };

      const commentsText = comments?.length
        ? comments.slice(0, 30).map(c =>
            (c.snippet?.topLevelComment?.snippet?.textDisplay || '').replace(/<[^>]+>/g, '')
          ).filter(Boolean).join('\n')
        : 'No comments available';

      const deepResult = await analyzeVideoDeep(videoData, commentsText);
      if (deepResult) {
        consumeAICall();
        setAiData(deepResult);
        setProgress(100);
        try { localStorage.setItem(DEEP_CACHE_PREFIX + video.id, JSON.stringify(deepResult)); } catch {}
      } else {
        setAiError('Analysis returned an unexpected format. Please try again.');
      }
    } catch (e) {
      setAiError(e.message);
    } finally {
      setAiLoading(false);
    }
  };

  // Routes to upgrade modal (free) or runs analysis (pro)
  const handleRunDeepClick = () => {
    if (!isPro) { setShowUpgradeModal(true); return; }
    if (!canUseAI?.()) { onUpgrade?.(); return; }
    handleDeepAnalysis();
  };

  // ── Comparison chart data ───────────────────────────────────────────────────
  const comparisonData = [
    { metric: 'Views',    'This Video': views,        'Channel Avg': Math.round(channelAvg.views) },
    { metric: 'Likes',    'This Video': likes,        'Channel Avg': Math.round(allVideos.reduce((s, v) => s + parseInt(v.statistics?.likeCount || 0), 0) / allVideos.length) },
    { metric: 'Comments', 'This Video': commentCount, 'Channel Avg': Math.round(allVideos.reduce((s, v) => s + parseInt(v.statistics?.commentCount || 0), 0) / allVideos.length) },
  ];

  // ── Timestamps ──────────────────────────────────────────────────────────────
  const timestamps = comments && duration.total > 0 ? extractTimestamps(comments, duration.total) : [];
  const maxTimestampCount = Math.max(...timestamps.map(t => t.count), 1);

  const scoreColor = score >= 75 ? '#00c853' : score >= 55 ? '#ff9100' : score >= 40 ? '#ff6d00' : '#ff1744';

  // ── Blueprint score rings ───────────────────────────────────────────────────
  const bpScores = aiData?.blueprint?.scores || {};
  const overviewRings = [
    { score: bpScores.titleThumbnail ?? null,      label: 'Title &\nThumb' },
    { score: bpScores.hookRetention ?? null,       label: 'Hook &\nRetention' },
    { score: bpScores.contentStructure ?? null,    label: 'Structure' },
    { score: bpScores.engagement ?? null,          label: 'Engagement' },
    { score: bpScores.algorithm ?? null,           label: 'Algorithm' },
    { score: bpScores.seoDiscoverability ?? null,  label: 'SEO' },
    { score: bpScores.emotionalImpact ?? null,     label: 'Emotion' },
    { score: bpScores.valueDelivery ?? null,       label: 'Value' },
  ];

  // ── Copy full report ────────────────────────────────────────────────────────
  const handleCopyReport = () => {
    const lines = [
      `=== TubeIntel Deep Analysis ===`,
      `Video: "${video.snippet?.title}"`,
      `Published: ${publishDate || '—'} | Duration: ${duration.formatted}`,
      `Views: ${formatNum(views)} | Likes: ${formatNum(likes)} | Engagement: ${engagementRate.toFixed(2)}%`,
      '',
    ];
    if (aiData?.blueprint) {
      const bp = aiData.blueprint;
      lines.push(`Overall Score: ${bp.overallScore}/100 (${bp.grade})`);
      lines.push(`Content DNA: ${bp.contentDNA}`);
      lines.push('');
      if (bp.replicationBlueprint?.length) {
        lines.push('--- Replication Blueprint ---');
        bp.replicationBlueprint.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
        lines.push('');
      }
      if (bp.lessons?.length) {
        lines.push('--- Actionable Lessons ---');
        bp.lessons.forEach(l => lines.push(`• ${l.title}: ${l.detail}`));
        lines.push('');
      }
      lines.push(`Strengths: ${bp.strengths}`);
      lines.push(`Improvements: ${bp.improvements}`);
    }
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  // ── TAB RENDERERS ───────────────────────────────────────────────────────────

  const renderOverviewTab = () => (
    <>
      {/* 8 Score Rings preview */}
      <div className="chart-card" style={!aiData ? { border: '1px solid #ff000033', background: 'linear-gradient(135deg, #0d0d0d, #110808)' } : {}}>
        <div className="chart-title-row">
          <h3 className="chart-title">8-Dimension Score Preview</h3>
          {aiData && <span style={{ fontSize: 11, color: '#00c853', fontWeight: 700 }}>● Analysis complete</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 12, marginTop: 12, justifyItems: 'center' }}>
          {overviewRings.map(r => (
            <div key={r.label} className={!aiData && r.score == null ? 'ring-pulse' : ''}>
              <ScoreRing score={r.score} label={r.label} size={72} />
            </div>
          ))}
        </div>
        {!aiData && !aiLoading && (
          <div style={{ textAlign: 'center', marginTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#555' }}>
              Run Deep Analysis to unlock all 8 dimension scores
            </div>
            <button
              onClick={handleRunDeepClick}
              className="run-analysis-glow-btn"
              style={{ padding: '10px 28px', fontSize: 13 }}
            >
              🧠 {!isPro ? '🔒 Click to fill these scores' : 'Click to fill these scores'}
            </button>
          </div>
        )}
        {aiLoading && (
          <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span className="btn-spinner" /> Calculating dimension scores…
          </div>
        )}
      </div>

      {/* Performance Score */}
      <div className="perf-row">
        <div className="perf-score-card">
          <GradeCircle grade={grade} score={score} />
          <div className="perf-score-info">
            <div className="perf-score-title">Performance Score</div>
            <div className="perf-score-desc">
              {score >= 75 ? 'Top-performing video for this channel'
                : score >= 55 ? 'Above-average performance'
                : score >= 40 ? 'Average performance'
                : 'Below-average — needs improvement'}
            </div>
            <div className="perf-score-bars">
              <div className="perf-bar-row">
                <span>Like rate</span>
                <div className="perf-bar-bg">
                  <div className="perf-bar-fill" style={{ width: `${Math.min(100, likeRate * 20)}%`, background: likeRate > 3 ? '#00c853' : likeRate > 1 ? '#ff9100' : '#ff1744' }} />
                </div>
                <span>{likeRate.toFixed(2)}%</span>
              </div>
              <div className="perf-bar-row">
                <span>Comment rate</span>
                <div className="perf-bar-bg">
                  <div className="perf-bar-fill" style={{ width: `${Math.min(100, commentRate * 200)}%`, background: commentRate > 0.2 ? '#00c853' : commentRate > 0.05 ? '#ff9100' : '#ff1744' }} />
                </div>
                <span>{commentRate.toFixed(3)}%</span>
              </div>
              <div className="perf-bar-row">
                <span>vs Channel avg</span>
                <div className="perf-bar-bg">
                  <div className="perf-bar-fill" style={{ width: `${Math.min(100, metrics.viewsRatio * 50)}%`, background: metrics.viewsRatio > 1.5 ? '#00c853' : metrics.viewsRatio > 0.7 ? '#ff9100' : '#ff1744' }} />
                </div>
                <span>{Math.round(metrics.viewsRatio * 100)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <VideoReportCard metrics={metrics} video={video} />

      <GrowthPrediction
        video={video} allVideos={allVideos} channelAvg={channelAvg}
        canUseAI={canUseAI} consumeAICall={consumeAICall}
        remainingCalls={remainingCalls} onUpgrade={onUpgrade}
      />

      {/* What Worked / What Didn't */}
      <div className="insights-grid">
        <div className="insights-panel insights-good">
          <div className="insights-panel-header">
            <span className="insights-panel-icon">✅</span>
            <h3 className="insights-panel-title">What Worked</h3>
            <span className="insights-count">{analysis.positives.length}</span>
          </div>
          {analysis.positives.length === 0
            ? <div className="insights-empty">No notable strengths detected.</div>
            : analysis.positives.map((item, i) => <InsightItem key={i} item={item} />)}
        </div>
        <div className="insights-panel insights-bad">
          <div className="insights-panel-header">
            <span className="insights-panel-icon">⚠️</span>
            <h3 className="insights-panel-title">What Didn't Work</h3>
            <span className="insights-count">{analysis.negatives.length}</span>
          </div>
          {analysis.negatives.length === 0
            ? <div className="insights-empty">No significant issues detected.</div>
            : analysis.negatives.map((item, i) => <InsightItem key={i} item={item} />)}
        </div>
      </div>

      {/* Comparison Chart */}
      <div className="chart-card">
        <h3 className="chart-title">This Video vs Channel Average</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={comparisonData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
            <XAxis dataKey="metric" tick={{ fill: '#aaa', fontSize: 13 }} />
            <YAxis tickFormatter={v => formatNum(v)} tick={{ fill: '#888', fontSize: 11 }} width={55} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="This Video" fill="#ff0000" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Channel Avg" fill="#444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Timestamp Heatmap */}
      <div className="chart-card">
        <h3 className="chart-title">
          Comment Interaction Timeline
          <span className="chart-title-badge">Based on timestamps in comments</span>
        </h3>
        <p className="chart-subtitle">Peaks show moments viewers found most compelling.</p>
        {loadingComments ? (
          <div className="chart-loading"><span className="loading-dot" style={{ marginRight: 8 }} />Loading comments…</div>
        ) : timestamps.length === 0 ? (
          <div className="chart-empty">
            <span className="chart-empty-icon">💬</span>
            <span>No timestamp data found in comments.</span>
            <span style={{ fontSize: 13, color: '#666', marginTop: 4 }}>Comments may be disabled or viewers didn't mention timestamps.</span>
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={timestamps} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="tsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff0000" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#ff0000" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="label" tick={{ fill: '#888', fontSize: 10 }} interval={Math.floor(timestamps.length / 8)} />
                <YAxis tick={{ fill: '#888', fontSize: 11 }} width={30} />
                <Tooltip content={({ active, payload, label }) => {
                  if (active && payload?.length) return (
                    <div className="chart-tooltip">
                      <div className="chart-tooltip-label">At {label}</div>
                      <div className="chart-tooltip-row">
                        <span style={{ color: '#ff6666' }}>Mentions:</span>
                        <span>{payload[0]?.value}</span>
                      </div>
                    </div>
                  );
                  return null;
                }} />
                <Area type="monotone" dataKey="count" stroke="#ff0000" strokeWidth={2} fill="url(#tsGrad)" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="ts-peaks">
              <span className="ts-peaks-label">Top moments:</span>
              {timestamps
                .filter(t => t.count >= Math.max(2, maxTimestampCount * 0.5))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5)
                .map(t => (
                  <a key={t.time} href={`https://www.youtube.com/watch?v=${video.id}&t=${t.time}`}
                    target="_blank" rel="noreferrer" className="ts-peak-chip">
                    {t.label} ({t.count} mentions)
                  </a>
                ))}
            </div>
          </>
        )}
        <div className="ts-note">
          <span className="ts-note-icon">ℹ️</span>
          For full retention curves, connect via YouTube Analytics API (OAuth required). This uses viewer-mentioned timestamps as a proxy.
        </div>
      </div>

      {/* Top Comments */}
      {!loadingComments && comments?.length > 0 && (
        <div className="chart-card">
          <h3 className="chart-title">Top Comments</h3>
          <div className="comments-list">
            {comments.slice(0, 8).map(c => {
              const s = c.snippet?.topLevelComment?.snippet || {};
              return (
                <div key={c.id} className="comment-item">
                  <img src={s.authorProfileImageUrl || ''} alt="" className="comment-avatar"
                    onError={e => { e.target.style.display = 'none'; }} />
                  <div className="comment-body">
                    <div className="comment-author">{s.authorDisplayName}</div>
                    <div className="comment-text">{s.textDisplay?.replace(/<[^>]+>/g, '')}</div>
                    <div className="comment-meta">
                      👍 {formatNum(s.likeCount || 0)}
                      {s.publishedAt && <span style={{ marginLeft: 12, color: '#666' }}>{new Date(s.publishedAt).toLocaleDateString()}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );

  // ── Tab 2: Thumbnail & Title ────────────────────────────────────────────────
  const renderTitleTab = () => {
    if (!aiData) return <AiRunPrompt onRun={handleDeepAnalysis} loading={aiLoading} noAI={!canUseAI?.()} onUpgrade={onUpgrade} tabLabel="Thumbnail & Title" />;
    if (aiLoading) return <><SkeletonCard lines={4} /><SkeletonCard lines={5} /><SkeletonCard lines={3} /></>;
    const tt = aiData.titleThumbnail || {};
    const scores4 = [
      { label: 'Curiosity',       value: tt.curiosityScore ?? 0 },
      { label: 'Emotional',       value: tt.emotionalScore ?? 0 },
      { label: 'Clarity',         value: tt.clarityScore ?? 0 },
      { label: 'Scroll-Stopping', value: tt.scrollStoppingScore ?? 0 },
    ];
    return (
      <>
        {/* 4-score bars */}
        <div className="chart-card">
          <h3 className="chart-title">Title Performance Scores</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            {scores4.map(s => {
              const color = s.value >= 75 ? '#00c853' : s.value >= 55 ? '#ff9100' : '#ff1744';
              return (
                <div key={s.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13, color: '#aaa' }}>
                    <span>{s.label}</span>
                    <span style={{ color, fontWeight: 700 }}>{s.value}/100</span>
                  </div>
                  <div style={{ height: 8, background: '#1a1a1a', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${s.value}%`, background: color, borderRadius: 4, transition: 'width 0.8s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Analysis + Triggers */}
        <div className="chart-card">
          <h3 className="chart-title">Title Analysis</h3>
          {tt.analysis && <div className="ai-text-block" style={{ marginBottom: 16 }}>{tt.analysis}</div>}
          {tt.triggers?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7c4dff', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                Psychological Triggers Detected
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tt.triggers.map((t, i) => (
                  <span key={i} style={{ background: '#7c4dff22', border: '1px solid #7c4dff44', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#b39ddb' }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {tt.seoNote && (
            <div style={{ padding: '10px 14px', background: '#0f0f0f', borderRadius: 8, border: '1px solid #1e1e1e', fontSize: 13, color: '#888' }}>
              🔍 <strong style={{ color: '#aaa' }}>SEO:</strong> {tt.seoNote}
            </div>
          )}
        </div>

        {/* Improved Titles */}
        {tt.improvedTitles?.length > 0 && (
          <div className="chart-card">
            <h3 className="chart-title">3 Improved Title Alternatives</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              {tt.improvedTitles.map((t, i) => (
                <div key={i} style={{ background: '#0f0f0f', borderRadius: 8, padding: '12px 14px', border: '1px solid #1e1e1e' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#7c4dff', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t.type}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8', marginBottom: 6, lineHeight: 1.4 }}>"{t.title}"</div>
                  <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5 }}>{t.reason}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Thumbnail tips */}
        {tt.thumbnailTips?.length > 0 && (
          <div className="chart-card">
            <h3 className="chart-title">Thumbnail Recommendations</h3>
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tt.thumbnailTips.map((tip, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13, color: '#aaa', lineHeight: 1.5 }}>
                  <span style={{ color: '#7c4dff', flexShrink: 0, fontWeight: 700 }}>#{i + 1}</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  };

  // ── Tab 3: Hook & Structure ─────────────────────────────────────────────────
  const renderHookTab = () => {
    if (!aiData) return <AiRunPrompt onRun={handleDeepAnalysis} loading={aiLoading} noAI={!canUseAI?.()} onUpgrade={onUpgrade} tabLabel="Hook & Structure" />;
    if (aiLoading) return <><SkeletonCard lines={4} /><SkeletonCard lines={5} /><SkeletonCard lines={3} /></>;
    const hs = aiData.hookStructure || {};
    const PHASE_COLORS = { Hook: '#ff0000', Context: '#ff9100', Problem: '#ff6d00', Escalation: '#ff9100', Climax: '#00c853', Resolution: '#2196f3', CTA: '#7c4dff' };
    return (
      <>
        {/* Hook Strength */}
        <div className="chart-card">
          <div className="chart-title-row">
            <h3 className="chart-title">Hook Analysis</h3>
            {hs.hookType && (
              <span style={{ background: '#ff000022', border: '1px solid #ff000044', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#ff6666', fontWeight: 700 }}>
                {hs.hookType.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          {hs.hookStrength != null && (
            <div style={{ marginBottom: 14, marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13, color: '#aaa' }}>
                <span>Hook Strength</span>
                <span style={{ fontWeight: 700, color: hs.hookStrength >= 70 ? '#00c853' : hs.hookStrength >= 50 ? '#ff9100' : '#ff1744' }}>{hs.hookStrength}/100</span>
              </div>
              <div style={{ height: 10, background: '#1a1a1a', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${hs.hookStrength}%`, background: hs.hookStrength >= 70 ? '#00c853' : hs.hookStrength >= 50 ? '#ff9100' : '#ff1744', borderRadius: 5, transition: 'width 0.8s ease' }} />
              </div>
            </div>
          )}
          {hs.hookAnalysis && <div className="ai-text-block" style={{ marginTop: 0 }}>{hs.hookAnalysis}</div>}
        </div>

        {/* Structure Timeline */}
        {hs.timeline?.length > 0 && (
          <div className="chart-card">
            <h3 className="chart-title">Video Structure Timeline</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
              {hs.timeline.map((phase, i) => {
                const phaseColor = PHASE_COLORS[phase.phase] || '#7c4dff';
                const str = phase.strength ?? 0;
                return (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ flexShrink: 0, width: 90 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: phaseColor }}>{phase.phase}</div>
                      <div style={{ fontSize: 10, color: '#444' }}>{phase.time}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 6, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                        <div style={{ height: '100%', width: `${str}%`, background: phaseColor, borderRadius: 3 }} />
                      </div>
                      <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5 }}>{phase.desc}</div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: phaseColor, flexShrink: 0 }}>{str}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Retention Prediction */}
        {hs.retention?.length > 0 && (
          <div className="chart-card">
            <h3 className="chart-title">Estimated Retention Curve</h3>
            <p className="chart-subtitle">AI prediction based on hook strength, structure, and engagement signals</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 14 }}>
              {hs.retention.map((seg, i) => {
                const color = seg.rate >= 70 ? '#00c853' : seg.rate >= 50 ? '#ff9100' : '#ff1744';
                return (
                  <div key={i} style={{ background: '#0f0f0f', borderRadius: 8, padding: '12px', textAlign: 'center', border: `1px solid ${color}33` }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color, marginBottom: 2 }}>{seg.rate}%</div>
                    <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>{seg.segment}</div>
                    <div style={{ fontSize: 11, color: '#666', lineHeight: 1.4 }}>{seg.note}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pattern Interrupts + Curiosity Loops */}
        {(hs.patternInterrupts || hs.curiosityLoops) && (
          <div className="chart-card">
            {hs.patternInterrupts && (
              <div style={{ marginBottom: hs.curiosityLoops ? 16 : 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#ff9100', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Pattern Interrupts</div>
                <div className="ai-text-block" style={{ marginTop: 0 }}>{hs.patternInterrupts}</div>
              </div>
            )}
            {hs.curiosityLoops && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#7c4dff', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Curiosity Loops</div>
                <div className="ai-text-block" style={{ marginTop: 0 }}>{hs.curiosityLoops}</div>
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  // ── Tab 4: Psychology & Retention ──────────────────────────────────────────
  const renderPsychTab = () => {
    if (!aiData) return <AiRunPrompt onRun={handleDeepAnalysis} loading={aiLoading} noAI={!canUseAI?.()} onUpgrade={onUpgrade} tabLabel="Psychology & Retention" />;
    if (aiLoading) return <><SkeletonCard lines={5} /><SkeletonCard lines={4} /></>;
    const psy = aiData.psychology || {};
    return (
      <>
        {/* 8 Psychological Triggers */}
        {psy.triggers?.length > 0 && (
          <div className="chart-card">
            <h3 className="chart-title">8 Psychological Triggers</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, marginTop: 14 }}>
              {psy.triggers.map((trig, i) => {
                const color = trig.present ? (trig.strength >= 70 ? '#00c853' : trig.strength >= 40 ? '#ff9100' : '#ff6d00') : '#333';
                const textColor = trig.present ? (trig.strength >= 70 ? '#00c853' : trig.strength >= 40 ? '#ff9100' : '#ff6d00') : '#444';
                return (
                  <div key={i} style={{ background: '#0f0f0f', borderRadius: 10, padding: '12px 14px', border: `1px solid ${color}44` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: trig.present ? '#e0e0e0' : '#444' }}>{trig.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: textColor, background: color + '22', padding: '2px 7px', borderRadius: 4 }}>
                        {trig.present ? `${trig.strength}%` : 'Absent'}
                      </span>
                    </div>
                    {trig.present && trig.strength > 0 && (
                      <div style={{ height: 4, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                        <div style={{ height: '100%', width: `${trig.strength}%`, background: color, borderRadius: 2 }} />
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5 }}>{trig.note}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pacing + Engagement Tips */}
        <div className="chart-card">
          {psy.pacing && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#ff9100', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Pacing Analysis</div>
              <div className="ai-text-block" style={{ marginTop: 0 }}>{psy.pacing}</div>
            </div>
          )}
          {psy.engagementTips?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#00c853', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Engagement Strategy</div>
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {psy.engagementTips.map((tip, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#aaa', lineHeight: 1.5 }}>
                    <span style={{ color: '#00c853', flexShrink: 0 }}>✓</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {psy.density != null && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#2196f3', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Information Density</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ flex: 1, height: 10, background: '#1a1a1a', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${psy.density}%`, background: '#2196f3', borderRadius: 5, transition: 'width 0.8s ease' }} />
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#2196f3', flexShrink: 0 }}>{psy.density}/100</span>
              </div>
              {psy.densityNote && <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>{psy.densityNote}</div>}
            </div>
          )}
        </div>
      </>
    );
  };

  // ── Tab 5: Algorithm & Virality ─────────────────────────────────────────────
  const renderAlgoTab = () => {
    if (!aiData) return <AiRunPrompt onRun={handleDeepAnalysis} loading={aiLoading} noAI={!canUseAI?.()} onUpgrade={onUpgrade} tabLabel="Algorithm & Virality" />;
    if (aiLoading) return <><SkeletonCard lines={4} /><SkeletonCard lines={3} /></>;
    const algo = aiData.algorithm || {};
    const viralityFactors = algo.virality ? [
      { name: 'Novelty',           value: algo.virality.novelty ?? 0 },
      { name: 'Controversy',       value: algo.virality.controversy ?? 0 },
      { name: 'Relatability',      value: algo.virality.relatability ?? 0 },
      { name: 'Emotional Intensity',value: algo.virality.emotionalIntensity ?? 0 },
      { name: 'Shareability',      value: algo.virality.shareability ?? 0 },
    ] : [];
    return (
      <>
        {/* Virality Factors */}
        {viralityFactors.length > 0 && (
          <div className="chart-card">
            <h3 className="chart-title">5 Virality Factors</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
              {viralityFactors.map(f => {
                const color = f.value >= 70 ? '#00c853' : f.value >= 45 ? '#ff9100' : '#ff1744';
                return (
                  <div key={f.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13, color: '#aaa' }}>
                      <span>{f.name}</span>
                      <span style={{ fontWeight: 700, color }}>{f.value}/100</span>
                    </div>
                    <div style={{ height: 8, background: '#1a1a1a', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${f.value}%`, background: color, borderRadius: 4, transition: 'width 0.8s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Algorithm Score + CTR Factors */}
        <div className="chart-card">
          <div className="chart-title-row">
            <h3 className="chart-title">Algorithm Performance</h3>
            {algo.algorithmScore != null && (
              <span style={{
                fontSize: 18, fontWeight: 900,
                color: algo.algorithmScore >= 70 ? '#00c853' : algo.algorithmScore >= 50 ? '#ff9100' : '#ff1744',
              }}>
                {algo.algorithmScore}/100
              </span>
            )}
          </div>
          {algo.insight && <div className="ai-text-block" style={{ marginBottom: 16 }}>{algo.insight}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {algo.ctrFactors?.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#ff9100', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>CTR Drivers</div>
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {algo.ctrFactors.map((f, i) => (
                    <li key={i} style={{ fontSize: 12, color: '#aaa', display: 'flex', gap: 6 }}>
                      <span style={{ color: '#ff9100' }}>→</span><span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {algo.retentionFactors?.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#2196f3', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Retention Drivers</div>
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {algo.retentionFactors.map((f, i) => (
                    <li key={i} style={{ fontSize: 12, color: '#aaa', display: 'flex', gap: 6 }}>
                      <span style={{ color: '#2196f3' }}>→</span><span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {algo.monetizationLayers?.length > 0 && (
            <div style={{ marginTop: 16, padding: '12px 14px', background: '#0f0f0f', borderRadius: 8, border: '1px solid #1e1e1e' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#00c853', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Monetization Layers</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {algo.monetizationLayers.map((m, i) => (
                  <span key={i} style={{ background: '#00c85322', border: '1px solid #00c85344', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#69f0ae' }}>{m}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  // ── Tab 6: Blueprint & Score ────────────────────────────────────────────────
  const renderBlueprintTab = () => {
    if (!aiData) return <AiRunPrompt onRun={handleDeepAnalysis} loading={aiLoading} noAI={!canUseAI?.()} onUpgrade={onUpgrade} tabLabel="Blueprint & Score" />;
    if (aiLoading) return <><SkeletonCard lines={4} /><SkeletonCard lines={5} /><SkeletonCard lines={4} /></>;
    const bp = aiData.blueprint || {};
    const bpScoreList = bp.scores ? [
      { label: 'Title &\nThumb',     value: bp.scores.titleThumbnail ?? 0 },
      { label: 'Hook &\nRetention',  value: bp.scores.hookRetention ?? 0 },
      { label: 'Structure',          value: bp.scores.contentStructure ?? 0 },
      { label: 'Engagement',         value: bp.scores.engagement ?? 0 },
      { label: 'Algorithm',          value: bp.scores.algorithm ?? 0 },
      { label: 'SEO',                value: bp.scores.seoDiscoverability ?? 0 },
      { label: 'Emotion',            value: bp.scores.emotionalImpact ?? 0 },
      { label: 'Value',              value: bp.scores.valueDelivery ?? 0 },
    ] : [];

    return (
      <>
        {/* Overall Score + 8 Rings */}
        <div className="chart-card" style={{ borderTop: '3px solid #7c4dff' }}>
          <h3 className="chart-title">Overall Score</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginTop: 16, flexWrap: 'wrap' }}>
            <BigScoreRing score={bp.overallScore ?? 0} grade={bp.grade ?? '?'} />
            <div style={{ flex: 1, minWidth: 200 }}>
              {bp.contentDNA && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#7c4dff', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Content DNA</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0', lineHeight: 1.5, fontStyle: 'italic' }}>{bp.contentDNA}</div>
                </div>
              )}
              {bp.strengths && (
                <div style={{ marginBottom: 8, padding: '10px 12px', background: '#00c85311', borderRadius: 8, border: '1px solid #00c85322' }}>
                  <div style={{ fontSize: 11, color: '#00c853', fontWeight: 700, marginBottom: 4 }}>STRENGTHS</div>
                  <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>{bp.strengths}</div>
                </div>
              )}
              {bp.improvements && (
                <div style={{ padding: '10px 12px', background: '#ff174411', borderRadius: 8, border: '1px solid #ff174422' }}>
                  <div style={{ fontSize: 11, color: '#ff1744', fontWeight: 700, marginBottom: 4 }}>IMPROVE</div>
                  <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>{bp.improvements}</div>
                </div>
              )}
            </div>
          </div>
          {bpScoreList.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 10, marginTop: 20, justifyItems: 'center' }}>
              {bpScoreList.map(s => <ScoreRing key={s.label} score={s.value} label={s.label} size={72} />)}
            </div>
          )}
        </div>

        {/* Replication Blueprint */}
        {bp.replicationBlueprint?.length > 0 && (
          <div className="chart-card">
            <h3 className="chart-title">Replication Blueprint</h3>
            <p className="chart-subtitle">Follow these steps to recreate what made this video succeed</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
              {bp.replicationBlueprint.map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: '#7c4dff22', border: '1px solid #7c4dff44',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 800, color: '#7c4dff',
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ fontSize: 13, color: '#bbb', lineHeight: 1.6, paddingTop: 4 }}>{step}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actionable Lessons */}
        {bp.lessons?.length > 0 && (
          <div className="chart-card">
            <h3 className="chart-title">5 Actionable Lessons</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
              {bp.lessons.map((lesson, i) => (
                <div key={i} style={{ background: '#0f0f0f', borderRadius: 8, padding: '12px 14px', border: '1px solid #1e1e1e' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0', marginBottom: 6 }}>{lesson.title}</div>
                  <div style={{ fontSize: 12, color: '#777', lineHeight: 1.6 }}>{lesson.detail}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Copy + Export */}
        <div className="chart-card" style={{ display: 'flex', gap: 10, justifyContent: 'center', padding: '20px' }}>
          <button
            onClick={handleCopyReport}
            style={{
              background: copiedReport ? '#00c85322' : '#1a1a1a',
              border: `1px solid ${copiedReport ? '#00c853' : '#333'}`,
              borderRadius: 8, padding: '10px 22px',
              fontSize: 13, fontWeight: 700,
              color: copiedReport ? '#00c853' : '#888',
              cursor: 'pointer',
            }}
          >
            {copiedReport ? '✅ Copied!' : '📋 Copy Full Report'}
          </button>
          <button
            onClick={() => window.print()}
            style={{
              background: '#1a1a1a', border: '1px solid #333',
              borderRadius: 8, padding: '10px 22px',
              fontSize: 13, fontWeight: 700, color: '#888', cursor: 'pointer',
            }}
          >
            🖨️ Export PDF
          </button>
        </div>
      </>
    );
  };

  const tabContent = {
    overview:  renderOverviewTab,
    title:     renderTitleTab,
    hook:      renderHookTab,
    psych:     renderPsychTab,
    algo:      renderAlgoTab,
    blueprint: renderBlueprintTab,
  };

  // ── JSX ─────────────────────────────────────────────────────────────────────
  return (
    <div className="analysis-page">
      {/* Breadcrumb + Nav */}
      <div style={{
        padding: '10px 0 6px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0, fontSize: 12 }}>
            ← Back to Videos
          </button>
          <span>/</span>
          <span style={{ color: '#888', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {video.snippet?.title}
          </span>
        </div>

        {/* Prev / Next */}
        {onVideoSelect && allVideos.length > 1 && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => prevVid && onVideoSelect(prevVid)}
              disabled={!prevVid}
              style={{
                background: '#111', border: '1px solid #222', borderRadius: 6,
                padding: '5px 12px', fontSize: 12, color: prevVid ? '#bbb' : '#333',
                cursor: prevVid ? 'pointer' : 'not-allowed',
              }}
            >
              ← Prev
            </button>
            <span style={{ fontSize: 11, color: '#444', alignSelf: 'center' }}>
              {vidIdx + 1}/{allVideos.length}
            </span>
            <button
              onClick={() => nextVid && onVideoSelect(nextVid)}
              disabled={!nextVid}
              style={{
                background: '#111', border: '1px solid #222', borderRadius: 6,
                padding: '5px 12px', fontSize: 12, color: nextVid ? '#bbb' : '#333',
                cursor: nextVid ? 'pointer' : 'not-allowed',
              }}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Video Header */}
      <div className="video-header-card">
        <div className="video-header-inner">
          <div className="video-thumb-wrap">
            {video.snippet?.thumbnails?.high?.url && (
              <img src={video.snippet.thumbnails.high.url} alt="" className="video-header-thumb" />
            )}
            <a href={`https://www.youtube.com/watch?v=${video.id}`}
              target="_blank" rel="noreferrer" className="watch-btn">
              ▶ Watch on YouTube
            </a>
          </div>
          <div className="video-header-info">
            <h2 className="video-analysis-title">{video.snippet?.title}</h2>
            <div className="video-meta-row">
              {publishDate && <span className="video-meta-item">📅 {publishDate}</span>}
              <span className="video-meta-item">⏱ {duration.formatted}</span>
            </div>
            <div className="video-quick-stats">
              <div className="vqs-item"><div className="vqs-val">{formatNum(views)}</div><div className="vqs-label">Views</div></div>
              <div className="vqs-sep" />
              <div className="vqs-item"><div className="vqs-val">{formatNum(likes)}</div><div className="vqs-label">Likes</div></div>
              <div className="vqs-sep" />
              <div className="vqs-item"><div className="vqs-val">{formatNum(commentCount)}</div><div className="vqs-label">Comments</div></div>
              <div className="vqs-sep" />
              <div className="vqs-item">
                <div className="vqs-val" style={{ color: engagementRate > 3 ? '#00c853' : engagementRate > 1.5 ? '#ff9100' : '#ff1744' }}>
                  {engagementRate.toFixed(2)}%
                </div>
                <div className="vqs-label">Engagement</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Run Deep Analysis CTA — prominent, below header ── */}
      {!aiData && !aiLoading && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '20px 0 12px', gap: 10,
        }}>
          <button
            onClick={handleRunDeepClick}
            disabled={aiLoading}
            className="run-analysis-glow-btn"
          >
            {aiLoading && <span className="btn-spinner" />}
            🧠 Run Deep Analysis
          </button>
          <div style={{ fontSize: 12, color: '#444' }}>
            {!isPro
              ? '🔒 Pro & Agency only — click to upgrade'
              : canUseAI?.()
              ? `Unlocks all 5 AI tabs · ${remainingCalls?.() ?? '?'} AI calls remaining`
              : 'No AI calls left — upgrade for more'}
          </div>
        </div>
      )}
      {aiLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ fontSize: 13, color: '#666', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="btn-spinner" />
            Running analysis…
          </div>
        </div>
      )}

      {/* Sticky Tab Bar */}
      <div ref={tabBarRef} className="video-tabs">
        {TABS.map(tab => {
          const locked = tab.minTier && !meetsRequirement(tier, tab.minTier);
          return (
            <button
              key={tab.id}
              className={`video-tab${activeTab === tab.id ? ' active' : ''}${locked ? ' locked' : ''}`}
              onClick={() => {
                if (locked) { setShowUpgradeModal(true); return; }
                setActiveTab(tab.id);
              }}
              title={locked ? 'Pro feature — upgrade to unlock' : undefined}
            >
              {tab.label}
              {locked && <span style={{ marginLeft: 5, fontSize: 10, verticalAlign: 'middle' }}>🔒</span>}
              {!locked && tab.ai && aiData && <span style={{ marginLeft: 5, fontSize: 9, color: '#00c853', verticalAlign: 'middle' }}>●</span>}
            </button>
          );
        })}
      </div>

      {/* AI Progress Bar */}
      {aiLoading && (
        <div style={{ padding: '14px 0 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13, color: '#888' }}>
            <span>
              🧠 TubeIntel is analyzing {
                progress < 20 ? 'title & thumbnail' :
                progress < 40 ? 'hook & structure' :
                progress < 60 ? 'psychology & retention' :
                progress < 80 ? 'algorithm factors' : 'final blueprint'
              }…
            </span>
            <span style={{ color: '#555' }}>{Math.round(progress)}%</span>
          </div>
          <div style={{ height: 4, background: '#111', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, #7c4dff, #00c853)', borderRadius: 2, transition: 'width 0.5s ease' }} />
          </div>
        </div>
      )}

      {/* Sticky mini-CTA bar — shows on AI tabs when analysis not yet run */}
      {!aiData && !aiLoading && TABS.find(t => t.id === activeTab)?.ai && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 50,
          background: '#0d0d0d', borderBottom: '1px solid #1a1a1a',
          padding: '10px 0', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, color: '#666' }}>
            🧠 Run Deep Analysis to unlock AI-powered insights for all 5 dimensions
          </span>
          <button
            onClick={handleRunDeepClick}
            className="run-analysis-glow-btn"
            style={{ padding: '7px 18px', fontSize: 12, flexShrink: 0 }}
          >
            {!isPro ? '🔒 Pro Feature' : '🧠 Run Deep Analysis'}
          </button>
        </div>
      )}

      {aiError && <div className="search-error" style={{ marginTop: 12 }}>{aiError}</div>}

      {/* Tab Content */}
      <div style={{ paddingTop: 8 }}>
        {(() => {
          const tab = TABS.find(t => t.id === activeTab);
          const locked = tab?.minTier && !meetsRequirement(tier, tab.minTier);
          if (locked) {
            return <LockedTabContent tabLabel={tab.label} onUpgrade={() => setShowUpgradeModal(true)} />;
          }
          const content = (tabContent[activeTab] || tabContent.overview)();
          // For overview tab on free tier, append the teaser card
          if (activeTab === 'overview' && !isPro) {
            return (
              <>
                {content}
                <ProTeaserCard score={score} onUpgrade={() => setShowUpgradeModal(true)} />
              </>
            );
          }
          return content;
        })()}
      </div>

      {/* Agency: Bulk Analyze */}
      {isAgency && activeTab === 'overview' && allVideos.length > 1 && (
        <AgencyBulkPanel
          videos={allVideos}
          currentVideoId={video.id}
          bulkQueue={bulkQueue}
          setBulkQueue={setBulkQueue}
          onVideoSelect={onVideoSelect}
        />
      )}

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <UpgradeModal onUpgrade={onUpgrade} onClose={() => setShowUpgradeModal(false)} />
      )}
    </div>
  );
}
