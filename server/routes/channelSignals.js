'use strict';

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const { getDb } = require('../db/init');

// ── Question definitions ──────────────────────────────────────────────────────
// These are the 3 things we can't reliably infer from data alone.
// Frontend uses GET /api/signals/questions to render the UI.

const QUESTIONS = {
  language: {
    label:   'What language do you primarily make videos in?',
    options: ['hindi', 'english', 'hinglish', 'tamil', 'telugu', 'malayalam', 'kannada', 'bengali', 'marathi', 'other'],
  },
  niche: {
    label:   "What's this channel's main topic?",
    options: [
      'technology', 'business', 'education', 'entertainment', 'gaming',
      'health', 'finance', 'lifestyle', 'science', 'sports', 'news',
      'politics', 'geopolitics', 'defence', 'food', 'travel', 'music',
      'comedy', 'fitness', 'beauty', 'yoga', 'meditation', 'philosophy', 'other',
    ],
  },
  audience_geo: {
    label:   'Who is the primary audience for this channel?',
    options: ['india', 'global_english', 'nri_diaspora', 'regional_india', 'other'],
  },
};

// One owner response outweighs 3 regular votes.
const OWNER_WEIGHT = 3;

// ── Aggregation ───────────────────────────────────────────────────────────────

function aggregateQuestion(db, channelId, questionId) {
  const rows = db.all(
    `SELECT answer, is_owner_verified, COUNT(*) as cnt
     FROM channel_signals
     WHERE channel_id = ? AND question_id = ?
     GROUP BY answer, is_owner_verified`,
    [channelId, questionId],
  );
  if (!rows.length) return null;

  const tally = {};
  let totalWeight   = 0;
  let totalResponses = 0;
  let hasOwner      = false;

  for (const row of rows) {
    const w = row.is_owner_verified ? row.cnt * OWNER_WEIGHT : row.cnt;
    tally[row.answer] = (tally[row.answer] || 0) + w;
    totalWeight    += w;
    totalResponses += row.cnt;
    if (row.is_owner_verified) hasOwner = true;
  }

  const sorted    = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const topAnswer = sorted[0][0];
  const topWeight = sorted[0][1];
  const dominance = sorted.length === 1 ? 1 : topWeight / totalWeight;

  let status;
  if (hasOwner)            status = 'verified';
  else if (topWeight >= 3) status = 'verified';
  else if (topWeight >= 2) status = 'likely';
  else                     status = 'unverified';

  // Significant split among ≥3 responses downgrades to contested
  if (!hasOwner && sorted.length > 1 && dominance < 0.6 && totalResponses >= 3) {
    status = 'contested';
  }

  return {
    answer:    topAnswer,
    status,
    responses: totalResponses,
    dominance: Math.round(dominance * 100),
    has_owner: hasOwner,
    tally:     Object.fromEntries(sorted),
  };
}

function getChannelSignals(db, channelId) {
  const result = {};
  for (const qId of Object.keys(QUESTIONS)) {
    const agg = aggregateQuestion(db, channelId, qId);
    if (agg) result[qId] = agg;
  }
  return result;
}

// ── GET /api/signals/questions ────────────────────────────────────────────────
// Returns question definitions (labels + allowed options) for the frontend.

router.get('/signals/questions', (_req, res) => {
  res.json({ ok: true, questions: QUESTIONS });
});

// ── GET /api/signals/channel/:channelId ───────────────────────────────────────
// Returns aggregated signal confidence for all questions + what our system detected,
// so the frontend can show "we detected X — did we get it right?" pre-filled.

router.get('/signals/channel/:channelId', (req, res) => {
  try {
    const db        = getDb();
    const channelId = req.params.channelId;

    const signals  = getChannelSignals(db, channelId);
    const detected = db.get(
      `SELECT niche, region, content_language, audience_geo, signal_niche
       FROM ingested_channels WHERE channel_id = ?`,
      [channelId],
    );

    // Which questions still need responses (not yet verified or likely)
    const pending = Object.keys(QUESTIONS).filter(qId => {
      const s = signals[qId];
      return !s || (s.status !== 'verified' && s.status !== 'likely');
    });

    res.json({ ok: true, channel_id: channelId, signals, detected: detected || {}, pending });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/signals/channel/:channelId ──────────────────────────────────────
// Submit one or more signal answers for a channel.
//
// Body:
//   session_id        string   required — anonymous or user session identifier
//   is_owner_verified boolean  optional — true only when caller is the channel owner via OAuth
//   answers           object   required — { language?, niche?, audience_geo? }
//
// One answer per (channel, question, session) — re-submitting updates the previous answer.

router.post('/signals/channel/:channelId', (req, res) => {
  try {
    const db        = getDb();
    const channelId = req.params.channelId;
    const { session_id, is_owner_verified = false, answers = {} } = req.body;

    if (!session_id)                  return res.status(400).json({ error: 'session_id required' });
    if (!Object.keys(answers).length) return res.status(400).json({ error: 'answers object required' });

    const results = {};

    for (const [questionId, answer] of Object.entries(answers)) {
      if (!QUESTIONS[questionId]) {
        results[questionId] = { error: 'unknown question' };
        continue;
      }
      if (!QUESTIONS[questionId].options.includes(answer)) {
        results[questionId] = { error: `invalid answer — allowed: ${QUESTIONS[questionId].options.join(', ')}` };
        continue;
      }

      db.run(
        `INSERT INTO channel_signals (id, channel_id, question_id, answer, session_id, is_owner_verified, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id, question_id, session_id)
         DO UPDATE SET answer = excluded.answer, is_owner_verified = excluded.is_owner_verified, created_at = excluded.created_at`,
        [
          crypto.randomUUID(),
          channelId, questionId, answer, session_id,
          is_owner_verified ? 1 : 0,
          new Date().toISOString(),
        ],
      );

      results[questionId] = aggregateQuestion(db, channelId, questionId);
    }

    res.json({ ok: true, channel_id: channelId, signals: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/signals/channel/:channelId/apply ────────────────────────────────
// Apply verified signals back to ingested_channels.
// Only 'verified' signals are written — 'likely' and below are left until confidence grows.
// Niche is stored in signal_niche (not overwriting our ML-detected niche) until
// admin manually promotes it.

router.post('/signals/channel/:channelId/apply', (req, res) => {
  try {
    const db        = getDb();
    const channelId = req.params.channelId;
    const signals   = getChannelSignals(db, channelId);

    const verified = Object.entries(signals).filter(([, s]) => s.status === 'verified');
    if (!verified.length) {
      return res.json({ ok: true, applied: {}, message: 'No verified signals — need more responses' });
    }

    const applied = {};
    for (const [questionId, signal] of verified) {
      if (questionId === 'language') {
        db.run(`UPDATE ingested_channels SET content_language = ? WHERE channel_id = ?`, [signal.answer, channelId]);
        applied.content_language = signal.answer;
      }
      if (questionId === 'audience_geo') {
        db.run(`UPDATE ingested_channels SET audience_geo = ? WHERE channel_id = ?`, [signal.answer, channelId]);
        applied.audience_geo = signal.answer;
      }
      if (questionId === 'niche') {
        // Stored separately — admin decides whether to promote to the primary niche field
        db.run(`UPDATE ingested_channels SET signal_niche = ? WHERE channel_id = ?`, [signal.answer, channelId]);
        applied.signal_niche = signal.answer;
      }
    }

    res.json({ ok: true, channel_id: channelId, applied });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/signals/stats ────────────────────────────────────────────────────
// Overall signal coverage stats — useful for admin dashboard.

router.get('/signals/stats', (_req, res) => {
  try {
    const db = getDb();

    const total = db.get(`SELECT COUNT(*) as cnt FROM ingested_channels WHERE ingest_enabled = 1`)?.cnt || 0;

    const byQuestion = {};
    for (const qId of Object.keys(QUESTIONS)) {
      const covered = db.get(
        `SELECT COUNT(DISTINCT channel_id) as cnt FROM channel_signals WHERE question_id = ?`,
        [qId],
      )?.cnt || 0;
      const verified = db.get(
        `SELECT COUNT(DISTINCT channel_id) as cnt
         FROM channel_signals WHERE question_id = ?
         GROUP BY channel_id
         HAVING SUM(CASE WHEN is_owner_verified = 1 THEN 3 ELSE 1 END) >= 3`,
        [qId],
      )?.cnt || 0;
      byQuestion[qId] = { covered, verified };
    }

    res.json({ ok: true, total_channels: total, by_question: byQuestion });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, getChannelSignals };
