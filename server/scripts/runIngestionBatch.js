/**
 * One-shot ingestion batch + retrain.
 * Run once: node scripts/runIngestionBatch.js
 *
 * - Ingests all keywords with pagination
 * - Prints DB stats
 * - Triggers python ml/train_model.py
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { execSync }        = require('child_process');
const path                = require('path');
const { getDb }           = require('../db/init');
const { runIngestCycle }  = require('../jobs/youtubeIngest');

const TRAIN_SCRIPT = path.join(__dirname, '../../ml/train_model.py');

async function main() {
  console.log('=== INGESTION BATCH START ===\n');

  // Run ingestion
  const result = await runIngestCycle();

  // DB stats
  const db = getDb();
  const { total_videos }      = db.get('SELECT COUNT(*) AS total_videos FROM videos');
  const { total_ready }       = db.get('SELECT COUNT(*) AS total_ready FROM performance_metrics WHERE training_ready=1');
  const { total_predictions } = db.get('SELECT COUNT(*) AS total_predictions FROM predictions');

  const pct_real = total_videos > 0 ? ((total_ready / total_videos) * 100).toFixed(1) : 0;

  console.log('\n=== DB STATS AFTER INGESTION ===');
  console.log(`total_videos      : ${total_videos}`);
  console.log(`training_ready    : ${total_ready} (${pct_real}% of total)`);
  console.log(`manual_predictions: ${total_predictions}`);

  if (total_ready < 10) {
    console.log('\nNot enough training_ready rows to retrain (need >= 10). Done.');
    return;
  }

  // Retrain
  console.log('\n=== RETRAINING ML MODEL ===');
  try {
    const output = execSync(`python "${TRAIN_SCRIPT}"`, { encoding: 'utf8' });
    console.log(output.trim());
  } catch (e) {
    console.error('Training failed:', e.stderr || e.message);
  }

  console.log('\n=== BATCH COMPLETE ===');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
