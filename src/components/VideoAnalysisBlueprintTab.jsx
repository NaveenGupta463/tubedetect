import TITooltip from './Tooltip';
import { DIMENSION_TIPS, BLUEPRINT_TIPS } from './VideoAnalysisConstants';
import { ScoreRing, BigScoreRing, SkeletonCard, AiRunPrompt } from './VideoAnalysisPrimitives';

export default function VideoAnalysisBlueprintTab({ aiData, aiLoading, handleDeepAnalysis, canUseAI, onUpgrade, copiedReport, onCopyReport }) {
  if (!aiData) return <AiRunPrompt onRun={handleDeepAnalysis} loading={aiLoading} noAI={!canUseAI?.()} onUpgrade={onUpgrade} tabLabel="Blueprint & Score" />;
  if (aiLoading) return <><SkeletonCard lines={4} /><SkeletonCard lines={5} /><SkeletonCard lines={4} /></>;
  const bp = aiData.blueprint || {};
  const bpScoreList = bp.scores ? [
    { label: 'Title &\nThumb',    value: bp.scores.titleThumbnail ?? 0 },
    { label: 'Hook &\nRetention', value: bp.scores.hookRetention ?? 0 },
    { label: 'Structure',         value: bp.scores.contentStructure ?? 0 },
    { label: 'Engagement',        value: bp.scores.engagement ?? 0 },
    { label: 'Algorithm',         value: bp.scores.algorithm ?? 0 },
    { label: 'SEO',               value: bp.scores.seoDiscoverability ?? 0 },
    { label: 'Emotion',           value: bp.scores.emotionalImpact ?? 0 },
    { label: 'Value',             value: bp.scores.valueDelivery ?? 0 },
  ] : [];

  return (
    <>
      {/* Overall Score + 8 Rings */}
      <div className="chart-card" style={{ borderTop: '3px solid #7c4dff' }}>
        <TITooltip title="Overall Score" desc={BLUEPRINT_TIPS.overallScore} placement="top">
          <h3 className="chart-title" style={{ cursor: 'default' }}>Overall Score</h3>
        </TITooltip>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginTop: 16, flexWrap: 'wrap' }}>
          <BigScoreRing score={bp.overallScore ?? 0} grade={bp.grade ?? '?'} />
          <div style={{ flex: 1, minWidth: 200 }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 10, marginTop: 20, justifyItems: 'center' }}>
            {bpScoreList.map(s => (
              <TITooltip key={s.label} title={s.label.replace('\n', ' ')} desc={DIMENSION_TIPS[s.label]} placement="top">
                <div><ScoreRing score={s.value} label={s.label} size={72} /></div>
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
