'use strict';
const express = require('express');
const router  = express.Router();

// POST /api/claude
// Body: { model, max_tokens, system, messages }
// Proxies to Anthropic — call limits enforced client-side via useTier.
router.post('/', async (req, res) => {
  const { model, max_tokens, system, messages } = req.body;
  if (!model || !messages?.length) {
    return res.status(400).json({ error: 'model and messages are required' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens, system, messages }),
    });

    const data = await r.json();
    return res.status(r.status).json(data);
  } catch {
    return res.status(502).json({ error: 'Anthropic API unreachable' });
  }
});

module.exports = router;
