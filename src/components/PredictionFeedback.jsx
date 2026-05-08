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

export default function PredictionFeedback({ predictionId, predictionState, confidenceState }) {
  const [label,      setLabel]      = useState(null);
  const [reason,     setReason]     = useState('');
  const [notes,      setNotes]      = useState('');
  const [submitted,  setSubmitted]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => {
    setLabel(null);
    setReason('');
    setNotes('');
    setSubmitted(false);
    setError('');
  }, [predictionId]);

  if (!predictionId) return null;

  if (submitted) {
    return (
      <div style={{
        marginTop: 16, padding: '10px 16px',
        background: '#0a1a0a', border: '1px solid #00c85333', borderRadius: 8,
        fontSize: 13, color: '#00c853',
      }}>
        Feedback saved — thank you for improving prediction accuracy.
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
        body:    JSON.stringify({
          predictionId,
          label,
          reason: reason || undefined,
          notes:  notes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setSubmitted(true);
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
            style={{
              background: '#111', color: '#ccc', border: '1px solid #333',
              borderRadius: 6, padding: '7px 10px', fontSize: 13,
            }}
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
            style={{
              background: '#111', color: '#ccc', border: '1px solid #333',
              borderRadius: 6, padding: '7px 10px', fontSize: 13,
              resize: 'vertical', fontFamily: 'inherit',
            }}
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
