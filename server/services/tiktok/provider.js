'use strict';

// Provider-agnostic TikTok TREND adapter.
//
// Unlike Instagram (where we scrape media and compute adoption ourselves), TikTok exposes an OFFICIAL
// ranked trend feed: TikTok Creative Center's Trend Discovery — trending hashtags/sounds by COUNTRY and
// time window, powered by TikTok's own signals. So the contract here returns a RANKED TREND LIST, not
// media. TikTok is banned in India but that's irrelevant: the provider queries Creative Center from
// Western infrastructure; we only consume the result. The West→India migration (US/UK TikTok → Indian
// Reels/Shorts, weeks later) makes these the strongest LEADING indicator we have.
//
// CONTRACT:
//   trendingHashtags(region, { window=7, industry=null, limit=100 }) -> Promise<Trend[]>
//   Trend = { hashtag, rank, region, industry, post_count, video_views, trend_direction }

class BaseProvider {
  async trendingHashtags() { throw new Error('trendingHashtags not implemented'); }
}

// Apify clockworks/tiktok-trends-scraper wraps Creative Center Trend Discovery. Reuses the SAME Apify
// token as Instagram. Field names guarded with fallbacks (actor output drifts); refine after first run.
class ApifyTikTokProvider extends BaseProvider {
  constructor() {
    super();
    this.token = process.env.APIFY_TOKEN;
    this.actor = process.env.TIKTOK_APIFY_ACTOR || 'clockworks~tiktok-trends-scraper';
  }
  async trendingHashtags(region, opts = {}) {
    if (!this.token) throw new Error('APIFY_TOKEN not set — add it to server/.env, or run TIKTOK_PROVIDER=mock to stay keyless.');
    const url = `https://api.apify.com/v2/acts/${this.actor}/run-sync-get-dataset-items?token=${encodeURIComponent(this.token)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 300000);
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        // clockworks/tiktok-trends-scraper input schema: adsScrapeHashtags + adsCountryCode +
        // adsTimeRange("7"/"30"/"120") + optional adsHashtagIndustry.
        body: JSON.stringify({
          adsScrapeHashtags: true,
          resultsPerPage: opts.limit ?? 100,
          adsCountryCode: region,
          adsTimeRange: String(opts.window ?? 7),
          ...(opts.industry ? { adsHashtagIndustry: opts.industry } : {}),
        }),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
    if (!resp.ok) throw new Error(`Apify(tiktok) ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const items = await resp.json();
    if (!Array.isArray(items)) throw new Error('Apify(tiktok) returned non-array dataset');
    return items.map((it, i) => ({
      hashtag: String(it.hashtagName || it.hashtag || it.name || it.title || '').replace(/^#/, ''),
      rank: it.rank ?? it.rankIndex ?? (i + 1),
      region,
      industry: it.industryInfoName || it.industry || it.industryName || null,
      post_count: it.publishCnt ?? it.postCount ?? it.videoCount ?? it.posts ?? 0,
      video_views: it.videoViews ?? it.views ?? 0,
      trend_direction: it.trend || it.rankDiffType || null,
    })).filter(t => t.hashtag);
  }
}

// Mock: deterministic ranked trends per region so the multi-platform lead + WTP wiring run keyless.
// Seeded to exercise every path: some also present in India (world cup / street food) and several
// classic Western-first trends absent from India (surface as "coming_from_tiktok" head starts).
const MOCK_TRENDS = {
  US: [
    { hashtag: 'loudbudgeting', industry: 'finance', posts: 82000 },
    { hashtag: 'girldinner', industry: 'food', posts: 141000 },
    { hashtag: 'silentwalking', industry: 'fitness', posts: 63000 },
    { hashtag: 'sleepygirlmocktail', industry: 'health', posts: 51000 },
    { hashtag: 'bedrotting', industry: 'lifestyle', posts: 47000 },
    { hashtag: 'worldcup', industry: 'sports', posts: 320000 },
    { hashtag: 'studywithme', industry: 'education', posts: 90000 },
  ],
  GB: [
    { hashtag: 'loudbudgeting', industry: 'finance', posts: 40000 },
    { hashtag: 'morningshed', industry: 'health', posts: 38000 },
    { hashtag: 'streetfood', industry: 'food', posts: 55000 },
    { hashtag: 'rawdogging', industry: 'lifestyle', posts: 29000 },
    { hashtag: 'worldcup', industry: 'sports', posts: 210000 },
  ],
};

class MockTikTokProvider extends BaseProvider {
  async trendingHashtags(region, opts = {}) {
    const list = MOCK_TRENDS[region] || MOCK_TRENDS.US;
    return list.slice(0, opts.limit ?? 100).map((t, i) => ({
      hashtag: t.hashtag, rank: i + 1, region, industry: t.industry,
      post_count: t.posts, video_views: t.posts * 30, trend_direction: 'up',
    }));
  }
}

function getTikTokProvider(name = process.env.TIKTOK_PROVIDER || 'mock') {
  switch (name) {
    case 'mock':  return new MockTikTokProvider();
    case 'apify': return new ApifyTikTokProvider();
    default: throw new Error(`unknown TIKTOK_PROVIDER '${name}' (expected mock|apify)`);
  }
}

module.exports = { getTikTokProvider, MockTikTokProvider, ApifyTikTokProvider };
