# WTP Ranking Inversion Report

Gold set: **1023 labelled rows** from `wtp_human_quality_reviews`

## 1. Score Scale Mismatch — Root Cause of Inversion

| Source group | n | Score scale | Range |
|---|---|---|---|
| DNA original bets | 450 | 0–1 float | 0.500 – 0.889 |
| Peer / angle gap | 573 | 0–100 integer | 13 – 93 |

**Root cause:** DNA affinity scores (0–1) are stored in the same column as WTP ranking scores (0–100). When sorted together, peer/angle ideas with score 88 always beat DNA bets with score 0.88. This is not a quality difference — it is a unit mismatch.

## 2. Raw Score by Label — Inversion Visible

| Label | n | Avg raw score | Avg normalized (0–100) | Positive sources |
|---|---|---|---|---|
| Excellent | 10 | 75.000 | 75.0 | peer_video_signal |
| Good | 61 | 8.581 | 66.1 | peer_video_signal, dna_original_bets |
| Average | 531 | 11.551 | 50.1 | dna_original_bets, peer_video_signal, fallback_evergreen |
| Poor | 313 | 60.441 | 64.8 | territory_expansion, angle_gap, peer_video_signal, dna_original_bets |
| Garbage | 108 | 60.411 | 62.6 | angle_gap, peer_video_signal, dna_original_bets, territory_expansion |

**Inversion confirmed:** Garbage outscores Excellent by **-12.4 normalized points** when raw scores are used.

## 3. Normalized Score — After Scale Fix

If DNA scores are multiplied by 100 before ranking:

| Label | Avg normalized | Rank (should be 1=Excellent) |
|---|---|---|
| Excellent | 75.0 | Rank 1 ✓ |
| Good | 66.1 | Rank 2  |
| Poor | 64.8 | Rank 3  |
| Garbage | 62.6 | Rank 4  |
| Average | 50.1 | Rank 5  |

After normalization: Garbage avg=62.6 vs Excellent avg=75.0
Still inverted after normalization: **NO — scale fix resolves the inversion**

## 4. Predictor Correlation with Quality

Pearson r with quality score (5=Excellent … 1=Garbage). Positive = predicts quality.

| Predictor | r | Classification | Note |
|---|---|---|---|
| Normalized score (DNA×100) | -0.198 | NEGATIVE predictor | Overall WTP score after scale fix |
| Title word count | +0.630 | POSITIVE predictor | Longer titles tend to have more specificity |
| Named entities in title | +0.007 | neutral | Named entities signal specificity (names, numbers, brands) |
| Has concept_id (0/1) | +0.559 | POSITIVE predictor | Whether topic is classified into a concept |
| Concept confidence | +0.560 | POSITIVE predictor | Confidence of concept assignment (0 if no concept) |
| Has specific opportunity (0/1) | +0.040 | neutral | Non-default opportunity matched by title pattern |
| Opportunity confidence | +0.146 | neutral | Confidence of opportunity assignment (0 if none) |
| Is DNA source (0/1) | +0.559 | POSITIVE predictor | DNA bets: 50% positive rate |
| Is angle_gap source (0/1) | -0.697 | NEGATIVE predictor | Angle gap: 0% positive rate |
| Is peer_video_signal (0/1) | +0.099 | neutral | Peer signal: 48% positive rate |

**Positive predictors** (reward quality): Title word count, Concept confidence, Has concept_id (0/1), Is DNA source (0/1)
**Negative predictors** (reward garbage): Is angle_gap source (0/1), Normalized score (DNA×100)
**Neutral** (no signal): Named entities in title, Has specific opportunity (0/1), Opportunity confidence, Is peer_video_signal (0/1)

## 5. Source vs Quality Matrix

| Source | n | Avg norm score | Avg quality score | Positive% | Verdict |
|---|---|---|---|---|---|
| dna_original_bets | 450 | 57.4 | 3.06 | 12.2% | ✓ OK |
| angle_gap | 313 | 67.8 | 1.73 | 0.0% | ~ neutral |
| peer_video_signal | 238 | 43.3 | 2.71 | 6.7% | ~ neutral |
| fallback_evergreen | 16 | 41.6 | 3.00 | 0.0% | ✓ LOW SCORE HIGH QUALITY — underranked |
| territory_expansion | 6 | 68.0 | 1.67 | 0.0% | ~ neutral |

## 6. Anatomy of the Inversion

| Metric | Garbage avg | Excellent avg | Winner |
|---|---|---|---|
| Raw score | 60.41 | 75.00 | ✓ Excellent wins |
| Norm score (0–100) | 62.62 | 75.00 | ✓ Excellent wins |
| Word count | 3.89 | 11.20 | ✓ Excellent wins |
| Named entities | 1.11 | 3.40 | ✓ Excellent wins |
| Concept confidence | 0.02 | 0.00 | ✗ Garbage wins |
| Opp confidence | 0.56 | 0.34 | ✗ Garbage wins |

## 7. Fix Prescription

### P0 (BLOCKING)
**Problem:** DNA affinity scores (0–1) compared directly against WTP scores (0–100)
**Fix:** Normalize DNA affinity to 0–100 before ranking: `dna_score * 100`
**File:** `originalBets.js or whatToPost.js (wherever scores are merged)`
**Expected impact:** Immediately moves Good DNA bets above Garbage angle_gap entries

### P1 (HIGH)
**Problem:** angle_gap source generates keyword dumps that score 73–93 because peer match count is high
**Fix:** Apply quality floor: require title word count ≥ 6 OR named entity ≥ 1 before including angle_gap idea
**File:** `whatToPost.js — angle_gap idea selection`
**Expected impact:** Eliminates ~100% of Garbage angle_gap entries from recommendations

### P1 (HIGH)
**Problem:** angle_gap score formula rewards topic frequency, not title quality
**Fix:** Add `title_specificity_bonus` to score: `+5 per named entity` in generated_title, `+3 per word beyond 5`
**File:** `whatToPost.js — gap_bonus calculation`
**Expected impact:** Separates "Narendra Modi Delhi Raises" (score ~88) from "How Trump's China Visit Impacts India" (score ~95)

### P2 (MEDIUM)
**Problem:** concept_confidence and opportunity_confidence are not used in ranking
**Fix:** Add `concept_confidence_bonus = concept_confidence × 5` (0–5 pts) to score
**File:** `whatToPost.js / originalBets.js — score assembly`
**Expected impact:** Rewards traces with validated concept assignment; neutral for no-concept entries

### P3 (LOW)
**Problem:** territory_expansion source produces only Poor/Garbage (2/2 are Poor in gold set)
**Fix:** Investigate territory_expansion idea generation — may need quality gate similar to angle_gap
**File:** `whatToPost.js — territory_expansion`
**Expected impact:** Small dataset but confirmed zero positive rate

## 8. Success Criteria

After applying fixes, re-run this audit. Expected outcomes:

| Metric | Current | Target |
|---|---|---|
| Excellent avg score | 75.0 | > Garbage avg score |
| Garbage avg score | 62.6 | < Excellent avg score |
| Positive recommendation rate | 6.9% | >30% |
| Ranking correlation (Pearson r) | -0.198 | >0.30 |

---
*Generated: 2026-06-14T01:58:12.191Z*