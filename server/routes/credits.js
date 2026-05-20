const express = require('express');
const router  = express.Router();
const { getDb }                    = require('../db/init');
const { getOrCreate, totalBalance, PLAN_CREDITS } = require('../services/creditService');

// GET /api/credits/balance?client_id=xxx
router.get('/credits/balance', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const db   = getDb();
  const acct = getOrCreate(db, client_id);
  res.json({
    plan:     acct.plan,
    balance:  totalBalance(acct),
    credits:  acct.credits  || 0,
    rollover: acct.rollover || 0,
    topup:    acct.topup    || 0,
  });
});

// GET /api/credits/history?client_id=xxx&limit=20
router.get('/credits/history', (req, res) => {
  const { client_id, limit = 20 } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const db   = getDb();
  const rows = db.all(
    `SELECT action, amount, balance, thread_id, channel_id, meta, created_at
     FROM credit_transactions WHERE client_id = ? ORDER BY created_at DESC LIMIT ?`,
    [client_id, parseInt(limit, 10)],
  );
  res.json(rows);
});

// POST /api/credits/set-plan — change plan and replenish credits to that plan's allocation
router.post('/credits/set-plan', (req, res) => {
  const { client_id, plan } = req.body;
  if (!client_id || !plan) return res.status(400).json({ error: 'client_id and plan required' });
  if (!PLAN_CREDITS[plan]) {
    return res.status(400).json({ error: `unknown plan: ${plan}`, valid: Object.keys(PLAN_CREDITS) });
  }
  const db      = getDb();
  const acct    = getOrCreate(db, client_id);
  const credits = PLAN_CREDITS[plan];
  db.run(
    `UPDATE user_credits SET plan=?, credits=?, rollover=0, updated_at=datetime('now') WHERE client_id=?`,
    [plan, credits, client_id],
  );
  db.run(
    `INSERT INTO credit_transactions (client_id, action, amount, balance, meta) VALUES (?,?,?,?,?)`,
    [client_id, 'plan_change', credits, credits, JSON.stringify({ from: acct.plan, to: plan })],
  );
  console.log(`[credits] plan_change client=${client_id.slice(0, 8)} ${acct.plan} → ${plan} credits=${credits}`);
  res.json({ plan, balance: credits, credits });
});

module.exports = router;
