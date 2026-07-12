'use strict';

// ── Territory Classifier Fixture Tests ────────────────────────────────────────
// Run: node server/scripts/testTerritoryClassifier.js
// Success gate: >= 85% correct (fail = expected territory missing from top results)
//
// Each fixture:
//   title           : the video title to classify
//   hints           : channel-level hints (niche, csp, creator_mode)
//   expected        : territory_ids that MUST appear in the top-3 results
//   not_expected    : territory_ids that MUST NOT appear (false positives)
//
// A fixture passes if:
//   - all expected territories appear in the result
//   - none of the not_expected territories appear

require('dotenv').config({ path: __dirname + '/../.env' });
const { classifyVideoTerritories } = require('../services/territoryClassifier');

const FIXTURES = [

  // ── personal_finance ──────────────────────────────────────────────────────
  { title: 'Rent vs Buy: Should You Buy a Flat in India in 2025?',            hints: { niche: 'finance' },           expected: ['personal_finance'] },
  { title: 'SIP vs Lump Sum: Which Investment Strategy Works?',                hints: { niche: 'personal finance' },  expected: ['personal_finance'] },
  { title: 'How I Retired at 35 with Financial Independence',                  hints: {},                             expected: ['personal_finance'] },
  { title: 'Term Insurance Explained: Why You Need It Before 30',              hints: { niche: 'finance' },           expected: ['personal_finance'] },
  { title: 'Mutual Fund Mistakes That Are Costing You Lakhs',                  hints: {},                             expected: ['personal_finance'] },
  { title: 'Paise Kaise Invest Karein 2025 Mein | Hindi Guide',                hints: { niche: 'finance' },           expected: ['personal_finance'] },

  // ── macro_economy ─────────────────────────────────────────────────────────
  { title: "Why India's GDP is Growing But You Feel Poorer",                    hints: { niche: 'news' },              expected: ['macro_economy'] },
  { title: 'RBI Repo Rate Cut Explained: What It Means for Your Loans',        hints: {},                             expected: ['macro_economy'] },
  { title: 'Union Budget 2025 Full Analysis: Winners and Losers',              hints: { niche: 'news' },              expected: ['macro_economy'] },
  { title: 'Stock Market Crash: What Caused It and What Comes Next',           hints: {},                             expected: ['macro_economy'] },
  { title: "India's Trade Deficit Hit Record High — What Does That Mean?",     hints: { niche: 'finance' },           expected: ['macro_economy'] },
  { title: 'Inflation Is Destroying the Middle Class Quietly',                 hints: {},                             expected: ['macro_economy'] },

  // ── crypto_web3 ───────────────────────────────────────────────────────────
  { title: 'Bitcoin Is Crashing — Should You Buy, Hold, or Sell?',            hints: {},                             expected: ['crypto_web3'] },
  { title: 'What Is DeFi? Decentralised Finance Explained Simply',             hints: {},                             expected: ['crypto_web3'] },
  { title: 'WazirX Hack: How Hackers Stole $230 Million in Crypto',            hints: {},                             expected: ['crypto_web3'] },
  { title: 'NFT Is Dead — What Killed the Web3 Dream?',                        hints: {},                             expected: ['crypto_web3'] },

  // ── entrepreneurship ──────────────────────────────────────────────────────
  { title: 'How This 25-Year-Old Bootstrapped a Rs 100 Crore Startup',        hints: { niche: 'business' },          expected: ['entrepreneurship'] },
  { title: 'Why 90% of Startups Fail in the First Year',                       hints: {},                             expected: ['entrepreneurship'] },
  { title: 'Pitch Deck Secrets: What VCs Look for Before Funding',             hints: { niche: 'business' },          expected: ['entrepreneurship'] },
  { title: 'Business Model Deep Dive: How Zomato Makes Money',                 hints: { csp: 'business_case_study' }, expected: ['entrepreneurship'] },
  { title: 'From Zero to Unicorn: The CRED Founder Story',                     hints: { niche: 'business' },          expected: ['entrepreneurship'] },

  // ── career_work ───────────────────────────────────────────────────────────
  { title: 'How to Negotiate Your Salary Like a Pro',                          hints: {},                             expected: ['career_work'] },
  { title: 'Resume Mistakes That Got You Rejected in 2 Seconds',               hints: {},                             expected: ['career_work'] },
  { title: 'Layoff Survival Guide: What to Do When You Lose Your Job',         hints: {},                             expected: ['career_work'] },
  { title: 'How I Switched from IT to Product Management with No Experience',  hints: {},                             expected: ['career_work'] },
  { title: 'Toxic Workplace Signs You Are Being Gaslighted at Work',           hints: {},                             expected: ['career_work'] },

  // ── geopolitics ───────────────────────────────────────────────────────────
  { title: 'India vs China Border Conflict: Full Timeline Explained',          hints: { niche: 'news' },              expected: ['geopolitics'] },
  { title: 'Russia-Ukraine War: Who Is Really Winning in 2025?',               hints: {},                             expected: ['geopolitics'] },
  { title: 'Why NATO Is Expanding and Why Russia Is Furious',                  hints: { niche: 'geopolitics' },       expected: ['geopolitics'] },
  { title: 'BRICS Summit 2025: Can It Challenge the Dollar?',                  hints: { niche: 'news' },              expected: ['geopolitics'] },
  { title: 'Iran-Israel War: How It Will Hit India\'s Economy and Oil',         hints: {},                             expected: ['geopolitics'] },
  { title: 'Taiwan Strait Crisis: Is War Imminent?',                           hints: {},                             expected: ['geopolitics'] },

  // ── india_politics ────────────────────────────────────────────────────────
  { title: 'BJP vs Congress: Who Will Win the 2024 General Election?',         hints: {},                             expected: ['india_politics'] },
  { title: 'Modi Government\'s Big Economic Decisions Explained',               hints: { niche: 'news' },              expected: ['india_politics'] },
  { title: 'Reservation Debate: Should Caste-Based Quota Continue?',           hints: {},                             expected: ['india_politics'] },
  { title: 'Kejriwal Arrested: Full Story and Legal Analysis',                  hints: {},                             expected: ['india_politics'] },
  { title: 'Lok Sabha Election Results 2024: Winners, Losers, Surprises',      hints: { niche: 'politics' },          expected: ['india_politics'] },

  // ── crime_scam ────────────────────────────────────────────────────────────
  { title: 'The Mahadev Betting App Scam: How Rs 6000 Crore Was Stolen',      hints: {},                             expected: ['crime_scam'] },
  { title: 'Dark Side of Byjus: The Fall of India\'s Most Valued Startup',     hints: {},                             expected: ['crime_scam'] },
  { title: 'Crypto Investment Scam: How 5000 Victims Lost Everything',         hints: {},                             expected: ['crime_scam'] },
  { title: 'Fake Baba Exposed: How He Built a Rs 500 Crore Empire',           hints: {},                             expected: ['crime_scam'] },
  { title: 'Murder in the Dark: The Atul Subhash Case Explained',              hints: {},                             expected: ['crime_scam'] },

  // ── medical_wellness ──────────────────────────────────────────────────────
  { title: 'Early Signs of Diabetes You Should Never Ignore',                   hints: {},                             expected: ['medical_wellness'] },
  { title: 'PCOD vs PCOS: What Every Woman Needs to Know',                     hints: {},                             expected: ['medical_wellness'] },
  { title: 'Breaking Point: India\'s Silent Mental Health Crisis',              hints: {},                             expected: ['medical_wellness'] },
  { title: 'Gut Health 101: Why Your Microbiome Controls Everything',           hints: {},                             expected: ['medical_wellness'] },
  { title: 'Ayurvedic Cure for Thyroid That Doctors Won\'t Tell You',           hints: {},                             expected: ['medical_wellness'],   not_expected: ['fitness_body'] },

  // ── fitness_body ──────────────────────────────────────────────────────────
  { title: 'How to Lose 10kg Fat in 3 Months (No Gym Needed)',                 hints: { niche: 'fitness' },           expected: ['fitness_body'] },
  { title: 'The Perfect Muscle Building Diet for Indian Bodies',                hints: {},                             expected: ['fitness_body'] },
  { title: 'Leg Day Workout That Actually Builds Mass',                         hints: { niche: 'fitness' },           expected: ['fitness_body'] },
  { title: 'Bench Press Form: Why You Are Doing It Wrong',                     hints: {},                             expected: ['fitness_body'] },
  { title: 'Progressive Overload Explained for Beginners',                     hints: { niche: 'bodybuilding' },      expected: ['fitness_body'] },

  // ── sexual_health ─────────────────────────────────────────────────────────
  { title: 'Sex Education Nobody Taught You in School',                         hints: {},                             expected: ['sexual_health'] },
  { title: 'How to Fix a Toxic Relationship Before It Destroys You',           hints: {},                             expected: ['sexual_health'] },
  { title: 'Coming Out Story: How I Told My Indian Parents I Am Gay',          hints: {},                             expected: ['sexual_health'] },
  { title: 'Dating Apps Are Making Us Lonelier — Here\'s Why',                  hints: {},                             expected: ['sexual_health'] },
  { title: 'The Real Reason Arranged Marriages Fail in India',                  hints: {},                             expected: ['sexual_health'] },

  // ── history_culture ───────────────────────────────────────────────────────
  { title: 'How the Mughal Empire Actually Ended (Not What You Think)',         hints: {},                             expected: ['history_culture'] },
  { title: 'The Real Story of India\'s Partition: Why It Happened',             hints: {},                             expected: ['history_culture'] },
  { title: 'Chandragupta Maurya: The Greatest Emperor India Never Celebrates', hints: {},                             expected: ['history_culture'] },
  { title: 'How the British East India Company Looted Rs 45 Trillion',         hints: {},                             expected: ['history_culture'] },
  { title: 'The Forgotten History of India\'s Ancient Trade Routes',            hints: {},                             expected: ['history_culture'] },

  // ── science_tech_ai ───────────────────────────────────────────────────────
  { title: 'ChatGPT Is Getting Smarter — Should You Be Scared?',               hints: {},                             expected: ['science_tech_ai'] },
  { title: 'Chandrayaan-3 Success: What India Discovered on the Moon',         hints: {},                             expected: ['science_tech_ai'] },
  { title: 'Climate Change Is Accelerating Faster Than Scientists Predicted',  hints: {},                             expected: ['science_tech_ai'] },
  { title: 'How AI Will Replace 300 Million Jobs in the Next 10 Years',        hints: {},                             expected: ['science_tech_ai'] },
  { title: 'Quantum Computing Explained: Why IBM Is Ahead of Everyone',        hints: {},                             expected: ['science_tech_ai'] },

  // ── gadgets_reviews ───────────────────────────────────────────────────────
  { title: 'iPhone 16 vs Samsung Galaxy S25: Which Is Worth Your Money?',      hints: {},                             expected: ['gadgets_reviews'] },
  { title: 'Best Phone Under 20000 in India (2025) — Full Comparison',         hints: { niche: 'smartphone reviews' },expected: ['gadgets_reviews'] },
  { title: 'Nothing Ear 3 Unboxing and First Impressions',                     hints: {},                             expected: ['gadgets_reviews'] },
  { title: 'MacBook Air M3 Review After 6 Months: Is It Worth It?',            hints: {},                             expected: ['gadgets_reviews'] },
  { title: 'Gaming Laptop Under 70000: Asus ROG vs Lenovo Legion',             hints: {},                             expected: ['gadgets_reviews'] },

  // ── education_career ──────────────────────────────────────────────────────
  { title: 'UPSC Topper Strategy: How I Cleared IAS in First Attempt',         hints: { niche: 'upsc exam preparation' }, expected: ['education_career'] },
  { title: 'JEE Advanced 2025: Complete Paper Analysis and Cutoff',            hints: {},                             expected: ['education_career'] },
  { title: 'How to Score 95% in CBSE Board Exams Without Coaching',           hints: {},                             expected: ['education_career'] },
  { title: 'NEET 2025 Preparation Strategy from Day One',                      hints: {},                             expected: ['education_career'] },
  { title: 'Best Study Techniques Backed by Neuroscience',                     hints: { niche: 'education' },         expected: ['education_career'] },

  // ── food_recipes ──────────────────────────────────────────────────────────
  { title: 'Perfect Chicken Biryani Recipe at Home (Hyderabadi Style)',        hints: {},                             expected: ['food_recipes'],   not_expected: ['food_places'] },
  { title: 'How to Make Soft Roti That Never Gets Hard',                       hints: { niche: 'cooking' },           expected: ['food_recipes'] },
  { title: 'No Oven Chocolate Cake Recipe in 30 Minutes',                      hints: {},                             expected: ['food_recipes'] },
  { title: 'Restaurant-Style Paneer Butter Masala at Home',                    hints: {},                             expected: ['food_recipes'] },

  // ── food_places ───────────────────────────────────────────────────────────
  { title: 'Best Street Food in Old Delhi You Cannot Miss',                    hints: {},                             expected: ['food_places'],    not_expected: ['food_recipes'] },
  { title: 'Mumbai Food Walk: 10 Hidden Gems in Dharavi',                      hints: {},                             expected: ['food_places'] },
  { title: 'Honest Review: Is This Famous Chennai Restaurant Worth Rs 2000?', hints: {},                             expected: ['food_places'] },
  { title: 'I Tried Every Vada Pav in Mumbai — Here Is the Best One',         hints: {},                             expected: ['food_places'] },

  // ── travel_places ─────────────────────────────────────────────────────────
  { title: 'Solo Trip to Ladakh on a Budget of Rs 15000',                      hints: {},                             expected: ['travel_places'] },
  { title: 'Bali Travel Guide 2025: What Nobody Tells You',                    hints: { niche: 'travel' },            expected: ['travel_places'] },
  { title: 'How to Plan a 10-Day Europe Trip Without a Travel Agent',          hints: {},                             expected: ['travel_places'] },
  { title: 'Hidden Gems in Himachal Pradesh That No Tourists Visit',           hints: {},                             expected: ['travel_places'] },
  { title: 'Visa Tips for Indian Passport Holders: My Experience',             hints: { niche: 'travel vlogs' },      expected: ['travel_places'] },

  // ── self_improvement ──────────────────────────────────────────────────────
  { title: 'The One Atomic Habit That Will Change Your Life',                   hints: {},                             expected: ['self_improvement'] },
  { title: 'Morning Routine of Top Performers: What Science Says',              hints: {},                             expected: ['self_improvement'] },
  { title: 'How to Stop Procrastinating: The Psychology Behind It',             hints: {},                             expected: ['self_improvement'] },
  { title: 'Stoicism for Indians: Ancient Wisdom for Modern Problems',          hints: {},                             expected: ['self_improvement'] },
  { title: 'Why Emotional Intelligence Matters More Than IQ in 2025',          hints: {},                             expected: ['self_improvement'] },

  // ── celebrity_pop ─────────────────────────────────────────────────────────
  { title: 'Stree 2 Review: Why It Broke Every Bollywood Record',              hints: {},                             expected: ['celebrity_pop'] },
  { title: 'Ranveer Allahbadia: Full Interview with India\'s Top Podcaster',    hints: {},                             expected: ['celebrity_pop'] },
  { title: 'Netflix India in 2025: Best and Worst Shows Ranked',               hints: {},                             expected: ['celebrity_pop'] },
  { title: 'SRK\'s Net Worth Breakdown: How Shah Rukh Khan Makes His Money',   hints: {},                             expected: ['celebrity_pop'] },
  { title: 'Kalki 2898 AD Trailer Breakdown: Every Detail You Missed',        hints: {},                             expected: ['celebrity_pop'] },

  // ── gaming ────────────────────────────────────────────────────────────────
  { title: 'BGMI Ranked Push Tips: How I Hit Conqueror This Season',           hints: { niche: 'gaming' },            expected: ['gaming'] },
  { title: 'GTA 6 Trailer Breakdown: Everything We Know So Far',               hints: {},                             expected: ['gaming'] },
  { title: 'Best Budget Gaming Setup Under Rs 50000 in India',                 hints: {},                             expected: ['gaming'],         not_expected: ['gadgets_reviews'] },
  { title: 'Free Fire vs BGMI: Which Game Is Better in 2025?',                 hints: {},                             expected: ['gaming'] },
  { title: 'Minecraft 1.21 Update: All New Features Explained',                hints: { niche: 'minecraft gameplay' }, expected: ['gaming'] },

  // ── sports_cricket ────────────────────────────────────────────────────────
  { title: 'IPL 2025 Auction: Every Big Deal Analyzed',                        hints: {},                             expected: ['sports_cricket'] },
  { title: 'Virat Kohli Retirement: The Real Story Behind His Decision',        hints: {},                             expected: ['sports_cricket'] },
  { title: 'India vs Pakistan T20 World Cup: Full Pre-Match Analysis',          hints: {},                             expected: ['sports_cricket'] },
  { title: 'Why Indian Football Will Never Be World Class',                     hints: {},                             expected: ['sports_cricket'] },

  // ── music_performance ─────────────────────────────────────────────────────
  { title: 'Tum Hi Ho — Acoustic Cover by Me',                                  hints: { niche: 'music' },             expected: ['music_performance'] },
  { title: 'Original Song: Teri Yaad | Slowed and Reverb Version',             hints: {},                             expected: ['music_performance'] },
  { title: 'Making of My New Single — Behind the Song',                         hints: { niche: 'music' },             expected: ['music_performance'] },
  { title: 'Heartbreak Lyric Video | Hindi Sad Song 2025',                      hints: {},                             expected: ['music_performance'] },
  { title: 'Live Session at Bacardi NH7 Weekender',                             hints: { niche: 'music' },             expected: ['music_performance'] },

  // ── devotional_spiritual ──────────────────────────────────────────────────
  { title: 'Hanuman Chalisa with Lyrics and Meaning',                           hints: {},                             expected: ['devotional_spiritual'] },
  { title: 'Morning Shiva Mantra for Positive Energy',                          hints: {},                             expected: ['devotional_spiritual'] },
  { title: 'Navratri Special Aarti: Jai Mata Di',                               hints: {},                             expected: ['devotional_spiritual'] },
  { title: 'Gurbani Kirtan: Waheguru Simran for Peace',                         hints: {},                             expected: ['devotional_spiritual'] },
  { title: 'How to Do Pujas at Home: Complete Guide for Beginners',             hints: {},                             expected: ['devotional_spiritual'] },

  // ── social_issues ─────────────────────────────────────────────────────────
  { title: 'Why Farmer Suicides Continue Despite Government Promises',          hints: {},                             expected: ['social_issues'] },
  { title: 'India\'s Income Inequality Is Worse Than You Think',                hints: {},                             expected: ['social_issues'] },
  { title: 'Child Labour in India: The Hidden Crisis No One Talks About',      hints: {},                             expected: ['social_issues'] },
  { title: 'Women Safety in India: Why Nothing Is Changing',                   hints: {},                             expected: ['social_issues'] },

  // ── Edge cases ────────────────────────────────────────────────────────────

  // Multi-territory: should match both
  { title: 'Real Estate in India: Should You Buy or Invest in Mutual Funds?',
    hints: { niche: 'finance' },
    expected: ['personal_finance', 'macro_economy'],
    note: 'dual territory' },

  // Raj Shamani style: broad creator, geopolitics + business
  { title: 'How the Russia-Ukraine War Is Destroying Indian Startup Funding',
    hints: { niche: 'business', csp: 'founder_economy_conversation' },
    expected: ['geopolitics', 'entrepreneurship'],
    note: 'cross-territory broad creator' },

  // Hinglish — should still classify
  { title: 'Stock Market mein 5 lakh invest karo, 50 lakh kaise banate hain',
    hints: { niche: 'finance' },
    expected: ['personal_finance'],
    note: 'hinglish' },

  // Junk / CTA title — should classify to nothing
  { title: 'Subscribe for Daily Updates | Like and Share',
    hints: {},
    expected: [],
    note: 'CTA junk, should return empty' },

  // Very short vlog title — ambiguous, should not over-classify
  { title: 'My Day Vlog #42',
    hints: {},
    expected: [],
    note: 'generic vlog, should return empty or nothing strong' },

  // Pure Devanagari — V1 limitation, should return []
  { title: 'मुझे बहुत खुशी है आज का दिन',
    hints: {},
    expected: [],
    note: 'pure Devanagari, V1 skip' },

  // Shorts hashtag noise — should not create territory permission from loose words
  { title: 'Depression 😂 #funny #comedy #youtubeshorts #viral #shorts',
    hints: { niche: 'marathi comedy shorts' },
    expected: [],
    not_expected: ['medical_wellness'],
    note: 'comedy depression is not medical territory' },

  { title: 'Terminal crossing activity #fun #gameplay #trending #funlearning',
    hints: { niche: 'school events' },
    expected: [],
    not_expected: ['gaming'],
    note: 'school activity hashtag gameplay is not gaming territory' },

  { title: 'Samsung Galaxy A17 5G – Slim, Stylish, Smart & Affordable!',
    hints: { niche: 'tourist destinations' },
    expected: [],
    not_expected: ['gadgets_reviews'],
    note: 'single sponsor-style product mention should not define travel channel territory' },

  { title: 'Sadar Bazaar Holi Market 2026: Wholesale Rate Full Tour',
    hints: { niche: 'local markets in delhi' },
    expected: [],
    not_expected: ['macro_economy', 'entrepreneurship'],
    note: 'local bazaar title is not macro/business territory' },

  { title: 'Delhi’s Best Shoe Market: Karol Bagh Monday Market',
    hints: { niche: 'local markets in delhi' },
    expected: [],
    not_expected: ['macro_economy', 'entrepreneurship', 'celebrity_pop'],
    note: 'shopping market coverage should not become economy/startup/pop territory' },

  { title: 'My Sneaker Collection In College',
    hints: { niche: 'daily life vlogs' },
    expected: [],
    not_expected: ['celebrity_pop'],
    note: 'collection alone is not box office/pop culture territory' },

  { title: 'I Tried To Get EVERY ITEM in Descenders',
    hints: { niche: 'extreme sports video games' },
    expected: [],
    not_expected: ['food_places'],
    note: 'I tried gameplay titles are not food-place territory' },

  { title: 'How To Make Beats In Ableton Live',
    hints: { niche: 'music' },
    expected: ['music_performance'],
    not_expected: ['food_recipes'],
    note: 'how to make beats is music education, not a recipe' },

  { title: 'Old Is Gold | AI Female Voice | Lata Mangeshkar Cover Song',
    hints: { niche: '90s hindi love songs' },
    expected: ['music_performance'],
    not_expected: ['science_tech_ai'],
    note: 'AI voice in music title is a production detail, not AI territory' },

  { title: '90s Hits Hindi Songs | Old Superhit Bollywood Love Songs',
    hints: { niche: 'bollywood songs' },
    expected: ['music_performance'],
    not_expected: ['celebrity_pop'],
    note: 'Bollywood song packaging is music territory, not celebrity/pop territory' },

  { title: 'Pink color Morning Routine #makeup #ytshorts #viral',
    hints: { niche: 'makeup tutorials' },
    expected: [],
    not_expected: ['self_improvement'],
    note: 'beauty routine is not self-improvement territory' },

  // Tech vs gadgets disambiguation
  { title: 'How AI Is Changing Healthcare in India',
    hints: {},
    expected: ['science_tech_ai'],
    not_expected: ['gadgets_reviews'] },

  // Fitness vs medical disambiguation
  { title: 'Diet Plan for Weight Loss: What I Eat in a Day',
    hints: { niche: 'fitness' },
    expected: ['fitness_body'],
    not_expected: ['medical_wellness'] },

  // Self-improvement vs education disambiguation
  { title: 'How to Focus Better and Study for Long Hours',
    hints: { niche: 'education' },
    expected: ['education_career', 'self_improvement'],
    note: 'valid overlap' },
];

// ── Test runner ───────────────────────────────────────────────────────────────

function runTests() {
  let passed = 0, failed = 0;
  const failures = [];
  const warnings = [];

  for (const fix of FIXTURES) {
    const result   = classifyVideoTerritories(fix.title, fix.hints || {});
    const returned = result.map(r => r.territory_id);

    // A fixture passes when:
    // 1. All expected territories appear in the returned list
    // 2. None of the not_expected territories appear
    const missingExpected   = (fix.expected || []).filter(t => !returned.includes(t));
    const unwantedReturned  = (fix.not_expected || []).filter(t => returned.includes(t));

    const ok = missingExpected.length === 0 && unwantedReturned.length === 0;

    if (ok) {
      passed++;
    } else {
      failed++;
      failures.push({
        title:   fix.title.slice(0, 70),
        note:    fix.note || '',
        missing: missingExpected,
        unwanted: unwantedReturned,
        got:     returned,
      });
    }
  }

  const total  = FIXTURES.length;
  const pct    = Math.round((passed / total) * 100);
  const passed_gate = pct >= 85;

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  TERRITORY CLASSIFIER FIXTURE TESTS`);
  console.log('══════════════════════════════════════════════════════════\n');
  console.log(`  Total fixtures : ${total}`);
  console.log(`  Passed         : ${passed}`);
  console.log(`  Failed         : ${failed}`);
  console.log(`  Score          : ${pct}%  ${passed_gate ? '✓ GATE PASSED (>= 85%)' : '✗ GATE FAILED (< 85%)'}`);
  console.log('');

  if (failures.length > 0) {
    console.log('── FAILURES ──────────────────────────────────────────────\n');
    for (const f of failures) {
      console.log(`  Title   : ${f.title}`);
      if (f.note) console.log(`  Note    : ${f.note}`);
      if (f.missing.length)  console.log(`  Missing : ${f.missing.join(', ')}`);
      if (f.unwanted.length) console.log(`  Unwanted: ${f.unwanted.join(', ')}`);
      console.log(`  Got     : ${f.got.length > 0 ? f.got.join(', ') : '(nothing)'}`);
      console.log('');
    }
  }

  // Per-territory coverage report
  console.log('── TERRITORY COVERAGE ────────────────────────────────────\n');
  const byTerritory = {};
  for (const fix of FIXTURES) {
    for (const t of (fix.expected || [])) {
      if (!byTerritory[t]) byTerritory[t] = { total: 0, passed: 0 };
      byTerritory[t].total++;
    }
  }
  for (const fix of FIXTURES) {
    const result   = classifyVideoTerritories(fix.title, fix.hints || {});
    const returned = result.map(r => r.territory_id);
    for (const t of (fix.expected || [])) {
      if (returned.includes(t)) byTerritory[t].passed++;
    }
  }

  const rows = Object.entries(byTerritory).sort((a, b) => a[1].passed / a[1].total - b[1].passed / b[1].total);
  for (const [t, s] of rows) {
    const p = Math.round(s.passed / s.total * 100);
    const bar = '█'.repeat(Math.round(p / 10)) + '░'.repeat(10 - Math.round(p / 10));
    const flag = p < 80 ? ' ← NEEDS WORK' : '';
    console.log(`  ${t.padEnd(30)} ${bar} ${p}% (${s.passed}/${s.total})${flag}`);
  }

  console.log('\n══════════════════════════════════════════════════════════\n');
  return { passed, failed, total, pct, passed_gate };
}

const result = runTests();
process.exit(result.passed_gate ? 0 : 1);
