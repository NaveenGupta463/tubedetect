const { isChannelKnown } = require('../db/queries');

// Returns duplicate_risk level for a candidate channel ID.
// 'high'   = already in ingested_channels (would be a direct duplicate)
// 'medium' = already in discovered_channels (seen before, may be approved/rejected)
// 'none'   = never seen

function assessDuplicateRisk(db, channelId) {
  const { ingested, discovered } = isChannelKnown(db, channelId);
  if (ingested)   return 'high';
  if (discovered) return 'medium';
  return 'none';
}

// Filter a list of candidate channel IDs down to only truly new ones
function filterNewCandidates(db, channelIds) {
  return channelIds.filter(id => {
    const { ingested, discovered } = isChannelKnown(db, id);
    return !ingested && !discovered;
  });
}

module.exports = { assessDuplicateRisk, filterNewCandidates };
