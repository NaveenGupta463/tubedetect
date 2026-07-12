'use strict';

// ── Creator Territory Classifier ──────────────────────────────────────────────
// Pure function. No DB reads. No async. No WTP coupling.
//
// classifyVideoTerritories(title, hints) → [{territory_id, confidence, evidence_terms}]
//
// Territory = topic area WHERE the audience has accepted the creator.
// The classifier identifies WHICH territories a video title belongs to.
// Confidence (high/medium) determines whether to store the result.
// Low-confidence matches are returned only when includeWeak:true — never stored.
//
// Two-level taxonomy: domain → territory_id
// ~25 territories covering Indian YouTube creator space.

const { DEVANAGARI_RE, SOUTH_SCRIPT_RE } = require('../lib/phrases');

// ── Territory taxonomy ────────────────────────────────────────────────────────
// Each entry:
//   domain          : grouping label for display / broad_creator_score bucketing
//   label           : human-readable territory name
//   strong          : patterns where a SINGLE match → high confidence
//   moderate        : patterns where 2+ matches OR 1 match + hint boost → medium confidence
//   blockers        : patterns that veto this territory even if keywords matched
//   hint_niches     : ingested_channels.niche values that boost confidence by one level
//   hint_csps       : CSP values that boost
//   hint_modes      : creator_mode values that boost
//
// Pattern best-practice: capturing group on the key term so extractEvidence() can pull it.

const TERRITORY_CONFIG = {

  // ── FINANCE ────────────────────────────────────────────────────────────────

  personal_finance: {
    domain: 'finance',
    label: 'Personal Finance',
    strong: [
      /\b(sip|systematic investment plan|mutual fund|mf|elss)\b/i,
      /\b(emi|home loan|housing loan|term plan|term insurance|ppf|epf|nps)\b/i,
      /\b(rent vs buy|rent or buy|should i buy (a )?flat|property (vs|or) rent)\b/i,
      /\b(financial (freedom|independence|planning)|retire early|fire movement|early retirement)\b/i,
      /\b(compound interest|power of compounding|wealth creation|asset allocation|diversif)\b/i,
      /\b(credit card (debt|bill|trap|hacks?)|debt trap|loan trap|personal loan trap)\b/i,
      /\b(paise (kaise|bachao|invest)|invest karo|sahi invest|invest karna)\b/i,
    ],
    moderate: [
      /\b(invest(ing|ment|or)?s?)\b/i,
      /\b(sav(e|ing|ings))\b/i,
      /\b(wealth|financial|finance|money|income|expense|budget)\b/i,
      /\b(portfolio|returns?|dividend|equity|debt fund)\b/i,
      /\b(tax (saving|planning|deduction)|itr|income tax)\b/i,
    ],
    blockers: [
      /\b(stock market (crash|rally|analysis|today)|sensex|nifty)\b/i, // → macro_economy
      /\bsip\s*(&|and)\s*paint\b/i,
    ],
    hint_niches: ['finance', 'personal finance', 'investing', 'stock market'],
    hint_csps: ['personal_finance_guest_show', 'finance_investment_education'],
    hint_modes: ['finance'],
  },

  macro_economy: {
    domain: 'finance',
    label: 'Macro Economy & Markets',
    strong: [
      /\b(gdp|gross domestic product)\b/i,
      /\b(rbi|reserve bank of india|repo rate|monetary policy)\b/i,
      /\b(inflation|deflation|stagflation|cpi|wpi)\b/i,
      /\b(sensex|nifty|stock market (crash|rally|bull|bear|analysis|today|outlook))\b/i,
      /\b(union budget|budget \d{4}|economic survey)\b/i,
      /\b(trade (war|deficit|surplus|deal)|tariff|import duty|export ban)\b/i,
      /\b(recession|economic slowdown|economic crisis|financial crisis)\b/i,
      /\b(rupee (fall|crash|vs dollar)|forex|currency (devaluation|war))\b/i,
      /\b(real estate in india|real estate market|property market|housing market)\b/i,
    ],
    moderate: [
      /\b(economy|economic|market(s)?|fiscal|monetary)\b/i,
      /\b(growth|interest rate|bond(s)?|yield)\b/i,
      /\b(imf|world bank|adb|g20|g7)\b/i,
      /\b(oil (price|shock|crisis)|crude oil|petrol (price|hike))\b/i,
    ],
    blockers: [
      /\b(bazaar|bazar|market tour|shopping|collection|wholesale|retail shop|sadar bazaar|sarojini|karol bagh|chor bazar)\b/i,
    ],
    hint_niches: ['finance', 'news', 'business', 'economics'],
    hint_csps: ['finance_investment_education', 'business_case_study', 'founder_economy_conversation'],
    hint_modes: ['finance', 'news'],
  },

  crypto_web3: {
    domain: 'finance',
    label: 'Crypto & Web3',
    strong: [
      /\b(bitcoin|btc|ethereum|eth|crypto(currency)?)\b/i,
      /\b(blockchain|nft|defi|web3|altcoin|token(omics)?|ico|dao)\b/i,
      /\b(crypto (scam|crash|bull run|winter|pump|dump|mining))\b/i,
      /\b(binance|coinbase|wazirx|coindcx|metamask|uniswap)\b/i,
    ],
    moderate: [
      /\b(digital (currency|asset)|virtual currency|decentrali[zs]ed)\b/i,
      /\b(wallet|seed phrase|private key|cold storage)\b/i,
    ],
    hint_niches: ['cryptocurrency', 'finance', 'technology'],
    hint_csps: [],
    hint_modes: [],
  },

  // ── BUSINESS ───────────────────────────────────────────────────────────────

  entrepreneurship: {
    domain: 'business',
    label: 'Entrepreneurship & Startups',
    strong: [
      /\b(startups?|start[- ]up|founder(s)?|co-?founder)\b/i,
      /\b(series [abc]|seed (round|funding)|venture capital|vc funding|vc investment|angel invest)\b/i,
      /\b(unicorn|decacorn|valuation|pitch (deck|to|for)|term sheet)\b/i,
      /\b(business model|revenue model|unit economics|product.market fit|pivot)\b/i,
      /\b(scaling (a|the|your|up)|build (a|your|the) (company|business|startup))\b/i,
      /\b(entrepreneur(ship)?|self.made|bootstrapped)\b/i,
    ],
    moderate: [
      /\b(business|company|brand|founder|CEO|CMO)\b/i,
      /\b(revenue|profit|growth|customer|product|market)\b/i,
      /\b(idea (to|into) (business|company|startup))\b/i,
    ],
    blockers: [
      /\b(small business (loan|scheme|government)|udyog|msme)\b/i, // more career/policy
      /\b(bazaar|bazar|market tour|shopping|collection|wholesale|retail shop|sadar bazaar|sarojini|karol bagh|chor bazar)\b/i,
    ],
    hint_niches: ['business', 'entrepreneurship', 'startup'],
    hint_csps: ['founder_economy_conversation', 'business_case_study', 'indian_business_selfimprovement_podcast'],
    hint_modes: ['business'],
  },

  career_work: {
    domain: 'business',
    label: 'Career & Work',
    strong: [
      /\b(job interview|interview (tips|prep|questions)|crack (the )?interview)\b/i,
      /\b(resume|cv|cover letter|linkedin (profile|tips|job))\b/i,
      /\b(salary (negotiation|hike|appraisal|increment)|negotiate (your )?salary|ask for (a )?raise)\b/i,
      /\b(career (switch|change|advice|tips|growth)|career (in|after)|switched from .* to .*)\b/i,
      /\b(product management|data science|software engineering|consulting|mba (career|jobs?))\b/i,
      /\b(layoff|fired|job loss|unemployment|pink slip)\b/i,
      /\b(fresher jobs?|campus placement|off.campus|first job)\b/i,
      /\b(work.life balance|burnout|toxic workplace|office politics)\b/i,
    ],
    moderate: [
      /\b(job|career|work|profession|skill|hiring|recruit)\b/i,
      /\b(employee|employer|workplace|office|corporate)\b/i,
      /\b(freelanc|remote work|work from home|wfh|gig economy)\b/i,
    ],
    hint_niches: ['education', 'business', 'selfimprovement'],
    hint_csps: [],
    hint_modes: [],
  },

  // ── GEOPOLITICS & NEWS ─────────────────────────────────────────────────────

  geopolitics: {
    domain: 'geopolitics_news',
    label: 'Geopolitics & World Affairs',
    strong: [
      /\b(china (vs|and|attacks?|threatens?|blocks?|warns?)|sino.indian|south china sea)\b/i,
      /\b(russia (ukraine|war|invasion|sanctions|vs)|ukraine (war|crisis|conflict))\b/i,
      /\b(israel (hamas|war|attack|gaza)|middle east (war|crisis|conflict))\b/i,
      /\b(nato|brics|quad|g20 summit|un security council|world order)\b/i,
      /\b(us.china (trade war|tension|rivalry)|america (vs|and) china)\b/i,
      /\b(foreign policy|bilateral (relations|ties|trade)|diplomacy|treaty|ceasefire)\b/i,
      /\b(nuclear (deal|threat|weapon|war)|arms race|missile (strike|test))\b/i,
      /\b(pakistan (india|border|army|war|tension)|india.pak)\b/i,
      /\b(iran (oil|nuclear|sanctions|war)|hormuz strait)\b/i,
      /\b(taiwan (strait|independence|china|invasion)|south china sea)\b/i,
    ],
    moderate: [
      /\b(international|global|world (war|order|economy|politics))\b/i,
      /\b(sanctions|embargo|alliance|conflict|war|invasion)\b/i,
      /\b(superpower|hegemony|multipolar|cold war)\b/i,
    ],
    blockers: [
      /\b(bjp|congress|modi|election|lok sabha|rajya sabha)\b/i, // india_politics not geopolitics
    ],
    hint_niches: ['news', 'politics', 'geopolitics', 'defence'],
    hint_csps: [],
    hint_modes: ['news'],
  },

  india_politics: {
    domain: 'geopolitics_news',
    label: 'Indian Politics & Policy',
    strong: [
      /\b(bjp|congress|aap|samajwadi|bsp|tmc|shivsena|ncp)\b/i,
      /\b(modi|rahul gandhi|amit shah|yogi|kejriwal|mamata|nitish|siddaramaiah)\b/i,
      /\b(lok sabha|rajya sabha|vidhan sabha|parliament|constitution)\b/i,
      /\b(election|chunav|vote|voter|democracy|ballot|manifest(o)?)\b/i,
      /\b(reservation|caste (politics|census|system)|obc|sc|st|quota)\b/i,
      /\b(article (370|35a)|ram mandir|ayodhya|gst (bill|council|impact))\b/i,
    ],
    moderate: [
      /\b(politics|political|government|party|minister|policy|governance)\b/i,
      /\b(india (government|politics|policy)|indian (government|politics))\b/i,
      /\b(cm|chief minister|governor|pm |prime minister)\b/i,
    ],
    hint_niches: ['politics', 'news', 'current affairs'],
    hint_csps: [],
    hint_modes: ['news', 'politics'],
  },

  crime_scam: {
    domain: 'geopolitics_news',
    label: 'Crime, Scams & Investigations',
    strong: [
      /\b(scam|fraud|ponzi|pyramid scheme|crypto scam|investment scam)\b/i,
      /\b(dark side of|expose[d]?|truth behind|hidden truth|real story behind)\b/i,
      /\b(arrested|arrested for|fir filed|chargesheet|convicted|acquitted)\b/i,
      /\b(murder|rape|kidnapping|robbery|heist|gang|mafia|underworld)\b/i,
      /\b(corruption|bribery|money laundering|hawala|shell company)\b/i,
      /\b(mahadev (app|scam|betting)|byju|adani|ambani (controversy|case))\b/i,
      /\b(cult|fake (guru|baba|doctor|news|account)|impersonation)\b/i,
    ],
    moderate: [
      /\b(crime|criminal|illegal|investigation|scandal|controversy)\b/i,
      /\b(court|verdict|judgment|bail|custody|trial|hearing)\b/i,
      /\b(caught|busted|exposed|revealed|uncovered|leaked)\b/i,
    ],
    hint_niches: ['news', 'entertainment'],
    hint_csps: [],
    hint_modes: ['news'],
  },

  // ── HEALTH ─────────────────────────────────────────────────────────────────

  medical_wellness: {
    domain: 'health',
    label: 'Medical & Wellness',
    strong: [
      /\b(cancer|diabetes|heart (disease|attack|failure)|hypertension|blood pressure)\b/i,
      /\b(mental health|clinical depression|depression (symptoms|treatment|therapy|explained|signs|cure|help)|anxiety (symptoms|treatment|therapy|explained|signs|help)|ocd|adhd|bipolar|schizophrenia|ptsd)\b/i,
      /\b(doctor (explains?|advice|visit|salar(y|ies)|interview|warns?|reacts?)|hospital|surgery|treatment|diagnosis|symptoms|medicine|drug)\b/i,
      /\b(thyroid|pcos|pcod|ibs|gut health|microbiome|autoimmune)\b/i,
      /\b(ayurved(a|ic)|naturopathy|homeopathy|traditional medicine)\b/i,
      /\b(nutrition(ist)?|dietician|diet plan|calorie(s)?|macro(s)?|micronutrient)\b/i,
      /\b(sleep (deprivation|disorder|hygiene|apnea|quality)|insomnia)\b/i,
    ],
    moderate: [
      /\b(health|healthy|disease|illness|medical|medicine|cure|depression|anxiety)\b/i,
      /\b(immune(ity)?|inflammation|chronic|prevention|vitamin|supplement)\b/i,
    ],
    blockers: [
      /\b(gym|workout|abs|muscle|fat loss|weight loss|bench press|squat|deadlift)\b/i,
    ],
    hint_niches: ['health', 'nutrition', 'wellness', 'ayurvedic medicine'],
    hint_csps: [],
    hint_modes: ['health'],
  },

  fitness_body: {
    domain: 'health',
    label: 'Fitness & Body',
    strong: [
      /\b(gym workout|workout (plan|routine|program)|home workout)\b/i,
      /\b(fat (loss|burning)|weight loss|lose weight|cutting phase|bulk(ing)?|lean)\b/i,
      /\b(muscle (building|gain)|mass gain|bodybuilding|powerlifting|calisthenics)\b/i,
      /\b(abs workout|chest workout|leg day|arm workout|shoulder workout)\b/i,
      /\b(protein (intake|shake|powder|diet)|creatine|pre.workout|whey)\b/i,
      /\b(hiit|cardio|strength training|progressive overload|compound lift)\b/i,
      /\b(bench press|squat|deadlift|pull.?up|push.?up|plank)\b/i,
    ],
    moderate: [
      /\b(fitness|workout|exercise|training|physique|body)\b/i,
      /\b(diet|calories|macros|nutrition (for|plan))\b/i,
      /\b(gym|athlete|performance|endurance)\b/i,
    ],
    hint_niches: ['fitness', 'workout', 'bodybuilding', 'strength training', 'gym workouts'],
    hint_csps: [],
    hint_modes: [],
  },

  sexual_health: {
    domain: 'health',
    label: 'Relationships & Sexual Health',
    strong: [
      /\b(sex (education|ed|life|tips|positions?|health)|sexual (health|wellness|violence))\b/i,
      /\b(masturbat(ion|e)|contraception|condom|stds?|sti|hiv|std prevention)\b/i,
      /\b(lgbtq\+?|gay|lesbian|bisexual|trans(gender)?|queer|coming out|pride (month|parade|flag|community))\b/i,
      /\b(dating (tips|advice|apps?|life|rules?)|dating apps?|tinder|bumble|hinge)\b/i,
      /\b(breakup|divorce|separation|infidelity|cheating partner|toxic relationship|arranged marriages? fail)\b/i,
      /\b(consent|sexual harassment|rape culture|metoo|domestic (violence|abuse))\b/i,
    ],
    moderate: [
      /\b(relationship(s)?|love|dating|partner|marriage|intimacy)\b/i,
      /\b(gender|feminism|patriarchy|toxic masculinity|men.s rights)\b/i,
    ],
    hint_niches: ['health', 'lifestyle', 'selfimprovement'],
    hint_csps: [],
    hint_modes: [],
  },

  // ── KNOWLEDGE ──────────────────────────────────────────────────────────────

  history_culture: {
    domain: 'knowledge',
    label: 'History & Culture',
    strong: [
      /\b(mughal(s)?|british (india|raj|empire)|partition|independence (movement|day))\b/i,
      /\b(ancient india|vedic|indus valley|maurya|gupta|maratha|vijayanagara)\b/i,
      /\b(chandragupta|ashoka|akbar|aurangzeb|shivaji|tipu sultan|rani laxmibai)\b/i,
      /\b(colonialism|imperialism|east india company|1857|freedom fighter)\b/i,
      /\b(history of (india|cricket|bollywood|money|science)|untold history)\b/i,
      /\b(civilization|dynasty|empire|kingdom|mythology|folklore|legend)\b/i,
    ],
    moderate: [
      /\b(history|historical|ancient|medieval|modern (history|era))\b/i,
      /\b(culture|tradition|heritage|customs?|ritual(s)?)\b/i,
      /\b(india(n)? (history|culture|civilization|tradition))\b/i,
    ],
    hint_niches: ['education', 'history'],
    hint_csps: ['business_case_study'],
    hint_modes: [],
  },

  science_tech_ai: {
    domain: 'knowledge',
    label: 'Science, Tech & AI',
    strong: [
      /\b(artificial intelligence|machine learning|deep learning|neural network|llm|gpt|chatgpt|gemini)\b/i,
      /\b(isro|nasa|space (mission|station|exploration|telescope)|mars mission|moon landing|chandrayaan)\b/i,
      /\b(quantum (computing|physics|entanglement)|particle physics|cern|black hole)\b/i,
      /\b(climate change|global warming|carbon (emission|footprint|neutral))\b/i,
      /\b(robotics|automation|semiconductor|chip (shortage|war)|nvidia|intel)\b/i,
      /\b(ai .* (jobs?|healthcare|medicine|education|business)|healthcare .* ai)\b/i,
      /\b(biotech|gene (editing|therapy)|crispr|vaccine (tech|development|mrna))\b/i,
    ],
    moderate: [
      /\b(ai|science|scientific|technology|innovation|future (of|tech))\b/i,
      /\b(experiment|research|discovery|breakthrough|invention)\b/i,
      /\b(algorithm|data (science|centre)|cloud (computing|storage))\b/i,
    ],
    blockers: [
      /\b(phone (review|vs|unboxing|test)|laptop (review|vs)|earphone|headphone|smartwatch)\b/i,
    ],
    hint_niches: ['technology', 'science', 'education'],
    hint_csps: ['business_case_study'],
    hint_modes: ['tech'],
  },

  gadgets_reviews: {
    domain: 'knowledge',
    label: 'Gadgets & Tech Reviews',
    strong: [
      /\b(best phone under|budget phone|flagship phone)\b/i,
      /\b((phone|laptop|tablet|smartwatch|earphone|earbuds|headphone) (review|vs|unboxing|test|comparison))\b/i,
      /\b(iphone|samsung galaxy|oneplus|realme|redmi|xiaomi|oppo|vivo|pixel|nothing phone)\b/i,
      /\b(macbook|dell|hp |lenovo|asus rog|gaming laptop)\b/i,
      /\b(camera (test|review|comparison)|benchmark|antutu|geekbench|display (test|review))\b/i,
      /\b(unboxing (of|the)?|hands.on (with|review)|first look (at|the)?)\b/i,
    ],
    moderate: [
      /\b(specs|specifications|processor|battery|storage|ram|display|charging)\b/i,
      /\b(tech (review|video|channel)|review(ing)?|tested)\b/i,
    ],
    hint_niches: ['technology', 'smartphone reviews', 'gadgets'],
    hint_csps: [],
    hint_modes: ['tech'],
  },

  education_career: {
    domain: 'knowledge',
    label: 'Education & Exam Prep',
    strong: [
      /\b(upsc|ias|ips|civil service(s)?|prelims|mains|csat)\b/i,
      /\b(jee (mains?|advanced)|neet|ssc (cgl|chsl|mts)|ibps|gate (exam|preparation|202\d)|cat mba|clat|cuet)\b/i,
      /\b(board exam|class (10|12|10th|12th)|cbse|icse|state board)\b/i,
      /\b(how to (crack|clear|pass|score|prepare for))\b/i,
      /\b(study (plan|schedule|material|technique|tips)|revision strategy|mock test)\b/i,
      /\b(iit|nit|aiims|top college|admission (process|tips|guide))\b/i,
    ],
    moderate: [
      /\b(study|exam(ination)?|preparation|student|marks|score|result)\b/i,
      /\b(coaching|tuition|syllabus|curriculum|subject)\b/i,
    ],
    hint_niches: ['education', 'upsc exam preparation', 'competitive exams'],
    hint_csps: [],
    hint_modes: ['upsc', 'education'],
  },

  // ── LIFESTYLE ──────────────────────────────────────────────────────────────

  food_recipes: {
    domain: 'lifestyle',
    label: 'Food & Recipes',
    strong: [
      /\b(recipe (for|of)|how to (make|cook|prepare) (a |the )?(recipe|dish|meal|food|biryani|cake|dessert|curry|paneer|dal|roti|dosa|idli|paratha|korma)|step.by.step (recipe|cooking))\b/i,
      /\b(biryani|paneer|dal|roti|dosa|sambar|idli|paratha|khichdi|halwa|korma)\b/i,
      /\b(baking|cake|cookies|bread|dessert|sweet|mithai|ladoo|barfi|halwa)\b/i,
      /\b(ingredients?|cookery|cooking (tutorial|method|tip)|kitchen (hack|tip))\b/i,
      /\b(egg (recipe|dish|curry)|chicken (recipe|curry|biryani)|mutton (recipe|curry))\b/i,
    ],
    moderate: [
      /\b(cook(ing)?|recipe|dish|food|meal|cuisine)\b/i,
      /\b(tasty|delicious|homemade|easy (recipe|cooking))\b/i,
    ],
    blockers: [
      /\b(street food|food (vlog|tour|walk)|best places to eat|restaurant (review|visit|tour)|eating at)\b/i,
    ],
    hint_niches: ['food', 'cooking', 'indian recipes'],
    hint_csps: [],
    hint_modes: [],
  },

  food_places: {
    domain: 'lifestyle',
    label: 'Food Places & Street Food',
    strong: [
      /\b(street food (of|in|at)|street food (vlog|tour|video))\b/i,
      /\b(food (vlog|tour|walk|safari|hunt)|restaurant (review|visit|tour))\b/i,
      /\b(review:?.*\brestaurant|restaurant.*review)\b/i,
      /\b(best (places to eat|restaurants?|street food) in)\b/i,
      /\b(hidden (food|restaurant|eatery) gems?|underrated (restaurant|place)|local (food|eatery|joint))\b/i,
      /\b(tried (every|.*(food|restaurant|dish|vada|burger|pizza|biryani|cafe|dhaba|stall))|tasted|eating at|visited .* (restaurant|cafe|dhaba|stall)|exploring food in)\b/i,
    ],
    moderate: [
      /\b(restaurant|dhaba|stall|vendor|cafeteria|cafe|eatery)\b/i,
      /\b(food (in|at|from)|eat (in|at|near)|dine (in|at))\b/i,
    ],
    hint_niches: ['food', 'street food', 'travel'],
    hint_csps: [],
    hint_modes: [],
  },

  travel_places: {
    domain: 'lifestyle',
    label: 'Travel & Places',
    strong: [
      /\b(travel (guide|vlog|tips?|itinerary)|solo (travel|trip|traveler))\b/i,
      /\b(best places (in|to visit|to go)|hidden (gem|gems|place|places) (in|near))\b/i,
      /\b(budget (trip|travel)|trip (to|in|cost|expense)|backpacking)\b/i,
      /\b(ladakh|manali|shimla|goa|rishikesh|kedarnath|bali|thailand|europe|japan|dubai)\b/i,
      /\b(hill station|beach|trekking|hiking|road trip (to|across)|train journey)\b/i,
      /\b(tourist visa|travel visa|visa tips for indian passport|passport (tips?|renewal|guide|holders)|airport (tips?|hacks?)|flight (tips?|booking))\b/i,
    ],
    moderate: [
      /\b(travel|trip|vacation|holiday|tour|destination|explore)\b/i,
      /\b(vlog|visit(ing)?|journey|adventure)\b/i,
    ],
    hint_niches: ['travel', 'travel vlogs'],
    hint_csps: [],
    hint_modes: [],
  },

  self_improvement: {
    domain: 'lifestyle',
    label: 'Self-Improvement & Psychology',
    strong: [
      /\b(stoicism|atomic habits?|deep work|flow state|ikigai|essentialism)\b/i,
      /\b(focus better|focus for long hours|study for long hours)\b/i,
      /\b(productivity (hack|tip|system)|morning routine|evening routine|night routine)\b/i,
      /\b(emotional intelligence|eq|cognitive bias(es)?|psychology (of|behind))\b/i,
      /\b(discipline|willpower|procrastinat|motivation (science|hack)|habit (formation|loop|stacking))\b/i,
      /\b(mindset (shift|change|hack)|growth mindset|fixed mindset|self.sabotage)\b/i,
      /\b(self.awareness|self.confidence|imposter syndrome|anxiety (management|tips?))\b/i,
    ],
    moderate: [
      /\b(improve|improvement|better|personal growth|self.help|self.development)\b/i,
      /\b(habit(s)?|routine|mindset|focus|goal.setting|success)\b/i,
      /\b(psychology|brain|neuroscience|behaviour|behavior|mental (model|map))\b/i,
    ],
    blockers: [
      /\b(upsc|jee|neet|exam|study (plan|schedule))\b/i,  // education_career
    ],
    hint_niches: ['selfimprovement', 'motivation', 'personal development', 'mindset', 'meditation', 'yoga'],
    hint_csps: ['indian_business_selfimprovement_podcast'],
    hint_modes: [],
  },

  // ── ENTERTAINMENT ──────────────────────────────────────────────────────────

  celebrity_pop: {
    domain: 'entertainment',
    label: 'Celebrity & Pop Culture',
    strong: [
      /\b(bollywood|hollywood|tollywood|kollywood|mollywood)\b/i,
      /\b((movie|film|web series|ott|netflix|amazon prime|hotstar) (review|breakdown|explained|analysis))\b/i,
      /\b(netflix|amazon prime|hotstar|ott|web series|shows? ranked|best and worst shows?)\b/i,
      /\b((trailer|teaser) (reaction|breakdown|analysis|review))\b/i,
      /\b(celebrity (interview|life|story|net worth|income)|actor|actress)\b/i,
      /\b(box office( collection)?|movie collection|film collection|ott (release|premiere|platform)|streaming)\b/i,
      /\b(srk|shah rukh khan|shahrukh|salman|deepika|ranveer|alia|hrithik|akshay|priyanka|karan johar)\b/i,
    ],
    moderate: [
      /\b(movie|film|show|series|entertainment|celebrity)\b/i,
      /\b(watch|binge|must watch|review|rating)\b/i,
    ],
    hint_niches: ['entertainment', 'comedy', 'movie reviews'],
    hint_csps: [],
    hint_modes: ['entertainment'],
  },

  gaming: {
    domain: 'entertainment',
    label: 'Gaming',
    strong: [
      /\b(game (tips?|guide|strategy))\b/i,
      /\b(free fire|bgmi|pubg|minecraft|roblox|valorant|gta|among us|clash royale|codm|fc24)\b/i,
      /\b(gaming (setup|pc|chair|headset|mouse|controller)|budget gaming)\b/i,
      /\b(esports|tournament|gaming tournament|pro player|rank (up|push)|ranked match)\b/i,
      /\b(speedrun|no damage|challenge (run|mode)|100% (completion|walkthrough|speedrun|run)|all bosses|easter egg)\b/i,
    ],
    moderate: [
      /\b(game|gaming|gamer|player|level|mission|quest)\b/i,
      /\b(stream(er)?|twitch|youtube gaming|squad|lobby)\b/i,
    ],
    hint_niches: ['gaming', 'free fire gameplay', 'minecraft gameplay', 'roblox gameplay'],
    hint_csps: [],
    hint_modes: [],
  },

  sports_cricket: {
    domain: 'entertainment',
    label: 'Sports & Cricket',
    strong: [
      /\b(ipl|indian premier league|t20 (world cup|series|match)|odi|test match|cricket)\b/i,
      /\b(wicket|batting|bowling|fielding|innings|century|half.century|duck)\b/i,
      /\b(virat kohli|rohit sharma|ms dhoni|bumrah|shami|hardik|suryakumar)\b/i,
      /\b(football|soccer|fifa|world cup (football|soccer)|premier league|la liga|champions league)\b/i,
      /\b(kabaddi|kho kho|wrestling|badminton|tennis|athletics|olympics|cwg)\b/i,
    ],
    moderate: [
      /\b(sports?|match|team|player|tournament|championship|league)\b/i,
      /\b(win|loss|score|goal|points?|ranking|selection)\b/i,
    ],
    hint_niches: ['sports', 'cricket'],
    hint_csps: [],
    hint_modes: ['sports'],
  },

  // ── CREATIVE ───────────────────────────────────────────────────────────────

  music_performance: {
    domain: 'creative',
    label: 'Music & Performance',
    strong: [
      /\b(cover (song|version)|acoustic (version|cover)|unplugged (version|session))\b/i,
      /\b(original (song|music|track|composition)|debut (single|album|ep))\b/i,
      /\b(lyric (video|s)|music video|live (session|performance|concert))\b/i,
      /\b(slowed (and )?reverb|lo.fi (version|remix)|mashup)\b/i,
      /\b(behind the (song|music)|making of (the )?(song|album|track))\b/i,
      /\b(guitar (cover|lesson|tutorial)|piano (cover|version)|drum (cover|session))\b/i,
      /\b(ableton|fl studio|logic pro|music production|make beats?|beat making|producer masterclass)\b/i,
    ],
    moderate: [
      /\b(songs?|music|sing(er)?|vocalist|band|album|ep|track)\b/i,
      /\b(melody|lyric|chorus|verse|bridge|hook|beat|instrumental)\b/i,
    ],
    hint_niches: ['music', 'songs', 'punjabi music', 'bhojpuri songs', 'bengali songs', 'cover songs'],
    hint_csps: [],
    hint_modes: [],
  },

  devotional_spiritual: {
    domain: 'creative',
    label: 'Devotional & Spiritual',
    strong: [
      /\b(bhajan|aarti|mantra|kirtan|chalisa|stotra|stuti|shloka)\b/i,
      /\b(namaz|namaaz|quran(ic)?|dua|salah prayer|ramadan|eid prayer)\b/i,
      /\b((hanuman|shiva|krishna|vishnu|durga|ganesh|lakshmi) (bhajan|aarti|mantra|chalisa|katha|stotra)|ram (bhajan|katha))\b/i,
      /\b(gurbani|waheguru|ardas|sukhmani|simran)\b/i,
      /\b(spiritual (journey|awakening|practice)|divine|sacred (chant|music|prayer))\b/i,
      /\b(how to (do|perform) (puja|pooja|pujas|poojas)|daily (puja|pooja)|bhumi (puja|pooja)|(puja|pooja) at home)\b/i,
      /\b(temple (visit|darshan|vlog)|pilgrimage|teerth yatra|char dham)\b/i,
    ],
    moderate: [
      /\b(god|faith|prayer|worship|devotion|spiritual)\b/i,
      /\b(meditation|mindfulness|consciousness|soul|karma|dharma)\b/i,
    ],
    hint_niches: ['devotional', 'bhakti', 'spiritual'],
    hint_csps: [],
    hint_modes: [],
  },

  // ── SOCIAL ISSUES ──────────────────────────────────────────────────────────

  social_issues: {
    domain: 'geopolitics_news',
    label: 'Social Issues & Inequality',
    strong: [
      /\b(poverty|poor(ness)?|hunger|homeless(ness)?|slum)\b/i,
      /\b(farmer (protest|crisis|suicides?|income|rights?)|agrarian crisis|msp)\b/i,
      /\b(women (safety|empowerment|rights?|education)|girl child|gender (gap|pay gap|disparity))\b/i,
      /\b(income (inequality|gap|disparity)|wealth gap|economic inequality)\b/i,
      /\b(caste (discrimination|violence|system)|dalit|manual scavenging|untouchability)\b/i,
      /\b(child (labour|labor|marriage|rights?|abuse)|trafficking|bonded labour)\b/i,
      /\b(protest|protest march|political march|rally|agitation|civil disobedience|workers'? strike|labou?r strike)\b/i,
    ],
    moderate: [
      /\b(social (issue|problem|change|justice|inequality|awareness))\b/i,
      /\b(discrimination|oppression|marginaliz|vulnerable|privilege)\b/i,
      /\b(ngo|charity|donation|philanthropy|welfare|scheme)\b/i,
    ],
    hint_niches: ['news', 'politics', 'education', 'lifestyle'],
    hint_csps: [],
    hint_modes: ['news'],
  },

};

// ── Flat list for iteration ────────────────────────────────────────────────────
const TERRITORY_IDS = Object.keys(TERRITORY_CONFIG);

const HASHTAG_NOISE_TERRITORIES = new Set([
  'medical_wellness',
  'science_tech_ai',
  'gadgets_reviews',
  'celebrity_pop',
  'gaming',
  'sports_cricket',
  'travel_places',
  'food_recipes',
  'food_places',
  'devotional_spiritual',
  'history_culture',
  'india_politics',
]);

const SHORTS_NOISE_RE = /\b(shorts?|shortsfeed|ytshorts|youtubeshorts|reels?|viral|trending|funny|comedy|subscribe|watch fully|unfrezzmyaccount)\b/i;

function isHashtagHeavy(title) {
  const hashtags = title.match(/#[\p{L}\p{N}_]+/gu) || [];
  if (hashtags.length >= 5) return true;
  if (hashtags.length >= 3 && SHORTS_NOISE_RE.test(title)) return true;
  return false;
}

// ── Script detection ──────────────────────────────────────────────────────────
// If > 40% of title chars are non-Roman script → V1 limitation: skip classification.
function isNonRomanHeavy(title) {
  if (!title) return true;
  let nonRoman = 0;
  for (const ch of title) {
    const code = ch.charCodeAt(0);
    if (code > 255) nonRoman++;
  }
  return nonRoman / title.length > 0.4;
}

// ── Evidence extraction ───────────────────────────────────────────────────────
// Find which terms from the title triggered a pattern match.
function extractEvidence(titleLC, patterns) {
  const terms = new Set();
  for (const re of patterns) {
    const m = titleLC.match(re);
    if (m) {
      // Prefer first capture group; fall back to full match, trim to <=30 chars
      const term = (m[1] || m[0]).toLowerCase().trim().slice(0, 30);
      if (term.length >= 2) terms.add(term);
    }
  }
  return [...terms].slice(0, 5);
}

// ── Hint boost detection ──────────────────────────────────────────────────────
function hasHintBoost(config, hints) {
  const { niche = '', csp = '', creator_mode = '' } = hints;
  return (
    (config.hint_niches?.some(n => niche.toLowerCase().includes(n))) ||
    (config.hint_csps?.includes(csp)) ||
    (config.hint_modes?.includes(creator_mode))
  );
}

function hasNiche(hints, terms) {
  const niche = String(hints?.niche || '').toLowerCase();
  return terms.some(term => niche.includes(term));
}

// ── Main classifier ───────────────────────────────────────────────────────────
//
// Returns [{territory_id, confidence, evidence_terms}] sorted high→medium.
// By default returns only medium+ confidence.
// Pass includeWeak:true for debug / fixture testing only.

function classifyVideoTerritories(title, hints = {}, { includeWeak = false } = {}) {
  if (!title || typeof title !== 'string') return [];

  // V1 limitation: skip titles that are primarily non-Roman script
  if (isNonRomanHeavy(title)) return [];

  const titleLC = title.toLowerCase();
  const results  = [];
  const hashtagHeavy = isHashtagHeavy(title);

  for (const territory_id of TERRITORY_IDS) {
    const cfg = TERRITORY_CONFIG[territory_id];

    // Blocker check — if any blocker matches, skip this territory
    if (cfg.blockers?.some(re => re.test(titleLC))) continue;

    const strongHits    = cfg.strong.filter(re => re.test(titleLC));
    const moderateHits  = cfg.moderate.filter(re => re.test(titleLC));
    const hintBoost     = hasHintBoost(cfg, hints);

    if (
      (territory_id === 'macro_economy' || territory_id === 'entrepreneurship') &&
      hasNiche(hints, ['local market', 'local markets', 'shopping market', 'street market'])
    ) {
      continue;
    }

    if (
      territory_id === 'gadgets_reviews' &&
      !hintBoost &&
      strongHits.length === 1 &&
      !/\b(review|vs|unboxing|test|comparison|best phone|under|specs?|camera|benchmark|first look|hands.?on)\b/i.test(titleLC)
    ) {
      continue;
    }

    if (
      territory_id === 'celebrity_pop' &&
      hasNiche(hints, ['music', 'song', 'songs', 'bhajan', 'cover']) &&
      !/\b(movie review|film review|trailer|teaser|interview|box office|ott|web series|breakdown|explained|analysis)\b/i.test(titleLC)
    ) {
      continue;
    }

    if (
      territory_id === 'self_improvement' &&
      hasNiche(hints, ['makeup', 'beauty', 'fashion', 'lifestyle']) &&
      /\b(morning routine|evening routine|night routine|grwm|makeup|skincare|hair)\b/i.test(titleLC) &&
      !/\b(productivity|discipline|habit|psychology|procrastinat|mindset|stoicism|atomic habits|deep work|focus)\b/i.test(titleLC)
    ) {
      continue;
    }

    if (
      hashtagHeavy &&
      !hintBoost &&
      HASHTAG_NOISE_TERRITORIES.has(territory_id) &&
      strongHits.length <= 1 &&
      moderateHits.length <= 1
    ) {
      continue;
    }

    let confidence = null;

    if (strongHits.length >= 1) {
      confidence = 'high';
    } else if (moderateHits.length >= 2 || (moderateHits.length >= 1 && hintBoost)) {
      confidence = 'medium';
    } else if (includeWeak && moderateHits.length >= 1) {
      confidence = 'low';
    }

    if (!confidence) continue;

    const evidence_terms = extractEvidence(titleLC, [...strongHits, ...moderateHits]);

    results.push({ territory_id, confidence, evidence_terms });
  }

  // Sort: high before medium before low
  const CONF_ORDER = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => CONF_ORDER[a.confidence] - CONF_ORDER[b.confidence]);

  // Cap at 3 territories per video
  return results.slice(0, 3);
}

// ── Convenience: classify a batch of titles for a channel ────────────────────
// Returns a frequency map: { territory_id → { count, highCount, evidence_sample } }
function classifyChannelTitles(titles, hints = {}) {
  const freq = {};
  for (const title of titles) {
    const results = classifyVideoTerritories(title, hints);
    for (const r of results) {
      if (!freq[r.territory_id]) {
        freq[r.territory_id] = { count: 0, highCount: 0, evidence_sample: [] };
      }
      freq[r.territory_id].count++;
      if (r.confidence === 'high') freq[r.territory_id].highCount++;
      if (freq[r.territory_id].evidence_sample.length < 3) {
        freq[r.territory_id].evidence_sample.push(...r.evidence_terms);
      }
    }
  }
  return freq;
}

module.exports = {
  classifyVideoTerritories,
  classifyChannelTitles,
  TERRITORY_CONFIG,
  TERRITORY_IDS,
};
