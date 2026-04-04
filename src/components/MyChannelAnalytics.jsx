import { useState, useEffect, useCallback, useRef, Component } from 'react';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ComposedChart, Scatter,
} from 'recharts';
import { meetsRequirement } from '../utils/tierConfig';
import {
  fetchOverviewMetrics, fetchDailyTimeseries, fetchTrafficSources,
  fetchAudienceType, fetchVideoPerformance, fetchSubscriberTimeseries,
  fetchMonetization, fetchPostingHeatmap, fetchRevenueSeries,
  fetchImpressionsAndCTR, clearAnalyticsCache,
} from '../api/analyticsApi';
import { analyzeChannelOverview, analyzeChannelTab } from '../api/claude';

// ── Error Boundary ─────────────────────────────────────────────────────────────
class AnalyticsErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '40px 24px', maxWidth: 600, margin: '0 auto' }}>
          <div style={{ background: '#ff174411', border: '1px solid #ff174433', borderRadius: 12, padding: '24px 28px' }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#ff6666', marginBottom: 8 }}>
              My Channel Analytics encountered an error
            </div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16, fontFamily: 'monospace', background: '#111', borderRadius: 6, padding: '10px 12px' }}>
              {this.state.error.message}
            </div>
            <button
              onClick={() => this.setState({ error: null })}
              style={{ background: '#7c4dff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Constants ──────────────────────────────────────────────────────────────────
const DAYS_OPTIONS = [
  { label: '7 days',   value: 7   },
  { label: '28 days',  value: 28  },
  { label: '90 days',  value: 90  },
  { label: '365 days', value: 365 },
];

const TABS = [
  { id: 'overview',     label: '📊 Overview'          },
  { id: 'traffic',      label: '🔀 Traffic'           },
  { id: 'impressions',  label: '👁 CTR & Impressions' },
  { id: 'audience',     label: '👥 Audience'          },
  { id: 'videos',       label: '🎬 Videos'            },
  { id: 'subscribers',  label: '📈 Subscribers'       },
  { id: 'heatmap',      label: '🕐 Post Timing'       },
  { id: 'monetization', label: '💰 Revenue'           },
  { id: 'growth',       label: '🚀 Growth Intel',     req: 'pro' },
  { id: 'strategy',     label: '🎯 Content Strategy', req: 'pro' },
  { id: 'competitive',  label: '🏆 Competitive',      req: 'pro' },
  { id: 'ai',           label: '🔮 AI Coach',         req: 'pro' },
];

const PIE_COLORS = ['#7c4dff','#ff0000','#ff9100','#00c853','#2196f3','#e91e63','#ffd600','#00bcd4','#ff5722','#9c27b0'];
const DAYS_SHORT  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(n, decimals = 0) {
  if (n == null) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Number(n).toFixed(decimals).toString();
}

function pct(val, total) {
  if (!total) return '0%';
  return ((val / total) * 100).toFixed(1) + '%';
}

function calcHealthScore(ov, impData) {
  let score = 50;
  const ctr = impData?.avgCtr || 0;
  if (ctr >= 8) score += 20; else if (ctr >= 5) score += 14; else if (ctr >= 3) score += 8; else if (ctr >= 1.5) score += 3;
  const views = ov?.views || 0;
  const eng = views > 0 ? ((ov?.likes || 0) + (ov?.comments || 0)) / views * 100 : 0;
  if (eng >= 5) score += 15; else if (eng >= 3) score += 10; else if (eng >= 1) score += 5;
  const wp = ov?.avgViewPct || 0;
  if (wp >= 60) score += 15; else if (wp >= 45) score += 10; else if (wp >= 30) score += 5;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function healthColor(score) {
  if (score >= 75) return '#00c853';
  if (score >= 55) return '#ff9100';
  if (score >= 35) return '#ff6d00';
  return '#ff1744';
}

function engColor(rate) {
  if (rate >= 5) return '#00c853';
  if (rate >= 2) return '#ff9100';
  if (rate >= 0.5) return '#ff6d00';
  return '#ff1744';
}

function sponsorshipValue(views, engRate) {
  const cpm = engRate >= 5 ? 2500 : engRate >= 3 ? 1800 : engRate >= 1 ? 1200 : 800;
  const preRoll   = Math.round(views / 1000 * cpm * 0.15);
  const midRoll   = Math.round(views / 1000 * cpm * 0.25);
  const dedicated = Math.round(views / 1000 * cpm * 0.8);
  const story     = Math.round(views / 1000 * cpm * 0.05);
  return { preRoll, midRoll, dedicated, story };
}

function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0] || 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  points.forEach((y, x) => { sumX += x; sumY += y; sumXY += x * y; sumXX += x * x; });
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// ── Reusable sub-components ────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color, trend }) {
  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 10, padding: '16px 18px' }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: color || '#fff', lineHeight: 1.1, marginBottom: 4 }}>
        {value}
        {trend != null && (
          <span style={{ fontSize: 13, fontWeight: 700, color: trend >= 0 ? '#00c853' : '#ff1744', marginLeft: 8 }}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: '#666', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h3 style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 4 }}>{title}</h3>
      {subtitle && <p style={{ fontSize: 12, color: '#555' }}>{subtitle}</p>}
    </div>
  );
}

function SkeletonCard({ height = 180 }) {
  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 10, padding: 20, height }}>
      <div className="skeleton-line" style={{ width: '40%', height: 14, marginBottom: 12 }} />
      <div className="skeleton-line" style={{ width: '70%', height: 28, marginBottom: 8 }} />
      <div className="skeleton-line" style={{ width: '55%', height: 12 }} />
    </div>
  );
}

function ErrorBanner({ message, onReconnect }) {
  const isExpired = message === 'OAUTH_EXPIRED';
  const isQuota   = message === 'QUOTA_EXCEEDED';
  return (
    <div style={{ background: '#ff174411', border: '1px solid #ff174433', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>{isExpired ? '🔑' : isQuota ? '⏳' : '⚠️'}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#ff6666', marginBottom: 3 }}>
          {isExpired ? 'Session Expired' : isQuota ? 'API Quota Reached' : 'Something went wrong'}
        </div>
        <div style={{ fontSize: 12, color: '#888' }}>
          {isExpired ? 'Your YouTube session has expired. Please reconnect to continue.' :
           isQuota   ? 'YouTube API quota exceeded. Data will refresh after midnight PST.' :
           message}
        </div>
      </div>
      {isExpired && onReconnect && (
        <button onClick={onReconnect} style={{ background: '#7c4dff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer', flexShrink: 0 }}>
          Reconnect
        </button>
      )}
    </div>
  );
}

function NoData({ label = 'Not enough data yet' }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: '#333', fontSize: 13 }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
      {label}
    </div>
  );
}

function LastUpdated({ time, onRefresh }) {
  if (!time) return null;
  const mins = Math.round((Date.now() - time) / 60000);
  const label = mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : `${mins} mins ago`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#444' }}>
      <span>Updated {label}</span>
      {onRefresh && (
        <button onClick={onRefresh} style={{ background: 'none', border: 'none', color: '#7c4dff', fontSize: 11, cursor: 'pointer', padding: 0 }}>
          ↺ Refresh
        </button>
      )}
    </div>
  );
}

function AIInsightCard({ insight, loading, error, onGenerate, label = 'Generate AI Insight' }) {
  if (loading) {
    return (
      <div style={{ border: '1px solid #7c4dff44', borderRadius: 10, padding: '16px 18px', background: '#7c4dff08', color: '#888', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="btn-spinner" style={{ width: 16, height: 16, borderWidth: 2, flexShrink: 0 }} />
        Analyzing your data with AI...
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ border: '1px solid #ff174433', borderRadius: 10, padding: '14px 18px', background: '#ff174408', color: '#ff9999', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>⚠️ {error}</span>
        <button onClick={onGenerate} style={{ background: '#7c4dff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer', marginLeft: 'auto' }}>Retry</button>
      </div>
    );
  }
  if (!insight) {
    return (
      <div style={{ border: '1px solid #7c4dff44', borderRadius: 10, padding: '16px 18px', background: '#7c4dff08', display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 24 }}>🔮</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#b39ddb', marginBottom: 4 }}>AI Analysis Available</div>
          <div style={{ fontSize: 12, color: '#555' }}>Get AI-powered insights specific to your data</div>
        </div>
        <button onClick={onGenerate} style={{ background: '#7c4dff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>{label}</button>
      </div>
    );
  }
  return (
    <div style={{ border: '1px solid #7c4dff44', borderRadius: 10, padding: '18px 20px', background: '#7c4dff08' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 16 }}>🔮</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#b39ddb', textTransform: 'uppercase', letterSpacing: 0.5 }}>TubeIntel AI Analysis</span>
        <button onClick={onGenerate} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #7c4dff33', borderRadius: 5, padding: '3px 10px', fontSize: 11, color: '#7c4dff', cursor: 'pointer' }}>Refresh</button>
      </div>
      {insight.headline && <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 8 }}>{insight.headline}</div>}
      {insight.summary && <p style={{ fontSize: 13, color: '#888', lineHeight: 1.7, marginBottom: insight.insights ? 12 : 0 }}>{insight.summary}</p>}
      {Array.isArray(insight.insights) && (
        <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
          {insight.insights.map((ins, i) => <li key={i} style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>{ins}</li>)}
        </ul>
      )}
      {Array.isArray(insight.actions) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {insight.actions.map((a, i) => (
            <div key={i} style={{ background: '#0f0f0f', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: '#fff' }}>{a.action}</span>
              <span style={{ color: '#555', marginLeft: 8 }}>→ {a.impact || a.reason}</span>
            </div>
          ))}
        </div>
      )}
      {insight.warning && <div style={{ marginTop: 10, background: '#ff174411', border: '1px solid #ff174433', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#ff9999' }}>⚠️ {insight.warning}</div>}
      {insight.opportunity && <div style={{ marginTop: 8, background: '#00c85311', border: '1px solid #00c85333', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#69f0ae' }}>✨ {insight.opportunity}</div>}
      {insight.topInsight && <div style={{ marginTop: 8, background: '#7c4dff11', border: '1px solid #7c4dff33', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#b39ddb', fontWeight: 700 }}>💡 {insight.topInsight}</div>}
    </div>
  );
}

// ── Setup Guide ────────────────────────────────────────────────────────────────
function SetupGuide() {
  const [open, setOpen] = useState(false);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const hasClientId = clientId && clientId !== 'YOUR_GOOGLE_CLIENT_ID';

  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 12, overflow: 'hidden', marginTop: 24 }}>
      <div
        style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>⚙️</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#ddd' }}>Google Cloud Setup Guide</div>
            <div style={{ fontSize: 11, color: hasClientId ? '#00c853' : '#ff9100' }}>
              {hasClientId ? '✓ VITE_GOOGLE_CLIENT_ID is configured' : '⚠ VITE_GOOGLE_CLIENT_ID not set — click to see instructions'}
            </div>
          </div>
        </div>
        <span style={{ color: '#555', fontSize: 14 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ padding: '0 18px 18px', borderTop: '1px solid #1a1a1a' }}>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { step: 1, title: 'Create a Google Cloud Project', body: 'Go to console.cloud.google.com → New Project → give it any name.' },
              { step: 2, title: 'Enable the Required APIs', body: 'APIs & Services → Library. Enable:\n• YouTube Data API v3\n• YouTube Analytics API' },
              { step: 3, title: 'Configure OAuth Consent Screen', body: 'APIs & Services → OAuth consent screen → External → Add your email.\nAdd scopes:\n• .../auth/youtube.readonly\n• .../auth/yt-analytics.readonly\n• .../auth/yt-analytics-monetary.readonly' },
              { step: 4, title: 'Create OAuth 2.0 Credentials', body: `APIs & Services → Credentials → Create Credentials → OAuth Client ID → Web application.\n\nAuthorized JavaScript Origins:\n  ${window.location.origin}\n\nAuthorized redirect URIs:\n  ${window.location.origin + window.location.pathname}` },
              { step: 5, title: 'Add Client ID to .env file', body: 'Copy your Client ID and add to your .env file:\n\nVITE_GOOGLE_CLIENT_ID=your_client_id_here\n\nThen restart the dev server.' },
            ].map(s => (
              <div key={s.step} style={{ display: 'flex', gap: 14 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#7c4dff22', border: '1px solid #7c4dff44', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#7c4dff', flexShrink: 0 }}>
                  {s.step}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#ddd', marginBottom: 4 }}>{s.title}</div>
                  <pre style={{ fontSize: 12, color: '#888', whiteSpace: 'pre-wrap', lineHeight: 1.7, fontFamily: 'monospace', background: '#111', borderRadius: 6, padding: '8px 10px', margin: 0 }}>{s.body}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Connect Gate ───────────────────────────────────────────────────────────────
function ConnectGate({ onConnect, isPro, onDemo }) {
  if (!isPro) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>📊</div>
        <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>My Channel Analytics</h2>
        <p style={{ fontSize: 14, color: '#555', maxWidth: 400, lineHeight: 1.7, marginBottom: 24 }}>
          Connect your YouTube channel for real private analytics — impressions, CTR, retention curves, revenue, traffic sources and more. Pro feature.
        </p>
        <div style={{ background: '#7c4dff22', border: '1px solid #7c4dff44', borderRadius: 8, padding: '6px 16px', fontSize: 12, fontWeight: 700, color: '#b39ddb', marginBottom: 20 }}>
          🔒 Pro &amp; Agency only
        </div>
        <button
          onClick={onDemo}
          style={{ background: '#ff990022', border: '1px solid #ff990055', borderRadius: 8, padding: '10px 22px', fontSize: 13, fontWeight: 700, color: '#ff9900', cursor: 'pointer' }}
        >
          🎬 Try Demo — See Full Dashboard with Sample Data
        </button>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', paddingTop: 40 }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🔗</div>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 8 }}>Connect Your YouTube Channel</h2>
        <p style={{ fontSize: 14, color: '#666', lineHeight: 1.7, marginBottom: 24 }}>
          Securely connect via Google OAuth to unlock your real private analytics — the data YouTube Studio shows only to you.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28, textAlign: 'left', maxWidth: 380, margin: '0 auto 28px' }}>
          {['📈 Real impressions, CTR, and watch time','🎯 Traffic source breakdown (Browse, Search, Suggested…)','👥 New vs returning viewer ratio','📉 Subscriber gained/lost per video','💰 Revenue & RPM (if monetized)','🕐 Best posting time heatmap from your own data','🎬 Per-video performance comparison table'].map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#888' }}>
              <span style={{ color: '#00c853', flexShrink: 0 }}>✓</span><span>{item}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onConnect}
          style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 auto', background: '#fff', border: 'none', borderRadius: 8, padding: '13px 24px', fontSize: 14, fontWeight: 700, color: '#111', cursor: 'pointer' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Connect with Google
        </button>
        <p style={{ fontSize: 11, color: '#333', marginTop: 12 }}>
          Only read access requested. We never post, upload, or modify anything.
        </p>
        <button
          onClick={onDemo}
          style={{ marginTop: 16, background: 'none', border: '1px solid #ff990044', borderRadius: 8, padding: '9px 20px', fontSize: 12, fontWeight: 600, color: '#ff9900', cursor: 'pointer' }}
        >
          🎬 Or try the full demo with sample data first
        </button>
      </div>
      <SetupGuide />
    </div>
  );
}

// ── PostingHeatmap ─────────────────────────────────────────────────────────────
function PostingHeatmap({ grid }) {
  if (!grid) return <NoData label="Not enough video history to generate heatmap" />;
  const hours  = Array.from({ length: 24 }, (_, i) => i);
  const allAvg = Object.values(grid).map(v => v.count > 0 ? v.totalViews / v.count : 0);
  const maxAvg = Math.max(...allAvg, 1);
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 700 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(24, 1fr)', gap: 2, marginBottom: 4 }}>
          <div />
          {hours.map(h => (
            <div key={h} style={{ fontSize: 9, color: '#444', textAlign: 'center' }}>
              {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h-12}p`}
            </div>
          ))}
        </div>
        {DAYS_SHORT.map((day, di) => (
          <div key={di} style={{ display: 'grid', gridTemplateColumns: '40px repeat(24, 1fr)', gap: 2, marginBottom: 2 }}>
            <div style={{ fontSize: 10, color: '#444', display: 'flex', alignItems: 'center' }}>{day}</div>
            {hours.map(h => {
              const key = `${di}_${h}`;
              const cell = grid[key] || { count: 0, totalViews: 0 };
              const avg = cell.count > 0 ? cell.totalViews / cell.count : 0;
              const intensity = avg / maxAvg;
              const bg = intensity > 0.8 ? '#7c4dff' : intensity > 0.6 ? '#5e35b1' : intensity > 0.4 ? '#4527a0' : intensity > 0.2 ? '#311b92' : intensity > 0 ? '#1a0057' : '#111';
              return (
                <div
                  key={h}
                  title={cell.count > 0 ? `${day} ${h}:00 — ${cell.count} videos, avg ${fmt(avg)} views` : 'No posts'}
                  style={{ height: 22, borderRadius: 3, background: bg, cursor: cell.count > 0 ? 'pointer' : 'default' }}
                />
              );
            })}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 10, color: '#444' }}>
          <span>Low</span>
          {['#1a0057','#311b92','#4527a0','#5e35b1','#7c4dff'].map((c, i) => (
            <div key={i} style={{ width: 18, height: 12, background: c, borderRadius: 2 }} />
          ))}
          <span>High avg views</span>
        </div>
      </div>
    </div>
  );
}

// ── Demo Data ─────────────────────────────────────────────────────────────────
function buildDemoData() {
  const today = new Date();
  const day = (offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };

  // 90-day timeseries with realistic growth curve
  const timeseries = Array.from({ length: 90 }, (_, i) => {
    const base = 600 + i * 14 + Math.sin(i / 7) * 120;
    const spike = [12, 28, 45, 67, 81].includes(i) ? 1800 : 0;
    const views = Math.round(base + spike + Math.random() * 80);
    return { date: day(89 - i), views, watchMinutes: Math.round(views * 4.2) };
  });

  // 18 videos
  const videoTitles = [
    'I Built a Full Stack App in 24 Hours', 'Why 90% of React Developers Fail at Performance',
    '10 VS Code Shortcuts That Changed My Life', 'The Truth About Freelancing as a Developer',
    'Next.js 14 Full Tutorial for Beginners', 'How I Went from 0 to 50K Subscribers',
    'Stop Using useState for Everything', 'Building a SaaS in 7 Days - Day by Day',
    'TypeScript Mistakes Every Dev Makes', 'My $12K/Month Freelancing Stack Revealed',
    'Docker in 100 Seconds... Actually Explained', 'Why I Quit My Big Tech Job',
    'The Best Dev Tools of 2024', 'CSS Grid vs Flexbox - Final Answer',
    'How to Get Your First Dev Client', 'GraphQL vs REST - Which to Learn',
    'Tailwind CSS is Changing Everything', 'I Failed 50 Technical Interviews - Here\'s Why',
  ];
  const videoPerf = videoTitles.map((title, i) => {
    const dayOld = (i + 1) * 10;
    const baseViews = Math.round(80000 - i * 3200 + Math.sin(i) * 8000 + Math.random() * 5000);
    const views = Math.max(4000, baseViews);
    const avgViewPct = Math.round(38 + Math.random() * 24);
    const avgViewDuration = Math.round((avgViewPct / 100) * (240 + i * 15));
    const subsGained = Math.round(views * 0.008 + Math.random() * 40);
    const subsLost = Math.round(subsGained * 0.15);
    const likes = Math.round(views * 0.042);
    const comments = Math.round(views * 0.009);
    const watchMinutes = Math.round(views * avgViewDuration / 60);
    return {
      id: `vid${i}`,
      title,
      thumbnail: '',
      publishedAt: day(dayOld),
      views, watchMinutes, avgViewDuration, avgViewPct,
      subsGained, subsLost, likes, comments,
    };
  });

  // Subscriber timeseries
  let running = 0;
  const subSeries = Array.from({ length: 90 }, (_, i) => {
    const gained = Math.round(12 + i * 0.4 + Math.random() * 8 + ([20,45,70].includes(i) ? 60 : 0));
    const lost   = Math.round(gained * 0.12);
    running += gained - lost;
    return { date: day(89 - i), gained, lost, net: gained - lost, cumulative: running };
  });

  // Traffic sources
  const traffic = [
    { source: 'BROWSE_FEATURES',  label: 'Browse Features',  views: 52000, pct: 34.2, watchMins: 218400 },
    { source: 'YT_SEARCH',        label: 'YouTube Search',   views: 38000, pct: 25.0, watchMins: 174800 },
    { source: 'SUGGESTED_VIDEOS', label: 'Suggested Videos', views: 29000, pct: 19.1, watchMins: 112100 },
    { source: 'EXTERNAL',         label: 'External Sources', views: 16000, pct: 10.5, watchMins: 51200 },
    { source: 'NO_LINK_OTHER',    label: 'Direct / Unknown', views:  9000, pct:  5.9, watchMins: 27900 },
    { source: 'NOTIFICATION',     label: 'Notifications',    views:  4000, pct:  2.6, watchMins: 15600 },
    { source: 'PLAYLIST',         label: 'Playlists',        views:  3000, pct:  2.0, watchMins: 11400 },
    { source: 'END_SCREEN',       label: 'End Screens',      views:   800, pct:  0.5, watchMins:  2700 },
  ];

  // Impressions data
  const impRows = Array.from({ length: 28 }, (_, i) => {
    const impressions = Math.round(14000 + i * 300 + Math.random() * 2000);
    const ctr = +(3.8 + Math.sin(i / 5) * 0.6 + Math.random() * 0.4).toFixed(2);
    return { date: day(27 - i), impressions, ctr };
  });
  const totImpressions = impRows.reduce((s, r) => s + r.impressions, 0);
  const avgCtr = +(impRows.reduce((s, r) => s + r.ctr, 0) / impRows.length).toFixed(2);

  // Audience
  const audience = {
    ageBreakdown: [
      { age: '18–24', pct: 28.4 }, { age: '25–34', pct: 35.1 }, { age: '35–44', pct: 18.7 },
      { age: '45–54', pct: 10.2 }, { age: '13–17', pct: 4.8  }, { age: '55–64', pct: 2.8  },
    ],
    malePct: 74.2,
    femalePct: 25.8,
  };

  // Heatmap — peak Thu 20:00
  const heatmap = { grid: {}, peak: '4_20' };
  for (let dow = 0; dow < 7; dow++) {
    for (let hr = 0; hr < 24; hr++) {
      const isEvening = hr >= 18 && hr <= 22;
      const isWeekend = dow === 0 || dow === 6;
      const isThurs   = dow === 4;
      const count = isEvening ? (isThurs ? 3 : isWeekend ? 2 : 1) : (hr >= 12 && hr < 18 ? 1 : 0);
      if (count > 0) {
        const totalViews = count * (12000 + (isThurs && isEvening ? 9000 : 0) + Math.round(Math.random() * 3000));
        heatmap.grid[`${dow}_${hr}`] = { count, totalViews };
      }
    }
  }

  const overview = {
    views: 152000, watchTimeHours: 10640, avgViewDuration: 251, avgViewPct: 46.8,
    subsGained: 1840, subsLost: 210, netSubs: 1630,
    likes: 6384, comments: 1368, shares: 892, estimatedRevenue: 0,
  };

  return {
    overview,
    timeseries: timeseries.slice(-28),
    timeseries90: timeseries,
    traffic,
    impressionsData: { rows: impRows, totImpressions, avgCtr },
    audience,
    videoPerf,
    subSeries,
    heatmap,
    monetization: { isMonetized: false },
    revSeries: [],
  };
}

const DEMO_PROFILE = {
  channelId: 'demo',
  title: 'TechCreator Demo',
  thumbnail: '',
  subscribers: 50000,
  videoCount: 18,
  viewCount: 2000000,
};

// ── Main Component ─────────────────────────────────────────────────────────────
export default function MyChannelAnalytics({
  tier, isConnected, profile, onConnect, onDisconnect,
  canUseAI, consumeAICall, remainingCalls, onUpgrade,
}) {
  const [activeTab,     setActiveTab]     = useState('overview');
  const [days,          setDays]          = useState(28);
  const [data,          setData]          = useState({});
  const [loading,       setLoading]       = useState({});
  const [errors,        setErrors]        = useState({});
  const [vpSort,        setVpSort]        = useState('views');
  const [vpFilter,      setVpFilter]      = useState('all');
  const [aiInsights,    setAiInsights]    = useState({});
  const [aiLoading,     setAiLoading]     = useState({});
  const [lastUpdated,   setLastUpdated]   = useState({});
  const [askQuery,      setAskQuery]      = useState('');
  const [askAnswer,     setAskAnswer]     = useState('');
  const [askLoading,    setAskLoading]    = useState(false);
  const [compareVideos, setCompareVideos] = useState([]);
  const [demoMode,      setDemoMode]      = useState(() => {
    // Auto-activate if sidebar "Demo" badge was clicked
    try {
      if (sessionStorage.getItem('tubeintel_launch_demo') === '1') {
        sessionStorage.removeItem('tubeintel_launch_demo');
        return true;
      }
    } catch {}
    return false;
  });

  const token     = (() => { try { return localStorage.getItem('tubeintel_oauth_token'); } catch { return null; } })();
  const channelId = profile?.channelId;
  const isPro     = meetsRequirement(tier, 'pro');

  // In demo mode, override profile and inject prebuilt data
  const activeProfile = demoMode ? DEMO_PROFILE : profile;
  const demoData = demoMode ? buildDemoData() : null;

  // ── Data loading ─────────────────────────────────────────────────────────────
  const loadWithToken = useCallback(async (key, fetcher) => {
    if (!channelId || !token) return;
    setLoading(l => ({ ...l, [key]: true }));
    setErrors(e => ({ ...e, [key]: null }));
    try {
      const result = await fetcher(token, channelId);
      setData(d => ({ ...d, [key]: result }));
      setLastUpdated(u => ({ ...u, [key]: Date.now() }));
    } catch (err) {
      setErrors(e => ({ ...e, [key]: err.message }));
    } finally {
      setLoading(l => ({ ...l, [key]: false }));
    }
  }, [channelId, token]);

  useEffect(() => {
    if (!channelId || !token) return;
    switch (activeTab) {
      case 'overview':
        loadWithToken('overview',        (t, c) => fetchOverviewMetrics(t, c, days));
        loadWithToken('timeseries',      (t, c) => fetchDailyTimeseries(t, c, days));
        loadWithToken('impressionsData', (t, c) => fetchImpressionsAndCTR(t, c, days));
        break;
      case 'traffic':
        loadWithToken('traffic',    (t, c) => fetchTrafficSources(t, c, days));
        loadWithToken('timeseries', (t, c) => fetchDailyTimeseries(t, c, days));
        break;
      case 'impressions':
        loadWithToken('impressionsData', (t, c) => fetchImpressionsAndCTR(t, c, days));
        loadWithToken('videoPerf',       (t, c) => fetchVideoPerformance(t, c, days));
        break;
      case 'audience':
        loadWithToken('audience', (t, c) => fetchAudienceType(t, c, days));
        loadWithToken('heatmap',  (t, c) => fetchPostingHeatmap(t, c));
        break;
      case 'videos':
        loadWithToken('videoPerf', (t, c) => fetchVideoPerformance(t, c, days));
        break;
      case 'subscribers':
        loadWithToken('subSeries', (t, c) => fetchSubscriberTimeseries(t, c, 90));
        loadWithToken('videoPerf', (t, c) => fetchVideoPerformance(t, c, days));
        break;
      case 'heatmap':
        loadWithToken('heatmap', (t, c) => fetchPostingHeatmap(t, c));
        break;
      case 'monetization':
        loadWithToken('monetization', (t, c) => fetchMonetization(t, c, days));
        loadWithToken('revSeries',    (t, c) => fetchRevenueSeries(t, c, days));
        loadWithToken('videoPerf',    (t, c) => fetchVideoPerformance(t, c, days));
        break;
      case 'growth':
        loadWithToken('timeseries', (t, c) => fetchDailyTimeseries(t, c, 90));
        loadWithToken('subSeries',  (t, c) => fetchSubscriberTimeseries(t, c, 90));
        loadWithToken('overview',   (t, c) => fetchOverviewMetrics(t, c, days));
        break;
      case 'strategy':
        loadWithToken('videoPerf', (t, c) => fetchVideoPerformance(t, c, 90));
        loadWithToken('traffic',   (t, c) => fetchTrafficSources(t, c, days));
        break;
      case 'competitive':
        loadWithToken('overview',        (t, c) => fetchOverviewMetrics(t, c, days));
        loadWithToken('impressionsData', (t, c) => fetchImpressionsAndCTR(t, c, days));
        break;
      case 'ai':
        loadWithToken('overview',  (t, c) => fetchOverviewMetrics(t, c, days));
        loadWithToken('videoPerf', (t, c) => fetchVideoPerformance(t, c, days));
        loadWithToken('subSeries', (t, c) => fetchSubscriberTimeseries(t, c, 90));
        break;
      default:
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, days, channelId, token]);

  // ── AI generation ─────────────────────────────────────────────────────────────
  const generateTabInsight = useCallback(async (tabKey, dataPayload) => {
    if (!canUseAI?.()) { onUpgrade?.(); return; }
    setAiLoading(l => ({ ...l, [tabKey]: true }));
    setErrors(er => ({ ...er, [`ai_${tabKey}`]: null }));
    try {
      let insight;
      if (tabKey === 'overview') {
        insight = await analyzeChannelOverview(dataPayload);
      } else {
        insight = await analyzeChannelTab(tabKey, dataPayload);
      }
      consumeAICall?.();
      setAiInsights(a => ({ ...a, [tabKey]: insight }));
    } catch (e) {
      setErrors(er => ({ ...er, [`ai_${tabKey}`]: e.message }));
    } finally {
      setAiLoading(l => ({ ...l, [tabKey]: false }));
    }
  }, [canUseAI, consumeAICall, onUpgrade]);

  const refreshData = useCallback(() => {
    clearAnalyticsCache?.();
    setData({});
    setAiInsights({});
    // re-trigger load
    setDays(d => d);
  }, []);

  // ── Early gates (demo mode bypasses both) ────────────────────────────────────
  if (!demoMode && !isPro) return <ConnectGate onConnect={onConnect} isPro={false} onDemo={() => setDemoMode(true)} />;
  if (!demoMode && !isConnected) return <ConnectGate onConnect={onConnect} isPro={true} onDemo={() => setDemoMode(true)} />;

  // ── Merge demo data over real data when in demo mode ─────────────────────────
  const D = demoMode ? demoData : data;  // all tab renders read from D instead of data

  // ── WoW trend helper ──────────────────────────────────────────────────────────
  function wowTrend(key, ts) {
    const series = Array.isArray(ts) ? ts : [];
    if (series.length < 14) return null;
    const half = Math.floor(series.length / 2);
    const first = series.slice(0, half).reduce((s, r) => s + (r[key] || 0), 0);
    const second = series.slice(half).reduce((s, r) => s + (r[key] || 0), 0);
    if (!first) return null;
    return ((second - first) / first) * 100;
  }

  // ── Overview ──────────────────────────────────────────────────────────────────
  function renderOverview() {
    const ov  = D.overview;
    const ts  = D.timeseries;
    const imp = D.impressionsData;
    const isLoadingOv = loading.overview;

    const score = calcHealthScore(ov, imp);
    const scoreColor = healthColor(score);
    const circumference = 2 * Math.PI * 44;
    const offset = circumference - (score / 100) * circumference;

    const totalSubs  = activeProfile?.subscribers || 0;
    const milestones = [1000,5000,10000,25000,50000,100000,250000,500000,1000000,5000000,10000000];
    const nextMs = milestones.find(m => m > totalSubs) || totalSubs * 2;
    const subRate = ov?.netSubs && days > 0 ? ov.netSubs / days : 0;
    const daysToMs = subRate > 0 ? Math.round((nextMs - totalSubs) / subRate) : null;

    const views = ov?.views || 0;
    const engRate = views > 0 ? ((ov?.likes || 0) + (ov?.comments || 0)) / views * 100 : 0;
    const spv = sponsorshipValue(views, engRate);

    const tsTrend = Array.isArray(ts) ? ts : [];
    const half = Math.floor(tsTrend.length / 2);
    const firstHalfViews  = tsTrend.slice(0, half).reduce((s, r) => s + (r.views || 0), 0);
    const secondHalfViews = tsTrend.slice(half).reduce((s, r) => s + (r.views || 0), 0);
    const momentum = firstHalfViews && secondHalfViews > firstHalfViews * 1.1 ? 'Accelerating' : secondHalfViews < firstHalfViews * 0.9 ? 'Declining' : 'Steady';
    const momentumColor = momentum === 'Accelerating' ? '#00c853' : momentum === 'Declining' ? '#ff1744' : '#ff9100';

    const overviewPayload = {
      days, views: ov?.views, watchTimeHours: ov?.watchTimeHours,
      netSubs: ov?.netSubs, avgViewDuration: ov?.avgViewDuration,
      avgViewPct: ov?.avgViewPct, likes: ov?.likes, comments: ov?.comments,
      shares: ov?.shares, totImpressions: imp?.totalImpressions, avgCtr: imp?.avgCtr,
      topSources: 'Browse, Suggested, Search', uploadsPerWeek: (ov?.uploads || 0) / (days / 7),
      channelAgeDays: 365, totalSubs,
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {errors.overview && <ErrorBanner message={errors.overview} onReconnect={onConnect} />}

        {/* Health + Momentum Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 14 }}>
          {/* Health Gauge */}
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: 100, height: 100 }}>
              <svg width="100" height="100" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="50" cy="50" r="44" fill="none" stroke="#1a1a1a" strokeWidth="8" />
                <circle
                  cx="50" cy="50" r="44" fill="none"
                  stroke={isLoadingOv ? '#333' : scoreColor}
                  strokeWidth="8"
                  strokeDasharray={circumference}
                  strokeDashoffset={isLoadingOv ? circumference : offset}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 1s ease' }}
                />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: isLoadingOv ? '#333' : scoreColor }}>{isLoadingOv ? '—' : score}</div>
                <div style={{ fontSize: 9, color: '#444', textTransform: 'uppercase' }}>Health</div>
              </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: scoreColor, marginTop: 6 }}>
              {isLoadingOv ? 'Loading...' : score >= 75 ? 'Strong Channel' : score >= 55 ? 'Growing Steadily' : score >= 35 ? 'Needs Work' : 'At Risk'}
            </div>
          </div>

          {/* Momentum + Summary */}
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ background: momentumColor + '22', border: `1px solid ${momentumColor}44`, borderRadius: 20, padding: '3px 12px', fontSize: 12, fontWeight: 700, color: momentumColor }}>
                {momentum === 'Accelerating' ? '🚀' : momentum === 'Declining' ? '📉' : '➡️'} {momentum}
              </div>
              <LastUpdated time={lastUpdated.overview} onRefresh={() => loadWithToken('overview', (t, c) => fetchOverviewMetrics(t, c, days))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                { label: 'Engagement Rate', value: `${engRate.toFixed(2)}%`, color: engColor(engRate) },
                { label: 'Avg View %', value: `${ov?.avgViewPct || 0}%`, color: (ov?.avgViewPct || 0) >= 45 ? '#00c853' : '#ff9100' },
                { label: 'CTR', value: `${(imp?.avgCtr || 0).toFixed(1)}%`, color: (imp?.avgCtr || 0) >= 4 ? '#00c853' : '#ff9100' },
              ].map((m, i) => (
                <div key={i} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: m.color }}>{isLoadingOv ? '—' : m.value}</div>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase' }}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {isLoadingOv ? [1,2,3,4,5,6].map(i => <SkeletonCard key={i} height={100} />) : (
            <>
              <StatCard icon="👁" label="Views" value={fmt(ov?.views)} trend={wowTrend('views', ts)} color="#fff" />
              <StatCard icon="⏱" label="Watch Time (hrs)" value={fmt(ov?.watchTimeHours)} color="#7c4dff" />
              <StatCard icon="👤" label="Net Subscribers" value={`${ov?.netSubs >= 0 ? '+' : ''}${fmt(ov?.netSubs)}`} trend={wowTrend('netSubs', ts)} color={ov?.netSubs >= 0 ? '#00c853' : '#ff1744'} />
              <StatCard icon="❤️" label="Likes" value={fmt(ov?.likes)} trend={wowTrend('likes', ts)} />
              <StatCard icon="💬" label="Comments" value={fmt(ov?.comments)} />
              <StatCard icon="🔗" label="Shares" value={fmt(ov?.shares)} />
            </>
          )}
        </div>

        {/* Impressions row */}
        {!loading.impressionsData && imp && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <StatCard icon="📡" label="Impressions" value={fmt(imp.totalImpressions)} color="#2196f3" />
            <StatCard icon="🎯" label="Avg CTR" value={`${(imp.avgCtr || 0).toFixed(2)}%`} color={(imp.avgCtr || 0) >= 4 ? '#00c853' : '#ff9100'} sub="YouTube avg: 4–5%" />
            <StatCard icon="👁‍🗨" label="CTR vs Benchmark" value={(imp.avgCtr || 0) >= 4 ? 'Above Avg' : 'Below Avg'} color={(imp.avgCtr || 0) >= 4 ? '#00c853' : '#ff9100'} />
          </div>
        )}

        {/* Views chart */}
        {loading.timeseries ? <SkeletonCard height={200} /> : Array.isArray(ts) && ts.length > 0 && (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Views Over Time" />
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={ts}>
                <defs>
                  <linearGradient id="gViews" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c4dff" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#7c4dff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1a1a1a" vertical={false} />
                <XAxis dataKey="date" tickFormatter={d => typeof d === 'string' ? d.slice(5) : ''} tick={{ fontSize: 10, fill: '#444' }} />
                <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 10, fill: '#444' }} />
                <Tooltip contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8, fontSize: 12 }} formatter={v => [fmt(v), 'Views']} />
                <Area type="monotone" dataKey="views" stroke="#7c4dff" fill="url(#gViews)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Milestone tracker */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
          <SectionHeader title="Subscriber Milestone Tracker" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>
                Next milestone: <strong style={{ color: '#fff' }}>{fmt(nextMs)} subscribers</strong>
              </div>
              <div style={{ background: '#1a1a1a', borderRadius: 8, height: 8, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (totalSubs / nextMs) * 100).toFixed(1)}%`, height: '100%', background: 'linear-gradient(90deg, #7c4dff, #b39ddb)', borderRadius: 8, transition: 'width 1s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: '#555' }}>
                <span>{fmt(totalSubs)} current</span>
                <span>{fmt(nextMs)} goal</span>
              </div>
            </div>
            <div style={{ textAlign: 'center', minWidth: 80 }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#7c4dff' }}>{daysToMs != null ? daysToMs : '—'}</div>
              <div style={{ fontSize: 10, color: '#555' }}>days away</div>
            </div>
          </div>
        </div>

        {/* Revenue potential */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
          <SectionHeader title="Estimated Sponsorship Value" subtitle="Based on your views and engagement rate" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              { label: 'Pre-roll', value: spv.preRoll, icon: '▶️' },
              { label: 'Mid-roll', value: spv.midRoll, icon: '⏸️' },
              { label: 'Dedicated', value: spv.dedicated, icon: '🎬' },
              { label: 'Story', value: spv.story, icon: '✨' },
            ].map((s, i) => (
              <div key={i} style={{ background: '#111', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#00c853' }}>₹{fmt(s.value)}</div>
                <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* AI Insight */}
        <AIInsightCard
          insight={aiInsights.overview}
          loading={aiLoading.overview}
          error={errors.ai_overview}
          onGenerate={() => generateTabInsight('overview', overviewPayload)}
          label="Analyze My Channel with AI"
        />
      </div>
    );
  }

  // ── Traffic ───────────────────────────────────────────────────────────────────
  function renderTraffic() {
    const sources = D.traffic;
    const ts = D.timeseries;
    const isLoading = loading.traffic;
    const sourceList = Array.isArray(sources) ? sources : [];
    const total = sourceList.reduce((s, r) => s + (r.views || 0), 0);
    const qualityBadge = (src) => {
      const name = (src.sourceName || src.source || '').toLowerCase();
      if (name.includes('suggested') || name.includes('browse')) return { label: 'High Quality', color: '#00c853' };
      if (name.includes('search')) return { label: 'High Intent', color: '#2196f3' };
      if (name.includes('external')) return { label: 'External', color: '#ff9100' };
      return { label: 'Standard', color: '#888' };
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {errors.traffic && <ErrorBanner message={errors.traffic} onReconnect={onConnect} />}
        <SectionHeader title="Traffic Sources" subtitle={`Where your ${fmt(total)} views came from in the last ${days} days`} />

        {isLoading ? <SkeletonCard height={240} /> : sourceList.length === 0 ? <NoData label="No traffic source data available" /> : (
          <>
            {/* Bar chart */}
            <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={sourceList.slice(0, 8)} layout="vertical">
                  <CartesianGrid stroke="#1a1a1a" horizontal={false} />
                  <XAxis type="number" tickFormatter={v => fmt(v)} tick={{ fontSize: 10, fill: '#444' }} />
                  <YAxis type="category" dataKey="sourceName" width={120} tick={{ fontSize: 10, fill: '#888' }} />
                  <Tooltip contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8, fontSize: 12 }} formatter={v => [fmt(v), 'Views']} />
                  <Bar dataKey="views" fill="#7c4dff" radius={[0, 4, 4, 0]}>
                    {sourceList.slice(0, 8).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Source quality table */}
            <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
              <SectionHeader title="Source Quality Breakdown" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sourceList.slice(0, 10).map((src, i) => {
                  const badge = qualityBadge(src);
                  const share = total > 0 ? (src.views / total) * 100 : 0;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #111' }}>
                      <div style={{ flex: 1, fontSize: 13, color: '#ccc' }}>{src.sourceName || src.source}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>{fmt(src.views)} views</div>
                      <div style={{ fontSize: 12, color: '#888', minWidth: 40, textAlign: 'right' }}>{share.toFixed(1)}%</div>
                      <div style={{ background: badge.color + '22', border: `1px solid ${badge.color}44`, borderRadius: 10, padding: '2px 8px', fontSize: 10, fontWeight: 700, color: badge.color, whiteSpace: 'nowrap' }}>{badge.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <AIInsightCard
          insight={aiInsights.traffic}
          loading={aiLoading.traffic}
          error={errors.ai_traffic}
          onGenerate={() => generateTabInsight('traffic', { sources: sourceList, days, total })}
        />
      </div>
    );
  }

  // ── Impressions & CTR ─────────────────────────────────────────────────────────
  function renderImpressions() {
    const imp  = D.impressionsData;
    const vp   = Array.isArray(D.videoPerf) ? D.videoPerf : [];
    const isLoading = loading.impressionsData;

    const totalImp  = imp?.totalImpressions || 0;
    const ctr       = imp?.avgCtr || 0;
    const clicks    = Math.round(totalImp * ctr / 100);
    const views     = imp?.views || clicks;
    const engages   = Math.round(views * 0.04);
    const channelAvgCtr = ctr;

    const hiddenGems   = vp.filter(v => (v.ctr || 0) > channelAvgCtr && (v.impressions || 0) < totalImp / vp.length);
    const wastedImp    = vp.filter(v => (v.ctr || 0) < channelAvgCtr && (v.impressions || 0) > totalImp / vp.length);

    const impSeries = Array.isArray(imp?.series) ? imp.series : [];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {errors.impressionsData && <ErrorBanner message={errors.impressionsData} onReconnect={onConnect} />}

        {/* Funnel */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
          <SectionHeader title="Impression Funnel" subtitle="From impression to engagement" />
          {isLoading ? <SkeletonCard height={120} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              {[
                { label: 'Impressions', value: totalImp, color: '#7c4dff', widthPct: 100 },
                { label: 'Clicks (from CTR)', value: clicks, color: '#2196f3', widthPct: Math.min(100, ctr * 10) },
                { label: 'Views', value: views, color: '#00c853', widthPct: Math.max(10, ctr * 8) },
                { label: 'Engagements (~4%)', value: engages, color: '#ff9100', widthPct: Math.max(5, ctr * 3) },
              ].map((f, i) => (
                <div key={i} style={{ width: `${f.widthPct}%`, background: f.color + '22', border: `1px solid ${f.color}44`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', transition: 'width 0.5s ease' }}>
                  <span style={{ fontSize: 12, color: f.color, fontWeight: 700 }}>{f.label}</span>
                  <span style={{ fontSize: 12, color: '#fff', fontWeight: 800 }}>{fmt(f.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CTR benchmark */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
          <SectionHeader title="CTR Benchmark" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: ctr >= 4 ? '#00c853' : '#ff9100' }}>{ctr.toFixed(2)}%</div>
              <div style={{ fontSize: 11, color: '#555' }}>Your CTR</div>
            </div>
            <div style={{ flex: 1, height: 1, background: '#1a1a1a' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#888' }}>4–5%</div>
              <div style={{ fontSize: 11, color: '#555' }}>YouTube Average</div>
            </div>
            <div style={{ background: (ctr >= 4 ? '#00c853' : '#ff9100') + '22', border: `1px solid ${(ctr >= 4 ? '#00c853' : '#ff9100')}44`, borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, color: ctr >= 4 ? '#00c853' : '#ff9100' }}>
              {ctr >= 5 ? 'Excellent' : ctr >= 4 ? 'Good' : ctr >= 2 ? 'Average' : 'Below Average'}
            </div>
          </div>
        </div>

        {/* Hidden gems */}
        {hiddenGems.length > 0 && (
          <div style={{ background: '#0d0d0d', border: '1px solid #00c85333', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="💎 Hidden Gems" subtitle="High CTR but low impressions — boost these with end screens or cards" />
            {hiddenGems.slice(0, 3).map((v, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #111', fontSize: 13 }}>
                <span style={{ color: '#ccc', flex: 1 }}>{v.title}</span>
                <span style={{ color: '#00c853', marginLeft: 12 }}>CTR: {(v.ctr || 0).toFixed(2)}%</span>
              </div>
            ))}
          </div>
        )}

        {/* Wasted impressions */}
        {wastedImp.length > 0 && (
          <div style={{ background: '#0d0d0d', border: '1px solid #ff174433', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="⚠️ Wasted Impressions" subtitle="High impressions but low CTR — fix thumbnails or titles" />
            {wastedImp.slice(0, 3).map((v, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #111', fontSize: 13 }}>
                <span style={{ color: '#ccc', flex: 1 }}>{v.title}</span>
                <span style={{ color: '#ff6666', marginLeft: 12 }}>CTR: {(v.ctr || 0).toFixed(2)}%</span>
              </div>
            ))}
          </div>
        )}

        {/* Charts */}
        {impSeries.length > 0 && (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Impressions Over Time" />
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={impSeries}>
                <defs>
                  <linearGradient id="gImp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2196f3" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#2196f3" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1a1a1a" vertical={false} />
                <XAxis dataKey="date" tickFormatter={d => typeof d === 'string' ? d.slice(5) : ''} tick={{ fontSize: 10, fill: '#444' }} />
                <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 10, fill: '#444' }} />
                <Tooltip contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="impressions" stroke="#2196f3" fill="url(#gImp)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        <AIInsightCard
          insight={aiInsights.impressions}
          loading={aiLoading.impressions}
          error={errors.ai_impressions}
          onGenerate={() => generateTabInsight('impressions', { totalImpressions: totalImp, avgCtr: ctr, days })}
        />
      </div>
    );
  }

  // ── Audience ──────────────────────────────────────────────────────────────────
  function renderAudience() {
    const aud = D.audience;
    const heatmapGrid = D.heatmap?.grid;
    const isLoading = loading.audience;

    const ageData = Array.isArray(aud?.ageGroups) ? aud.ageGroups : [];
    const genderData = Array.isArray(aud?.genderSplit)
      ? aud.genderSplit
      : [{ name: 'Male', value: 60 }, { name: 'Female', value: 35 }, { name: 'Other', value: 5 }];

    const deviceData = [
      { name: 'Mobile', value: 65, color: '#7c4dff' },
      { name: 'Desktop', value: 25, color: '#2196f3' },
      { name: 'TV', value: 10, color: '#00c853' },
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {errors.audience && <ErrorBanner message={errors.audience} onReconnect={onConnect} />}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Age breakdown */}
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Age Groups" />
            {isLoading ? <SkeletonCard height={140} /> : ageData.length === 0 ? <NoData label="Age data unavailable" /> : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={ageData}>
                  <CartesianGrid stroke="#1a1a1a" vertical={false} />
                  <XAxis dataKey="ageGroup" tick={{ fontSize: 10, fill: '#444' }} />
                  <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: '#444' }} />
                  <Tooltip contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="viewerPercentage" fill="#7c4dff" radius={[3, 3, 0, 0]}>
                    {ageData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Gender donut */}
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Gender Split" />
            {isLoading ? <SkeletonCard height={140} /> : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <ResponsiveContainer width={140} height={140}>
                  <PieChart>
                    <Pie data={genderData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} dataKey="value" paddingAngle={2}>
                      {genderData.map((_, i) => <Cell key={i} fill={['#7c4dff','#ff0000','#2196f3'][i] || PIE_COLORS[i]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ flex: 1 }}>
                  {genderData.map((g, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: ['#7c4dff','#ff0000','#2196f3'][i] || PIE_COLORS[i], flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: '#ccc' }}>{g.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginLeft: 'auto' }}>{g.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Device performance */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
          <SectionHeader title="Device Performance" subtitle="Estimated based on YouTube benchmarks" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {deviceData.map((d, i) => (
              <div key={i} style={{ background: '#111', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>{['📱','💻','📺'][i]}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: d.color }}>{d.value}%</div>
                <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{d.name}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Peak hours */}
        {heatmapGrid && (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Posting Heatmap — Viewer Activity" subtitle="Brighter = better average views when posting at that time" />
            <PostingHeatmap grid={heatmapGrid} />
          </div>
        )}

        <AIInsightCard
          insight={aiInsights.audience}
          loading={aiLoading.audience}
          error={errors.ai_audience}
          onGenerate={() => generateTabInsight('audience', { ageGroups: ageData, genderSplit: genderData, days })}
        />
      </div>
    );
  }

  // ── Videos ────────────────────────────────────────────────────────────────────
  function renderVideos() {
    const vp = Array.isArray(D.videoPerf) ? D.videoPerf : [];
    const isLoading = loading.videoPerf;

    const avgViews = vp.length > 0 ? vp.reduce((s, v) => s + (v.views || 0), 0) / vp.length : 0;
    const avgLikes = vp.length > 0 ? vp.reduce((s, v) => s + (v.likes || 0), 0) / vp.length : 0;

    const gradeVideo = (v) => {
      let score = 0;
      if ((v.views || 0) >= avgViews * 1.5) score += 3;
      else if ((v.views || 0) >= avgViews) score += 2;
      else if ((v.views || 0) >= avgViews * 0.5) score += 1;
      if ((v.likes || 0) >= avgLikes * 1.2) score += 2;
      else if ((v.likes || 0) >= avgLikes) score += 1;
      if ((v.avgViewPct || 0) >= 50) score += 2;
      else if ((v.avgViewPct || 0) >= 35) score += 1;
      return score >= 6 ? 'A' : score >= 4 ? 'B' : score >= 2 ? 'C' : score >= 1 ? 'D' : 'F';
    };

    const gradeColor = g => g === 'A' ? '#00c853' : g === 'B' ? '#69f0ae' : g === 'C' ? '#ff9100' : g === 'D' ? '#ff6d00' : '#ff1744';

    let filtered = vpFilter === 'above' ? vp.filter(v => (v.views || 0) >= avgViews) :
                   vpFilter === 'below' ? vp.filter(v => (v.views || 0) < avgViews) : vp;

    const sorted = [...filtered].sort((a, b) => {
      if (vpSort === 'views')     return (b.views || 0)      - (a.views || 0);
      if (vpSort === 'likes')     return (b.likes || 0)      - (a.likes || 0);
      if (vpSort === 'comments')  return (b.comments || 0)   - (a.comments || 0);
      if (vpSort === 'watchPct')  return (b.avgViewPct || 0) - (a.avgViewPct || 0);
      if (vpSort === 'subsGained') return (b.subsGained || 0) - (a.subsGained || 0);
      return 0;
    });

    const exportCSV = () => {
      const header = 'Title,Views,Likes,Comments,Avg View %,Subs Gained,Grade';
      const rows = sorted.map(v => `"${(v.title || '').replace(/"/g, '""')}",${v.views||0},${v.likes||0},${v.comments||0},${v.avgViewPct||0},${v.subsGained||0},${gradeVideo(v)}`);
      const csv = [header, ...rows].join('\n');
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = `video-performance-${days}d.csv`;
      a.click();
    };

    const toggleCompare = (v) => {
      setCompareVideos(prev => {
        if (prev.find(x => x.videoId === v.videoId)) return prev.filter(x => x.videoId !== v.videoId);
        if (prev.length >= 2) return [prev[1], v];
        return [...prev, v];
      });
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {errors.videoPerf && <ErrorBanner message={errors.videoPerf} onReconnect={onConnect} />}

        {/* Filter + sort bar */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['all','All'],['above','Above Avg'],['below','Below Avg']].map(([val, lab]) => (
              <button key={val} onClick={() => setVpFilter(val)} style={{ background: vpFilter === val ? '#7c4dff22' : '#111', border: `1px solid ${vpFilter === val ? '#7c4dff' : '#1e1e1e'}`, borderRadius: 6, padding: '5px 12px', fontSize: 11, color: vpFilter === val ? '#b39ddb' : '#666', cursor: 'pointer' }}>{lab}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            <span style={{ fontSize: 11, color: '#555', padding: '5px 0' }}>Sort:</span>
            {[['views','Views'],['likes','Likes'],['watchPct','Watch%'],['subsGained','Subs+']].map(([val, lab]) => (
              <button key={val} onClick={() => setVpSort(val)} style={{ background: vpSort === val ? '#7c4dff22' : '#111', border: `1px solid ${vpSort === val ? '#7c4dff' : '#1e1e1e'}`, borderRadius: 6, padding: '5px 10px', fontSize: 11, color: vpSort === val ? '#b39ddb' : '#666', cursor: 'pointer' }}>{lab}</button>
            ))}
          </div>
          <button onClick={exportCSV} style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 6, padding: '5px 12px', fontSize: 11, color: '#888', cursor: 'pointer' }}>⬇ Export CSV</button>
        </div>

        {/* Compare view */}
        {compareVideos.length === 2 && (
          <div style={{ background: '#0d0d0d', border: '1px solid #7c4dff44', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <SectionHeader title="Video Comparison" />
              <button onClick={() => setCompareVideos([])} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12 }}>✕ Clear</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {compareVideos.map((v, i) => (
                <div key={i} style={{ background: '#111', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 8 }}>{v.title}</div>
                  {[['👁 Views', fmt(v.views)],['❤️ Likes', fmt(v.likes)],['📊 Watch%', `${v.avgViewPct||0}%`],['👤 Subs+', fmt(v.subsGained)],['🏆 Grade', gradeVideo(v)]].map(([label, val], j) => (
                    <div key={j} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: '#555' }}>{label}</span>
                      <span style={{ color: '#fff', fontWeight: 700 }}>{val}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Table */}
        {isLoading ? <SkeletonCard height={300} /> : sorted.length === 0 ? <NoData label="No video performance data" /> : (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#111', borderBottom: '1px solid #1a1a1a' }}>
                    {['','Title','Views','Watch%','Likes','Comments','Subs+','Grade','Compare'].map((h, i) => (
                      <th key={i} style={{ padding: '10px 12px', textAlign: i > 1 ? 'right' : 'left', color: '#555', fontWeight: 600, whiteSpace: 'nowrap', fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 50).map((v, i) => {
                    const grade = gradeVideo(v);
                    const gc = gradeColor(grade);
                    const aboveAvg = (v.views || 0) >= avgViews;
                    const isCompared = compareVideos.find(x => x.videoId === v.videoId);
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #111', background: i % 2 === 0 ? 'transparent' : '#07070799' }}>
                        <td style={{ padding: '8px 12px' }}>{v.thumbnail ? <img src={v.thumbnail} alt="" style={{ width: 52, height: 30, objectFit: 'cover', borderRadius: 4 }} /> : <div style={{ width: 52, height: 30, background: '#1a1a1a', borderRadius: 4 }} />}</td>
                        <td style={{ padding: '8px 12px', maxWidth: 220, color: '#ccc' }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</div>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: aboveAvg ? '#00c853' : '#ff9100', fontWeight: 700 }}>{fmt(v.views)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: (v.avgViewPct || 0) >= 45 ? '#00c853' : '#888' }}>{v.avgViewPct || 0}%</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#888' }}>{fmt(v.likes)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#888' }}>{fmt(v.comments)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: (v.subsGained || 0) > 0 ? '#00c853' : '#ff1744' }}>{(v.subsGained || 0) > 0 ? '+' : ''}{fmt(v.subsGained)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          <span style={{ background: gc + '22', border: `1px solid ${gc}44`, borderRadius: 4, padding: '2px 8px', fontWeight: 800, color: gc, fontSize: 11 }}>{grade}</span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          <button onClick={() => toggleCompare(v)} style={{ background: isCompared ? '#7c4dff22' : '#111', border: `1px solid ${isCompared ? '#7c4dff' : '#1e1e1e'}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, color: isCompared ? '#b39ddb' : '#555', cursor: 'pointer' }}>
                            {isCompared ? '✓' : '+'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Subscribers ───────────────────────────────────────────────────────────────
  function renderSubscribers() {
    const ss = Array.isArray(D.subSeries) ? D.subSeries : [];
    const vp = Array.isArray(D.videoPerf) ? D.videoPerf : [];
    const isLoading = loading.subSeries;

    const totalSubs = activeProfile?.subscribers || 0;
    const milestones = [1000,5000,10000,25000,50000,100000,250000,500000,1000000];
    const nextMs = milestones.find(m => m > totalSubs) || totalSubs * 2;
    const avgDailyGain = ss.length > 0 ? ss.reduce((s, r) => s + (r.subsGained || 0), 0) / ss.length : 0;
    const daysToMs = avgDailyGain > 0 ? Math.round((nextMs - totalSubs) / avgDailyGain) : null;

    const topGainers = [...vp].sort((a, b) => (b.subsGained || 0) - (a.subsGained || 0)).slice(0, 5);
    const topLosers  = [...vp].sort((a, b) => (a.subsGained || 0) - (b.subsGained || 0)).filter(v => (v.subsGained || 0) < 0).slice(0, 3);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {errors.subSeries && <ErrorBanner message={errors.subSeries} onReconnect={onConnect} />}

        {/* Milestone card */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
          <SectionHeader title="Milestone Tracker" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>
                {fmt(totalSubs)} / {fmt(nextMs)} subscribers to next milestone
              </div>
              <div style={{ background: '#1a1a1a', borderRadius: 8, height: 10, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (totalSubs / nextMs) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #7c4dff, #e040fb)', transition: 'width 1s ease', borderRadius: 8 }} />
              </div>
            </div>
            <div style={{ textAlign: 'center', minWidth: 70 }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#7c4dff' }}>{daysToMs != null ? daysToMs : '—'}</div>
              <div style={{ fontSize: 10, color: '#555' }}>days away</div>
            </div>
          </div>
          {avgDailyGain > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#555' }}>
              Growing at ~{avgDailyGain.toFixed(1)} subs/day based on last 90 days
            </div>
          )}
        </div>

        {/* 90-day chart */}
        {isLoading ? <SkeletonCard height={200} /> : ss.length > 0 && (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Subscriber Growth (90 days)" />
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={ss}>
                <defs>
                  <linearGradient id="gSubGain" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00c853" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00c853" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gSubLost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff1744" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ff1744" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1a1a1a" vertical={false} />
                <XAxis dataKey="date" tickFormatter={d => typeof d === 'string' ? d.slice(5) : ''} tick={{ fontSize: 10, fill: '#444' }} />
                <YAxis tick={{ fontSize: 10, fill: '#444' }} />
                <Tooltip contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="subsGained" stroke="#00c853" fill="url(#gSubGain)" strokeWidth={2} dot={false} name="Gained" />
                {ss[0]?.subsLost !== undefined && <Area type="monotone" dataKey="subsLost" stroke="#ff1744" fill="url(#gSubLost)" strokeWidth={2} dot={false} name="Lost" />}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Top gaining videos */}
        {topGainers.length > 0 && (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Top Subscriber-Gaining Videos" />
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={topGainers} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10, fill: '#444' }} />
                <YAxis type="category" dataKey="title" width={150} tick={{ fontSize: 9, fill: '#888' }} tickFormatter={t => t?.slice(0, 22) + (t?.length > 22 ? '…' : '')} />
                <Tooltip contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="subsGained" fill="#00c853" radius={[0, 4, 4, 0]} name="Subs Gained" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Losing videos */}
        {topLosers.length > 0 && (
          <div style={{ background: '#0d0d0d', border: '1px solid #ff174422', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Videos That Lost Subscribers" />
            {topLosers.map((v, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #111', fontSize: 12 }}>
                <span style={{ color: '#ccc' }}>{v.title}</span>
                <span style={{ color: '#ff1744', fontWeight: 700 }}>{v.subsGained}</span>
              </div>
            ))}
          </div>
        )}

        <AIInsightCard
          insight={aiInsights.subscribers}
          loading={aiLoading.subscribers}
          error={errors.ai_subscribers}
          onGenerate={() => generateTabInsight('subscribers', { avgDailyGain, totalSubs, nextMs, daysToMs, topGainers: topGainers.map(v => ({ title: v.title, subsGained: v.subsGained })) })}
        />
      </div>
    );
  }

  // ── Heatmap ───────────────────────────────────────────────────────────────────
  function renderHeatmap() {
    const hm = D.heatmap;
    const grid = hm?.grid;
    const isLoading = loading.heatmap;

    // Best day stats
    const dayStats = DAYS_SHORT.map((day, di) => {
      const hours = Array.from({ length: 24 }, (_, h) => {
        const key = `${di}_${h}`;
        const cell = grid?.[key] || { count: 0, totalViews: 0 };
        return { h, avg: cell.count > 0 ? cell.totalViews / cell.count : 0, count: cell.count };
      });
      const totalViews = hours.reduce((s, c) => s + c.avg, 0);
      const bestHour = hours.reduce((best, c) => c.avg > best.avg ? c : best, { h: 0, avg: 0 });
      return { day, totalViews, bestHour: bestHour.h };
    });

    const bestDay = dayStats.reduce((best, d) => d.totalViews > best.totalViews ? d : best, dayStats[0] || { day: '—', totalViews: 0, bestHour: 12 });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {errors.heatmap && <ErrorBanner message={errors.heatmap} onReconnect={onConnect} />}

        {/* Optimal window */}
        <div style={{ background: '#0d0d0d', border: '1px solid #00c85333', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 32 }}>⭐</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#00c853', marginBottom: 4 }}>Optimal Upload Window</div>
            <div style={{ fontSize: 13, color: '#888' }}>
              {grid ? `${bestDay.day} at ${bestDay.bestHour}:00 — ${bestDay.bestHour < 12 ? 'morning' : bestDay.bestHour < 17 ? 'afternoon' : 'evening'} upload drives best avg views from your history` : 'Connect and upload more videos to see your optimal time'}
            </div>
          </div>
        </div>

        {/* Heatmap */}
        {isLoading ? <SkeletonCard height={220} /> : (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Upload Time Performance Heatmap" subtitle="Based on your actual video history — shows average views by upload day/hour" />
            <PostingHeatmap grid={grid} />
          </div>
        )}

        {/* Day of week table */}
        {grid && (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Day of Week Performance" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dayStats.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid #111' }}>
                  <div style={{ width: 36, fontSize: 12, fontWeight: 700, color: d.day === bestDay.day ? '#7c4dff' : '#888' }}>{d.day}</div>
                  <div style={{ flex: 1, background: '#111', borderRadius: 4, height: 8 }}>
                    <div style={{ width: `${dayStats[0]?.totalViews ? (d.totalViews / Math.max(...dayStats.map(x => x.totalViews))) * 100 : 0}%`, height: '100%', background: d.day === bestDay.day ? '#7c4dff' : '#333', borderRadius: 4 }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#555', minWidth: 80, textAlign: 'right' }}>Best: {d.bestHour}:00</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <AIInsightCard
          insight={aiInsights.heatmap}
          loading={aiLoading.heatmap}
          error={errors.ai_heatmap}
          onGenerate={() => generateTabInsight('heatmap', { bestDay: bestDay.day, bestHour: bestDay.bestHour, dayStats })}
        />
      </div>
    );
  }

  // ── Monetization ──────────────────────────────────────────────────────────────
  function renderMonetization() {
    const mon = D.monetization;
    const rs  = Array.isArray(D.revSeries) ? D.revSeries : [];
    const vp  = Array.isArray(D.videoPerf) ? D.videoPerf : [];
    const isLoading = loading.monetization;

    const totalSubs = activeProfile?.subscribers || 0;
    const ov = D.overview;
    const views = ov?.views || 0;
    const engRate = views > 0 ? ((ov?.likes || 0) + (ov?.comments || 0)) / views * 100 : 0;
    const spv = sponsorshipValue(views, engRate);

    const isMonetized = mon?.isMonetized || (mon?.estimatedRevenue > 0);
    const totalRev = mon?.estimatedRevenue || 0;
    const rpm = mon?.rpm || (views > 0 && totalRev > 0 ? (totalRev / views * 1000) : 0);

    // Alt revenue streams
    const altStreams = [
      { name: 'Channel Memberships', min: 1000, rec: totalSubs >= 500, icon: '👑', est: `₹${fmt(totalSubs * 0.005 * 99)}/mo` },
      { name: 'Merchandise', min: 5000, rec: totalSubs >= 2000, icon: '👕', est: `₹${fmt(totalSubs * 0.002 * 499)}/mo` },
      { name: 'Online Courses', min: 10000, rec: totalSubs >= 5000, icon: '🎓', est: `₹${fmt(totalSubs * 0.001 * 1999)}/mo` },
      { name: 'Affiliate Marketing', min: 1000, rec: true, icon: '🔗', est: `₹${fmt(views * 0.002 * 50)}/mo` },
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {errors.monetization && <ErrorBanner message={errors.monetization} onReconnect={onConnect} />}

        {!isMonetized && (
          <div style={{ background: '#ff9100' + '11', border: '1px solid #ff910033', borderRadius: 12, padding: '14px 18px', fontSize: 13, color: '#ffcc80' }}>
            ℹ️ Your channel may not be monetized yet, or revenue data isn't available. Showing estimates and potential below.
          </div>
        )}

        {/* Revenue cards */}
        {isMonetized && !isLoading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <StatCard icon="💰" label="Total Revenue" value={`₹${fmt(totalRev * 83)}`} color="#00c853" sub={`$${fmt(totalRev)}`} />
            <StatCard icon="📊" label="RPM" value={`$${(rpm || 0).toFixed(2)}`} color="#7c4dff" sub="Revenue per 1K views" />
            <StatCard icon="👁" label="Monetized Views" value={fmt(mon?.monetizedViews || views * 0.6)} color="#2196f3" />
          </div>
        )}

        {/* Daily revenue chart */}
        {isMonetized && rs.length > 0 && (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Daily Revenue" />
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={rs}>
                <defs>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00c853" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00c853" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1a1a1a" vertical={false} />
                <XAxis dataKey="date" tickFormatter={d => typeof d === 'string' ? d.slice(5) : ''} tick={{ fontSize: 10, fill: '#444' }} />
                <YAxis tickFormatter={v => `$${v}`} tick={{ fontSize: 10, fill: '#444' }} />
                <Tooltip contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8, fontSize: 12 }} formatter={v => [`$${Number(v).toFixed(2)}`, 'Revenue']} />
                <Area type="monotone" dataKey="revenue" stroke="#00c853" fill="url(#gRev)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Sponsorship value */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
          <SectionHeader title="Sponsorship Value Calculator" subtitle={`Based on ${fmt(views)} views and ${engRate.toFixed(2)}% engagement rate`} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              { label: 'Pre-roll', value: spv.preRoll, icon: '▶️', desc: '15% of CPM value' },
              { label: 'Mid-roll', value: spv.midRoll, icon: '⏸️', desc: '25% of CPM value' },
              { label: 'Dedicated', value: spv.dedicated, icon: '🎬', desc: '80% of CPM value' },
              { label: 'Story', value: spv.story, icon: '✨', desc: '5% of CPM value' },
            ].map((s, i) => (
              <div key={i} style={{ background: '#111', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>{s.icon}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#00c853' }}>₹{fmt(s.value)}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#ccc', marginTop: 2 }}>{s.label}</div>
                <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Alternative revenue */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
          <SectionHeader title="Alternative Revenue Streams" subtitle="Opportunities beyond AdSense based on your channel size" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {altStreams.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#111', borderRadius: 8, padding: '12px 14px', opacity: s.rec ? 1 : 0.5 }}>
                <span style={{ fontSize: 22 }}>{s.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>Requires {fmt(s.min)}+ subs</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#00c853' }}>{s.est}</div>
                  <div style={{ fontSize: 10, color: s.rec ? '#00c853' : '#555', marginTop: 2 }}>{s.rec ? '✓ You qualify' : `Need ${fmt(s.min - totalSubs)} more subs`}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <AIInsightCard
          insight={aiInsights.monetization}
          loading={aiLoading.monetization}
          error={errors.ai_monetization}
          onGenerate={() => generateTabInsight('monetization', { isMonetized, totalRevenue: totalRev, rpm, views, engRate, totalSubs })}
        />
      </div>
    );
  }

  // ── Growth Intel ──────────────────────────────────────────────────────────────
  function renderGrowth() {
    const ts = Array.isArray(D.timeseries90 || D.timeseries) ? (D.timeseries90 || D.timeseries) : [];
    const ss = Array.isArray(D.subSeries) ? D.subSeries : [];
    const ov = D.overview;
    const isLoading = loading.timeseries;

    // 3 periods of 30 days each
    const p1 = ts.slice(0, 30);
    const p2 = ts.slice(30, 60);
    const p3 = ts.slice(60, 90);
    const periodViews = [p1, p2, p3].map((p, i) => ({
      period: `Days ${i*30+1}–${(i+1)*30}`,
      views: p.reduce((s, r) => s + (r.views || 0), 0),
      subs: p.reduce((s, r) => s + (r.netSubs || 0), 0),
    }));

    // Weekly growth rates
    const weeks = [];
    for (let i = 0; i + 7 <= ts.length; i += 7) {
      const week = ts.slice(i, i + 7);
      weeks.push({ week: `W${Math.floor(i/7)+1}`, views: week.reduce((s, r) => s + (r.views || 0), 0) });
    }
    const avgWeekly = weeks.length > 0 ? weeks.reduce((s, w) => s + w.views, 0) / weeks.length : 0;
    const bestWeek  = weeks.reduce((best, w) => w.views > best.views ? w : best, weeks[0] || { week: '—', views: 0 });
    const worstWeek = weeks.reduce((worst, w) => w.views < worst.views ? w : worst, weeks[0] || { week: '—', views: 0 });

    // 30-day forecast via linear regression
    const viewPoints = ts.map(r => r.views || 0);
    const { slope, intercept } = linearRegression(viewPoints);
    const forecastData = [
      ...ts.slice(-14).map((r, i) => ({ date: r.date, views: r.views, forecast: null })),
      ...Array.from({ length: 14 }, (_, i) => ({
        date: `Forecast+${i+1}`,
        views: null,
        forecast: Math.max(0, Math.round(intercept + slope * (viewPoints.length + i))),
      })),
    ];

    // Growth levers
    const imp = D.impressionsData;
    const ctr = imp?.avgCtr || 0;
    const avgViewPct = ov?.avgViewPct || 0;
    const uploadsPerWeek = (ov?.uploads || 0) / (days / 7);
    const levers = [];
    if (ctr < 3) levers.push({ priority: 1, lever: 'Improve thumbnails', detail: `Your ${ctr.toFixed(1)}% CTR is below average. A/B test high-contrast thumbnails with clear emotion or text.`, icon: '🖼️' });
    if (avgViewPct < 40) levers.push({ priority: 2, lever: 'Improve retention', detail: `${avgViewPct}% avg view completion is low. Add pattern interrupts every 60–90s and stronger hooks.`, icon: '⏱️' });
    if (uploadsPerWeek < 1) levers.push({ priority: 3, lever: 'Upload more consistently', detail: `${uploadsPerWeek.toFixed(1)} videos/week is below the 1/week threshold. Consistent uploads signal algorithmic health.`, icon: '📅' });
    if ((ov?.comments || 0) / (ov?.views || 1) * 100 < 0.3) levers.push({ priority: 4, lever: 'Drive comments', detail: 'Ask a specific question at the 70% mark of each video to boost comment rate.', icon: '💬' });
    levers.push({ priority: 5, lever: 'Optimize for Browse Features', detail: 'Ensure thumbnail + title communicate value within 0.5 seconds. This is your #1 Browse discovery lever.', icon: '🔍' });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {errors.timeseries && <ErrorBanner message={errors.timeseries} onReconnect={onConnect} />}

        {/* Content velocity */}
        {!isLoading && periodViews.some(p => p.views > 0) && (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Content Velocity (90 Days)" subtitle="Views split into 3 equal periods" />
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={periodViews}>
                <CartesianGrid stroke="#1a1a1a" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#444' }} />
                <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 10, fill: '#444' }} />
                <Tooltip contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="views" fill="#7c4dff" radius={[4, 4, 0, 0]} name="Views">
                  {periodViews.map((_, i) => <Cell key={i} fill={['#5e35b1','#7c4dff','#b39ddb'][i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 30-day forecast */}
        {forecastData.length > 0 && (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="30-Day Forecast" subtitle="Dotted line = projected based on linear trend" />
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={forecastData}>
                <defs>
                  <linearGradient id="gForecast" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c4dff" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#7c4dff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1a1a1a" vertical={false} />
                <XAxis dataKey="date" tickFormatter={d => typeof d === 'string' ? d.slice(5) : ''} tick={{ fontSize: 10, fill: '#444' }} />
                <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 10, fill: '#444' }} />
                <Tooltip contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="views" stroke="#7c4dff" fill="url(#gForecast)" strokeWidth={2} dot={false} name="Actual" connectNulls={false} />
                <Line type="monotone" dataKey="forecast" stroke="#b39ddb" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Forecast" connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Key growth metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <StatCard icon="📅" label="Avg Weekly Views" value={fmt(avgWeekly)} color="#7c4dff" />
          <StatCard icon="🏆" label="Best Week" value={bestWeek.week} sub={fmt(bestWeek.views) + ' views'} color="#00c853" />
          <StatCard icon="📉" label="Worst Week" value={worstWeek.week} sub={fmt(worstWeek.views) + ' views'} color="#ff9100" />
        </div>

        {/* Growth levers */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
          <SectionHeader title="Growth Levers" subtitle="Ranked actions that will move the needle most for your channel" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {levers.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, background: '#111', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#7c4dff22', border: '1px solid #7c4dff44', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#7c4dff', flexShrink: 0 }}>{l.priority}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 3 }}>{l.icon} {l.lever}</div>
                  <div style={{ fontSize: 12, color: '#666' }}>{l.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <AIInsightCard
          insight={aiInsights.growth}
          loading={aiLoading.growth}
          error={errors.ai_growth}
          onGenerate={() => generateTabInsight('growth', { periodViews, avgWeekly, levers: levers.map(l => l.lever), ctr, avgViewPct })}
        />
      </div>
    );
  }

  // ── Content Strategy ──────────────────────────────────────────────────────────
  function renderStrategy() {
    const vp = Array.isArray(D.videoPerf) ? D.videoPerf : [];
    const isLoading = loading.videoPerf;

    // Format buckets (using avgViewDuration as proxy for length)
    const shorts = vp.filter(v => (v.avgViewDuration || 0) < 180);
    const medium = vp.filter(v => (v.avgViewDuration || 0) >= 180 && (v.avgViewDuration || 0) < 900);
    const longs  = vp.filter(v => (v.avgViewDuration || 0) >= 900);

    const avgViewsFor = (arr) => arr.length > 0 ? arr.reduce((s, v) => s + (v.views || 0), 0) / arr.length : 0;
    const avgPctFor   = (arr) => arr.length > 0 ? arr.reduce((s, v) => s + (v.avgViewPct || 0), 0) / arr.length : 0;

    const formats = [
      { name: 'Shorts (<3 min)',      count: shorts.length, avgViews: avgViewsFor(shorts), avgPct: avgPctFor(shorts), color: '#ff0000' },
      { name: 'Mid-length (3–15 min)', count: medium.length, avgViews: avgViewsFor(medium), avgPct: avgPctFor(medium), color: '#7c4dff' },
      { name: 'Long (>15 min)',        count: longs.length,  avgViews: avgViewsFor(longs),  avgPct: avgPctFor(longs),  color: '#00c853' },
    ].filter(f => f.count > 0);

    const bestFormat = formats.reduce((best, f) => f.avgViews > best.avgViews ? f : best, formats[0] || { name: '—' });

    // Title pattern analysis
    const patterns = [
      { name: 'Number titles', regex: /\b\d+\b/, icon: '🔢' },
      { name: 'Question titles', regex: /\?/, icon: '❓' },
      { name: '"How to" titles', regex: /how to/i, icon: '📖' },
      { name: 'List titles', regex: /top \d+|best \d+|\d+ (ways|tips|things)/i, icon: '📋' },
      { name: '"Why" titles', regex: /\bwhy\b/i, icon: '🤔' },
    ];

    const patternStats = patterns.map(p => {
      const matched = vp.filter(v => p.regex.test(v.title || ''));
      return { ...p, count: matched.length, avgViews: avgViewsFor(matched) };
    }).filter(p => p.count > 0).sort((a, b) => b.avgViews - a.avgViews);

    // Content pillars (simple keyword clustering)
    const pillars = {};
    vp.forEach(v => {
      const title = (v.title || '').toLowerCase();
      const keywords = ['tutorial','review','vlog','reaction','challenge','top','best','how','tips','guide'];
      keywords.forEach(kw => {
        if (title.includes(kw)) {
          if (!pillars[kw]) pillars[kw] = { count: 0, totalViews: 0 };
          pillars[kw].count++;
          pillars[kw].totalViews += v.views || 0;
        }
      });
    });

    const pillarArr = Object.entries(pillars).map(([name, stats]) => ({
      name, count: stats.count, avgViews: stats.totalViews / stats.count,
    })).sort((a, b) => b.avgViews - a.avgViews).slice(0, 6);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {errors.videoPerf && <ErrorBanner message={errors.videoPerf} onReconnect={onConnect} />}

        {/* Best format banner */}
        {bestFormat.name && (
          <div style={{ background: '#7c4dff11', border: '1px solid #7c4dff33', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 28 }}>🏆</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#b39ddb' }}>Best Performing Format: {bestFormat.name}</div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 3 }}>{fmt(bestFormat.avgViews)} avg views · {bestFormat.avgPct.toFixed(1)}% avg watch time</div>
            </div>
          </div>
        )}

        {/* Format performance matrix */}
        {isLoading ? <SkeletonCard height={180} /> : formats.length > 0 && (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Format Performance Matrix" />
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={formats}>
                <CartesianGrid stroke="#1a1a1a" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#444' }} />
                <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 10, fill: '#444' }} />
                <Tooltip contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="avgViews" name="Avg Views" radius={[4, 4, 0, 0]}>
                  {formats.map((f, i) => <Cell key={i} fill={f.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Title pattern analyzer */}
        {patternStats.length > 0 && (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Title Pattern Analyzer" subtitle="Which title formulas perform best for your channel" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {patternStats.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #111' }}>
                  <span style={{ fontSize: 18, width: 28 }}>{p.icon}</span>
                  <div style={{ flex: 1, fontSize: 13, color: '#ccc' }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>{p.count} videos</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#7c4dff', minWidth: 70, textAlign: 'right' }}>{fmt(p.avgViews)} avg</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content pillars */}
        {pillarArr.length > 0 && (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
            <SectionHeader title="Content Pillar Analysis" subtitle="Topic clusters detected from your video titles" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {pillarArr.map((p, i) => (
                <div key={i} style={{ background: '#111', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', textTransform: 'capitalize', marginBottom: 4 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: '#7c4dff', fontWeight: 700 }}>{fmt(p.avgViews)}</div>
                  <div style={{ fontSize: 10, color: '#555' }}>avg views · {p.count} videos</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <AIInsightCard
          insight={aiInsights.strategy}
          loading={aiLoading.strategy}
          error={errors.ai_strategy}
          onGenerate={() => generateTabInsight('strategy', { formats, patternStats: patternStats.map(p => ({ name: p.name, count: p.count, avgViews: p.avgViews })), pillarArr, days: 90 })}
        />
      </div>
    );
  }

  // ── Competitive ────────────────────────────────────────────────────────────────
  function renderCompetitive() {
    const ov  = D.overview;
    const imp = D.impressionsData;
    const isLoading = loading.overview;

    const totalSubs = activeProfile?.subscribers || 0;
    const views = ov?.views || 0;
    const ctr = imp?.avgCtr || 0;
    const engRate = views > 0 ? ((ov?.likes || 0) + (ov?.comments || 0)) / views * 100 : 0;
    const avgViewPct = ov?.avgViewPct || 0;

    // Benchmarks (YouTube industry averages)
    const benchmarks = [
      { metric: 'CTR', yours: ctr.toFixed(2) + '%', industry: '4–5%', status: ctr >= 4 ? 'above' : ctr >= 2 ? 'at' : 'below', yourVal: ctr, goodVal: 4 },
      { metric: 'Engagement Rate', yours: engRate.toFixed(2) + '%', industry: '1–3%', status: engRate >= 3 ? 'above' : engRate >= 1 ? 'at' : 'below', yourVal: engRate, goodVal: 3 },
      { metric: 'Avg View %', yours: avgViewPct + '%', industry: '30–50%', status: avgViewPct >= 45 ? 'above' : avgViewPct >= 30 ? 'at' : 'below', yourVal: avgViewPct, goodVal: 45 },
    ];

    const competitiveScore = Math.round(benchmarks.reduce((s, b) => s + (b.status === 'above' ? 100 : b.status === 'at' ? 65 : 30), 0) / benchmarks.length);
    const scoreColor = competitiveScore >= 70 ? '#00c853' : competitiveScore >= 50 ? '#ff9100' : '#ff1744';

    const youDoBetter = benchmarks.filter(b => b.status === 'above').map(b => b.metric);
    const needsWork   = benchmarks.filter(b => b.status === 'below').map(b => b.metric);

    // Competitor size tiers
    const sizeTiers = [
      { range: 'Nano (< 10K)', subs: '< 10K', typicalCTR: '2–4%', typicalEng: '3–8%', isYours: totalSubs < 10000 },
      { range: 'Micro (10–100K)', subs: '10K–100K', typicalCTR: '3–5%', typicalEng: '2–5%', isYours: totalSubs >= 10000 && totalSubs < 100000 },
      { range: 'Mid (100K–1M)', subs: '100K–1M', typicalCTR: '4–6%', typicalEng: '1–3%', isYours: totalSubs >= 100000 && totalSubs < 1000000 },
      { range: 'Macro (1M+)', subs: '1M+', typicalCTR: '3–5%', typicalEng: '0.5–2%', isYours: totalSubs >= 1000000 },
    ];
    const yourTier = sizeTiers.find(t => t.isYours) || sizeTiers[0];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {errors.overview && <ErrorBanner message={errors.overview} onReconnect={onConnect} />}

        {/* Competitive position gauge */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '20px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
            <svg width="90" height="90" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="45" cy="45" r="38" fill="none" stroke="#1a1a1a" strokeWidth="7" />
              <circle cx="45" cy="45" r="38" fill="none" stroke={scoreColor} strokeWidth="7"
                strokeDasharray={2 * Math.PI * 38}
                strokeDashoffset={2 * Math.PI * 38 * (1 - competitiveScore / 100)}
                strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease' }} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: scoreColor }}>{competitiveScore}</div>
              <div style={{ fontSize: 8, color: '#444' }}>/ 100</div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 4 }}>Competitive Position</div>
            <div style={{ fontSize: 13, color: '#888' }}>
              You are in the <strong style={{ color: '#b39ddb' }}>{yourTier.range}</strong> tier.
              Your metrics are compared against YouTube-wide averages.
            </div>
          </div>
        </div>

        {/* Benchmark table */}
        {isLoading ? <SkeletonCard height={160} /> : (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#111', borderBottom: '1px solid #1a1a1a' }}>
                  {['Metric','Your Value','Industry Average','Status'].map((h, i) => (
                    <th key={i} style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {benchmarks.map((b, i) => {
                  const statusColor = b.status === 'above' ? '#00c853' : b.status === 'at' ? '#ff9100' : '#ff1744';
                  const statusLabel = b.status === 'above' ? '▲ Above Avg' : b.status === 'at' ? '→ At Average' : '▼ Below Avg';
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                      <td style={{ padding: '10px 14px', color: '#ccc', fontWeight: 600 }}>{b.metric}</td>
                      <td style={{ padding: '10px 14px', color: '#fff', fontWeight: 700 }}>{b.yours}</td>
                      <td style={{ padding: '10px 14px', color: '#555' }}>{b.industry}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* What you do better / where to improve */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: '#00c85308', border: '1px solid #00c85333', borderRadius: 12, padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#00c853', marginBottom: 8 }}>✓ You Do Better</div>
            {youDoBetter.length > 0 ? youDoBetter.map((m, i) => (
              <div key={i} style={{ fontSize: 12, color: '#69f0ae', marginBottom: 4 }}>• {m}</div>
            )) : <div style={{ fontSize: 12, color: '#444' }}>Keep improving your metrics!</div>}
          </div>
          <div style={{ background: '#ff174408', border: '1px solid #ff174433', borderRadius: 12, padding: '14px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#ff6666', marginBottom: 8 }}>↑ Focus Areas</div>
            {needsWork.length > 0 ? needsWork.map((m, i) => (
              <div key={i} style={{ fontSize: 12, color: '#ff9999', marginBottom: 4 }}>• {m}</div>
            )) : <div style={{ fontSize: 12, color: '#555' }}>All metrics at or above average!</div>}
          </div>
        </div>

        <AIInsightCard
          insight={aiInsights.competitive}
          loading={aiLoading.competitive}
          error={errors.ai_competitive}
          onGenerate={() => generateTabInsight('competitive', { ctr, engRate, avgViewPct, totalSubs, benchmarks, competitiveScore })}
        />
      </div>
    );
  }

  // ── AI Coach ───────────────────────────────────────────────────────────────────
  function renderAICoach() {
    const ov  = D.overview;
    const vp  = Array.isArray(D.videoPerf) ? D.videoPerf : [];
    const ss  = Array.isArray(D.subSeries) ? D.subSeries : [];
    const imp = D.impressionsData;
    const isLoading = loading.overview || loading.videoPerf;

    const totalSubs  = activeProfile?.subscribers || 0;
    const views      = ov?.views || 0;
    const ctr        = imp?.avgCtr || 0;
    const avgViewPct = ov?.avgViewPct || 0;
    const engRate    = views > 0 ? ((ov?.likes || 0) + (ov?.comments || 0)) / views * 100 : 0;
    const uploadsPerWeek = (ov?.uploads || 0) / (days / 7);

    // Priority actions
    const actions = [
      ctr < 3 && { action: `Fix CTR (currently ${ctr.toFixed(1)}%)`, detail: 'Your thumbnail game needs work. Test 3 new thumbnail concepts this week.', priority: 'critical' },
      avgViewPct < 40 && { action: `Boost retention (${avgViewPct}% avg)`, detail: 'Add a strong re-hook at 30 seconds and cut the first 30% of your typical intro.', priority: 'critical' },
      uploadsPerWeek < 1 && { action: 'Upload at least 1 video this week', detail: `You're averaging ${uploadsPerWeek.toFixed(1)} videos/week. Consistency is the #1 growth lever.`, priority: 'important' },
      engRate < 2 && { action: `Drive engagement (${engRate.toFixed(2)}% rate)`, detail: 'Ask a specific question at the 70% mark. Pin a comment within 30 mins of publishing.', priority: 'important' },
      { action: 'Analyze your top 3 performing videos', detail: 'Find the pattern — what did they have in common? Replicate it.', priority: 'nice' },
    ].filter(Boolean);

    // Health check signals
    const healthChecks = [
      { signal: 'CTR ≥ 3%', pass: ctr >= 3, value: `${ctr.toFixed(1)}%` },
      { signal: 'Avg View % ≥ 35%', pass: avgViewPct >= 35, value: `${avgViewPct}%` },
      { signal: 'Engagement Rate ≥ 1%', pass: engRate >= 1, value: `${engRate.toFixed(2)}%` },
      { signal: 'Uploading ≥ 1/week', pass: uploadsPerWeek >= 1, value: `${uploadsPerWeek.toFixed(1)}/wk` },
      { signal: 'Subscriber growth positive', pass: (ov?.netSubs || 0) > 0, value: `${ov?.netSubs >= 0 ? '+' : ''}${ov?.netSubs || 0}` },
      { signal: 'Watch time growing (WoW)', pass: wowTrend('views', data.timeseries) > 0, value: `${(wowTrend('views', data.timeseries) || 0).toFixed(1)}%` },
      { signal: '100+ views/video avg', pass: vp.length > 0 && vp.reduce((s,v) => s+(v.views||0),0)/vp.length >= 100, value: `${fmt(vp.length > 0 ? vp.reduce((s,v)=>s+(v.views||0),0)/vp.length : 0)}` },
      { signal: 'Comment rate ≥ 0.2%', pass: views > 0 && (ov?.comments || 0) / views * 100 >= 0.2, value: `${views > 0 ? ((ov?.comments||0)/views*100).toFixed(2) : 0}%` },
      { signal: 'Share rate > 0', pass: (ov?.shares || 0) > 0, value: fmt(ov?.shares) },
      { signal: 'Consistent upload schedule', pass: uploadsPerWeek >= 0.5, value: `${uploadsPerWeek.toFixed(1)}/wk` },
    ];

    const passCount = healthChecks.filter(h => h.pass).length;

    const handleAsk = async () => {
      if (!askQuery.trim()) return;
      if (!canUseAI?.()) { onUpgrade?.(); return; }
      setAskLoading(true);
      setAskAnswer('');
      try {
        const result = await analyzeChannelTab('ask', {
          question: askQuery,
          channelStats: { views, ctr, engRate, avgViewPct, totalSubs, uploadsPerWeek, netSubs: ov?.netSubs },
        });
        consumeAICall?.();
        setAskAnswer(result?.summary || result?.headline || JSON.stringify(result, null, 2));
      } catch (e) {
        setAskAnswer('Error: ' + e.message);
      } finally {
        setAskLoading(false);
      }
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {errors.overview && <ErrorBanner message={errors.overview} onReconnect={onConnect} />}

        {/* Priority actions */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
          <SectionHeader title="Priority Actions This Week" subtitle="Ranked by expected impact on your channel" />
          {isLoading ? <SkeletonCard height={160} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {actions.map((a, i) => {
                const priorityColor = a.priority === 'critical' ? '#ff1744' : a.priority === 'important' ? '#ff9100' : '#7c4dff';
                return (
                  <div key={i} style={{ display: 'flex', gap: 12, background: '#111', borderRadius: 8, padding: '12px 14px', borderLeft: `3px solid ${priorityColor}` }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: priorityColor + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: priorityColor, flexShrink: 0 }}>{i+1}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 3 }}>{a.action}</div>
                      <div style={{ fontSize: 12, color: '#666' }}>{a.detail}</div>
                    </div>
                    <div style={{ marginLeft: 'auto', background: priorityColor + '22', borderRadius: 10, padding: '2px 8px', fontSize: 10, fontWeight: 700, color: priorityColor, alignSelf: 'flex-start', whiteSpace: 'nowrap' }}>{a.priority}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Health check */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <SectionHeader title="Channel Health Audit" subtitle={`${passCount}/10 signals passing`} />
            <div style={{ background: passCount >= 7 ? '#00c85322' : passCount >= 5 ? '#ff910022' : '#ff174422', border: `1px solid ${passCount >= 7 ? '#00c85344' : passCount >= 5 ? '#ff910044' : '#ff174444'}`, borderRadius: 8, padding: '4px 12px', fontSize: 12, fontWeight: 700, color: passCount >= 7 ? '#00c853' : passCount >= 5 ? '#ff9100' : '#ff1744' }}>
              {passCount >= 7 ? 'Healthy' : passCount >= 5 ? 'Needs Attention' : 'At Risk'}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {healthChecks.map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#111', borderRadius: 6, padding: '8px 10px' }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>{h.pass ? '✅' : '❌'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: h.pass ? '#ccc' : '#666' }}>{h.signal}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: h.pass ? '#00c853' : '#ff6666' }}>{h.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Ask TubeIntel */}
        <div style={{ background: '#0d0d0d', border: '1px solid #7c4dff44', borderRadius: 12, padding: '16px 18px' }}>
          <SectionHeader title="🔮 Ask TubeIntel" subtitle="Ask anything about your channel — get a data-specific answer" />
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="text"
              value={askQuery}
              onChange={e => setAskQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !askLoading && handleAsk()}
              placeholder="e.g. Why is my CTR dropping? What should I post next week?"
              style={{ flex: 1, background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#ccc', outline: 'none' }}
            />
            <button
              onClick={handleAsk}
              disabled={askLoading || !askQuery.trim()}
              style={{ background: '#7c4dff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 700, color: '#fff', cursor: askLoading || !askQuery.trim() ? 'not-allowed' : 'pointer', opacity: askLoading || !askQuery.trim() ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {askLoading ? <><span className="btn-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Thinking...</> : 'Ask AI'}
            </button>
          </div>
          {askAnswer && (
            <div style={{ marginTop: 14, background: '#111', border: '1px solid #7c4dff33', borderRadius: 8, padding: '14px 16px', fontSize: 13, color: '#ccc', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {askAnswer}
            </div>
          )}
        </div>

        {/* AI overview insight */}
        <AIInsightCard
          insight={aiInsights.overview}
          loading={aiLoading.overview}
          error={errors.ai_overview}
          onGenerate={() => generateTabInsight('overview', {
            days, views, watchTimeHours: ov?.watchTimeHours, netSubs: ov?.netSubs,
            avgViewDuration: ov?.avgViewDuration, avgViewPct, likes: ov?.likes,
            comments: ov?.comments, shares: ov?.shares,
            totImpressions: imp?.totalImpressions, avgCtr: ctr,
            topSources: 'Browse, Suggested, Search',
            uploadsPerWeek, channelAgeDays: 365, totalSubs,
          })}
          label="Generate Full AI Channel Report"
        />
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────────
  const totalSubs = activeProfile?.subscribers || 0;

  return (
    <AnalyticsErrorBoundary>
      <div className="analysis-page" style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Sticky demo mode banner */}
        {demoMode && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 100,
            background: 'linear-gradient(90deg, #7a3800, #8b1a00)',
            border: '1px solid #ff6600aa',
            borderRadius: 10, padding: '12px 20px', marginBottom: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 22 }}>🎭</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 900, color: '#ffd580', letterSpacing: 0.3 }}>
                  DEMO MODE — Sample Creator Data
                </div>
                <div style={{ fontSize: 12, color: '#ffb347' }}>
                  Showing a realistic 50K subscriber Indian creator channel. All numbers are simulated.
                </div>
              </div>
            </div>
            <button
              onClick={() => setDemoMode(false)}
              style={{
                background: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px',
                fontSize: 13, fontWeight: 800, color: '#8b1a00', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              ✕ Exit Demo
            </button>
          </div>
        )}

        {/* Prominent "Try Demo" invite banner — shown when NOT in demo mode */}
        {!demoMode && (
          <div style={{
            background: 'linear-gradient(135deg, #1a0800 0%, #2d0d00 50%, #1a0005 100%)',
            border: '1px solid #ff660033',
            borderRadius: 12, padding: '18px 24px', marginBottom: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 32, flexShrink: 0 }}>🎭</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#ff9955', marginBottom: 4 }}>
                  Want to see what a real creator's dashboard looks like?
                </div>
                <div style={{ fontSize: 13, color: '#886655', lineHeight: 1.6 }}>
                  Explore every tab with realistic data from a 50K subscriber Indian YouTube channel — no login required.
                </div>
              </div>
            </div>
            <button
              onClick={() => setDemoMode(true)}
              style={{
                background: 'linear-gradient(135deg, #ff6600, #cc2200)',
                border: 'none', borderRadius: 10,
                padding: '13px 28px', fontSize: 14, fontWeight: 800,
                color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
                boxShadow: '0 0 20px #ff660044',
              }}
            >
              🚀 Launch Demo Mode
            </button>
          </div>
        )}

        {/* Page Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {activeProfile?.thumbnail && (
              <img
                src={activeProfile.thumbnail}
                alt={activeProfile.title}
                style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid #7c4dff44', objectFit: 'cover' }}
              />
            )}
            {demoMode && (
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#ff990033', border: '2px solid #ff990066', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                🎬
              </div>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h1 style={{ fontSize: 20, fontWeight: 900, color: '#fff', margin: 0, lineHeight: 1.2 }}>{activeProfile?.title || 'My Channel'}</h1>
                {demoMode && <span style={{ fontSize: 10, background: '#ff990033', border: '1px solid #ff990055', borderRadius: 4, padding: '2px 7px', color: '#ff9900', fontWeight: 700 }}>DEMO</span>}
              </div>
              <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                {fmt(totalSubs)} subscribers · {fmt(activeProfile?.videoCount)} videos
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {remainingCalls && (
              <div style={{ fontSize: 11, color: '#7c4dff', background: '#7c4dff11', border: '1px solid #7c4dff22', borderRadius: 20, padding: '4px 12px' }}>
                🔮 {remainingCalls()} AI calls left
              </div>
            )}
            {!demoMode && (
              <>
                <button
                  onClick={refreshData}
                  style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 6, padding: '7px 14px', fontSize: 12, color: '#888', cursor: 'pointer' }}
                >
                  ↺ Refresh
                </button>
                <button
                  onClick={onDisconnect}
                  style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 6, padding: '7px 14px', fontSize: 12, color: '#888', cursor: 'pointer' }}
                >
                  Disconnect
                </button>
              </>
            )}
            {demoMode && (
              <button
                onClick={() => setDemoMode(false)}
                style={{ background: '#7c4dff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer' }}
              >
                🔗 Connect Real Channel
              </button>
            )}
          </div>
        </div>

        {/* Day Range Selector */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {DAYS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              style={{ background: days === opt.value ? '#7c4dff22' : '#111', border: `1px solid ${days === opt.value ? '#7c4dff' : '#1e1e1e'}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: days === opt.value ? 700 : 400, color: days === opt.value ? '#b39ddb' : '#666', cursor: 'pointer' }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Tab Bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
          {TABS.map(tab => {
            const locked = tab.req && !meetsRequirement(tier, tab.req);
            return (
              <button
                key={tab.id}
                onClick={() => locked ? onUpgrade?.() : setActiveTab(tab.id)}
                style={{
                  background: activeTab === tab.id ? '#7c4dff22' : '#111',
                  border: `1px solid ${activeTab === tab.id ? '#7c4dff' : '#1e1e1e'}`,
                  borderRadius: 6, padding: '7px 14px', fontSize: 12,
                  fontWeight: activeTab === tab.id ? 700 : 400,
                  color: locked ? '#333' : activeTab === tab.id ? '#b39ddb' : '#666',
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {tab.label}{locked ? ' 🔒' : ''}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        {activeTab === 'overview'     && renderOverview()}
        {activeTab === 'traffic'      && renderTraffic()}
        {activeTab === 'impressions'  && renderImpressions()}
        {activeTab === 'audience'     && renderAudience()}
        {activeTab === 'videos'       && renderVideos()}
        {activeTab === 'subscribers'  && renderSubscribers()}
        {activeTab === 'heatmap'      && renderHeatmap()}
        {activeTab === 'monetization' && renderMonetization()}
        {activeTab === 'growth'       && renderGrowth()}
        {activeTab === 'strategy'     && renderStrategy()}
        {activeTab === 'competitive'  && renderCompetitive()}
        {activeTab === 'ai'           && renderAICoach()}

        <SetupGuide />

        {/* Floating "Try Demo" button — bottom right, only when not in demo mode */}
        {!demoMode && (
          <button
            onClick={() => setDemoMode(true)}
            style={{
              position: 'fixed', bottom: 28, right: 28, zIndex: 200,
              background: 'linear-gradient(135deg, #ff6600, #cc2200)',
              border: 'none', borderRadius: 50, padding: '14px 22px',
              fontSize: 13, fontWeight: 800, color: '#fff', cursor: 'pointer',
              boxShadow: '0 4px 24px #ff660066',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            🎭 Try Demo
          </button>
        )}
      </div>
    </AnalyticsErrorBoundary>
  );
}
