import { generateVideoImprovements } from '../api/claude.js';

/**
 * Thin wrapper around the Claude generateVideoImprovements call.
 * Returns improvements object or null on failure.
 * No scoring logic, no envelope logic, no side effects.
 */
export async function generateImprovements(videoData, analysis) {
  return generateVideoImprovements(videoData, analysis);
}
