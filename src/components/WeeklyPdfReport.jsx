import { useState } from 'react';
import { buildChannelReport } from '../utils/pdfBuilder';
import ProGate from './ProGate';
import { formatNum, calcEngagement } from '../utils/analysis';

export default function WeeklyPdfReport({ channel, videos, tier, onUpgrade }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);
  const [error, setError]     = useState('');

  const handleGenerate = async () => {
    if (!channel) { setError('Load a channel first.'); return; }
    setLoading(true);
    setError('');
    setDone(false);
    try {
      buildChannelReport(channel, videos);
      setDone(true);
      setTimeout(() => setDone(false), 4000);
    } catch (e) {
      setError(e.message || 'Failed to generate PDF.');
    } finally {
      setLoading(false);
    }
  };

  const avgEng = videos.length
    ? (videos.reduce((s, v) => s + calcEngagement(v.statistics), 0) / videos.length).toFixed(2)
    : '0';
  const topVideo = [...videos].sort((a, b) =>
    parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0)
  )[0];

  return (
    <ProGate tier={tier} required="pro" onUpgrade={onUpgrade}>
      <div className="feature-page">
        <div className="feature-header">
          <h2 className="feature-title">📄 PDF Channel Report</h2>
          <p className="feature-desc">
            Generate a downloadable PDF report with channel stats, top videos, performance charts, and 5 actionable recommendations.
          </p>
        </div>

        {!channel ? (
          <div className="empty-state-card">
            <div style={{ fontSize: 32, marginBottom: 8 }}>📺</div>
            <div>No channel loaded.</div>
            <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>Load a channel from the Channel Search page first.</div>
          </div>
        ) : (
          <>
            {/* Preview */}
            <div className="chart-card">
              <h3 className="chart-title">Report Preview</h3>
              <div className="pdf-preview">
                <div className="pdf-preview-header">
                  <div className="pdf-preview-logo">TubeIntel</div>
                  <div className="pdf-preview-sub">YouTube Analytics Report</div>
                </div>
                <div className="pdf-preview-body">
                  <div className="pdf-preview-channel">
                    {channel.snippet?.thumbnails?.medium?.url && (
                      <img src={channel.snippet.thumbnails.medium.url} className="pdf-preview-avatar" alt="" />
                    )}
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 18 }}>{channel.snippet?.title}</div>
                      <div style={{ color: '#888', fontSize: 13 }}>{channel.snippet?.customUrl || ''}</div>
                    </div>
                  </div>
                  <div className="pdf-preview-stats">
                    {[
                      { label: 'Subscribers', value: formatNum(channel.statistics?.subscriberCount) },
                      { label: 'Videos Analyzed', value: videos.length },
                      { label: 'Avg Engagement', value: avgEng + '%' },
                      { label: 'Top Performer', value: topVideo ? (topVideo.snippet?.title || '').slice(0, 30) + '…' : '—' },
                    ].map(s => (
                      <div key={s.label} className="pdf-preview-stat">
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{s.value}</div>
                        <div style={{ fontSize: 11, color: '#888' }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="pdf-preview-pages">
                    <div className="pdf-page-icon">📊 Cover + Channel Stats</div>
                    <div className="pdf-page-icon">🎬 Top 15 Videos Table</div>
                    <div className="pdf-page-icon">📈 Views Bar Chart</div>
                    <div className="pdf-page-icon">💡 5 Recommendations</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="chart-card">
              <button
                className={`btn-primary btn-large ${done ? 'btn-success' : ''}`}
                onClick={handleGenerate}
                disabled={loading || done}
                style={{ width: '100%', justifyContent: 'center', fontSize: 15, padding: '14px 24px' }}
              >
                {loading ? (
                  <><span className="btn-spinner" /> Generating PDF…</>
                ) : done ? (
                  '✅ PDF Downloaded!'
                ) : (
                  '⬇️ Download PDF Report'
                )}
              </button>
              {error && <div className="search-error" style={{ marginTop: 10 }}>{error}</div>}
              <p style={{ fontSize: 12, color: '#666', textAlign: 'center', marginTop: 10 }}>
                PDF is generated entirely in your browser — no data is uploaded.
              </p>
            </div>
          </>
        )}
      </div>
    </ProGate>
  );
}
