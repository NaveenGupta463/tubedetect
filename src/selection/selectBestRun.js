/**
 * Sorts runs by projected score (descending) and splits into best + variations.
 *
 * Input:
 *   runs         — [{ projectedScore, improvements }] — unsorted
 *   maxVariations — max number of alternative runs to return (cap: 5)
 *
 * Output:
 *   { best, variations }
 *   best       — run with highest projected score
 *   variations — next N runs by score, up to maxVariations
 */
export function selectBestRun(runs, maxVariations) {
  const sorted = [...runs].sort((a, b) => b.projectedScore - a.projectedScore);
  return {
    best:       sorted[0],
    variations: sorted.slice(1, 1 + maxVariations),
  };
}
