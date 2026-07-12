# DNA Score Normalization Audit

**Date:** 2026-06-14  
**Status:** P0 fix required — applied in this session

---

## 1. Score Merge Points Inventory

### 1.1 `computeConceptAffinity()` — conceptNormalizer.js

| Field | Scale | Location | Used for |
|---|---|---|---|
| `affinity_score` | **0.0–1.0 float** | return value | DNA × concept signal strength |

Formula: `matched_signals / total_concept_signals`. Returns 0.0 for no match, 1.0 for full match.

**Issue:** This 0–1 float is written to `wtp_generation_traces.dna_affinity_score` for DNA bets. When sorted alongside peer/angle rows that use the same column for 0–100 integers, the comparison breaks.

---

### 1.2 `scoreForIdea()` / `makeIdea()` — originalBets.js

| Field | Scale | Location | Used for |
|---|---|---|---|
| `scoreForIdea()` result | **45–72 integer** | `originalBets.js:1620` | Base DNA bet score |
| `makeIdea()` final `score` | **45–72 integer** | `originalBets.js:1634–1636` | Final DNA bet ranking score |

Formula: `max(45, min(72, round(base * 0.45 + quality * 0.55)))` where base = 58/62/68 depending on archetype.

**Scale status:** ✓ Correct — 45–72 is within the 0–100 unified scale used by all other sources.

**Stored in trace:** ✗ NOT stored. The trace only stores `dna_affinity_score` (the 0–1 concept affinity), not the actual `score` (45–72) used for ranking.

---

### 1.3 WTP opportunity score — whatToPost.js

| Field | Scale | Location | Used for |
|---|---|---|---|
| Gap score (`score`) | **1–99 integer** | `whatToPost.js:3170` | angle_gap and peer_video_signal raw score |
| `creator_fit_score` | **0–100 integer** | `creatorFitScore.js:80` | Creator × topic alignment |
| `fit_weight` | **0.2–1.0 float** | `creatorFitScore.js:197` | Multiplier applied to score |
| Final `idea.score` | **1–99 integer** | `whatToPost.js:3614` | Post-fit-weight ranking score |

Formula: `idea.score = round(idea.score * effectiveFitWeight)` where `effectiveFitWeight = max(0.85, fit_weight)` for sparse-DNA channels.

**Scale status:** ✓ Correct — 1–99 is within the 0–100 scale.

**Stored in trace:** ✗ WRONG. `whatToPost.js:3655` stores `creator_fit_score` (0–100) in `dna_affinity_score` column. The actual post-fit `idea.score` is never written.

---

### 1.4 `wtp_generation_traces.dna_affinity_score` — THE MISMATCH COLUMN

| Source | What is stored | Actual scale |
|---|---|---|
| `dna_original_bets` | `computeConceptAffinity().affinity_score` | **0.0–1.0 float** |
| `peer_video_signal` | `creator_fit_score` (from `creatorFitScore.js`) | **0–100 integer** |
| `angle_gap` | `creator_fit_score` (from `creatorFitScore.js`) | **0–100 integer** |

**Root cause of ranking inversion in gold set:**  
`wtpHumanQualityAudit.js` seeds `top_ranked_100` with `ORDER BY dna_affinity_score DESC`.  
- angle_gap row: `dna_affinity_score = 88` (creator_fit_score)  
- DNA bet row: `dna_affinity_score = 0.88` (concept affinity)  
- Result: angle_gap always ranks above DNA bets, even though DNA bets have 50% positive rate vs 0% for angle_gap.

---

## 2. User-Facing Impact Assessment

| Stream | Streams merged? | Inversion affect users? |
|---|---|---|
| `original_bets` vs `ideas` | ✗ Separate API keys, not sorted together | No — streams shown independently |
| Within `ideas` stream (angle_gap vs peer_video_signal) | ✓ Sorted together by `score` | **YES** — angle_gap (avg 84.7) always beats peer (avg 76.9) |

**User-visible inversion:** Within the `ideas` stream, angle_gap keyword dumps (0% positive rate, avg score 84.7) consistently rank above peer_video_signal ideas (45.7% positive rate, avg score 76.9). The gap score formula rewards "how many peers haven't covered this topic" — it counts frequency gaps, not title quality.

---

## 3. P0 Fix Applied — `wtp_score` column

### Schema change — `db/init.js`

```sql
ALTER TABLE wtp_generation_traces ADD COLUMN wtp_score INTEGER
```

This column stores the **actual WTP ranking score** for every trace:
- DNA bets: the `makeIdea()` score (45–72 integer)
- Peer/angle: the post-fit-weight `idea.score` (1–99 integer)
- Both are on the same 0–100 scale — no conversion needed

### originalBets.js changes

- `makeIdea()` `_generation_trace`: Added `wtp_score: score` (the 45–72 integer)
- Trace INSERT: Added `wtp_score` column; bound to `t.wtp_score ?? null`

### whatToPost.js changes

- Trace INSERT: `dna_affinity_score` fixed to `null` for peer/angle rows (stops storing creator_fit_score there)
- Trace INSERT: Added `wtp_score` column bound to `_idea.score` (post-fit-weight integer)

### wtpHumanQualityAudit.js changes

- All batch queries updated to use `COALESCE(wtp_score, ...)` for the `score` alias and `ORDER BY`
- Fallback for legacy rows: `CASE WHEN dna_affinity_score > 2 THEN CAST(dna_affinity_score AS INTEGER) ELSE CAST(dna_affinity_score * 100 AS INTEGER) END`
  - Rows with `dna_affinity_score > 2` are peer/angle rows (creator_fit_score misuse) → used as-is
  - Rows with `dna_affinity_score <= 2` are DNA bets (0–1 affinity) → multiplied by 100

---

## 4. Score Scale Summary (Post-Fix)

| Source | Score field | Scale | Stored in wtp_score | Stored in dna_affinity_score |
|---|---|---|---|---|
| `dna_original_bets` | `makeIdea().score` | 45–72 int | ✓ Yes | Concept affinity (0–1 float) |
| `peer_video_signal` | `score * fit_weight` | 1–79 int | ✓ Yes | null (fixed from creator_fit_score) |
| `angle_gap` | `score * fit_weight` | 1–99 int | ✓ Yes | null (fixed from creator_fit_score) |
| `territory_expansion` | `score` | 0–99 int | ✓ Yes (on next trace write) | null |

---

## 5. Second-Order Inversion (not fixed by P0 alone)

After P0 fix (scale normalization), the ranking would be:
- angle_gap avg = 84.7 (formula rewards topic frequency gap)
- peer_video_signal avg = 76.9
- DNA bets avg = ~62 (45–72 range)

**angle_gap still outscores peer_video_signal by ~8 points after normalization.** The gap score formula is designed to find undercovered topics — it rewards HOW MANY peers haven't covered the topic, not whether the topic is filmable.

**Fix:** P1 quality floor (see `angle_gap_quality_floor_report.md`) — applied in same session.

---

## 6. Success Criteria

After P0 + P1 fixes, re-run `wtpRankingInversionAudit.js`. Targets:

| Metric | Before | Target |
|---|---|---|
| Ranking correlation Pearson r | −0.372 | > +0.30 |
| Excellent avg wtp_score | 75.0 | > Garbage avg score |
| Garbage avg wtp_score | 82.7 | < Excellent avg score |
| Positive recommendation rate | 20.5% | > 30% |
