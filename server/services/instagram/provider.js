'use strict';

// Provider-agnostic Instagram data adapter.
//
// Instagram has NO public trend API. Every option — Apify, HikerAPI, Bright Data, self-hosted
// instagrapi — ultimately reads Instagram's OWN private mobile/GraphQL endpoints (the ones the app
// itself calls) through rotating proxies + pools of logged-in accounts. What a paid provider sells is
// that infrastructure + the maintenance treadmill, not special access. We isolate all of that behind
// ONE interface so the trend pipeline never depends on a vendor: swap the provider (or plug a real key)
// without touching ingestion/scoring. Default = 'mock' → keyless, no spend, runs the whole pipeline on
// synthetic data so the design is provable before committing budget.
//
// CONTRACT every provider implements:
//   recentByHashtag(tag, { limit=50, sinceDays=14 }) -> Promise<Media[]>
//   Media = {
//     media_id, username, caption, hashtags:[string],
//     play_count, like_count, comment_count, taken_at(ISO string)
//   }

class BaseProvider {
  async recentByHashtag() { throw new Error('recentByHashtag not implemented'); }
  // Batch entry point: one call for many hashtags. Providers that support a single multi-hashtag run
  // override this to avoid per-hashtag run overhead (fewer runs = lower cost + faster). Default =
  // sequential per-tag, tagging each result with the hashtag it came from (so the sweep can attribute
  // niche). The mock inherits this; Apify overrides with a true single run.
  async recentByHashtags(tags, opts = {}) {
    const all = [];
    for (const t of tags) {
      const media = await this.recentByHashtag(t, opts);
      for (const m of media) { m._sourceTag = t; all.push(m); }
    }
    return all;
  }
}

// ── Real providers: stubbed until a key is supplied (scaffold). Each TODO is the single method to fill.
class ApifyProvider extends BaseProvider {
  constructor() {
    super();
    this.token = process.env.APIFY_TOKEN;
    // actor id is overridable in case you switch to a different Instagram scraper actor.
    this.actor = process.env.INSTAGRAM_APIFY_ACTOR || 'apify~instagram-hashtag-scraper';
  }
  // One synchronous actor run for N hashtags → dataset items. resultsLimit is PER hashtag, so batching
  // many hashtags into a single run keeps the same per-hashtag depth while paying run overhead ONCE
  // (18 runs → 1). Sync runs are capped at 300s by Apify.
  async _run(hashtags, opts = {}) {
    if (!this.token) throw new Error('APIFY_TOKEN not set — add it to server/.env, or run INSTAGRAM_PROVIDER=mock to stay keyless.');
    const url = `https://api.apify.com/v2/acts/${this.actor}/run-sync-get-dataset-items?token=${encodeURIComponent(this.token)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 300000);
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hashtags, resultsLimit: opts.limit ?? 50 }),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
    if (!resp.ok) throw new Error(`Apify ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const items = await resp.json();
    if (!Array.isArray(items)) throw new Error('Apify returned non-array dataset');
    // Map the actor's post schema → the Media contract. Field names guarded with fallbacks because the
    // actor's output has drifted across versions (videoPlayCount vs videoViewCount, etc.).
    return items.map(it => ({
      media_id: it.id || it.shortCode || it.url,
      username: it.ownerUsername || it.ownerId || 'unknown',
      caption: it.caption || '',
      hashtags: Array.isArray(it.hashtags) ? it.hashtags : [],
      play_count: it.videoPlayCount ?? it.videoViewCount ?? it.playCount ?? 0,
      like_count: it.likesCount ?? it.likeCount ?? 0,
      comment_count: it.commentsCount ?? it.commentCount ?? 0,
      taken_at: it.timestamp || it.takenAt || new Date().toISOString(),
    })).filter(m => m.media_id);
  }
  async recentByHashtag(tag, opts = {}) { return this._run([tag], opts); }
  async recentByHashtags(tags, opts = {}) { return this._run(tags, opts); } // one run for all hashtags
}

class HikerProvider extends BaseProvider {
  constructor() { super(); this.key = process.env.HIKERAPI_KEY; }
  async recentByHashtag(tag, opts = {}) {
    if (!this.key) throw new Error('HIKERAPI_KEY not set — run with INSTAGRAM_PROVIDER=mock to stay keyless.');
    // TODO: GET https://api.hikerapi.com/v1/hashtag/medias/recent?name=<tag>&amount=<limit>  (header x-access-key)
    //   map each media → the Media contract.
    throw new Error('HikerProvider.recentByHashtag not implemented yet (scaffold).');
  }
}

// ── Mock provider: deterministic synthetic Reels so the full pipeline (sweep → trend → cross-platform
// lead) runs with no key and no network. The library is seeded so ONE topic ("desk setup asmr") is
// strong on IG but absent from YouTube (→ proves the "Early on Instagram" head-start signal), while
// others overlap topics that also exist in the YouTube corpus (→ proves the "both / lead-days" path).
const MOCK_LIB = {
  // tag -> { topic phrase seeded into captions, co-hashtags, niche, igLeadDays (how long it's led YT) }
  deficitdiet:        { topic: 'cortisol detox', co: ['wellness', 'guthealth'], accounts: 34, igOnly: true },
  desksetup:          { topic: 'desk setup asmr', co: ['desksetup', 'workspace'], accounts: 41, igOnly: true },
  sludgecontent:      { topic: 'sludge content', co: ['brainrot', 'edit'], accounts: 28, igOnly: true },
  upsc:               { topic: 'upsc motivation', co: ['ias', 'study'], accounts: 22, igOnly: false },
  streetfood:         { topic: 'street food', co: ['foodie', 'india'], accounts: 30, igOnly: false },
  cricket:            { topic: 'world cup', co: ['cricket', 'india'], accounts: 26, igOnly: false },
};

function seededRand(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

class MockProvider extends BaseProvider {
  async recentByHashtag(tag, opts = {}) {
    const limit = opts.limit ?? 50;
    const sinceDays = opts.sinceDays ?? 14;
    const key = String(tag).toLowerCase().replace(/[^a-z0-9]/g, '');
    const spec = MOCK_LIB[key] || { topic: key, co: [key], accounts: 6, igOnly: false };
    const rnd = seededRand(key.split('').reduce((a, c) => a + c.charCodeAt(0), 7));
    const out = [];
    const nMedia = Math.min(limit, spec.accounts + Math.floor(rnd() * 8));
    for (let i = 0; i < nMedia; i++) {
      const acct = i % spec.accounts; // spread across distinct accounts (adoption signal)
      const ageDays = rnd() * sinceDays;              // recent window
      const plays = Math.round(20000 + rnd() * 600000);
      out.push({
        media_id: `mock_${key}_${i}`,
        username: `${key}_creator_${acct}`,
        caption: `${spec.topic} ${['tutorial', 'reaction', 'day in life', 'honest review', 'part 2'][i % 5]} 🔥 #${key} ${spec.co.map(h => '#' + h).join(' ')}`,
        hashtags: [key, ...spec.co],
        play_count: plays,
        like_count: Math.round(plays * (0.03 + rnd() * 0.05)),
        comment_count: Math.round(plays * (0.001 + rnd() * 0.003)),
        taken_at: new Date(Date.now() - ageDays * 864e5).toISOString(),
        _igOnly: spec.igOnly, // internal hint; real providers won't set this
      });
    }
    return out;
  }
}

function getProvider(name = process.env.INSTAGRAM_PROVIDER || 'mock') {
  switch (name) {
    case 'mock':  return new MockProvider();
    case 'apify': return new ApifyProvider();
    case 'hiker': return new HikerProvider();
    default: throw new Error(`unknown INSTAGRAM_PROVIDER '${name}' (expected mock|apify|hiker)`);
  }
}

module.exports = { getProvider, MockProvider, ApifyProvider, HikerProvider };
