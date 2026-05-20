// Haiku-powered brief extractor.
// Takes a natural language response from the creator and extracts structured brief fields.
// Returns { extracted: {field: value, ...}, missing: [field, ...], complete: bool }

const Anthropic = require('@anthropic-ai/sdk');
const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function parseBrief(creatorMessage, requiredFields) {
  if (!requiredFields?.length) return { extracted: {}, missing: [], complete: true };

  const fieldList = requiredFields.map(f => `"${f}"`).join(', ');

  const prompt = `You are extracting brief details from a YouTube creator's message for their video project.

Required fields: ${fieldList}

Creator's message:
"${creatorMessage}"

Extract whatever values you can find in the message. Return ONLY a JSON object, no prose, no markdown.
For each required field, include the value if mentioned, or null if not mentioned.

Example output:
{
  "destination": "Goa",
  "trip_duration": "5 days",
  "best_moments": "sunset at Palolem beach, the spice plantation tour, night market in Anjuna",
  "challenge_or_surprise": null,
  "mood_vibe": "relaxed and adventurous"
}

Only use the exact field names provided. Return null for fields not mentioned. Be generous in extraction — if the creator mentions something that maps to a field, extract it even if phrasing differs.`;

  let raw = '';
  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages:   [{ role: 'user', content: prompt }],
    });
    raw = response.content[0]?.text || '';
  } catch (err) {
    console.warn('[briefParser] API call failed:', err.message);
    return { extracted: {}, missing: requiredFields, complete: false };
  }

  const stripped = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
  let extracted;
  try {
    extracted = JSON.parse(stripped);
  } catch (_) {
    console.warn('[briefParser] JSON parse failed, raw:', raw.slice(0, 120));
    return { extracted: {}, missing: requiredFields, complete: false };
  }

  // Determine which required fields are still missing (null, undefined, or empty string)
  const missing = requiredFields.filter(f => {
    const v = extracted[f];
    return v === null || v === undefined || (typeof v === 'string' && !v.trim());
  });

  // Brief is complete when the first 2 required fields are filled
  const minRequired = requiredFields.slice(0, 2);
  const complete    = minRequired.every(f => {
    const v = extracted[f];
    return v !== null && v !== undefined && String(v).trim().length > 0;
  });

  return { extracted, missing, complete };
}

// Build a follow-up question for the most important missing field
function buildFollowUp(missingFields, niche) {
  const FIELD_QUESTIONS = {
    destination:           'Where is this video set?',
    trip_duration:         'How long was the trip?',
    best_moments:          'What were your top 2–3 moments from the footage?',
    challenge_or_surprise: 'Was there anything that surprised you or went wrong?',
    mood_vibe:             'What is the overall mood or vibe you want to capture?',
    topic:                 'What is the video topic?',
    angle:                 'What angle or perspective are you taking?',
    audience_level:        'Who is your target audience?',
    time_period:           'What time period does this video cover?',
    narrative_angle:       'What narrative angle are you going for?',
    premise:               'What is the core premise?',
    tone:                  'What tone are you going for?',
  };

  const field    = missingFields[0];
  const question = FIELD_QUESTIONS[field] || `Can you tell me more about "${field}"?`;
  return question;
}

module.exports = { parseBrief, buildFollowUp };
