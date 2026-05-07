const API = 'http://localhost:3002/api/analyze';

const VIDEOS = [
  // ── TECH (10) ──────────────────────────────────────────────────────────────
  { title: '7 AI Tools That Will Replace Your Job by 2027',             hook: 'Most people have no idea how fast this is happening',                    niche: 'tech',       channel_size: 330000, wing: 'pre' },
  { title: 'ChatGPT vs Gemini vs Claude — Which AI Is Actually Best?',  hook: 'I tested all three for 30 days and the winner surprised me',             niche: 'tech',       channel_size:  55000, wing: 'pre' },
  { title: 'I Built a Full SaaS App Using Only AI in 7 Days',           hook: 'No coding experience required — here\'s exactly how I did it',           niche: 'tech',       channel_size:  42000, wing: 'pre' },
  { title: 'Best AI Tools for Business Owners in 2026',                 hook: 'These tools are cutting costs by 80% for small businesses',              niche: 'tech',       channel_size:  15000, wing: 'pre' },
  { title: 'Why Every Developer Should Learn Rust in 2026',             hook: 'I switched from Python and my productivity doubled overnight',            niche: 'tech',       channel_size:  78000, wing: 'pre' },
  { title: 'The Dark Side of AI Nobody Is Talking About',               hook: 'This is happening right now and most people are completely blind to it',  niche: 'tech',       channel_size: 210000, wing: 'pre' },
  { title: 'How I Automated My Entire Business With No Code',           hook: 'I fired myself from 6 hours of daily work using these 3 tools',          niche: 'tech',       channel_size:  33000, wing: 'pre' },
  { title: 'iPhone 16 vs Samsung S26 — The Real Comparison',           hook: 'The winner is not who you think it is',                                  niche: 'tech',       channel_size: 480000, wing: 'pre' },
  { title: '10 VS Code Extensions That Make You 10x Faster',           hook: 'I wasted 2 years not knowing about number 7',                            niche: 'tech',       channel_size:  95000, wing: 'pre' },
  { title: 'How to Use Claude API to Build Real Products',              hook: 'Most tutorials skip the parts that actually matter — not this one',       niche: 'tech',       channel_size:  27000, wing: 'pre' },

  // ── FINANCE (10) ───────────────────────────────────────────────────────────
  { title: 'Top 5 Stocks to Buy in 2026 Before It\'s Too Late',        hook: 'Most investors are completely ignoring these opportunities right now',    niche: 'finance',    channel_size:  45000, wing: 'pre' },
  { title: 'I Invested $10,000 in Index Funds for 1 Year',             hook: 'The results completely shocked me and my financial advisor',              niche: 'finance',    channel_size: 120000, wing: 'pre' },
  { title: 'The Truth About Passive Income Nobody Tells You',           hook: 'Every guru gets this completely wrong and it\'s costing you money',      niche: 'finance',    channel_size: 150000, wing: 'pre' },
  { title: 'How to Pay Zero Taxes Legally as a Freelancer',            hook: 'My accountant showed me this and I saved $18,000 last year',             niche: 'finance',    channel_size:  62000, wing: 'pre' },
  { title: 'Why the Middle Class Is Disappearing (And How to Escape)',  hook: 'The data is terrifying and no one is talking about it',                  niche: 'finance',    channel_size: 290000, wing: 'pre' },
  { title: 'I Tried Every Budgeting App — Here\'s the Honest Truth',   hook: 'Most of them are designed to keep you broke',                            niche: 'finance',    channel_size:  38000, wing: 'pre' },
  { title: 'How to Build a $1M Portfolio on a $50K Salary',            hook: 'The math is simpler than the finance industry wants you to think',       niche: 'finance',    channel_size:  88000, wing: 'pre' },
  { title: 'Bitcoin in 2026 — Buy, Hold or Sell?',                    hook: 'I\'ve tracked every cycle since 2013 and here\'s what the data says',    niche: 'finance',    channel_size: 175000, wing: 'pre' },
  { title: 'The 3-Fund Portfolio That Beats 95% of Investors',         hook: 'Warren Buffett recommended this and most people still ignore it',        niche: 'finance',    channel_size:  52000, wing: 'pre' },
  { title: 'How I Made $50K in Dividends This Year',                   hook: 'I started with nothing 5 years ago — here\'s the exact playbook',       niche: 'finance',    channel_size:  71000, wing: 'pre' },

  // ── FITNESS (10) ───────────────────────────────────────────────────────────
  { title: 'I Worked Out Every Day for 90 Days — Here\'s What Changed', hook: 'My blood work shocked my doctor at the 3-month checkup',               niche: 'fitness',    channel_size:  95000, wing: 'pre' },
  { title: 'The 20-Minute Morning Workout That Burns Fat All Day',       hook: 'Science shows this works 3x better than an hour at the gym',           niche: 'fitness',    channel_size: 220000, wing: 'pre' },
  { title: 'Why You\'re Not Losing Weight (The Real Reason)',           hook: 'It\'s not your diet. It\'s not your workout. It\'s this.',              niche: 'fitness',    channel_size: 310000, wing: 'pre' },
  { title: '5 Exercises That Replace the Entire Gym',                   hook: 'I cancelled my $150/month gym membership and got stronger',             niche: 'fitness',    channel_size:  48000, wing: 'pre' },
  { title: 'How to Build Muscle After 40 — The Complete Guide',         hook: 'Everything the fitness industry tells you after 40 is wrong',           niche: 'fitness',    channel_size: 130000, wing: 'pre' },
  { title: 'I Ate Like an Athlete for 30 Days — Here\'s My Result',    hook: 'My energy levels at day 30 were unlike anything I\'ve experienced',     niche: 'fitness',    channel_size:  67000, wing: 'pre' },
  { title: 'The Protein Myth That\'s Ruining Your Gains',              hook: 'You\'ve been lied to about protein and it\'s costing you results',      niche: 'fitness',    channel_size:  82000, wing: 'pre' },
  { title: 'How to Run a 5K in 30 Days From Zero',                     hook: 'I went from couch to 5K using only this 12-minute daily method',        niche: 'fitness',    channel_size:  29000, wing: 'pre' },
  { title: 'The Sleep Hack That Doubled My Gym Performance',            hook: 'It costs nothing and takes 5 minutes — I wish I knew this sooner',      niche: 'fitness',    channel_size:  54000, wing: 'pre' },
  { title: 'Why Most People Quit the Gym After 3 Weeks',               hook: 'It\'s not motivation — it\'s a system problem and here\'s the fix',     niche: 'fitness',    channel_size: 190000, wing: 'pre' },

  // ── EDUCATION (10) ─────────────────────────────────────────────────────────
  { title: 'How to Learn Anything 10x Faster Using Science',           hook: 'Schools never teach you how to actually learn — this changes that',      niche: 'education',  channel_size: 420000, wing: 'pre' },
  { title: 'The Note-Taking System Used by Top Harvard Students',       hook: 'I used this for 1 semester and my GPA went from 2.8 to 3.9',            niche: 'education',  channel_size:  73000, wing: 'pre' },
  { title: 'Why Reading 50 Books a Year Changed My Life',              hook: 'I went from reading 0 books to 50 and here\'s what nobody tells you',   niche: 'education',  channel_size: 185000, wing: 'pre' },
  { title: 'How to Learn Python in 30 Days for Free',                  hook: 'I\'ve taught 10,000 students — this is the only path that works',       niche: 'education',  channel_size:  91000, wing: 'pre' },
  { title: 'The Feynman Technique — Learn Anything in Half the Time',  hook: 'Nobel Prize winners use this — why aren\'t you?',                       niche: 'education',  channel_size: 260000, wing: 'pre' },
  { title: 'How to Focus for 4 Hours Without Getting Distracted',      hook: 'The science of deep work and why your phone is destroying your brain',   niche: 'education',  channel_size: 140000, wing: 'pre' },
  { title: 'Is a University Degree Worth It in 2026?',                 hook: 'The data says something very different from what universities tell you',  niche: 'education',  channel_size: 375000, wing: 'pre' },
  { title: 'How I Passed 5 Certifications in 6 Months',               hook: 'I used a 3-step system that most people have never heard of',            niche: 'education',  channel_size:  44000, wing: 'pre' },
  { title: 'The Memory Palace Technique — Never Forget Anything',      hook: 'Ancient technique that memory champions still use today',                niche: 'education',  channel_size: 108000, wing: 'pre' },
  { title: 'Stop Highlighting Your Books — Do This Instead',           hook: 'Highlighting feels productive but the science says it doesn\'t work',    niche: 'education',  channel_size:  57000, wing: 'pre' },

  // ── BUSINESS (10) ──────────────────────────────────────────────────────────
  { title: 'How to Start a Business With $0 in 2026',                  hook: 'I built a six-figure business with no money and no experience',          niche: 'business',   channel_size:  89000, wing: 'pre' },
  { title: 'How I Went From $0 to $10K/Month Selling Digital Products', hook: 'No followers, no budget — here\'s the exact system',                   niche: 'business',   channel_size:  18000, wing: 'pre' },
  { title: 'The Shopify Store Strategy That Made Me $200K',            hook: 'I failed 4 times before finding what actually works',                    niche: 'business',   channel_size:  66000, wing: 'pre' },
  { title: 'Why 90% of Startups Fail in Year One',                    hook: 'I\'ve interviewed 500 founders — the reason is always the same',         niche: 'business',   channel_size: 230000, wing: 'pre' },
  { title: 'How to Get Your First 100 Clients Without Cold Calling',   hook: 'The old sales playbook is dead — here\'s what replaced it',             niche: 'business',   channel_size:  41000, wing: 'pre' },
  { title: 'I Scaled to 7 Figures Using Only Organic Content',         hook: 'No paid ads, no cold outreach — just this repeatable system',           niche: 'business',   channel_size: 155000, wing: 'pre' },
  { title: 'The One-Page Business Plan That Actually Works',           hook: 'I threw away my 40-page plan and replaced it with this',                 niche: 'business',   channel_size:  83000, wing: 'pre' },
  { title: 'How to Hire Your First Employee Without Making Mistakes',  hook: 'My first hire nearly destroyed my business — here\'s what I learned',   niche: 'business',   channel_size:  37000, wing: 'pre' },
  { title: 'Freelancing vs Agency — Which Makes More Money in 2026',   hook: 'I\'ve done both for 5 years — the answer might surprise you',           niche: 'business',   channel_size:  62000, wing: 'pre' },
  { title: 'How to Price Your Services and Stop Undercharging',        hook: 'Most freelancers earn 50% less than they should — here\'s why',          niche: 'business',   channel_size:  99000, wing: 'pre' },

  // ── MOTIVATION (10) ────────────────────────────────────────────────────────
  { title: 'The Morning Routine That Changed My Life in 30 Days',      hook: 'I was exhausted, broke, and stuck — until I tried this',                niche: 'motivation', channel_size: 210000, wing: 'pre' },
  { title: 'Stop Wasting Your 20s — Do These 5 Things Instead',        hook: 'I wasted 3 years before figuring this out — don\'t make my mistake',    niche: 'motivation', channel_size:  67000, wing: 'pre' },
  { title: 'Why Most People Never Achieve Their Goals (Be Honest)',    hook: 'The answer isn\'t what self-help books tell you',                       niche: 'motivation', channel_size: 390000, wing: 'pre' },
  { title: 'I Did One Hard Thing Every Day for a Year — Here\'s What Happened', hook: 'By month 3 my entire life had changed in ways I didn\'t expect', niche: 'motivation', channel_size: 145000, wing: 'pre' },
  { title: 'The 5-Second Rule That Kills Procrastination Instantly',   hook: 'It sounds too simple to work — it\'s not',                              niche: 'motivation', channel_size: 270000, wing: 'pre' },
  { title: 'How I Went From Depressed to the Best Shape of My Life',  hook: 'I\'m not going to sugarcoat this — it was brutal before it got better', niche: 'motivation', channel_size:  88000, wing: 'pre' },
  { title: 'Stop Comparing Yourself to Others — Do This Instead',     hook: 'Social media is designed to make you feel like a failure',               niche: 'motivation', channel_size: 195000, wing: 'pre' },
  { title: 'The Mindset Shift That Made Me $1M',                      hook: 'It had nothing to do with working harder or waking up at 5am',           niche: 'motivation', channel_size: 320000, wing: 'pre' },
  { title: 'Why Discipline Beats Motivation Every Single Time',        hook: 'Motivation is a lie the self-help industry sells you',                   niche: 'motivation', channel_size: 410000, wing: 'pre' },
  { title: 'How to Build Confidence When You Have None',              hook: 'I was the least confident person in every room — until I did this',       niche: 'motivation', channel_size:  73000, wing: 'pre' },
];

const TOTAL = VIDEOS.length;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function analyzeVideo(video, index) {
  const label = `[${String(index + 1).padStart(2, '0')}/${TOTAL}]`;
  try {
    const res  = await fetch(API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(video),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(`${label} FAILED — ${data.error}`);
      return;
    }

    const top = data.similar_videos?.[0];
    const topLabel = top ? `top_match="${top.title?.slice(0, 35)}..." (${top.similarity_score}%)` : 'no matches yet';

    console.log(
      `${label} [${video.niche.padEnd(10)}] "${video.title.slice(0, 45)}"\n` +
      `          score=${data.final_score} | conf=${data.confidence.toFixed ? data.confidence.toFixed(2) : data.confidence}` +
      ` | similar=${data.similar_videos.length} | degraded=${data.degraded_mode}\n` +
      `          ${topLabel}\n`
    );
  } catch (err) {
    console.error(`${label} Network error:`, err.message);
  }
}

async function seed() {
  console.log(`Seeding ${TOTAL} videos across 6 niches...\n`);
  console.log('Niches: tech, finance, fitness, education, business, motivation\n');

  let succeeded = 0;
  let failed    = 0;

  for (let i = 0; i < VIDEOS.length; i++) {
    const before = Date.now();
    await analyzeVideo(VIDEOS[i], i);
    const elapsed = Date.now() - before;
    succeeded++;
    // Keep total per-request time ~2s to avoid rate limits
    const remaining = Math.max(0, 2000 - elapsed);
    if (i < VIDEOS.length - 1) await sleep(remaining);
  }

  console.log(`\nDone. ${succeeded} seeded, ${failed} failed.`);
  console.log('Run GET http://localhost:3002/api/debug/db-stats to verify counts.');
}

seed();
