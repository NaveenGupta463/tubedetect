'use strict';

const { getDb } = require('../db/init');
const {
  getAllIngestedVideosForSnapshot,
  getNeverRefreshedVideosForSnapshot,
  getStaleOlderVideosForSnapshot,
} = require('../db/queries');

const db = getDb();

const oldMain = db.get(`
  SELECT COUNT(*) AS n
  FROM ingested_videos iv
  JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
  WHERE iv.published_at >= datetime('now', '-60 days')
    AND (iv.last_refreshed_at IS NULL
         OR iv.last_refreshed_at < datetime('now', '-20 hours'))
`).n;

const oldNever = db.get(`
  SELECT COUNT(*) AS n
  FROM ingested_videos iv
  JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
  WHERE iv.published_at IS NOT NULL
    AND iv.last_refreshed_at IS NULL
`).n;

const oldOlder = db.get(`
  SELECT COUNT(*) AS n
  FROM ingested_videos iv
  JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
  WHERE iv.published_at IS NOT NULL
    AND iv.last_refreshed_at IS NOT NULL
    AND (
      (iv.published_at <  datetime('now', '-60 days')
       AND iv.published_at >= datetime('now', '-365 days')
       AND iv.last_refreshed_at < datetime('now', '-60 days'))
      OR
      (iv.published_at < datetime('now', '-365 days')
       AND iv.last_refreshed_at < datetime('now', '-180 days'))
    )
`).n;

const rows = [
  {
    selector: 'main_recent',
    old: oldMain,
    new: getAllIngestedVideosForSnapshot(db).length,
  },
  {
    selector: 'never_refreshed',
    old: oldNever,
    new: getNeverRefreshedVideosForSnapshot(db).length,
  },
  {
    selector: 'older',
    old: oldOlder,
    new: getStaleOlderVideosForSnapshot(db).length,
  },
];

console.table(rows.map(r => ({ ...r, skipped: r.old - r.new })));
