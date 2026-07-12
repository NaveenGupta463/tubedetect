'use strict';

// ── Concept Normalizer ────────────────────────────────────────────────────────
//
// Converts a scored opportunity (topic string + peer evidence) into an
// audience-level concept. Runs ONLY on the top-ranked opportunities (O(25)),
// not on the raw peer video corpus.
//
// The concept is creator-agnostic: "Eating the Weirdest Chocolates on Earth"
// becomes concept=food_taste_challenge regardless of who is watching. The
// DNA translation layer (computeConceptAffinity) then determines whether
// that concept fits a specific creator.
//
// Architecture:
//   Phase 1: Rule-based classification (deterministic, zero cost, O(1))
//   Phase 2: Keyword-overlap DNA affinity scoring (no embeddings required)
//   Future:  LLM fallback for concepts that don't match any rule pattern

// ── Taxonomy ─────────────────────────────────────────────────────────────────
//
// Each concept entry:
//   id             — stable snake_case identifier
//   label          — human-readable phrase used in prompts and traces
//   patterns       — ordered regex array; first match wins
//   signal_words   — keywords used to match topic/peer text (for scoring)
//   dna_signals    — keywords looked for in creator DNA text to compute affinity

const CONCEPT_TAXONOMY = [

  // ── Food & Eating ─────────────────────────────────────────────────────────

  {
    id: 'food_taste_challenge',
    label: 'food taste challenge',
    patterns: [
      /\b(eating|taste|tasting|ate|tried|trying)\b.{0,40}(weird|extreme|world|disgusting|unusual|bizarre|gross|exotic|strangest|spiciest|weirdest)/i,
      /\b(weirdest|strangest|grossest|spiciest|most extreme|world.{0,10}weirdest)\b.{0,30}(food|chocolate|pizza|burger|snack|dish|meal|candy|treat|chips)/i,
      /\b(food|chocolate|pizza|burger|candy|snack)\b.{0,30}\b(challenge|taste\s*test|blind\s*test|ranked|mystery)/i,
      /\b(mukbang|asmr)\b.{0,20}(food|eating|meal)/i,
    ],
    signal_words: new Set(['eating', 'food', 'taste', 'tasting', 'weird', 'extreme', 'chocolate', 'pizza', 'challenge', 'tried', 'blind test', 'mukbang', 'asmr food', 'spicy', 'gross']),
    dna_signals: ['challenge', 'food', 'taste test', 'extreme', 'weird', 'eating', 'mukbang', 'tasting'],
  },

  {
    id: 'cooking_recipe',
    label: 'cooking or recipe content',
    patterns: [
      /\b(recipe|how\s+to\s+make|how\s+to\s+cook|bake[d]?|homemade|step.{0,5}step)\b/i,
      /\b(chef|kitchen|ingredients?|meal\s*prep|cooking\s+show)\b/i,
      /\b(cook(?:ing|ed)?|baking)\b.{0,20}(dinner|breakfast|lunch|dessert|cake|bread|pasta|chicken|beef|rice|soup)/i,
      /\b(food\s+vlog|food\s+review|food\s+tour|food\s+blog|home\s+cook(?:ing)?|easy\s+recipe|quick\s+recipe)\b/i,
      /\b(healthy\s+food|junk\s+food|fast\s+food|budget\s+meal|meal\s+plan|diet\s+food|protein\s+food)\b/i,
    ],
    signal_words: new Set(['recipe', 'cook', 'bake', 'ingredients', 'meal', 'homemade', 'chef', 'kitchen', 'dinner', 'lunch', 'breakfast', 'food vlog', 'food review', 'healthy food']),
    dna_signals: ['cooking', 'recipe', 'food', 'chef', 'kitchen', 'baking', 'homemade', 'meal', 'food vlog'],
  },

  // ── Street Food & Regional Cuisine ────────────────────────────────────────

  {
    id: 'street_food_regional',
    label: 'street food or regional cuisine content',
    patterns: [
      /\b(street\s+food|street\s+eats|food\s+street|road\s+side\s+food|roadside\s+food|dhaba|thela)\b/i,
      /\b(chaat|tikki|golgappa|pani\s*puri|vada\s*pav|bhel\s*puri|pav\s*bhaji|dosa|idli|sambar|rasam)\b/i,
      /\b(biryani|biriyani|butter\s+chicken|chicken\s+curry|dal\s+makhani|paneer|paratha|roti|sabzi|thali)\b/i,
      /\b(momos|golgappa|chole\s*bhature|rajma|kadhi|khichdi|poha|upma|halwa|ladoo|gulab\s*jamun|jalebi)\b/i,
      /\b(desi\s+food|indian\s+food|south\s+indian|north\s+indian|mughlai|hyderabadi|punjabi\s+food|bengali\s+food|gujarati\s+food)\b/i,
      /\b(food\s+from\s+\w+|local\s+food|village\s+food|grandma.?s\s+recipe|traditional\s+recipe|regional\s+recipe)\b/i,
    ],
    signal_words: new Set(['street food', 'chaat', 'biryani', 'tikki', 'dosa', 'thali', 'desi food', 'regional', 'dhaba', 'momos', 'paratha', 'paneer', 'village food']),
    dna_signals: ['street food', 'regional food', 'desi food', 'Indian cuisine', 'cooking', 'recipe', 'thali', 'biryani'],
  },

  // ── Competition & Scale ───────────────────────────────────────────────────

  {
    id: 'elimination_competition',
    label: 'elimination competition',
    patterns: [
      /\blast\s+(to|person|one|man|woman|girl|boy|player)\b.{0,25}(wins?|surviv|standing|leaves?|stop)/i,
      /\b(survivor|elimination|bracket|tournament|round\s*\d|semi.?final|quarterfinal)\b/i,
      /\b(beast\s*games?|squid\s*game|hunger\s*games?)\b/i,
      /\b(season\s*\d|episode\s*\d)\b.{0,30}\b(competition|game\s*show|contest|challenge)/i,
    ],
    signal_words: new Set(['elimination', 'last to', 'survivor', 'competition', 'season', 'winner', 'tournament', 'bracket', 'finals', 'beast games', 'squid game']),
    dna_signals: ['competition', 'tournament', 'elimination', 'challenge', 'last to', 'winner', 'prize', 'game show'],
  },

  {
    id: 'prize_giveaway',
    label: 'high-value prize giveaway',
    patterns: [
      /\b(win|winning|winner)\b.{0,30}(prize|\$\s*\d|\d+\s*dollars?|money|cash|tickets?|car|iphone|vacation|trip|house)\b/i,
      /\b(giving\s+away|giveaway|free\s+\w+|sponsored)\b.{0,30}(\$|\d+[k,]|prize|money|cash|car|house)/i,
      /\b(answer|call|click|subscribe|like|share)\b.{0,25}\b(win|prize|free|giveaway)/i,
      /\b\$[\d,]+\b.{0,20}(challenge|giveaway|prize|win|winner)/i,
    ],
    signal_words: new Set(['prize', 'giveaway', 'win', 'winner', 'money', 'cash', 'sponsored', 'free', '$', 'dollars']),
    dna_signals: ['giveaway', 'prize', 'sponsor', 'win', 'money', 'cash', 'challenge', 'reward'],
  },

  {
    id: 'extreme_scale_spectacle',
    label: 'extreme scale spectacle',
    patterns: [
      /\bworld'?s?\s+(largest|biggest|most\s+\w+|best|worst|smallest|richest|poorest|tallest|fastest)\b/i,
      /\b(\$[\d,]+|\d+\s*million|\d+\s*billion|\d+\s*thousand)\b.{0,20}(spent|built|made|created|bought|cost|raised|donated)/i,
      /\b(most\s+expensive|record.?breaking|world\s+record|history)\b/i,
      /\b\d{3,}\s*(people|contestants?|players?|fans?|strangers?|employees?)\b/i,
    ],
    signal_words: new Set(["world's", 'largest', 'biggest', 'most expensive', 'million', 'billion', '$', 'massive', 'giant', 'record', 'history']),
    dna_signals: ['scale', 'world record', 'most expensive', 'largest', 'spectacle', 'massive', 'record breaking'],
  },

  {
    id: 'stunt_challenge',
    label: 'stunt or endurance challenge',
    patterns: [
      /\b(24\s*hours?|48\s*hours?|30\s*days?|7\s*days?|one\s+week|one\s+month|for\s+a\s+(week|month|year))\b.{0,30}(in|living|spending|trapped|survived?|challenge)/i,
      /\b(surviving?|spent|lived?|living|trapped|alone|only)\b.{0,20}(24\s*hours?|\d+\s*hours?|\d+\s*days?|week|month|year)/i,
      /\b(extreme|impossible|insane|hardest|toughest|crazy)\b.{0,20}\b(challenge|test|attempt|stunt|experiment)\b/i,
    ],
    signal_words: new Set(['24 hours', '30 days', 'survive', 'living', 'trapped', 'extreme', 'challenge', 'stunt', 'attempt', 'impossible', 'endurance']),
    dna_signals: ['challenge', 'stunt', '24 hours', 'extreme', 'survival', 'impossible task', 'endurance', 'attempt'],
  },

  // ── Educational & Information ─────────────────────────────────────────────

  {
    id: 'explainer_education',
    label: 'explainer or educational content',
    patterns: [
      /^(why|how|what|the\s+reason|the\s+truth\s+about|explained?|the\s+history)\b/i,
      /\b(explained?|explainer|the\s+truth|debunked?|myth|misconception|really\s+works?|complete\s+guide)\b/i,
      /\b(guide|tutorial|learn|lesson|course|master)\b.{0,20}(everything|beginners?|advanced|complete|full)\b/i,
      /\b(breakdown|deep\s+dive|analysis|case\s+study|documentary)\b/i,
    ],
    signal_words: new Set(['explained', 'why', 'how', 'truth', 'guide', 'learn', 'tutorial', 'complete', 'understand', 'breakdown', 'analysis']),
    dna_signals: ['explain', 'education', 'tutorial', 'analysis', 'breakdown', 'deep dive', 'guide', 'lesson'],
  },

  {
    id: 'product_review',
    label: 'product review or comparison',
    patterns: [
      /\b(review|reviewed?|honest\s+review|verdict|is\s+it\s+worth|worth\s+it|tested|testing|unboxing)\b/i,
      /\bvs\.?\b|\bversus\b/i,
      /\b(best|worst|ranked|rating|compared?|comparison)\b.{0,20}\b(phone|laptop|app|tool|product|camera|headphone|tv|monitor|earbuds|tablet|watch)\b/i,
      /\b(should\s+you\s+buy|don.?t\s+buy|before\s+you\s+buy)\b/i,
    ],
    signal_words: new Set(['review', 'verdict', 'test', 'comparison', 'vs', 'worth it', 'unboxing', 'honest', 'rating', 'buy']),
    dna_signals: ['review', 'test', 'compare', 'verdict', 'honest', 'recommendation', 'buying guide', 'tech'],
  },

  // ── Finance & Business ────────────────────────────────────────────────────

  {
    id: 'finance_investing',
    label: 'finance or investing content',
    patterns: [
      /\b(invest(?:ing|ment|or)?|stock\s*market|portfolio|mutual\s*fund|sip|etf|crypto|bitcoin|nft)\b/i,
      /\b(budget(?:ing)?|savings?|debt|loan|emi|tax|insurance|retire(?:ment)?|financial\s+freedom)\b/i,
      /\b(passive\s+income|side\s+hustle|earn\s+money|make\s+money|wealth)\b/i,
      /\b(nifty|sensex|fii|dii|nse|bse|demat|zerodha|groww|upstox|smallcap|midcap|largecap|index\s+fund|equity\s+market)\b/i,
      /\b(salary|income\s+tax|gst|itr|hra|epf|pf|ppf|nps|fixed\s+deposit|fd|rd|recurring\s+deposit)\b/i,
    ],
    signal_words: new Set(['invest', 'stock', 'money', 'financial', 'wealth', 'budget', 'income', 'market', 'trading', 'tax', 'savings', 'nifty', 'sensex', 'sip', 'mutual fund', 'salary', 'demat']),
    dna_signals: ['finance', 'investing', 'money', 'wealth', 'portfolio', 'income', 'budget', 'stock market', 'tax', 'nifty', 'sensex', 'salary', 'mutual fund'],
  },

  {
    id: 'business_startup',
    label: 'business or startup content',
    patterns: [
      /\b(business|startups?|entrepreneur|founder|company|brand|scaling|growth\s*hack|marketing|revenue)\b/i,
      /\b(million\s*dollar|success\s*story|case\s*study|lessons?\s+from|how\s+\w+\s+(built|made|created|scaled))\b/i,
      /\b(leadership|management|hiring|team|product.?market|b2b|saas|e.?commerce)\b/i,
      /\b(unicorn|valuation|funding|pitch|seed\s+round|series\s+[abc]|vc|venture\s+capital|angel\s+investor)\b/i,
      /\b(side\s+income|passive\s+income|online\s+business|dropshipping|freelance|solopreneur)\b/i,
    ],
    signal_words: new Set(['business', 'startup', 'entrepreneur', 'founder', 'company', 'growth', 'marketing', 'success', 'revenue', 'scale', 'funding', 'unicorn', 'freelance']),
    dna_signals: ['business', 'startup', 'entrepreneur', 'founder', 'marketing', 'case study', 'leadership', 'scaling', 'revenue', 'funding'],
  },

  // ── Gaming ───────────────────────────────────────────────────────────────

  {
    id: 'gaming_gameplay',
    label: 'gaming or gameplay content',
    patterns: [
      /\b(gta|minecraft|fortnite|valorant|pubg|bgmi|free\s*fire|roblox|among\s*us|cod|call\s*of\s*duty|fifa|chess|pokémon|zelda|elden\s*ring|hollow\s*knight|apex\s*legends)\b/i,
      /\b(gameplay|playthrough|speedrun|let.?s\s*play|game\s*review|mod|update\s*\d|new\s*season|season\s*pass|battle\s*pass)\b/i,
      /\b(pvp|pve|boss\s*fight|loadout|meta\s+build|tier\s*list|rank(?:ed)?|pro\s*tips?)\b/i,
    ],
    signal_words: new Set(['gameplay', 'gaming', 'game', 'rank', 'update', 'season', 'boss', 'level', 'mod', 'strategy', 'pvp', 'build']),
    dna_signals: ['gaming', 'gameplay', 'game', 'strategy', 'update', 'challenge run', 'tier list', 'ranked', 'competitive'],
  },

  // ── Lifestyle & Personal ──────────────────────────────────────────────────

  {
    id: 'lifestyle_vlog',
    label: 'lifestyle vlog or day-in-life',
    patterns: [
      /\b(day\s+in\s+(my|the|a)\s+life|vlog|daily\s+routine|morning\s+routine|weekly\s+routine|night\s+routine)\b/i,
      /\b(living\s+(like|as|on)\s+a|spend\s+(a|one)\s+day|one\s+day\s+as|life\s+in)\b/i,
    ],
    signal_words: new Set(['vlog', 'day in my life', 'daily routine', 'lifestyle', 'morning routine', 'personal', 'diary']),
    dna_signals: ['lifestyle', 'vlog', 'daily', 'routine', 'personal', 'diary', 'day in my life'],
  },

  {
    id: 'travel_exploration',
    label: 'travel or exploration content',
    patterns: [
      /\b(travel(?:ling|ling|ed)?|trip\s+to|visited?|exploring?|tour\s+of|road\s+trip|backpack(?:ing)?)\b/i,
      /\b(hidden\s+(gems?|spots?)|off\s+the\s+beaten|solo\s+travel|budget\s+travel|itinerary)\b/i,
    ],
    signal_words: new Set(['travel', 'trip', 'adventure', 'explore', 'tour', 'journey', 'destination', 'backpack', 'itinerary']),
    dna_signals: ['travel', 'trip', 'explore', 'adventure', 'destination', 'tour', 'journey', 'wanderlust'],
  },

  {
    id: 'fitness_health',
    label: 'fitness or health content',
    patterns: [
      /\b(workout|exercise|training|fitness|gym|yoga|stretching|cardio|weight\s*loss|fat\s*loss)\b/i,
      /\b(nutrition|diet|protein|calories|supplement|muscle\s*building|body\s*transformation)\b/i,
      /\b(\d+\s*day\s+(challenge|transformation|workout|shred))\b/i,
    ],
    signal_words: new Set(['workout', 'fitness', 'exercise', 'health', 'diet', 'nutrition', 'weight loss', 'gym', 'protein', 'transformation']),
    dna_signals: ['fitness', 'health', 'workout', 'nutrition', 'transformation', 'routine', 'weight loss', 'gym'],
  },

  {
    id: 'mental_wellness',
    label: 'mental health or wellness content',
    patterns: [
      /\b(mental\s+health|anxiety|depression|mindset|self.?care|therapy|journaling|burnout|stress)\b/i,
      /\b(manifestation|law\s+of\s+attraction|meditation|mindfulness|healing|inner\s+peace)\b/i,
    ],
    signal_words: new Set(['mental health', 'anxiety', 'mindset', 'self care', 'therapy', 'healing', 'meditation', 'wellness', 'burnout']),
    dna_signals: ['mental health', 'wellness', 'mindset', 'self care', 'anxiety', 'healing', 'meditation', 'mindfulness'],
  },

  // ── Entertainment & Media ─────────────────────────────────────────────────

  {
    id: 'social_experiment',
    label: 'social experiment or public interaction',
    patterns: [
      /\b(social\s+experiment|prank(?:ing)?|public\s+(prank|experiment|stunt))\b/i,
      /\b(asking\s+strangers?|telling\s+people|pretending\s+to|fake\s+\w+)\b/i,
      /\b(strangers?\s+(react|reaction|answer|say|think))\b/i,
    ],
    signal_words: new Set(['experiment', 'social', 'prank', 'stranger', 'public', 'reaction', 'asking people', 'fake']),
    dna_signals: ['social experiment', 'prank', 'public', 'reaction', 'stranger', 'interaction'],
  },

  {
    id: 'celebrity_interview',
    label: 'celebrity interview or talk show segment',
    patterns: [
      /\b(interview|podcast|conversation|talks?\s+about|opens?\s+up|reveals?|exclusive)\b.{0,30}(celebrity|star|famous|singer|actor|actress|athlete|influencer|artist)/i,
      /\b(sat\s+down\s+with|in\s+conversation\s+with|speaks?\s+to|speaks?\s+with)\b/i,
      /\b(late\s+night|talk\s+show|game\s+show|variety\s+show|episode\s+with)\b/i,
    ],
    signal_words: new Set(['interview', 'podcast', 'celebrity', 'star', 'conversation', 'exclusive', 'reveals', 'late night', 'talk show']),
    dna_signals: ['interview', 'podcast', 'celebrity', 'guest', 'conversation', 'talk show', 'star', 'exclusive'],
  },

  {
    id: 'movie_entertainment_promo',
    label: 'movie, show, or entertainment promotion',
    patterns: [
      /\b(trailer|teaser|official|sneak\s*peek|first\s+look|making\s+of|behind\s+the\s+scenes)\b.{0,30}(movie|film|series|show|episode)/i,
      /\b(movie|film|series|show|episode|streaming|netflix|amazon|hbo|disney|prime)\b.{0,20}(review|reaction|explained|breakdown)/i,
      /\b(box\s*office|blockbuster|opening\s+weekend)\b/i,
      /\b(bollywood|tollywood|kollywood|mollywood|south\s+indian\s+film|hindi\s+movie|tamil\s+movie|telugu\s+movie)\b/i,
      /\b(web\s+series|ott\s+release|hotstar|zee5|mx\s*player|sony\s+liv|voot|alt\s*balaji)\b/i,
      /\b(action\s+movie|action\s+film|horror\s+movie|comedy\s+film|romantic\s+movie|thriller\s+movie|dubbed\s+movie)\b/i,
      /\b(action\s+comedy|romantic\s+comedy|dark\s+comedy|crime\s+thriller|action\s+blockbuster)\b/i,
    ],
    signal_words: new Set(['movie', 'film', 'trailer', 'streaming', 'review', 'series', 'entertainment', 'episode', 'season', 'bollywood', 'web series', 'action movie', 'dubbed']),
    dna_signals: ['entertainment', 'movie review', 'film', 'streaming', 'pop culture', 'media', 'show', 'bollywood', 'web series'],
  },

  // ── News & Current Events ─────────────────────────────────────────────────

  {
    id: 'news_current_events',
    label: 'news or current events analysis',
    patterns: [
      /\b(breaking|latest|update|news|just\s+happened|this\s+week|this\s+month|current\s+events?)\b/i,
      /\b(election|war|conflict|government|policy|verdict|trial|court\s+ruling|geopolitic)\b/i,
      /\b(crisis|emergency|disaster|pandemic|economic\s+crisis|political)\b/i,
      /\b(iran|israel|ukraine|russia|china|pakistan|north\s+korea|taiwan|nato|un|united\s+nations)\b/i,
      /\b(hormuz|strait|south\s+china\s+sea|red\s+sea|black\s+sea|suez\s+canal|strait\s+of)\b/i,
      /\b(missile|nuclear|drone|ceasefire|sanction|embargo|blockade|airstrikes?|bombing|casualt)\b/i,
      /\b(trump|biden|modi|xi\s+jinping|putin|zelensky|netanyahu|macron|erdogan)\b/i,
      /\b(jantar\s+mantar|parliament\s+street|ramlila\s+maidan|azad\s+maidan|protest\s+site)\b/i,
    ],
    signal_words: new Set(['news', 'breaking', 'latest', 'election', 'war', 'policy', 'government', 'crisis', 'update', 'current events', 'Iran', 'Israel', 'Trump', 'missile', 'sanction']),
    dna_signals: ['news', 'current events', 'analysis', 'update', 'breaking', 'investigative', 'geopolitics', 'policy', 'conflict', 'international'],
  },

  {
    id: 'political_commentary',
    label: 'political commentary or opinion',
    patterns: [
      /\b(politics?|political|congress|parliament|president|prime\s*minister|senator|minister|party)\b/i,
      /\b(democrat|republican|liberal|conservative|progressive|debate|campaign|vote|voter)\b/i,
      /\b(bjp|aap|ncp|shiv\s+sena|tmc|sp|bsp|jdu|rjd|dmk|aiadmk|ysrcp|trs|brs|cpi|cpim)\b/i,
      /\b(modi|rahul\s+gandhi|kejriwal|mamata|yogi|nitish|chirag|fadnavis|shinde)\b/i,
      /\b(lok\s+sabha|rajya\s+sabha|vidhan\s+sabha|mla|mp|mps|election\s+commission|evm|vvpat)\b/i,
      /\b(awami\s+league|imran\s+khan|pakistan\s+politics|bangladesh\s+politics|sri\s+lanka\s+politics)\b/i,
    ],
    signal_words: new Set(['politics', 'government', 'election', 'vote', 'policy', 'party', 'president', 'minister', 'debate', 'BJP', 'Modi', 'parliament', 'lok sabha']),
    dna_signals: ['politics', 'government', 'commentary', 'opinion', 'analysis', 'debate', 'policy', 'election', 'parliament'],
  },

  {
    id: 'sports_content',
    label: 'sports or athletic content',
    patterns: [
      /\b(nfl|nba|mlb|nhl|ipl|bcci|football|basketball|baseball|soccer|cricket|tennis|golf|rugby|olympics?|f1|formula\s*1)\b/i,
      /\b(match|game\s+\d|highlights?|draft|trade|roster|championship|playoffs?|super\s*bowl|world\s+cup|final)\b/i,
      /\b(athlete|player|coach|team\s+\w+|squad|season\s+\d)\b/i,
    ],
    signal_words: new Set(['sports', 'game', 'match', 'highlight', 'championship', 'athlete', 'team', 'season', 'league', 'tournament']),
    dna_signals: ['sports', 'athletic', 'game', 'team', 'highlight', 'championship', 'cricket', 'football', 'basketball'],
  },

  // ── Technology ────────────────────────────────────────────────────────────

  {
    id: 'ai_technology',
    label: 'AI or emerging technology content',
    patterns: [
      /\b(ai|artificial\s+intelligence|chatgpt|gpt|claude|gemini|llm|machine\s+learning|deep\s+learning|automation)\b/i,
      /\b(robot(?:ics)?|self.?driving|blockchain|quantum\s+computing|vr|ar|metaverse)\b/i,
    ],
    signal_words: new Set(['ai', 'artificial intelligence', 'chatgpt', 'automation', 'technology', 'robot', 'future', 'machine learning']),
    dna_signals: ['AI', 'technology', 'artificial intelligence', 'automation', 'future', 'chatgpt', 'innovation'],
  },

  // ── Indian Mythology & Devotional ─────────────────────────────────────────

  {
    id: 'mythology_devotional',
    label: 'Hindu mythology or devotional content',
    patterns: [
      /\b(ram|shiva|krishna|vishnu|ganesh|lakshmi|durga|hanuman|kali|brahma|saraswati|parvati|indra)\b/i,
      /\b(ramayan|mahabharat|bhagavad\s+gita|gita|vedas?|upanishad|purana|bhakti|aarti|stotra|mantra|kirtan)\b/i,
      /\b(puja|pooja|havan|yagna|prasad|darshan|tirth|pilgrimage|kashi|varanasi|vrindavan|mathura|ayodhya|dwarka|tirupati)\b/i,
      /\b(hinduism|hindu\s+culture|sanatan\s+dharm|spiritual\s+india|bhajan|satsang|guruji|swami|maharaj|baba)\b/i,
      /\b(diwali|navratri|janmashtami|ganesh\s+chaturthi|holi|eid|christmas|raksha\s+bandhan|karwa\s+chauth)\b/i,
    ],
    signal_words: new Set(['ram', 'krishna', 'shiva', 'puja', 'bhakti', 'mantra', 'temple', 'devotional', 'bhajan', 'ramayan', 'mahabharat', 'navratri', 'diwali', 'festival']),
    dna_signals: ['devotional', 'spiritual', 'mythology', 'bhakti', 'mantra', 'puja', 'temple', 'hinduism', 'festival', 'bhajan'],
  },

  // ── Comedy Skit & Drama ───────────────────────────────────────────────────

  {
    id: 'comedy_drama_skit',
    label: 'comedy skit, family drama, or entertainment skit content',
    patterns: [
      /\b(comedy\s+sketch|comedy\s+skit|funny\s+video|comedy\s+video|comedy\s+scene|comedy\s+short)\b/i,
      /\b(family\s+drama|office\s+drama|love\s+story|romance\s+drama|emotional\s+video|emotional\s+story)\b/i,
      /\b(action\s+comedy|romantic\s+comedy|horror\s+comedy|thriller\s+comedy|dark\s+comedy)\b/i,
      /\b(sitcom|skit|standup|stand.?up\s+comedy|open\s+mic|roast\s+show|late\s+night\s+comedy)\b/i,
      /\b(husband\s+wife|bhai\s+bhai|saas\s+bahu|jija\s+saali|devar\s+bhabhi|friend\s+comedy)\b/i,
      /\b(short\s+film\s+comedy|mini\s+web\s+series|funny\s+moments|trending\s+comedy|viral\s+comedy)\b/i,
    ],
    signal_words: new Set(['comedy', 'skit', 'funny', 'drama', 'romantic', 'family drama', 'action comedy', 'standup', 'sitcom', 'entertainment', 'short film']),
    dna_signals: ['comedy', 'skit', 'funny', 'entertainment', 'drama', 'family', 'romantic', 'short film', 'viral'],
  },

  // ── Reaction & Commentary ─────────────────────────────────────────────────

  {
    id: 'reaction_commentary',
    label: 'reaction video or commentary content',
    patterns: [
      /\b(react(?:ion|ing)?|reacting\s+to|my\s+reaction|honest\s+reaction|first\s+reaction|watching\s+for\s+the\s+first)\b/i,
      /\b(commentary|roast|reviewing|review\s+video|commentary\s+on|takes?\s+on|opinion\s+on|thoughts?\s+on)\b/i,
      /\b(watching|watched|saw)\b.{0,20}(for\s+the\s+first\s+time|with\s+my|together|blind|react)/i,
      /\b(viral\s+video\s+reaction|trending\s+video\s+reaction|news\s+reaction|movie\s+reaction|trailer\s+reaction)\b/i,
    ],
    signal_words: new Set(['reaction', 'react', 'commentary', 'roast', 'watching', 'review', 'opinion', 'thoughts', 'first reaction', 'honest reaction']),
    dna_signals: ['reaction', 'commentary', 'review', 'opinion', 'roast', 'watching', 'entertainment', 'viral'],
  },

  // ── Narrative & Storytelling ──────────────────────────────────────────────

  {
    id: 'narrative_storytelling',
    label: 'narrative storytelling or story-based content',
    patterns: [
      /\b(short\s+film|mini\s+film|indie\s+film|student\s+film)\b/i,
      /\b(love\s+story|true\s+story|real\s+story|horror\s+story|motivational\s+story|inspirational\s+story|emotional\s+story|sad\s+story)\b/i,
      /\b(story\s+time|storytime|my\s+story|her\s+story|his\s+story|their\s+story|untold\s+story)\b/i,
      /\b(episode\s+\d|series\s+\d|chapter\s+\d|part\s+\d+\s+of|season\s+\d)\b.{0,15}(story|drama|film|series)/i,
      /\b(biographical|biopic|documentary\s+style|docudrama|narrative|memoir|life\s+story)\b/i,
    ],
    signal_words: new Set(['story', 'short film', 'love story', 'true story', 'storytelling', 'narrative', 'episode', 'drama', 'real life', 'emotional']),
    dna_signals: ['storytelling', 'story', 'short film', 'narrative', 'drama', 'emotional', 'biographical', 'episode'],
  },

  // ── Digital Skills & Tutorials ────────────────────────────────────────────

  {
    id: 'digital_skills_tutorial',
    label: 'digital skills, editing, or tech tutorial content',
    patterns: [
      /\b(photo\s*edit(?:ing)?|video\s*edit(?:ing)?|audio\s*edit(?:ing)?|color\s+grading)\b/i,
      /\b(photoshop|lightroom|after\s*effects|premiere\s*pro|final\s*cut|davinci\s*resolve|capcut|kinemaster)\b/i,
      /\b(graphic\s+design|canva|adobe|logo\s+design|thumbnail\s+design|poster\s+design|banner\s+design)\b/i,
      /\b(coding|programming|python|javascript|java|html|css|react|nodejs|sql|machine\s+learning|data\s+science)\b/i,
      /\b(excel\s+tutorial|excel\s+tips|google\s+sheets|powerpoint|ms\s+office|word\s+tutorial)\b/i,
      /\b(youtube\s+editing|reel\s+editing|instagram\s+editing|shorts\s+editing|content\s+creation\s+tips)\b/i,
      /\b(prompt\s+engineering|ai\s+tools|midjourney|stable\s+diffusion|dall.e|ai\s+image|ai\s+video)\b/i,
    ],
    signal_words: new Set(['photo editing', 'video editing', 'photoshop', 'lightroom', 'coding', 'programming', 'tutorial', 'design', 'canva', 'AI tools', 'prompt']),
    dna_signals: ['editing', 'tutorial', 'design', 'coding', 'programming', 'tech skills', 'AI tools', 'creative', 'photoshop'],
  },

  // ── Mystery & Investigation ───────────────────────────────────────────────

  {
    id: 'true_crime_mystery',
    label: 'true crime or mystery investigation',
    patterns: [
      /\b(murder|crime|criminal|detective|mystery|unsolved|cold\s+case|victim|suspect|arrested?|convicted?|disappear)\b/i,
      /\b(true\s+crime|investigation|investigated|exposed|dark\s+side|cover.?up|conspiracy)\b/i,
    ],
    signal_words: new Set(['crime', 'murder', 'mystery', 'unsolved', 'detective', 'investigation', 'true crime', 'conspiracy', 'dark']),
    dna_signals: ['true crime', 'mystery', 'investigation', 'documentary', 'storytelling', 'thriller', 'dark'],
  },

  // ── Wildlife & Nature Documentary ─────────────────────────────────────────

  {
    id: 'wildlife_nature_documentary',
    label: 'wildlife, nature documentary, or animal behavior content',
    patterns: [
      /\b(tiger|lion|elephant|shark|whale|bear|wolf|eagle|snake|crocodile|leopard|cheetah|rhino|gorilla|jaguar|panther|hyena|falcon)\b/i,
      /\b(wildlife|nature\s+documentary|animal\s+behavior|predator|prey|endangered|extinction|wild\s+animal)\b/i,
      /\b(hunt(?:s|ed|ing)?|attack(?:s|ed|ing)?|survive[sd]?|surviving|forced\s+to\s+(hunt|kill|eat|fight|live))\b/i,
      /\b(national\s+park|safari|jungle|forest|savanna|ocean\s+depth|deep\s+sea|coral\s+reef|rainforest|habitat)\b/i,
      /\b(animal\s+planet|discovery\s+channel|nature\s+film|bbc\s+earth|nat\s+geo)\b/i,
    ],
    signal_words: new Set(['tiger', 'lion', 'elephant', 'shark', 'wildlife', 'nature documentary', 'predator', 'prey', 'hunt', 'wild', 'animal', 'jungle', 'safari', 'endangered', 'forced to hunt']),
    dna_signals: ['wildlife', 'nature', 'documentary', 'animal', 'ecosystem', 'predator', 'environment', 'conservation', 'safari', 'biodiversity'],
  },

  // ── Scientific Discovery & Cosmology ──────────────────────────────────────

  {
    id: 'scientific_discovery',
    label: 'scientific discovery, cosmology, or physics explainer content',
    patterns: [
      /\b(black\s+holes?|quantum|singularit|dark\s+matter|dark\s+energy|neutron\s+star|big\s+bang|multiverse|wormhole|event\s+horizon)\b/i,
      /\b(scientists?\s+(found|discovered|proved?|believe[sd]?|thought|reveal(?:s|ed)?)|new\s+(study|research|discovery|finding|breakthrough))\b/i,
      /\b(universe|cosmos|galaxy|light\s+year|space|nasa|astrophysics|relativity|quantum\s+mechanics|string\s+theory)\b/i,
      /\b(we\s+thought|turns?\s+out|it\s+turns?\s+out|everything\s+we\s+knew|what\s+scientists\s+actually)\b/i,
      /\b(frozen\s+big\s+bang|parallel\s+universe|time\s+travel|faster\s+than\s+light|speed\s+of\s+light)\b/i,
    ],
    signal_words: new Set(['black hole', 'quantum', 'singularity', 'dark matter', 'universe', 'big bang', 'scientists', 'discovery', 'space', 'NASA', 'physics', 'cosmos', 'we thought', 'turns out']),
    dna_signals: ['science', 'physics', 'cosmology', 'space', 'discovery', 'research', 'universe', 'quantum', 'astronomy', 'explainer', 'education'],
  },

  // ── Nostalgia & Cultural Memory ───────────────────────────────────────────

  {
    id: 'nostalgia_cultural_memory',
    label: 'nostalgia, cultural memory, or generational story content',
    patterns: [
      /\b\d{2,}\s+years?\b.{0,30}\b(memories|memory|journey|story|life|generation|together|with\s+us|in\s+my|of\s+my)\b/i,
      /\b(memories|memory|nostalgia|nostalgic|throwback|childhood|growing\s+up|back\s+in\s+the)\b.{0,20}\b(days?|times?|years?|life)\b/i,
      /\b(a\s+(santro|ambassador|premier\s+padmini|maruti\s+800|bullet|bajaj\s+chetak|kinetic\s+honda))\b/i,
      /\b(remember\s+when|do\s+you\s+remember|those\s+were\s+the\s+days?|we\s+used\s+to|things\s+we\s+miss)\b/i,
      /\b(family\s+(memories|moments|journey|story|tradition)|generational|a\s+family\s+and\s+\d+)\b/i,
      /\b(old\s+(car|bike|house|school|days?|times?|memories?)|vintage\s+(india|car|bike|era|memories?))\b/i,
    ],
    signal_words: new Set(['memories', 'nostalgia', 'throwback', 'childhood', 'years ago', 'growing up', 'remember', 'family story', 'generation', 'santro', 'old days', 'cultural memory', 'vintage']),
    dna_signals: ['nostalgia', 'memories', 'family', 'culture', 'storytelling', 'emotional', 'personal story', 'generational', 'history', 'throwback'],
  },
];

// ── Utility: parse DNA rows safely ───────────────────────────────────────────

function dnaRowText(row) {
  return [row?.id, row?.label, ...(Array.isArray(row?.examples) ? row.examples.slice(0, 3) : [])]
    .filter(Boolean).join(' ').toLowerCase();
}

function collectDnaText(dna) {
  const rows = [
    ...(Array.isArray(dna?.domain_tags)     ? dna.domain_tags     : []),
    ...(Array.isArray(dna?.thesis_patterns) ? dna.thesis_patterns : []),
    ...(Array.isArray(dna?.hook_templates)  ? dna.hook_templates  : []),
    ...(Array.isArray(dna?.micro_topics)    ? dna.micro_topics    : []),
    ...(Array.isArray(dna?.entities)        ? dna.entities        : []),
  ];
  const csp    = String(dna?.stable_dna?.creator_constraints?.csp || '').toLowerCase();
  const region = String(dna?.stable_dna?.creator_constraints?.region || '').toLowerCase();
  return rows.map(dnaRowText).join(' ') + ' ' + csp + ' ' + region;
}

// ── Core API ─────────────────────────────────────────────────────────────────

/**
 * Classify a topic/opportunity string into an audience concept.
 *
 * @param {string}   topic        The scored opportunity topic string
 * @param {string[]} [peerTitles] Optional peer video title examples for disambiguation
 * @returns {{ concept_id: string|null, concept_label: string|null, concept_confidence: number }}
 */
function extractConcept(topic, peerTitles) {
  const text = [topic, ...(peerTitles || []).slice(0, 3)].join(' ');

  for (const concept of CONCEPT_TAXONOMY) {
    for (const pattern of concept.patterns) {
      if (pattern.test(text)) {
        // Confidence: bump up if the concept also matches signal words in the text
        const textLower = text.toLowerCase();
        let signalHits = 0;
        for (const sw of concept.signal_words) {
          if (textLower.includes(sw)) signalHits++;
        }
        const signalRatio = signalHits / Math.max(1, concept.signal_words.size);
        const confidence = Math.min(1, 0.6 + signalRatio * 0.4);
        return {
          concept_id:         concept.id,
          concept_label:      concept.label,
          concept_confidence: +confidence.toFixed(2),
        };
      }
    }
  }

  return { concept_id: null, concept_label: null, concept_confidence: 0 };
}

/**
 * Score how well a concept fits a creator's DNA.
 *
 * @param {object} dna       Creator DNA object (from readCreatorIdeaDna)
 * @param {string} conceptId Concept id from CONCEPT_TAXONOMY
 * @returns {{ affinity_score: number, affinity_reason: string }}
 */
function computeConceptAffinity(dna, conceptId) {
  if (!dna || !conceptId) return { affinity_score: 0, affinity_reason: 'missing_input' };

  const concept = CONCEPT_TAXONOMY.find(c => c.id === conceptId);
  if (!concept) return { affinity_score: 0, affinity_reason: 'unknown_concept' };

  const dnaText = collectDnaText(dna);
  const matched = [];
  for (const signal of concept.dna_signals) {
    if (dnaText.includes(signal.toLowerCase())) matched.push(signal);
  }

  const affinity_score = +(matched.length / Math.max(1, concept.dna_signals.length)).toFixed(3);

  return {
    affinity_score,
    affinity_reason: matched.length
      ? `DNA contains: ${matched.slice(0, 4).join(', ')}`
      : `No DNA signals match concept "${concept.label}"`,
  };
}

/**
 * Returns true when applying the given family's templates to the given concept
 * would produce a semantically invalid recommendation.
 *
 * This is the primary guard preventing gaming templates from landing on food
 * subjects, and vice versa for other high-friction mismatches.
 */
const GAMING_FAMILY = 'gaming_entertainment';
const GAMING_COMPATIBLE_CONCEPTS = new Set([
  'gaming_gameplay', 'elimination_competition', 'prize_giveaway',
  'stunt_challenge', 'extreme_scale_spectacle', 'social_experiment',
]);

function isFamilyConceptMismatch(family, conceptId) {
  if (!conceptId) return false; // unclassified → don't block
  if (family === GAMING_FAMILY && !GAMING_COMPATIBLE_CONCEPTS.has(conceptId)) return true;
  return false;
}

// ── Family-fallback concept assignment ────────────────────────────────────────
//
// When extractConcept(subject) returns null for a DNA bet, the template family
// already encodes the content domain. Use this as a low-confidence fallback so
// traces get a concept even when the subject is a short domain noun ("food",
// "comedy", "market") without enough context for pattern matching.

const FAMILY_DEFAULT_CONCEPT = {
  comedy_sketch:         { id: 'comedy_drama_skit',        label: 'comedy skit, family drama, or entertainment skit content',  confidence: 0.55 },
  cooking_food:          { id: 'street_food_regional',      label: 'street food or regional cuisine content',                    confidence: 0.55 },
  travel_lifestyle:      { id: 'travel_exploration',        label: 'travel or exploration content',                              confidence: 0.60 },
  fitness_practice:      { id: 'fitness_health',            label: 'fitness or health content',                                  confidence: 0.60 },
  wellness_teaching:     { id: 'mental_wellness',           label: 'mental health or wellness content',                          confidence: 0.60 },
  spiritual_teaching:    { id: 'mythology_devotional',      label: 'Hindu mythology or devotional content',                      confidence: 0.60 },
  news_event:            { id: 'news_current_events',       label: 'news or current events analysis',                            confidence: 0.60 },
  finance_education:     { id: 'finance_investing',         label: 'finance or investing content',                               confidence: 0.60 },
  exam_education:        { id: 'explainer_education',       label: 'explainer or educational content',                           confidence: 0.55 },
  tech_review:           { id: 'product_review',            label: 'product review or comparison',                               confidence: 0.60 },
  gaming_entertainment:  { id: 'gaming_gameplay',           label: 'gaming or gameplay content',                                 confidence: 0.60 },
  general_education:     { id: 'explainer_education',       label: 'explainer or educational content',                           confidence: 0.55 },
  conversation_business: { id: 'business_startup',          label: 'business or startup content',                                confidence: 0.55 },
  conversation_finance:  { id: 'finance_investing',         label: 'finance or investing content',                               confidence: 0.55 },
  conversation_spiritual:{ id: 'mythology_devotional',      label: 'Hindu mythology or devotional content',                      confidence: 0.55 },
  explainer_case:        { id: 'explainer_education',       label: 'explainer or educational content',                           confidence: 0.55 },
  generic:               { id: 'explainer_education',       label: 'explainer or educational content',                           confidence: 0.50 },
};

/**
 * Like extractConcept but with a family-level fallback for DNA bet subjects.
 * When the subject alone is too short to pattern-match (e.g. "food", "comedy"),
 * the template family encodes the domain — use it as a lower-confidence fallback.
 *
 * @param {string} subject     Raw subject noun from the DNA bet
 * @param {string} [family]    FAMILY_TEMPLATES key (e.g. "comedy_sketch")
 * @returns {{ concept_id, concept_label, concept_confidence }}
 */
function extractConceptForDna(subject, family) {
  // Try specific pattern match first (higher confidence)
  const specific = extractConcept(subject);
  if (specific.concept_id) return specific;

  // Fall back to family-level concept (lower confidence)
  const fallback = family && FAMILY_DEFAULT_CONCEPT[family];
  if (fallback) {
    return {
      concept_id:         fallback.id,
      concept_label:      fallback.label,
      concept_confidence: fallback.confidence,
    };
  }

  return { concept_id: null, concept_label: null, concept_confidence: 0 };
}

module.exports = {
  extractConcept,
  extractConceptForDna,
  computeConceptAffinity,
  isFamilyConceptMismatch,
  CONCEPT_TAXONOMY,
};
