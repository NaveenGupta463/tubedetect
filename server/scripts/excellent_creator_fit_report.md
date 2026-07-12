# Excellent Creator Fit Audit

**Date:** 2026-06-14  
**Central research question:** Can a recommendation be simultaneously Creator-Relevant, Narratively Compelling, AND Human-labeled Excellent?  

## Current State

| Metric | Excellent | Good | Poor/Garbage |
|---|---|---|---|
| Count (deduped) | 4 | 132 | 131 |
| Creator relevance | 0% | 98% | 24% |
| Concept coverage | 0% | 98% | 24% |
| Opportunity coverage | 25% | 100% | 52% |
| Narrative pattern | 100% | 1% | 1% |
| Avg word count | 11.0 | 7.5 | 4.8 |
| Avg score | 73.0 | 28.4 | 49.1 |

## Answer to Central Research Question

**NO** — Zero Excellent rows with concept_confidence ≥ 0.55.

**Root cause:** `peer_video_signal` traces skip concept extraction entirely. The `concept_id`, `concept_confidence`, and `family` fields are NULL for every peer recommendation — by architectural design.

**This is a structural gap, not a quality gap.** The titles themselves are creator-relevant (e.g. "The Tiger..." is shown to a science creator), but the concept pipeline never runs on peer titles.


## Excellent Titles — Detail

### "Trump Can’t Negotiate for S**t, and the Iran Peace Talks Prove It"
- **Pattern:** CONFLICT_EXPOSE
- **Channel niche:** politics
- **Score:** 83
- **Creator relevance (concept_confidence):** NULL — peer pipeline skips concept extraction
- **Concept ID:** NULL
- **Reviewer notes:** compelling narrative hook with specific story and immediately clear audience angle

### "A Santro, A Family and 20 Years of Memories"
- **Pattern:** MEMORY_OBJECT
- **Channel niche:** travel
- **Score:** 73
- **Creator relevance (concept_confidence):** NULL — peer pipeline skips concept extraction
- **Concept ID:** NULL
- **Reviewer notes:** compelling narrative hook with specific story and immediately clear audience angle

### "The Tiger That Was Forced to Hunt Humans"
- **Pattern:** FORCED_CONFLICT
- **Channel niche:** science
- **Score:** 68
- **Creator relevance (concept_confidence):** NULL — peer pipeline skips concept extraction
- **Concept ID:** NULL
- **Reviewer notes:** compelling narrative hook with specific story and immediately clear audience angle

### "We Thought Black Holes Ended in Singularities. They Might End In a Frozen Big Bang"
- **Pattern:** ASSUMPTION_REVERSAL
- **Channel niche:** science
- **Score:** 68
- **Creator relevance (concept_confidence):** NULL — peer pipeline skips concept extraction
- **Concept ID:** NULL
- **Reviewer notes:** compelling narrative hook with specific story and immediately clear audience angle

## Three Paths to Convergence

### Path A — Concept extraction on peer titles (highest impact)

Run `extractConceptForDna(title)` on peer titles before storing the trace.
Assign `concept_id` and `concept_confidence` to peer traces.
Filter: only show peer titles to creators whose creator DNA matches the peer title's concept.
Example: "The Tiger That Was Forced to Hunt Humans" → concept: `wildlife_conservation` → show only to wildlife/nature/conservation creators.

**Effort:** Low (add concept extraction to peer trace write block in `whatToPost.js`)  
**Expected result:** Excellent recommendations become creator-relevant when concept-matched.

### Path B — CONFLICT_EXPOSE with creator-niche entities (medium impact)

CONFLICT_EXPOSE is the one narrative pattern where the "named actor" can be domain-specific:
- Finance: "RBI Can't Control Inflation, and the Data Proves It"
- Fitness: "Your Supplement Brand Can't Back Its Claims, and Lab Tests Prove It"
- Business: "This VC Firm Can't Pick Winners, and Its Portfolio Proves It"

**Effort:** Medium (need institution/actor list per creator niche + conflict evidence from peer signals)  
**Expected result:** First DNA-adjacent Excellent pattern. Combines narrative structure with creator concept match.

### Path C — REVEAL_MECHANISM on creator subjects (low impact, easiest)

The only DNA-generatable narrative pattern (currently scores Average, not Excellent):
- "[Subject] is unreasonably [adjective]. Here's why."
- "[Subject]: What nobody explains clearly."

**Effort:** Already partially in WINNER_TEMPLATE_SETS as WAY_TO  
**Expected result:** Average → possibly Good. Not Excellent without a real discovery anchor.

## Recommended Next Steps

1. **Path A (concept extraction on peer traces)** — implement concept assignment in `whatToPost.js` peer trace write block. Gate peer titles by creator concept match before returning in API. This is the most direct route to Excellent + Creator-Relevant.
2. **Expand CONFLICT_EXPOSE peer pool** — curate finance/business/health analysis channels. Their peer titles carry institution-specific conflict expose patterns naturally.
3. **Do NOT modify scoring** — the convergence gap is architectural (concept extraction missing from peer pipeline), not a scoring problem.