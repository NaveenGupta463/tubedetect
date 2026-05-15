'use strict';

/**
 * Louvain community detection — pure JavaScript, Phase 1 + Phase 2 aggregation.
 *
 * Inputs
 *   nodeIds  string[]  — unique channel IDs
 *   edges    {source, target, weight?}[]  — undirected weighted edges
 *
 * Returns Map<channelId, communityId> where communityId is a compact numeric string.
 *
 * Algorithm
 *   Phase 1: local moving — each node greedily joins the neighbour community
 *            that maximises modularity gain ΔQ. Repeated with shuffled order
 *            until convergence (≤100 passes).
 *   Phase 2: aggregation — collapse each community into a super-node, rebuild
 *            the edge-weighted super-graph, run Phase 1 again.
 *   Iterate up to maxPhases times. Typical: Phase 1 → 719 communities,
 *   Phase 2 → ~40–80 communities, Phase 3 → ~20–40 communities (stable).
 */

// ── Phase 1: local moving ─────────────────────────────────────────────────────

function runPhase1(nodeIds, edges, gamma = 1.2) {
  const n   = nodeIds.length;
  const idx = new Map(nodeIds.map((id, i) => [id, i]));

  const adj = Array.from({ length: n }, () => new Map());
  let m = 0;

  for (const { source, target, weight = 1 } of edges) {
    const s = idx.get(source);
    const t = idx.get(target);
    if (s == null || t == null || s === t) continue;
    const w = Math.max(+weight || 1, 1e-6);
    adj[s].set(t, (adj[s].get(t) || 0) + w);
    adj[t].set(s, (adj[t].get(s) || 0) + w);
    m += w;
  }

  // Each node starts as its own community
  const comm     = new Int32Array(n).map((_, i) => i);
  const k        = new Float64Array(n);
  const sigmaTot = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    for (const w of adj[i].values()) k[i] += w;
    sigmaTot[i] = k[i];
  }

  if (m === 0) return new Map(nodeIds.map(id => [id, id]));

  const invM     = 1 / m;
  const invTwoMM = 1 / (2 * m * m);
  const order    = Array.from({ length: n }, (_, i) => i);

  let improved = true;
  let pass     = 0;

  while (improved && pass < 100) {
    improved = false;
    pass++;

    for (let i = n - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }

    for (const i of order) {
      const ci = comm[i];
      const ki = k[i];

      const kiToComm = new Map();
      for (const [j, w] of adj[i]) {
        const cj = comm[j];
        kiToComm.set(cj, (kiToComm.get(cj) || 0) + w);
      }

      const kiCi     = kiToComm.get(ci) || 0;
      const sigCiNoI = sigmaTot[ci] - ki;

      let bestComm = ci;
      let bestGain = 0;

      for (const [c, kiC] of kiToComm) {
        if (c === ci) continue;
        const gain = (kiC - kiCi) * invM
                   - gamma * (sigmaTot[c] - sigCiNoI) * ki * invTwoMM;
        if (gain > bestGain) { bestGain = gain; bestComm = c; }
      }

      if (bestComm !== ci) {
        sigmaTot[ci]       -= ki;
        sigmaTot[bestComm] += ki;
        comm[i]             = bestComm;
        improved            = true;
      }
    }
  }

  // Return Map<nodeId -> representative nodeId of its community>
  const result = new Map();
  for (let i = 0; i < n; i++) result.set(nodeIds[i], nodeIds[comm[i]]);
  return result;
}

// ── Phase 2: super-graph construction ────────────────────────────────────────

function buildSuperGraph(edges, commOf) {
  const edgeMap = new Map();

  for (const { source, target, weight = 1 } of edges) {
    const cs = commOf.get(source);
    const ct = commOf.get(target);
    if (cs == null || ct == null || cs === ct) continue;
    // Undirected: canonical key with smaller string first
    const key = cs < ct ? `${cs}\x00${ct}` : `${ct}\x00${cs}`;
    edgeMap.set(key, (edgeMap.get(key) || 0) + (+weight || 1));
  }

  const superEdges = [];
  for (const [key, weight] of edgeMap) {
    const sep = key.indexOf('\x00');
    superEdges.push({ source: key.slice(0, sep), target: key.slice(sep + 1), weight });
  }

  const superNodes = Array.from(new Set(commOf.values()));
  return { superNodes, superEdges };
}

// ── Full Louvain (Phase 1 → Phase 2 → Phase 1 → …) ──────────────────────────

function detectCommunities(nodeIds, edges, { maxPhases = 2, gamma = 1.5 } = {}) {
  if (nodeIds.length === 0) return new Map();

  // globalComm[originalNode] = current community representative
  const globalComm = new Map(nodeIds.map(id => [id, id]));

  // Which original nodes does each current super-node represent?
  let superToOriginals = new Map(nodeIds.map(id => [id, [id]]));

  let currentNodes = nodeIds;
  let currentEdges = edges;
  let prevCount    = nodeIds.length;

  for (let phase = 0; phase < maxPhases; phase++) {
    const phase1   = runPhase1(currentNodes, currentEdges, gamma);
    const commCount = new Set(phase1.values()).size;

    console.log(`[louvain] Phase ${phase + 1}: ${currentNodes.length} nodes → ${commCount} communities`);

    // Propagate assignments back to original nodes
    for (const [superNode, commRep] of phase1) {
      for (const orig of (superToOriginals.get(superNode) || [superNode])) {
        globalComm.set(orig, commRep);
      }
    }

    // Stop if no reduction or single community
    if (commCount >= prevCount || commCount <= 1) break;
    prevCount = commCount;

    // Build super-graph for the next phase
    const { superNodes, superEdges } = buildSuperGraph(currentEdges, phase1);

    // Rebuild superToOriginals for the new super-nodes
    const newSuperToOriginals = new Map();
    for (const [superNode, commRep] of phase1) {
      if (!newSuperToOriginals.has(commRep)) newSuperToOriginals.set(commRep, []);
      for (const orig of (superToOriginals.get(superNode) || [superNode])) {
        newSuperToOriginals.get(commRep).push(orig);
      }
    }

    currentNodes      = superNodes;
    currentEdges      = superEdges;
    superToOriginals  = newSuperToOriginals;
  }

  // Remap community representatives → compact integer strings "0", "1", …
  const remap  = new Map();
  let   nextId = 0;
  const result = new Map();

  for (const [orig, commRep] of globalComm) {
    if (!remap.has(commRep)) remap.set(commRep, nextId++);
    result.set(orig, String(remap.get(commRep)));
  }

  console.log(`[louvain] Final: ${nextId} communities from ${nodeIds.length} channels`);
  return result;
}

// ── Summary ───────────────────────────────────────────────────────────────────

function summarizeCommunities(assignments, channelMap) {
  const stats = new Map();

  for (const [channelId, commId] of assignments) {
    if (!stats.has(commId)) stats.set(commId, { size: 0, niches: new Map() });
    const s = stats.get(commId);
    s.size++;
    const niche = channelMap.get(channelId);
    if (niche) s.niches.set(niche, (s.niches.get(niche) || 0) + 1);
  }

  return Array.from(stats.entries())
    .map(([id, { size, niches }]) => {
      const sorted = [...niches.entries()].sort((a, b) => b[1] - a[1]);
      return {
        community_id: id,
        size,
        top_niche: sorted[0]?.[0] ?? 'unknown',
        niches:    Object.fromEntries(sorted.slice(0, 5)),
      };
    })
    .sort((a, b) => b.size - a.size);
}

module.exports = { detectCommunities, summarizeCommunities };
