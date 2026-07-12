# Peer Signal Quality Audit
**Date:** 2026-06-13  
**Sample:** 100 `peer_video_signal` traces (random, last 30 days)  
**Scope:** Assess whether poor specificity scores reflect scorer miscalibration vs. genuine extraction quality failure

---

## Verdict

**Both are true simultaneously — different failure modes at different layers.**

| Layer | Finding | Magnitude |
|-------|---------|-----------|
| Specificity scorer | Underrates genuinely specific short/non-English titles | ~40% of traces |
| Extraction quality | Genuinely poor titles (spam, ads, episode aggregators) | ~28% of traces |
| High-quality signal | Legitimate, actionable recommendations | ~32% of traces |

The scorer problem and the extraction quality problem are **independent** and need independent fixes.

---

## Specificity Scorer: Under-rating Genuine Titles

### How the scorer fails peer-signal titles

The `scoreSpecificity()` function assigns a base score of 0.40, then adds bonuses for:
- High meaningful-word density (+0.10)
- Specific signals (dates, named entities, brand names) — up to +0.40
- 5–12 word length (+0.10)

Maximum possible score without a signal hit: **0.60**. Threshold for pass: **0.75**.

This creates a structural problem: a short but maximally specific title cannot cross 0.75 unless it contains a date, currency, or matched brand name.

### Examples of correct but under-scored titles

| Title | Specificity | Why Under-scored |
|-------|------------|-----------------|
| "Iran Israel War Live" | ~0.64 | 4 words, no date → no signal hit |
| "IPL Final" | ~0.50 | 2 words, too short for length bonus |
| "RBI Launch Plastic Notes? Big Update for Indian Currency" | ~0.64 | contains "Indian" + "Currency" but neither matches SPECIFIC_SIGNALS exactly |
| "2 Lakh ki bike chori ho gai" | ~0.60 | Hindi title — "2 Lakh" is currency but non-standard format |
| "RIP Godi Media" | ~0.64 | topical opinion, short |
| "CJP Protests LIVE" | ~0.64 | specific event, too short |
| "Chernobyl's Black Frogs" | ~0.64 | science documentary, no matched signal |

These are real content ideas — specific, filmable, and topically valid. The scorer marks them as failing (< 0.75) despite clear quality.

### Root cause

The `SPECIFIC_SIGNALS` array in `recommendationTruthAudit.js` was calibrated for full-sentence DNA template titles (5–12 words). Peer-signal topics are shorter (2–6 words) and their specificity comes from **named entities and proper nouns**, not length or structural patterns.

The 0.75 threshold was never set for peer-signal; it was inherited from the DNA pass/fail criterion and applied uniformly.

### Recommended fix

Apply source-aware thresholds in the truth audit:
- `peer_video_signal`: threshold = **0.55** (short titles with named entities are valid)
- `angle_gap` (3–4 word compact topics): threshold = **0.55**
- `dna_original_bets` (full template sentences): threshold = **0.75** (current)

Alternatively, add peer-signal-specific specific signal patterns:
- Named geopolitical events (Iran, Israel, Ukraine, Trump, Modi)
- Indian sports (IPL, BCCI, cricket final, WC)
- Short Hindi/Hinglish titles with numeric anchor (₹, lakh, k views)

---

## Extraction Quality: Genuine Problems

~28 of 100 sampled titles have real quality issues unrelated to the scorer.

### Category 1: Spam / SEO-bait titles (~10 traces)

```
"Very Special Trending Comedy Video 2026 😂Amazing Comedy Funny Video Episode 269 By Our Fun Tv"
"Funniest Fun Comedy Video 2026 😂 amazing comedy video 2026 Episode 266 By Our Fun Tv"
"Top Funniest Fun New Comedy Video 😂 Special amazing funny video 2026 Ep 381 By Busy Fun Ltd"
```

These come from spam aggregator channels that upload compilations under keyword-stuffed titles. They contain the word "comedy" or "funny" which causes the angle_gap algorithm to identify them as in-gap topics.

**Fix**: Add a quality filter before using peer video titles as topic sources. Reject titles matching:
- `/\bEp(?:isode)?\s*\d{2,}\b/i` — episode number in title (ongoing series)
- `/By\s+\w+\s+(Tv|Ltd|Channel|Media|Entertainment)\s*$/i` — channel brand at end
- Title length > 120 chars (unusually long = keyword stuffing)
- Title contains 2+ emoji sequences with generic words

### Category 2: Branded/Ad content (~5 traces)

```
"The Hyderabad sky lighting up with vivo X300 FE & vivo X300 Ultra that took over the night. Buy Now"
"Introducing Gemini Omni: Create Anything from Anything"
```

These are product announcements or branded partnerships where the video is an advertisement, not organic creator content. The `peer_video_signal` algorithm picks them up because they get high views.

**Fix**: Filter out peer titles containing "Buy Now", "Shop Now", "Limited Time", or titles that match known brand announcement patterns.

### Category 3: Episode aggregators / recurring show titles (~8 traces)

```
"NEW! Taarak Mehta Ka Ooltah Chashmah" (appears 3 times in 100 sample)
"Anniyan - Back to Back Comedy Scenes"
"Ladies Special 2"
"Shaidai Episode 12 Presented by..."
```

These are recurring TV show episode uploads. They have no recommendation value: "Taarak Mehta Ka Ooltah Chashmah" is a 15-year-old show and "new episode" titles repeat daily with identical structure.

**Fix**: Detect and filter recurring episode titles:
- `\bEpisode\s+\d+\b` in peer title
- `\bNEW!\s` or `\b(Latest|Today's)\s+Episode\b` prefix
- `Presented by` or `Produced by` in title

### Category 4: Non-English / wrong-language content (~5 traces)

```
"HABLÉ CON MINI MINI.EXE EN LOS BACKROOMS"  (Spanish)
"Dini peru cheppandi chudham"               (Telugu)
"Feel panna vidunga da"                     (Tamil)
"we literally can't believe this!!"         (K-pop fan)
```

These are from peer channels serving different language communities than the creator being recommended to. The peer-signal algorithm matched the channel's niche but didn't filter by language.

**Fix**: Language-gate peer video titles when the creator's DNA indicates a specific language audience. If `creator_constraints.language = 'hindi'`, peer titles that are fully Latin-script non-English (Spanish, Portuguese, French) should be excluded from the gap analysis.

### Category 5: Channel self-promotion (~3 traces)

```
"Have you watched this vlog on @Missfunvlogs"
"Uday Doctor Comedy || Binesar Chacha Comedy @UdaydoctorBodhgaya"
```

These are collaboration/mention posts, not content ideas. The `@handle` in the title is the signal.

**Fix**: Reject peer titles containing `@handle` patterns as they represent cross-promotion rather than content formats.

---

## High-Quality Signal Examples (Top 30%)

These are genuinely good recommendations that demonstrate peer_video_signal at its best:

```
"Why Trump Flew to China with 18 CEOs"               — geopolitical analysis
"The Tiger That Was Forced to Hunt Humans"           — wildlife documentary hook
"We Thought Black Holes Ended in Singularities..."  — science explainer
"How Trump's China Visit Impacts India"              — India-context news analysis  
"A Santro, A Family and 20 Years of Memories"       — emotional storytelling
"I EXPOSED BUGATTI'S SERVICE & REPAIR COST'S"        — automotive exposé
"Making Biggest Burger of My City"                   — food challenge, local angle
"1 Hour Fried Chicken"                               — cooking challenge format
"2 Lakh ki bike chori ho gai"                        — local relatable incident
"Smartphone VS Moon Shot"                            — comparison hook
"RBI Launch Plastic Notes? Big Update for Indian Currency" — Indian finance news
"Chernobyl's Black Frogs"                            — science documentary angle
"She Was Watching Him Trick the Pigeons..."          — viral hook format
```

These show that when peer_video_signal extraction works correctly, it surfaces real content opportunities with clear filmability and audience appeal.

---

## Recommendations

### Immediate (fix scorer calibration)

1. **Lower peer-signal specificity threshold to 0.55** in `recommendationTruthAudit.js`
   - Apply to `peer_video_signal`, `angle_gap`, `territory_expansion`, `fallback_evergreen`
   - Keep 0.75 only for `dna_original_bets`

2. **Add peer-signal-specific SPECIFIC_SIGNALS**:
   - Geopolitical named entities (Trump, Modi, Iran, Israel, Ukraine, IPL, RBI)
   - Hindi currency/scale patterns (`₹\d+`, `\d+\s*lakh`, `\d+\s*cr`)

### Short-term (fix extraction quality)

3. **Add pre-extraction quality filter** to `whatToPost.js` peer title scoring. Before a peer title is used as angle_gap seed:
   - Reject if contains episode/series number pattern
   - Reject if > 120 chars
   - Reject if contains `@handle`
   - Reject if title is "Buy Now", "Shop Now" branded
   - Reject if title starts with "NEW!" + recurring show name

4. **Add language gate**: Skip peer titles in fully non-target-language scripts when creator DNA specifies a language.

### Deferred (after above two phases land)

5. Re-run truth audit with updated thresholds to get accurate peer_video_signal pass rate.
6. Spot-check another 100 traces after extraction filters are applied.

---

## Summary Statistics

| Quality Category | Count | % |
|-----------------|-------|---|
| High quality — specific and actionable | 32 | 32% |
| Medium quality — adequate but generic | 40 | 40% |
| Low quality — genuine extraction problem | 28 | 28% |

Of the 28 low-quality cases:
- 10 spam/SEO-bait titles
- 8 recurring TV episode titles  
- 5 branded/ad content
- 3 channel self-promotion
- 2 other artifacts

**Conclusion**: Fix the scorer threshold first (high-impact, low-risk). Then apply the 5 extraction filters. The underlying peer signal, when clean, is genuinely useful — the best 32% of peer_video_signal traces are the strongest recommendations in the entire WTP output.
