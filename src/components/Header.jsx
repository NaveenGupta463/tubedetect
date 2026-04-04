const TIER_COLORS = { free: '#888', pro: '#ff9100', agency: '#00c853' };
const TIER_LABELS = { free: 'Free', pro: 'Pro', agency: 'Agency' };

const VIEW_LABELS = {
  search:      'Channel Search',
  channel:     'Channel Overview',
  video:       'Video Analysis',
  timing:      'Best Time to Post',
  cadence:     'Upload Cadence',
  seo:         'SEO Tag Analyzer',
  competitor:  'Competitor Comparison',
  viral:       'Viral Formula Decoder',
  scorer:      'Title & Thumbnail Scorer',
  sentiment:   'Comment Sentiment Miner',
  script:      'Script Outline Generator',
  trends:      'Niche Trend Scanner',
  validator:   'Pre-Publish Validator',
  myanalytics: 'My Channel Analytics',
  workspaces:  'Workspaces',
  report:      'PDF Report',
  pricing:     'Pricing',
};

export default function Header({ channel, tier, activeView, onNavigate, oauthProfile, onConnect, onDisconnect }) {
  const tierColor = TIER_COLORS[tier] || '#888';

  return (
    <header className="header">
      <div className="header-inner">
        <div className="header-left">
          <div className="header-breadcrumb">
            <span className="header-breadcrumb-root" onClick={() => onNavigate('search')}>
              TubeIntel
            </span>
            <span className="header-breadcrumb-sep">›</span>
            <span className="header-breadcrumb-current">{VIEW_LABELS[activeView] || activeView}</span>
          </div>
          {channel && activeView !== 'search' && activeView !== 'myanalytics' && (
            <div className="header-channel-pill">
              {channel.snippet?.thumbnails?.default?.url && (
                <img src={channel.snippet.thumbnails.default.url} className="header-avatar" alt="" />
              )}
              <span className="header-channel-name">{channel.snippet?.title}</span>
            </div>
          )}
        </div>
        <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* OAuth status */}
          {oauthProfile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#00c85311', border: '1px solid #00c85333', borderRadius: 20, padding: '4px 10px 4px 6px', cursor: 'pointer' }} onClick={onDisconnect} title="Click to disconnect">
              {oauthProfile.thumbnail && (
                <img src={oauthProfile.thumbnail} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />
              )}
              <span style={{ fontSize: 11, fontWeight: 700, color: '#00c853' }}>Connected</span>
            </div>
          ) : (
            <button
              onClick={onConnect}
              style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700, color: '#888', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              🔗 Connect Channel
            </button>
          )}
          <span
            className="header-tier-badge"
            style={{ background: tierColor + '18', color: tierColor, borderColor: tierColor + '40' }}
          >
            {TIER_LABELS[tier]}
          </span>
        </div>
      </div>
    </header>
  );
}
