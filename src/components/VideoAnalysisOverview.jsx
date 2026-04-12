import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area,
} from 'recharts';
import { formatNum } from '../utils/analysis';
import { DIMENSION_TIPS, VIDEO_STAT_TIPS } from './VideoAnalysisConstants';
import { ScoreRing, GradeCircle, InsightItem, ChartTooltip } from './VideoAnalysisPrimitives';
import VideoReportCard from './VideoReportCard';
import GrowthPrediction from './GrowthPrediction';
import TITooltip from './Tooltip';

export default function VideoAnalysisOverview({
  aiData, aiLoading,
  overviewRings,
  handleRunDeepClick, isPro,
  grade, score, metrics,
  video, allVideos, channelAvg,
  canUseAI, consumeAICall, remainingCalls, onUpgrade,
  analysis,
  comparisonData,
  loadingComments, timestamps, maxTimestampCount, comments,
}) {
  const { likeRate, commentRate } = metrics;

  return (
    <>
      {/* 8 Score Rings preview */}
      <div className="chart-card" style={!aiData ? { border: '1px solid #ff000033', background: 'linear-gradient(135deg, #0d0d0d, #110808)' } : {}}>
        <div className="chart-title-row">
          <h3 className="chart-title">8-Dimension Score Preview</h3>
          {aiData && <span style={{ fontSize: 11, color: '#00c853', fontWeight: 700 }}>● Analysis complete</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 12, marginTop: 12, justifyItems: 'center' }}>
          {overviewRings.map(r => (
            <TITooltip key={r.label} title={r.label.replace('\n', ' ')} desc={DIMENSION_TIPS[r.label]} placement="top">
              <div className={!aiData && r.score == null ? 'ring-pulse' : ''}>
                <ScoreRing score={r.score} label={r.label} size={72} />
              </div>
            </TITooltip>
          ))}
        </div>
        {!aiData && !aiLoading && (
          <div style={{ textAlign: 'center', marginTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#555' }}>
              Run Deep Analysis to unlock all 8 dimension scores
            </div>
            <button
              onClick={handleRunDeepClick}
              className="run-analysis-glow-btn"
              style={{ padding: '10px 28px', fontSize: 13 }}
            >
              🧠 {!isPro ? '🔒 Click to fill these scores' : 'Click to fill these scores'}
            </button>
          </div>
        )}
        {aiLoading && (
          <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span className="btn-spinner" /> Calculating dimension scores…
          </div>
        )}
      </div>

      {/* Performance Score */}
      <div className="perf-row">
        <div className="perf-score-card">
          <GradeCircle grade={grade} score={score} />
          <div className="perf-score-info">
            <div className="perf-score-title">Performance Score</div>
            <div className="perf-score-desc">
              {score >= 75 ? 'Top-performing video for this channel'
                : score >= 55 ? 'Above-average performance'
                : score >= 40 ? 'Average performance'
                : 'Below-average — needs improvement'}
            </div>
            <div className="perf-score-bars">
              <TITooltip title="Like Rate" desc={VIDEO_STAT_TIPS['Like Rate']} placement="right">
                <div className="perf-bar-row">
                  <span>Like rate</span>
                  <div className="perf-bar-bg">
                    <div className="perf-bar-fill" style={{ width: `${Math.min(100, likeRate * 20)}%`, background: likeRate > 3 ? '#00c853' : likeRate > 1 ? '#ff9100' : '#ff1744' }} />
                  </div>
                  <span>{likeRate.toFixed(2)}%</span>
                </div>
              </TITooltip>
              <TITooltip title="Comment Rate" desc={VIDEO_STAT_TIPS['Comment Rate']} placement="right">
                <div className="perf-bar-row">
                  <span>Comment rate</span>
                  <div className="perf-bar-bg">
                    <div className="perf-bar-fill" style={{ width: `${Math.min(100, commentRate * 200)}%`, background: commentRate > 0.2 ? '#00c853' : commentRate > 0.05 ? '#ff9100' : '#ff1744' }} />
                  </div>
                  <span>{commentRate.toFixed(3)}%</span>
                </div>
              </TITooltip>
              <TITooltip title="Views vs Channel Avg" desc={VIDEO_STAT_TIPS['Views vs Avg']} placement="right">
                <div className="perf-bar-row">
                  <span>vs Channel avg</span>
                  <div className="perf-bar-bg">
                    <div className="perf-bar-fill" style={{ width: `${Math.min(100, metrics.viewsRatio * 50)}%`, background: metrics.viewsRatio > 1.5 ? '#00c853' : metrics.viewsRatio > 0.7 ? '#ff9100' : '#ff1744' }} />
                  </div>
                  <span>{Math.round(metrics.viewsRatio * 100)}%</span>
                </div>
              </TITooltip>
            </div>
          </div>
        </div>
      </div>

      <VideoReportCard metrics={metrics} video={video} />

      <GrowthPrediction
        video={video} allVideos={allVideos} channelAvg={channelAvg}
        canUseAI={canUseAI} consumeAICall={consumeAICall}
        remainingCalls={remainingCalls} onUpgrade={onUpgrade}
      />

      {/* What Worked / What Didn't */}
      <div className="insights-grid">
        <div className="insights-panel insights-good">
          <div className="insights-panel-header">
            <span className="insights-panel-icon">✅</span>
            <h3 className="insights-panel-title">What Worked</h3>
            <span className="insights-count">{analysis.positives.length}</span>
          </div>
          {analysis.positives.length === 0
            ? <div className="insights-empty">No notable strengths detected.</div>
            : analysis.positives.map((item, i) => <InsightItem key={i} item={item} />)}
        </div>
        <div className="insights-panel insights-bad">
          <div className="insights-panel-header">
            <span className="insights-panel-icon">⚠️</span>
            <h3 className="insights-panel-title">What Didn't Work</h3>
            <span className="insights-count">{analysis.negatives.length}</span>
          </div>
          {analysis.negatives.length === 0
            ? <div className="insights-empty">No significant issues detected.</div>
            : analysis.negatives.map((item, i) => <InsightItem key={i} item={item} />)}
        </div>
      </div>

      {/* Comparison Chart */}
      <div className="chart-card">
        <h3 className="chart-title">This Video vs Channel Average</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={comparisonData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
            <XAxis dataKey="metric" tick={{ fill: '#aaa', fontSize: 13 }} />
            <YAxis tickFormatter={v => formatNum(v)} tick={{ fill: '#888', fontSize: 11 }} width={55} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="This Video" fill="#ff0000" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Channel Avg" fill="#444" radius={[4, 4, 0, 0]} />
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

      {/* Top Comments */}
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
