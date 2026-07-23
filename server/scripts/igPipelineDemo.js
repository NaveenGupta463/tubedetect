// End-to-end run of the Instagram lead pipeline:
//   sweep (hashtags → instagram_media) → trend (→ instagram_trend_signals) → cross-platform lead.
// Surfaces the "🚀 Early on Instagram" head-start signal. Default provider is the keyless mock; set
// INSTAGRAM_PROVIDER=apify (+ APIFY_TOKEN in .env) to run against real Reels.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.INSTAGRAM_PROVIDER = process.env.INSTAGRAM_PROVIDER || 'mock';
process.env.TIKTOK_PROVIDER = process.env.TIKTOK_PROVIDER || 'mock';
const { runTikTokSweep } = require('../jobs/tiktokSweep');
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
  console.log('1) ig sweep :', JSON.stringify(await runInstagramSweep(sweepOpts)));
  console.log('2) ig trend :', JSON.stringify(await runInstagramTrendJob()));
  console.log('3) tt sweep :', JSON.stringify(await runTikTokSweep()));
  const lead = runCrossPlatformLead();
  console.log('4) lead     :', JSON.stringify({ early_on_instagram: lead.early_on_instagram, both: lead.both, coming_from_tiktok: lead.coming_from_tiktok }), '\n');

  console.log('=== 🌍 Coming from TikTok (hot on US/UK TikTok, NOT yet on India YouTube = biggest head start) ===');
  lead.rows.filter(r => r.source === 'tiktok').sort((a, b) => b.strength - a.strength)
    .forEach(r => console.log(`   • ${r.topic}  [${r.niche}] — ${r.status}${r.region ? ' (' + r.region + ')' : ''}, ${r.strength} posts`));

  console.log('\n=== 🚀 Early on Instagram (hot on IG India, NOT yet on YouTube) ===');
  lead.rows.filter(r => r.status === 'early_on_instagram').sort((a, b) => b.strength - a.strength)
    .forEach(r => console.log(`   • ${r.topic}  [${r.niche}] — ${r.strength} IG accounts`));

  console.log('\n=== 🔁 On both platforms (IG lead time) ===');
  lead.rows.filter(r => r.status === 'both').sort((a, b) => (b.leadDays || 0) - (a.leadDays || 0))
    .forEach(r => console.log(`   • ${r.topic}  [${r.niche}] — ${r.strength} IG vs ${r.ytCh} YT, lead ${r.leadDays == null ? 'n/a' : r.leadDays + 'd'}`));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
