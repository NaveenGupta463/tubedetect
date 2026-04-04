import { useState, useEffect } from 'react';
import { TIER_LIMITS } from '../utils/tierConfig';
import { formatNum } from '../utils/analysis';

const WS_KEY = 'yta_workspaces';

function loadAll() {
  try { return JSON.parse(localStorage.getItem(WS_KEY) || '[]'); } catch { return []; }
}
function saveAll(ws) {
  // Slim down video data before storing
  const slim = ws.map(w => ({
    ...w,
    primary: w.primary ? {
      ...w.primary,
      videos: (w.primary.videos || []).map(v => ({
        id: v.id,
        snippet: { title: v.snippet?.title, publishedAt: v.snippet?.publishedAt, thumbnails: { default: v.snippet?.thumbnails?.default }, tags: v.snippet?.tags },
        statistics: v.statistics,
        contentDetails: { duration: v.contentDetails?.duration },
      })),
    } : null,
    competitors: (w.competitors || []).map(c => ({
      ...c,
      videos: (c.videos || []).map(v => ({
        id: v.id,
        snippet: { title: v.snippet?.title, publishedAt: v.snippet?.publishedAt, thumbnails: { default: v.snippet?.thumbnails?.default } },
        statistics: v.statistics,
        contentDetails: { duration: v.contentDetails?.duration },
      })),
    })),
  }));
  localStorage.setItem(WS_KEY, JSON.stringify(slim));
}

export default function SavedWorkspaces({ tier, channel, videos, competitors, onLoadWorkspace }) {
  const [workspaces, setWorkspaces] = useState(loadAll);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [saved, setSaved] = useState(false);

  const limit = TIER_LIMITS[tier]?.workspaces ?? 1;

  const handleSave = () => {
    if (!channel) return;
    const existing = workspaces.find(w => w.primary?.channelId === channel.id);
    let updated;
    if (existing) {
      updated = workspaces.map(w => w.id === existing.id ? {
        ...w,
        updatedAt: new Date().toISOString(),
        primary: { channelId: channel.id, channelData: channel, videos },
        competitors: competitors || [],
      } : w);
    } else {
      if (workspaces.length >= limit) {
        alert(`Your ${tier} plan supports up to ${limit} workspace${limit > 1 ? 's' : ''}. Delete one or upgrade.`);
        return;
      }
      const newWs = {
        id: 'ws_' + Date.now(),
        name: channel.snippet?.title || 'Workspace',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        primary: { channelId: channel.id, channelData: channel, videos },
        competitors: competitors || [],
      };
      updated = [...workspaces, newWs];
    }
    setWorkspaces(updated);
    saveAll(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDelete = (id) => {
    const updated = workspaces.filter(w => w.id !== id);
    setWorkspaces(updated);
    saveAll(updated);
  };

  const handleRename = (id) => {
    const updated = workspaces.map(w => w.id === id ? { ...w, name: editName } : w);
    setWorkspaces(updated);
    saveAll(updated);
    setEditId(null);
  };

  const handleLoad = (ws) => {
    if (ws.primary) onLoadWorkspace(ws);
  };

  return (
    <div className="feature-page">
      <div className="feature-header">
        <h2 className="feature-title">💾 Saved Workspaces</h2>
        <p className="feature-desc">
          Save channel contexts and switch between them instantly.
          <span className="tip-badge">{workspaces.length} / {limit} used</span>
        </p>
      </div>

      {channel && (
        <div className="chart-card">
          <h3 className="chart-title">Save Current Channel</h3>
          <div className="ws-save-row">
            <div className="ws-current-info">
              {channel.snippet?.thumbnails?.default?.url && (
                <img src={channel.snippet.thumbnails.default.url} className="ws-avatar" alt="" />
              )}
              <div>
                <div style={{ fontWeight: 700 }}>{channel.snippet?.title}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{videos.length} videos loaded · {competitors?.length || 0} competitors</div>
              </div>
            </div>
            <button
              className={`btn-primary ${saved ? 'btn-success' : ''}`}
              onClick={handleSave}
            >
              {saved ? '✅ Saved!' : '💾 Save Workspace'}
            </button>
          </div>
        </div>
      )}

      {workspaces.length === 0 ? (
        <div className="empty-state-card">
          <div style={{ fontSize: 32, marginBottom: 10 }}>📂</div>
          <div>No saved workspaces yet.</div>
          <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>
            Load a channel and click "Save Workspace" above.
          </div>
        </div>
      ) : (
        <div className="ws-list">
          {workspaces.map(ws => {
            const ch = ws.primary?.channelData;
            const subs = ch?.statistics?.subscriberCount;
            return (
              <div key={ws.id} className="ws-card">
                <div className="ws-card-left">
                  {ch?.snippet?.thumbnails?.default?.url && (
                    <img src={ch.snippet.thumbnails.default.url} className="ws-avatar" alt="" />
                  )}
                  <div className="ws-card-info">
                    {editId === ws.id ? (
                      <div className="ws-edit-row">
                        <input
                          className="search-filter"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleRename(ws.id)}
                          autoFocus
                          style={{ padding: '4px 10px', fontSize: 13 }}
                        />
                        <button className="btn-small btn-primary" onClick={() => handleRename(ws.id)}>Save</button>
                        <button className="btn-small" onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div
                        className="ws-name"
                        onDoubleClick={() => { setEditId(ws.id); setEditName(ws.name); }}
                        title="Double-click to rename"
                      >
                        {ws.name}
                      </div>
                    )}
                    <div className="ws-meta">
                      {subs && !ch?.statistics?.hiddenSubscriberCount && <span>{formatNum(subs)} subs</span>}
                      <span>{ws.primary?.videos?.length || 0} videos</span>
                      {ws.competitors?.length > 0 && <span>{ws.competitors.length} competitor{ws.competitors.length > 1 ? 's' : ''}</span>}
                      <span>Updated {new Date(ws.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <div className="ws-card-actions">
                  <button className="btn-small btn-primary" onClick={() => handleLoad(ws)}>Load</button>
                  <button className="btn-small btn-ghost" onClick={() => { setEditId(ws.id); setEditName(ws.name); }}>Rename</button>
                  <button className="btn-small btn-danger" onClick={() => handleDelete(ws.id)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="ts-note" style={{ marginTop: 12 }}>
        <span>ℹ️</span>
        Workspaces are stored in your browser's localStorage. Clearing browser data will erase them.
        {tier === 'free' && ' Upgrade to Pro for up to 6 workspaces.'}
      </div>
    </div>
  );
}
