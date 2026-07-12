'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { runHistoricalIngestCycle } = require('../jobs/historicalIngest');

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main() {
  const quotaBudget = parseInt(arg('quota', process.env.INGEST_QUOTA_BUDGET || '2500'), 10);
  const maxChannels = parseInt(arg('channels', process.env.HISTORICAL_INGEST_MAX_CHANNELS || '150'), 10);
  const maxVideosPerChannel = parseInt(arg('videos', process.env.HISTORICAL_INGEST_MAX_VIDEOS || '100'), 10);
  const batchSize = parseInt(arg('batch', '3'), 10);
  const maxRuntimeMs = parseInt(arg('runtime-ms', process.env.HISTORICAL_INGEST_MAX_RUNTIME_MS || '1500000'), 10);
  const newestFirst = arg('newest-first', '1') !== '0';

  console.log('[historical-chunk] starting', {
    quotaBudget,
    maxChannels,
    maxVideosPerChannel,
    batchSize,
    newestFirst,
    maxRuntimeMs,
  });

  const result = await runHistoricalIngestCycle({
    quotaBudget,
    maxChannels,
    maxVideosPerChannel,
    batchSize,
    newestFirst,
    maxRuntimeMs,
  });

  console.log('[historical-chunk] result', result);
}

main().catch(err => {
  console.error('[historical-chunk] fatal:', err);
  process.exit(1);
});
