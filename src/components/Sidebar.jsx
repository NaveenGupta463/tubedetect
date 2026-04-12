import { useState } from 'react';
import { meetsRequirement } from '../utils/tierConfig';
import Tooltip from './Tooltip';

const TIER_COLORS = { free: '#666', starter: '#3b82f6', pro: '#f97316', agency: '#22c55e' };
const TIER_LABELS = { free: 'Free', starter: 'Starter', pro: 'Pro', agency: 'Agency' };

// ── Navigation structure ───────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: 'Core',
    items: [
      {
        id: 'discover', icon: '🔍', label: 'Discover', req: null,
        desc: 'Search any YouTube channel by @handle, name, or URL. Includes competitor comparison.',
      },
      {
        id: 'analyze', icon: '🎬', label: 'Analyze Video', req: null, needsChannel: true,
        desc: 'Browse channel videos and run deep AI analysis — engagement, SEO, hook strength, viral score.',
        primary: true,
      },
      {
        id: 'improve', icon: '✨', label: 'Fix My Video', req: null, needsChannel: true,
        desc: 'AI-generated title rewrites, hook scripts, and CTAs based on your video\'s deep analysis.',
        highlight: true,
      },
    ],
  },
  {
    label: 'AI Studio',
    items: [
      {
        id: 'validator', icon: '🚀', label: 'Pre-Publish Validator', req: 'starter',
        desc: 'Paste title, description, and tags before publishing. AI scores it and predicts CTR and performance.',
      },
      {
        id: 'scorer', icon: '⚡', label: 'Idea Scorer', req: 'starter',
        desc: 'Validate your video idea before filming. AI scores CTR potential, scroll stop power, and gives improved titles.',
      },
      {
        id: 'script', icon: '✍️', label: 'Script Generator', req: 'starter',
        desc: 'Enter a topic and tone. AI writes a full video script with hook, chapters, and CTA.',
      },
      {
        id: 'viral', icon: '🧬', label: 'Viral Formula', req: 'starter',
        desc: 'AI reverse-engineers why a video went viral — hook, title psychology, thumbnail strategy.',
      },
    ],
  },
  {
    label: 'Growth Insights',
    items: [
      {
        id: 'timing', icon: '⏰', label: 'Best Time to Post', req: null, needsChannel: true,
        desc: 'Analyzes upload history to find which days and times historically get the most views.',
      },
      {
        id: 'cadence', icon: '📅', label: 'Upload Cadence', req: null, needsChannel: true,
        desc: 'Upload frequency trends and how consistency affects channel performance.',
      },
      {
        id: 'trends', icon: '🔥', label: 'Niche Trends', req: 'starter',
        desc: 'AI scans trending videos in any niche and surfaces content gaps and specific video ideas.',
      },
      {
        id: 'sentiment', icon: '💬', label: 'Comment Insights', req: 'starter',
        desc: 'AI reads top comments to extract audience emotion, complaints, and video ideas your viewers want.',
      },
    ],
  },
  {
    label: 'My Channel',
    items: [
      {
        id: 'myanalytics', icon: '📊', label: 'My Analytics', req: 'pro', oauthRequired: true,
        desc: 'Connect your Google account to see private YouTube Analytics — watch time, impressions, CTR, revenue.',
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
        id: 'report', icon: '📄', label: 'PDF Report', req: 'starter',
        desc: 'Generate a branded PDF report of channel analytics — ideal for client presentations.',
      },
      {
        id: 'pricing', icon: '💎', label: 'Upgrade Plan', req: null,
        desc: 'View plans and unlock AI tools, competitor analysis, PDF reports, and more.',
      },
    ],
  },
];

// ── Component ──────────────────────────────────────────────────────────────────
export default function Sidebar({ activeView, onNavigate, hasChannel, tier, isOAuthConnected }) {
  const tierColor = TIER_COLORS[tier] || '#666';

  // Normalize: map old view IDs to new ones so active state works for both
  const normalizedView = { search: 'discover', channel: 'discover', video: 'analyze' }[activeView] ?? activeView;
  const [collapsed, setCollapsed] = useState({ 'AI Studio': true, 'Growth Insights': true });
  const toggleGroup = (label) => setCollapsed(prev => ({ ...prev, [label]: !prev[label] }));

  return (
    <aside className="sidebar">

      {/* Logo */}
      <button className="sidebar-logo" onClick={() => onNavigate('discover')}>
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
          const visibleItems = group.items.filter(item => {
            if (item.needsChannel && !hasChannel) return false;
            return true;
          });
          if (!visibleItems.length) return null;
          const collapsible = group.label === 'AI Studio' || group.label === 'Growth Insights';
          const isCollapsed = collapsible && collapsed[group.label];

          return (
            <div key={group.label} className="sidebar-group">
              <div
                className="sidebar-group-label"
                onClick={collapsible ? () => toggleGroup(group.label) : undefined}
                style={collapsible ? { cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } : {}}
              >
                <span>{group.label}</span>
                {collapsible && (
                  <span style={{ fontSize: 10, color: '#444', display: 'inline-block', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▾</span>
                )}
              </div>

              {!isCollapsed && visibleItems.map(item => {
                const locked  = item.req && !meetsRequirement(tier, item.req);
                const active  = normalizedView === item.id;
                const classes = [
                  'nav-item',
                  active   ? 'nav-item-active'    : '',
                  locked   ? 'nav-item-locked'    : '',
                  item.highlight ? 'nav-item-highlight' : '',
                ].filter(Boolean).join(' ');

                return (
                  <Tooltip
                    key={item.id}
                    title={item.label}
                    desc={locked ? `Requires ${item.req} plan. ${item.desc}` : item.desc}
                    placement="right"
                  >
                    <button
                      className={classes}
                      onClick={() => onNavigate(item.id)}
                    >
                      <span className="nav-icon">{item.icon}</span>
                      <span className="nav-label">{item.label}</span>

                      {/* Tier lock badge */}
                      {locked && (
                        <span className="nav-lock">
                          {item.req === 'agency' ? 'Agency' : item.req === 'pro' ? 'Pro' : 'Starter'}
                        </span>
                      )}

                      {/* OAuth connected dot */}
                      {!locked && item.oauthRequired && isOAuthConnected && (
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                      )}

                      {/* My Analytics demo badge */}
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

                      {/* New badge on Fix My Video */}
                      {item.id === 'improve' && !locked && (
                        <span style={{
                          fontSize: 8, fontWeight: 800, background: '#7c3aed99',
                          color: '#e9d5ff', borderRadius: 4, padding: '2px 5px',
                          flexShrink: 0, letterSpacing: 0.3,
                        }}>
                          NEW
                        </span>
                      )}
                    </button>
                  </Tooltip>
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
