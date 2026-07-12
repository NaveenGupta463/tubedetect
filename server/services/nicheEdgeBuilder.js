'use strict';

const crypto = require('crypto');

const SIZE_NEIGHBOURS = 10;
const ARCHETYPE_NEIGHBOURS = 12;
const TERRITORY_NEIGHBOURS = 14;
const FINGERPRINT_NEIGHBOURS = 8;
const MAX_FINGERPRINT_GROUP = 90;

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function parseFingerprint(fp, limit = 12) {
  return String(fp || '')
    .split('|')
    .map(p => norm(p).replace(/\s+/g, ' '))
    .filter(p => p.length >= 4 && p.length <= 48)
    .filter(p => !/^(video|shorts?|official|new|latest|part|episode|full|live|vlog|reaction)$/.test(p))
    .slice(0, limit);
}

function edgeKey(a, b, type) {
  const [s, t] = a < b ? [a, b] : [b, a];
  return `${type}|${s}|${t}`;
}

function addEdge(edgeMap, source, target, type, confidence, via) {
  if (!source || !target || source === target) return;
  const key = edgeKey(source, target, type);
  const existing = edgeMap.get(key);
  if (!existing || confidence > existing.confidence) {
    const [s, t] = source < target ? [source, target] : [target, source];
    edgeMap.set(key, {
      source_channel_id: s,
      target_channel_id: t,
      relationship_type: type,
      confidence: Number(Math.max(0.05, Math.min(0.95, confidence)).toFixed(3)),
      discovered_via: via,
    });
  }
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function addNearestSubscriberEdges(edgeMap, members, {
  type,
  via,
  neighbours,
  base,
  min,
  multiplier = 0.1,
}) {
  const sorted = [...members].sort((a, b) => (a.subscribers || 0) - (b.subscribers || 0));
  const half = Math.ceil(neighbours / 2);
  for (let i = 0; i < sorted.length; i++) {
    const ch = sorted[i];
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(sorted.length - 1, i + half) && count < neighbours; j++) {
      if (i === j) continue;
      const nb = sorted[j];
      const logRatio = Math.abs(Math.log10(((ch.subscribers || 0) + 1) / ((nb.subscribers || 0) + 1)));
      addEdge(edgeMap, ch.channel_id, nb.channel_id, type, Math.max(min, base - logRatio * multiplier), via);
      count++;
    }
  }
}

function loadChannels(db) {
  return db.all(`
    SELECT
      ic.channel_id,
      ic.channel_name,
      COALESCE(ic.primary_niche, ic.niche, cc.niche) AS niche,
      COALESCE(ic.primary_language, ic.content_language, ic.audience_language, cc.yt_default_language, cc.language, 'unknown') AS language,
      COALESCE(ic.region, cc.yt_country, cc.country, 'unknown') AS country,
      COALESCE(ic.content_archetype, ic.format_type, '') AS archetype,
      COALESCE(ic.channel_subscribers, cc.subscriber_count, 0) AS subscribers,
      ic.content_fingerprint
    FROM ingested_channels ic
    LEFT JOIN corpus_channels cc ON cc.channel_id = ic.channel_id
    WHERE ic.ingest_enabled = 1
      AND COALESCE(ic.primary_niche, ic.niche, cc.niche) IS NOT NULL
  `).map(row => ({
    ...row,
    niche: norm(row.niche),
    language: norm(row.language) || 'unknown',
    country: norm(row.country) || 'unknown',
    archetype: norm(row.archetype),
    subscribers: Number(row.subscribers) || 0,
    phrases: parseFingerprint(row.content_fingerprint),
  }));
}

function loadTerritories(db) {
  return db.all(`
    SELECT ctp.channel_id, ctp.territory_id, ctp.role
    FROM channel_territory_profiles ctp
    JOIN ingested_channels ic ON ic.channel_id = ctp.channel_id
    WHERE ic.ingest_enabled = 1
      AND ctp.role IN ('core', 'accepted')
  `);
}

function writeEdges(db, edges) {
  const sql = `
    INSERT INTO corpus_discovery_graph
      (id, source_channel_id, target_channel_id, relationship_type, confidence, discovered_via)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_channel_id, target_channel_id, relationship_type) DO UPDATE SET
      confidence    = MAX(excluded.confidence, confidence),
      discovered_at = datetime('now')
  `;

  const run = () => {
    for (const e of edges) {
      db.run(sql, [
        crypto.randomUUID(),
        e.source_channel_id,
        e.target_channel_id,
        e.relationship_type,
        e.confidence,
        e.discovered_via,
      ]);
    }
  };

  if (typeof db.transaction === 'function') {
    return db.transaction(run)();
  }

  db.run('BEGIN');
  try {
    run();
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
}

function buildRichNicheEdges(db, { write = true } = {}) {
  const before = db.get('SELECT COUNT(*) AS n FROM corpus_discovery_graph')?.n ?? 0;
  const channels = loadChannels(db);
  const channelById = new Map(channels.map(ch => [ch.channel_id, ch]));
  const edgeMap = new Map();
  const stats = {
    channels: channels.length,
    size_groups: 0,
    archetype_groups: 0,
    territory_groups: 0,
    fingerprint_groups: 0,
  };

  const byNicheCountry = groupBy(channels, ch => ch.niche && `${ch.niche}::${ch.country}`);
  stats.size_groups = byNicheCountry.size;
  for (const members of byNicheCountry.values()) {
    if (members.length < 2) continue;
    addNearestSubscriberEdges(edgeMap, members, {
      type: 'niche_size_peer',
      via: 'rich_niche_edge_builder',
      neighbours: SIZE_NEIGHBOURS,
      base: 0.64,
      min: 0.22,
    });
  }

  const byNicheLangArch = groupBy(channels, ch => {
    if (!ch.niche || !ch.language || ch.language === 'unknown' || !ch.archetype) return null;
    return `${ch.niche}::${ch.language}::${ch.archetype}`;
  });
  stats.archetype_groups = byNicheLangArch.size;
  for (const members of byNicheLangArch.values()) {
    if (members.length < 2) continue;
    addNearestSubscriberEdges(edgeMap, members, {
      type: 'niche_language_archetype_peer',
      via: 'rich_niche_edge_builder',
      neighbours: ARCHETYPE_NEIGHBOURS,
      base: 0.74,
      min: 0.45,
      multiplier: 0.08,
    });
  }

  const territories = loadTerritories(db);
  const territoryGroups = new Map();
  for (const t of territories) {
    const ch = channelById.get(t.channel_id);
    if (!ch) continue;
    const key = `${t.territory_id}::${ch.language || 'unknown'}::${ch.country || 'unknown'}`;
    if (!territoryGroups.has(key)) territoryGroups.set(key, []);
    territoryGroups.get(key).push({ ...ch, territory_role: t.role });
  }
  stats.territory_groups = territoryGroups.size;
  for (const members of territoryGroups.values()) {
    if (members.length < 2) continue;
    addNearestSubscriberEdges(edgeMap, members, {
      type: 'territory_peer',
      via: 'rich_niche_edge_builder',
      neighbours: TERRITORY_NEIGHBOURS,
      base: 0.82,
      min: 0.5,
      multiplier: 0.06,
    });
  }

  const phraseGroups = new Map();
  for (const ch of channels) {
    for (const phrase of ch.phrases) {
      const key = `${phrase}::${ch.niche}::${ch.language}`;
      if (!phraseGroups.has(key)) phraseGroups.set(key, []);
      phraseGroups.get(key).push(ch);
    }
  }
  for (const members of phraseGroups.values()) {
    if (members.length < 2 || members.length > MAX_FINGERPRINT_GROUP) continue;
    stats.fingerprint_groups++;
    addNearestSubscriberEdges(edgeMap, members, {
      type: 'content_fingerprint_peer',
      via: 'rich_niche_edge_builder',
      neighbours: FINGERPRINT_NEIGHBOURS,
      base: 0.78,
      min: 0.48,
      multiplier: 0.07,
    });
  }

  const edges = [...edgeMap.values()];
  if (write && edges.length) writeEdges(db, edges);
  const after = db.get('SELECT COUNT(*) AS n FROM corpus_discovery_graph')?.n ?? before;

  const byType = {};
  for (const e of edges) byType[e.relationship_type] = (byType[e.relationship_type] || 0) + 1;

  return {
    ok: true,
    written: write ? edges.length : 0,
    generated: edges.length,
    before,
    after,
    net_new: after - before,
    by_type: byType,
    ...stats,
  };
}

module.exports = {
  buildRichNicheEdges,
  parseFingerprint,
};
