import { useState } from 'react';
import { generateScriptOutline } from '../api/claude';
import ProGate from './ProGate';

const TONES   = ['Educational', 'Entertaining', 'Motivational', 'Tutorial', 'Documentary', 'Conversational'];
const LENGTHS = ['5', '8', '10', '15', '20', '30'];

function ChapterCard({ chapter, index }) {
  const [open, setOpen] = useState(index === 0);
  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      borderLeft: '3px solid #7c4dff',
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: 10,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: '13px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
          <span style={{
            width: 26, height: 26, borderRadius: '50%', background: '#7c4dff22',
            color: '#7c4dff', fontWeight: 800, fontSize: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {index + 1}
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>{chapter.title}</div>
            {chapter.duration && (
              <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>⏱ {chapter.duration}</div>
            )}
          </div>
        </div>
        <span style={{ color: '#555', fontSize: 12, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '4px 16px 16px 54px', borderTop: '1px solid #222' }}>
          {chapter.talkingPoints?.map((pt, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'flex-start' }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%', background: '#2a2a2a',
                color: '#888', fontWeight: 700, fontSize: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
              }}>
                {i + 1}
              </span>
              <span style={{ fontSize: 13, color: '#ccc', lineHeight: 1.6 }}>{pt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildFullScriptText(script) {
  if (!script) return '';
  const lines = [];
  if (script.openingLine) lines.push('OPENING LINE\n' + script.openingLine);
  if (script.hookScript)  lines.push('\nHOOK SCRIPT (0:00–0:30)\n' + script.hookScript);
  if (script.chapters?.length) {
    script.chapters.forEach((ch, i) => {
      lines.push(`\nCHAPTER ${i + 1} — ${ch.title}  [${ch.duration || ''}]`);
      ch.talkingPoints?.forEach((pt, j) => lines.push(`  ${j + 1}. ${pt}`));
    });
  }
  if (script.ctaScript) lines.push('\nCTA & OUTRO\n' + script.ctaScript);
  if (script.thumbnailConcept) lines.push('\nTHUMBNAIL CONCEPT\n' + script.thumbnailConcept);
  if (script.titleOptions?.length) {
    lines.push('\nTITLE OPTIONS');
    script.titleOptions.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
  }
  return lines.join('\n');
}

export default function ScriptOutlineGenerator({ tier, canUseAI, consumeAICall, remainingCalls, onUpgrade, onNavigate }) {
  const [topic, setTopic]     = useState('');
  const [niche, setNiche]     = useState('');
  const [length, setLength]   = useState('10');
  const [tone, setTone]       = useState('Educational');
  const [cta, setCta]         = useState('Subscribe for more');
  const [script, setScript]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [copied, setCopied]   = useState(false);

  const handleGenerate = async () => {
    if (!topic.trim()) { setError('Please enter a topic.'); return; }
    if (!canUseAI()) { setError('No AI calls remaining. Upgrade for more.'); return; }
    setLoading(true);
    setError('');
    setScript(null);
    try {
      const result = await generateScriptOutline(topic, niche, length, tone, cta);
      consumeAICall();
      setScript(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    const text = buildFullScriptText(script);
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ProGate tier={tier} required="pro" onUpgrade={onUpgrade}>
      <div className="feature-page">
        <div className="feature-header">
          <h2 className="feature-title">✍️ AI Script Outline Generator</h2>
          <p className="feature-desc">
            Generate a full script with opening line, 5 chapter breakdowns, and word-for-word CTA.
            <span className="tip-badge ai-badge">AI · {remainingCalls()} calls left</span>
          </p>
        </div>

        <div className="chart-card">
          <h3 className="chart-title">Configure Your Script</h3>
          <div className="scorer-form">
            <div className="scorer-input-group">
              <label className="scorer-label">Video Topic *</label>
              <input
                className="search-filter"
                placeholder="e.g. How I grew from 0 to 100K subscribers in 6 months"
                value={topic}
                onChange={e => { setTopic(e.target.value); setError(''); }}
                style={{ flex: 1, fontSize: 14 }}
              />
            </div>
            <div className="scorer-input-group">
              <label className="scorer-label">Niche</label>
              <input
                className="search-filter"
                placeholder="e.g. YouTube growth, personal finance, fitness"
                value={niche}
                onChange={e => setNiche(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
            <div className="scorer-input-group">
              <label className="scorer-label">Target Length</label>
              <select className="search-filter" value={length} onChange={e => setLength(e.target.value)} style={{ cursor: 'pointer' }}>
                {LENGTHS.map(l => <option key={l} value={l}>{l} minutes</option>)}
              </select>
              <label className="scorer-label" style={{ marginLeft: 16 }}>Tone</label>
              <select className="search-filter" value={tone} onChange={e => setTone(e.target.value)} style={{ cursor: 'pointer' }}>
                {TONES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="scorer-input-group">
              <label className="scorer-label">CTA Goal</label>
              <input
                className="search-filter"
                placeholder="e.g. Subscribe for weekly videos, Download free checklist"
                value={cta}
                onChange={e => setCta(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn-primary" onClick={handleGenerate} disabled={loading || !topic.trim()}>
                {loading ? <><span className="btn-spinner" /> Generating…</> : '✍️ Generate Script'}
              </button>
            </div>
          </div>
          {error && <div className="search-error" style={{ marginTop: 10 }}>{error}</div>}
        </div>

        {loading && (
          <div className="ai-loading-card">
            <div className="ai-loading-icon">✍️</div>
            <div className="ai-loading-text">Writing your full script…</div>
            <div className="ai-loading-sub">TubeIntel is crafting your hook, chapters, and CTA word-for-word</div>
          </div>
        )}

        {script && (
          <>
            {/* Opening Line */}
            {script.openingLine && (
              <div className="chart-card" style={{ borderTop: '3px solid #ff9100' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 className="chart-title" style={{ marginBottom: 0 }}>🎬 Opening Line</h3>
                  <span style={{ fontSize: 11, color: '#ff9100', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Say This First</span>
                </div>
                <div style={{
                  fontSize: 17, fontWeight: 600, color: '#fff', lineHeight: 1.6,
                  padding: '14px 18px', background: '#1a1a1a', borderRadius: 10,
                  borderLeft: '4px solid #ff9100',
                }}>
                  "{script.openingLine}"
                </div>
              </div>
            )}

            {/* Hook Script */}
            {script.hookScript && (
              <div className="chart-card">
                <h3 className="chart-title">⚡ Hook Script (First 30 Seconds)</h3>
                <div style={{
                  fontSize: 13, color: '#ccc', lineHeight: 1.8,
                  padding: '14px 16px', background: '#1a1a1a', borderRadius: 10,
                  whiteSpace: 'pre-wrap',
                }}>
                  {script.hookScript}
                </div>
              </div>
            )}

            {/* Chapter Cards */}
            {script.chapters?.length > 0 && (
              <div className="chart-card">
                <div className="chart-title-row">
                  <h3 className="chart-title">📋 5 Chapter Breakdown</h3>
                  <button className="btn-small btn-primary" onClick={handleCopy}>
                    {copied ? '✅ Copied!' : '📋 Copy Full Script'}
                  </button>
                </div>
                <p className="chart-subtitle">Click any chapter to expand talking points</p>
                <div style={{ marginTop: 12 }}>
                  {script.chapters.map((ch, i) => (
                    <ChapterCard key={i} chapter={ch} index={i} />
                  ))}
                </div>
              </div>
            )}

            {/* CTA Script */}
            {script.ctaScript && (
              <div className="chart-card" style={{ borderTop: '3px solid #00c853' }}>
                <h3 className="chart-title">🎯 Word-for-Word CTA Script</h3>
                <div style={{
                  fontSize: 13, color: '#ccc', lineHeight: 1.8,
                  padding: '14px 16px', background: '#1a1a1a', borderRadius: 10,
                  whiteSpace: 'pre-wrap',
                }}>
                  {script.ctaScript}
                </div>
              </div>
            )}

            {/* Title Options + Thumbnail */}
            {(script.titleOptions?.length > 0 || script.thumbnailConcept) && (
              <div className="two-col-grid">
                {script.titleOptions?.length > 0 && (
                  <div className="chart-card">
                    <h3 className="chart-title">📌 Title Options</h3>
                    {script.titleOptions.map((t, i) => (
                      <div key={i} className="win-factor-item" style={{ cursor: 'default' }}>
                        <span className="win-factor-num">{i + 1}</span>
                        <span style={{ fontSize: 13 }}>{t}</span>
                      </div>
                    ))}
                  </div>
                )}
                {script.thumbnailConcept && (
                  <div className="chart-card">
                    <h3 className="chart-title">🖼️ Thumbnail Concept</h3>
                    <div className="ai-text-block">{script.thumbnailConcept}</div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {script && onNavigate && (
          <div style={{ marginTop: 8, textAlign: 'center' }}>
            <button
              onClick={() => onNavigate('validator', { title: script.titleOptions?.[0] || topic, niche, hook: script.hookScript || '' })}
              style={{ background: 'linear-gradient(135deg,#7c4dff,#5b2be8)', border: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}
            >
              🚀 Validate Before Publishing →
            </button>
          </div>
        )}
      </div>
    </ProGate>
  );
}
