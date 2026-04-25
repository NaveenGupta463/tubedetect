import TITooltip from './Tooltip';
import { DIMENSION_TIPS, BLUEPRINT_TIPS } from './VideoAnalysisConstants';
import { ScoreRing, BigScoreRing, SkeletonCard, AiRunPrompt } from './VideoAnalysisPrimitives';

function getMessage(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field.message || '';
}

export default function VideoAnalysisBlueprintTab({ aiData, aiLoading, handleDeepAnalysis, canUseAI, onUpgrade, copiedReport, onCopyReport, onActionClick, insightMode, sampleLevel }) {
  if (!aiData) return <AiRunPrompt onRun={handleDeepAnalysis} loading={aiLoading} noAI={!canUseAI?.()} onUpgrade={onUpgrade} tabLabel="Blueprint & Score" />;
  if (aiLoading) return <><SkeletonCard lines={4} /><SkeletonCard lines={5} /><SkeletonCard lines={4} /></>;
  const bp = aiData.blueprint || {};
  const bpScoreList = bp.scores ? [
    { label: 'Engagement', value: bp.scores.engagement ?? 0 },
    { label: 'Velocity',   value: bp.scores.velocity   ?? null },
    { label: 'Discussion', value: bp.scores.discussion ?? 0 },
  ] : [];

  return (
    <>
      {/* Overall Score + 8 Rings */}
      <div className="chart-card" style={{ borderTop: '3px solid #7c4dff' }}>
        <TITooltip title="Overall Score" desc={BLUEPRINT_TIPS.overallScore} placement="top">
          <h3 className="chart-title" style={{ cursor: 'default' }}>Overall Score</h3>
        </TITooltip>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginTop: 16, flexWrap: 'wrap' }}>
          <BigScoreRing score={bp.viralScore ?? 0} grade={bp.grade ?? '?'} />
          <div style={{ flex: 1, minWidth: 200 }}>
            {sampleLevel && sampleLevel !== 'high' && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                background: '#111', border: '1px solid #2a2200',
                borderRadius: 7, padding: '8px 12px', marginBottom: 12,
              }}>
                <span style={{ flexShrink: 0, fontSize: '0.8rem' }}>⚠️</span>
                <span style={{ fontSize: '0.7rem', color: '#a16207', lineHeight: 1.5 }}>
                  {sampleLevel === 'very_low'
                    ? 'Very limited data — fewer than 500 views. Strength findings are preliminary.'
                    : 'Limited data — under 2,000 views. Strength findings may shift as the video grows.'}
                </span>
              </div>
            )}
            {bp.contentDNA && (
              <div style={{ marginBottom: 14 }}>
                <TITooltip title="Content DNA" desc={BLUEPRINT_TIPS.contentDNA} placement="top">
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#7c4dff', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, cursor: 'default' }}>Content DNA</div>
                </TITooltip>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0', lineHeight: 1.5, fontStyle: 'italic' }}>{bp.contentDNA}</div>
              </div>
            )}
            {bp.strengths && (
              <div style={{ marginBottom: 8, padding: '10px 12px', background: '#00c85311', borderRadius: 8, border: '1px solid #00c85322' }}>
                <TITooltip title="Strengths" desc={BLUEPRINT_TIPS.strengths} placement="top">
                  <div style={{ fontSize: 11, color: '#00c853', fontWeight: 700, marginBottom: 4, cursor: 'default' }}>STRENGTHS</div>
                </TITooltip>
                <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>{bp.strengths}</div>
              </div>
            )}
            {bp.improvements && (
              <div style={{ padding: '10px 12px', background: '#ff174411', borderRadius: 8, border: '1px solid #ff174422' }}>
                <TITooltip title="Areas to Improve" desc={BLUEPRINT_TIPS.improvements} placement="top">
                  <div style={{ fontSize: 11, color: '#ff1744', fontWeight: 700, marginBottom: 4, cursor: 'default' }}>IMPROVE</div>
                </TITooltip>
                <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>{bp.improvements}</div>
              </div>
            )}
          </div>
        </div>
        {bpScoreList.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 20, justifyItems: 'center' }}>
            {bpScoreList.map(s => (
              <TITooltip key={s.label} title={s.label} desc={DIMENSION_TIPS[s.label]} placement="top">
                <div><ScoreRing score={s.value ?? 0} label={s.label} size={72} /></div>
              </TITooltip>
            ))}
          </div>
        )}
      </div>

      {/* Replication Blueprint */}
      {bp.replicationBlueprint?.length > 0 && (
        <div className="chart-card">
          <TITooltip title="Replication Blueprint" desc={BLUEPRINT_TIPS.blueprint} placement="top">
            <h3 className="chart-title" style={{ cursor: 'default' }}>Replication Blueprint</h3>
          </TITooltip>
          <p className="chart-subtitle">Follow these steps to recreate what made this video succeed</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {bp.replicationBlueprint.map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: '#7c4dff22', border: '1px solid #7c4dff44',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800, color: '#7c4dff',
                }}>
                  {i + 1}
                </div>
                <div style={{ fontSize: 13, color: '#bbb', lineHeight: 1.6, paddingTop: 4 }}>{step}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actionable Lessons */}
      {bp.lessons?.length > 0 && (
        <div className="chart-card">
          <TITooltip title="5 Actionable Lessons" desc={BLUEPRINT_TIPS.lessons} placement="top">
            <h3 className="chart-title" style={{ cursor: 'default' }}>5 Actionable Lessons</h3>
          </TITooltip>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {bp.lessons.map((lesson, i) => (
              <div key={i} style={{ background: '#0f0f0f', borderRadius: 8, padding: '12px 14px', border: '1px solid #1e1e1e' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0', marginBottom: 6 }}>{lesson.title}</div>
                <div style={{ fontSize: 12, color: '#777', lineHeight: 1.6 }}>{lesson.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Context / Performance Breakdown / Next Actions ────────────────── */}
      {insightMode === 'CONTEXT' ? (
        <>
          {bp.diagnostics?.length > 0 && (
            <div className="chart-card">
              <h3 className="chart-title" style={{ cursor: 'default', marginBottom: 4 }}>
                {bp.videoType === 'EARLY' ? 'Early Distribution Context' : 'Historical Context'}
              </h3>
              <p className="chart-subtitle" style={{ marginBottom: 14 }}>
                {bp.videoType === 'EARLY'
                  ? 'Signals are preliminary — optimization advice is not applicable yet'
                  : 'This video has reached peak distribution — standard optimization metrics do not apply'}
              </p>

              {getMessage(bp.primaryIssue) && (
                <div style={{ marginBottom: 14, padding: '10px 14px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Context</div>
                  <div style={{ fontSize: 13, color: '#e0e0e0' }}>{getMessage(bp.primaryIssue)}</div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {bp.diagnostics.map((d, i) => (
                  <div key={i} style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ color: '#4b5563', flexShrink: 0, fontSize: 13 }}>·</span>
                    <span style={{ fontSize: 13, color: '#aaa', lineHeight: 1.55 }}>
                      {typeof d === 'string' ? d : d.message ?? ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reusable Patterns (LEGACY_VIRAL only) */}
          {aiData?.intelligence?.reusablePatterns?.length > 0 && (
            <div className="chart-card" style={{ borderTop: '3px solid #7c3aed' }}>
              <h3 className="chart-title" style={{ cursor: 'default', marginBottom: 4 }}>Reusable Patterns</h3>
              <p className="chart-subtitle" style={{ marginBottom: 14 }}>Extracted viral patterns you can apply to future content</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {aiData.intelligence.reusablePatterns.map((p, i) => (
                  <div key={i} style={{ background: '#0f0f0f', border: '1px solid #2a1060', borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#c084fc', marginBottom: 6 }}>{p.pattern}</div>
                    <div style={{ fontSize: 12, color: '#888', lineHeight: 1.6, marginBottom: 8 }}>{p.description}</div>
                    {p.howToApply && (
                      <div style={{ padding: '8px 12px', background: '#1e0a3c', borderRadius: 6, fontSize: 12, color: '#a78bfa', lineHeight: 1.5 }}>
                        → {p.howToApply}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : insightMode === 'DIAGNOSE' ? (
        (getMessage(bp.primaryIssue) || bp.diagnostics?.length > 0) && (
          <div className="chart-card">
            <h3 className="chart-title" style={{ cursor: 'default', marginBottom: 14 }}>Performance Breakdown</h3>

            {getMessage(bp.primaryIssue) && getMessage(bp.primaryIssue) !== 'Performance was consistent with expected baseline' && (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Primary Finding</div>
                <div style={{ fontSize: 13, color: '#e0e0e0' }}>{getMessage(bp.primaryIssue)}</div>
              </div>
            )}

            {bp.diagnostics?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {bp.diagnostics.map((d, i) => (
                  <div key={i} style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ color: '#4b5563', flexShrink: 0, fontSize: 13 }}>—</span>
                    <span style={{ fontSize: 13, color: '#aaa', lineHeight: 1.55 }}>
                      {typeof d === 'string' ? d : d.message ?? ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      ) : (
        (getMessage(bp.primaryIssue) || getMessage(bp.biggestOpportunity) || bp.actions?.length > 0) && (
          <div className="chart-card">
            <h3 className="chart-title" style={{ cursor: 'default', marginBottom: 14 }}>Next Actions</h3>

            {getMessage(bp.primaryIssue) && getMessage(bp.primaryIssue) !== 'None' && (
              <div style={{ marginBottom: 10, padding: '10px 14px', background: '#1a0a0a', border: '1px solid #3a1010', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#ff4444', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Primary Issue</div>
                <div style={{ fontSize: 13, color: '#e0e0e0' }}>{getMessage(bp.primaryIssue)}</div>
              </div>
            )}

            {getMessage(bp.biggestOpportunity) && getMessage(bp.biggestOpportunity) !== 'All dimensions performing well' && (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: '#0a1a0a', border: '1px solid #103a10', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#44ff88', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Biggest Opportunity</div>
                <div style={{ fontSize: 13, color: '#e0e0e0' }}>{getMessage(bp.biggestOpportunity)}</div>
              </div>
            )}

            {bp.actions?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {bp.actions.map((action, i) => (
                  <div key={i} style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#c084fc', letterSpacing: '0.06em' }}>{action.type}</div>
                      <div style={{ fontSize: 11, color: '#666' }}>
                        +{typeof action.expectedImpact === 'number' ? action.expectedImpact.toFixed(1) : '—'} impact
                      </div>
                    </div>
                    {action.reason && (
                      <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5, marginBottom: 8 }}>{action.reason}</div>
                    )}
                    {action.steps?.length > 0 && (
                      <ul style={{ margin: '0 0 10px 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {action.steps.map((step, j) => (
                          <li key={j} style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>{step}</li>
                        ))}
                      </ul>
                    )}
                    {onActionClick && (
                      <button
                        onClick={() => onActionClick(action)}
                        style={{
                          marginTop: 4, background: '#1e0a3c', border: '1px solid #6d28d9',
                          borderRadius: 7, padding: '7px 16px',
                          fontSize: 12, fontWeight: 700, color: '#c084fc', cursor: 'pointer',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#2d1060'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#1e0a3c'; }}
                      >
                        Fix This →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {/* Copy + Export */}
      <div className="chart-card" style={{ display: 'flex', gap: 10, justifyContent: 'center', padding: '20px' }}>
        <button
          onClick={onCopyReport}
          style={{
            background: copiedReport ? '#00c85322' : '#1a1a1a',
            border: `1px solid ${copiedReport ? '#00c853' : '#333'}`,
            borderRadius: 8, padding: '10px 22px',
            fontSize: 13, fontWeight: 700,
            color: copiedReport ? '#00c853' : '#888',
            cursor: 'pointer',
          }}
        >
          {copiedReport ? '✅ Copied!' : '📋 Copy Full Report'}
        </button>
        <button
          onClick={() => window.print()}
          style={{
            background: '#1a1a1a', border: '1px solid #333',
            borderRadius: 8, padding: '10px 22px',
            fontSize: 13, fontWeight: 700, color: '#888', cursor: 'pointer',
          }}
        >
          🖨️ Export PDF
        </button>
      </div>
    </>
  );
}
