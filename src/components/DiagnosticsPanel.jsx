import { useState, useEffect, useCallback } from 'react';
import { BACKEND_URL, SCORING_URL, ROUTES, IS_DEV } from '../config';
import { logger } from '../utils/logger';
import { getPerfReport } from '../utils/perf';
import { isElectron, getElectronAppInfo } from '../api/ipc';

const REFRESH_MS = 30_000;

async function safeFetch(url, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    return { ok: r.ok, status: r.status, data: r.ok ? await r.json() : null };
  } catch (e) {
    clearTimeout(id);
    return { ok: false, status: null, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

function StatusDot({ ok }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: ok === true ? '#22c55e' : ok === false ? '#ef4444' : '#666',
      flexShrink: 0, marginRight: 6,
    }} />
  );
}

function Card({ title, children }) {
  return (
    <div style={{
      background: '#111', border: '1px solid #222', borderRadius: 8,
      padding: '14px 16px', marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, ok }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5, fontSize: 13 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', color: '#ccc', fontFamily: 'monospace', fontSize: 12 }}>
        {ok !== undefined && <StatusDot ok={ok} />}
        {value}
      </span>
    </div>
  );
}

export default function DiagnosticsPanel() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [elapsed, setElapsed] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const t0 = performance.now();

    const [backend, scoring, dbHealth, dbStats, metrics, electronInfo] = await Promise.all([
      safeFetch(`${BACKEND_URL}/health`),
      safeFetch(`${SCORING_URL}/health`),
      safeFetch(ROUTES.dbHealth),
      safeFetch(ROUTES.dbStats),
      safeFetch(ROUTES.metrics),
      getElectronAppInfo(),
    ]);

    const mem = performance.memory ?? null;

    setData({
      backend,
      scoring,
      dbHealth:     dbHealth.data,
      dbStats:      dbStats.data,
      metrics:      metrics.data,
      electronInfo,
      mem,
      errors:       logger.getErrors().slice(-20).reverse(),
      perf:         getPerfReport(),
    });
    setElapsed(+(performance.now() - t0).toFixed(0));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const electron = isElectron();

  return (
    <div className="feature-page">
      <div className="feature-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 className="feature-title">🔬 Diagnostics</h2>
          <p className="feature-desc">Runtime health, service status, and error log.</p>
        </div>
        <button className="btn-small btn-primary" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing…' : `Refresh${elapsed ? ` (${elapsed}ms)` : ''}`}
        </button>
      </div>

      {/* Runtime */}
      <Card title="Runtime">
        <Row label="Electron"  value={electron ? 'yes' : 'no'} ok={electron} />
        <Row label="Mode"      value={IS_DEV ? 'development' : 'production'} />
        <Row label="User agent" value={navigator.userAgent.slice(0, 60) + '…'} />
        {data?.electronInfo && <>
          <Row label="Electron version"  value={data.electronInfo.electronVersion} />
          <Row label="Chrome version"    value={data.electronInfo.chromeVersion} />
          <Row label="Node version"      value={data.electronInfo.nodeVersion} />
          <Row label="Startup time"      value={`${data.electronInfo.uptime}ms since launch`} />
          <Row label="Log file"          value={data.electronInfo.logPath ?? 'n/a'} />
        </>}
      </Card>

      {/* Services */}
      <Card title="Services">
        <Row label="Backend (3001)"       value={data?.backend?.ok  ? 'online' : (data?.backend?.error ?? 'offline')}  ok={data?.backend?.ok} />
        <Row label="Scoring server (3002)" value={data?.scoring?.ok ? 'online' : (data?.scoring?.error ?? 'offline')} ok={data?.scoring?.ok} />
        <Row label="SQLite integrity"      value={data?.dbHealth?.status ?? '—'}                                        ok={data?.dbHealth?.status === 'ok'} />
      </Card>

      {/* Database */}
      {data?.dbStats && (
        <Card title="Database">
          {Object.entries(data.dbStats.counts ?? {}).map(([t, n]) => (
            <Row key={t} label={t} value={n === null ? 'n/a' : String(n)} />
          ))}
          {data.dbStats.size_bytes != null && (
            <Row label="File size" value={`${(data.dbStats.size_bytes / 1024).toFixed(1)} KB`} />
          )}
        </Card>
      )}

      {/* Scoring cache */}
      {data?.metrics && (
        <Card title="Scoring Cache">
          <Row label="Total lookups"  value={String(data.metrics.total ?? '—')} />
          <Row label="DB hits"        value={String(data.metrics.db_hits ?? '—')} />
          <Row label="API calls"      value={String(data.metrics.api_calls ?? '—')} />
          <Row label="DB hit rate"    value={`${data.metrics.db_hit_pct ?? 0}%`} ok={data.metrics.db_hit_pct > 50} />
          <Row label="Refreshes"      value={String(data.metrics.refreshes ?? '—')} />
        </Card>
      )}

      {/* Memory */}
      {data?.mem && (
        <Card title="Memory (JS Heap)">
          <Row label="Used"  value={`${(data.mem.usedJSHeapSize  / 1048576).toFixed(1)} MB`} />
          <Row label="Total" value={`${(data.mem.totalJSHeapSize / 1048576).toFixed(1)} MB`} />
          <Row label="Limit" value={`${(data.mem.jsHeapSizeLimit / 1048576).toFixed(1)} MB`} ok={data.mem.usedJSHeapSize / data.mem.jsHeapSizeLimit < 0.8} />
        </Card>
      )}

      {/* Perf timings */}
      {data?.perf && Object.keys(data.perf).length > 0 && (
        <Card title="Performance Timings">
          {Object.entries(data.perf).map(([k, v]) => (
            <Row key={k} label={k} value={`${v}ms`} ok={v < 2000} />
          ))}
        </Card>
      )}

      {/* DB backup */}
      <Card title="Data Export">
        <button
          className="btn-small btn-primary"
          style={{ marginRight: 8 }}
          onClick={async () => {
            const r = await safeFetch(ROUTES.dbBackup);
            if (!r.ok) return;
            const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `tubeintel-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          Export Workspaces (JSON)
        </button>
        <span style={{ fontSize: 12, color: '#555' }}>Downloads workspace backup from SQLite</span>
      </Card>

      {/* Recent errors */}
      <Card title={`Recent Errors (${data?.errors?.length ?? 0})`}>
        {!data?.errors?.length ? (
          <div style={{ color: '#22c55e', fontSize: 13 }}>No errors logged.</div>
        ) : (
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {data.errors.map((e, i) => (
              <div key={i} style={{
                background: '#1a0a0a', border: '1px solid #2a1a1a', borderRadius: 4,
                padding: '6px 10px', marginBottom: 5, fontSize: 11, fontFamily: 'monospace',
              }}>
                <span style={{ color: '#666' }}>{new Date(e.ts).toLocaleTimeString()} </span>
                <span style={{ color: '#f87171', fontWeight: 700 }}>[{e.category}] </span>
                <span style={{ color: '#ccc', wordBreak: 'break-all' }}>{e.msg}</span>
              </div>
            ))}
          </div>
        )}
        {data?.errors?.length > 0 && (
          <button
            className="btn-small"
            style={{ marginTop: 8 }}
            onClick={() => { logger.clear(); refresh(); }}
          >
            Clear Log
          </button>
        )}
      </Card>
    </div>
  );
}
