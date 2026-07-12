# Peer Signal Value Audit — Research Track 1

Generated: 2026-06-14 07:08 UTC

```
════════════════════════════════════════════════════════════════
  Peer Signal Value Audit  —  Research Track 1
  102 distinct peer titles  |  102 with gold labels  |  238 total label instances
════════════════════════════════════════════════════════════════

1. SIGNAL COVERAGE RATES
────────────────────────────────────────────────────────────────
  Usable rate    (adapt ≥ 65 OR narr ≥ 70):  22/102  =  22%
  Narrative rate (narr ≥ 70):                 7/102  =  7%
  Adaptable only (adapt ≥ 65, narr < 70):    15/102  =  15%

2. CREATOR RELEVANCE RATE  (concept_confidence ≥ 0.55)
────────────────────────────────────────────────────────────────
  Titles with concept_confidence ≥ 0.55:  0/102  =  0%
  Titles with ANY non-null concept_conf:   0/102  =  0%

  WHY IT IS 0%:
  peer_video_signal rows are sourced from raw YouTube peer channel titles
  that have NOT passed through the concept-matching pipeline. The columns
  concept_id, concept_confidence, and family are ALWAYS NULL for these
  rows by design — the peer signal enrichment phase scores adaptability
  and narrative instead, not creator-concept alignment. To get a non-zero
  creator relevance rate, peer titles would need to run through the
  dna_affinity or concept-matching step before being stored.

3. TITLE QUALITY TIERS
────────────────────────────────────────────────────────────────
  Tier definition:
    Tier 1 — narrative ≥ 80  (high-concept story, forced conflict, etc.)
    Tier 2 — adaptability ≥ 65  AND  narrative < 80  (template-transfer)
    Tier 3 — english + no strong pattern  (borderline)
    Tier 4 — non-english / spam / short-vague
································································
  Tier                                         Count   Share
································································
  Tier 1 — Narrative (narr ≥ 80)               8        8%
  Tier 2 — Adaptable (adapt ≥ 65, narr < 80)   15       15%
  Tier 3 — English, no pattern                 37       36%
  Tier 4 — Non-English / spam                  42       41%

4. HUMAN QUALITY BY TIER  (Excellent + Good = positive)
────────────────────────────────────────────────────────────────
  Tier                                     Positive rate   Labels
································································
  Tier 1 — Narrative (narr ≥ 80)           56% (10/18)       Excellent:10 Poor:2 Average:6
  Tier 2 — Adaptable (adapt ≥ 65, narr < 80) 18% (6/34)        Poor:4 Average:22 Garbage:2 Good:6
  Tier 3 — English, no pattern             0% (0/79)         Average:64 Poor:13 Garbage:2
  Tier 4 — Non-English / spam              0% (0/107)        Poor:45 Average:50 Garbage:12

5. NOVELTY vs DNA CORPUS
────────────────────────────────────────────────────────────────
  Novel (no matching DNA pattern):    102/102  =  100%
  Already covered by DNA:             0/102  =  0%

  Novelty by tier:
  Tier                                         Novel   Total   %
································································
  Tier 1 — Narrative (narr ≥ 80)               8        8        100%
  Tier 2 — Adaptable (adapt ≥ 65, narr < 80)   15       15       100%
  Tier 3 — English, no pattern                 37       37       100%
  Tier 4 — Non-English / spam                  42       42       100%

6. WIN RATE BY LANGUAGE  (Excellent + Good / labelled titles)
────────────────────────────────────────────────────────────────
  Language           Positive rate   Label breakdown
································································
  english            8% (16/195)       Poor:45 Average:118 Excellent:10 Garbage:16 Good:6
  hindi              0% (0/33)         Poor:13 Average:20
  other_latin        0% (0/10)         Poor:6 Average:4

7. WIN RATE BY PATTERN
────────────────────────────────────────────────────────────────
  Pattern                  Positive rate   Label breakdown
································································
  DISH_TECHNIQUE           25% (4/16)        Poor:4 Average:8 Good:4
  WAY_TO                   50% (2/4)         Average:2 Good:2
  MISTAKE                  0% (0/4)          Average:4
  COLON                    0% (0/6)          Garbage:2 Average:4
  FORCED_CONFLICT          100% (2/2)        Excellent:2
  ASSUMPTION_REVERSAL      100% (2/2)        Excellent:2
  MEMORY_OBJECT            100% (2/2)        Excellent:2
  CONFLICT_EXPOSE          100% (4/4)        Excellent:4
  DISCOVERY_SCIENCE        0% (0/8)          Poor:2 Average:6
  NO_PATTERN               0% (0/190)        Average:118 Poor:58 Garbage:14

8. GOLD LABEL TOTALS  (validation)
────────────────────────────────────────────────────────────────
  Expected (from task spec): Excellent:10  Good:6  Average:142  Poor:64  Garbage:16  Total:238
  Observed (in DB join):     Poor:64  Average:142  Excellent:10  Garbage:16  Good:6  Total:238

════════════════════════════════════════════════════════════════
  END OF REPORT
════════════════════════════════════════════════════════════════
```

## Summary Table

| Metric | Value |
|--------|-------|
| Total distinct peer titles | 102 |
| Titles with gold labels | 102 |
| Total gold label instances | 238 |
| **Usable rate** (adapt ≥ 65 OR narr ≥ 70) | **22%** (22/102) |
| Narrative rate (narr ≥ 70) | 7% (7/102) |
| Creator relevance (concept_conf ≥ 0.55) | **0%** — concept_confidence is NULL for all peer rows |
| Novel vs DNA corpus | 100% (102/102) |

## Tier Distribution

| Tier | Count | Share |
|------|-------|-------|
| Tier 1 — Narrative (narr ≥ 80) | 8 | 8% |
| Tier 2 — Adaptable (adapt ≥ 65, narr < 80) | 15 | 15% |
| Tier 3 — English, no pattern | 37 | 36% |
| Tier 4 — Non-English / spam | 42 | 41% |

## Human Quality by Tier

| Tier | Positive Rate | Label Detail |
|------|--------------|--------------|
| Tier 1 — Narrative (narr ≥ 80) | 56% (10/18) | Excellent:10 Poor:2 Average:6 |
| Tier 2 — Adaptable (adapt ≥ 65, narr < 80) | 18% (6/34) | Poor:4 Average:22 Garbage:2 Good:6 |
| Tier 3 — English, no pattern | 0% (0/79) | Average:64 Poor:13 Garbage:2 |
| Tier 4 — Non-English / spam | 0% (0/107) | Poor:45 Average:50 Garbage:12 |

## Win Rate by Language

| Language | Positive Rate | Detail |
|----------|--------------|--------|
| english | 8% (16/195) | Poor:45 Average:118 Excellent:10 Garbage:16 Good:6 |
| hindi | 0% (0/33) | Poor:13 Average:20 |
| other_latin | 0% (0/10) | Poor:6 Average:4 |

## Win Rate by Pattern

| Pattern | Positive Rate | Detail |
|---------|--------------|--------|
| DISH_TECHNIQUE | 25% (4/16) | Poor:4 Average:8 Good:4 |
| WAY_TO | 50% (2/4) | Average:2 Good:2 |
| MISTAKE | 0% (0/4) | Average:4 |
| COLON | 0% (0/6) | Garbage:2 Average:4 |
| FORCED_CONFLICT | 100% (2/2) | Excellent:2 |
| ASSUMPTION_REVERSAL | 100% (2/2) | Excellent:2 |
| MEMORY_OBJECT | 100% (2/2) | Excellent:2 |
| CONFLICT_EXPOSE | 100% (4/4) | Excellent:4 |
| DISCOVERY_SCIENCE | 0% (0/8) | Poor:2 Average:6 |
| NO_PATTERN | 0% (0/190) | Average:118 Poor:58 Garbage:14 |

## Why Creator Relevance Is 0%

The `concept_confidence` column is structurally NULL for all `peer_video_signal` rows.
These rows come from raw YouTube peer-channel title ingestion and are never routed
through the concept-matching pipeline. Peer signal enrichment scores `peer_adaptability`
and `peer_narrative` instead, reflecting template-transfer and story-quality signals.
A non-zero creator relevance rate would require running peer titles through the
`dna_affinity` or concept-classification step before persisting them.

## Novelty vs DNA

| Tier | Novel | Total | Novel % |
|------|-------|-------|---------|
| Tier 1 — Narrative (narr ≥ 80) | 8 | 8 | 100% |
| Tier 2 — Adaptable (adapt ≥ 65, narr < 80) | 15 | 15 | 100% |
| Tier 3 — English, no pattern | 37 | 37 | 100% |
| Tier 4 — Non-English / spam | 42 | 42 | 100% |
