// End-to-end demo of the Instagram lead pipeline on the KEYLESS mock provider:
//   sweep (hashtags → instagram_media) → trend (→ instagram_trend_signals) → cross-platform lead.
// Proves the "🚀 Early on Instagram" head-start signal with zero spend / zero network.
process.env.INSTAGRAM_PROVIDER = process.env.INSTAGRAM_PROVIDER || 'mock';
const { runInstagramSweep } = require('../jobs/instagramSweep');
const { runInstagramTrendJob } = require('../jobs/instagramTrendJob');
const { runCrossPlatformLead } = require('../jobs/crossPlatformLeadJob');

(async () => {
  console.log('provider =', process.env.INSTAGRAM_PROVIDER, '\n');
  console.log('1) sweep  :', JSON.stringify(await runInstagramSweep()));
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
