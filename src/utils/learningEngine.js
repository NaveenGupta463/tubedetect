import { getLearningSamples } from './learningStore';

let _cache = null;
let _lastComputed = 0;
const TTL        = 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export function getBehaviorBaselines() {
  const now = Date.now();

  if (_cache && now - _lastComputed < TTL) return _cache;

  const recent = getLearningSamples().filter(s => now - s.timestamp < THIRTY_DAYS);

  if (recent.length < 30) return null;

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = (arr, mean) =>
    Math.sqrt(arr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / arr.length);

  const commentRates = recent.map(s => s.commentRate);
  const likeRates    = recent.map(s => s.likeRate);

  const meanComment = avg(commentRates);
  const cv = std(commentRates, meanComment) / (meanComment || 1);

  // Variance guard — too noisy to trust
  if (cv > 0.8) return null;

  _cache = {
    avgCommentRate: meanComment,
    avgLikeRate:    avg(likeRates),
  };
  _lastComputed = now;

  return _cache;
}
