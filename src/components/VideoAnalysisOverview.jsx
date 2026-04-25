import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, AreaChart, Area, Cell,
} from 'recharts';
import { formatNum } from '../utils/analysis';
import { ChartTooltip } from './VideoAnalysisPrimitives';
import GrowthPrediction from './GrowthPrediction';
import SignalNarrative from './SignalNarrative';

export default function VideoAnalysisOverview({
  aiData, aiLoading,
  metrics,
  video, allVideos, channelAvg,
  canUseAI, consumeAICall, remainingCalls, onUpgrade,
  comparisonData,
  loadingComments, timestamps, maxTimestampCount, comments,
}) {
  const bp = aiData?.blueprint || {};
  const hasValidAnalysis = !!aiData?.diagnosis && !aiData?._diagnosisOutdated;

  const viewsRatio  = metrics?.viewsRatio ?? 0;
  const likeRate    = metrics?.likeRate ?? (video?.likes && video?.views ? video.likes / video.views : 0);
  const commentRate = metrics?.commentRate ?? 0;
  const channelLikeRate = channelAvg?.likeRate ?? 0;

  function getDistribution() {
    if (viewsRatio >= 5) return 'HIGH';
    if (viewsRatio >= 2) return 'STABLE';
    return 'LOW';
  }
  function getEngagement() {
    if (channelLikeRate <= 0) return 'STABLE';
    const delta = (likeRate - channelLikeRate) / channelLikeRate;
    if (delta >= 0.2) return 'HIGH';
    if (delta <= -0.2) return 'LOW';
    return 'STABLE';
  }
  function getConversation() {
    if (commentRate >= 0.002) return 'HIGH';
    if (commentRate >= 0.0005) return 'STABLE';
    return 'LOW';
  }

  const distribution = getDistribution();
  const engagement   = getEngagement();
  const conversation = getConversation();

  const showTension = distribution === 'HIGH' && (engagement !== 'HIGH' || conversation === 'LOW');

  return (
    <>
      {/* ── PRE-ANALYSIS TEASER ── */}
      {!hasValidAnalysis && (
        <>
          {/* Hero Insight Block */}
          {channelAvg?.views > 0 && (
            <div className="chart-card" style={{ border: '1px solid #1e1a0a', background: '#0a0900' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#78350f', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 10 }}>
                Early Signal Detected
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Views vs Avg</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, color: viewsRatio >= 5 ? '#22c55e' : viewsRatio >= 2 ? '#eab308' : '#f97316' }}>
                    {viewsRatio >= 2 ? `${viewsRatio.toFixed(1)}×` : `${(viewsRatio * 100).toFixed(0)}%`}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#444', marginTop: 4 }}>of channel avg</div>
                </div>
                <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Like Rate</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#d4d4d8' }}>
                    {(likeRate * 100).toFixed(2)}%
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#444', marginTop: 4 }}>of views liked</div>
                </div>
                <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Comment Rate</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#d4d4d8' }}>
                    {(commentRate * 100).toFixed(3)}%
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#444', marginTop: 4 }}>comments per view</div>
                </div>
              </div>
              <div style={{ marginTop: 14, padding: '10px 14px', background: '#0c0a00', border: '1px solid #292500', borderRadius: 8 }}>
                <span style={{ fontSize: '0.78rem', color: '#78350f', fontStyle: 'italic' }}>
                  Something is working… but something is missing. Run Deep Analysis to find out what.
                </span>
              </div>
            </div>
          )}

          {/* Narrative Intelligence Block */}
          <SignalNarrative video={video} metrics={metrics} channelAvg={channelAvg} comments={comments} />

          {/* Tension Block */}
          {(() => {
            const displayScore = bp.finalScore ?? bp.baseScore ?? null;
            const weakest = distribution === 'LOW' ? 'distribution'
              : engagement === 'LOW' ? 'engagement' : 'conversation';
            const scoreColor = displayScore == null ? null
              : displayScore >= 65 ? '#22c55e' : displayScore >= 45 ? '#eab308' : '#f97316';
            return (
              <div className="chart-card" style={{
                border: `1px solid ${showTension ? '#431407' : '#0f2a1a'}`,
                background: showTension ? '#0a0300' : '#000a04',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: '1.1rem', flexShrink: 0, marginTop: 1 }}>{showTension ? '⚠️' : '🧠'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: showTension ? '#7c2d12' : '#14532d', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                        {showTension ? 'Growth Risk Detected' : 'Opportunity Detected'}
                      </div>
                      {displayScore != null && (
                        <span style={{
                          fontSize: '0.65rem', fontWeight: 800, color: scoreColor,
                          background: `${scoreColor}14`, border: `1px solid ${scoreColor}33`,
                          borderRadius: 5, padding: '2px 7px', letterSpacing: '0.05em',
                          transition: 'all 0.3s ease',
                        }}>
                          {Math.round(displayScore)}/100
                        </span>
                      )}
                      <span style={{ fontSize: '0.62rem', color: '#3a3a3a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        {weakest} bottleneck
                      </span>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: showTension ? '#fed7aa' : '#bbf7d0', lineHeight: 1.5 }}>
                      {showTension
                        ? 'This video is reaching audiences but not converting them into engaged viewers. High distribution without interaction suggests a hook or content-fit mismatch.'
                        : 'Signals are stable or growing. There may be untapped optimization potential — thumbnail, title, or pacing adjustments could push this further.'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* ── FULL ANALYSIS UI ── */}
      {hasValidAnalysis && (<>

      {/* Advanced Metrics — unlocks with OAuth */}
      {(() => {
        const od = bp.oauthDisplay;
        const hasOAuth = !!(od?.ctr != null);
        const retentionPct = od ? Math.round((od.retentionRate ?? 0) * 100) : null;
        const ctrColor = od?.ctr >= 4 ? '#00c853' : od?.ctr >= 2 ? '#ff9100' : '#ff1744';
        const retColor = retentionPct >= 50 ? '#00c853' : retentionPct >= 30 ? '#ff9100' : '#ff1744';
        const tiles = hasOAuth
          ? [
              { label: 'CTR',               val: `${od.ctr.toFixed(1)}%`,           color: ctrColor },
              { label: 'Retention',          val: `${retentionPct}%`,                color: retColor },
              { label: 'Impressions',        val: formatNum(od.impressions),          color: '#aaa' },
              { label: 'Avg View Duration',  val: `${Math.round(od.avgViewDuration)}s`, color: '#aaa' },
            ]
          : [
              { label: 'CTR',               val: '—', color: '#2a2a2a' },
              { label: 'Retention',          val: '—', color: '#2a2a2a' },
              { label: 'Impressions',        val: '—', color: '#2a2a2a' },
              { label: 'Avg View Duration',  val: '—', color: '#2a2a2a' },
            ];
        return (
          <div className="chart-card" style={{ border: '1px solid #1a1a1a', position: 'relative', overflow: 'hidden' }}>
            {!hasOAuth && (
              <div style={{ position: 'absolute', inset: 0, backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', background: 'rgba(8,8,8,0.75)', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.4rem' }}>🔒</span>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#555', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Advanced Metrics</div>
                <div style={{ fontSize: 11, color: '#383838', textAlign: 'center', maxWidth: 240, lineHeight: 1.5 }}>Connect YouTube Analytics to unlock CTR, Retention, Impressions & Avg View Duration</div>
              </div>
            )}
            <div className="chart-title-row">
              <h3 className="chart-title">Advanced Metrics</h3>
              {hasOAuth && <span style={{ fontSize: 11, color: '#00c853', fontWeight: 700 }}>● YouTube Analytics</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 12 }}>
              {tiles.map(({ label, val, color }) => (
                <div key={label} style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}


      <GrowthPrediction
        video={video} allVideos={allVideos} channelAvg={channelAvg}
        canUseAI={canUseAI} consumeAICall={consumeAICall}
        remainingCalls={remainingCalls} onUpgrade={onUpgrade}
      />


      {/* Comparison Chart */}
      <div className="chart-card">
        <h3 className="chart-title">This Video vs Channel Average</h3>
        <p className="chart-subtitle">100% = channel average. Above means this video outperformed.</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={comparisonData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false} />
            <XAxis dataKey="metric" tick={{ fill: '#aaa', fontSize: 13 }} axisLine={false} tickLine={false} />
            <YAxis
              tickFormatter={v => `${v}%`}
              tick={{ fill: '#888', fontSize: 11 }}
              width={48}
              domain={[0, dataMax => Math.max(150, Math.ceil(dataMax / 50) * 50 + 50)]}
            />
            <ReferenceLine y={100} stroke="#555" strokeDasharray="4 3" label={{ value: 'avg', fill: '#555', fontSize: 10, position: 'insideTopRight' }} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: '#111', border: '1px solid #333', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
                    <div style={{ fontWeight: 700, color: '#ccc', marginBottom: 6 }}>{d.metric}</div>
                    <div style={{ color: '#aaa' }}>This video: <strong style={{ color: '#fff' }}>{formatNum(d.raw)}</strong></div>
                    <div style={{ color: '#aaa' }}>Channel avg: <strong style={{ color: '#fff' }}>{formatNum(d.avg)}</strong></div>
                    <div style={{ marginTop: 6, color: d.pct >= 100 ? '#00c853' : '#ff9100', fontWeight: 700 }}>{d.pct}% of average</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="pct" radius={[4, 4, 0, 0]} maxBarSize={64}>
              {comparisonData.map((entry, i) => (
                <Cell key={i} fill={entry.pct >= 100 ? '#00c853' : entry.pct >= 60 ? '#ff9100' : '#ff1744'} />
              ))}
            </Bar>
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

      {/* Diagnosis Insights Panel */}
      {(() => {
        const ins = aiData?.diagnosis?.insights;
        if (!ins) return null;

        const working  = (ins.what_is_working || []).slice(0, 5);
        const failing  = (ins.what_is_failing || []).slice(0, 5);
        const leverage = (ins.leverage_points || []).slice(0, 5);
        const LS = { fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase' };

        return (
          <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #1a1a1a' }}>
              <h3 className="chart-title" style={{ margin: 0 }}>Diagnosis</h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.76rem', color: '#555' }}>
                What's driving performance and where to act
              </p>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Working + Failing — side by side */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

                <div style={{ background: '#060f06', border: '1px solid #1a2e1a', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                    <span style={{ fontSize: '0.8rem' }}>✅</span>
                    <span style={{ ...LS, color: '#15803d' }}>What's Working</span>
                  </div>
                  {working.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {working.map((item, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <span style={{ color: '#22c55e', fontSize: '0.7rem', flexShrink: 0, marginTop: 3 }}>•</span>
                          <span style={{ fontSize: '0.78rem', color: '#86efac', lineHeight: 1.55 }}>{item}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: '0.78rem', color: '#2a4a2a', fontStyle: 'italic' }}>
                      No major strengths detected.
                    </p>
                  )}
                </div>

                <div style={{ background: '#0f0606', border: '1px solid #2e1a1a', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                    <span style={{ fontSize: '0.8rem' }}>❌</span>
                    <span style={{ ...LS, color: '#b91c1c' }}>What's Failing</span>
                  </div>
                  {failing.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {failing.map((item, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <span style={{ color: '#ef4444', fontSize: '0.7rem', flexShrink: 0, marginTop: 3 }}>•</span>
                          <span style={{ fontSize: '0.78rem', color: '#fca5a5', lineHeight: 1.55 }}>{item}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: '0.78rem', color: '#4a2a2a', fontStyle: 'italic' }}>
                      No critical issues detected.
                    </p>
                  )}
                </div>

              </div>

              {/* Leverage Points — full width, most prominent */}
              <div style={{ background: '#0a0814', border: '1px solid #2a1060', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
                  <span style={{ fontSize: '0.8rem' }}>⚡</span>
                  <span style={{ ...LS, color: '#7c3aed' }}>Leverage Points</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.6rem', color: '#4c1d95', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    highest impact first
                  </span>
                </div>
                {leverage.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {leverage.map((item, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span style={{
                          fontSize: '0.65rem', fontWeight: 800, color: '#7c3aed',
                          flexShrink: 0, marginTop: 2, minWidth: 16, textAlign: 'center',
                        }}>
                          {i + 1}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: '#c4b5fd', lineHeight: 1.6 }}>{item}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: '0.78rem', color: '#2a1a4a', fontStyle: 'italic' }}>
                    No clear leverage opportunities identified.
                  </p>
                )}
              </div>

            </div>
          </div>
        );
      })()}

      {/* Recommendations Panel */}
      {(() => {
        const rec = aiData?.diagnosis?.recommendations;
        if (!rec) return null;

        const goal    = rec.goal || '';
        const actions = (rec.actions || []).slice(0, 5);
        const isEmpty = !goal && actions.length === 0;
        const LS = { fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase' };

        return (
          <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #1a1a1a' }}>
              <h3 className="chart-title" style={{ margin: 0 }}>Recommendations</h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.76rem', color: '#555' }}>
                What to do next
              </p>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {isEmpty ? (
                <div style={{ background: '#060f06', border: '1px solid #1a2e1a', borderRadius: 10, padding: '18px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: '1rem' }}>✅</span>
                    <span style={{ ...LS, color: '#15803d' }}>No Immediate Optimization Needed</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.84rem', color: '#86efac', lineHeight: 1.65 }}>
                    This video is performing efficiently. Focus on scaling what's already working.
                  </p>
                </div>
              ) : (
                <>
                  {goal && (
                    <div style={{ background: '#0a0814', border: '1px solid #2a1060', borderRadius: 10, padding: '14px 18px' }}>
                      <div style={{ ...LS, color: '#7c3aed', marginBottom: 8 }}>Goal</div>
                      <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: '#e4e4e7', lineHeight: 1.55 }}>
                        {goal}
                      </p>
                    </div>
                  )}
                  {actions.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ ...LS, color: '#555', marginBottom: 2 }}>Actions</div>
                      {actions.map((action, i) => (
                        <div key={i} style={{
                          display: 'flex', gap: 14, alignItems: 'flex-start',
                          background: '#0c0c0c', border: '1px solid #1e1e1e',
                          borderRadius: 10, padding: '12px 14px',
                        }}>
                          <span style={{
                            fontSize: '0.72rem', fontWeight: 800, color: '#7c3aed',
                            flexShrink: 0, marginTop: 1, minWidth: 18, textAlign: 'center',
                          }}>
                            {i + 1}
                          </span>
                          <span style={{ fontSize: '0.82rem', color: '#d4d4d8', lineHeight: 1.6 }}>
                            {action}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      </>)}

      {/* Top Comments — always visible */}
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
}
