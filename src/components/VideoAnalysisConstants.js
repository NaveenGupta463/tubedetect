export const VIDEO_STAT_TIPS = {
  'Views':          'Total number of times this video has been watched.',
  'Likes':          'Total likes on this video.',
  'Comments':       'Total number of comments on this video.',
  'Engagement Rate':'(Likes + Comments) ÷ Views × 100. Above 3% is excellent. Industry average is ~1-2%.',
  'Like Rate':      'Likes ÷ Views × 100. Shows what percentage of viewers liked the video. Above 2% is strong.',
  'Comment Rate':   'Comments ÷ Views × 100. High comment rate means the video sparked conversation.',
  'Views vs Avg':   'This video\'s views compared to the channel\'s average views per video. Above 100% means it outperformed.',
  'Duration':       'Length of the video in minutes and seconds.',
  'Published':      'Date this video was made public.',
};

export const REPORT_CARD_TIPS = {
  'Views':      'Scored by comparing this video\'s views to the channel\'s average. 100% of avg = good baseline.',
  'Engagement': 'Scored based on (likes + comments) ÷ views. Above 3% scores A, below 0.5% scores F.',
  'Comments':   'Scored based on comments ÷ views. High comment rate = audience is engaged enough to respond.',
  'Title':      'Scored on length (40-70 chars is ideal), use of numbers, questions, and power words.',
  'Timing':     'Scored based on the day of the week published. Thursday/Friday historically perform best.',
};

export const DIMENSION_TIPS = {
  'Title &\nThumb':    'How well the title and thumbnail work together to earn clicks. Combines curiosity, emotional pull, clarity, and visual impact into one score.',
  'Hook &\nRetention': 'Strength of the opening 30 seconds and predicted viewer retention throughout the video. High scores mean fewer viewers click away early.',
  'Structure':         'How well the video is organized — intro, body, pacing, and call-to-action. Good structure keeps viewers watching until the end.',
  'Engagement':        'Predicted ability to drive likes, comments, and shares relative to views. Above 3% engagement is excellent.',
  'Algorithm':         'How well-optimized the video is for YouTube\'s recommendation engine — CTR signals, watch time, and topic relevance all factor in.',
  'SEO':               'Discoverability score — how well the title, tags, and description help YouTube surface this video in search results.',
  'Emotion':           'How strongly the video triggers an emotional response (curiosity, excitement, empathy). Higher emotion = higher shareability and retention.',
  'Value':             'How much practical or entertainment value the video delivers. High value = more subscribers and return viewers.',
};

export const TITLE_SCORE_TIPS = {
  'Curiosity':        'How well the title creates an information gap that makes viewers desperate to click. Open questions, surprising claims, and partial reveals score high.',
  'Emotional':        'Emotional resonance of the title — does it trigger excitement, fear, joy, or desire? Emotionally charged titles outperform neutral ones by 2-3x on average.',
  'Clarity':          'How instantly the viewer understands what the video is about. Overly clever or vague titles hurt CTR even if creative.',
  'Scroll-Stopping':  'The title\'s ability to halt a viewer mid-scroll and demand attention — usually through power words, numbers, or a bold claim.',
};

export const HOOK_TIPS = {
  hookStrength:       'Scored 0-100 based on title style, engagement data, and viewer comment reactions — not the actual video content. Indicates how strong the opening hook likely is.',
  timeline:           'AI-recommended structure for a video of this title, duration, and niche. Claude cannot watch the video, so this is a best-practice guide — not a transcript of what actually happens.',
  retention:          'Predicted retention based on engagement rate, like rate, and comment sentiment — not real YouTube Analytics data. Connect via OAuth on the My Channel tab for actual retention curves.',
  patternInterrupts:  'Suggested pattern interrupt techniques that would work well for this type of content, based on the title and viewer comment tone.',
  curiosityLoops:     'Recommended ways to use open loops to keep viewers watching, inferred from the title style and viewer comment engagement.',
};

export const PSYCH_TRIGGER_TIPS = {
  'Curiosity Gap':      'Withholding just enough information to make the viewer feel they must watch to find out. Heavily used in thumbnails and the first 10 seconds.',
  'Social Proof':       'Using numbers, testimonials, or authority signals ("1M people watched this") to build instant trust and reduce skepticism.',
  'Fear of Missing Out':'Creating urgency or exclusivity so the viewer feels they\'ll lose out if they don\'t watch now. "Last chance", "before it\'s deleted", etc.',
  'Authority':          'Establishing expertise or credibility so viewers trust the information. Credentials, experience, and confident delivery all contribute.',
  'Reciprocity':        'Offering exceptional free value upfront so viewers feel compelled to like, subscribe, or share in return.',
  'Scarcity':           'Making the content feel time-sensitive or rare — "this won\'t work much longer", "limited offer", etc. Drives immediate action.',
  'Pattern Interrupt':  'Breaking viewer expectations at key moments (visual cuts, tone shifts, surprises) to jolt attention back and prevent passive watching.',
  'Storytelling':       'Narrative arc that builds emotional investment — viewers stay engaged because they need to find out what happens next.',
};

export const VIRALITY_TIPS = {
  'Novelty':            'How fresh, unique, or surprising the content is. First-mover advantage on trending topics gets algorithm boosts. Derivative content gets buried.',
  'Controversy':        'Degree to which the content sparks debate or strong opinions. Controversial videos attract more comments, which is a key algorithm engagement signal.',
  'Relatability':       'How closely the content connects to the viewer\'s own life, problems, or desires. High relatability drives shares and saves.',
  'Emotional Intensity':'Peak emotional moment strength — how intensely the video makes viewers feel something at its climax. Stronger emotion = more shares.',
  'Shareability':       'How likely a viewer is to forward this video to someone they know. Humor, surprising revelations, and "you need to see this" moments drive this.',
};

export const ALGO_TIPS = {
  algorithmScore: 'Overall score for how well this video is optimized for YouTube\'s recommendation algorithm. Combines CTR potential, watch time signals, engagement rate, and topic relevance.',
  ctrFactors:     'Elements that influence Click-Through Rate — the percentage of people who see the thumbnail and actually click. YouTube heavily rewards high CTR videos with more impressions.',
  retentionFactors:'Factors that keep viewers watching after they\'ve clicked. YouTube\'s algorithm treats watch time and audience retention as its strongest ranking signals.',
  monetization:   'Revenue-generating layers detected in the video — ads, sponsorships, affiliate products, merchandise, etc.',
};

export const BLUEPRINT_TIPS = {
  overallScore:   'Composite score across all 8 dimensions, weighted by their impact on channel growth. 75+ = strong performer, 55-74 = average, below 55 = needs improvement.',
  contentDNA:     'The core formula that made this video work — distilled into a single sentence. Use this as a template for planning future videos.',
  strengths:      'What this video did well that you should double down on in future content.',
  improvements:   'The highest-leverage changes that would have improved this video\'s performance.',
  blueprint:      'A step-by-step guide to recreate the elements that made this video succeed. Follow these steps when planning your next video.',
  lessons:        'Actionable takeaways derived from this video\'s performance data and AI analysis.',
};
