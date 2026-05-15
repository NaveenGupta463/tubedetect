'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getDb } = require('../db/init');

// Clearly wrong channels inserted by findTeluguChannelIds.js search results
const REMOVE_IDS = [
  'UCNUAtHTB-flbFyvVE2LQCxQ',  // "balajitelugu" — wrong for Gemini TV query
  'UCXFf5eeGATMGxC9fzBHus2A',  // "Abbhinav" — wrong for Adhire Abhi query
  'UC-0klOOggsMcuSVihYibvkA',  // "COMEDY FUN TALKIES" — generic, not Adhire Abhi
  'UCycefOCiZ1zDczrM6iuR9xQ',  // "telugu comedy" — generic channel, not Viva Harsha
  'UCJorb7E3DKlAiSx3j0CiZpw',  // "Comedy ka Adda" — wrong
  'UCcBt2lwSJkHURAdoqLpU2dA',  // "Telugu exam world" — not Groups Exams Telugu
  'UCXUOqZI4yaRueCJNo9xwdpg',  // "NEXTGEN IAS" — wrong niche
  'UCcOxI916RtvvgO9AF7FbPyg',  // "competitive exams library" — wrong
];

const db = getDb();

let removed = 0;
for (const id of REMOVE_IDS) {
  const res = db.run('DELETE FROM discovery_seeds WHERE channel_id = ? AND language_code = ?', [id, 'te']);
  if (res.changes > 0) { console.log(`  removed ${id}`); removed++; }
  else console.log(`  skipped ${id} (not found)`);
}

const total = db.get("SELECT COUNT(*) AS n FROM discovery_seeds WHERE language_code = 'te'")?.n ?? 0;
console.log(`\nRemoved ${removed} wrong seeds. Total Telugu seeds: ${total}`);
