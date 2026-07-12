import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3002/api' : '/api';

function fmtDate(d) {
  if (!d) return '';
  const diff = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return '1d ago';
  if (diff < 7)  return `${diff}d ago`;
  return `${Math.floor(diff / 7)}w ago`;
}

function TopicPill({ topic, stat, statLabel, color }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px',
      background: '#0e0e0e', border: '1px solid #1c1c1c', borderRadius: 8,
    }}>
      <span style={{ fontSize: 13, color: '#d0d0d0', fontWeight: 500 }}>{topic}</span>
      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color }}>{stat}</div>
        <div style={{ fontSize: 10, color: '#444', marginTop: 1 }}>{statLabel}</div>
      </div>
    </div>
  );
}

function VideoRow({ video }) {
  return (
    <div style={{
      padding: '10px 14px',
      background: '#0e0e0e', border: '1px solid #1c1c1c', borderRadius: 8,
    }}>
      <div style={{ fontSize: 13, color: '#d8d8d8', lineHeight: 1.4, marginBottom: 6 }}>
        {video.title}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600 }}>{video.views} views</span>
        <span style={{ fontSize: 11, color: '#333' }}>{video.channel_name}</span>
        <span style={{ fontSize: 11, color: '#2a2a2a', marginLeft: 'auto' }}>{fmtDate(video.date)}</span>
      </div>
    </div>
  );
}

function Section({ title, badge, badgeColor, subtitle, topics, videos, topicStatLabel, topicColor, emptyMsg }) {
  const [view, setView] = useState('topics');

  return (
    <div style={{ flex: '1 1 380px', minWidth: 320 }}>
      {/* Section header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#f0f0f0' }}>{title}</span>
          {badge && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              background: badgeColor + '22', color: badgeColor,
              borderRadius: 4, padding: '2px 7px',
            }}>{badge}</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#444' }}>{subtitle}</div>
      </div>

      {/* Toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {['topics', 'videos'].map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              background: view === v ? '#1a1a1a' : 'transparent',
              border: `1px solid ${view === v ? '#333' : '#1a1a1a'}`,
              color: view === v ? '#d0d0d0' : '#444',
              borderRadius: 6, padding: '5px 12px', fontSize: 11,
              cursor: 'pointer', textTransform: 'capitalize',
            }}
          >{v}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {view === 'topics' && (
          topics.length > 0
            ? topics.map((t, i) => (
                <TopicPill
                  key={i}
                  topic={t.topic}
                  stat={t.avg_views}
                  statLabel={topicStatLabel}
                  color={topicColor}
                />
              ))
            : <div style={{ color: '#333', fontSize: 13, padding: '12px 0' }}>{emptyMsg}</div>
        )}
        {view === 'videos' && (
          videos.length > 0
            ? videos.map((v, i) => <VideoRow key={i} video={v} />)
            : <div style={{ color: '#333', fontSize: 13, padding: '12px 0' }}>{emptyMsg}</div>
        )}
      </div>
    </div>
  );
}

export default function WhatToPost({ channel }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const channelId = channel?.channel_id;

  useEffect(() => {
    if (!channelId) return;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/copilot/suggestions/${channelId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [channelId]);

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f0', letterSpacing: '-0.5px', marginBottom: 6 }}>
          What to Post
        </div>
        <div style={{ color: '#555', fontSize: 14 }}>
          Topics and videos gaining traction — in your peer community and across your niche.
        </div>
      </div>

      {!channelId && (
        <div style={{ color: '#444', fontSize: 14, padding: '24px 0' }}>
          Search a channel first to see personalised suggestions.
        </div>
      )}

      {channelId && loading && (
        <div style={{ color: '#444', fontSize: 14, padding: '24px 0' }}>Loading suggestions…</div>
      )}

      {channelId && error && (
        <div style={{ color: '#ef4444', fontSize: 13, padding: '16px 0' }}>Error: {error}</div>
      )}

      {data && (
        <>
          {/* Stats row */}
          <div style={{ display: 'flex', gap: 20, marginBottom: 28, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: '#444' }}>
              <span style={{ color: '#888', fontWeight: 600 }}>{data.peer_pool}</span> community peers
            </div>
            <div style={{ fontSize: 12, color: '#444' }}>
              Niche: <span style={{ color: '#888', fontWeight: 600 }}>{data.niche || '—'}</span>
            </div>
          </div>

          {/* Two-column layout */}
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Section
              title="Your Community"
              badge="Peer Signal"
              badgeColor="#3b82f6"
              subtitle={`What channels your size are covering right now`}
              topics={data.community.topics}
              videos={data.community.hot_videos}
              topicStatLabel="avg views / video"
              topicColor="#3b82f6"
              emptyMsg="Not enough peer data yet."
            />
            <Section
              title="Your Niche"
              badge="Niche-Wide"
              badgeColor="#a855f7"
              subtitle={`What's trending across all ${data.niche || 'niche'} channels`}
              topics={data.niche_wide.topics}
              videos={data.niche_wide.hot_videos}
              topicStatLabel="avg views / video"
              topicColor="#a855f7"
              emptyMsg="Not enough niche data yet."
            />
          </div>

          <div style={{ marginTop: 28, fontSize: 12, color: '#2a2a2a' }}>
            Data from the last 30 days · hot videos from the last 14 days
          </div>
        </>
      )}
    </div>
  );
}
