# Angle Gap Quality Floor Report

**Date:** 2026-06-14  
**Status:** Applied to `whatToPost.js`

---

## 1. Problem

angle_gap is the largest contributor to recommendations (113/200 gold rows = 56.5%) and has **0% positive rate** (0 Excellent, 0 Good). All angle_gap gold rows are Poor (73.5%) or Garbage (26.5%).

Despite 0% quality, angle_gap scores average 84.7 normalized points — the highest of all sources — because the gap formula counts how many peers haven't covered a topic. Topic frequency gaps reward common keywords, not filmable ideas.

**Root cause of low quality:** angle_gap ideas are extracted as short N-gram phrases from peer video titles without a filmability check. A 3-word phrase like "India Economy News" or "Kids Fun Learning" scores high because 80 peers haven't published on it — but it's not a video concept.

---

## 2. Filter Specification

**Reject condition:** `word_count < 6 AND named_entity_count == 0`

**Named entity definition:** any word that is:
- A digit or contains a digit (specific number → filmable: "RBI Cut 50bps")
- A known proper noun from curated list (person names, country names, organizations, cities)
- A currency/percentage shorthand (Cr, Lakh, K, M, B, %)

**Curated proper noun list covers:**
- World leaders: Trump, Modi, Biden, Putin, Xi, Zelensky, Macron, etc.
- Countries (specific geopolitical actors): China, Pakistan, Russia, Ukraine, Iran, Israel, etc.
- Indian cities: Delhi, Mumbai, Hyderabad, Bangalore, Chennai, etc.
- Organizations: RBI, SEBI, BJP, Congress, AAP, Apple, Google, etc.
- Financial entities: Sensex, Nifty, NSE, BSE, GDP, Rupee, Dollar, etc.
- Sports entities: IPL, ICC, Virat, Kohli, Dhoni, FIFA, etc.

---

## 3. Measurement Results — Gold Set (113 angle_gap rows)

| Metric | Value |
|---|---|
| Total angle_gap gold rows | 113 |
| Rejected (keyword dumps) | 47 (41.6%) |
| Kept (have entity or ≥6 words) | 66 (58.4%) |
| Rejected — Garbage | 10/30 (33.3%) |
| Rejected — Poor | 37/83 (44.6%) |
| Rejected — Good | 0/0 — no Good in angle_gap gold set |
| Rejected — Excellent | 0/0 — no Excellent in angle_gap gold set |
| **False positive rate** | **0%** — no Good/Excellent content rejected |

### Rejected examples (keyword dumps correctly filtered):

| Label | Words | Title |
|---|---|---|
| Garbage | 4 | "Kids Fun Learning Educational" |
| Garbage | 4 | "Learn Shapes Little Baby" |
| Poor | 4 | "Learn English Kids Parts" |
| Poor | 4 | "Party Founder Abhijeet Dipke" |
| Poor | 4 | "Mini Led Unboxing Oled" |
| Poor | 3 | "West Bengal Elections" |
| Poor | 4 | "Ultra Iphone Pro Max" |

### Kept examples (correctly pass filter):

| Label | Words | Why kept |
|---|---|---|
| Poor | 4 | "Narendra Modi Delhi Raises" — has proper nouns Modi, Delhi |
| Poor | 3 | "Trump Says Iran" — has proper nouns Trump, Iran |
| Poor | 4 | "Bengal Politics Tmc Mamata" — has TMC, Mamata |
| Garbage | 4 | "America Iran War Tv9" — has proper nouns (TV9 brand embed is a separate quality issue) |

---

## 4. Measurement Results — Full Trace Corpus (856 angle_gap traces)

| Metric | Value |
|---|---|
| Total traces sampled | 856 (100% of corpus) |
| Would keep | 313 (36.6%) |
| Would reject | 543 (63.4%) |
| Projected total rejections | ~543 of 856 |

### Corpus rejected examples:

| Words | Title |
|---|---|
| 4 | "Mini Led Unboxing Oled" |
| 4 | "Ai+ Nova Nova Ultra" |
| 3 | "Macbook Neo Air" |
| 4 | "Redmi Note Phone Under" |
| 4 | "Amd Gaming Laptops Compared" |
| 4 | "Middle East War Escalation" |
| 4 | "Dhruv Rathee Roast Maha" |
| 2 | "Poco Pro" |

Note: "Middle East War Escalation" and "Dhruv Rathee Roast Maha" are false rejections (proper proper nouns not in curated list). These are acceptable — the filter is conservative rather than permissive.

---

## 5. Implementation — `whatToPost.js`

Filter added **after** `gaps.sort()` and **before** the dedup loop.

```javascript
const _PROPER_NOUNS = new Set([/* curated list */]);
const _hasNamedEntity = topic => 
  String(topic || '').toLowerCase().split(/\s+/).some(w =>
    /\d/.test(w) || /^\d*(cr|lakh|k|m|b|%|\+)$/i.test(w) || _PROPER_NOUNS.has(w)
  );

gaps = gaps.filter(g => {
  if (!g.is_angle && g.source !== 'angle_gap') return true; // pass non-angle ideas
  const wc = String(g.topic || '').trim().split(/\s+/).filter(Boolean).length;
  return wc >= 6 || _hasNamedEntity(g.topic);
});
```

---

## 6. Expected Impact

| Metric | Before | Expected after |
|---|---|---|
| angle_gap contribution rate | 56.5% of recommendations | ~20–25% (fewer survive filter) |
| angle_gap positive rate | 0% | 0% (filter removes worst, not root cause) |
| angle_gap avg score | 84.7 | Still ~84.7 (score unchanged for surviving ideas) |
| Garbage + Poor rate | 75% overall | Expected improvement as worst angle_gap removed |

**Important:** The P1 filter removes keyword dumps but does NOT fix angle_gap's core quality problem. The gap formula still rewards frequency-of-gap, not filmability. 63.4% of corpus ideas are rejected, but the remaining 36.6% are still predominantly Poor quality.

**Next step required:** After gold dataset expansion (Step 5), re-measure angle_gap quality on surviving ideas. If positive rate remains <10%, consider disabling angle_gap as a source or replacing the gap formula with a filmability-aware score.

---

## 7. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| False rejections of valid entities not in list | Medium | Curated list covers major entities in corpus; can extend incrementally |
| Reduced recommendation count per channel | Low | angle_gap was overrepresented; peer_video_signal and DNA bets fill remaining slots |
| Filter too permissive (short + entity still garbage) | High | "Narendra Modi Delhi Raises" passes but is Poor — entity presence alone is insufficient |
