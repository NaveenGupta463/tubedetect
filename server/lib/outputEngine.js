'use strict';

// ── Output Engine Builder ─────────────────────────────────────────────────────
// Maps creator classification (creator_mode × routing_profile × format_profile)
// to a profile-specific output framing object sent to the frontend.
//
// guest_interview is handled by the existing podcast-intel path — this builder
// returns null for it so the response stays unchanged.
//
// Returns null for channels with no matching engine (generic output).

// UPSC exam-calendar context note, keyed by month index (0=Jan).
const UPSC_CALENDAR = [
  'Prelims are ~5 months away — GS foundation and syllabus topics have maximum runway now.',
  'Prelims are 4 months away — GS Paper 1 and 2 deep-dives are performing well.',
  'Prelims are 3 months away — current affairs and revision topics are rising fast.',
  'Prelims are weeks away — strategy, mock tests, and current affairs peak now.',
  'Prelims are weeks away — last-minute strategy and quick-revision topics are urgent.',
  'Prelims typically in June — paper analysis and answer-key videos peak immediately after.',
  'Post-Prelims: Mains prep begins — answer writing and optional subject topics now.',
  'Mains prep is underway — GS Paper 3 and 4 and essay-writing topics gaining traction.',
  'Mains are approaching — answer writing quality and optional deep-dives peak now.',
  'Mains typically in October — last-push answer writing and revision topics.',
  'Post-Mains: Interview prep, DAF filling, and planning-ahead videos resonate now.',
  'Year-end: Strategy planning, syllabus overview, and motivation content peak now.',
];

// Keyword lists used to tag each idea with an exam-domain category.
const EXAM_TAG_KEYWORDS = {
  syllabus_topic: [
    'polity', 'constitution', 'history', 'geography', 'economy', 'environment',
    'science', 'ethics', 'gs paper', 'gs1', 'gs2', 'gs3', 'gs4', 'optional',
    'art and culture', 'governance', 'society', 'international relations',
    'disaster management', 'internal security', 'modern history', 'ancient',
    'medieval', 'physical geography', 'human geography', 'biodiversity',
    'climate', 'ecology', 'agriculture', 'social justice', 'rights',
  ],
  current_affairs: [
    'current affairs', 'this month', 'this week', 'today', 'recent', 'latest',
    'news analysis', 'daily news', 'monthly', 'weekly roundup', 'pib', 'editorial',
    'newspaper', 'the hindu', 'indian express', 'vision ias', 'monthly magazine',
  ],
  strategy: [
    'strategy', 'how to prepare', 'preparation', 'tips', 'guide', 'plan',
    'timetable', 'schedule', 'topper', 'success story', 'beginners', 'start',
    'cracking upsc', 'upsc journey', 'study plan', 'roadmap', 'rank', 'attempt',
    'first attempt', 'self study', 'coaching', 'resources', 'books',
  ],
  paper_analysis: [
    'paper analysis', 'paper review', 'question paper', 'cut off', 'expected marks',
    'previous year', 'past papers', 'answer key', 'score analysis', 'trend analysis',
    'important topics', 'frequently asked', 'weightage',
  ],
  exam_update: [
    'admit card', 'notification', 'calendar', 'exam date', 'result',
    'syllabus change', 'pattern change', 'upsc notification', 'hall ticket',
    'vacancy', 'marks release', 'interview list', 'merit list', 'daf',
  ],
};

function tagIdea(topic, engineId) {
  if (engineId !== 'exam_demand') return null;
  const tl = (topic || '').toLowerCase();
  for (const [tag, keywords] of Object.entries(EXAM_TAG_KEYWORDS)) {
    if (keywords.some(kw => tl.includes(kw))) return tag;
  }
  return null;
}

function buildOutputEngine({ creatorMode, routingProfile, formatProfile, nowMs }) {
  // guest_interview → existing podcast-intel path handles it; no engine override
  if (formatProfile === 'guest_interview') return null;

  const isUpsc = creatorMode === 'upsc' || routingProfile === 'upsc_exam';
  if (isUpsc) {
    const month = new Date(nowMs || Date.now()).getMonth(); // 0-indexed
    return {
      engine_id:   'exam_demand',
      question:    'What exam demand, syllabus area, paper pattern, or strategy topic is rising right now?',
      labels: {
        topic_gap:      'Demand Gap',
        trending_angle: 'Rising Demand',
        act_now:        'Exam window',
        coverage_score: 'Exam Saturation',
      },
      hide_sections: ['world_signals', 'guest_intel', 'trending_india'],
      calendar_note: UPSC_CALENDAR[month],
      filter_tabs: [
        { id: 'all',             label: 'All'            },
        { id: 'syllabus_topic',  label: 'Syllabus'       },
        { id: 'current_affairs', label: 'Current Affairs' },
        { id: 'strategy',        label: 'Strategy'       },
        { id: 'paper_analysis',  label: 'Paper Analysis' },
        { id: 'exam_update',     label: 'Exam Updates'   },
      ],
    };
  }

  return null;
}

module.exports = { buildOutputEngine, tagIdea };
