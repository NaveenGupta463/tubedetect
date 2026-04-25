import { formatNum } from '../utils/analysis';

const SIGNAL_COLORS = { HIGH: '#22c55e', STABLE: '#eab308', LOW: '#f97316' };

function classify(value, highThreshold, lowThreshold) {
  if (value >= highThreshold) return 'HIGH';
  if (value <= lowThreshold) return 'LOW';
  return 'STABLE';
}

function SignalRow({ label, status, detail }) {
  const color = SIGNAL_COLORS[status];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: '#0c0c0c', border: '1px solid #1e1e1e',
      borderRadius: 10, padding: '13px 16px',
    }}>
      <div style={{
        flexShrink: 0, width: 8, height: 8, borderRadius: '50%',
        background: color, boxShadow: `0 0 6px ${color}88`,
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#555', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 3 }}>
          {label}
        </div>
        <div style={{ fontSize: '0.82rem', color: '#d4d4d8', lineHeight: 1.45 }}>{detail}</div>
      </div>
      <div style={{
        flexShrink: 0, fontSize: '0.65rem', fontWeight: 800,
        color, letterSpacing: '0.14em', textTransform: 'uppercase',
      }}>
        {status}
      </div>
    </div>
  );
}

export default function SignalBoxV2({ video, metrics, channelAvg }) {
  const viewsRatio    = metrics?.viewsRatio ?? 0;
  const likeRate      = metrics?.likeRate ?? (video?.likes && video?.views ? video.likes / video.views : 0);
  const commentRate   = metrics?.commentRate ?? 0;
  const channelLikeRate = channelAvg?.likeRate ?? 0;

  const distribution = classify(viewsRatio, 5, 2);
  const engagementDelta = channelLikeRate > 0
    ? (likeRate - channelLikeRate) / channelLikeRate
    : 0;
  const engagement = channelLikeRate > 0
    ? classify(engagementDelta, 0.2, -0.2)
    : 'STABLE';
  const conversation = classify(commentRate, 0.002, 0.0005);

  const distDetail = viewsRatio >= 2
    ? `${viewsRatio.toFixed(1)}× channel avg — ${distribution === 'HIGH' ? 'strong reach signal' : 'moderate distribution'}`
    : `${viewsRatio.toFixed(1)}× channel avg — below typical reach`;

  const engDetail = channelLikeRate > 0
    ? `${(likeRate * 100).toFixed(2)}% like rate vs ${(channelLikeRate * 100).toFixed(2)}% channel avg`
    : `${(likeRate * 100).toFixed(2)}% like rate — no channel baseline`;

  const convDetail = `${(commentRate * 100).toFixed(3)}% comment rate — ${
    conversation === 'HIGH' ? 'viewers are reacting' :
    conversation === 'STABLE' ? 'typical discussion' :
    'low viewer interaction'
  }`;

  return (
    <div className="chart-card" style={{ border: '1px solid #1a1a1a' }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#444', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 4 }}>
          Live Signals
        </div>
        <div style={{ fontSize: '0.72rem', color: '#3a3a3a' }}>
          Based on public data — no AI required
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SignalRow label="Distribution" status={distribution} detail={distDetail} />
        <SignalRow label="Engagement"   status={engagement}   detail={engDetail} />
        <SignalRow label="Conversation" status={conversation} detail={convDetail} />
      </div>
    </div>
  );
}
