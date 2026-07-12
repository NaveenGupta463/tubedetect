const { getDb, closeDb } = require('../db/init');
const { buildAndSaveChannelRuntimeSummary } = require('../services/channelRuntimeSummary');

const limit = Math.max(1, Math.min(5000, Number.parseInt(process.argv[2] || '500', 10)));
const missingOnly = !process.argv.includes('--refresh');

function main() {
  const db = getDb();
  const where = missingOnly
    ? `WHERE NOT EXISTS (
         SELECT 1 FROM channel_runtime_summary crs
         WHERE crs.channel_id = ic.channel_id
       )`
    : '';
  const rows = db.all(
    `SELECT ic.channel_id, ic.channel_name
     FROM ingested_channels ic
     ${where}
     ORDER BY ic.channel_subscribers DESC, ic.channel_name ASC
     LIMIT ?`,
    [limit],
  );

  let built = 0;
  let failed = 0;
  const errors = [];

  for (const row of rows) {
    try {
      const summary = buildAndSaveChannelRuntimeSummary(db, row.channel_id);
      if (summary) built += 1;
    } catch (err) {
      failed += 1;
      if (errors.length < 10) {
        errors.push({ channel_id: row.channel_id, channel_name: row.channel_name, error: err.message });
      }
    }
  }

  console.log(JSON.stringify({
    ok: failed === 0,
    requested_limit: limit,
    selected: rows.length,
    built,
    failed,
    missing_only: missingOnly,
    errors,
  }, null, 2));

  closeDb();
}

main();
