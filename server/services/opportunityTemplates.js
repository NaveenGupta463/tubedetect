'use strict';

// ── Template matrix ────────────────────────────────────────────────────────────
// Keys are parent_topic values from inferParentTopic() in whatToPost.js:
//   'Economy & Finance' | 'Geopolitics' | 'Science & Tech' | 'Politics'
//   'Society & Health'  | 'Judiciary & Law' | 'Competitive Exams' | 'Sports'
//
// Each entry is a template string with a {topic} placeholder.
// null means "no template for this combination — show raw topic."
// _default is the fallback when the specific category has no entry.

const TEMPLATE_MATRIX = {

  founder_economy_conversation: {
    'Economy & Finance': 'What {topic} reveals about Indian capitalism',
    'Geopolitics':       'Is India prepared for the next {topic} shock?',
    'Science & Tech':    'What {topic} means for founders building in India',
    'Politics':          'How {topic} shapes the rules for Indian founders',
    'Society & Health':  'How {topic} is reshaping Indian business culture',
    'Sports':            'The founder mindset behind {topic}',
    'Judiciary & Law':   'What {topic} signals for business and regulation',
    'Competitive Exams': null,
    _default:            "The founder's lens on {topic}",
  },

  finance_investment_education: {
    'Economy & Finance': 'How {topic} affects your portfolio',
    'Geopolitics':       'What {topic} means for Indian markets',
    'Science & Tech':    '{topic}: what every investor needs to know',
    'Politics':          'How {topic} changes the investment landscape',
    'Society & Health':  'The investment opportunity (and risk) in {topic}',
    'Judiciary & Law':   'How {topic} affects your money and investments',
    'Sports':            null,
    'Competitive Exams': null,
    _default:            'What every investor should know about {topic}',
  },

  business_case_study: {
    'Economy & Finance': 'The business lesson behind {topic}',
    'Geopolitics':       'How {topic} became a global business story',
    'Science & Tech':    'Why {topic} is changing the rules of business',
    'Politics':          'The business consequences of {topic}',
    'Society & Health':  'The untold business story behind {topic}',
    'Sports':            'What businesses can learn from {topic}',
    'Judiciary & Law':   'What {topic} means for business risk and compliance',
    'Competitive Exams': null,
    _default:            'What businesses can learn from {topic}',
  },

  curiosity_explainer: {
    'Economy & Finance': 'Why {topic} matters in everyday India',
    'Geopolitics':       'How {topic} quietly affects ordinary Indians',
    'Science & Tech':    'The hidden system behind {topic}',
    'Politics':          'Why {topic} matters beyond politics',
    'Society & Health':  'What {topic} reveals about how India really works',
    'Judiciary & Law':   'The rule change behind {topic}, explained simply',
    'Competitive Exams': null,
    'Sports':            'The surprising system behind {topic}',
    _default:            'The hidden story behind {topic}',
  },

  indian_business_selfimprovement_podcast: {
    'Economy & Finance': 'What {topic} means for ambitious Indians',
    'Geopolitics':       'How {topic} affects your career and opportunities',
    'Science & Tech':    'How {topic} is creating new opportunities in India',
    'Politics':          'What {topic} means for the entrepreneurial class in India',
    'Society & Health':  'The mindset shift {topic} demands from Indian achievers',
    'Sports':            'The discipline behind {topic} and what creators can learn',
    'Judiciary & Law':   'What {topic} means for business owners in India',
    'Competitive Exams': null,
    _default:            'The success lesson hidden in {topic}',
  },

  personal_finance_guest_show: {
    'Economy & Finance': 'What {topic} means for your savings and loans',
    'Geopolitics':       'How {topic} will hit middle-class finances in India',
    'Science & Tech':    'How {topic} is changing personal finance',
    'Politics':          'How {topic} affects the middle-class wallet',
    'Society & Health':  'What {topic} means for everyday financial decisions',
    'Judiciary & Law':   'What {topic} means for consumers and borrowers',
    'Sports':            null,
    'Competitive Exams': null,
    _default:            'What {topic} means for your everyday financial decisions',
  },

  spiritual_geopolitics_guest_show: {
    'Geopolitics':       'The hidden forces behind {topic}',
    'Society & Health':  'What {topic} reveals about consciousness and culture',
    'Politics':          'The deeper pattern behind {topic}',
    'Economy & Finance': 'What {topic} reveals about power and civilization',
    'Science & Tech':    'How {topic} connects ancient wisdom and modern reality',
    _default:            'The deeper truth behind {topic}',
  },

  exam_demand_teaching: {
    'Geopolitics':       '{topic} for UPSC Prelims and Mains',
    'Economy & Finance': '{topic}: key concepts for competitive exams',
    'Politics':          '{topic}: what aspirants need to know',
    'Society & Health':  '{topic}: important for GS Paper 2 and 3',
    'Judiciary & Law':   '{topic}: key judgments and constitutional dimensions',
    'Competitive Exams': '{topic}: exam strategy and coverage',
    'Science & Tech':    '{topic}: science and technology angle for UPSC',
    'Sports':            null,
    _default:            '{topic} for UPSC, SSC, and competitive exams',
  },

  tech_review_gadget: {
    'Science & Tech': '{topic}: full review and verdict',
    _default:         'Is {topic} worth it? Honest review',
  },

  general_education: {
    'Geopolitics':       '{topic} explained simply',
    'Economy & Finance': '{topic}: everything you need to know',
    'Science & Tech':    '{topic} explained for beginners',
    'Politics':          '{topic}: the simple explainer',
    'Society & Health':  '{topic}: understanding the issue clearly',
    _default:            '{topic} explained',
  },

  // News channels: raw phrases are correct — do not transform them.
  news_event_bulletin: {
    _default: null,
  },
};

/**
 * Returns whether an idea is specific enough for angle template application.
 *
 * Gate: idea.parent_topic must be non-null.
 * parent_topic is set by inferParentTopic() in whatToPost.js only when the phrase
 * contains recognizable keywords (bank, market, war, startup, cricket, AI, etc.).
 * Generic artifacts — "Long Term", "Cap Fund", "India", "What Means" — get
 * parent_topic=null and are left as raw phrases.
 *
 * Note: the locked decision used "topic_category" but that field stores event
 * lifecycle values (news_event/seasonal/evergreen), not readable categories.
 * parent_topic is the correct field for this purpose.
 */
function isTemplateEligible(idea) {
  return idea.parent_topic != null;
}

/**
 * Decorates a single idea with a CSP-specific angle title.
 * Pure function — never mutates the input idea.
 *
 * Returns the original idea extended with:
 *   angle_title:      string | null  — formatted angle, null if not templateable
 *   template_id:      string | null  — stable key for suggestion_history
 *   template_applied: boolean        — false means show raw topic
 */
function decorateIdeaWithAngle(idea, cspPrimary) {
  const notApplied = { ...idea, angle_title: null, template_id: null, template_applied: false };

  if (idea.action_title) {
    const safeSource = idea.source === 'territory_expansion'
      ? `territory_expansion__${(idea.territory_id || 'territory').replace(/[^a-z0-9]/gi, '_').toLowerCase()}`
      : `${(idea.source || idea.idea_type || idea.recommendation_type || 'action').replace(/[^a-z0-9]/gi, '_').toLowerCase()}__action`;
    return {
      ...idea,
      angle_title: idea.action_title,
      template_id: safeSource,
      template_applied: true,
    };
  }

  if (!isTemplateEligible(idea) || !cspPrimary) return notApplied;

  const cspTemplates = TEMPLATE_MATRIX[cspPrimary];
  if (!cspTemplates) return notApplied;

  const templateStr = (idea.parent_topic in cspTemplates)
    ? cspTemplates[idea.parent_topic]
    : cspTemplates._default ?? null;
  if (!templateStr) return notApplied;

  // Use the topic as-is (WTP already title-cases it at line 835: phrase.replace(/\b\w/g, c => c.toUpperCase()))
  const angle_title = templateStr.replace('{topic}', idea.topic);

  // Stable template_id — no channel_id so it is cross-creator comparable
  const safeCat = (idea.parent_topic || 'default').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const template_id = `${cspPrimary}__${safeCat}`;

  return { ...idea, angle_title, template_id, template_applied: true };
}

/**
 * Groups an array of already-decorated ideas into three display lanes.
 * Ideas are assigned to the first matching lane only (mutually exclusive).
 * Angle ideas (is_angle=true) are excluded — they belong to their parent's lane.
 *
 * Undercovered floor: channel_count >= 2 ensures cross-peer evidence.
 */
function groupIdeasIntoLanes(ideas) {
  const actNow      = [];
  const evergreen   = [];
  const undercovered = [];

  for (const idea of ideas) {
    if (idea.is_angle) continue;

    if (idea.act_now || idea.trend_status === 'rising') {
      actNow.push(idea);
    } else if (idea.trend_status === 'evergreen' && idea.saturation_level !== 'high') {
      evergreen.push(idea);
    } else if (
      idea.saturation_level === 'low' &&
      idea.channel_count >= 2 &&
      idea.trend_status !== 'rising' &&
      idea.trend_status !== 'peaking'
    ) {
      undercovered.push(idea);
    }
  }

  return {
    act_now:      actNow.slice(0, 10),
    evergreen:    evergreen.slice(0, 10),
    undercovered: undercovered.slice(0, 8),
  };
}

/**
 * One-shot: decorate ideas + build lanes.
 * Returns { ideas: decorated[], lanes: { act_now, evergreen, undercovered } }.
 * ideas[] is backwards-compatible with the existing API; lanes{} is additive.
 */
function buildOpportunityResponse(ideas, cspPrimary) {
  const decorated = ideas.map(idea => decorateIdeaWithAngle(idea, cspPrimary));
  const lanes     = groupIdeasIntoLanes(decorated);
  return { ideas: decorated, lanes };
}

module.exports = {
  TEMPLATE_MATRIX,
  isTemplateEligible,
  decorateIdeaWithAngle,
  groupIdeasIntoLanes,
  buildOpportunityResponse,
};
