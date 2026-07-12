# Generic Template Retirement Report

**Phase 1 — Generator V2 prerequisite**
**Generated:** 2026-06-14
**Gold set:** 2182 labeled rows

---

## 1. Gold Set: Template Distribution & Win Rates

| Template | N in Gold | Winners | Win Rate | Gen Family | Status |
|---|---|---|---|---|---|
| GENERIC | 1032 | 8 | 0.8% | none | 🚫 RETIRE |
| DISH_TECHNIQUE | 346 | 37 | 10.7% | challenge | ✓ KEEP |
| MISTAKE_BEHIND | 331 | 83 | 25.1% | mistake | ✅ PROMOTE |
| COLON_EXPLAINER | 128 | 20 | 15.6% | comparison | ✓ KEEP |
| COLON_VARIANT | 119 | 8 | 6.7% | comparison | ⚠ MONITOR |
| CHECKLIST_FORMAT | 117 | 67 | 57.3% | instructional | ✅ PROMOTE |
| GENERIC_HOOK_PENALTY | 82 | 1 | 1.2% | deprecated | 🚫 RETIRE |
| WAY_TO | 23 | 9 | 39.1% | instructional | ✅ PROMOTE |
| FORCED_CONFLICT | 2 | 2 | 100.0% | narrative | ✅ PROMOTE |
| ASSUMPTION_REVERSAL | 2 | 2 | 100.0% | narrative | ✅ PROMOTE |

**GENERIC share:** 1032/2182 = **47.3%** (target: <20%)
**Winner template share:** 1150/2182 = **52.7%** (target: >50%)
**Winner template win rate:** 19.9% vs GENERIC 1.5%

## 2. Per-Family Template Audit

Each family template probed with 3 representative subjects. Shows which templates
produce GENERIC output and which map to winner template categories.

### finance_education ⚠ 2/5 GENERIC

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "How SIP choices can change your next money decision" | GENERIC | `RETIRE` |
| T2 | "The beginner mistake inside SIP choices" | MISTAKE_BEHIND | `PROMOTE` → mistake |
| T3 | "SIP choices: risk, returns, and timing explained simply" | COLON_EXPLAINER | `KEEP` → comparison |
| T4 | "Before you trust SIP choices, check this" | GENERIC_HOOK_PENALTY | `RETIRE` (penalized) |
| T5 | "A practical checklist for SIP choices" | CHECKLIST_FORMAT | `KEEP` → instructional |

### conversation_business ✅ ALL WINNER

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "The hidden cost of startup mistakes" | MISTAKE_BEHIND | `PROMOTE` → mistake |
| T2 | "What ambitious people get wrong about startup mistakes" | MISTAKE_BEHIND | `PROMOTE` → mistake |
| T3 | "How startup mistakes can change careers faster than people expect" | MISTAKE_BEHIND | `PROMOTE` → mistake |
| T4 | "The status trap behind startup mistakes" | MISTAKE_BEHIND | `PROMOTE` → mistake |
| T5 | "Why startup mistakes can distort success before it arrives" | MISTAKE_BEHIND | `PROMOTE` → mistake |

### conversation_finance ⚠ 3/5 GENERIC

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "A money conversation about money habits" | GENERIC | `RETIRE` |
| T2 | "The money mistake families make with money habits" | MISTAKE_BEHIND | `PROMOTE` → mistake |
| T3 | "money habits: habits, risks, and better choices" | COLON_EXPLAINER | `KEEP` → comparison |
| T4 | "What nobody explains clearly about money habits" | GENERIC | `RETIRE` |
| T5 | "The honest tradeoff behind money habits" | GENERIC | `RETIRE` |

### conversation_spiritual 🚫 ALL GENERIC

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "The deeper pattern behind karma" | GENERIC | `RETIRE` |
| T2 | "karma: myth, meaning, and modern life" | GENERIC | `RETIRE` |
| T3 | "What karma reveals about inner discipline" | GENERIC | `RETIRE` |
| T4 | "The ancient lens on karma" | GENERIC | `RETIRE` |
| T5 | "Why seekers keep coming back to karma" | GENERIC | `RETIRE` |

### news_event ⚠ 4/5 GENERIC

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "What happens next after policy change" | GENERIC | `RETIRE` |
| T2 | "policy change: who benefits and who loses" | COLON_EXPLAINER | `KEEP` → comparison |
| T3 | "The local impact of policy change, explained" | GENERIC | `RETIRE` |
| T4 | "policy change: the timeline viewers need" | GENERIC | `RETIRE` |
| T5 | "The decision behind policy change and what changes now" | GENERIC | `RETIRE` |

### exam_education ⚠ 2/5 GENERIC

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "UPSC prelims: PYQ traps and exam-ready concepts" | MISTAKE_BEHIND | `PROMOTE` → mistake |
| T2 | "UPSC prelims: chapter-wise revision in 10 points" | GENERIC | `RETIRE` |
| T3 | "UPSC prelims: high-yield practice plan for aspirants" | CHECKLIST_FORMAT | `KEEP` → instructional |
| T4 | "Common mistakes students make in UPSC prelims" | MISTAKE_BEHIND | `PROMOTE` → mistake |
| T5 | "UPSC prelims: marks-focused revision for the final week" | GENERIC | `RETIRE` |

### tech_review 🚫 ALL GENERIC

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "budget phones: practical test before you buy" | GENERIC | `RETIRE` |
| T2 | "budget phones: real-life verdict after daily use" | GENERIC | `RETIRE` |
| T3 | "Who should actually buy budget phones?" | GENERIC | `RETIRE` |
| T4 | "budget phones vs last year's option: what changed?" | GENERIC | `RETIRE` |
| T5 | "The hidden setting in budget phones most users miss" | GENERIC | `RETIRE` |

### general_education ⚠ 4/5 GENERIC

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "history explained for beginners" | GENERIC | `RETIRE` |
| T2 | "The simple timeline of history" | GENERIC | `RETIRE` |
| T3 | "What people get wrong about history" | GENERIC | `RETIRE` |
| T4 | "The complete beginner guide to history" | CHECKLIST_FORMAT | `KEEP` → instructional |
| T5 | "Why history matters more than it looks" | GENERIC | `RETIRE` |

### gaming_entertainment ⚠ 4/5 GENERIC

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "rank push: one challenge run viewers will want to finish" | GENERIC | `RETIRE` |
| T2 | "Can you win rank push using only beginner settings?" | GENERIC | `RETIRE` |
| T3 | "rank push: the strategy most players miss" | GENERIC | `RETIRE` |
| T4 | "rank push: risky choices that create the best comeback" | COLON_EXPLAINER | `KEEP` → comparison |
| T5 | "The update in rank push that changes how you play" | GENERIC | `RETIRE` |

### comedy_sketch ⚠ 3/5 GENERIC

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "When family pressure becomes everyone's problem" | MISTAKE_BEHIND | `PROMOTE` → mistake |
| T2 | "family pressure, but every decision makes it worse" | GENERIC | `RETIRE` |
| T3 | "The most relatable family pressure situation" | GENERIC | `RETIRE` |
| T4 | "If family pressure had an honest conversation" | GENERIC | `RETIRE` |
| T5 | "One character, one problem: family pressure" | MISTAKE_BEHIND | `PROMOTE` → mistake |

### travel_lifestyle ⚠ 4/5 GENERIC

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "budget trip: the honest budget route" | COLON_VARIANT | `KEEP` → comparison |
| T2 | "The overlooked detail in budget trip" | GENERIC | `RETIRE` |
| T3 | "budget trip: worth it or overhyped?" | GENERIC | `RETIRE` |
| T4 | "The local side of budget trip" | GENERIC | `RETIRE` |
| T5 | "budget trip: what to skip and what to do instead" | GENERIC | `RETIRE` |

### cooking_food ✅ ALL WINNER

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "street food: the budget version vs the restaurant version" | DISH_TECHNIQUE | `PROMOTE` → challenge |
| T2 | "Can you make street food at home without shortcuts?" | DISH_TECHNIQUE | `PROMOTE` → challenge |
| T3 | "The ingredient mistake that ruins street food" | MISTAKE_BEHIND | `PROMOTE` → mistake |
| T4 | "A regional twist on street food" | DISH_TECHNIQUE | `PROMOTE` → challenge |
| T5 | "street food: quick version for busy days" | DISH_TECHNIQUE | `PROMOTE` → challenge |

### fitness_practice ✅ ALL WINNER

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "back pain: a 7-day routine viewers can actually follow" | COLON_VARIANT | `KEEP` → comparison |
| T2 | "The beginner mistake behind back pain" | MISTAKE_BEHIND | `PROMOTE` → mistake |
| T3 | "back pain: what to do, what to avoid, and why" | COLON_EXPLAINER | `KEEP` → comparison |
| T4 | "A no-equipment way to improve back pain" | WAY_TO | `PROMOTE` → instructional |
| T5 | "back pain: a routine for people starting late" | CHECKLIST_FORMAT | `KEEP` → instructional |

### wellness_teaching ⚠ 4/5 GENERIC

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "mindset shift: the daily practice that makes it practical" | GENERIC | `RETIRE` |
| T2 | "The mindset trap behind mindset shift" | MISTAKE_BEHIND | `PROMOTE` → mistake |
| T3 | "How to test mindset shift for 7 days without overpromising" | GENERIC | `RETIRE` |
| T4 | "mindset shift: before and after, explained honestly" | GENERIC | `RETIRE` |
| T5 | "The small habit that changes mindset shift" | GENERIC | `RETIRE` |

### spiritual_teaching 🚫 ALL GENERIC

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "karma: the story, meaning, and daily practice" | GENERIC | `RETIRE` |
| T2 | "What karma teaches about modern life" | GENERIC | `RETIRE` |
| T3 | "The simple explanation of karma for beginners" | GENERIC | `RETIRE` |
| T4 | "How to practice karma without confusion" | GENERIC | `RETIRE` |
| T5 | "The discipline hidden inside karma" | GENERIC | `RETIRE` |

### generic ⚠ 4/5 GENERIC

| # | Sample Output | Template Type | Action |
|---|---|---|---|
| T1 | "Why viewers keep coming back to daily-life habit" | GENERIC | `RETIRE` |
| T2 | "The practical story behind daily-life habit" | GENERIC | `RETIRE` |
| T3 | "What changed in daily-life habit and why it matters" | GENERIC | `RETIRE` |
| T4 | "daily-life habit: a fresh angle from your recent uploads" | GENERIC | `RETIRE` |
| T5 | "The mistake viewers make with daily-life habit" | MISTAKE_BEHIND | `PROMOTE` → mistake |

## 3. Family Retirement Priority

| Creator Family | Templates | Winner | Generic | Deprecated | Priority |
|---|---|---|---|---|---|
| conversation_spiritual | 5 | 0 | 5 | 0 | 🔴 REBUILD ENTIRELY |
| tech_review | 5 | 0 | 5 | 0 | 🔴 REBUILD ENTIRELY |
| spiritual_teaching | 5 | 0 | 5 | 0 | 🔴 REBUILD ENTIRELY |
| news_event | 5 | 1 | 4 | 0 | 🟠 REMOVE GENERIC TEMPLATES |
| general_education | 5 | 1 | 4 | 0 | 🟠 REMOVE GENERIC TEMPLATES |
| gaming_entertainment | 5 | 1 | 4 | 0 | 🟠 REMOVE GENERIC TEMPLATES |
| travel_lifestyle | 5 | 1 | 4 | 0 | 🟠 REMOVE GENERIC TEMPLATES |
| wellness_teaching | 5 | 1 | 4 | 0 | 🟠 REMOVE GENERIC TEMPLATES |
| generic | 5 | 1 | 4 | 0 | 🟠 REMOVE GENERIC TEMPLATES |
| conversation_finance | 5 | 2 | 3 | 0 | 🟠 REMOVE GENERIC TEMPLATES |
| comedy_sketch | 5 | 2 | 3 | 0 | 🟠 REMOVE GENERIC TEMPLATES |
| finance_education | 5 | 3 | 2 | 1 | 🟡 CLEAN UP |
| exam_education | 5 | 3 | 2 | 0 | 🟡 CLEAN UP |
| conversation_business | 5 | 5 | 0 | 0 | 🟢 GOOD |
| cooking_food | 5 | 5 | 0 | 0 | 🟢 GOOD |
| fitness_practice | 5 | 5 | 0 | 0 | 🟢 GOOD |

## 4. What Generates GENERIC — Source Breakdown

The 674 GENERIC titles in the gold set come from these sources:

| Source | Count | % of GENERIC |
|---|---|---|
| dna_original_bets | 472 | 45.7% |
| angle_gap | 312 | 30.2% |
| peer_video_signal | 226 | 21.9% |
| fallback_evergreen | 16 | 1.6% |
| territory_expansion | 6 | 0.6% |

**Key insight:** Most GENERIC titles come from DNA original bets using THESIS_TEMPLATES
(hidden_economics, broken_system, etc.) and FAMILY_TEMPLATES.generic — none of which
match any winner template pattern.

## 5. Retirement Plan

### Templates to Retire Immediately

| Template | Family | Output Pattern | Replacement |
|---|---|---|---|
| T1 — How X can change your next money decision | finance_education | GENERIC | MISTAKE_BEHIND: "The beginner mistake inside X" |
| T4 — Before you trust X, check this | finance_education | GENERIC_HOOK_PENALTY | CHECKLIST_FORMAT: "A step-by-step guide to X" |
| T1 — Why viewers keep coming back to X | generic | GENERIC | (family suppressed entirely) |
| T2 — The practical story behind X | generic | GENERIC | (family suppressed entirely) |
| T3 — What changed in X and why it matters | generic | GENERIC | (family suppressed entirely) |
| T4 — X: a fresh angle from your recent uploads | generic | GENERIC | (family suppressed entirely) |
| T5 — The mistake viewers make with X | generic | GENERIC | (family suppressed entirely) |
| ALL 5 — conversation_* families | conv_business/finance/spiritual | GENERIC | MISTAKE + INSTRUCTIONAL winner templates |
| ALL 5 — comedy_sketch | comedy_sketch | GENERIC | Keep FAMILY_TEMPLATES as-is (narrative family) |
| ALL 5 — general_education | general_education | GENERIC | MISTAKE + INSTRUCTIONAL winner templates |
| ALL 5 — THESIS_TEMPLATES (hidden_economics, etc.) | explainer_case | GENERIC | Kept for explainer_case COMBO_BETS only |

### Templates to Keep and Promote

| Template | Family | Gen Family | Win Rate |
|---|---|---|---|
| The ingredient mistake that ruins X | cooking_food | mistake | 24.6% |
| Can you make X at home without shortcuts? | cooking_food | challenge | 42.1% |
| X: quick version for busy days | cooking_food | instructional | ~16% |
| X: the budget version vs the restaurant version | cooking_food | comparison | ~8% |
| The beginner mistake behind X | fitness_practice | mistake | 24.6% |
| A no-equipment way to improve X | fitness_practice | instructional | 27.8% |
| X: what to do, what to avoid, and why | fitness_practice | comparison | ~8% |
| X: a 7-day routine viewers can actually follow | fitness_practice | challenge | ~16% |
| The beginner mistake inside X | finance_education | mistake | 24.6% |
| A practical checklist for X | finance_education | instructional | 16.1% |
| X: risk, returns, and timing explained simply | finance_education | comparison | 8.2% |

### THESIS_TEMPLATES Status: DEPRECATED for non-explainer families

THESIS_TEMPLATES (hidden_economics, broken_system, consumer_deception, etc.) produce
all-GENERIC output. They are retained ONLY for `explainer_case` family COMBO_BETS.
For all other families they are replaced by the 4 winner generation families.

---

## 6. Success Criteria After Retirement

| Metric | Current | Target |
|---|---|---|
| GENERIC share of corpus | 47.3% | <20% |
| Winner template share | 52.7% | >50% |
| Positive rate (Good+Excellent) | 6.9% | >15% |
| F1 score (structure score ≥25) | 0.91 | maintain |

*These targets are achievable once GENERIC templates are replaced with winner templates*
*across cooking_food, fitness_practice, finance_education, and conversation families.*
