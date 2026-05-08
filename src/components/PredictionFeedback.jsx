import { useState, useEffect } from 'react';
import { ROUTES } from '../config';

const REASONS = [
  { value: 'title_weak',       label: 'Title was weak' },
  { value: 'thumbnail_weak',   label: 'Thumbnail was weak' },
  { value: 'hook_weak',        label: 'Hook was weak' },
  { value: 'niche_mismatch',   label: 'Wrong niche context' },
  { value: 'misleading_peers', label: 'Misleading peer data' },
  { value: 'trend_shift',      label: 'Trend shifted' },
  { value: 'unknown',          label: 'Unknown reason' },
];

const INPUT_STYLE = {
  width: '100%', boxSizing: 'border-box',
  background: '#111', color: '#ccc', border: '1px solid #333',
  borderRadius: 6, padding: '7px 10px', fontSize: 13,
};

export default function PredictionFeedback({ predictionId, predictionState, confidenceState }) {
  const [stage,      setStage]      = useState('feedback'); // 'feedback' | 'publish' | 'done'
  const [label,      setLabel]      = useState(null);
  const [reason,     setReason]     = useState('');
  const [notes,      setNotes]      = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');
  const [ytInput,      setYtInput]      = useState('');
  const [publishDate,  setPublishDate]  = useState('');
  const [publishing,   setPublishing]   = useState(false);
  const [publishError, setPublishError] = useState('');
  const [publishTracked, setPublishTracked] = useState(false);

  useEffect(() => {
    setStage('feedback');
    setLabel(null);
    setReason('');
    setNotes('');
    setError('');
    setYtInput('');
    setPublishDate('');
    setPublishError('');
    setPublishTracked(false);
  }, [predictionId]);

  if (!predictionId) return null;

  if (stage === 'done') {
    return (
      <div style={{
        marginTop: 16, padding: '10px 16px',
        background: '#0a1a0a', border: '1px solid #00c85333', borderRadius: 8,
        fontSize: 13, color: '#00c853',
      }}>
        {publishTracked
          ? 'Feedback and publish tracked — thank you.'
          : 'Feedback saved — thank you for improving prediction accuracy.'}
      </div>
    );
  }

  if (stage === 'publish') {
    const handlePublish = async () => {
      if (!ytInput.trim()) { setStage('done'); return; }
      setPublishing(true);
      setPublishError('');
      try {
        const res = await fetch(ROUTES.outcomesPublish, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prediction_id:    predictionId,
            youtube_video_id: ytInput.trim(),
            published_at:     publishDate
              ? new Date(publishDate).toISOString()
              : undefined,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `${res.status}`);
        }
        setPublishTracked(true);
        setStage('done');
      } catch (e) {
        setPublishError(e.message || 'Could not track publish');
      } finally {
        setPublishing(false);
      }
    };

    return (
      <div style={{
        marginTop: 20, padding: '14px 18px',
        background: '#0d0d0d', border: '1px solid #222', borderRadius: 10,
      }}>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Track publish (optional)
        </div>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Link the published YouTube video to measure prediction accuracy over time.
        </div>
        <input
          value={ytInput}
          onChange={e => setYtInput(e.target.value)}
          placeholder="YouTube URL or video ID (e.g. dQw4w9WgXcQ)"
          style={{ ...INPUT_STYLE, marginBottom: 8 }}
        />
        <input
          type="datetime-local"
          value={publishDate}
          onChange={e => setPublishDate(e.target.value)}
          title="Published at (optional)"
          style={{ ...INPUT_STYLE, marginBottom: 12, colorScheme: 'dark' }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handlePublish}
            disabled={publishing}
            style={{
              padding: '7px 20px', borderRadius: 6, border: 'none',
              background: '#7c4dff', color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: publishing ? 'not-allowed' : 'pointer', opacity: publishing ? 0.6 : 1,
            }}
          >
            {publishing ? 'Tracking…' : 'Track Publish'}
          </button>
          <button
            onClick={() => setStage('done')}
            style={{ background: 'none', border: 'none', color: '#444', fontSize: 12, cursor: 'pointer' }}
          >
            Skip
          </button>
        </div>
        {publishError && <div style={{ marginTop: 8, fontSize: 12, color: '#ff5252' }}>{publishError}</div>}
      </div>
    );
  }

  const needsReason = label === 'inaccurate' || label === 'partial';

  const handleSubmit = async () => {
    if (!label) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(ROUTES.predictionFeedback, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          predictionId,
          label,
          reason: reason || undefined,
          notes:  notes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setStage('publish');
    } catch {
      setError('Could not save feedback — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const btnBase = {
    padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
    cursor: 'pointer', border: '1px solid', transition: 'all 0.15s',
  };
  const btnStyle = (l) => {
    const active = label === l;
    const accent = l === 'accurate' ? '#00c853' : l === 'partial' ? '#ff9100' : '#ff1744';
    return {
      ...btnBase,
      background:  active ? accent + '22' : '#111',
      borderColor: active ? accent        : '#333',
      color:       active ? '#fff'        : '#666',
    };
  };

  return (
    <div style={{
      marginTop: 20, padding: '14px 18px',
      background: '#0d0d0d', border: '1px solid #222', borderRadius: 10,
    }}>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Was this prediction accurate?
        {predictionState && (
          <span style={{ marginLeft: 10, color: '#444', textTransform: 'none', letterSpacing: 0 }}>
            predicted: {predictionState}
            {confidenceState ? ` · ${confidenceState} confidence` : ''}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={btnStyle('accurate')}   onClick={() => setLabel('accurate')}>Accurate</button>
        <button style={btnStyle('partial')}    onClick={() => setLabel('partial')}>Partially Correct</button>
        <button style={btnStyle('inaccurate')} onClick={() => setLabel('inaccurate')}>Incorrect</button>
      </div>

      {needsReason && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <select
            value={reason}
            onChange={e => setReason(e.target.value)}
            style={{ background: '#111', color: '#ccc', border: '1px solid #333', borderRadius: 6, padding: '7px 10px', fontSize: 13 }}
          >
            <option value="">Select reason (optional)</option>
            {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Additional notes (optional)"
            maxLength={500}
            rows={2}
            style={{ background: '#111', color: '#ccc', border: '1px solid #333', borderRadius: 6, padding: '7px 10px', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>
      )}

      {label && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: '7px 20px', borderRadius: 6, border: 'none',
              background: '#7c4dff', color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? 'Saving…' : 'Submit Feedback'}
          </button>
          <button
            onClick={() => { setLabel(null); setReason(''); setNotes(''); }}
            style={{ background: 'none', border: 'none', color: '#444', fontSize: 12, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && <div style={{ marginTop: 8, fontSize: 12, color: '#ff5252' }}>{error}</div>}
    </div>
  );
}
