import { useState, useEffect } from 'react';
import { TIER_LIMITS } from '../utils/tierConfig';
import { formatNum } from '../utils/analysis';
import * as scoring from '../api/scoringApi';
import * as storage from '../utils/storage';

function slimVideos(videos) {
  return (videos || []).map(v => ({
    id: v.id,
    snippet: {
      title:       v.snippet?.title,
      publishedAt: v.snippet?.publishedAt,
      thumbnails:  { default: v.snippet?.thumbnails?.default },
      tags:        v.snippet?.tags,
    },
    statistics:     v.statistics,
    contentDetails: { duration: v.contentDetails?.duration },
  }));
}

function slimCompetitorVideos(videos) {
  return (videos || []).map(v => ({
    id: v.id,
    snippet: {
      title:       v.snippet?.title,
      publishedAt: v.snippet?.publishedAt,
      thumbnails:  { default: v.snippet?.thumbnails?.default },
    },
    statistics:     v.statistics,
    contentDetails: { duration: v.contentDetails?.duration },
  }));
}

function buildPayload(channel, videos, competitors) {
  return {
    primary: {
      channelId:   channel.id,
      channelData: channel,
      videos:      slimVideos(videos),
    },
    competitors: (competitors || []).map(c => ({
      ...c,
      videos: slimCompetitorVideos(c.videos),
    })),
  };
}

function ScoreChip({ score, decision }) {
  const color = score >= 75 ? '#00b894' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color, background: color + '11', border: `1px solid ${color}33`, borderRadius: 5, padding: '2px 7px' }}>
      {score}/100 {decision}
    </span>
  );
}

export default function SavedWorkspaces({ tier, channel, videos, competitors, onLoadWorkspace, onLoadBrief }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [editId, setEditId]         = useState(null);
  const [editName, setEditName]     = useState('');
  const [saved, setSaved]           = useState(false);
  const [briefs, setBriefs]               = useState(() => storage.getBriefs());
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => { setBriefs(storage.getBriefs()); }, []);

  const limit = TIER_LIMITS[tier]?.workspaces ?? 1;

  useEffect(() => {
    scoring.getWorkspaces()
      .then(setWorkspaces)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!channel) return;
    const existing = workspaces.find(w => w.primary?.channelId === channel.id);
    const now      = new Date().toISOString();
    const { primary, competitors: comps } = buildPayload(channel, videos, competitors);

    if (existing) {
      await scoring.updateWorkspace(existing.id, { name: existing.name, updatedAt: now, primary, competitors: comps });
      setWorkspaces(ws => ws.map(w =>
        w.id === existing.id ? { ...w, updatedAt: now, primary, competitors: comps } : w,
      ));
    } else {
      if (workspaces.length >= limit) {
        alert(`Your ${tier} plan supports up to ${limit} workspace${limit > 1 ? 's' : ''}. Delete one or upgrade.`);
        return;
      }
      const newWs = {
        id:          'ws_' + Date.now(),
        name:        channel.snippet?.title || 'Workspace',
        createdAt:   now,
        updatedAt:   now,
        primary,
        competitors: comps,
      };
      await scoring.saveWorkspace(newWs);
      setWorkspaces(ws => [...ws, newWs]);
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDelete = async (id) => {
    await scoring.deleteWorkspace(id);
    setWorkspaces(ws => ws.filter(w => w.id !== id));
  };

  const handleRename = async (id) => {
    await scoring.updateWorkspace(id, { name: editName, updatedAt: new Date().toISOString() });
    setWorkspaces(ws => ws.map(w => w.id === id ? { ...w, name: editName } : w));
    setEditId(null);
  };

  const handleLoad = (ws) => {
    if (ws.primary) onLoadWorkspace(ws);
  };

  const handleDeleteBrief = (id) => {
    storage.deleteBrief(id);
    setBriefs(storage.getBriefs());
    setDeleteConfirm(null);
  };

  const handleEditBrief = (brief) => {
    if (onLoadBrief) onLoadBrief(brief);
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

      {/* ── Video Briefs ── */}
      <div className="chart-card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: briefs.length ? 16 : 0 }}>
          <h3 className="chart-title" style={{ margin: 0 }}>&#128196; Video Briefs</h3>
          <span style={{ fontSize: 12, color: '#555' }}>{briefs.length} saved</span>
        </div>
        {briefs.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#333', fontSize: 13 }}>
            No video briefs yet. Complete the Wizard to auto-save one here.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {briefs.map(brief => {
              const p         = brief.plan || {};
              const titleObj  = p.brief?.titles?.titles?.[p.brief?.titles?.selectedTitle ?? 0];
              const niche     = p.brief?.niche?.niche;
              const tone      = p.brief?.voice?.tone;
              const score     = p.brief?.validation?.score;
              const decision  = p.brief?.validation?.decision;
              const stepsCount = (p.completedSteps || []).length;
              const isConfirm  = deleteConfirm === brief.id;
              return (
                <div key={brief.id} style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0', marginBottom: 4, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {brief.name || p.topic}
                      </div>
                      {titleObj && (
                        <div style={{ fontSize: 12, color: '#00b894', marginBottom: 8, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {titleObj.title}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {niche && <span style={{ fontSize: 11, color: '#888', background: '#1a1a1a', borderRadius: 5, padding: '2px 7px' }}>{niche}</span>}
                        {tone  && <span style={{ fontSize: 11, color: '#c084fc', background: '#1a0a2e', border: '1px solid #6d28d922', borderRadius: 5, padding: '2px 7px' }}>{tone}</span>}
                        {score != null && <ScoreChip score={score} decision={decision} />}
                        <span style={{ fontSize: 11, color: '#333' }}>{stepsCount}/6 steps &middot; {new Date(brief.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                      {isConfirm ? (
                        <>
                          <span style={{ fontSize: 12, color: '#ef4444', marginRight: 4 }}>Delete?</span>
                          <button className="btn-small btn-danger" onClick={() => handleDeleteBrief(brief.id)}>Yes</button>
                          <button className="btn-small" onClick={() => setDeleteConfirm(null)}>No</button>
                        </>
                      ) : (
                        <>
                          <button className="btn-small btn-primary" onClick={() => handleEditBrief(brief)}>Edit</button>
                          <button className="btn-small btn-danger" onClick={() => setDeleteConfirm(brief.id)}>Delete</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
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

      {loading ? (
        <div className="empty-state-card">
          <div style={{ fontSize: 13, color: '#666' }}>Loading workspaces…</div>
        </div>
      ) : workspaces.length === 0 ? (
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
            const ch   = ws.primary?.channelData;
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
        Workspaces are stored in the local database and persist across sessions.
        {tier === 'free' && ' Upgrade to Pro for up to 6 workspaces.'}
      </div>
    </div>
  );
}
