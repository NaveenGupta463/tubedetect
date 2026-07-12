const assert = require('assert');
const { getDb, closeDb } = require('../db/init');
const {
  buildAndSaveChannelRuntimeSummary,
  readChannelRuntimeSummary,
} = require('../services/channelRuntimeSummary');

const CHANNEL_ID = process.argv[2] || 'UCA295QVkf9O1RQ8_-s3FVXg';

function main() {
  const db = getDb();
  const built = buildAndSaveChannelRuntimeSummary(db, CHANNEL_ID);
  assert(built, 'summary should be built for known channel');
  assert.strictEqual(built.channel_id, CHANNEL_ID, 'summary channel id should match');
  assert(built.channel_name, 'summary should include channel name');
  assert(built.video_count >= 0, 'summary should include video count');
  assert(built.primary_csp || built.format_profile || built.creator_mode, 'summary should include profile metadata when available');

  const read = readChannelRuntimeSummary(db, CHANNEL_ID);
  assert(read, 'summary should be readable from compact table');
  assert.strictEqual(read.channel_id, CHANNEL_ID, 'read summary channel id should match');
  assert(Array.isArray(read.top_territories), 'top territories should decode as an array');

  console.log(JSON.stringify({
    ok: true,
    channel_id: CHANNEL_ID,
    channel_name: read.channel_name,
    video_count: read.video_count,
    primary_csp: read.primary_csp,
    format_profile: read.format_profile,
    creator_mode: read.creator_mode,
    territory_count: read.territory_count,
    wtp_cache_status: read.wtp_cache_status,
  }, null, 2));

  closeDb();
}

main();
