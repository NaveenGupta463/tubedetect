# Excellent Recommendation Patterns

Generated: 2026-06-14
Gold set: 2182 labeled rows | 4 unique Excellent titles

## Key Finding

**ALL Excellent recommendations come from `peer_video_signal`.** Zero from DNA bets.
Excellent titles require specific named entities + narrative tension that DNA generation cannot produce.
Good recommendations come predominantly from `dna_original_bets` (cooking/fitness/finance templates).

## Unique Excellent Titles (4 unique, shown to multiple channels)

### "Trump Can’t Negotiate for S**t, and the Iran Peace Talks Prove It"
- **Narrative pattern:** CONFLICT_EXPOSE
- **Word count:** 12
- **Structure score:** 45
- **Named entities:** 2
- **Creator relevance:** NO (concept_confidence=0)

### "A Santro, A Family and 20 Years of Memories"
- **Narrative pattern:** MEMORY_OBJECT
- **Word count:** 9
- **Structure score:** 40
- **Named entities:** 0
- **Creator relevance:** NO (concept_confidence=0)

### "The Tiger That Was Forced to Hunt Humans"
- **Narrative pattern:** FORCED_CONFLICT
- **Word count:** 8
- **Structure score:** 50
- **Named entities:** 0
- **Creator relevance:** NO (concept_confidence=0)

### "We Thought Black Holes Ended in Singularities. They Might End In a Frozen Big Bang"
- **Narrative pattern:** ASSUMPTION_REVERSAL
- **Word count:** 15
- **Structure score:** 55
- **Named entities:** 0
- **Creator relevance:** NO (concept_confidence=0)

## Excellent vs Good Differentiators

| Metric | Excellent | Good |
|--------|-----------|------|
| Struct score avg | 47.0 | 54.9 |
| Word count avg | 11.2 | 7.7 |
| Named entities avg | 0.80 | 0.03 |
| Creator relevant % | 0.0% | 97.4% |
| Has narrative % | 100.0% | 0.0% |
| Is peer signal % | 100.0% | 2.6% |
| Winner template % | 0.0% | 82.8% |
| GENERIC % | 100.0% | 1.3% |

## Why Excellent ≠ Good

1. **Source**: Excellent = 100% peer_video_signal. Good = ~88% DNA original bets.
2. **Narrative**: Excellent titles use Conflict Expose, Memory Object, Forced Conflict, Assumption Reversal.
   Good titles use Mistake Behind, Checklist Format, WAY_TO templates.
3. **Named entities**: Excellent avg 2-3 named entities (Trump, Iran, Tiger, Black Holes).
   Good avg <0.5 named entities (cooking/fitness templates have none).
4. **Specificity**: Excellent titles are specific *events* not topic categories.
   Good titles are structural patterns applied to domain topics.

## Implication for Hybrid Generation

- Hybrid should NOT try to generate Excellent-caliber narrative titles from DNA.
- Hybrid should focus on: peer PATTERN + creator SUBJECT = better Good.
- Target: lift Good rate above 15% and reduce GENERIC below 20%.
- Excellent titles can only be surfaced from real peer signals, not generated from templates.

## Template Distribution by Label

| Template | Excellent | Good | Average | Poor/Garbage |
|----------|-----------|------|---------|--------------|
| DISH_TECHNIQUE   | 0.0% | 14.5% | 6.9% | 1.8% |
| WAY_TO           | 0.0% | 4.8% | 7.3% | 0.4% |
| CHECKLIST_FORMAT | 0.0% | 29.5% | 3.1% | 0.9% |
| MISTAKE_BEHIND   | 0.0% | 33.9% | 18.9% | 2.4% |
| COLON_EXPLAINER  | 0.0% | 15.9% | 21.3% | 2.7% |
| COLON_VARIANT    | 0.0% | 0.0% | 0.0% | 0.0% |
| GENERIC          | 100.0% | 1.3% | 42.5% | 91.8% |

## Source Quality Summary

| Source | n | Positive | Excellent |
|--------|---|----------|-----------|
| dna_original_bets | 1609 | 13.7% | 0 |
| peer_video_signal | 238 | 6.7% | 10 |
| angle_gap | 313 | 0.0% | 0 |
| territory_expansion | 6 | 0.0% | 0 |
| fallback_evergreen | 16 | 0.0% | 0 |
