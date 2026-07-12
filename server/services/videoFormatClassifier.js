'use strict';

const SHORT_TEXT_RE = /(^|[\s#])(?:shorts?|shortvideo|shortsvideo|youtubeshorts|ytshorts|reels?)(?=$|[\s#.,!_-])/i;

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function classifyVideoFormat({
  title = '',
  description = '',
  duration_seconds = null,
  thumbnail_width = null,
  thumbnail_height = null,
} = {}) {
  const duration = asNumber(duration_seconds);
  const width = asNumber(thumbnail_width);
  const height = asNumber(thumbnail_height);
  const aspect = width && height ? width / height : null;
  const verticalThumbnail = aspect != null && aspect < 0.85;
  const shortText = SHORT_TEXT_RE.test(`${title || ''} ${description || ''}`);

  if (!duration) {
    return {
      format_type: 'unknown',
      format_confidence: 'low',
      format_reason: 'missing_duration',
    };
  }

  if (duration <= 60) {
    return {
      format_type: 'short_form',
      format_confidence: shortText || verticalThumbnail ? 'high' : 'medium',
      format_reason: [
        'duration_lte_60',
        shortText ? 'short_text_signal' : null,
        verticalThumbnail ? 'vertical_thumbnail' : null,
      ].filter(Boolean).join('+'),
    };
  }

  if (duration <= 180) {
    if (shortText || verticalThumbnail) {
      return {
        format_type: 'likely_short_form',
        format_confidence: shortText && verticalThumbnail ? 'high' : 'medium',
        format_reason: [
          'duration_lte_180',
          shortText ? 'short_text_signal' : null,
          verticalThumbnail ? 'vertical_thumbnail' : null,
        ].filter(Boolean).join('+'),
      };
    }
    return {
      format_type: 'unknown',
      format_confidence: 'low',
      format_reason: 'duration_lte_180_no_short_signal',
    };
  }

  return {
    format_type: 'long_form',
    format_confidence: duration >= 600 ? 'high' : 'medium',
    format_reason: duration >= 600 ? 'duration_gte_600' : 'duration_gt_180',
  };
}

function pickBestThumbnail(thumbnails = {}) {
  const order = ['maxres', 'standard', 'high', 'medium', 'default'];
  for (const key of order) {
    const t = thumbnails?.[key];
    if (t?.url) {
      const width = asNumber(t.width);
      const height = asNumber(t.height);
      return {
        thumbnail_url: t.url,
        thumbnail_width: width,
        thumbnail_height: height,
        thumbnail_aspect_ratio: width && height ? Number((width / height).toFixed(4)) : null,
      };
    }
  }
  return {
    thumbnail_url: null,
    thumbnail_width: null,
    thumbnail_height: null,
    thumbnail_aspect_ratio: null,
  };
}

function isShortSignal(formatType) {
  return formatType === 'short_form' || formatType === 'likely_short_form';
}

module.exports = {
  classifyVideoFormat,
  pickBestThumbnail,
  isShortSignal,
};
