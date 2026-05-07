require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb }  = require('../db/init');
const OpenAI     = require('openai');

const MODEL = 'text-embedding-3-small';
const MAX_RETRIES = 3;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function embed(text, attempt = 1) {
  try {
    const res = await openai.embeddings.create({ model: MODEL, input: text });
    return res.data[0].embedding;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      console.warn(`  Retry ${attempt}/${MAX_RETRIES - 1}:`, err.message);
      await new Promise(r => setTimeout(r, 1500 * attempt));
      return embed(text, attempt + 1);
    }
    throw err;
  }
}

async function backfill() {
  const db = getDb();

  const missing = db.all(`
    SELECT v.id, v.title, v.hook, v.niche
    FROM videos v
    LEFT JOIN embeddings e ON v.id = e.video_id
    WHERE e.video_id IS NULL
    ORDER BY v.id
  `);

  if (missing.length === 0) {
    console.log('No missing embeddings — already fully synced.');
    return;
  }

  console.log(`Backfilling ${missing.length} missing embeddings...\n`);

  let succeeded = 0;
  let failed    = 0;

  for (const video of missing) {
    process.stdout.write(`  #${video.id} [${video.niche}] "${video.title.slice(0, 50)}"... `);
    try {
      const input  = `${video.title} ${video.hook ?? ''} ${video.niche}`;
      const vector = await embed(input);
      db.run(
        'INSERT OR REPLACE INTO embeddings (video_id, vector, created_at) VALUES (?, ?, ?)',
        [video.id, JSON.stringify(vector), new Date().toISOString()],
      );
      console.log('OK');
      succeeded++;
    } catch (err) {
      console.log('FAILED —', err.message);
      failed++;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nBackfill complete: ${succeeded} succeeded, ${failed} failed.`);

  const { total_videos }     = db.get('SELECT COUNT(*) AS total_videos FROM videos');
  const { total_embeddings } = db.get('SELECT COUNT(*) AS total_embeddings FROM embeddings');

  console.log(`\nVideos:     ${total_videos}`);
  console.log(`Embeddings: ${total_embeddings}`);

  if (total_embeddings === total_videos) {
    console.log('\nEMBEDDINGS FULLY SYNCED');
  } else {
    console.log(`\nStill missing: ${total_videos - total_embeddings} embeddings. Re-run to retry.`);
  }
}

backfill().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
