import { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTip, ResponsiveContainer, Cell } from 'recharts';
import { ROUTES } from '../config';

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  card:    { background: '#0a0a0f', border: '1px solid #1a1a2e', borderRadius: 10, padding: '18px 20px', marginBottom: 16 },
  label:   { fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#333', marginBottom: 6, display: 'block' },
  val:     { fontSize: '1.1rem', fontWeight: 700, color: '#8888ff', lineHeight: 1 },
  sub:     { fontSize: '0.62rem', color: '#333', marginTop: 4 },
  empty:   { color: '#2a2a2a', fontSize: '0.72rem', padding: '24px 0', textAlign: 'center' },
  sectionHd: { fontSize: '0.62rem', fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, marginTop: 20, borderBottom: '1px solid #111', paddingBottom: 6 },
  btn:     { background: '#1a1a2e', border: '1px solid #2a2a4e', borderRadius: 6, color: '#8888ff', padding: '7px 14px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'monospace' },
  btnGreen:{ background: '#0a1f0a', border: '1px solid #1a4a1a', borderRadius: 6, color: '#4ade80', padding: '7px 14px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'monospace' },
  grid3:   { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 },
  grid2:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 },
  tag:     (color) => ({ fontSize: '0.58rem', background: color + '22', color, border: `1px solid ${color}44`, borderRadius: 3, padding: '2px 6px', fontFamily: 'monospace' }),
  input:   { background: '#111', border: '1px solid #1a1a2e', borderRadius: 6, color: '#ccc', padding: '8px 12px', fontSize: '0.78rem', fontFamily: 'monospace', flex: 1 },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' },
  th:      { borderBottom: '1px solid #1a1a2e', padding: '6px 10px', textAlign: 'left', color: '#333', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '0.6rem' },
  td:      { borderBottom: '1px solid #0d0d12', padding: '7px 10px', color: '#777', verticalAlign: 'middle' },
  btnSm:   { background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 4, color: '#444', padding: '4px 9px', cursor: 'pointer', fontSize: '0.65rem', fontWeight: 600, fontFamily: 'monospace' },
  btnRed:  { background: '#1f0a0a', border: '1px solid #4a1a1a', borderRadius: 6, color: '#f87171', padding: '7px 14px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'monospace' },
  pill:    (color) => ({ fontSize: '0.6rem', fontWeight: 700, background: color + '22', color, border: `1px solid ${color}44`, borderRadius: 10, padding: '2px 8px', fontFamily: 'monospace', letterSpacing: '0.06em' }),
};

const SEED_TEXTS = {
  curiosity:      'what happens why nobody knows secret hidden truth revealed real reason behind',
  fear:           'stop avoid danger warning biggest mistake ruining destroying never should',
  authority:      'doctor expert scientist proven research study reveals according science facts',
  controversy:    'controversial debate unpopular opinion wrong everyone disagrees truth exposed',
  transformation: 'before after transformation journey changed completely progress results weeks months',
  tutorial:       'how to learn step guide beginner complete walkthrough tutorial course explained',
  urgency:        'now today immediately before too late last chance hurry urgent this week',
  challenge:      'challenge days week month impossible extreme hardest attempted tried result',
  myth:           'myth reality truth wrong misconception debunked actually really not true',
  reaction:       'react reaction watching first time trying unboxing reviewing response',
  comparison:     'vs versus better worse comparison which best choose between two options',
  list:           'top reasons ways things tips signs facts mistakes habits steps tricks',
  mistake:        'mistake error wrong fail avoid common biggest never make this again',
  secret:         'secret nobody tells hidden truth unknown underground forbidden revealed',
};

const CLUSTER_COLORS = {
  curiosity: '#a78bfa', tutorial: '#60a5fa', fear: '#f87171', list: '#fbbf24',
  transformation: '#4ade80', authority: '#38bdf8', challenge: '#fb923c',
  urgency: '#f43f5e', controversy: '#e879f9', mistake: '#facc15',
  comparison: '#34d399', secret: '#c084fc', myth: '#f97316', reaction: '#94a3b8',
};
const TREND_COLORS = { rising: '#4ade80', stable: '#555', declining: '#f87171' };

async function apiFetch(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || r.statusText); }
  return r.json();
}

function HelpTip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: 5 }}>
      <span
        style={{ fontSize: '0.58rem', color: '#333', cursor: 'help', border: '1px solid #222', borderRadius: '50%', padding: '0 4px', lineHeight: '14px', display: 'inline-block' }}
        onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
      >?</span>
      {show && (
        <div style={{ position: 'absolute', bottom: '120%', left: 0, zIndex: 100, background: '#0a0a0f', border: '1px solid #222', fontSize: '0.62rem', color: '#888', padding: '8px 12px', borderRadius: 6, whiteSpace: 'pre-wrap', maxWidth: 300, minWidth: 200 }}>
          {text}
        </div>
      )}
    </span>
  );
}

function StatBox({ label, value, sub, tooltip }) {
  return (
    <div style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: '0.58rem', color: '#333', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}{tooltip && <HelpTip text={tooltip} />}
      </div>
      <div style={S.val}>{value ?? '—'}</div>
      {sub && <div style={S.sub}>{sub}</div>}
    </div>
  );
}

function ProviderBadge({ provider }) {
  const color = provider === 'openai_embedding' ? '#4ade80' : provider === 'tfidf_fallback' ? '#fbbf24' : '#f87171';
  const label = provider === 'openai_embedding' ? 'OpenAI Tier 1' : provider === 'tfidf_fallback' ? 'TF-IDF Tier 2' : 'Unavailable';
  return <span style={S.tag(color)}>{label}</span>;
}

function SimilarityBar({ value }) {
  const pct   = Math.round((value ?? 0) * 100);
  const color = pct >= 70 ? '#4ade80' : pct >= 40 ? '#fbbf24' : '#888';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 5, background: '#1a1a2e', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: '0.65rem', color }}>{pct}%</span>
    </div>
  );
}

// ── Section 1: Embedding Coverage ─────────────────────────────────────────────

function CoverageSection({ status, coverage, onIngest, onCluster, onReseed, busy }) {
  const totalTitles = coverage?.total_titles ?? 0;
  const embedded    = coverage?.total ?? 0;
  const pct         = totalTitles > 0 ? Math.round((embedded / totalTitles) * 100) : 0;

  return (
    <>
      <div style={S.grid3}>
        <StatBox label="Embeddings Stored" value={embedded.toLocaleString()}
          tooltip="Total title_dna embeddings in semantic_embeddings table. Each represents a title's structural-behavioral fingerprint." />
        <StatBox label="Coverage" value={`${pct}%`} sub={`${embedded} / ${totalTitles} titles`}
          tooltip="Percentage of ingested video titles that have been embedded. Higher = more complete semantic memory." />
        <StatBox label="Semantic Clusters" value={coverage?.clusters ?? 0}
          tooltip="Number of seeded semantic archetypes. 14 pre-seeded from hook taxonomy. Confidence grows with sample size." />
      </div>

      {/* Provider + corpus info */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.68rem', color: '#555' }}>
          Provider: <ProviderBadge provider={status?.provider} />
        </div>
        {status?.tfidf_corpus?.built && (
          <div style={{ fontSize: '0.65rem', color: '#333' }}>
            TF-IDF corpus: {(status.tfidf_corpus.vocab_size ?? 0).toLocaleString()} terms · {(status.tfidf_corpus.corpus_size ?? 0).toLocaleString()} docs
          </div>
        )}
        {status?.tfidf_corpus && !status.tfidf_corpus.built && (
          <div style={{ fontSize: '0.65rem', color: '#444' }}>TF-IDF corpus: not yet built</div>
        )}
      </div>

      {/* Per-type breakdown */}
      {(coverage?.by_type ?? []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={S.label}>By source type</div>
          <table style={S.table}>
            <thead>
              <tr>
                {['source_type','model','count','last_updated'].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {(coverage.by_type ?? []).map((r, i) => (
                <tr key={i}>
                  <td style={S.td}><code style={{ color: '#8888ff' }}>{r.source_type}</code></td>
                  <td style={S.td}><code style={{ color: '#555' }}>{r.embedding_model}</code></td>
                  <td style={S.td} align="right">{(r.count ?? 0).toLocaleString()}</td>
                  <td style={{ ...S.td, color: '#333', fontSize: '0.6rem' }}>{r.last_updated?.slice(0, 16) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Admin triggers */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={S.btnSm} onClick={onIngest} disabled={busy} title="Legacy fixed 100-item batch ingestion">
          {busy === 'ingest' ? 'Ingesting…' : '▶ Legacy Batch (100)'}
        </button>
        <button style={S.btn} onClick={onCluster} disabled={busy}>
          {busy === 'cluster' ? 'Clustering…' : '⬡ Run Clustering'}
        </button>
        <button style={{ ...S.btn, color: '#f87171', borderColor: '#4a1a1a' }} onClick={onReseed} disabled={busy}>
          {busy === 'reseed' ? 'Reseeding…' : '↺ Reseed Clusters'}
        </button>
      </div>
    </>
  );
}

// ── Section 2: Nearest Neighbor Search ────────────────────────────────────────

function NearestNeighborSection({ status }) {
  const [input,    setInput]    = useState('');
  const [results,  setResults]  = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function search() {
    if (!input.trim()) return;
    setLoading(true); setError(''); setResults(null);
    try {
      const r = await apiFetch(ROUTES.semanticNearest, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: input.trim(), limit: 10, useCache: false }),
      });
      setResults(r);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  return (
    <>
      <div style={{ fontSize: '0.65rem', color: '#333', marginBottom: 12 }}>
        Given any title, retrieves the most semantically similar structures from the ingested corpus.
        Uses stored embeddings when available, TF-IDF direct scan as fallback.
        <HelpTip text="Semantic similarity = cosine distance between title DNA vectors. TF-IDF similarity carries a 0.65× confidence penalty vs. learned embeddings. Results show STRUCTURAL similarity, not topic similarity." />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input style={S.input} placeholder="Enter a title to find similar structures…"
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()} />
        <button style={S.btn} onClick={search} disabled={loading || !input.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: '0.68rem', marginBottom: 8 }}>{error}</div>}

      {results && (
        <div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.62rem', color: '#444' }}>
              query: <em style={{ color: '#666' }}>"{results.title}"</em>
            </span>
            <ProviderBadge provider={results.semantic_provider} />
            <span style={{ fontSize: '0.6rem', color: '#333' }}>{results.latency_ms}ms</span>
            {results.cache_hit && <span style={{ fontSize: '0.6rem', color: '#4ade80' }}>cached</span>}
          </div>

          {(results.neighbors ?? []).length === 0 ? (
            <div style={S.empty}>No neighbors found — embed more titles first</div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  {['#','title','niche','cluster','similarity','confidence'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(results.neighbors ?? []).map((n, i) => (
                  <tr key={i}>
                    <td style={{ ...S.td, color: '#333', minWidth: 24 }}>#{i + 1}</td>
                    <td style={{ ...S.td, maxWidth: 320 }}>
                      <span style={{ color: '#aaa', fontSize: '0.72rem' }}>{n.title ?? n.source_id}</span>
                    </td>
                    <td style={S.td}>
                      {n.niche ? <span style={S.tag('#666')}>{n.niche}</span> : '—'}
                    </td>
                    <td style={S.td}>
                      {n.semantic_cluster
                        ? <span style={S.tag(CLUSTER_COLORS[n.semantic_cluster] ?? '#666')}>{n.semantic_cluster}</span>
                        : '—'}
                    </td>
                    <td style={S.td}><SimilarityBar value={n.similarity} /></td>
                    <td style={S.td}>
                      <SimilarityBar value={n.semantic_confidence ?? n.confidence} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

// ── Section 3: Semantic Cluster Map ───────────────────────────────────────────

function ClusterMapSection({ clusters }) {
  if (!clusters || clusters.length === 0) {
    return <div style={S.empty}>No cluster data yet — run clustering cycle first</div>;
  }

  const barData = clusters
    .filter(c => c.sample_size > 0)
    .map(c => ({
      name:       c.cluster_name,
      count:      c.sample_size,
      confidence: Math.round((c.confidence ?? 0) * 100),
      avg_vph:    c.avg_vph ?? 0,
      trend:      c.trend_direction ?? 'stable',
      color:      CLUSTER_COLORS[c.cluster_name] ?? '#555',
    }));

  if (!barData.length) {
    return (
      <div style={S.empty}>
        14 clusters seeded, waiting for embeddings to be assigned.<br />
        Run "Embed Next Batch" then "Run Clustering".
      </div>
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={barData} margin={{ top: 4, right: 8, left: -24, bottom: 20 }}>
          <XAxis dataKey="name" tick={{ fontSize: 8, fill: '#555' }} angle={-35} textAnchor="end" interval={0} />
          <YAxis tick={{ fontSize: 8, fill: '#555' }} />
          <RechartsTip
            contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.62rem', color: '#ccc' }}
            formatter={(v, n, p) => [`${v} embeddings (conf: ${p.payload.confidence}%)`, p.payload.name]}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {barData.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <table style={{ ...S.table, marginTop: 12 }}>
        <thead>
          <tr>
            {['cluster','embeddings','avg vph','confidence','trend','niches'].map(h => (
              <th key={h} style={S.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clusters.map((c, i) => (
            <tr key={i}>
              <td style={S.td}>
                <span style={{ color: CLUSTER_COLORS[c.cluster_name] ?? '#888', fontWeight: 600, fontSize: '0.72rem' }}>
                  {c.cluster_name}
                </span>
                {c.seeded ? <span style={{ fontSize: '0.55rem', color: '#2a2a2a', marginLeft: 6 }}>seeded</span> : null}
              </td>
              <td style={S.td} align="right">{c.sample_size ?? 0}</td>
              <td style={S.td} align="right">{c.avg_vph != null ? parseFloat(c.avg_vph).toFixed(1) : '—'}</td>
              <td style={S.td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 40, height: 4, background: '#111', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round((c.confidence ?? 0) * 100)}%`, height: '100%', background: '#8888ff', borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: '0.6rem', color: '#555' }}>{Math.round((c.confidence ?? 0) * 100)}%</span>
                </div>
              </td>
              <td style={S.td}>
                <span style={{ color: TREND_COLORS[c.trend_direction] ?? '#555', fontSize: '0.65rem' }}>
                  {c.trend_direction === 'rising' ? '↑' : c.trend_direction === 'declining' ? '↓' : '→'} {c.trend_direction}
                </span>
              </td>
              <td style={{ ...S.td, maxWidth: 200 }}>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {(c.niches_present ?? []).slice(0, 4).map(n => (
                    <span key={n} style={{ fontSize: '0.55rem', color: '#333', background: '#111', border: '1px solid #1a1a1a', borderRadius: 2, padding: '1px 4px' }}>{n}</span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ── Cluster Detail Panel (expanded row) ───────────────────────────────────────

const TITLE_MODES = ['top', 'random', 'borderline', 'outlier'];

function ClusterDetailPanel({ cluster, onSaved }) {
  const [mode,       setMode]       = useState('random');
  const [titleData,  setTitleData]  = useState(null);
  const [titleLoad,  setTitleLoad]  = useState(false);
  const [labelVal,   setLabelVal]   = useState(cluster.label_override ?? '');
  const [savingLbl,  setSavingLbl]  = useState(false);
  const [lblMsg,     setLblMsg]     = useState('');

  const color = CLUSTER_COLORS[cluster.cluster_name] ?? '#888';

  async function fetchTitles(m) {
    setTitleLoad(true);
    try {
      const r = await apiFetch(`${ROUTES.adminSemanticClusterTitles(cluster.cluster_name)}?mode=${m}&limit=20`);
      setTitleData(r);
    } catch { setTitleData(null); }
    setTitleLoad(false);
  }

  useEffect(() => { fetchTitles('random'); }, []);

  function changeMode(m) { setMode(m); fetchTitles(m); }

  async function saveLabel() {
    setSavingLbl(true); setLblMsg('');
    try {
      await apiFetch(ROUTES.adminSemanticClusterPatch(cluster.cluster_name), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label_override: labelVal.trim() || null }),
      });
      setLblMsg('Saved');
      onSaved?.();
    } catch (e) { setLblMsg(`Error: ${e.message}`); }
    setSavingLbl(false);
  }

  const overlapPairs = (cluster._separation_pairs ?? []).filter(
    p => p.a === cluster.cluster_name || p.b === cluster.cluster_name,
  );

  return (
    <div style={{ background: '#060609', padding: '16px 20px', borderTop: '1px solid #1a1a2e' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>

        {/* Seed archetype text */}
        <div>
          <div style={S.label}>Seed Archetype</div>
          <div style={{ fontSize: '0.62rem', color: '#444', lineHeight: 1.7, fontFamily: 'monospace' }}>
            {SEED_TEXTS[cluster.cluster_name] ?? cluster.cluster_name}
          </div>
        </div>

        {/* Cohesion breakdown */}
        <div>
          <div style={S.label}>Cohesion Analysis
            <HelpTip text="Cohesion = avg cosine similarity of members to centroid. Run Quality Report from the header to populate. >0.7 high, 0.5-0.7 medium, <0.5 low." />
          </div>
          {cluster.cohesion != null ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.6rem', color: '#555', width: 80 }}>Cohesion</span>
                <SimilarityBar value={cluster.cohesion} />
                <span style={{ fontSize: '0.6rem', fontFamily: 'monospace', color: '#777' }}>{cluster.cohesion.toFixed(3)}</span>
              </div>
              {cluster.outlier_rate != null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.6rem', color: '#555', width: 80 }}>Outlier rate</span>
                  <span style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: cluster.outlier_rate > 0.3 ? '#f87171' : cluster.outlier_rate > 0.15 ? '#fbbf24' : '#4ade80' }}>
                    {Math.round(cluster.outlier_rate * 100)}%
                  </span>
                  <HelpTip text="% of members with similarity > 0.15 below the cluster average. High rate = off-topic titles assigned here." />
                </div>
              )}
              {cluster.quality_flag && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.6rem', color: '#555', width: 80 }}>Quality</span>
                  <span style={S.pill(cluster.quality_flag === 'high' ? '#4ade80' : cluster.quality_flag === 'medium' ? '#fbbf24' : '#f87171')}>
                    {cluster.quality_flag}
                  </span>
                </div>
              )}
              {(cluster.example_titles ?? []).length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: '0.55rem', color: '#2a2a2a', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Example titles (centroid sample)</div>
                  {cluster.example_titles.slice(0, 3).map((t, i) => (
                    <div key={i} style={{ fontSize: '0.6rem', color: '#444', lineHeight: 1.5 }}>· {t}</div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: '0.62rem', color: '#2a2a2a' }}>No report yet — run Quality Report</div>
          )}
        </div>

        {/* Separation + label override */}
        <div>
          <div style={S.label}>Separation &amp; Identity</div>
          {overlapPairs.length > 0 ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: '0.62rem', color: '#f87171', marginBottom: 4 }}>
                ⚠ {overlapPairs.length} high-overlap pair{overlapPairs.length !== 1 ? 's' : ''}
                <HelpTip text="Cosine similarity > 0.85 between cluster centroids. Suggests these clusters may encode overlapping content patterns." />
              </div>
              {overlapPairs.map(p => (
                <div key={`${p.a}-${p.b}`} style={{ fontSize: '0.6rem', color: '#555', fontFamily: 'monospace' }}>
                  {p.a} ↔ {p.b}: {p.similarity?.toFixed(3)}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '0.6rem', color: '#2a2a2a', marginBottom: 8 }}>No high-overlap pairs</div>
          )}

          <div style={{ fontSize: '0.58rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
            Display Label Override
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              style={{ ...S.input, padding: '4px 8px', fontSize: '0.68rem', flex: 1 }}
              placeholder={cluster.cluster_name}
              value={labelVal}
              onChange={e => setLabelVal(e.target.value)}
            />
            <button style={{ ...S.btnSm, color: '#8888ff', borderColor: '#2a2a4e' }} onClick={saveLabel} disabled={savingLbl}>
              {savingLbl ? '…' : 'Save'}
            </button>
          </div>
          {lblMsg && <div style={{ fontSize: '0.6rem', color: lblMsg.startsWith('Error') ? '#f87171' : '#4ade80', marginTop: 3 }}>{lblMsg}</div>}

          {/* Performance stats */}
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: '0.6rem', color: '#333' }}>
              Avg VPH: <span style={{ color: '#aaa', fontFamily: 'monospace' }}>{cluster.avg_vph != null ? parseFloat(cluster.avg_vph).toFixed(2) : '—'}</span>
            </div>
            <div style={{ fontSize: '0.6rem', color: '#333' }}>
              Trend: <span style={{ color: TREND_COLORS[cluster.trend_direction] ?? '#555' }}>{cluster.trend_direction ?? '—'}</span>
            </div>
            <div style={{ fontSize: '0.6rem', color: '#333' }}>
              Members: <span style={{ color: '#555', fontFamily: 'monospace' }}>{cluster.sample_size ?? 0}</span>
              {cluster.seeded ? <span style={{ color: '#2a2a2a', marginLeft: 6 }}>(seeded)</span> : null}
            </div>
          </div>
        </div>
      </div>

      {/* Title samples */}
      <div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.58rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 4 }}>Title Samples</span>
          {TITLE_MODES.map(m => (
            <button
              key={m}
              style={{ ...S.btnSm, color: mode === m ? color : '#333', borderColor: mode === m ? color + '66' : '#1a1a1a' }}
              onClick={() => changeMode(m)}
            >
              {m}
            </button>
          ))}
          {titleData?.avg_centroid_similarity != null && (
            <span style={{ fontSize: '0.6rem', color: '#333', fontFamily: 'monospace', marginLeft: 8 }}>
              avg sim to centroid: {titleData.avg_centroid_similarity.toFixed(3)}
            </span>
          )}
        </div>

        {titleLoad ? (
          <div style={{ fontSize: '0.65rem', color: '#2a2a2a', padding: '8px 0' }}>Loading…</div>
        ) : !titleData || (titleData.titles ?? []).length === 0 ? (
          <div style={S.empty}>No titles in this cluster — run a clustering cycle first</div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>title</th>
                <th style={S.th}>niche</th>
                <th style={S.th}>confidence</th>
                {mode === 'top' && <th style={S.th}>vph</th>}
                {(mode === 'borderline' || mode === 'outlier') && <th style={S.th}>centroid sim</th>}
              </tr>
            </thead>
            <tbody>
              {(titleData.titles ?? []).map((t, i) => (
                <tr key={i}>
                  <td style={{ ...S.td, maxWidth: 420 }}>
                    <span style={{ color: '#999', fontSize: '0.7rem' }}>{t.title ?? t.source_id}</span>
                  </td>
                  <td style={S.td}>
                    {t.niche ? <span style={S.tag('#555')}>{t.niche}</span> : '—'}
                  </td>
                  <td style={S.td}><SimilarityBar value={t.semantic_confidence} /></td>
                  {mode === 'top' && (
                    <td style={S.td}>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: t.views_per_hour > 0 ? '#aaa' : '#333' }}>
                        {t.views_per_hour > 0 ? t.views_per_hour.toFixed(1) : '—'}
                      </span>
                    </td>
                  )}
                  {(mode === 'borderline' || mode === 'outlier') && (
                    <td style={S.td}><SimilarityBar value={t.centroid_similarity} /></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Cluster Explorer Section ───────────────────────────────────────────────────

function ClusterExplorerSection({ clusters, onReload }) {
  const [overview,  setOverview]  = useState(null);
  const [expanded,  setExpanded]  = useState(null);
  const [running,   setRunning]   = useState(false);
  const [sortKey,   setSortKey]   = useState('sample_size');
  const [msg,       setMsg]       = useState('');

  async function loadOverview() {
    try {
      const r = await apiFetch(ROUTES.adminSemanticQualityOverview);
      setOverview(r);
    } catch { setOverview(null); }
  }

  useEffect(() => { loadOverview(); }, []);

  async function runQualityReport() {
    setRunning(true); setMsg('');
    try {
      const r = await apiFetch(ROUTES.adminSemanticClusterQualityRun, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      setMsg(`Quality report done — ${r.report?.overall_quality ?? '?'} (${r.report?.total_clusters ?? 0} clusters, avg cohesion ${r.report?.avg_cohesion?.toFixed(2) ?? '?'})`);
      await loadOverview();
    } catch (e) { setMsg(`Error: ${e.message}`); }
    setRunning(false);
  }

  const sep         = overview?.separation ?? null;
  const rawClusters = (overview?.clusters ?? clusters ?? []).map(c => ({
    ...c,
    _separation_pairs: sep?.high_overlap_pairs ?? [],
  }));

  const SORT_KEYS = {
    sample_size: (a, b) => (b.sample_size ?? 0) - (a.sample_size ?? 0),
    cohesion:    (a, b) => (b.cohesion ?? -1) - (a.cohesion ?? -1),
    avg_vph:     (a, b) => (b.avg_vph ?? -1) - (a.avg_vph ?? -1),
    confidence:  (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
  };
  const sorted = [...rawClusters].sort(SORT_KEYS[sortKey] ?? SORT_KEYS.sample_size);

  function SortBtn({ k, label }) {
    return (
      <button
        style={{ ...S.btnSm, color: sortKey === k ? '#8888ff' : '#333', borderColor: sortKey === k ? '#2a2a4e' : '#1a1a1a', marginLeft: 4 }}
        onClick={() => setSortKey(k)}
      >{label}</button>
    );
  }

  // Bar chart data (same as ClusterMapSection)
  const barData = sorted
    .filter(c => c.sample_size > 0)
    .map(c => ({ name: c.cluster_name, count: c.sample_size, color: CLUSTER_COLORS[c.cluster_name] ?? '#555' }));

  return (
    <div>
      {/* Summary stats */}
      <div style={S.grid3}>
        <StatBox label="Total Clusters"  value={rawClusters.length}
          tooltip="14 pre-seeded semantic archetypes. Each grows in confidence as embeddings are assigned." />
        <StatBox label="Avg Cohesion"
          value={overview?.avg_cohesion != null ? `${Math.round(overview.avg_cohesion * 100)}%` : '—'}
          sub={overview?.last_report_at ? `Report: ${overview.last_report_at.slice(0, 16)}` : 'No report yet'}
          tooltip="Average cosine similarity of each cluster's members to its centroid. Higher = semantically tighter clusters. Run Quality Report to compute." />
        <StatBox label="Overall Quality"
          value={overview?.overall_quality ?? '—'}
          tooltip="good = no weak clusters and no high-overlap pairs. acceptable = ≤2 weak. needs_attention = more issues." />
      </div>

      {/* Separation row */}
      {sep && (
        <div style={{ fontSize: '0.62rem', color: '#444', marginBottom: 12, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span>Inter-cluster separation:&nbsp;
            <span style={{ color: sep.separation_quality === 'high' ? '#4ade80' : sep.separation_quality === 'medium' ? '#fbbf24' : '#f87171' }}>
              {sep.separation_quality}
            </span>
          </span>
          <span>Avg similarity between centroids:&nbsp;
            <span style={{ fontFamily: 'monospace', color: '#555' }}>{sep.avg_inter_cluster_similarity?.toFixed(3) ?? '—'}</span>
            <HelpTip text="Lower inter-cluster similarity = better separation between archetypes. <0.6 = high separation, 0.6-0.75 = medium, >0.75 = low (clusters may overlap)." />
          </span>
          {sep.high_overlap_pairs?.length > 0 && (
            <span style={{ color: '#f87171' }}>
              ⚠ {sep.high_overlap_pairs.length} overlapping pair{sep.high_overlap_pairs.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Boundary stability warnings */}
      {(() => {
        const warns = overview?.stability_warnings ?? [];
        if (!warns.length) return null;
        const TYPE_LABELS = {
          high_semantic_bleed:    'High Semantic Bleed',
          weak_centroid_identity: 'Weak Centroid Identity',
          cluster_instability_risk: 'Instability Risk',
        };
        return (
          <div style={{ background: '#120808', border: '1px solid #3a1010', borderRadius: 6, padding: '10px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              ⚠ Boundary Stability Warnings ({warns.length})
              <HelpTip text="high_semantic_bleed: cluster has many off-topic members (outlier rate > 30%, cohesion < 50%). weak_centroid_identity: cluster has low cohesion despite sufficient members. cluster_instability_risk: both confidence and cohesion are low." />
            </div>
            {warns.map((w, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: '0.62rem', marginBottom: 4, alignItems: 'baseline' }}>
                <span style={{ color: '#f87171', fontFamily: 'monospace', flexShrink: 0 }}>[{TYPE_LABELS[w.type] ?? w.type}]</span>
                <span style={{ color: '#555', flexShrink: 0 }}>{w.cluster}:</span>
                <span style={{ color: '#3a3a3a' }}>{w.detail}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Action row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={S.btn} onClick={runQualityReport} disabled={running}>
          {running ? 'Computing…' : '⬡ Run Quality Report'}
        </button>
        <span style={{ fontSize: '0.6rem', color: '#333' }}>Sort by:</span>
        <SortBtn k="sample_size" label="Size" />
        <SortBtn k="cohesion"    label="Cohesion" />
        <SortBtn k="avg_vph"     label="VPH" />
        <SortBtn k="confidence"  label="Confidence" />
        {msg && <span style={{ fontSize: '0.62rem', color: msg.startsWith('Error') ? '#f87171' : '#4ade80', marginLeft: 8 }}>{msg}</span>}
      </div>

      {/* Bar chart overview */}
      {barData.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={barData} margin={{ top: 2, right: 8, left: -24, bottom: 18 }}>
              <XAxis dataKey="name" tick={{ fontSize: 8, fill: '#555' }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 8, fill: '#555' }} />
              <RechartsTip
                contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.62rem', color: '#ccc' }}
                formatter={(v, n, p) => [`${v} embeddings`, p.payload.name]}
              />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {barData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Expandable cluster table */}
      <table style={S.table}>
        <thead>
          <tr>
            {['cluster', 'embeddings', 'avg vph', 'confidence', 'cohesion', 'outlier%', 'quality', 'niches', ''].map(h => (
              <th key={h} style={S.th}>{h}</th>
            ))}
          </tr>
        </thead>
        {sorted.map(c => {
          const isExp  = expanded === c.cluster_name;
          const color  = CLUSTER_COLORS[c.cluster_name] ?? '#888';
          const dispName = c.label_override || c.cluster_name;
          return (
            <tbody key={c.cluster_name}>
              <tr
                style={{ cursor: 'pointer', background: isExp ? '#0a0a12' : 'transparent' }}
                onClick={() => setExpanded(isExp ? null : c.cluster_name)}
              >
                <td style={S.td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ color, fontWeight: 600, fontSize: '0.72rem' }}>{dispName}</span>
                    {c.label_override && (
                      <span style={{ fontSize: '0.55rem', color: '#2a2a2a', fontStyle: 'italic' }}>({c.cluster_name})</span>
                    )}
                  </div>
                </td>
                <td style={S.td} align="right">
                  <span style={{ fontFamily: 'monospace', color: (c.sample_size ?? 0) > 0 ? '#aaa' : '#2a2a2a' }}>
                    {(c.sample_size ?? 0).toLocaleString()}
                  </span>
                </td>
                <td style={S.td} align="right">
                  {c.avg_vph != null ? <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#777' }}>{parseFloat(c.avg_vph).toFixed(1)}</span> : '—'}
                </td>
                <td style={S.td}><SimilarityBar value={c.confidence} /></td>
                <td style={S.td}>
                  {c.cohesion != null ? <SimilarityBar value={c.cohesion} /> : <span style={{ color: '#1a1a1a', fontSize: '0.6rem' }}>—</span>}
                </td>
                <td style={S.td}>
                  {c.outlier_rate != null
                    ? <span style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: c.outlier_rate > 0.3 ? '#f87171' : c.outlier_rate > 0.15 ? '#fbbf24' : '#4ade80' }}>
                        {Math.round(c.outlier_rate * 100)}%
                      </span>
                    : '—'}
                </td>
                <td style={S.td}>
                  {c.quality_flag && (
                    <span style={S.pill(c.quality_flag === 'high' ? '#4ade80' : c.quality_flag === 'medium' ? '#fbbf24' : '#f87171')}>
                      {c.quality_flag}
                    </span>
                  )}
                </td>
                <td style={{ ...S.td, maxWidth: 180 }}>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {(c.niches_present ?? []).slice(0, 3).map(n => (
                      <span key={n} style={{ fontSize: '0.55rem', color: '#333', background: '#111', border: '1px solid #1a1a1a', borderRadius: 2, padding: '1px 4px' }}>{n}</span>
                    ))}
                  </div>
                </td>
                <td style={{ ...S.td, textAlign: 'right', color: '#333', fontSize: '0.65rem' }}>
                  {isExp ? '▲' : '▼'}
                </td>
              </tr>
              {isExp && (
                <tr>
                  <td colSpan={9} style={{ padding: 0, borderBottom: '1px solid #1a1a2e' }}>
                    <ClusterDetailPanel
                      cluster={c}
                      onSaved={() => { loadOverview(); onReload?.(); }}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

// ── Queue Telemetry Panel ─────────────────────────────────────────────────────

function QueuePanel({ queueStatus, telemetry, queueMode, onToggleMode, onStart, onPause, busy, videoTotal }) {
  const live      = telemetry?.live    ?? {};
  const qs        = queueStatus ?? {};
  const isRunning = qs.is_running ?? false;
  const isPaused  = qs.is_paused  ?? false;
  const job       = qs.active_job ?? null;
  const pending   = videoTotal && live.total_processed != null
    ? Math.max(0, videoTotal - (live.total_processed ?? 0)) : null;

  const modePill = queueMode
    ? <span style={S.pill('#4ade80')}>● ADAPTIVE QUEUE</span>
    : <span style={S.pill('#fbbf24')}>● LEGACY MODE (100/batch)</span>;

  return (
    <div style={{ ...S.card, borderColor: queueMode ? '#1a2e1a' : '#2a2a0a' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {modePill}
          {isRunning && <span style={S.pill('#8888ff')}>RUNNING</span>}
          {isPaused  && <span style={S.pill('#fbbf24')}>PAUSED</span>}
          {!isRunning && !isPaused && queueMode && <span style={S.pill('#333')}>IDLE</span>}
        </div>
        <button
          style={S.btnSm}
          onClick={onToggleMode}
          title={queueMode ? 'Switch to legacy 100-item batch mode' : 'Switch to adaptive queue mode'}
        >
          {queueMode ? 'Switch to Legacy' : 'Switch to Queue Mode'}
        </button>
      </div>

      {/* Action buttons */}
      {queueMode ? (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <button style={S.btnGreen} onClick={onStart} disabled={busy || isRunning}>
            {busy === 'qstart' ? 'Starting…' : isRunning ? '▶ Running…' : '▶ Start Queue Ingest'}
          </button>
          {isRunning && (
            <button style={S.btnRed} onClick={onPause} disabled={busy === 'qpause'}>
              {busy === 'qpause' ? 'Pausing…' : '⏸ Pause Queue'}
            </button>
          )}
          {job && (
            <div style={{ fontSize: '0.62rem', color: '#333', alignSelf: 'center', fontFamily: 'monospace' }}>
              job: {job.id?.slice(-12)} · stage {job.stage ?? 1}
            </div>
          )}
        </div>
      ) : null}

      {/* Adaptive sizing info */}
      {queueMode && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.62rem', color: '#555' }}>
            Batch size: <span style={{ color: '#8888ff', fontWeight: 700, fontFamily: 'monospace' }}>{qs.adaptive_batch_size ?? 500}</span>
            <span style={{ color: '#333', marginLeft: 4 }}>(adaptive {qs.consecutive_success > 0 ? `+${qs.consecutive_success} streak` : ''})</span>
          </div>
          <div style={{ fontSize: '0.62rem', color: '#555' }}>
            Retry backlog: <span style={{ color: qs.queue_backlog > 0 ? '#fbbf24' : '#333', fontFamily: 'monospace' }}>{qs.queue_backlog ?? 0}</span>
          </div>
          {job?.processed_count > 0 && (
            <div style={{ fontSize: '0.62rem', color: '#555' }}>
              Job total: <span style={{ color: '#aaa', fontFamily: 'monospace' }}>{(job.processed_count ?? 0).toLocaleString()}</span>
              {job.error_count > 0 && <span style={{ color: '#f87171', marginLeft: 6 }}>{job.error_count} errors</span>}
              {job.skipped_count > 0 && <span style={{ color: '#555', marginLeft: 6 }}>{job.skipped_count} dupes skipped</span>}
            </div>
          )}
        </div>
      )}

      {/* Live metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: queueMode && (telemetry?.throughput ?? []).length > 0 ? 14 : 0 }}>
        <div style={{ background: '#0d0d12', borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ fontSize: '0.55rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Emb / min</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#8888ff', fontFamily: 'monospace' }}>{live.embeddings_per_minute ?? 0}</div>
        </div>
        <div style={{ background: '#0d0d12', borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ fontSize: '0.55rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>API Latency</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#aaa', fontFamily: 'monospace' }}>{live.avg_api_latency_ms ?? 0}ms</div>
        </div>
        <div style={{ background: '#0d0d12', borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ fontSize: '0.55rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Success Rate</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: (live.api_success_rate ?? 1) > 0.95 ? '#4ade80' : '#fbbf24', fontFamily: 'monospace' }}>
            {Math.round((live.api_success_rate ?? 1) * 100)}%
          </div>
        </div>
        <div style={{ background: '#0d0d12', borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ fontSize: '0.55rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Session Total</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#aaa', fontFamily: 'monospace' }}>{(live.total_processed ?? 0).toLocaleString()}</div>
        </div>
        <div style={{ background: '#0d0d12', borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ fontSize: '0.55rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Dupes Skipped</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#555', fontFamily: 'monospace' }}>{(live.duplicates_skipped ?? 0).toLocaleString()}</div>
        </div>
        {pending != null && (
          <div style={{ background: '#0d0d12', borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: '0.55rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Est. Remaining</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#555', fontFamily: 'monospace' }}>{pending.toLocaleString()}</div>
          </div>
        )}
      </div>

      {/* Throughput sparkline */}
      {queueMode && (telemetry?.throughput ?? []).length > 1 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: '0.55rem', color: '#222', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Throughput (1-min buckets)</div>
          <ResponsiveContainer width="100%" height={40}>
            <BarChart data={telemetry.throughput} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <Bar dataKey="processed" fill="#8888ff44" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function SemanticIntelligenceTab({ token }) {
  const [status,      setStatus]      = useState(null);
  const [coverage,    setCoverage]    = useState(null);
  const [clusters,    setClusters]    = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [busy,        setBusy]        = useState('');
  const [msg,         setMsg]         = useState('');
  const [queueStatus, setQueueStatus] = useState(null);
  const [telemetry,   setTelemetry]   = useState(null);
  const [queueMode,   setQueueMode]   = useState(true);  // false = legacy
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [st, cov, cl] = await Promise.all([
        apiFetch(ROUTES.semanticStatus).catch(() => null),
        apiFetch(ROUTES.semanticCoverage).catch(() => null),
        apiFetch(ROUTES.semanticClusters).catch(() => ({ clusters: [] })),
      ]);
      setStatus(st);
      setCoverage(cov);
      setClusters(cl?.clusters ?? []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const [qs, tel] = await Promise.all([
        apiFetch(ROUTES.adminSemanticQueue).catch(() => null),
        apiFetch(ROUTES.adminSemanticTelemetry).catch(() => null),
      ]);
      setQueueStatus(qs);
      setTelemetry(tel);
      return qs;
    } catch { return null; }
  }, []);

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const qs = await loadQueue();
      if (qs && !qs.is_running) {
        stopPolling();
        load();
      }
    }, 3000);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => { load(); loadQueue(); }, [load, loadQueue]);
  useEffect(() => () => stopPolling(), []); // cleanup on unmount

  // ── Legacy trigger (preserved as fallback) ────────────────────────────────
  async function trigger(type) {
    setBusy(type); setMsg('');
    try {
      let url;
      if (type === 'ingest')  url = ROUTES.adminSemanticIngest;
      if (type === 'cluster') url = ROUTES.adminSemanticCluster;
      if (type === 'reseed')  url = ROUTES.adminSemanticReseed;
      const r = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (type === 'ingest')  setMsg(`[Legacy] Embedded ${r.processed ?? 0} titles via ${r.provider ?? '?'} in ${r.ms ?? 0}ms`);
      if (type === 'cluster') setMsg(`Clustering done — assigned ${r.assigned ?? 0} in ${r.ms ?? 0}ms`);
      if (type === 'reseed')  setMsg(`Reseeded ${r.clusters_seeded ?? 0} clusters`);
      await load();
    } catch (e) { setMsg(`Error: ${e.message}`); }
    setBusy('');
  }

  // ── Queue ingestion ───────────────────────────────────────────────────────
  async function startQueueIngest() {
    setBusy('qstart'); setMsg('');
    try {
      const r = await apiFetch(ROUTES.adminSemanticQueueStart, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'ui_trigger' }),
      });
      if (r.ok) {
        setMsg(`Queue job started (${r.jobId?.slice(-12) ?? '?'}) — polling for updates…`);
        await loadQueue();
        startPolling();
      } else {
        setMsg(`Queue: ${r.error ?? 'start failed'}`);
      }
    } catch (e) { setMsg(`Error: ${e.message}`); }
    setBusy('');
  }

  async function pauseQueue() {
    setBusy('qpause'); setMsg('');
    try {
      await apiFetch(ROUTES.adminSemanticQueuePause, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      stopPolling();
      setMsg('Queue paused — resume by starting a new job');
      await loadQueue();
    } catch (e) { setMsg(`Error: ${e.message}`); }
    setBusy('');
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '0.68rem', color: '#333' }}>
          Semantic memory layer — embeddings, clusters, nearest-neighbor retrieval
        </div>
        <button style={S.btn} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: '0.68rem', marginBottom: 12 }}>{error}</div>}
      {msg   && <div style={{ color: '#4ade80', fontSize: '0.68rem', marginBottom: 12, padding: '6px 10px', background: '#0d1a0d', border: '1px solid #1a3a1a', borderRadius: 4 }}>{msg}</div>}

      {loading && <div style={S.empty}>Loading semantic intelligence…</div>}

      {!loading && (
        <>
          {/* Section 1: Coverage */}
          <div style={S.sectionHd}>
            Embedding Coverage
            <HelpTip text="Coverage = % of ingested titles with a stored semantic embedding. Use Adaptive Queue Mode for batch ingestion — scales from 500 to 1000 titles per cycle with automatic backoff. Legacy Batch runs 100 titles synchronously." />
          </div>
          <CoverageSection
            status={status} coverage={coverage}
            onIngest={() => trigger('ingest')}
            onCluster={() => trigger('cluster')}
            onReseed={() => trigger('reseed')}
            busy={busy}
          />

          {/* Queue + Telemetry Panel */}
          <div style={S.sectionHd}>
            Ingestion Queue &amp; Telemetry
            <HelpTip text="Adaptive queue scales batch size from 500→1000 titles per cycle. Detects rate limits and backs off automatically. Checkpoints every batch — safe to pause and resume. Legacy mode available as fallback." />
          </div>
          <QueuePanel
            queueStatus={queueStatus}
            telemetry={telemetry}
            queueMode={queueMode}
            onToggleMode={() => setQueueMode(m => !m)}
            onStart={startQueueIngest}
            onPause={pauseQueue}
            busy={busy}
            videoTotal={coverage?.total_titles ?? 0}
          />

          {/* Section 2: Nearest Neighbor Search */}
          <div style={S.sectionHd}>
            Nearest Neighbor Search
            <HelpTip text="Retrieves titles with similar structural-behavioral patterns. Clusters by hook archetype, pacing, authority level, and semantic tokens. Uses vector cosine similarity — not keyword matching." />
          </div>
          <div style={S.card}>
            <NearestNeighborSection status={status} />
          </div>

          {/* Section 3: Cluster Explorer */}
          <div style={S.sectionHd}>
            Cluster Quality Explorer
            <HelpTip text="Interactive inspection layer for all 14 semantic archetypes. Run Quality Report to compute cohesion, outlier rates, and separation scores. Click any row to expand — browse title samples by mode (top VPH, random, borderline, outlier), inspect centroid archetype, override display labels." />
          </div>
          <div style={S.card}>
            <ClusterExplorerSection clusters={clusters} onReload={load} />
          </div>

          {/* Cache stats footer */}
          <div style={{ fontSize: '0.6rem', color: '#222', marginTop: 16, textAlign: 'right' }}>
            Semantic memory · provider: {status?.provider ?? '?'} · tier {status?.semantic_tier ?? '?'} ·
            {status?.tfidf_confidence_penalty != null && ` TF-IDF penalty: ${status.tfidf_confidence_penalty}×`}
          </div>
        </>
      )}
    </div>
  );
}
