import { meetsRequirement } from '../utils/tierConfig';

const TIER_COLORS = { free: '#888', pro: '#ff9100', agency: '#00c853' };
const TIER_LABELS = { free: 'Free', pro: 'Pro', agency: 'Agency' };

const NAV_GROUPS = [
  {
    label: 'Core',
    items: [
      { id: 'search',  icon: '🔍', label: 'Channel Search', req: null },
      { id: 'channel', icon: '📺', label: 'Channel Overview', req: null },
      { id: 'video',   icon: '🎬', label: 'Video Analysis',  req: null },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { id: 'timing',   icon: '⏰', label: 'Best Time to Post', req: null },
      { id: 'cadence',  icon: '📅', label: 'Upload Cadence',    req: null },
      { id: 'seo',      icon: '🏷️', label: 'SEO Tag Analyzer',  req: null },
      { id: 'competitor',icon: '⚔️', label: 'Competitor Compare', req: 'pro' },
    ],
  },
  {
    label: 'AI Tools',
    items: [
      { id: 'validator', icon: '🚀', label: 'Pre-Publish Validator', req: 'pro' },
      { id: 'viral',     icon: '🧬', label: 'Viral Formula',         req: 'pro' },
      { id: 'scorer',    icon: '🎯', label: 'Title Scorer',           req: 'pro' },
      { id: 'sentiment', icon: '💬', label: 'Comment Sentiment',      req: 'pro' },
      { id: 'script',    icon: '✍️', label: 'Script Generator',       req: 'pro' },
      { id: 'trends',    icon: '🔥', label: 'Niche Trends',           req: 'pro' },
    ],
  },
  {
    label: 'My Analytics',
    items: [
      { id: 'myanalytics', icon: '📊', label: 'My Channel Analytics', req: 'pro', oauthRequired: true },
    ],
  },
  {
    label: 'Account',
    items: [
      { id: 'workspaces', icon: '💾', label: 'Workspaces', req: null },
      { id: 'report',     icon: '📄', label: 'PDF Report',  req: 'pro' },
      { id: 'pricing',    icon: '💎', label: 'Pricing',     req: null },
    ],
  },
];

export default function Sidebar({ activeView, onNavigate, hasChannel, tier, isOAuthConnected }) {
  const tierColor = TIER_COLORS[tier] || '#888';

  return (
    <aside className="sidebar">
      {/* Logo */}
      <button className="sidebar-logo" onClick={() => onNavigate('search')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="#ff0000">
          <path d="M10 8l6 4-6 4V8z" />
          <rect x="2" y="4" width="20" height="16" rx="3" fill="none" stroke="#ff0000" strokeWidth="2" />
        </svg>
        <span className="sidebar-logo-text">TubeIntel</span>
      </button>

      {/* Tier Badge */}
      <div className="sidebar-tier" style={{ borderColor: tierColor + '44', background: tierColor + '11' }}>
        <span style={{ color: tierColor, fontWeight: 700, fontSize: 12 }}>
          {TIER_LABELS[tier]} Plan
        </span>
        {tier === 'free' && (
          <button className="sidebar-upgrade-btn" onClick={() => onNavigate('pricing')}>
            Upgrade
          </button>
        )}
      </div>

      {/* Nav Groups */}
      <nav className="sidebar-nav">
        {NAV_GROUPS.map(group => {
          const visibleItems = group.items.filter(item => {
            if ((item.id === 'channel' || item.id === 'video') && !hasChannel) return false;
            return true;
          });
          if (!visibleItems.length) return null;

          return (
            <div key={group.label} className="sidebar-group">
              <div className="sidebar-group-label">{group.label}</div>
              {visibleItems.map(item => {
                const locked = item.req && !meetsRequirement(tier, item.req);
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    className={`nav-item ${active ? 'nav-item-active' : ''} ${locked ? 'nav-item-locked' : ''}`}
                    onClick={() => onNavigate(item.id)}
                    title={locked ? `Requires ${item.req} plan` : item.label}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span className="nav-label">{item.label}</span>
                    {locked && (
                      <span className="nav-lock">
                        {item.req === 'agency' ? 'Agency' : 'Pro'}
                      </span>
                    )}
                    {!locked && item.oauthRequired && isOAuthConnected && (
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#00c853', flexShrink: 0 }} />
                    )}
                    {item.id === 'myanalytics' && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          try { sessionStorage.setItem('tubeintel_launch_demo', '1'); } catch {}
                          onNavigate('myanalytics');
                        }}
                        title="Try Demo Mode"
                        style={{
                          fontSize: 9, fontWeight: 800, background: '#ff6600cc',
                          color: '#fff', borderRadius: 4, padding: '2px 5px',
                          cursor: 'pointer', flexShrink: 0, letterSpacing: 0.3,
                        }}
                      >
                        DEMO
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="sidebar-footer">
        <span className="sidebar-footer-text">YouTube Data API v3</span>
      </div>
    </aside>
  );
}
