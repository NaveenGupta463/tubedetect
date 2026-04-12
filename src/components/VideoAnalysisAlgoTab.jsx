import TITooltip from './Tooltip';
import { VIRALITY_TIPS, ALGO_TIPS } from './VideoAnalysisConstants';
import { SkeletonCard, AiRunPrompt } from './VideoAnalysisPrimitives';

export default function VideoAnalysisAlgoTab({ aiData, aiLoading, handleDeepAnalysis, canUseAI, onUpgrade }) {
  if (!aiData) return <AiRunPrompt onRun={handleDeepAnalysis} loading={aiLoading} noAI={!canUseAI?.()} onUpgrade={onUpgrade} tabLabel="Algorithm & Virality" />;
  if (aiLoading) return <><SkeletonCard lines={4} /><SkeletonCard lines={3} /></>;
  const algo = aiData.algorithm || {};
  const viralityFactors = algo.virality ? [
    { name: 'Novelty',            value: algo.virality.novelty ?? 0 },
    { name: 'Controversy',        value: algo.virality.controversy ?? 0 },
    { name: 'Relatability',       value: algo.virality.relatability ?? 0 },
    { name: 'Emotional Intensity', value: algo.virality.emotionalIntensity ?? 0 },
    { name: 'Shareability',       value: algo.virality.shareability ?? 0 },
  ] : [];
  return (
    <>
      {/* Virality Factors */}
      {viralityFactors.length > 0 && (
        <div className="chart-card">
          <h3 className="chart-title">5 Virality Factors</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
            {viralityFactors.map(f => {
              const color = f.value >= 70 ? '#00c853' : f.value >= 45 ? '#ff9100' : '#ff1744';
              return (
                <TITooltip key={f.name} title={f.name} desc={VIRALITY_TIPS[f.name]} placement="right">
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13, color: '#aaa' }}>
                      <span>{f.name}</span>
                      <span style={{ fontWeight: 700, color }}>{f.value}/100</span>
                    </div>
                    <div style={{ height: 8, background: '#1a1a1a', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${f.value}%`, background: color, borderRadius: 4, transition: 'width 0.8s ease' }} />
                    </div>
                  </div>
                </TITooltip>
              );
            })}
          </div>
        </div>
      )}

      {/* Algorithm Score + CTR Factors */}
      <div className="chart-card">
        <div className="chart-title-row">
          <TITooltip title="Algorithm Performance" desc={ALGO_TIPS.algorithmScore} placement="top">
            <h3 className="chart-title" style={{ cursor: 'default' }}>Algorithm Performance</h3>
          </TITooltip>
          {algo.algorithmScore != null && (
            <span style={{
              fontSize: 18, fontWeight: 900,
              color: algo.algorithmScore >= 70 ? '#00c853' : algo.algorithmScore >= 50 ? '#ff9100' : '#ff1744',
            }}>
              {algo.algorithmScore}/100
            </span>
          )}
        </div>
        {algo.insight && <div className="ai-text-block" style={{ marginBottom: 16 }}>{algo.insight}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {algo.ctrFactors?.length > 0 && (
            <div>
              <TITooltip title="CTR Drivers" desc={ALGO_TIPS.ctrFactors} placement="top">
                <div style={{ fontSize: 12, fontWeight: 700, color: '#ff9100', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, cursor: 'default' }}>CTR Drivers</div>
              </TITooltip>
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {algo.ctrFactors.map((f, i) => (
                  <li key={i} style={{ fontSize: 12, color: '#aaa', display: 'flex', gap: 6 }}>
                    <span style={{ color: '#ff9100' }}>→</span><span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {algo.retentionFactors?.length > 0 && (
            <div>
              <TITooltip title="Retention Drivers" desc={ALGO_TIPS.retentionFactors} placement="top">
                <div style={{ fontSize: 12, fontWeight: 700, color: '#2196f3', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, cursor: 'default' }}>Retention Drivers</div>
              </TITooltip>
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {algo.retentionFactors.map((f, i) => (
                  <li key={i} style={{ fontSize: 12, color: '#aaa', display: 'flex', gap: 6 }}>
                    <span style={{ color: '#2196f3' }}>→</span><span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {algo.monetizationLayers?.length > 0 && (
          <div style={{ marginTop: 16, padding: '12px 14px', background: '#0f0f0f', borderRadius: 8, border: '1px solid #1e1e1e' }}>
            <TITooltip title="Monetization Layers" desc={ALGO_TIPS.monetization} placement="top">
              <div style={{ fontSize: 12, fontWeight: 700, color: '#00c853', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, cursor: 'default' }}>Monetization Layers</div>
            </TITooltip>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {algo.monetizationLayers.map((m, i) => (
                <span key={i} style={{ background: '#00c85322', border: '1px solid #00c85344', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#69f0ae' }}>{m}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
