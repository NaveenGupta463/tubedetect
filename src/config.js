// Central config — all URLs, ports, and env-dependent values live here.
// Components and services import from this file, never from import.meta.env directly.
// In Electron: replace BACKEND_URL / SCORING_URL with IPC channel names in this file only.

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
export const SCORING_URL = import.meta.env.VITE_SCORING_URL || 'http://localhost:3002';

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Claude model used for all frontend-initiated AI calls
export const CLAUDE_MODEL = 'claude-sonnet-4-6';
export const IS_DEV = import.meta.env.DEV ?? false;

// YouTube cache TTL
export const YT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Scoring server cache TTL (in-memory, server-side — mirrored here for client awareness)
export const SCORE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// API route paths (change once here if routes move)
export const ROUTES = {
  // Backend (3001)
  claude:    `${BACKEND_URL}/api/claude`,
  youtube:   `${BACKEND_URL}/api/youtube`,
  authGoogle: `${BACKEND_URL}/api/auth/google`,
  userMe:    `${BACKEND_URL}/api/user/me`,
  userTier:  `${BACKEND_URL}/api/user/tier`,

  // Scoring server (3002)
  analyze:   `${SCORING_URL}/api/analyze`,
  lookup:    `${SCORING_URL}/api/lookup`,
  explain:   `${SCORING_URL}/api/explain`,
  metrics:    `${SCORING_URL}/api/metrics`,
  modelStatus: `${SCORING_URL}/api/model/status`,
  results:    (id) => `${SCORING_URL}/api/results/${id}`,
  workspaces: `${SCORING_URL}/api/workspaces`,
  workspace:  (id) => `${SCORING_URL}/api/workspaces/${id}`,
  dbHealth:          `${SCORING_URL}/api/db/health`,
  dbStats:           `${SCORING_URL}/api/db/stats`,
  dbBackup:          `${SCORING_URL}/api/db/backup`,
  predictionFeedback:    `${SCORING_URL}/api/prediction-feedback`,
  outcomesRefresh:       `${SCORING_URL}/api/outcomes/refresh`,
  outcomesPublish:       `${SCORING_URL}/api/outcomes/publish`,
  outcomesVideoRefresh:  `${SCORING_URL}/api/outcomes/video-refresh`,
  learningReport:        `${SCORING_URL}/api/learning/report`,
};
