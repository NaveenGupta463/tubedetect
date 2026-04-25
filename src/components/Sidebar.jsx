import { useState } from 'react';
import { meetsRequirement } from '../utils/tierConfig';
import Tooltip from './Tooltip';

const TIER_COLORS = { free: '#666', starter: '#3b82f6', pro: '#f97316', agency: '#22c55e' };
const TIER_LABELS = { free: 'Free', starter: 'Starter', pro: 'Pro', agency: 'Agency' };

// ── Navigation structure ───────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: null,
    items: [
      {
        id: 'dashboard', icon: '🏠', label: 'Dashboard', req: null,
        desc: 'Search channels, find videos, and start your workflow.',
      },
    ],
  },
  {
    label: 'Fix My Video',
    pillar: 'post',
    desc: 'Posted already? Diagnose performance and improve.',
    items: [
      {
        id: 'analyze', icon: '🎬', label: 'Analyze Video', req: null, needsChannel: true,
        desc: 'Deep AI analysis — engagement, SEO, hook strength, viral score, insight modes.',
      },
      {
        id: 'improve', icon: '✨', label: 'Rewrites & Fixes', req: null, needsChannel: true,
        desc: 'AI title rewrites, hook scripts, thumbnail ideas, and CTAs from your video analysis.',
      },
      {
        id: 'sentiment', icon: '💬', label: 'Comment Insights', req: 'starter', needsChannel: true,
        desc: 'AI reads top comments to extract audience emotion, complaints, and content ideas.',
      },
    ],
  },
  {
    label: 'Plan My Video',
    pillar: 'pre',
    desc: "Haven't posted yet? Research, build, and validate.",
    items: [
      {
        id: 'trends', icon: '🔥', label: 'Niche Trends', req: 'starter',
        desc: 'Scan trending videos in any niche — find content gaps and untapped video ideas.',
      },
      {
        id: 'viral', icon: '🧬', label: 'Viral Formula', req: 'starter',
        desc: 'Reverse-engineer why a video went viral — hook, title psychology, thumbnail strategy.',
      },
      {
        id: 'competitor', icon: '⚔️', label: 'Competitor Research', req: 'starter', needsChannel: true,
        desc: 'Benchmark your channel against competitors — gaps, strengths, and opportunities.',
      },
      {
        id: 'script', icon: '✍️', label: 'Script Generator', req: 'starter',
        desc: 'AI writes a full video script with hook, chapters, and CTA from your topic.',
      },
      {
        id: 'scorer', icon: '⚡', label: 'Idea Scorer', req: 'starter',
        desc: 'Score your title and thumbnail — CTR potential, scroll stop power, improved alternatives.',
      },
      {
        id: 'seo', icon: '🏷️', label: 'SEO & Tags', req: null, needsChannel: true,
        desc: 'Analyze tags, find keyword gaps, and get SEO recommendations before publishing.',
      },
      {
        id: 'validator', icon: '🚀', label: 'Pre-Publish Validator', req: null,
        desc: 'Final gate — AI scores your video across 8 dimensions and gives a launch decision.',
        capstone: true,
      },
    ],
  },
  {
    label: 'My Channel',
    items: [
      {
        id: 'myanalytics', icon: '📊', label: 'My Analytics', req: 'pro', oauthRequired: true,
        desc: 'Connect Google to see private YouTube Analytics — watch time, impressions, CTR, revenue.',
      },
    ],
  },
  {
    label: 'Account',
    items: [
      {
        id: 'workspaces', icon: '💾', label: 'Workspaces', req: null,
        desc: 'Save and reload channel + competitor setups instantly without re-searching.',
      },
      {
        id: 'pricing', icon: '💎', label: 'Upgrade Plan', req: null,
        desc: 'View plans and unlock AI tools, competitor analysis, PDF reports, and more.',
      },
    ],
  },
];

const PILLAR_COLORS = {
  post: { accent: '#7c4dff', bg: '#7c4dff' },
  pre:  { accent: '#00b894', bg: '#00b894' },
};

// ── Component ──────────────────────────────────────────────────────────────────
export default function Sidebar({ activeView, onNavigate, hasChannel, tier, isOAuthConnected }) {
  const tierColor = TIER_COLORS[tier] || '#666';

  const normalizedView = {
    search:   'dashboard',
    channel:  'dashboard',
    discover: 'dashboard',
    video:    'analyze',
  }[activeView] ?? activeView;

  const [collapsed, setCollapsed] = useState({ 'Fix My Video': false, 'Plan My Video': false });
  const toggleGroup = (label) => setCollapsed(prev => ({ ...prev, [label]: !prev[label] }));

  return (
    <aside className="sidebar">

      {/* Logo */}
      <button className="sidebar-logo" onClick={() => onNavigate('dashboard')}>
        <svg width="22" height="22" viewBox="0 0 24 24">
          <rect x="2" y="4" width="20" height="16" rx="3" fill="none" stroke="#ff0000" strokeWidth="2" />
          <path d="M10 8l6 4-6 4V8z" fill="#ff0000" />
        </svg>
        <span className="sidebar-logo-text">TubeIntel</span>
      </button>

      {/* Tier badge */}
      <div className="sidebar-tier" style={{ borderColor: tierColor + '44', background: tierColor + '11' }}>
        <span style={{ color: tierColor, fontWeight: 700, fontSize: 12 }}>
          {TIER_LABELS[tier] ?? 'Free'} Plan
        </span>
        {(tier === 'free') && (
          <button className="sidebar-upgrade-btn" onClick={() => onNavigate('pricing')}>
            Upgrade
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        {NAV_GROUPS.map(group => {
          const visibleItems = group.items;
          if (!visibleItems.length) return null;

          const collapsible = !!group.pillar;
          const isCollapsed = collapsible && collapsed[group.label];
          const pillarColor = group.pillar ? PILLAR_COLORS[group.pillar] : null;

          return (
            <div key={group.label ?? '__root'} className="sidebar-group">
              {group.label && (
                <div
                  className="sidebar-group-label"
                  onClick={collapsible ? () => toggleGroup(group.label) : undefined}
                  style={collapsible ? {
                    cursor: 'pointer', userSelect: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    borderLeft: `3px solid ${pillarColor.accent}44`,
                    paddingLeft: 8, marginLeft: -8,
                  } : {}}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={pillarColor ? { color: pillarColor.accent, fontWeight: 800 } : {}}>
                      {group.label}
                    </span>
                    {group.desc && !isCollapsed && (
                      <span style={{ fontSize: 10, color: '#444', fontWeight: 400, lineHeight: 1.3 }}>
                        {group.desc}
                      </span>
                    )}
                  </div>
                  {collapsible && (
                    <span style={{ fontSize: 10, color: '#444', display: 'inline-block', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}>▾</span>
                  )}
                </div>
              )}

              {!isCollapsed && visibleItems.map((item, idx) => {
                const locked       = item.req && !meetsRequirement(tier, item.req);
                const needsChannel = item.needsChannel && !hasChannel;
                const active       = normalizedView === item.id;
                const isCapstone   = item.capstone && !locked;
                const isLastInPillar = item.capstone;
                const disabled     = locked || needsChannel;

                const classes = [
                  'nav-item',
                  active    ? 'nav-item-active' : '',
                  locked    ? 'nav-item-locked' : '',
                  needsChannel && !locked ? 'nav-item-locked' : '',
                ].filter(Boolean).join(' ');

                const tooltipDesc = locked
                  ? `Requires ${item.req} plan. ${item.desc}`
                  : needsChannel
                  ? `Search a channel first. ${item.desc}`
                  : item.desc;

                return (
                  <div key={item.id}>
                    {isLastInPillar && visibleItems.length > 1 && (
                      <div style={{ height: 1, background: '#1e1e1e', margin: '6px 0' }} />
                    )}
                    <Tooltip
                      title={item.label}
                      desc={tooltipDesc}
                      placement="right"
                    >
                      <button
                        className={classes}
                        onClick={() => !disabled && onNavigate(item.id)}
                        style={isCapstone ? {
                          borderColor: '#00b89444',
                          background: active ? '#00b89422' : '#00b89411',
                        } : {}}
                      >
                        <span className="nav-icon">{item.icon}</span>
                        <span className="nav-label">{item.label}</span>

                        {locked && (
                          <span className="nav-lock">
                            {item.req === 'agency' ? 'Agency' : item.req === 'pro' ? 'Pro' : 'Starter'}
                          </span>
                        )}
                        {!locked && needsChannel && (
                          <span className="nav-lock" style={{ background: '#1a1a1a', color: '#444', borderColor: '#2a2a2a' }}>
                            Channel
                          </span>
                        )}

                        {!locked && item.oauthRequired && isOAuthConnected && (
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                        )}

                        {item.id === 'myanalytics' && (
                          <span
                            onClick={e => {
                              e.stopPropagation();
                              try { sessionStorage.setItem('tubeintel_launch_demo', '1'); } catch {}
                              onNavigate('myanalytics');
                            }}
                            style={{
                              fontSize: 9, fontWeight: 800, background: '#f9731699',
                              color: '#fff', borderRadius: 4, padding: '2px 5px',
                              cursor: 'pointer', flexShrink: 0, letterSpacing: 0.3,
                            }}
                          >
                            DEMO
                          </span>
                        )}

                        {isCapstone && (
                          <span style={{
                            fontSize: 8, fontWeight: 800,
                            background: '#00b89433', color: '#00b894',
                            borderRadius: 4, padding: '2px 6px',
                            flexShrink: 0, letterSpacing: 0.4,
                          }}>
                            GATE
                          </span>
                        )}
                      </button>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <span className="sidebar-footer-text">YouTube Data API v3</span>
      </div>
    </aside>
  );
}
