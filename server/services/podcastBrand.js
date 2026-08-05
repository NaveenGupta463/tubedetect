'use strict';

// Detect a podcast creator's OWN satellite / clip / re-upload footprint so it isn't mistaken for
// independent peer signal. Big podcasters (e.g. Raj Shamani) have many separate channel_ids —
// "<name> Clips", "<name> Insights", "Shamani Archives" — plus third-party clip channels that repost
// their episodes. All carry the SAME guest + topic the creator just published, so counting them as
// peers made WTP recommend the creator's own just-done episode back to them. The peer-pool exclusion
// (channel_id != own) only removes their MAIN channel, so we additionally filter by brand here.

const BRAND_GENERIC = new Set([
  'podcast', 'podcasts', 'show', 'shows', 'official', 'clips', 'clip', 'shorts', 'short',
  'archives', 'archive', 'insights', 'edits', 'ediits', 'ambition', 'media', 'studio', 'studios',
  'network', 'channel', 'videos', 'video', 'with', 'the', 'and', 'by', 'live',
]);

// Distinctive lowercased tokens from the creator's channel name (>=5 chars, non-generic). For
// "Raj Shamani" this yields ["shamani"] — distinctive, and present in virtually every clip/satellite
// title of his show, while "raj" (too short/common) is correctly excluded to avoid false positives.
function brandStrings(channelName) {
  return String(channelName || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 5 && !BRAND_GENERIC.has(w));
}

// True when a channel name or video title contains any of the creator's brand strings — i.e. it's the
// creator's own content echoed back, not an independent peer.
function isCreatorEcho(text, brands) {
  if (!brands || !brands.length) return false;
  const t = String(text || '').toLowerCase();
  return brands.some(b => t.includes(b));
}

module.exports = { brandStrings, isCreatorEcho };
