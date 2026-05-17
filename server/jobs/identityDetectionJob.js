'use strict';

// ── Bulk identity detection ───────────────────────────────────────────────────
// Classifies all ingested channels that have video titles but no identity yet.
// Called from the pipeline (Step 5) and the admin bulk-detect button.
//
// Detection order:
//   1. OpenAI gpt-4.1-mini (full identity + archetype)
//   2. Keyword fallback (if OpenAI quota exceeded or unavailable) — niche only,
//      identity_source = 'keyword_fallback', confidence = 0.4

const { getDb }              = require('../db/init');
const { getAllIngestedChannels, getChannelVideoTitles, saveChannelIdentity, updateChannelNiche } = require('../db/queries');
const { classifyChannel }    = require('../services/channelClassifier');

// Shared module-level state — lets the admin progress endpoint read live counts
// whether the job was triggered by the pipeline or the admin button.
const jobState = {
  running:   false,
  total:     0,
  done:      0,
  detected:  0,
  failed:    0,
  startedAt: null,
};

function getJobState() { return { ...jobState }; }

// ── Keyword-based niche fallback ──────────────────────────────────────────────
// Used when OpenAI quota is exceeded. Assigns primary_niche from title keywords.

const NICHE_KW = {
  geopolitics:     ['geopolitics','foreign policy','international relations','diplomacy','nato','sanctions','middle east','indo-pacific','nuclear deal','ceasefire','iran','ukraine war','taiwan strait','world war','global order','strategic affairs','major gaurav','chanakya','proxy war','cold war','trade war','hegemony','superpower','regime change','coup','brics','quad','south china sea','border dispute','lac','loc','surgical strike','geopolitical','china','russia','pakistan','israel','ukraine','saudi arabia','north korea','taiwan'],
  defence:         ['defence','defense','military','army','navy','air force','missile','hypersonic','drdo','fighter jet','warship','soldier','combat','pentagon','tank','submarine','aircraft carrier','drone warfare','special forces','commando','artillery','brahmos','rafale','tejas','agni','s-400','f-35','iaf','indian army','armed forces','weapons system','regiment','battalion'],
  politics:        ['politics','political','government','election','parliament','democracy','lok sabha','minister','modi','rahul','policy','bjp','congress','aap','chief minister','opposition','vote','mamata','kejriwal','yogi','assembly'],
  selfimprovement: ['self improvement','self help','personal development','motivation','productivity','discipline','habits','confidence','mindset','mental health','therapy','anxiety','depression','psychology','life coach','morning routine','atomic habits','sandeep maheshwari','vivek bindra','overthinking','emotional intelligence','self awareness','manifestation','positive thinking','inner peace','healing','resilience','ikigai','self discipline'],
  education:       ['education','learn','tutorial','study','teaching','school','upsc','ias','exam','lecture','course','knowledge','university'],
  technology:      ['tech','software','coding','programming','gadget','smartphone','ai','machine learning','developer','cybersecurity','startup'],
  finance:         ['finance','investing','stock market','mutual fund','money','wealth','trading','budget','economy','crypto','personal finance'],
  entertainment:   ['entertainment','fun','viral','trending','memes','reaction','celebrity','bollywood','movies','web series'],
  gaming:          ['gaming','game','esports','playthrough','minecraft','pubg','free fire','valorant','gamer','gameplay'],
  lifestyle:       ['lifestyle','vlog','daily life','day in my life','family','routine','grwm'],
  health:          ['health','fitness','workout','yoga','ayurveda','diet','wellness','doctor','medical','nutrition'],
  food:            ['food','recipe','cooking','chef','kitchen','restaurant','cuisine','baking'],
  travel:          ['travel','adventure','explore','destination','trip','journey'],
  music:           ['music','song','singer','album','rap','hip hop','cover','musician','beat'],
  comedy:          ['comedy','funny','humor','laugh','sketch','prank','standup','roast'],
  news:            ['news','breaking','current affairs','samachar','daily news','latest update','reporter'],
  business:        ['business','entrepreneur','startup','marketing','sales','growth','brand'],
  sports:          ['sports','cricket','football','ipl','match','athlete','tournament','score'],
  science:         ['science','space','physics','chemistry','biology','research','experiment','nasa'],
  philosophy:      ['philosophy','stoicism','wisdom','consciousness','vedanta','advaita','upanishad','bhagavad gita','existentialism'],
};

function keywordNiche(channelName, titles) {
  const text = [channelName, ...titles].join(' ').toLowerCase();
  let best = null, bestScore = 0;
  for (const [niche, kws] of Object.entries(NICHE_KW)) {
    const score = kws.filter(kw => text.includes(kw)).length;
    if (score > bestScore) { bestScore = score; best = niche; }
  }
  return bestScore >= 2 ? best : 'other';
}

// Returns true if the error is a quota/billing rejection (not a transient rate limit)
function isQuotaExhausted(e) {
  return e?.status === 429 && /quota|billing|exceeded/i.test(e.message);
}

// ── Main job ──────────────────────────────────────────────────────────────────

async function runBulkIdentityDetection({ batchSize = 1, batchGapMs = 150 } = {}) {
  if (jobState.running) {
    console.log('[identity] Bulk detection already running — skipping');
    return { skipped: true };
  }

  const db      = getDb();
  const all     = getAllIngestedChannels(db);
  const pending = all.filter(ch => !ch.identity_last_detected_at);

  if (!pending.length) {
    console.log('[identity] All channels already have identity — nothing to do');
    return { detected: 0, failed: 0, total: 0 };
  }

  jobState.running   = true;
  jobState.total     = pending.length;
  jobState.done      = 0;
  jobState.detected  = 0;
  jobState.failed    = 0;
  jobState.startedAt = new Date().toISOString();

  let quotaExhausted = false; // flip to true on first 429 quota error, use keyword fallback thereafter

  console.log(`[identity] Starting bulk detection — ${pending.length} channels pending`);

  async function processOne(ch) {
    try {
      const titles = getChannelVideoTitles(db, ch.channel_id, 50);
      if (!titles.length) { jobState.failed++; jobState.done++; return; }

      let result;

      if (!quotaExhausted) {
        const descRow = db.get('SELECT raw_json FROM channel_cache WHERE channel_id = ?', [ch.channel_id]);
        const desc    = (() => {
          try {
            const j = JSON.parse(descRow?.raw_json || '{}');
            const d = j.snippet?.description;
            return (d && d.trim().length > 10) ? d.trim() : null;
          } catch (_) { return null; }
        })();

        try {
          result = await classifyChannel({ channelName: ch.channel_name, titles, description: desc });
          result.identity_source = 'ai_detected';
        } catch (e) {
          if (isQuotaExhausted(e)) {
            quotaExhausted = true;
            console.warn('[identity] OpenAI quota exhausted — switching to keyword fallback for remaining channels');
          } else {
            throw e; // re-throw non-quota errors (rate limit, network, etc.)
          }
        }
      }

      if (!result) {
        // Keyword fallback
        const niche = keywordNiche(ch.channel_name, titles);
        result = {
          primary_niche:     niche,
          secondary_niche:   null,
          inferred_topics:   [],
          behavior_tags:     [],
          content_archetype: 'commentator',
          format_type:       'other',
          audience_style:    'general',
          identity_confidence: 0.4,
          identity_reasoning:  'Keyword-based classification (OpenAI quota exhausted)',
          identity_strength:   0.4,
          identity_source:     'keyword_fallback',
        };
      }

      saveChannelIdentity(db, ch.channel_id, {
        ...result,
        identity_last_detected_at: new Date().toISOString(),
      });
      if (result.primary_niche) updateChannelNiche(db, ch.channel_id, result.primary_niche);
      jobState.detected++;
    } catch (e) {
      jobState.failed++;
      if (jobState.failed <= 3) console.error(`[identity] classify error (${ch.channel_name}):`, e.message);
    }
    jobState.done++;
  }

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    await Promise.all(batch.map(ch => processOne(ch)));
    if (i + batchSize < pending.length) await new Promise(r => setTimeout(r, batchGapMs));
  }

  jobState.running = false;
  console.log(`[identity] Done — detected=${jobState.detected} failed=${jobState.failed} total=${jobState.total}`);
  return { detected: jobState.detected, failed: jobState.failed, total: jobState.total };
}

module.exports = { runBulkIdentityDetection, getJobState };
