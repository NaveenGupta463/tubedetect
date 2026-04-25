function computeSignalState(viewsRatio) {
  if (viewsRatio > 3)   return 'STRONG';
  if (viewsRatio >= 1.5) return 'STABLE';
  return 'WEAK';
}

function analyzeComments(comments) {
  const positive  = ['amazing', 'best', 'love', 'great', 'awesome', 'incredible', 'perfect', 'excellent', 'fantastic', 'brilliant'];
  const negative  = ['bad', 'boring', 'clickbait', 'waste', 'terrible', 'awful', 'disappointing', 'worst', 'useless', 'misleading'];
  const confusion = ['why', 'how', 'confusing', "don't understand", 'confused', 'unclear', 'lost', 'makes no sense', 'what does'];

  let positiveCount  = 0;
  let negativeCount  = 0;
  let confusionCount = 0;

  for (const c of comments) {
    const text = (c.snippet?.topLevelComment?.snippet?.textDisplay || '').toLowerCase().replace(/<[^>]+>/g, '');
    if (positive.some(k  => text.includes(k))) positiveCount++;
    if (negative.some(k  => text.includes(k))) negativeCount++;
    if (confusion.some(k => text.includes(k))) confusionCount++;
  }

  return { positiveCount, negativeCount, confusionCount, total: comments.length };
}

function determineCommentSentiment({ positiveCount, negativeCount, confusionCount, total }) {
  if (total === 0) return 'UNKNOWN';
  const max = Math.max(positiveCount, negativeCount, confusionCount);
  if (max === 0) return 'MIXED';
  if (max === confusionCount && confusionCount > positiveCount && confusionCount > negativeCount) return 'CONFUSION';
  if (max === negativeCount  && negativeCount  > positiveCount) return 'NEGATIVE';
  if (max === positiveCount) return 'POSITIVE';
  return 'MIXED';
}

function generateNarrative(signal, sentiment) {
  const map = {
    STRONG: {
      POSITIVE:  "YouTube is actively pushing this video and viewers are loving it",
      NEGATIVE:  "This video is getting reach, but negative reactions may slow it down",
      CONFUSION: "YouTube is pushing this video, but some viewers are confused",
      MIXED:     "YouTube is distributing this video widely, but viewer reactions are split",
      UNKNOWN:   "YouTube is pushing this video hard — viewer reaction is still forming",
    },
    STABLE: {
      POSITIVE:  "This video is holding steady and viewers who find it tend to enjoy it",
      NEGATIVE:  "Distribution is average and viewers aren't reacting warmly",
      CONFUSION: "The video is reaching people, but the message isn't landing clearly",
      MIXED:     "Performance is steady, but the audience is divided on the content",
      UNKNOWN:   "This video is performing at channel level — no strong signal either way",
    },
    WEAK: {
      POSITIVE:  "Viewers like this content, but YouTube hasn't picked it up yet",
      NEGATIVE:  "This video is struggling and viewers aren't responding well",
      CONFUSION: "Low reach and confused viewers — the hook or title may need rethinking",
      MIXED:     "This video hasn't broken through yet, and reception is uncertain",
      UNKNOWN:   "This video is underperforming and comment data is too thin to read",
    },
  };

  return map[signal]?.[sentiment] ?? "Performance signals are present but the picture isn't clear yet";
}

const BADGE_STYLES = {
  STRONG: { color: '#22c55e', bg: '#052e16', border: '#14532d' },
  STABLE: { color: '#eab308', bg: '#1c1400', border: '#422006' },
  WEAK:   { color: '#f97316', bg: '#1c0a00', border: '#431407' },
};

export default function SignalNarrative({ video, metrics, channelAvg, comments }) {
  const viewsRatio = metrics?.viewsRatio ?? (
    channelAvg?.views > 0 ? (video?.views ?? 0) / channelAvg.views : 0
  );

  const signal    = computeSignalState(viewsRatio);
  const counts    = analyzeComments(comments ?? []);
  const sentiment = determineCommentSentiment(counts);
  const narrative = generateNarrative(signal, sentiment);

  const badge = BADGE_STYLES[signal];
  const hasComments = (comments?.length ?? 0) > 0;

  return (
    <div className="chart-card" style={{ border: '1px solid #1a1a1a' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>

        <div style={{
          flexShrink: 0, marginTop: 2,
          padding: '4px 10px', borderRadius: 6,
          background: badge.bg, border: `1px solid ${badge.border}`,
          fontSize: '0.6rem', fontWeight: 800, color: badge.color,
          letterSpacing: '0.14em', textTransform: 'uppercase',
        }}>
          {signal}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#e4e4e7', lineHeight: 1.5, marginBottom: 6 }}>
            {narrative}.
          </div>
          <div style={{ fontSize: '0.72rem', color: '#3a3a3a' }}>
            {hasComments
              ? `Analyzed ${counts.total} comment${counts.total !== 1 ? 's' : ''} — unlock full analysis to see exactly what to fix`
              : 'Unlock full analysis to see exactly what to fix'}
          </div>
        </div>

      </div>
    </div>
  );
}
