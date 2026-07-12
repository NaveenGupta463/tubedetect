'use strict';

/**
 * Opportunity Extractor — Phase 2
 *
 * Architecture: Topic → Concept → Opportunity
 *
 * Each concept_id maps to a set of opportunities (sub-niches / content formats).
 * Extraction uses pattern matching on: generated_title, raw_subject, family, archetype.
 *
 * Returns: { opportunity_id, opportunity_label, opportunity_confidence }
 *
 * confidence bands:
 *   0.85+  high   — explicit pattern match on title
 *   0.70   medium — pattern match on subject only
 *   0.55   low    — concept-level family fallback
 */

// ── Opportunity Taxonomy ───────────────────────────────────────────────────────
// Each entry: { id, label, patterns[] }
// Patterns are tested against generated_title (primary) and raw_subject (secondary).

const OPPORTUNITY_TAXONOMY = {

  // ── Comedy / Entertainment ────────────────────────────────────────────────
  comedy_drama_skit: [
    {
      id: 'family_drama',
      label: 'family drama or domestic conflict skit',
      patterns: [
        /\b(family|household|ghar|mom|mother|dad|father|parents?|bhai|sister|bhabhi|saas|sasur|joint\s+family)\b/i,
        /\b(kitchen|bathroom|dinner|ghar|household|domestic|home\s+life)\b/i,
      ],
    },
    {
      id: 'husband_wife_comedy',
      label: 'husband-wife or couple comedy',
      patterns: [
        /\b(husband|wife|pati|patni|couple|marriage|wedding|shaadi|newlywed)\b/i,
      ],
    },
    {
      id: 'parody_celebrity',
      label: 'celebrity or creator parody / roast',
      patterns: [
        /\b(parody|roast|if\s+\w+\s+had|honest\s+conversation|honest\s+version|spoof)\b/i,
        /\b(carryminati|bbki|bhuvan\s+bam|triggered|amit\s+bhadana|ashish|sharma|kapil\s+sharma|elvish)\b/i,
      ],
    },
    {
      id: 'school_college_comedy',
      label: 'school, college, or student comedy',
      patterns: [
        /\b(school|college|student|teacher|class|exam|hostel|campus|principal|sir|madam)\b/i,
      ],
    },
    {
      id: 'village_local_comedy',
      label: 'village or local culture comedy',
      patterns: [
        /\b(village|gaon|desi|local|rural|uncle|aunty|bhaiya|chacha|mama|nana)\b/i,
      ],
    },
    {
      id: 'relatable_situation_comedy',
      label: 'relatable everyday situation comedy',
      patterns: [
        /\b(relatable|everyone\s+does|we\s+all|most\s+people|common|typical|every\s+(indian|day|time))\b/i,
      ],
    },
  ],

  // ── Food ────────────────────────────────────────────────────────────────────
  street_food_regional: [
    {
      id: 'food_challenge',
      label: 'food eating challenge or extreme food experience',
      patterns: [
        /\b(challenge|eating\s+challenge|most\s+spicy|hottest|coldest|weirdest|biggest|giant|extreme)\b/i,
      ],
    },
    {
      id: 'street_food_hunt',
      label: 'street food discovery or food tour',
      patterns: [
        /\b(street\s+food|food\s+tour|food\s+hunt|food\s+trail|exploring|trying|best\s+food\s+in|hidden\s+(gem|spot)|local\s+food)\b/i,
      ],
    },
    {
      id: 'cooking_secret',
      label: 'secret recipe or cooking technique reveal',
      patterns: [
        /\b(secret|real\s+recipe|actual\s+recipe|how\s+they\s+make|restaurant\s+secret|chef\s+technique|ingredient\s+mistake|ruins)\b/i,
      ],
    },
    {
      id: 'regional_specialty',
      label: 'regional or cultural cuisine content',
      patterns: [
        /\b(biryani|thali|dosa|idli|paneer|paratha|rajma|chole|dal|sabzi|regional\s+twist|desi|traditional|village\s+food|grandma)\b/i,
      ],
    },
    {
      id: 'budget_food',
      label: 'budget, price comparison, or value food content',
      patterns: [
        /\b(budget|cheap|affordable|₹\s*\d+|vs\s+restaurant|price|worth\s+it|expensive\s+vs|rupee)\b/i,
      ],
    },
  ],

  cooking_recipe: [
    {
      id: 'recipe_tutorial',
      label: 'step-by-step recipe tutorial',
      patterns: [
        /\b(recipe|how\s+to\s+(make|cook|prepare)|step\s+by\s+step|easy\s+recipe|quick\s+recipe|beginners?\s+recipe)\b/i,
      ],
    },
    {
      id: 'cooking_hack',
      label: 'cooking hack, shortcut, or kitchen tip',
      patterns: [
        /\b(hack|shortcut|trick|tip|secret|easier\s+way|faster|instant|without|no\s+oven|microwave)\b/i,
      ],
    },
    {
      id: 'ingredient_swap',
      label: 'ingredient substitution or comparison',
      patterns: [
        /\b(instead\s+of|substitute|swap|replace|vs\s+(ingredient|version)|budget\s+version|without)\b/i,
      ],
    },
    {
      id: 'restaurant_recreation',
      label: 'restaurant recipe or food recreated at home',
      patterns: [
        /\b(restaurant|dhaba|hotel|cafe|style|version\s+vs|at\s+home|homemade|copycat)\b/i,
      ],
    },
    {
      id: 'health_recipe',
      label: 'healthy or diet-specific recipe',
      patterns: [
        /\b(healthy|protein|low\s+calorie|diet|keto|vegan|sugar[\s-]free|gluten[\s-]free|weight\s+loss)\b/i,
      ],
    },
  ],

  food_taste_challenge: [
    {
      id: 'mukbang',
      label: 'mukbang or large-quantity eating content',
      patterns: [
        /\b(mukbang|eating\s+show|asmr\s+eating|big\s+bite|massive\s+meal|giant\s+portion)\b/i,
      ],
    },
    {
      id: 'weird_food',
      label: 'weird, unusual, or extreme food combinations',
      patterns: [
        /\b(weird|unusual|strange|disgusting|gross|bizarre|never\s+tried|exotic|worst|best\s+worst|combination)\b/i,
      ],
    },
    {
      id: 'food_price_challenge',
      label: 'food price tier challenge (₹10 vs ₹10000)',
      patterns: [
        /\b(₹\s*\d+|rupee|expensive|cheapest|most\s+expensive|luxury\s+vs|budget\s+vs|price\s+challenge)\b/i,
      ],
    },
    {
      id: 'taste_test_blind',
      label: 'blind taste test or brand comparison',
      patterns: [
        /\b(blind\s+taste|taste\s+test|which\s+is\s+better|brand\s+vs|real\s+vs\s+fake|original\s+vs)\b/i,
      ],
    },
  ],

  // ── Travel ──────────────────────────────────────────────────────────────────
  travel_exploration: [
    {
      id: 'hidden_gem',
      label: 'hidden gem or underrated destination',
      patterns: [
        /\b(hidden|underrated|unknown|unexplored|secret\s+(place|spot|destination)|nobody\s+talks\s+about)\b/i,
      ],
    },
    {
      id: 'destination_guide',
      label: 'destination travel guide or itinerary',
      patterns: [
        /\b(guide|itinerary|travel\s+to|visiting|how\s+to\s+(reach|visit|get\s+to)|complete\s+guide|day\s+trip)\b/i,
      ],
    },
    {
      id: 'budget_travel',
      label: 'budget travel or cost breakdown',
      patterns: [
        /\b(budget|cheap|afford|₹\s*\d+|cost\s+of|how\s+much\s+does|backpack|shoestring|zero\s+budget)\b/i,
      ],
    },
    {
      id: 'local_culture',
      label: 'local culture, food, or people experience',
      patterns: [
        /\b(local|culture|people|tradition|festival|food\s+trail|authentic|village|community)\b/i,
      ],
    },
    {
      id: 'travel_vlog',
      label: 'travel vlog or personal journey',
      patterns: [
        /\b(vlog|my\s+trip|went\s+to|solo\s+travel|solo\s+trip|we\s+visited|day\s+in|24\s+hours\s+in)\b/i,
      ],
    },
  ],

  // ── Fitness / Health ────────────────────────────────────────────────────────
  fitness_health: [
    {
      id: 'workout_challenge',
      label: 'workout challenge or transformation journey',
      patterns: [
        /\b(challenge|transformation|30[\s-]day|7[\s-]day|before\s+and\s+after|week\s+challenge|results)\b/i,
      ],
    },
    {
      id: 'home_workout',
      label: 'home workout or no-equipment exercise',
      patterns: [
        /\b(home\s+workout|at\s+home|no\s+equipment|no\s+gym|bodyweight|zero\s+equipment|bedroom)\b/i,
      ],
    },
    {
      id: 'diet_nutrition',
      label: 'diet plan or nutrition content',
      patterns: [
        /\b(diet|nutrition|meal\s+plan|what\s+i\s+eat|calorie|protein|carb|fat|macros|weight\s+loss\s+diet|bulking)\b/i,
      ],
    },
    {
      id: 'sport_specific',
      label: 'sport-specific or skill training',
      patterns: [
        /\b(cricket|football|basketball|badminton|gym\s+tip|powerlifting|running|cycling|swimming|yoga|calisthenics)\b/i,
      ],
    },
    {
      id: 'beginner_mistake',
      label: 'beginner mistake or common error in fitness',
      patterns: [
        /\b(beginner|mistake|wrong|common\s+error|avoid|don\'t\s+do|most\s+people\s+get|what\s+not\s+to)\b/i,
      ],
    },
  ],

  // ── Wellness / Mental health ─────────────────────────────────────────────────
  mental_wellness: [
    {
      id: 'anxiety_management',
      label: 'anxiety, stress, or mental health management',
      patterns: [
        /\b(anxiety|stress|panic|overthinking|worry|mental\s+health|depression|burnout|emotional)\b/i,
      ],
    },
    {
      id: 'meditation_mindfulness',
      label: 'meditation or mindfulness practice',
      patterns: [
        /\b(meditation|mindfulness|breath|breathwork|calm|peace|inner\s+peace|silence|dhyana)\b/i,
      ],
    },
    {
      id: 'self_improvement',
      label: 'self-improvement or habit building',
      patterns: [
        /\b(self[\s-]improvement|habit|discipline|productivity|morning\s+routine|goal|growth\s+mindset|discipline)\b/i,
      ],
    },
    {
      id: 'toxic_relationship',
      label: 'toxic relationships or people-pleasing',
      patterns: [
        /\b(toxic|people[\s-]pleasing|boundaries|narcissist|manipulation|abuse|red\s+flag|leave)\b/i,
      ],
    },
  ],

  // ── Spirituality / Mythology ─────────────────────────────────────────────────
  mythology_devotional: [
    {
      id: 'deity_story',
      label: 'Hindu deity story or mythology explainer',
      patterns: [
        /\b(ram|shiva|krishna|vishnu|durga|hanuman|ganesha|lakshmi|saraswati|kali|brahma)\b/i,
        /\b(ramayan|mahabharat|bhagavad\s+gita|purana|upanishad|vedic)\b/i,
      ],
    },
    {
      id: 'pilgrimage_temple',
      label: 'pilgrimage, temple visit, or sacred site',
      patterns: [
        /\b(temple|mandir|pilgrimage|tirth|kashi|varanasi|mathura|vrindavan|tirupati|shirdi|amarnath|char\s+dham)\b/i,
      ],
    },
    {
      id: 'festival_content',
      label: 'Hindu festival or celebration content',
      patterns: [
        /\b(diwali|navratri|janmashtami|ganesh\s+chaturthi|holi|durga\s+puja|onam|pongal|baisakhi|eid|raksha\s+bandhan)\b/i,
      ],
    },
    {
      id: 'spiritual_teaching',
      label: 'spiritual discourse or life lesson from scripture',
      patterns: [
        /\b(sadhana|bhajan|satsang|pravachan|discourse|teaching|lesson\s+from|gita\s+says|shlokas?|mantra)\b/i,
      ],
    },
    {
      id: 'sanatan_culture',
      label: 'Sanatan dharma or Hindu culture content',
      patterns: [
        /\b(sanatan|dharma|karma|moksha|ahimsa|vedic\s+way|hindu\s+culture|ancient\s+wisdom|yoga\s+philosophy)\b/i,
      ],
    },
  ],

  // ── News / Politics ──────────────────────────────────────────────────────────
  news_current_events: [
    {
      id: 'geopolitical_analysis',
      label: 'geopolitical crisis or international relations',
      patterns: [
        /\b(war|conflict|iran|israel|ukraine|russia|china|nato|sanctions|ceasefire|nuclear|missile|strike)\b/i,
      ],
    },
    {
      id: 'viral_news_breakdown',
      label: 'viral news story or trending event explained',
      patterns: [
        /\b(explained|breakdown|what\s+happened|full\s+story|timeline|everything\s+you\s+need|decoded)\b/i,
      ],
    },
    {
      id: 'india_news',
      label: 'India-specific news or current affairs',
      patterns: [
        /\b(india|indian|modi|bjp|parliament|delhi|budget|economy\s+india|rbi|rupee|sensex|nifty)\b/i,
      ],
    },
    {
      id: 'crisis_coverage',
      label: 'crisis, disaster, or emergency coverage',
      patterns: [
        /\b(crisis|disaster|emergency|flood|earthquake|cyclone|accident|collapse|attack|explosion)\b/i,
      ],
    },
    {
      id: 'investigative_expose',
      label: 'investigative or expose journalism',
      patterns: [
        /\b(exposed|expose|scandal|scam|fraud|corruption|cover[\s-]up|leaked|inside\s+story|truth\s+behind)\b/i,
      ],
    },
  ],

  political_commentary: [
    {
      id: 'election_coverage',
      label: 'election campaign, results, or analysis',
      patterns: [
        /\b(election|vote|voting|ballot|constituency|seat|campaign|candidate|manifesto|poll|exit\s+poll)\b/i,
      ],
    },
    {
      id: 'policy_analysis',
      label: 'government policy or budget analysis',
      patterns: [
        /\b(policy|budget|scheme|bill|law|act|regulation|amendment|ordinance|reform|implementation)\b/i,
      ],
    },
    {
      id: 'political_scandal',
      label: 'political scandal or controversy',
      patterns: [
        /\b(scandal|controversy|allegation|accused|FIR|ED|CBI|arrest|corruption|bribery|resign)\b/i,
      ],
    },
    {
      id: 'opposition_analysis',
      label: 'opposition politics or party comparison',
      patterns: [
        /\b(opposition|congress|aap|sp|bsp|tmc|rahul|kejriwal|mamata|akhilesh|priyanka)\b/i,
      ],
    },
  ],

  // ── Finance ──────────────────────────────────────────────────────────────────
  finance_investing: [
    {
      id: 'market_crash',
      label: 'market crash, correction, or crisis analysis',
      patterns: [
        /\b(crash|correction|fall|collapse|bear\s+market|sell[\s-]off|crisis|black\s+(monday|swan))\b/i,
      ],
    },
    {
      id: 'investment_mistake',
      label: 'investment mistake or financial warning',
      patterns: [
        /\b(mistake|wrong|avoid|before\s+you|don\'t\s+(invest|trust)|red\s+flag|warning|trap|scam|ponzi)\b/i,
      ],
    },
    {
      id: 'wealth_building',
      label: 'wealth building or passive income strategy',
      patterns: [
        /\b(wealth|rich|crorepati|passive\s+income|financial\s+freedom|retire\s+early|multiple\s+income|side\s+income)\b/i,
      ],
    },
    {
      id: 'stock_analysis',
      label: 'stock, mutual fund, or SIP analysis',
      patterns: [
        /\b(stock|mutual\s+fund|sip|nifty|sensex|equity|smallcap|midcap|IPO|demat|zerodha|groww)\b/i,
      ],
    },
    {
      id: 'tax_saving',
      label: 'tax planning or personal finance management',
      patterns: [
        /\b(tax|ITR|80C|HRA|salary|income\s+tax|GST|EPF|PPF|NPS|deduction|rebate|refund)\b/i,
      ],
    },
    {
      id: 'hidden_opportunity',
      label: 'hidden or underrated financial opportunity',
      patterns: [
        /\b(hidden|underrated|overlooked|nobody\s+talks|secret\s+(investment|opportunity)|most\s+people\s+miss)\b/i,
      ],
    },
  ],

  // ── Business / Startup ────────────────────────────────────────────────────
  business_startup: [
    {
      id: 'founder_story',
      label: 'founder journey or startup origin story',
      patterns: [
        /\b(founder|started|built|journey|story\s+of|how\s+i\s+(built|started|created)|from\s+zero)\b/i,
      ],
    },
    {
      id: 'startup_mistake',
      label: 'startup mistake or failure analysis',
      patterns: [
        /\b(mistake|failure|failed|why\s+startups?\s+fail|lessons?|what\s+went\s+wrong|avoid|learnt)\b/i,
      ],
    },
    {
      id: 'business_model',
      label: 'business model breakdown or case study',
      patterns: [
        /\b(business\s+model|how\s+does\s+\w+\s+make\s+money|revenue|case\s+study|breakdown|profit|hidden\s+business)\b/i,
      ],
    },
    {
      id: 'growth_hack',
      label: 'growth, marketing, or scaling strategy',
      patterns: [
        /\b(growth|scale|marketing|viral|acquisition|strategy|hack|obsessed|brands?\s+(are|do)|customer)\b/i,
      ],
    },
    {
      id: 'side_hustle',
      label: 'side hustle or solopreneur content',
      patterns: [
        /\b(side\s+hustle|freelance|solopreneur|online\s+business|passive\s+income|make\s+money\s+online|digital\s+business)\b/i,
      ],
    },
  ],

  // ── Education / Explainer ──────────────────────────────────────────────────
  explainer_education: [
    {
      id: 'concept_breakdown',
      label: 'concept explainer or educational breakdown',
      patterns: [
        /\b(explained|how\s+does|what\s+is|why\s+does|breakdown|the\s+science\s+of|decoded|demystified|for\s+beginners?)\b/i,
      ],
    },
    {
      id: 'history_explained',
      label: 'history or historical event explainer',
      patterns: [
        /\b(history|historical|ancient|origin|story\s+of|how\s+it\s+started|first\s+time|timeline\s+of|century|empire)\b/i,
      ],
    },
    {
      id: 'myth_busting',
      label: 'myth busting or misconception correction',
      patterns: [
        /\b(myth|wrong|misconception|not\s+true|actually|people\s+get\s+wrong|what\s+nobody\s+tells|truth\s+about|debunk)\b/i,
      ],
    },
    {
      id: 'science_mystery',
      label: 'science mystery or surprising fact',
      patterns: [
        /\b(science|physics|chemistry|biology|space|universe|mystery|phenomenon|baffles|engineers|scientists?|researchers?)\b/i,
      ],
    },
    {
      id: 'documentary_style',
      label: 'documentary-style deep dive',
      patterns: [
        /\b(documentary|deep\s+dive|inside\s+(story|look)|full\s+story|untold|real\s+story|hidden\s+truth|what\s+really\s+happened)\b/i,
      ],
    },
  ],

  // ── Technology / AI ──────────────────────────────────────────────────────────
  ai_technology: [
    {
      id: 'ai_tool_review',
      label: 'AI tool review or tutorial',
      patterns: [
        /\b(chatgpt|gpt|claude|gemini|midjourney|stable\s+diffusion|dall[\s-]?e|copilot|perplexity|sora|ai\s+tool)\b/i,
      ],
    },
    {
      id: 'tech_future_prediction',
      label: 'technology future prediction or trend analysis',
      patterns: [
        /\b(future\s+of|next\s+(5|10)\s+years|prediction|trend|will\s+replace|automation|robot|disruption)\b/i,
      ],
    },
    {
      id: 'tech_explained',
      label: 'technology concept explained for non-experts',
      patterns: [
        /\b(explained|how\s+(ai|technology|algorithm|blockchain|quantum)\s+works|for\s+beginners?|simply\s+explained|non[\s-]techie)\b/i,
      ],
    },
    {
      id: 'ai_crisis',
      label: 'AI risk, job displacement, or tech crisis',
      patterns: [
        /\b(crisis|threat|danger|risk|job\s+loss|replace\s+humans|ai\s+takeover|bias|regulation|ban)\b/i,
      ],
    },
  ],

  // ── Product Review ────────────────────────────────────────────────────────
  product_review: [
    {
      id: 'detailed_review',
      label: 'detailed product review after real use',
      patterns: [
        /\b(review|verdict|after\s+\d+\s+(days?|months?|weeks?)|real[\s-]life|honest\s+review|daily\s+use|long[\s-]term)\b/i,
      ],
    },
    {
      id: 'comparison',
      label: 'product comparison or head-to-head',
      patterns: [
        /\b(vs\.?|versus|compare|comparison|which\s+is\s+better|head[\s-]to[\s-]head|battle)\b/i,
      ],
    },
    {
      id: 'budget_vs_premium',
      label: 'budget vs premium or value-for-money test',
      patterns: [
        /\b(budget|affordable|value\s+for\s+money|premium|expensive\s+vs|worth\s+(it|buying)|best\s+under\s+₹)\b/i,
      ],
    },
    {
      id: 'unboxing',
      label: 'unboxing or first impressions',
      patterns: [
        /\b(unboxing|first\s+(look|impressions?)|out\s+of\s+the\s+box|hands[\s-]on|setup|opened)\b/i,
      ],
    },
    {
      id: 'buyers_guide',
      label: 'buying guide or recommendation',
      patterns: [
        /\b(should\s+you\s+buy|before\s+you\s+buy|buyers?\s+guide|best\s+\w+\s+to\s+buy|practical\s+test|check\s+this)\b/i,
      ],
    },
  ],

  // ── Gaming ───────────────────────────────────────────────────────────────────
  gaming_gameplay: [
    {
      id: 'challenge_run',
      label: 'challenge run or self-imposed restriction gameplay',
      patterns: [
        /\b(challenge\s+run|only\s+(using|with)|one[\s-]item|pacifist|no[\s-](death|hit|damage)|self[\s-]imposed)\b/i,
      ],
    },
    {
      id: 'speedrun',
      label: 'speedrun or fastest completion attempt',
      patterns: [
        /\b(speedrun|fastest|any%|world\s+record|record\s+attempt|minimum\s+time|how\s+fast)\b/i,
      ],
    },
    {
      id: 'strategy_exploit',
      label: 'game strategy, exploit, or advanced technique',
      patterns: [
        /\b(strategy|exploit|glitch|secret|hidden\s+(mechanic|feature|item)|trick|tip|pro\s+tip|most\s+players?\s+miss)\b/i,
      ],
    },
    {
      id: 'game_review',
      label: 'game review or analysis',
      patterns: [
        /\b(review|is\s+it\s+worth|worth\s+(buying|playing)|honest\s+review|after\s+\d+\s+hours|verdict)\b/i,
      ],
    },
  ],

  // ── Movies / Entertainment ────────────────────────────────────────────────
  movie_entertainment_promo: [
    {
      id: 'film_review',
      label: 'movie or web series review',
      patterns: [
        /\b(review|is\s+it\s+worth|verdict|my\s+thoughts|honest\s+review|opinion|rating)\b/i,
      ],
    },
    {
      id: 'ott_recommendation',
      label: 'OTT platform content recommendation',
      patterns: [
        /\b(netflix|hotstar|amazon\s+prime|zee5|sony\s+liv|ott|web\s+series|must\s+watch|binge|streaming)\b/i,
      ],
    },
    {
      id: 'bollywood_breakdown',
      label: 'Bollywood film analysis or box office breakdown',
      patterns: [
        /\b(bollywood|box\s+office|collection|opening\s+(day|weekend)|first\s+week|blockbuster|flop)\b/i,
      ],
    },
    {
      id: 'movie_explained',
      label: 'movie or ending explained',
      patterns: [
        /\b(explained|ending\s+explained|plot\s+twist|hidden\s+(meaning|detail)|easter\s+egg|breakdown|analysis)\b/i,
      ],
    },
  ],

  // ── Reaction / Commentary ─────────────────────────────────────────────────
  reaction_commentary: [
    {
      id: 'viral_reaction',
      label: 'reaction to viral video or trending moment',
      patterns: [
        /\b(react\w*|reacting|my\s+reaction|watching|first\s+time|viral\s+video|trending|twitter|instagram\s+reels?)\b/i,
      ],
    },
    {
      id: 'expert_reaction',
      label: 'expert or informed commentary on topic',
      patterns: [
        /\b(commentary|my\s+(thoughts|opinion|take|view)|as\s+a|from\s+a\s+\w+\s+perspective|honest\s+opinion)\b/i,
      ],
    },
    {
      id: 'roast',
      label: 'roast, criticism, or satirical commentary',
      patterns: [
        /\b(roast|why\s+\w+\s+is\s+(wrong|bad|failing|garbage)|exposing|worst|embarrassing|cringe)\b/i,
      ],
    },
  ],

  // ── Storytelling / Narrative ─────────────────────────────────────────────────
  narrative_storytelling: [
    {
      id: 'true_story',
      label: 'true story or real life event narration',
      patterns: [
        /\b(true\s+story|real\s+(story|incident|event)|this\s+actually\s+happened|based\s+on|real\s+life)\b/i,
      ],
    },
    {
      id: 'horror_supernatural',
      label: 'horror or supernatural story',
      patterns: [
        /\b(horror|ghost|haunted|supernatural|scary|bhoot|paranormal|cursed|unexplained|dark)\b/i,
      ],
    },
    {
      id: 'personal_storytime',
      label: 'personal storytime or confession',
      patterns: [
        /\b(storytime|my\s+(story|experience|journey|confession)|what\s+happened\s+to\s+me|i\s+survived)\b/i,
      ],
    },
    {
      id: 'biopic_breakdown',
      label: 'biography or personality profile',
      patterns: [
        /\b(biography|biopic|life\s+of|story\s+of|who\s+is|rise\s+of|fall\s+of|legacy\s+of|profile)\b/i,
      ],
    },
  ],

  // ── Digital Skills ────────────────────────────────────────────────────────
  digital_skills_tutorial: [
    {
      id: 'software_tutorial',
      label: 'software tutorial or walkthrough',
      patterns: [
        /\b(tutorial|how\s+to\s+use|walkthrough|step\s+by\s+step|beginners?\s+guide|learn\s+(photoshop|premiere|after\s+effects|capcut|canva))\b/i,
      ],
    },
    {
      id: 'coding_project',
      label: 'coding project or programming tutorial',
      patterns: [
        /\b(coding|programming|python|javascript|html|css|build\s+(a|an)\s+app|project\s+tutorial|web\s+development)\b/i,
      ],
    },
    {
      id: 'ai_tools_tutorial',
      label: 'AI tools or prompt engineering tutorial',
      patterns: [
        /\b(chatgpt|prompt|ai\s+tools?|midjourney|ai\s+workflow|automation\s+tool|ai\s+for\s+\w+)\b/i,
      ],
    },
    {
      id: 'design_tutorial',
      label: 'graphic design or visual editing tutorial',
      patterns: [
        /\b(design|canva|photoshop|lightroom|graphic|visual|poster|logo|thumbnail|edit\w*)\b/i,
      ],
    },
  ],

  // ── Lifestyle ────────────────────────────────────────────────────────────
  // ── Sports ───────────────────────────────────────────────────────────────────
  sports_content: [
    {
      id: 'cricket_analysis',
      label: 'cricket match analysis or IPL coverage',
      patterns: [
        /\b(cricket|ipl|test\s+match|odi|t20|bcci|virat|rohit|dhoni|sachin|world\s+cup\s+cricket)\b/i,
      ],
    },
    {
      id: 'player_profile',
      label: 'athlete biography or career profile',
      patterns: [
        /\b(career\s+of|story\s+of|journey\s+of|rise\s+of|biography|profile\s+of|legend|greatest\s+ever)\b/i,
      ],
    },
    {
      id: 'sports_prediction',
      label: 'sports prediction or match preview',
      patterns: [
        /\b(prediction|preview|who\s+will\s+win|favourites?|odds|preview|forecast|next\s+match)\b/i,
      ],
    },
    {
      id: 'sports_controversy',
      label: 'sports controversy or scandal',
      patterns: [
        /\b(controversy|scandal|cheating|doping|ban|suspended|match\s+fixing|corruption|allegation)\b/i,
      ],
    },
  ],

  // ── Extreme / Spectacle ───────────────────────────────────────────────────
  extreme_scale_spectacle: [
    {
      id: 'world_record_attempt',
      label: 'world record attempt or extreme scale challenge',
      patterns: [
        /\b(world\s+record|biggest|largest|tallest|heaviest|most\s+ever|record\s+breaking|guinness)\b/i,
      ],
    },
    {
      id: 'survival_challenge',
      label: 'survival or extreme endurance challenge',
      patterns: [
        /\b(survive|survival|48\s+hours|24\s+hours|7\s+days|extreme|endurance|last\s+(man|one)\s+standing)\b/i,
      ],
    },
    {
      id: 'mega_build',
      label: 'mega-scale build or creation project',
      patterns: [
        /\b(built|building|created|constructing|making|massive|giant|huge|enormous)\b/i,
      ],
    },
  ],

  // ── Social Experiment ──────────────────────────────────────────────────────
  social_experiment: [
    {
      id: 'public_prank',
      label: 'prank or hidden camera social experiment',
      patterns: [
        /\b(prank|hidden\s+camera|social\s+experiment|what\s+happens\s+if|candid|caught\s+on\s+camera)\b/i,
      ],
    },
    {
      id: 'public_reaction',
      label: 'public reaction or street challenge experiment',
      patterns: [
        /\b(public\s+reaction|people\s+react|strangers?|random\s+people|street\s+(challenge|experiment))\b/i,
      ],
    },
    {
      id: 'social_commentary_experiment',
      label: 'social commentary or awareness experiment',
      patterns: [
        /\b(awareness|what\s+people\s+think|society|social\s+issue|poverty|discrimination|experiment\s+on)\b/i,
      ],
    },
  ],

  // ── True Crime / Mystery ──────────────────────────────────────────────────
  true_crime_mystery: [
    {
      id: 'crime_investigation',
      label: 'true crime investigation or murder case analysis',
      patterns: [
        /\b(murder|crime|killer|serial\s+killer|case\s+of|unsolved|investigation|detective|victim|suspect)\b/i,
      ],
    },
    {
      id: 'mystery_explained',
      label: 'unexplained mystery or conspiracy theory breakdown',
      patterns: [
        /\b(mystery|unexplained|conspiracy|secret\s+society|illuminati|ancient\s+secret|what\s+really\s+happened|cover[\s-]up)\b/i,
      ],
    },
    {
      id: 'cold_case',
      label: 'cold case or historical crime revisited',
      patterns: [
        /\b(cold\s+case|unsolved|decades?\s+(old|ago)|revisiting|forgotten|case\s+reopened|historical\s+crime)\b/i,
      ],
    },
  ],

  // ── Stunt / Challenge ─────────────────────────────────────────────────────
  stunt_challenge: [
    {
      id: 'physical_stunt',
      label: 'physical stunt or daredevil challenge',
      patterns: [
        /\b(stunt|daredevil|fearless|cliff|jump|leap|extreme\s+sport|skydive|bungee|parkour)\b/i,
      ],
    },
    {
      id: 'viral_trend_challenge',
      label: 'viral trend or social media challenge participation',
      patterns: [
        /\b(viral\s+trend|tiktok\s+(trend|challenge)|reel\s+trend|instagram\s+challenge|doing\s+the\s+viral)\b/i,
      ],
    },
  ],

  // ── Elimination / Competition ─────────────────────────────────────────────
  elimination_competition: [
    {
      id: 'competition_show',
      label: 'competition show analysis or recap',
      patterns: [
        /\b(eliminated|winner|loser|final\s+(episode|round)|last\s+episode|who\s+won|season\s+finale|top\s+\d+)\b/i,
      ],
    },
    {
      id: 'creator_competition',
      label: 'creator-vs-creator or YouTuber competition',
      patterns: [
        /\b(vs\s+(youtuber|creator|influencer)|face[\s-]off|battle|contest|who\s+is\s+better|challenge\s+accepted)\b/i,
      ],
    },
  ],

  lifestyle_vlog: [
    {
      id: 'day_in_life',
      label: 'day-in-the-life vlog',
      patterns: [
        /\b(day\s+in\s+(my|the)\s+life|diml|24\s+hours|a\s+day\s+(as|with)|what\s+i\s+do\s+in\s+a\s+day)\b/i,
      ],
    },
    {
      id: 'morning_routine',
      label: 'morning or night routine',
      patterns: [
        /\b(morning\s+routine|night\s+routine|evening\s+routine|wake\s+up|productive\s+morning|5am)\b/i,
      ],
    },
    {
      id: 'shopping_haul',
      label: 'shopping haul or purchase review',
      patterns: [
        /\b(haul|shopping|what\s+i\s+bought|new\s+purchase|unboxing\s+haul|amazon\s+haul|monthly\s+haul)\b/i,
      ],
    },
    {
      id: 'productivity_system',
      label: 'productivity system or self-optimization',
      patterns: [
        /\b(productivity|system|routine|habits?\s+(that|to)|second\s+brain|notion|obsidian|discipline|focused)\b/i,
      ],
    },
  ],

};

// ── Default (concept-level) opportunity when no specific pattern matches ──────
// Used as fallback with lower confidence.

const CONCEPT_DEFAULT_OPPORTUNITY = {
  comedy_drama_skit:        { id: 'general_comedy_skit',      label: 'general comedy or entertainment skit' },
  street_food_regional:     { id: 'general_street_food',      label: 'general street food or regional food content' },
  cooking_recipe:           { id: 'general_recipe',           label: 'general cooking or recipe content' },
  food_taste_challenge:     { id: 'general_food_challenge',   label: 'general food challenge or taste test' },
  travel_exploration:       { id: 'general_travel',           label: 'general travel or exploration content' },
  fitness_health:           { id: 'general_fitness',          label: 'general fitness or health content' },
  mental_wellness:          { id: 'general_wellness',         label: 'general mental health or wellness content' },
  mythology_devotional:     { id: 'general_devotional',       label: 'general mythology or devotional content' },
  news_current_events:      { id: 'general_news',             label: 'general news or current affairs' },
  political_commentary:     { id: 'general_politics',         label: 'general political commentary' },
  finance_investing:        { id: 'general_finance',          label: 'general finance or investing content' },
  business_startup:         { id: 'general_business',         label: 'general business or startup content' },
  explainer_education:      { id: 'general_explainer',        label: 'general educational explainer' },
  ai_technology:            { id: 'general_tech',             label: 'general technology or AI content' },
  product_review:           { id: 'general_review',           label: 'general product review' },
  gaming_gameplay:          { id: 'general_gaming',           label: 'general gaming content' },
  movie_entertainment_promo:{ id: 'general_entertainment',    label: 'general movie or entertainment content' },
  reaction_commentary:      { id: 'general_reaction',         label: 'general reaction or commentary' },
  narrative_storytelling:   { id: 'general_storytelling',     label: 'general storytelling or narrative' },
  digital_skills_tutorial:  { id: 'general_tutorial',         label: 'general digital skills tutorial' },
  lifestyle_vlog:            { id: 'general_lifestyle',         label: 'general lifestyle or vlog content' },
  sports_content:            { id: 'general_sports',            label: 'general sports content' },
  extreme_scale_spectacle:   { id: 'general_spectacle',         label: 'general extreme or spectacle content' },
  social_experiment:         { id: 'general_social_experiment', label: 'general social experiment or prank' },
  true_crime_mystery:        { id: 'general_true_crime',        label: 'general true crime or mystery content' },
  stunt_challenge:           { id: 'general_stunt',             label: 'general stunt or challenge content' },
  elimination_competition:   { id: 'general_competition',       label: 'general competition or elimination content' },
};

// ── Extraction function ───────────────────────────────────────────────────────

/**
 * Extract opportunity from a recommendation trace.
 *
 * @param {object} trace - { concept_id, generated_title, raw_subject, family, archetype }
 * @returns {{ opportunity_id, opportunity_label, opportunity_confidence } | null}
 */
function extractOpportunity(trace) {
  const { concept_id, generated_title, raw_subject, family } = trace;
  if (!concept_id) return null;

  const opportunities = OPPORTUNITY_TAXONOMY[concept_id];
  if (!opportunities) {
    // Concept exists but not in taxonomy yet — return null (not a fallback)
    return null;
  }

  const titleText   = (generated_title || '').toLowerCase();
  const subjectText = (raw_subject || '').toLowerCase();

  // Test each opportunity's patterns
  for (const opp of opportunities) {
    for (const pattern of opp.patterns) {
      if (pattern.test(titleText)) {
        return {
          opportunity_id:         opp.id,
          opportunity_label:      opp.label,
          opportunity_confidence: 0.85,
        };
      }
    }
  }

  // Secondary: test subject text (lower confidence)
  for (const opp of opportunities) {
    for (const pattern of opp.patterns) {
      if (pattern.test(subjectText)) {
        return {
          opportunity_id:         opp.id,
          opportunity_label:      opp.label,
          opportunity_confidence: 0.70,
        };
      }
    }
  }

  // Fallback: concept-level default
  const defaultOpp = CONCEPT_DEFAULT_OPPORTUNITY[concept_id];
  if (defaultOpp) {
    return {
      opportunity_id:         defaultOpp.id,
      opportunity_label:      defaultOpp.label,
      opportunity_confidence: 0.55,
    };
  }

  return null;
}

/**
 * List all known opportunity IDs for a concept.
 * @param {string} concept_id
 * @returns {string[]}
 */
function listOpportunities(concept_id) {
  const opps = OPPORTUNITY_TAXONOMY[concept_id] || [];
  return opps.map(o => o.id);
}

/**
 * All concept_ids covered by the taxonomy.
 */
const COVERED_CONCEPTS = new Set(Object.keys(OPPORTUNITY_TAXONOMY));

module.exports = {
  extractOpportunity,
  listOpportunities,
  OPPORTUNITY_TAXONOMY,
  CONCEPT_DEFAULT_OPPORTUNITY,
  COVERED_CONCEPTS,
};
