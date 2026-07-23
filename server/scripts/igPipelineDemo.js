// End-to-end run of the Instagram lead pipeline:
//   sweep (hashtags → instagram_media) → trend (→ instagram_trend_signals) → cross-platform lead.
// Surfaces the "🚀 Early on Instagram" head-start signal. Default provider is the keyless mock; set
// INSTAGRAM_PROVIDER=apify (+ APIFY_TOKEN in .env) to run against real Reels.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.INSTAGRAM_PROVIDER = process.env.INSTAGRAM_PROVIDER || 'mock';
const { runInstagramSweep } = require('../jobs/instagramSweep');
const { runInstagramTrendJob } = require('../jobs/instagramTrendJob');
const { runCrossPlatformLead } = require('../jobs/crossPlatformLeadJob');

// Apify run uses the full SEED_HASHTAGS at IG_LIMIT results each. Set IG_SMOKE=1 for a tiny 3-hashtag
// probe (protects credit while testing). IG_LIMIT tunes results-per-hashtag (= cost).
const isApify = process.env.INSTAGRAM_PROVIDER === 'apify';
const sweepOpts = isApify ? {
  limit: parseInt(process.env.IG_LIMIT || '60', 10),
  ...(process.env.IG_SMOKE ? { seedHashtags: { education: ['upsc'], food: ['streetfood'], fitness: ['cortisoldetox'] } } : {}),
} : {};

(async () => {
  console.log('provider =', process.env.INSTAGRAM_PROVIDER, isApify ? `(limit ${sweepOpts.limit}/hashtag${process.env.IG_SMOKE ? ', SMOKE' : ''})` : '', '\n');
  console.log('1) sweep  :', JSON.stringify(await runInstagramSweep(sweepOpts)));
  console.log('2) trend  :', JSON.stringify(await runInstagramTrendJob()));
  const lead = runCrossPlatformLead();
  console.log('3) lead   :', JSON.stringify({ early_on_instagram: lead.early_on_instagram, both: lead.both }), '\n');

  console.log('=== 🚀 Early on Instagram (hot on IG, NOT yet in the YouTube corpus = head start) ===');
  lead.rows.filter(r => r.status === 'early_on_instagram').sort((a, b) => b.ig - a.ig)
    .forEach(r => console.log(`   • ${r.topic}  [${r.niche}] — ${r.ig} IG accounts, absent on YouTube`));

  console.log('\n=== 🔁 On both platforms (IG lead time, +ve = IG was ahead) ===');
  lead.rows.filter(r => r.status === 'both').sort((a, b) => (b.leadDays || 0) - (a.leadDays || 0))
    .forEach(r => console.log(`   • ${r.topic}  [${r.niche}] — ${r.ig} IG accts vs ${r.ytCh} YT channels, lead ${r.leadDays == null ? 'n/a' : r.leadDays + 'd'}`));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
