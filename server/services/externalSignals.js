'use strict';

// External freshness signals for WTP — what's timely in the REAL world, matched to a channel's
// market. This is what breaks the closed loop: the rest of the engine only knows the channel's
// own past + peers' past; this brings in trending people to book and upcoming releases to tie
// into, so recommendations can be genuinely NEW ("book X — their film drops next month") instead
// of recombinations of old uploads.
//
// Source: TMDB (movies/TV). Free key: https://www.themoviedb.org/settings/api → set TMDB_API_KEY.
// No key → returns null and callers fall back to the (free) peer-ecosystem signal.

const TMDB = 'https://api.themoviedb.org/3';

// Map our internal region tags → TMDB ISO-3166-1 market codes.
const REGION_TO_MARKET = { US: 'US', EN: 'US', GB: 'GB', CA: 'CA', AU: 'AU', IE: 'IE', NZ: 'NZ', IN: 'IN' };

async function _get(pathQ, key) {
  const sep = pathQ.includes('?') ? '&' : '?';
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  try {
    const r = await fetch(`${TMDB}${pathQ}${sep}api_key=${key}`, { signal: ac.signal });
    return r.ok ? await r.json() : null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// region: our internal tag (US/GB/IN…). limit: max items per list.
// Returns { trendingPeople:[{name,dept,knownFor[]}], upcomingReleases:[{title,date}], market }
// or null when no key / both fetches fail.
async function fetchTmdbSignals({ apiKey = process.env.TMDB_API_KEY, region = 'US', limit = 12 } = {}) {
  if (!apiKey) return null;
  const market = REGION_TO_MARKET[String(region || '').toUpperCase()] || 'US';
  const [people, upcoming] = await Promise.all([
    _get('/trending/person/week', apiKey),
    _get(`/movie/upcoming?region=${market}`, apiKey),
  ]);
  if (!people && !upcoming) return null;

  const trendingPeople = (people?.results || [])
    .filter(p => ['Acting', 'Directing'].includes(p.known_for_department))
    .slice(0, limit)
    .map(p => ({
      name: p.name,
      dept: p.known_for_department,
      knownFor: (p.known_for || []).map(k => k.title || k.name).filter(Boolean).slice(0, 2),
    }));

  const today = new Date().toISOString().slice(0, 10);
  const upcomingReleases = (upcoming?.results || [])
    .filter(m => (m.release_date || '') >= today)
    .sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''))
    .slice(0, limit)
    .map(m => ({ title: m.title, date: m.release_date }));

  return { trendingPeople, upcomingReleases, market };
}

module.exports = { fetchTmdbSignals, REGION_TO_MARKET };
