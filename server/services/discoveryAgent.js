'use strict';

/**
 * Discovery Agent — Phase XI Semantic Graph Expansion
 *
 * Grows the corpus by discovering new channels via:
 *   1. Zero-quota: semantic cluster adjacency, niche gap analysis (DB-only)
 *   2. Low-quota:  related channels from existing corpus (channels.list)
 *   3. API-quota:  niche keyword search (search.list — expensive, rate-limited)
 *
 * ARCHITECTURAL RULE: Discovery populates corpus_channels and
 * corpus_discovery_graph ONLY. It does NOT trigger ingestion or training.
 * Ingestion is orchestrated by corpusScheduler.js after discovery.
 */

const crypto = require('crypto');
const {
  upsertCorpusChannel,
  upsertDiscoveryEdge,
  getAllCorpusChannels,
  getCorpusChannel,
  logChannelEvent,
  logDiscoveryProvenance,
  logCreatorEdge,
} = require('../db/corpusQueries');
const quotaGuard = require('./quotaGuard');

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

const { getApiKey, markExhausted, isQuotaError } = require('./apiKeyManager');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ytFetch(endpoint, params) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = getApiKey();
    if (!key) throw new Error('all_api_keys_exhausted');
    const url = new URL(`${YT_BASE}/${endpoint}`);
    url.searchParams.set('key', key);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await fetch(url.toString());
    const data = await resp.json();
    if (!resp.ok) {
      const msg = data?.error?.message || `YouTube ${resp.status}`;
      if (isQuotaError(msg)) { markExhausted(key); continue; }
      throw new Error(msg);
    }
    return data;
  }
  throw new Error('all_api_keys_exhausted');
}

// ── Zero-quota: niche gap detection ──────────────────────────────────────────

function findUnderrepresentedNiches(db) {
  const all = db.all(
    `SELECT niche, COUNT(*) AS n, SUM(training_eligible) AS trained
     FROM corpus_channels WHERE niche IS NOT NULL
     GROUP BY niche ORDER BY trained ASC`,
  );
  const total = all.reduce((s, r) => s + r.n, 0);
  return all.map(r => ({
    niche:      r.niche,
    count:      r.n,
    trained:    r.trained ?? 0,
    gap_score:  total > 0 ? Math.max(0, 100 - (r.n / total) * 100) : 100,
  })).filter(r => r.gap_score > 20);
}

// ── Zero-quota: semantic cluster neighbor expansion ───────────────────────────

function discoverFromClusters(db) {
  const discovered = [];
  // Find semantic clusters with fewer than 10 corpus channels
  const sparseClusters = db.all(
    `SELECT semantic_cluster, COUNT(*) AS n
     FROM corpus_videos WHERE semantic_cluster IS NOT NULL
     GROUP BY semantic_cluster HAVING n < 10
     ORDER BY n ASC LIMIT 20`,
  );

  for (const cluster of sparseClusters) {
    // Find corpus channels already in this cluster
    const channelsInCluster = db.all(
      `SELECT DISTINCT channel_id FROM corpus_videos WHERE semantic_cluster = ? LIMIT 5`,
      [cluster.semantic_cluster],
    );
    for (const ch of channelsInCluster) {
      discovered.push({
        source_channel_id: ch.channel_id,
        relationship_type: 'co_cluster',
        cluster:           cluster.semantic_cluster,
        confidence:        0.6,
        discovered_via:    'cluster_expansion',
      });
    }
  }
  return discovered;
}

// ── Low-quota: expand from related channels ───────────────────────────────────

async function expandFromChannel(db, channelId) {
  if (!quotaGuard.quotaAvailable(1)) return [];
  const sourceChannel = getCorpusChannel(db, channelId);
  if (!sourceChannel) return [];

  try {
    quotaGuard.recordUsage(1, 'corpus');
    const data = await ytFetch('channels', {
      part: 'snippet,statistics,brandingSettings',
      id:   channelId,
    });

    const item = data.items?.[0];
    if (!item) return [];

    const newChannels = [];
    // YouTube's brandingSettings doesn't give related channels directly.
    // Instead we discover via the featured channels section — not available in v3 API.
    // Best zero-cost alternative: use the channel's playlist items to find other channels
    // that appear in the same video comment context (requires OAuth).
    // For now: record the channel was expanded from and return empty pending API support.
    console.log(`[discovery] expandFromChannel: ${channelId} — direct API expansion not available without search.list`);
    return newChannels;
  } catch (e) {
    console.warn(`[discovery] expandFromChannel error ${channelId}:`, e.message);
    return [];
  }
}

// ── Sub-niche keyword bank — each niche has multiple specific search terms ─────

const NICHE_KEYWORDS = {
  technology:    ['programming tutorial', 'software engineering', 'AI tools review', 'tech deep dive', 'coding projects', 'open source developer', 'system design explained', 'web development beginner', 'linux tips channel', 'developer vlog'],
  finance:       ['investing for beginners', 'stock market analysis', 'passive income ideas', 'personal finance tips', 'crypto explained', 'dividend investing', 'real estate investing beginner', 'frugal living channel', 'financial independence retire early', 'options trading explained'],
  education:     ['science explained', 'history documentary', 'explainer animation', 'online learning', 'study with me', 'language learning channel', 'math made easy', 'geography explained', 'world history channel', 'skill learning youtube'],
  business:      ['startup advice', 'marketing strategy', 'side hustle ideas', 'entrepreneurship tips', 'small business', 'dropshipping tutorial', 'amazon FBA beginner', 'freelancing tips', 'agency owner channel', 'solopreneur journey'],
  health:        ['mental health tips', 'nutrition science', 'medical explained', 'wellness routine', 'gut health', 'chronic illness channel', 'plant based diet', 'functional medicine', 'sleep science channel', 'longevity research'],
  fitness:       ['calisthenics workout', 'HIIT training', 'home gym routine', 'strength training', 'weight loss workout', 'powerlifting beginner', 'bodyweight exercise', 'marathon training beginner', 'yoga fitness channel', 'athlete training vlog'],
  gaming:        ['indie game review', 'speedrun gaming', 'game dev tutorial', 'retro gaming', 'game analysis', 'gaming news channel', 'pc building gaming', 'esports breakdown', 'tabletop RPG channel', 'gaming lore explained'],
  science:       ['physics explained', 'chemistry experiments', 'biology documentary', 'astronomy space', 'neuroscience', 'climate science channel', 'genetics explained', 'mathematics channel', 'engineering explained', 'science experiment DIY'],
  entertainment: ['comedy sketches', 'movie review', 'celebrity interview', 'reaction videos', 'film analysis', 'anime review channel', 'book review channel', 'pop culture explained', 'TV show breakdown', 'true crime documentary'],
  lifestyle:     ['minimalism tips', 'morning routine', 'self improvement', 'digital nomad', 'slow living', 'apartment tour channel', 'sustainable living', 'capsule wardrobe', 'tiny house living', 'off grid homestead'],
  sports:        ['athletic training', 'sports analysis', 'coaching tips', 'sport science', 'underdog sports', 'cycling training channel', 'swimming technique', 'martial arts tutorial', 'rock climbing beginner', 'tennis coaching'],
  news:          ['investigative journalism', 'news analysis', 'geopolitics', 'global affairs', 'policy explained', 'local news channel', 'tech news weekly', 'business news analysis', 'independent journalism', 'media criticism'],
  politics:      ['political commentary', 'democracy explained', 'history politics', 'social issues', 'civic education', 'constitutional law explained', 'political philosophy', 'election analysis', 'foreign policy', 'activism channel'],
  food:          ['cooking tutorial', 'meal prep ideas', 'baking recipes', 'street food documentary', 'food science', 'budget cooking channel', 'vegan recipes beginner', 'fermentation channel', 'restaurant review', 'world cuisine exploration'],
  travel:        ['budget backpacking', 'solo travel tips', 'hidden destinations', 'travel documentary', 'van life', 'expat life abroad', 'road trip channel', 'travel photography', 'slow travel channel', 'working abroad'],
  music:         ['music production tutorial', 'songwriting tips', 'music theory', 'home recording', 'music history', 'music gear review', 'live session channel', 'classical music explained', 'music mixing mastering', 'independent musician channel'],
  comedy:        ['stand up comedy', 'sketch comedy', 'improv comedy', 'satire channel', 'comedy shorts', 'dark humor channel', 'parody videos', 'comedy podcast clips', 'roast compilation', 'comedy writing tips'],
  beauty:        ['skincare routine', 'makeup tutorial', 'hair care tips', 'natural beauty', 'dermatology explained', 'glass skin routine', 'affordable beauty', 'men skincare channel', 'fragrance review', 'nail art tutorial'],
  yoga:          ['yoga for beginners', 'morning yoga flow', 'yin yoga', 'yoga anatomy', 'advanced yoga', 'yoga nidra channel', 'pranayama breathing', 'restorative yoga', 'yoga philosophy', 'daily yoga challenge'],
  meditation:    ['guided meditation', 'mindfulness practice', 'breathing exercises', 'sleep meditation', 'anxiety relief', 'vipassana meditation', 'manifestation channel', 'chakra healing', 'binaural beats focus', 'somatic meditation'],
  philosophy:    ['stoicism explained', 'philosophy of mind', 'ethics discussion', 'ancient philosophy', 'critical thinking', 'existentialism explained', 'eastern philosophy', 'logic and reasoning', 'consciousness science', 'moral philosophy'],
  productivity:  ['deep work tips', 'time management', 'focus techniques', 'note taking system', 'second brain', 'obsidian PKM tutorial', 'notion workflow', 'GTD productivity', 'procrastination help', 'ADHD productivity tips'],
  other:         ['documentary channel', 'educational content', 'how to channel', 'explainer videos', 'knowledge channel', 'niche hobby channel', 'craft tutorial channel', 'DIY project channel', 'collector community', 'storytelling channel'],
};

// Culturally authentic Hindi search terms — phrases Indian users actually type.
// Used with relevanceLanguage=hi and regionCode=IN for targeted discovery.
const HINDI_NICHE_KEYWORDS = {
  technology:    ['coding kaise seekhein', 'mobile tricks hindi', 'tech news hindi', 'computer tips hindi', 'app kaise use karein'],
  finance:       ['share market kaise seekhe', 'mutual fund mein invest kaise karein', 'paise kaise bachayen', 'SIP kya hota hai', 'stock market basics hindi'],
  education:     ['padhai kaise karein', 'UPSC preparation hindi', 'current affairs hindi', 'competition exam tips hindi', 'science experiments hindi'],
  business:      ['business kaise shuru karein', 'online paise kaise kamayein', 'passive income hindi', 'business ideas hindi', 'startup tips hindi'],
  health:        ['gharelu nuskhe', 'vajan kaise ghatayein', 'ayurveda tips hindi', 'swasthya tips hindi', 'diabetes control hindi'],
  fitness:       ['pet kaise ghatayein', 'gym workout hindi', 'body banane ke tips', 'vyayam kaise karein', 'ghar par exercise kaise karein'],
  gaming:        ['free fire tips hindi', 'gaming tips hindi', 'game kaise khele hindi', 'BGMI gameplay hindi', 'mobile gaming hindi'],
  science:       ['vigyan hindi', 'physics in hindi', 'chemistry in hindi', 'antariksh ki kahani', 'biology hindi'],
  entertainment: ['bollywood news hindi', 'web series review hindi', 'film samiksha hindi', 'comedy videos hindi', 'OTT review hindi'],
  lifestyle:     ['motivation hindi', 'personality development hindi', 'self improvement hindi', 'morning routine hindi', 'jeevan tips hindi'],
  sports:        ['cricket tips hindi', 'sports analysis hindi', 'cricket news hindi', 'kabaddi tips hindi', 'football tips hindi'],
  news:          ['aaj ki khabar hindi', 'desh videsh ki khabar', 'rajniti news hindi', 'samachar hindi', 'taza khabar'],
  politics:      ['rajniti vishleshan hindi', 'chunav news hindi', 'sansad news hindi', 'rajneeti samjhiye', 'BJP Congress news hindi'],
  food:          ['recipe hindi', 'ghar ka khana kaise banayein', 'nashta banane ki vidhi', 'Indian recipe hindi', 'khana pakane ki tips'],
  travel:        ['India ghumne ki jagah', 'travel vlog hindi', 'pahad ki yatra', 'budget travel India hindi', 'ghumakkad vlog'],
  music:         ['guitar sikhiye hindi', 'sangeet kaise seekhe', 'bhajan hindi', 'music lessons hindi', 'classical music hindi'],
  comedy:        ['desi comedy videos', 'hasane wale videos hindi', 'funny videos hindi', 'stand up comedy hindi', 'comedy sketch hindi'],
  beauty:        ['gharelu beauty tips hindi', 'skin care tips hindi', 'makeup tips hindi', 'baal ki dekhbhaal hindi', 'sundarta tips hindi'],
  yoga:          ['yoga kaise karein', 'pranayam vidhi', 'surya namaskar sikhiye', 'yoga for beginners hindi', 'yoga tips hindi'],
  meditation:    ['dhyan kaise karein', 'meditation hindi', 'mann ki shanti', 'neend ke liye meditation', 'mindfulness hindi'],
  philosophy:    ['jivan ka arth hindi', 'adhyatm hindi', 'gita ke gyan', 'darshan shashtra hindi', 'stoicism hindi'],
  productivity:  ['samay prabandhan hindi', 'focus kaise karein', 'study tips hindi', 'productivity tips hindi', 'note taking hindi'],
  other:         ['gyan ki baatein hindi', 'seekhne wale videos hindi', 'educational channel hindi', 'jankari hindi', 'samajhiye hindi'],
};

// Culturally authentic Tamil search terms — phrases Tamil users actually type.
// Used with relevanceLanguage=ta and regionCode=IN for targeted discovery.
const TAMIL_NICHE_KEYWORDS = {
  technology:    ['coding Tamil la katral', 'tech news Tamil', 'mobile tips Tamil', 'computer tips Tamil', 'software Tamil la'],
  finance:       ['share market Tamil', 'mutual fund Tamil', 'panam seiku Tamil', 'stock market pathi Tamil', 'investment tips Tamil'],
  education:     ['padikalam Tamil', 'TNPSC preparation Tamil', 'English pesalam Tamil', 'current affairs Tamil', 'history Tamil la'],
  business:      ['thozhil tips Tamil', 'siru thozhil Tamil', 'business ideas Tamil', 'startup Tamil la', 'online thozhil Tamil'],
  health:        ['maruthuvam Tamil', 'unavu murai Tamil', 'ayurvedham Tamil', 'noi neekum murai Tamil', 'health tips Tamil'],
  fitness:       ['udal payirchi Tamil', 'weight loss Tamil', 'yoga Tamil la', 'gym workout Tamil', 'diet tips Tamil'],
  gaming:        ['gaming Tamil la', 'free fire Tamil', 'BGMI Tamil', 'mobile gaming Tamil', 'game tips Tamil'],
  science:       ['arivial Tamil', 'physics Tamil la', 'chemistry Tamil la', 'veli veli Tamil', 'biology Tamil la'],
  entertainment: ['comedy Tamil', 'web series Tamil', 'cinema review Tamil', 'OTT Tamil', 'serial Tamil'],
  lifestyle:     ['motivation Tamil', 'self improvement Tamil', 'morning routine Tamil', 'personal development Tamil', 'life tips Tamil'],
  sports:        ['cricket Tamil la', 'sports news Tamil', 'IPL Tamil commentary', 'kabaddi Tamil', 'football Tamil'],
  news:          ['tamilnadu news today', 'Tamil news latest', 'today news Tamil', 'breaking news Tamil', 'news Tamil la'],
  politics:      ['arasiyal Tamil', 'election news Tamil', 'parliament Tamil', 'rajiyam Tamil', 'political news Tamil'],
  food:          ['samayal Tamil', 'recipe Tamil la', 'kulambu seivadu eppadi', 'Tamil recipes', 'tiffin recipes Tamil'],
  travel:        ['travel vlog Tamil', 'tamilnadu travel', 'hill station Tamil', 'tourist places Tamil Nadu', 'veli naadu Tamil'],
  music:         ['Tamil songs', 'carnatic music Tamil', 'guitar Tamil la', 'music lessons Tamil', 'Tamil paadal'],
  comedy:        ['comedy videos Tamil', 'funny Tamil', 'stand up comedy Tamil', 'Tamil comedy', 'nakkal Tamil'],
  beauty:        ['beauty tips Tamil', 'skin care Tamil', 'makeup Tamil la', 'hair care Tamil', 'natural beauty Tamil'],
  yoga:          ['yoga Tamil la', 'pranayamam Tamil', 'morning yoga Tamil', 'yoga tips Tamil', 'meditation yoga Tamil'],
  meditation:    ['thaniyiruthal Tamil', 'meditation Tamil', 'manathiruppu Tamil', 'mindfulness Tamil', 'amaidi Tamil'],
  philosophy:    ['valkkai aruvurai Tamil', 'adhyatmam Tamil', 'thirukkural vilakkam', 'philosophy Tamil', 'spirituality Tamil'],
  productivity:  ['time management Tamil', 'study tips Tamil', 'focus tips Tamil', 'productivity Tamil la', 'velai tiran Tamil'],
  other:         ['arivukkathai Tamil', 'educational Tamil channel', 'tips Tamil la', 'knowledge Tamil', 'katru Tamil'],
};

// ── Low-quota: discover by niche keyword (search.list — 100 units!) ───────────

// Culturally authentic Telugu search terms — phrases Telugu users actually type.
// Used with relevanceLanguage=te and regionCode=IN for targeted discovery.
const TELUGU_NICHE_KEYWORDS = {
  technology:    ['coding Telugu lo', 'tech news Telugu', 'mobile tips Telugu', 'software Telugu lo', 'computer tips Telugu'],
  finance:       ['share market Telugu', 'mutual fund Telugu', 'panam Telugu lo', 'investment tips Telugu', 'stock market Telugu lo'],
  education:     ['EAMCET preparation Telugu', 'Groups exam Telugu', 'current affairs Telugu', 'Telugu medium study tips', 'competitive exam Telugu'],
  business:      ['vyaaparam tips Telugu', 'chinna vyaaparam Telugu', 'business ideas Telugu lo', 'startup Telugu', 'online vyaaparam Telugu'],
  health:        ['arogya tips Telugu', 'health tips Telugu lo', 'weight loss Telugu', 'ayurveda Telugu', 'diabetes Telugu lo'],
  fitness:       ['workout Telugu lo', 'gym tips Telugu', 'yoga Telugu lo', 'body fitness Telugu', 'weight loss exercise Telugu'],
  gaming:        ['gaming Telugu lo', 'free fire Telugu', 'BGMI Telugu', 'mobile game Telugu', 'game tips Telugu lo'],
  science:       ['science Telugu lo', 'physics Telugu', 'chemistry Telugu lo', 'space Telugu lo', 'biology Telugu'],
  entertainment: ['comedy Telugu', 'web series Telugu', 'movie review Telugu', 'OTT Telugu', 'serial Telugu lo'],
  lifestyle:     ['motivation Telugu', 'self improvement Telugu', 'morning routine Telugu', 'life tips Telugu lo', 'personal development Telugu'],
  sports:        ['cricket Telugu lo', 'sports news Telugu', 'IPL Telugu commentary', 'kabaddi Telugu', 'football Telugu lo'],
  news:          ['Telugu news today', 'Andhra Pradesh news', 'Telangana news latest', 'breaking news Telugu', 'today news Telugu'],
  politics:      ['rajakeeyam Telugu', 'election news Telugu', 'assembly Telugu', 'political news Telugu lo', 'AP politics Telugu'],
  food:          ['vanta Telugu lo', 'recipe Telugu', 'curry cheyyadam ela', 'Telugu samayal', 'cooking tips Telugu'],
  travel:        ['travel vlog Telugu', 'Andhra Pradesh travel', 'hill stations Telugu', 'tourist places Telugu', 'veli naadu Telugu lo'],
  music:         ['Telugu songs', 'carnatic music Telugu', 'guitar Telugu lo', 'music lessons Telugu', 'Telugu paata'],
  comedy:        ['comedy videos Telugu', 'funny Telugu videos', 'natak comedy Telugu', 'stand up Telugu', 'Telugu jokes'],
  beauty:        ['beauty tips Telugu', 'skin care Telugu', 'makeup Telugu lo', 'hair care Telugu', 'natural beauty Telugu'],
  yoga:          ['yoga Telugu lo', 'pranayamam Telugu', 'morning yoga Telugu', 'meditation Telugu', 'yoga tips Telugu'],
  meditation:    ['dhyanam Telugu lo', 'meditation Telugu', 'manassu shanti Telugu', 'mindfulness Telugu', 'stress relief Telugu'],
  philosophy:    ['jeevana satham Telugu', 'adhyatmam Telugu', 'Bhagavad Gita Telugu', 'philosophy Telugu lo', 'spirituality Telugu'],
  productivity:  ['time management Telugu', 'study tips Telugu lo', 'focus tips Telugu', 'productivity Telugu', 'velai teerupu Telugu'],
  other:         ['education Telugu lo', 'knowledge Telugu', 'tips Telugu lo', 'how to Telugu', 'learn Telugu lo'],
};

// ── Bengali keyword bank ──────────────────────────────────────────────────────
const BENGALI_NICHE_KEYWORDS = {
  technology:    ['coding bangla', 'tech tips bangla', 'mobile tricks bangla', 'software bangla', 'computer bangla'],
  finance:       ['share market bangla', 'investment bangla', 'mutual fund bangla', 'paise income bangla', 'stock market bangla'],
  education:     ['study tips bangla', 'education bangla', 'SSC HSC preparation bangla', 'current affairs bangla', 'science bangla'],
  business:      ['business ideas bangla', 'online income bangla', 'startup bangla', 'entrepreneurship bangla', 'freelancing bangla'],
  health:        ['health tips bangla', 'weight loss bangla', 'ayurvedic bangla', 'nutrition bangla', 'fitness bangla'],
  gaming:        ['gaming bangla', 'free fire bangla', 'BGMI bangla', 'mobile gaming bangla', 'game tips bangla'],
  entertainment: ['comedy bangla', 'natok bangla', 'movie review bangla', 'web series bangla', 'funny videos bangla'],
  food:          ['recipe bangla', 'cooking bangla', 'ranna bangla', 'Bengali recipe', 'street food bangla'],
  sports:        ['cricket bangla', 'sports news bangla', 'IPL bangla', 'football bangla', 'sports analysis bangla'],
  news:          ['bangla news today', 'Bangladesh news', 'latest news bangla', 'news bangla', 'current news bangla'],
  music:         ['bangla song', 'music bangla', 'guitar bangla', 'music lessons bangla', 'Bengali music'],
  lifestyle:     ['motivation bangla', 'self improvement bangla', 'life tips bangla', 'morning routine bangla', 'productivity bangla'],
  travel:        ['travel vlog bangla', 'Bangladesh travel', 'tourist places bangla', 'travel tips bangla', 'vlog bangla'],
  beauty:        ['beauty tips bangla', 'skin care bangla', 'makeup bangla', 'hair care bangla', 'natural beauty bangla'],
  other:         ['educational bangla channel', 'tips bangla', 'how to bangla', 'knowledge bangla', 'learn bangla'],
};

// ── Kannada keyword bank ──────────────────────────────────────────────────────
const KANNADA_NICHE_KEYWORDS = {
  technology:    ['tech tips kannada', 'coding kannada', 'mobile tricks kannada', 'software kannada', 'computer tips kannada'],
  finance:       ['share market kannada', 'investment kannada', 'mutual fund kannada', 'stock market kannada', 'income ideas kannada'],
  education:     ['education kannada', 'KPSC preparation kannada', 'study tips kannada', 'current affairs kannada', 'science kannada'],
  business:      ['business ideas kannada', 'online income kannada', 'startup kannada', 'vyaapara tips kannada', 'udyoga kannada'],
  health:        ['health tips kannada', 'weight loss kannada', 'arogya tips kannada', 'diet tips kannada', 'fitness kannada'],
  gaming:        ['gaming kannada', 'free fire kannada', 'mobile gaming kannada', 'BGMI kannada', 'game tips kannada'],
  entertainment: ['comedy kannada', 'movie review kannada', 'web series kannada', 'serial kannada', 'funny videos kannada'],
  food:          ['recipe kannada', 'cooking kannada', 'oota maduvudu ela', 'Karnataka recipe', 'samayal kannada'],
  sports:        ['cricket kannada', 'sports news kannada', 'IPL kannada', 'football kannada', 'sports kannada'],
  news:          ['kannada news today', 'Karnataka news', 'latest news kannada', 'news kannada', 'samachar kannada'],
  music:         ['kannada songs', 'music kannada', 'guitar kannada', 'music lessons kannada', 'Kannada paata'],
  travel:        ['travel vlog kannada', 'Karnataka travel', 'tourist places kannada', 'travel tips kannada', 'oota mattu ooru kannada'],
  other:         ['educational kannada channel', 'tips kannada', 'how to kannada', 'knowledge kannada', 'siksha kannada'],
};

// ── Malayalam keyword bank ────────────────────────────────────────────────────
const MALAYALAM_NICHE_KEYWORDS = {
  technology:    ['tech tips malayalam', 'coding malayalam', 'mobile tricks malayalam', 'software malayalam', 'computer tips malayalam'],
  finance:       ['share market malayalam', 'investment malayalam', 'mutual fund malayalam', 'stock market malayalam', 'panam earn malayalam'],
  education:     ['education malayalam', 'PSC preparation malayalam', 'study tips malayalam', 'current affairs malayalam', 'science malayalam'],
  business:      ['business ideas malayalam', 'online income malayalam', 'startup malayalam', 'vyavasayam malayalam', 'freelancing malayalam'],
  health:        ['health tips malayalam', 'weight loss malayalam', 'arogya tips malayalam', 'ayurveda malayalam', 'fitness malayalam'],
  gaming:        ['gaming malayalam', 'free fire malayalam', 'mobile gaming malayalam', 'BGMI malayalam', 'game tips malayalam'],
  entertainment: ['comedy malayalam', 'movie review malayalam', 'web series malayalam', 'serial malayalam', 'funny videos malayalam'],
  food:          ['recipe malayalam', 'cooking malayalam', 'Kerala recipe', 'samayal malayalam', 'biriyani recipe malayalam'],
  sports:        ['cricket malayalam', 'sports news malayalam', 'IPL malayalam', 'football malayalam', 'sports malayalam'],
  news:          ['malayalam news today', 'Kerala news', 'latest news malayalam', 'news malayalam', 'samachar malayalam'],
  music:         ['malayalam songs', 'music malayalam', 'guitar malayalam', 'music lessons malayalam', 'Malayalam paattu'],
  travel:        ['travel vlog malayalam', 'Kerala travel', 'tourist places malayalam', 'travel tips malayalam', 'vlog malayalam'],
  beauty:        ['beauty tips malayalam', 'skin care malayalam', 'makeup malayalam', 'hair care malayalam', 'natural beauty malayalam'],
  other:         ['educational malayalam channel', 'tips malayalam', 'how to malayalam', 'knowledge malayalam', 'padikkam malayalam'],
};

// ── Spanish keyword bank ──────────────────────────────────────────────────────
const SPANISH_NICHE_KEYWORDS = {
  technology:    ['programacion para principiantes', 'tips tecnologia', 'aprende coding español', 'inteligencia artificial español', 'gadgets review español'],
  finance:       ['como invertir dinero', 'bolsa de valores español', 'finanzas personales', 'como ahorrar dinero', 'trading español'],
  education:     ['aprender español facil', 'ciencia explicada español', 'historia resumida español', 'matematicas facil español', 'preparacion examen'],
  business:      ['emprendimiento consejos', 'como montar negocio', 'ideas negocio 2024', 'marketing digital español', 'ganar dinero online español'],
  health:        ['salud y bienestar', 'perder peso rapido', 'nutricion saludable español', 'medicina natural español', 'rutina saludable'],
  fitness:       ['ejercicios en casa español', 'rutina gym español', 'bajar de peso ejercicios', 'entrenamiento funcional', 'calistenia español'],
  gaming:        ['gaming en español', 'gameplay español', 'mejores juegos 2024 español', 'tutoriales gaming español', 'free fire español'],
  entertainment: ['comedia española', 'critica pelicula español', 'reaction videos español', 'entretenimiento español', 'humor español'],
  food:          ['recetas faciles español', 'cocina española', 'recetas caseras', 'como cocinar español', 'comida saludable recetas'],
  travel:        ['vlog viajes español', 'lugares turísticos latinoamerica', 'mochilero español', 'travel tips español', 'viajes baratos'],
  music:         ['musica latina', 'aprende guitarra español', 'produccion musical español', 'como cantar español', 'piano para principiantes español'],
  lifestyle:     ['motivacion personal español', 'habitos exitosos', 'desarrollo personal español', 'minimalismo español', 'rutina mañana española'],
  news:          ['noticias de hoy', 'análisis político español', 'noticias latinoamerica', 'actualidad mundial español', 'periodismo digital'],
  beauty:        ['maquillaje tutorial español', 'cuidado piel español', 'rutina belleza española', 'tips cabello español', 'beauty español'],
  other:         ['documentales español', 'canal educativo español', 'explicado en español', 'aprender cosas nuevas español', 'curiosidades español'],
};

// ── Portuguese keyword bank ───────────────────────────────────────────────────
const PORTUGUESE_NICHE_KEYWORDS = {
  technology:    ['programacao iniciantes', 'tecnologia brasil', 'dicas tech português', 'inteligencia artificial brasil', 'review gadgets brasil'],
  finance:       ['como investir dinheiro brasil', 'bolsa de valores brasil', 'financas pessoais brasil', 'como economizar dinheiro', 'renda passiva brasil'],
  education:     ['vestibular dicas', 'ciencia explicada portugues', 'historia brasil resumida', 'matematica facil', 'enem preparacao'],
  business:      ['empreendedorismo brasil', 'como abrir negocio', 'ideias negocio online brasil', 'marketing digital brasil', 'ganhar dinheiro online'],
  health:        ['saude e bem estar brasil', 'emagrecer rapido brasil', 'nutricao saudavel', 'medicina natural brasil', 'rotina saudavel'],
  fitness:       ['exercicios em casa brasil', 'treino academia brasil', 'perder barriga rapido', 'calistenia brasil', 'treino funcional'],
  gaming:        ['gameplay portugues', 'gaming brasil', 'melhores jogos 2024', 'tutorial gaming portugues', 'free fire brasil'],
  entertainment: ['comedia brasil', 'critica filme portugues', 'entretenimento brasil', 'humor brasil', 'react videos brasil'],
  food:          ['receitas faceis brasil', 'culinaria brasileira', 'como cozinhar brasil', 'comida saudavel receitas', 'sobremesas faceis'],
  travel:        ['vlog viagem brasil', 'turismo brasil', 'destinos baratos brasil', 'mochileiro brasil', 'guia viagem portugal'],
  music:         ['musica brasileira', 'aprender violao', 'producao musical brasil', 'sertanejo tutorial', 'piano iniciantes brasil'],
  lifestyle:     ['motivacao pessoal brasil', 'habitos de sucesso', 'desenvolvimento pessoal', 'minimalismo brasil', 'rotina manha produtiva'],
  news:          ['noticias de hoje brasil', 'politica brasil', 'jornalismo digital brasil', 'atualidades brasil', 'noticias mundo hoje'],
  beauty:        ['maquiagem tutorial brasil', 'cuidados pele brasil', 'rotina beleza', 'dicas cabelo brasil', 'skincare brasil'],
  other:         ['documentarios brasil', 'canal educativo portugues', 'curiosidades brasil', 'aprender coisas novas', 'explicado em portugues'],
};

// ── Indonesian keyword bank ───────────────────────────────────────────────────
const INDONESIAN_NICHE_KEYWORDS = {
  technology:    ['belajar coding indonesia', 'tips teknologi indonesia', 'gadget review indonesia', 'software indonesia', 'komputer tips indonesia'],
  finance:       ['investasi saham indonesia', 'cara nabung yang bener', 'reksa dana indonesia', 'passive income indonesia', 'trading indonesia'],
  education:     ['belajar bahasa inggris', 'CPNS tips indonesia', 'belajar matematika indonesia', 'tips belajar indonesia', 'ujian nasional tips'],
  business:      ['cara bisnis online indonesia', 'ide bisnis 2024', 'jualan online indonesia', 'wirausaha indonesia', 'startup indonesia'],
  health:        ['tips kesehatan indonesia', 'cara diet sehat', 'herbal indonesia', 'nutrisi sehat indonesia', 'olahraga di rumah'],
  gaming:        ['gaming indonesia', 'free fire indonesia', 'mobile legends indonesia', 'PUBG mobile indonesia', 'tips gaming indonesia'],
  entertainment: ['comedy indonesia', 'review film indonesia', 'konten lucu indonesia', 'web series indonesia', 'vlog indonesia'],
  food:          ['resep masakan indonesia', 'cara masak mudah', 'kuliner indonesia', 'resep kue indonesia', 'masakan sehat indonesia'],
  sports:        ['bola indonesia', 'badminton tips', 'olahraga indonesia', 'sepakbola indonesia', 'berita olahraga indonesia'],
  news:          ['berita hari ini indonesia', 'berita terkini', 'politik indonesia', 'berita viral indonesia', 'update berita indonesia'],
  music:         ['musik indonesia', 'belajar gitar indonesia', 'cover lagu indonesia', 'produksi musik indonesia', 'piano pemula indonesia'],
  lifestyle:     ['motivasi hidup indonesia', 'tips produktif indonesia', 'self improvement indonesia', 'rutina pagi indonesia', 'minimalis indonesia'],
  travel:        ['wisata indonesia', 'vlog jalan jalan', 'destinasi wisata murah', 'travel tips indonesia', 'kuliner daerah indonesia'],
  beauty:        ['makeup tutorial indonesia', 'skincare indonesia', 'tips kecantikan indonesia', 'hair care indonesia', 'natural beauty indonesia'],
  other:         ['edukasi indonesia', 'pengetahuan umum indonesia', 'tips trik indonesia', 'cara mudah indonesia', 'belajar hal baru'],
};

// ── Arabic keyword bank ───────────────────────────────────────────────────────
const ARABIC_NICHE_KEYWORDS = {
  technology:    ['تعلم البرمجة عربي', 'تقنية عربي', 'تطبيقات عربي', 'كمبيوتر عربي', 'ذكاء اصطناعي عربي'],
  finance:       ['الاستثمار عربي', 'البورصة عربي', 'كيف توفر المال عربي', 'الدخل السلبي عربي', 'trading عربي'],
  education:     ['تعليم عربي', 'دروس عربية', 'شرح بالعربي', 'تعلم الانجليزية عربي', 'علوم بالعربي'],
  business:      ['ريادة الأعمال عربي', 'كيف تبدأ مشروع', 'ربح المال اون لاين عربي', 'تسويق ديجيتال عربي', 'بيزنس عربي'],
  health:        ['صحة وجمال عربي', 'انقاص الوزن عربي', 'طب طبيعي عربي', 'لياقة بدنية عربي', 'تغذية صحية عربي'],
  gaming:        ['العاب عربي', 'فري فاير عربي', 'ببجي عربي', 'جيمنج عربي', 'tips العاب عربي'],
  entertainment: ['كوميدي عربي', 'مراجعة فيلم عربي', 'ترفيه عربي', 'فيديوهات مضحكة عربي', 'مسلسلات عربي'],
  food:          ['وصفات عربية', 'طبخ عربي', 'اكلات عربية', 'حلويات عربية', 'مطبخ عربي'],
  news:          ['اخبار عربية', 'اخبار اليوم عربي', 'السياسة عربي', 'اخبار عاجلة عربي', 'تحليل اخبار عربي'],
  music:         ['موسيقى عربية', 'تعلم عزف عربي', 'اغاني عربية', 'موسيقى عود', 'كمان عربي'],
  travel:        ['سفر عربي', 'سياحة عربية', 'رحلات عربي', 'اماكن سياحية عربية', 'فلوق سفر عربي'],
  lifestyle:     ['تطوير الذات عربي', 'تحفيز عربي', 'انتاجية عربي', 'روتين صباحي عربي', 'نمط حياة عربي'],
  beauty:        ['مكياج عربي', 'عناية بالبشرة عربي', 'جمال طبيعي عربي', 'عناية بالشعر عربي', 'روتين عناية عربي'],
  other:         ['قناة تعليمية عربية', 'معلومات عامة عربي', 'شرح بسيط عربي', 'تعلم شيء جديد عربي', 'محتوى عربي'],
};

// ── Punjabi keyword bank ──────────────────────────────────────────────────────
const PUNJABI_NICHE_KEYWORDS = {
  technology:    ['tech tips punjabi', 'coding punjabi', 'mobile tricks punjabi', 'computer tips punjabi', 'gadget review punjabi'],
  finance:       ['share market punjabi', 'investment punjabi', 'paise kamao punjabi', 'business punjabi', 'stock market punjabi'],
  education:     ['padhai punjabi', 'study tips punjabi', 'education punjabi', 'current affairs punjabi', 'exam tips punjabi'],
  business:      ['business ideas punjabi', 'online kamae punjabi', 'farming punjabi', 'kheti punjabi', 'vyapar punjabi'],
  health:        ['sehat tips punjabi', 'weight loss punjabi', 'desi nuskhe punjabi', 'fitness punjabi', 'yoga punjabi'],
  entertainment: ['punjabi comedy', 'funny punjabi videos', 'punjabi vlog', 'punjabi movies review', 'entertainment punjabi'],
  food:          ['punjabi recipe', 'punjabi khana', 'roti sabzi punjabi', 'langar recipe', 'cooking punjabi'],
  sports:        ['cricket punjabi', 'kabaddi punjabi', 'sports news punjabi', 'khelna punjabi', 'volleyball punjabi'],
  music:         ['punjabi songs', 'dhol tabla punjabi', 'music lessons punjabi', 'kirtan punjabi', 'bhangra dance'],
  news:          ['punjab news today', 'latest punjabi news', 'political news punjabi', 'desh news punjabi', 'khabar punjabi'],
  lifestyle:     ['motivation punjabi', 'self improvement punjabi', 'life tips punjabi', 'routine punjabi', 'personality development punjabi'],
  travel:        ['travel punjab', 'gurudwara visit vlog', 'travel tips punjabi', 'himachal travel punjabi', 'vlog punjabi'],
  other:         ['knowledge punjabi', 'tips punjabi', 'how to punjabi', 'seekho punjabi', 'gyan punjabi'],
};

const LANG_KEYWORD_BANKS = {
  en: NICHE_KEYWORDS,
  hi: HINDI_NICHE_KEYWORDS,
  ta: TAMIL_NICHE_KEYWORDS,
  te: TELUGU_NICHE_KEYWORDS,
  bn: BENGALI_NICHE_KEYWORDS,
  kn: KANNADA_NICHE_KEYWORDS,
  ml: MALAYALAM_NICHE_KEYWORDS,
  es: SPANISH_NICHE_KEYWORDS,
  pt: PORTUGUESE_NICHE_KEYWORDS,
  id: INDONESIAN_NICHE_KEYWORDS,
  ar: ARABIC_NICHE_KEYWORDS,
  pa: PUNJABI_NICHE_KEYWORDS,
};

// Language → regionCode for non-English searches
const LANG_REGION = {
  hi: 'IN', ta: 'IN', te: 'IN', bn: 'IN',
  kn: 'IN', ml: 'IN', pa: 'IN',
  es: 'MX', pt: 'BR', id: 'ID', ar: 'SA',
};

const LANG_DISCOVERY_SOURCE = {
  en: 'keyword_search',
  hi: 'hindi_keyword_search',
  ta: 'tamil_keyword_search',
  te: 'telugu_keyword_search',
  bn: 'bengali_keyword_search',
  kn: 'kannada_keyword_search',
  ml: 'malayalam_keyword_search',
  es: 'spanish_keyword_search',
  pt: 'portuguese_keyword_search',
  id: 'indonesian_keyword_search',
  ar: 'arabic_keyword_search',
  pa: 'punjabi_keyword_search',
};

// Channels per niche above this count → skip English search
const NICHE_SATURATION_THRESHOLD = 300;
// Channels discovered via a specific language source in last 24h → skip that language/niche
const RECENT_DISCOVERY_COOLDOWN = 20;

function isNicheSaturated(db, niche, lang) {
  // For non-English: check how many channels were recently found via this language's
  // search source. Freshly discovered channels won't have language tags yet, so
  // checking by discovery_source is more reliable than checking yt_default_language.
  if (lang && lang !== 'en') {
    const source = LANG_DISCOVERY_SOURCE[lang] ?? `${lang}_keyword_search`;
    const recentRow = db.get(
      `SELECT COUNT(*) AS n FROM corpus_channels
       WHERE niche = ? AND discovery_source = ?
         AND created_at >= datetime('now', '-24 hours')`,
      [niche, source],
    );
    if ((recentRow?.n ?? 0) >= RECENT_DISCOVERY_COOLDOWN) return true;

    // Also check language-tagged channels for longer-term saturation
    const langRow = db.get(
      `SELECT COUNT(*) AS n FROM corpus_channels
       WHERE niche = ? AND (yt_default_language = ? OR language = ?)`,
      [niche, lang, lang],
    );
    return (langRow?.n ?? 0) >= NICHE_SATURATION_THRESHOLD;
  }

  // English: check total niche count
  const row = db.get(
    'SELECT COUNT(*) AS n FROM corpus_channels WHERE niche = ?',
    [niche],
  );
  return (row?.n ?? 0) >= NICHE_SATURATION_THRESHOLD;
}

async function discoverByNicheKeyword(db, niche, lang = 'en') {
  if (!quotaGuard.quotaAvailable(100)) {
    console.warn('[discovery] Skipping keyword search — insufficient quota (needs 100 units)');
    return [];
  }

  // Skip saturated niches — paying 100 units for 0-1 new channels is wasteful
  if (isNicheSaturated(db, niche, lang)) {
    console.log(`[discovery] Niche "${niche}" (${lang}) saturated — skipping search`);
    return [];
  }

  const keywords = LANG_KEYWORD_BANKS[lang]?.[niche] ?? NICHE_KEYWORDS[niche];
  if (!keywords?.length) return [];

  // Rotate keyword by search-count-within-day so consecutive runs use different terms
  const dayOffset  = Math.floor(Date.now() / 86_400_000);
  const hourOffset = Math.floor(Date.now() / 3_600_000);
  const keyword    = keywords[hourOffset % keywords.length];

  // Alternate order daily: relevance finds popular channels, date finds newer ones
  const order = dayOffset % 2 === 0 ? 'relevance' : 'date';

  const searchParams = {
    part:       'snippet',
    type:       'channel',
    q:          keyword,
    maxResults: 50,   // costs 100 units flat regardless of 10 or 50 — always take max
    order,
  };
  if (lang !== 'en') {
    searchParams.relevanceLanguage = lang;
    const region = LANG_REGION[lang];
    if (region) searchParams.regionCode = region;
  }

  const discoverySource = LANG_DISCOVERY_SOURCE[lang] ?? 'keyword_search';

  try {
    quotaGuard.recordUsage(100, 'corpus'); // search.list = 100 units
    const data = await ytFetch('search', searchParams);

    const items    = data.items ?? [];
    const newFound = [];
    const allIds   = [];

    // Collect all writes first, then flush in one transaction.
    // 50 channels × co-occurrence edges = up to 1,225 writes — must batch or
    // DELETE journal mode on Windows throws "unable to open database file".
    for (const item of items) {
      const channelId = item.id.channelId;
      if (!channelId) continue;
      allIds.push(channelId);
      if (!getCorpusChannel(db, channelId)) newFound.push({ channelId, item });
    }

    db.run('BEGIN');
    try {
      for (const { channelId, item } of newFound) {
        upsertCorpusChannel(db, {
          channel_id:       channelId,
          title:            item.snippet.channelTitle ?? item.snippet.title,
          niche,
          discovery_source: discoverySource,
        });
        logChannelEvent(db, channelId, 'first_discovered', {
          discovery_source: discoverySource,
          niche,
          search_keyword:   keyword,
          lang,
        });
        logDiscoveryProvenance(db, channelId, {
          discovery_source: discoverySource,
          search_query:     keyword,
        });
        upsertDiscoveryEdge(db, {
          source_channel_id: `niche:${niche}`,
          target_channel_id: channelId,
          relationship_type: 'niche_adjacent',
          confidence:        0.5,
          discovered_via:    discoverySource,
        });
      }

      // Co-occurrence edges: channels appearing together in the same search are adjacent
      for (let i = 0; i < allIds.length; i++) {
        for (let j = i + 1; j < allIds.length; j++) {
          upsertDiscoveryEdge(db, {
            source_channel_id: allIds[i],
            target_channel_id: allIds[j],
            relationship_type: 'search_co_occurrence',
            confidence:        0.4,
            discovered_via:    discoverySource,
          });
        }
      }
      db.run('COMMIT');
    } catch (inner) {
      db.run('ROLLBACK');
      throw inner;
    }

    console.log(`[discovery] Keyword search "${niche}" (${lang}) order=${order}: found ${newFound.length} new / ${allIds.length} total`);
    return newFound.map(r => r.channelId);
  } catch (e) {
    console.warn('[discovery] Keyword search error:', e.message);
    return [];
  }
}

// ── API: discover by searching VIDEOS (surfaces creators YouTube's channel search misses) ──
// Costs 100 units (search.list) + 1 unit (channels.list batch) = 101 units per call.
// Returns up to 50 unique new channel IDs per call — broader coverage than channel search.

async function discoverByVideoSearch(db, keyword, lang = 'en', niche = 'other') {
  if (!quotaGuard.quotaAvailable(101)) {
    console.warn('[discovery] Skipping video search — insufficient quota (needs 101 units)');
    return [];
  }

  const dayOffset = Math.floor(Date.now() / 86_400_000);
  const videoOrder = dayOffset % 2 === 0 ? 'relevance' : 'date';

  const searchParams = {
    part:       'snippet',
    type:       'video',
    q:          keyword,
    maxResults: 50,
    order:      videoOrder,
  };
  if (lang !== 'en') {
    searchParams.relevanceLanguage = lang;
    const region = LANG_REGION[lang];
    if (region) searchParams.regionCode = region;
  }

  const discoverySource = `video_search_${lang}`;

  try {
    quotaGuard.recordUsage(100, 'corpus');
    const data = await ytFetch('search', searchParams);

    // Extract unique channel IDs from video results
    const items      = data.items ?? [];
    const channelIds = [...new Set(items.map(i => i.snippet?.channelId).filter(Boolean))];
    const newIds     = channelIds.filter(id => !getCorpusChannel(db, id));

    // Batch-fetch metadata for new channels only
    const newFound = [];
    if (newIds.length) {
      quotaGuard.recordUsage(1, 'corpus');
      const channelData = await ytFetch('channels', {
        part: 'snippet,statistics',
        id:   newIds.join(','),
      });

      const batchItems = channelData.items ?? [];
      db.run('BEGIN');
      try {
        for (const item of batchItems) {
          const channelId = item.id;
          if (!channelId) continue;
          upsertCorpusChannel(db, {
            channel_id:       channelId,
            title:            item.snippet?.title,
            subscriber_count: parseInt(item.statistics?.subscriberCount ?? '0', 10),
            niche,
            discovery_source: discoverySource,
          });
          logChannelEvent(db, channelId, 'first_discovered', {
            discovery_source: discoverySource,
            niche,
            search_keyword:   keyword,
            lang,
          });
          logDiscoveryProvenance(db, channelId, {
            discovery_source: discoverySource,
            search_query:     keyword,
          });
          upsertDiscoveryEdge(db, {
            source_channel_id: `niche:${niche}`,
            target_channel_id: channelId,
            relationship_type: 'video_search_adjacent',
            confidence:        0.5,
            discovered_via:    discoverySource,
          });
          newFound.push(channelId);
        }

        // Co-occurrence edges for all channels in this search result
        for (let i = 0; i < channelIds.length; i++) {
          for (let j = i + 1; j < channelIds.length; j++) {
            upsertDiscoveryEdge(db, {
              source_channel_id: channelIds[i],
              target_channel_id: channelIds[j],
              relationship_type: 'search_co_occurrence',
              confidence:        0.4,
              discovered_via:    discoverySource,
            });
          }
        }
        db.run('COMMIT');
      } catch (inner) {
        db.run('ROLLBACK');
        throw inner;
      }
    } else {
      // No new channels but still write co-occurrence edges for existing ones
      db.run('BEGIN');
      try {
        for (let i = 0; i < channelIds.length; i++) {
          for (let j = i + 1; j < channelIds.length; j++) {
            upsertDiscoveryEdge(db, {
              source_channel_id: channelIds[i],
              target_channel_id: channelIds[j],
              relationship_type: 'search_co_occurrence',
              confidence:        0.4,
              discovered_via:    discoverySource,
            });
          }
        }
        db.run('COMMIT');
      } catch (inner) {
        db.run('ROLLBACK');
        throw inner;
      }
    }

    console.log(`[discovery] Video search "${keyword}" (${lang}) order=${videoOrder}: found ${newFound.length} new channels, ${channelIds.length} total`);
    return newFound;
  } catch (e) {
    console.warn('[discovery] Video search error:', e.message);
    return [];
  }
}

// ── Zero-quota: discover from ingested_channels not yet in corpus ─────────────

function discoverFromIngestedChannels(db) {
  const { getDb } = require('../db/init');
  const database  = db || getDb();

  const ingestedNotInCorpus = database.all(
    `SELECT ic.channel_id, ic.channel_name, ic.uploads_playlist_id,
            ic.channel_subscribers, ic.niche
     FROM ingested_channels ic
     WHERE NOT EXISTS (SELECT 1 FROM corpus_channels cc WHERE cc.channel_id = ic.channel_id)
     LIMIT 200`,
  );

  let added = 0;
  for (const ic of ingestedNotInCorpus) {
    upsertCorpusChannel(database, {
      channel_id:          ic.channel_id,
      title:               ic.channel_name,
      uploads_playlist_id: ic.uploads_playlist_id,
      niche:               ic.niche,
      subscriber_count:    ic.channel_subscribers ?? 0,
      discovery_source:    'ingested_channels_sync',
    });
    logChannelEvent(database, ic.channel_id, 'first_discovered', {
      discovery_source: 'ingested_channels_sync',
      title:            ic.channel_name,
    });
    logDiscoveryProvenance(database, ic.channel_id, { discovery_source: 'ingested_channels_sync' });
    added++;
  }

  if (added > 0) console.log(`[discovery] Synced ${added} ingested_channels → corpus_channels`);
  return added;
}

// ── Zero-quota: discover from discovered_channels (already approved) ──────────

function discoverFromApprovedCandidates(db) {
  const { getDb } = require('../db/init');
  const database  = db || getDb();

  const approved = database.all(
    `SELECT dc.channel_id, dc.title, dc.handle, dc.thumbnail_url,
            dc.subscriber_count, dc.primary_niche, dc.discovery_source
     FROM discovered_channels dc
     WHERE dc.approval_status = 'approved'
       AND NOT EXISTS (SELECT 1 FROM corpus_channels cc WHERE cc.channel_id = dc.channel_id)
     LIMIT 100`,
  );

  let added = 0;
  for (const dc of approved) {
    upsertCorpusChannel(database, {
      channel_id:       dc.channel_id,
      title:            dc.title,
      handle:           dc.handle,
      thumbnail_url:    dc.thumbnail_url,
      niche:            dc.primary_niche,
      subscriber_count: dc.subscriber_count ?? 0,
      discovery_source: 'discovery_approved',
    });
    logChannelEvent(database, dc.channel_id, 'first_discovered', {
      discovery_source: 'discovery_approved',
      title:            dc.title,
    });
    logDiscoveryProvenance(database, dc.channel_id, {
      discovery_source: 'discovery_approved',
      source_channel_id: dc.discovery_source ?? null,
    });
    added++;
  }

  if (added > 0) console.log(`[discovery] Synced ${added} approved candidates → corpus_channels`);
  return added;
}

// ── Zero-quota: mine featured channels from stored raw_json ──────────────────
// Reads brandingSettings.channel.featuredChannelsUrls from corpus channels
// already fetched — no API calls needed.

function discoverFromFeaturedChannels(db) {
  const channels = db.all(
    `SELECT channel_id, niche, raw_json FROM corpus_channels
     WHERE raw_json IS NOT NULL
     ORDER BY quality_score DESC LIMIT 2000`,
  );

  let discovered = 0;
  let edges = 0;
  for (const ch of channels) {
    try {
      const json     = typeof ch.raw_json === 'string' ? JSON.parse(ch.raw_json) : ch.raw_json;
      const featured = json?.brandingSettings?.channel?.featuredChannelsUrls ?? [];
      for (const featuredId of featured) {
        if (!featuredId) continue;
        const exists = db.get('SELECT 1 FROM corpus_channels WHERE channel_id = ?', [featuredId]);
        if (!exists) {
          upsertCorpusChannel(db, {
            channel_id:       featuredId,
            title:            featuredId,
            niche:            ch.niche ?? null,
            discovery_source: 'featured_channels',
            ingest_depth:     0,
          });
          logChannelEvent(db, featuredId, 'first_discovered', {
            discovery_source:  'featured_channels',
            source_channel_id: ch.channel_id,
          });
          logDiscoveryProvenance(db, featuredId, {
            discovery_source:  'featured_channels',
            source_channel_id: ch.channel_id,
          });
          discovered++;
        }
        upsertDiscoveryEdge(db, {
          source_channel_id: ch.channel_id,
          target_channel_id: featuredId,
          relationship_type: 'featured_by',
          confidence:        0.75,
          discovered_via:    'featured_channels',
        });
        logCreatorEdge(db, ch.channel_id, featuredId, 'featured_by', 0.75);
        edges++;
      }
    } catch (_) {}
  }

  console.log(`[discovery] Featured channels: ${discovered} new channels, ${edges} edges written`);
  return { discovered, edges };
}

// ── Build semantic neighbor edges from cluster data ───────────────────────────

function buildRelatedGraph(db) {
  // Find channels that share the same semantic clusters — mark as semantic_neighbor
  const coClusterPairs = db.all(
    `SELECT a.channel_id AS source, b.channel_id AS target, cv.semantic_cluster
     FROM corpus_videos cv
     JOIN corpus_channels a ON a.channel_id = cv.channel_id
     JOIN corpus_videos cv2 ON cv2.semantic_cluster = cv.semantic_cluster AND cv2.channel_id != cv.channel_id
     JOIN corpus_channels b ON b.channel_id = cv2.channel_id
     WHERE cv.semantic_cluster IS NOT NULL
     GROUP BY a.channel_id, b.channel_id
     HAVING COUNT(*) >= 3
     LIMIT 500`,
  );

  let edges = 0;
  for (const pair of coClusterPairs) {
    upsertDiscoveryEdge(db, {
      source_channel_id: pair.source,
      target_channel_id: pair.target,
      relationship_type: 'semantic_neighbor',
      confidence:        0.7,
      discovered_via:    'cluster_co_occurrence',
    });
    edges++;
  }
  return edges;
}

// ── Main discovery run (zero-quota-first) ─────────────────────────────────────

// All supported language codes for iteration
const ALL_LANG_CODES = Object.keys(LANG_KEYWORD_BANKS);

async function runDiscoveryCycle(db, {
  allowSearch = false,        maxSearches = 5,
  allowHindiSearch = false,   maxHindiSearches = 5,
  allowTamilSearch = false,   maxTamilSearches = 5,
  allowTeluguSearch = false,  maxTeluguSearches = 5,
  allowBengaliSearch = false, maxBengaliSearches = 3,
  allowKannadaSearch = false, maxKannadaSearches = 3,
  allowMalayalamSearch = false, maxMalayalamSearches = 3,
  allowSpanishSearch = false, maxSpanishSearches = 3,
  allowPortugueseSearch = false, maxPortugueseSearches = 3,
  allowIndonesianSearch = false, maxIndonesianSearches = 3,
  allowArabicSearch = false,  maxArabicSearches = 3,
  allowPunjabiSearch = false, maxPunjabiSearches = 3,
  allowVideoSearch = false,   maxVideoSearches = 5,
} = {}) {
  const results = {
    synced_ingested: 0, synced_approved: 0, cluster_edges: 0,
    niche_gaps: [], featured_discovered: 0,
    search_discovered: 0,     searches_run: 0,
    hindi_discovered: 0,      hindi_searches_run: 0,
    tamil_discovered: 0,      tamil_searches_run: 0,
    telugu_discovered: 0,     telugu_searches_run: 0,
    bengali_discovered: 0,    bengali_searches_run: 0,
    kannada_discovered: 0,    kannada_searches_run: 0,
    malayalam_discovered: 0,  malayalam_searches_run: 0,
    spanish_discovered: 0,    spanish_searches_run: 0,
    portuguese_discovered: 0, portuguese_searches_run: 0,
    indonesian_discovered: 0, indonesian_searches_run: 0,
    arabic_discovered: 0,     arabic_searches_run: 0,
    punjabi_discovered: 0,    punjabi_searches_run: 0,
    video_discovered: 0,      video_searches_run: 0,
  };

  // 1. Zero-quota syncs
  results.synced_ingested      = discoverFromIngestedChannels(db);
  results.synced_approved      = discoverFromApprovedCandidates(db);
  results.featured_discovered  = discoverFromFeaturedChannels(db);
  results.cluster_edges        = buildRelatedGraph(db);
  results.niche_gaps           = findUnderrepresentedNiches(db);

  const { getDb } = require('../db/init');
  const database = db || getDb();

  // Helper: run N searches for a given language using keyword rotation
  async function runLangSearches(langCode, maxCount, discoveredKey, runsKey) {
    if (!maxCount || !quotaGuard.quotaAvailable(100)) return;
    const bank   = LANG_KEYWORD_BANKS[langCode];
    if (!bank) return;
    const niches = Object.keys(bank);
    const offset = Math.floor(Date.now() / 86_400_000);
    for (let i = 0; i < maxCount; i++) {
      if (!quotaGuard.quotaAvailable(100)) break;
      const niche = niches[(offset + i) % niches.length];
      const found = await discoverByNicheKeyword(database, niche, langCode);
      results[runsKey]++;
      results[discoveredKey] += found.length;
      if (found.length > 0) await sleep(300);
    }
  }

  // 2. English keyword searches (targets niche gaps)
  if (allowSearch && results.niche_gaps.length > 0) {
    for (const gap of results.niche_gaps) {
      if (results.searches_run >= maxSearches) break;
      if (!quotaGuard.quotaAvailable(100)) break;
      const found = await discoverByNicheKeyword(database, gap.niche, 'en');
      results.searches_run++;
      results.search_discovered += found.length;
      if (found.length > 0) await sleep(300);
    }
  }

  // 3. Multilingual keyword searches
  if (allowHindiSearch)      await runLangSearches('hi', maxHindiSearches,      'hindi_discovered',      'hindi_searches_run');
  if (allowTamilSearch)      await runLangSearches('ta', maxTamilSearches,      'tamil_discovered',      'tamil_searches_run');
  if (allowTeluguSearch)     await runLangSearches('te', maxTeluguSearches,     'telugu_discovered',     'telugu_searches_run');
  if (allowBengaliSearch)    await runLangSearches('bn', maxBengaliSearches,    'bengali_discovered',    'bengali_searches_run');
  if (allowKannadaSearch)    await runLangSearches('kn', maxKannadaSearches,    'kannada_discovered',    'kannada_searches_run');
  if (allowMalayalamSearch)  await runLangSearches('ml', maxMalayalamSearches,  'malayalam_discovered',  'malayalam_searches_run');
  if (allowSpanishSearch)    await runLangSearches('es', maxSpanishSearches,    'spanish_discovered',    'spanish_searches_run');
  if (allowPortugueseSearch) await runLangSearches('pt', maxPortugueseSearches, 'portuguese_discovered', 'portuguese_searches_run');
  if (allowIndonesianSearch) await runLangSearches('id', maxIndonesianSearches, 'indonesian_discovered', 'indonesian_searches_run');
  if (allowArabicSearch)     await runLangSearches('ar', maxArabicSearches,     'arabic_discovered',     'arabic_searches_run');
  if (allowPunjabiSearch)    await runLangSearches('pa', maxPunjabiSearches,    'punjabi_discovered',    'punjabi_searches_run');

  // 4. Video search — broader net, surfaces creators channel search misses
  if (allowVideoSearch && maxVideoSearches > 0) {
    const offset = Math.floor(Date.now() / 86_400_000);
    // Rotate through all languages and niches to maximise variety
    const searchSlots = [];
    for (let i = 0; i < maxVideoSearches; i++) {
      const langCode  = ALL_LANG_CODES[(offset + i) % ALL_LANG_CODES.length];
      const bank      = LANG_KEYWORD_BANKS[langCode];
      const niches    = Object.keys(bank);
      const niche     = niches[(offset + i * 3) % niches.length];
      const keywords  = bank[niche];
      const keyword   = keywords[(offset + i * 7) % keywords.length];
      searchSlots.push({ langCode, niche, keyword });
    }
    for (const slot of searchSlots) {
      if (!quotaGuard.quotaAvailable(101)) break;
      const found = await discoverByVideoSearch(database, slot.keyword, slot.langCode, slot.niche);
      results.video_searches_run++;
      results.video_discovered += found.length;
      if (found.length > 0) await sleep(300);
    }
  }

  const totalNew = results.search_discovered + results.hindi_discovered + results.tamil_discovered
    + results.telugu_discovered + results.bengali_discovered + results.kannada_discovered
    + results.malayalam_discovered + results.spanish_discovered + results.portuguese_discovered
    + results.indonesian_discovered + results.arabic_discovered + results.punjabi_discovered
    + results.video_discovered;
  console.log(`[discovery] Cycle complete — total new channels: ${totalNew}`, results);
  return results;
}

module.exports = {
  runDiscoveryCycle,
  findUnderrepresentedNiches,
  discoverFromClusters,
  discoverFromIngestedChannels,
  discoverFromApprovedCandidates,
  discoverFromFeaturedChannels,
  expandFromChannel,
  discoverByNicheKeyword,
  discoverByVideoSearch,
  buildRelatedGraph,
};
