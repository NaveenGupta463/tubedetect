import * as storage from './storage';

const STORAGE_KEY = 'content_learning_v3';

export function getLearningSamples() {
  return storage.getJSON(STORAGE_KEY) ?? [];
}

export function saveLearningSample(video) {
  if (!video?.videoId) return;

  const views = video.views || 0;
  if (views < 100) return;

  if (isNaN(video.views) || isNaN(video.likes) || isNaN(video.comments)) return;

  const existing = getLearningSamples();

  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const alreadyExists = existing.some(
    s => s.videoId === video.videoId && now - s.timestamp < SEVEN_DAYS
  );
  if (alreadyExists) return;

  const sample = {
    videoId: video.videoId,
    views,
    likeRate:       views ? (video.likes    / views) * 100 : 0,
    commentRate:    views ? (video.comments / views) * 100 : 0,
    engagementRate: views ? ((video.likes + video.comments) / views) * 100 : 0,
    categoryId: video.categoryId,
    timestamp: now,
  };

  const updated = [...existing, sample].slice(-500);
  storage.setJSON(STORAGE_KEY, updated);
}
