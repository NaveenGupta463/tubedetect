'use strict';

const DNA_VERSION = 1;

function sizeTier(subs) {
  if (!subs || subs < 1000)     return 'nano';
  if (subs < 50_000)            return 'micro';
  if (subs < 200_000)           return 'mid';
  if (subs < 1_000_000)         return 'macro';
  return 'mega';
}

function uploadCadenceLabel(avgPerMonth) {
  if (avgPerMonth === null)  return 'unknown';
  if (avgPerMonth > 25)      return 'daily';
  if (avgPerMonth > 8)       return 'multiple_weekly';
  if (avgPerMonth >= 3)      return 'weekly';
  if (avgPerMonth >= 1)      return 'biweekly';
  if (avgPerMonth >= 0.25)   return 'monthly';
  return 'irregular';
}

function analyzeTitles(titles) {
  if (!titles.length) return { avg_title_length: null, title_uses_numbers_pct: null, title_uses_questions_pct: null, title_uses_caps_pct: null };

  const NUMBER_RE   = /\d/;
  const QUESTION_RE = /\?/;
  const CAPS_RE     = /\b[A-Z]{2,}\b/;

  let totalLen = 0, numbers = 0, questions = 0, caps = 0;
  for (const t of titles) {
    totalLen  += t.length;
    if (NUMBER_RE.test(t))   numbers++;
    if (QUESTION_RE.test(t)) questions++;
    if (CAPS_RE.test(t))     caps++;
  }

  const n = titles.length;
  return {
    avg_title_length:         Math.round(totalLen / n),
    title_uses_numbers_pct:   Math.round((numbers  / n) * 100) / 100,
    title_uses_questions_pct: Math.round((questions / n) * 100) / 100,
    title_uses_caps_pct:      Math.round((caps      / n) * 100) / 100,
  };
}

function computeUploadCadence(publishedDates) {
  const valid = publishedDates
    .filter(Boolean)
    .map(d => new Date(d).getTime())
    .filter(t => !isNaN(t))
    .sort((a, b) => a - b);

  if (valid.length < 2) return { avg_uploads_per_month: null, upload_cadence: 'unknown' };

  const spanMs    = valid[valid.length - 1] - valid[0];
  const spanMonths = spanMs / (1000 * 60 * 60 * 24 * 30.44);
  if (spanMonths < 0.5) return { avg_uploads_per_month: null, upload_cadence: 'unknown' };

  const avg = Math.round((valid.length / spanMonths) * 10) / 10;
  return { avg_uploads_per_month: avg, upload_cadence: uploadCadenceLabel(avg) };
}

function primaryLanguageFromProfile(languageProfileJson) {
  try {
    const p = JSON.parse(languageProfileJson ?? '{}');
    return p.primary_language ?? p.language ?? null;
  } catch {
    return null;
  }
}

function computeCreatorDNA(channel, videos) {
  const titles       = videos.map(v => v.title).filter(Boolean);
  const publishDates = videos.map(v => v.published_at);
  const views        = videos.map(v => v.views ?? 0).filter(v => v > 0);

  const cadence      = computeUploadCadence(publishDates);
  const titleStats   = analyzeTitles(titles);

  const avgViewsPerVideo = views.length
    ? Math.round(views.reduce((s, v) => s + v, 0) / views.length)
    : null;

  const subs  = channel.subscriber_count ?? 0;
  const vPerV = avgViewsPerVideo;
  const viewToSubRatio = subs > 0 && vPerV !== null
    ? Math.round((vPerV / subs) * 100) / 100
    : null;

  const lang = primaryLanguageFromProfile(channel.language_profile)
    ?? channel.language
    ?? 'en';

  return {
    dna_version:              DNA_VERSION,
    computed_at:              new Date().toISOString(),
    computed_from_n_videos:   videos.length,

    size_tier:                sizeTier(subs),
    subscriber_count:         subs,
    video_count:              channel.video_count ?? null,

    upload_cadence:           cadence.upload_cadence,
    avg_uploads_per_month:    cadence.avg_uploads_per_month,

    avg_title_length:         titleStats.avg_title_length,
    title_uses_numbers_pct:   titleStats.title_uses_numbers_pct,
    title_uses_questions_pct: titleStats.title_uses_questions_pct,
    title_uses_caps_pct:      titleStats.title_uses_caps_pct,

    avg_views_per_video:      avgViewsPerVideo,
    view_to_sub_ratio:        viewToSubRatio,

    primary_language:         lang,
    niche:                    channel.niche ?? null,
  };
}

module.exports = { computeCreatorDNA };
