import { useState } from 'react';
import { formatNum } from '../utils/analysis';
import { REPORT_CARD_TIPS } from './VideoAnalysisConstants';
import TITooltip from './Tooltip';

export default function VideoReportCard({ metrics, video }) {
  const [copied, setCopied] = useState(false);
  const { engagementRate, likeRate, commentRate, viewsRatio } = metrics;
  const title = video.snippet?.title || '';
  const publishedAt = video.snippet?.publishedAt;

  const viewsScore = viewsRatio >= 3 ? 95 : viewsRatio >= 1.5 ? 82 : viewsRatio >= 1.0 ? 65 : viewsRatio >= 0.7 ? 50 : viewsRatio >= 0.4 ? 35 : 20;
  const engScore   = engagementRate >= 5 ? 95 : engagementRate >= 3 ? 82 : engagementRate >= 2 ? 68 : engagementRate >= 1 ? 52 : engagementRate >= 0.5 ? 38 : 20;
  const cmtScore   = commentRate >= 0.3 ? 95 : commentRate >= 0.1 ? 82 : commentRate >= 0.05 ? 65 : commentRate >= 0.02 ? 50 : commentRate >= 0.01 ? 35 : 20;

  let titleScore = 50;
  if (title.length >= 40 && title.length <= 70) titleScore += 20;
  else if (title.length > 100 || title.length < 25) titleScore -= 15;
  if (/\?/.test(title)) titleScore += 10;
  if (/\d/.test(title)) titleScore += 10;
  const upperWords = title.match(/\b[A-Z]{3,}\b/g) || [];
  if (upperWords.length > 0 && upperWords.length <= 3) titleScore += 10;
  titleScore = Math.max(10, Math.min(100, titleScore));

  let timingScore = 58;
  if (publishedAt) {
    const day = new Date(publishedAt).getDay();
    if (day === 4 || day === 5) timingScore = 88;
    else if (day === 6 || day === 0) timingScore = 72;
    else if (day === 3) timingScore = 60;
    else timingScore = 35;
  }

  const getGrade = s => s >= 85 ? 'A+' : s >= 75 ? 'A' : s >= 65 ? 'B' : s >= 55 ? 'C' : s >= 40 ? 'D' : 'F';
  const getColor = s => s >= 75 ? '#00c853' : s >= 55 ? '#ff9100' : s >= 40 ? '#ff6d00' : '#ff1744';

  const cards = [
    { label: 'Views',      score: viewsScore,  detail: `${Math.round(viewsRatio * 100)}% of avg` },
    { label: 'Engagement', score: engScore,     detail: `${engagementRate.toFixed(2)}%` },
    { label: 'Comments',   score: cmtScore,     detail: `${commentRate.toFixed(3)}%` },
    { label: 'Title',      score: titleScore,   detail: `${title.length} chars` },
    { label: 'Timing',     score: timingScore,  detail: publishedAt ? new Date(publishedAt).toLocaleDateString('en-US', { weekday: 'short' }) : '—' },
  ];

  const handleShare = () => {
    const text = [
      `📋 Video Report Card: "${title.slice(0, 60)}"`,
      `Views: ${formatNum(metrics.views)} | Likes: ${formatNum(metrics.likes)} | Engagement: ${engagementRate.toFixed(2)}%`,
      `Grades — Views: ${getGrade(viewsScore)} | Engagement: ${getGrade(engScore)} | Comments: ${getGrade(cmtScore)} | Title: ${getGrade(titleScore)} | Timing: ${getGrade(timingScore)}`,
    ].join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="chart-card">
      <div className="chart-title-row">
        <h3 className="chart-title">📋 Video Report Card</h3>
        <button
          onClick={handleShare}
          style={{
            background: copied ? '#00c85322' : '#1a1a1a',
            border: `1px solid ${copied ? '#00c853' : '#333'}`,
            borderRadius: 6, padding: '5px 12px',
            fontSize: 12, fontWeight: 700,
            color: copied ? '#00c853' : '#888',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {copied ? '✅ Copied!' : '📤 Share Summary'}
        </button>
      </div>
      <p className="chart-subtitle">Performance grades across 5 key dimensions</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginTop: 12 }}>
        {cards.map(c => (
          <TITooltip key={c.label} title={c.label} desc={REPORT_CARD_TIPS[c.label]} placement="top">
            <div style={{
              background: '#111', borderRadius: 10, padding: '14px 10px', textAlign: 'center',
              border: `1px solid ${getColor(c.score)}33`, cursor: 'default',
            }}>
              <div style={{ fontSize: 30, fontWeight: 900, color: getColor(c.score), lineHeight: 1 }}>{getGrade(c.score)}</div>
              <div style={{ fontSize: 12, color: getColor(c.score), fontWeight: 700, marginTop: 4 }}>{c.detail}</div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>{c.label}</div>
            </div>
          </TITooltip>
        ))}
      </div>
    </div>
  );
}
