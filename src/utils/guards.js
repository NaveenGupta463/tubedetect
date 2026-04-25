/**
 * Returns true only for real, non-NaN numbers.
 * Avoids JS coercion bugs from the global isNaN().
 */
export const isValidNumber = (s) => typeof s === 'number' && !Number.isNaN(s);

/**
 * Converts a score into a tri-state weakness flag.
 *   valid number  → boolean (score < 60)
 *   missing / NaN → null   (projection not available — do not assume weak or strong)
 */
export const getWeakness = (score) => {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return null; // unknown
  }
  return score < 60;
};
