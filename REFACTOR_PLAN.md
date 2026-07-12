# Refactor Plan — TubeIntel Server + Frontend

## Status: Refactor complete (2026-05-27). v2 is default shell. v1 protected. Backfill archive deferred until classifier/profile systems stabilize.

---

## ⚠️ Protected V1 Systems — DO NOT DELETE

These files are permanently protected as a reference layer. v2 does not replace them — it is a separate product. Do not delete, move, or modify them.

### v1 Pre-Publish Validator + scoring engines

| File | Role |
|---|---|
| `src/components/PrePublishValidator.jsx` | Primary v1 UI component |
| `src/screens/Validator.jsx` | v1 validator screen entry point |
| `src/scoring/computeScores.js` | 7-layer scoring formula |
| `src/scoring/unifiedScoring.js` | Unified score aggregator |
| `src/scoring/fixEngine.js` | Fix recommendation engine |
| `src/scoring/insightsEngine.js` | Insights derivation |
| `src/scoring/signalsTransformer.js` | Signal normalization |
| `src/scoring/truthEngine.js` | Ground truth layer |
| `src/scoring/videoClassifier.js` | Video classification |
| `src/engines/videoOptimizationEngine.js` | Optimization engine |
| `src/engines/shortsIntelligenceEngine.js` | Shorts intelligence |
| `src/engines/videoClassifier.js` | Engine-side classifier |
| `src/utils/fixMyVideoEngine.js` | Fix-my-video utility |
| `src/utils/learningEngine.js` | Learning layer |
| `src/utils/learningStore.js` | Learning persistence |
| `src/utils/contentFormat.js` | Content format helpers |
| `src/utils/analysis.js` | Analytics utilities |
| `src/contract/buildEnvelope.js` | API contract builder |
| `src/api/scoringApi.js` | Client-side scoring API |
| `server/routes/analyze.js` | `POST /api/analyze` — server endpoint used by PrePublishValidator |

### v1 Video Analysis + ImproveHub

| File | Role |
|---|---|
| `src/screens/VideoAnalysis.jsx` | v1 per-video deep analysis screen |
| `src/components/ImproveHub.jsx` | v1 improvement recommendation hub |

### Post-publish repair reference (backend)

| File | Role |
|---|---|
| `server/services/repair/repairEngine.js` | Phase A structural scoring |
| `server/services/repair/trajectoryScore.js` | Multi-bucket trajectory scoring |
| `server/services/repair/expectedPerformanceScore.js` | Benchmark comparison |
| `server/services/repair/audienceResponseScore.js` | Like/comment scoring with passive format safeguard |
| `server/services/repair/packagingRiskScore.js` | VSR-based packaging risk |
| `server/services/repair/fixabilityScore.js` | Urgency + fixability (window-capped) |
| `server/services/repair/aiRepairAdvisor.js` | Phase B AI recommendations |
| `server/routes/videoRepair.js` | `GET /api/repair/:id` + `POST /api/repair/:id/ai` |

**Rule:** v1 source is a permanent protected reference layer. Do not delete `src/` or any file listed above. Only the explicitly shared modules (`src-shared/`) may be extracted from v1 scope.

---

## ✅ Shared / Native v2 Systems

These are the intentional extraction and native-build outputs. Do not revert them to v1.

| File | Role |
|---|---|
| `src-shared/prepublish/validateVideo.js` | Shared 7-layer scoring engine — used by both v1 and v2 |
| `src-v2/screens/PrePublish.jsx` | Native v2 pre-publish UI (form + full results panel) |
| `src-v2/screens/VideoRepair.jsx` | Native v2 post-publish repair UI (Phase A scores + AI recs) |
| `server/services/repair/*` | Post-publish repair backend — Phase A structural + Phase B AI |

---

## 1. creatorIntel.js split plan

**Current state:** 2,945 lines (was 5,215 before extractions).

**Proposed modules** (split in this order to avoid circular deps):

| New file | What goes in it | Approx lines | Status |
|---|---|---|---|
| `server/services/podcastLanes.js` | `PODCAST_LANE_FAMILIES`, `computeTargetLanes`, `detectItemLane` | ~100 | ✅ Done |
| `server/services/podcastGuestExtract.js` | `GUEST_STOPSET`, `GUEST_REJECT_TERMS`, `INSTITUTION_GUEST_TERMS`, `GUEST_REJECT_PHRASE_RE`, `GUEST_MARKER_RE`, `isPersonLikeName`, `extractGuestCandidates` | ~120 | ✅ Done |
| `server/services/podcastThemes.js` | `PODCAST_THEME_WEAK_TRAILING`, `PODCAST_NEWS_TERMS`, `PODCAST_POLITICAL_PHRASE_RE`, `PODCAST_BUSINESS_CONTEXT_RE`, `PODCAST_THEME_EXPLICIT_REJECT`, `PODCAST_THEME_CLICKBAIT_RE`, `THEME_SOCIAL_STOP`, `isPersonNamePhrase`, `computePodcastThemes` | ~220 | ✅ Done |
| `server/services/podcastIntel.js` | `computePodcastIntel`, `computePodcastModePeers` + supporting constants | ~300 | ✅ Done |
| `server/services/whatToPost.js` | `computeWhatToPost` and all its inner helpers | ~1,230 | ✅ Done |
| `server/services/communityHot.js` | `/community-hot` route handler logic | ~155 | ✅ Done |
| `server/services/creatorPeerContext.js` | `resolveCreatorPeerContext`, `resolvePeersByRoutingProfile`, `resolvePeers`, `buildPeersByContent`, peer purity gates | ~580 | ✅ Done |
| `server/lib/phrases.js` | `STOPWORDS`, `HOOK_PHRASES`, `SOUTH_SCRIPT_RE`, `DEVANAGARI_RE`, `extractPhrases` | ~100 | ✅ Done |
| `server/routes/creatorIntel.js` | Route registration only — thin router, imports from above | ~200 | ✅ Done (47 lines) |

**Rule:** extract one module at a time, run validation command after each, commit before moving to next.

**Validation command after each split:**
```
node --check server/routes/creatorIntel.js
node server/scripts/validatePodcastMode.js
node server/scripts/auditClassifications.js --suspicious
```

---

## 2. Frontend: src vs src-v2 — Decision made (2026-05-27)

**Decision: v2 is the default app shell. v1 is a protected reference layer.**

- `src-v2/` — default app. `npm run build` / `npm run dev` now target v2 exclusively.
- `src/` — protected reference. Not deleted. Not migrated. Not wrapped by v2.
- No broad v1-to-v2 tool migration planned.

**What may be extracted from v1 intentionally:**
- Shared scoring/engine logic (e.g. `src-shared/prepublish/validateVideo.js`) — already done.
- Shared post-publish repair logic if needed in future.
- Nothing else. v2 does not import v1 components or screens.

**What stays permanently in v1:**
- ChannelSearch, ChannelOverview, VideoAnalysis, ViralFormulaDecoder, TitleThumbnailScorer, CommentSentimentMiner, ScriptOutlineGenerator, NicheTrendScanner, CompetitorComparison, BestTimeToPost, UploadCadenceTracker, SeoTagAnalyzer, MyChannelAnalytics, WeeklyPdfReport, SavedWorkspaces, PricingPage.
- v1 PrePublishValidator, ImproveHub, and all v1 scoring engines.

**Script mapping:**
| Command | Runs |
|---|---|
| `npm run dev` | v2 frontend + scoring server |
| `npm run dev:v1` | v1 frontend only |
| `npm run dev:all` | v1 + v2 + scoring server |
| `npm run build` | v2 (`dist-v2/`) |
| `npm run build:v1` | v1 (`dist/`) |
| `npm run build:v2` | v2 (`dist-v2/`) |
| `npm run preview` | v2 |
| `npm run preview:v1` | v1 |
| `npm run preview:v2` | v2 |

---

## 3. server/scripts cleanup categories

68 scripts currently. Proposed grouping (audit only — no moves yet):

**Keep as-is (active utilities):**
- `auditClassifications.js`, `validatePodcastMode.js`, `validateRoutingProfiles.js`, `validateFormatProfiles.js`, `validationAudit.js`, `filterValidation.js`, `lifecycleValidation.js`
- `backupDb.js`, `findChannel.js`, `diagnostics.js`, `checkNiches.js`, `dataAudit.js`
- `buildNicheEdges.js`, `buildForeignReferenceSet.js`, `benchmarkWhatToPost.js`

**One-shot backfills (safe to archive after confirming complete):**
- `backfillChannelIdentity.js`, `backfillChannelIdentityV2.js`, `backfillCreatorMode.js`
- `backfillFormatProfile.js`, `backfillRoutingProfile.js`, `backfillLifecycleV2.js`
- `backfillEmbeddings.js`, `backfillThumbnailSnapshots.js`, `backfillVideoThumbnails.js`
- `addHindiSeeds.js`, `addHindiSeedsRetry.js`, `addTamilSeeds.js`, `addTamilSeedsRetry.js`
- `addTeluguSeeds.js`, `addTeluguSeedsFinal.js`, `addTeluguSeedsRetry.js`, `cleanupTeluguSeeds.js`
- `promoteMultilingualChannels.js`, `reclassifyChannelNiches.js`

**Duplicates / superseded (confirm before deleting):**
- `recover-db.js` vs `recoverDb.js` — likely same script, different casing

**Unclear / investigate:**
- `triggerSynthetic.js`, `clearSyntheticB.js`, `seedTestData.js` — test data scripts
- `mineRomanizedWords.js`, `mineFeatureEdges.js` — check if output is still used

**⏸ Deferred — do not archive yet.** Classifier and profile systems (routing profiles, format profiles, lifecycle stages) are still being actively iterated. Backfill scripts may be needed again if a re-classification or schema change is required. Revisit once these systems have been stable for 60+ days with no schema changes.

---

## 3b. Phase 4 archive — conservative pass (2026-05-27)

Moved to `server/scripts/archive/`. Criteria: zero external references, clearly one-shot (phase/session label or single-use query), superseded by active counterpart, or debug throwaway.

| Script | Reason |
|---|---|
| `_lookup_raj.js` | 4-line debug query for one channel — throwaway |
| `diagnostics2.js` | "Phase 4 & 5 deep dive" — phase-specific, superseded by `diagnostics.js` |
| `volatilityAudit.js` | "Root-cause audit: Stable → Volatile" — one-shot incident audit |
| `verifySnapshot.js` | One-shot: checks `learning_health_snapshots` rows |
| `verifyHistoryDashboard.js` | One-shot schema verification |
| `verifyConfidence.js` | "Phase A verification script" — phase-specific |
| `verifyConfidenceDB.js` | One-shot DB row count check, pair with verifyConfidence.js |
| `checkSnapshots.js` | One-shot snapshot niche check |
| `checkGraphDensity.js` | "Session 4A" — one-time Louvain investigation |

**Kept (not archived):** `diagnostics.js` (active utility, listed in §3 keep-as-is), `routingAudit.js` (referenced in `peerScoreWeights.js` comment), `eventBenchmark.js` (ongoing nightly validator), `lifecycleValidation.js`, `filterValidation.js`, `validationAudit.js`, `checkNiches.js` (all listed keep-as-is in §3).

---

## 4. Backup retention policy (proposed, not enacted)

**Current state:** 7 daily backups, total ~23 GB on disk.

| File | Size | Age |
|---|---|---|
| scoring_2026-05-21.db | 2.3 GB | 6 days ago |
| scoring_2026-05-22.db | 2.9 GB | 5 days ago |
| scoring_2026-05-23.db | 3.1 GB | 4 days ago |
| scoring_2026-05-24.db | 3.3 GB | 3 days ago |
| scoring_2026-05-25.db | 3.5 GB | 2 days ago |
| scoring_2026-05-26.db | 3.7 GB | 1 day ago |
| scoring_2026-05-27.db | 3.8 GB | today |

**Proposed policy:** keep latest 3 backups, delete older ones automatically in `backupJob.js`.
Savings if enacted: ~11.6 GB freed (drop May 21–24).

**Action required:** explicit approval before any deletions. Proposed implementation: modify `server/jobs/backupJob.js` to prune backups older than 3 days after each successful backup run.

---

## 5. Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Hygiene: .gitignore, REFACTOR_PLAN.md | ✅ Done |
| 1a | Extract `podcastLanes.js` | ✅ Done |
| 1b | Extract `podcastGuestExtract.js` | ✅ Done |
| 1c | Extract `podcastThemes.js` | ✅ Done |
| 1d | Extract `podcastIntel.js` | ✅ Done |
| 2 | Extract `whatToPost.js` | ✅ Done |
| 3 | Extract `communityHot.js` | ✅ Done |
| 3b | Extract `creatorPeerContext.js` + `lib/phrases.js` | ✅ Done |
| 3c | Thin router — move all inline handlers to creatorIntelController.js | ✅ Done |
| 4 | scripts/ archive pass — conservative pass (9 one-shot diagnostics) | ✅ Done |
| 5 | Backup retention automation | ✅ Done |
| 6 | Frontend src vs src-v2 decision + merge | ✅ Done |
| 6a | Add `build:v2` / `preview:v2` scripts to package.json | ✅ Done |
| 6b | Native v2 PrePublish screen + shared scoring module | ✅ Done |
| 6c | Add v1 AI toolset to v2 nav | ❌ Cancelled — see §6 decision |
| 6d | Phase 6d validation — scoring parity confirmed | ✅ Done |
| 6e | v2 as default app shell — `dev`/`build`/`preview` now target v2 | ✅ Done |

---

## 5b. Creator DNA / Original Bets WTP Rollout (2026-06-07)

Goal: make WTP capable of producing channel-specific, original ideas that feel native to the creator, while keeping "peer topics already getting traction" as a separate source. The system should learn from the stored uploads we already have for each channel, not depend on live YouTube lookups or one-off manual reclassification.

**Execution rule:** finish, test, and bug-check one phase before starting the next. Do not put full DNA analysis in the WTP request path; WTP should read cached DNA and queue/trigger refreshes only when needed.

| Phase | Scope | Status |
|---|---|---|
| DNA-1 | Storage + deterministic extractor from stored videos. Add `video_dna_signals` and `creator_idea_dna`; extract hooks, domains, thesis patterns, vocabulary, entities, micro-topics, format mix, confidence, and drift from latest stored uploads. Validate on Aevy TV plus a small seeded sample. No WTP UI changes. | Done |
| DNA-2 | Audit and tune extractor across major WTP failure families: podcast vs solo, finance education vs business case study, news vs explainer, tech review vs tech essay, education vs exam prep, shorts-heavy vs long-form-heavy. Add measurable mismatch reports. | Done |
| DNA-3 | Add cached "Original Bets For You" read path to WTP. Generate ideas from creator DNA, keeping Community Hot / peer-covered topics as a separate section. Add fallback rules only when DNA confidence is low. | Done |
| DNA-4 | Backfill seeded channels and wire scheduled/RSS updates. New/future channels get DNA automatically once enough stored uploads exist; refreshes run on a cadence, not after every upload. | Done |
| DNA-5 | Drift tracking and evaluation harness. Detect gradual creator shifts over weeks/months, version DNA snapshots, capture user feedback, and compare generated ideas against held-out successful uploads. | Done |

Phase DNA-1 acceptance criteria:
- Aevy TV can produce a high-confidence DNA profile from the stored mixed latest uploads.
- The profile identifies curiosity explainer behavior, India/system/business/consumer/tech territories, hook/thesis patterns, and mismatch negatives such as phone reviews or trading tips.
- The extractor works deterministically without network or LLM calls.
- Schema migration and inspection/backfill script pass syntax checks and a small DB run.

Phase DNA-1 validation (2026-06-07):
- Added `server/services/creatorIdeaDna.js`, `server/scripts/backfillCreatorIdeaDna.js`, and DB migration for `video_dna_signals` / `creator_idea_dna`.
- Syntax checks passed for the service, script, and DB init.
- Aevy TV profile from latest 50 stored videos: confidence high (0.829), sample 50, long 2, short 48, CSP curiosity_explainer, top patterns include india_system, hidden_economics, tech_shift, consumer_deception, investigation, broken_system.
- Aevy negative DNA now explicitly blocks mismatch families such as phone_review, trading_tip, generic_news_bulletin, exam_prep, guest_podcast_episode, and generic_reaction.
- Small DB run processed 25 additional seeded channels with 25/25 successful writes.

Phase DNA-2 start (2026-06-07):
- Added `server/scripts/auditCreatorIdeaDnaFailureFamilies.js`.
- Initial audit on 36 cached channels found 5 findings after noise tuning: 3 language_signal_gap, 1 podcast_vs_solo, 1 format_evidence_warning for Aevy's short-heavy stored sample.

Phase DNA-2 validation (2026-06-07):
- Broader DNA backfill processed 300 additional channels with 300/300 successful writes.
- Tuned failure-family audit to reduce noisy false positives for finance/trading channels, normal news channels with occasional explainer titles, and sports/entertainment interview language.
- Broad audit over 336 cached channels produced 30 actionable findings: 21 language_signal_gap, 3 format_evidence_warning, 2 education_vs_exam_prep, 2 podcast_vs_solo, 1 finance_education_vs_business_case, 1 news_vs_explainer.

Phase DNA-3 validation (2026-06-07):
- Added `server/services/originalBets.js`.
- WTP now returns `original_bets` from cached creator DNA without replacing peer/community ideas.
- V2 WTP renders Original Bets as a separate section above the normal peer idea grid.
- Aevy TV generated high-confidence Original Bets from cached DNA:
  - Why Indian cities are becoming too hot to live in
  - The hidden business behind India's AC addiction
  - Why every Indian app now wants a subscription
  - The protein scam hiding inside India's fitness boom
  - Why India's middle class pays luxury prices for normal life
  - How food brands make healthy choices feel impossible

Phase DNA-4 validation (2026-06-07):
- Added `server/jobs/creatorIdeaDnaJob.js` and registered it in `server/index.js`.
- DNA refresh runs every 6 hours at minute 30 and performs a small startup catch-up unless disabled with `CREATOR_DNA_STARTUP_CATCHUP=0`.
- Refresh selects channels with missing DNA, stale DNA, or newer stored uploads. It reads/writes cached DNA only; WTP does not run full DNA analysis in the request path.
- Tiny refresh validation processed 5 due channels with 5/5 successful writes in about 1.3s after selector optimization.
- `npm run build:v2` passed.

Phase DNA-5 validation (2026-06-07):
- Added Phase 5 tables: `creator_idea_dna_snapshots`, `original_bet_feedback`, `original_bet_evaluation_runs`, and `original_bet_evaluation_items`.
- DNA refresh/backfill now writes immutable snapshots when the DNA source hash changes. Aevy TV refresh created snapshot `1` with confidence high and drift `testing_new_lane`.
- Original Bets now include stable `idea_key` values and WTP Save / Act actions post feedback to `/api/intel/original-bets/feedback`.
- Feedback handler was validated inside a rollback transaction; it returned `ok: true` and resolved the latest DNA snapshot without leaving test feedback rows.
- Added `server/scripts/evaluateOriginalBets.js`, which trains on older stored uploads and compares generated Original Bets against held-out recent successful uploads.
- Dry-run evaluation over 20 channels produced 116 ideas with 14 held-out hits (`hit_rate=0.1207`).
- Persisted evaluation run `1` over 10 channels produced 56 ideas with 9 held-out hits (`hit_rate=0.1607`).
- Syntax checks passed for changed backend files, and `npm run build:v2` passed without the previous large chunk warning.

Post-DNA-5 backend WTP audit (2026-06-07):
- Added `server/scripts/auditWtpSuggestionsSample.js` for backend-only sampling of WTP payloads without UI.
- Initial 30-channel sample: 30/30 returned peer ideas, 0 fallbacks, 25/30 returned Original Bets. Aevy TV was good, but the current Original Bets generator leaked explainer-shaped ideas into unsupported families such as news, gaming, music, entertainment, finance education, yoga/fitness, and exam-prep.
- Added a safety gate in `server/services/originalBets.js`: current Original Bets run only for explainer / case-study creator families until family-specific generators exist.
- Post-gate 30-channel sample: 30/30 returned peer ideas, 0 fallbacks, 2/30 returned Original Bets (`Aevy TV`, `Shark Tank India`). 28/30 were intentionally marked `unsupported_creator_family`.
- Remaining WTP quality issues are now in peer/community suggestions, not Original Bets: entertainment/gaming still show generic reaction patterns, and low-signal food/other channels can route into Bhojpuri/religious/person-name peer topics.

Pipeline DNA integration (2026-06-07):
- Added `server/services/creatorIdeaDnaPipeline.js`, a guarded helper that builds creator DNA only when enough stored titles exist and skips channels whose DNA is already up to date.
- `server/jobs/historicalIngest.js` now builds creator DNA immediately after historical upload rows are stored and `markChannelIngested` runs. Cycle metrics now include `dna_built` and `dna_skipped`.
- `server/routes/onboarding.js` now builds initial creator DNA from the recent uploads fetched during onboarding when enough titles are available, so newly onboarded channels can have WTP DNA before the daily historical job.
- The scheduled DNA refresh job remains the fallback for missed/stale rows and gradual creator drift; WTP still reads cached DNA only.
- Validation: syntax checks passed for the new helper, historical ingest, onboarding route, and creator DNA service. Aevy pipeline helper check returned `creator_dna_up_to_date` with 71 stored titles and sample count 50.

Original Bets all-family expansion (2026-06-07):
- Replaced the temporary `unsupported_creator_family` safety gate with family-specific Original Bets generators for all current CSP families in the DB: explainers/case studies, finance education, business/finance/spiritual conversations, news, exam education, tech review, general education, gaming, comedy, travel/lifestyle, cooking/food, fitness, wellness, spiritual teaching, and low-signal generic channels.
- Added subject cleanup and family-specific boosting so the generator prefers creator-native micro-topics/entities and suppresses repeated title/brand artifacts such as channel names, news-brand suffixes, and reaction/roast terms.
- Aevy TV remains on the explainer/case-study generator and still returns the high-quality India/system/business ideas instead of tech/mobile reviews.
- Final backend audit: `node server/scripts/auditWtpSuggestionsSample.js --limit 100 --top-original 3 --top-peer 3 --output tmp/wtp_suggestions_audit_100_family_bets_v3.json`.
- Result: 100/100 sampled channels had `original_bets.status=ready`, 600 Original Bets total, average 6 Original Bets/channel, 0 errors, 0 zero-peer-idea channels, and 0 mismatch hits from `creator_dna_original_bet`.
- Remaining 24 mismatch hits in the audit are from existing peer/fallback suggestions, not the new Original Bets lane. Next cleanup should apply DNA mismatch filtering to peer/community/fallback WTP lanes.

---

## 5c. Performance Architecture / Fast WTP Rollout (2026-06-08)

Goal: make channel pages and WTP feel immediate for real users even with 30k+ channels, large local DB files, and background ingestion/refresh work. User-facing APIs must not compete with RSS sweeps, DNA refresh, snapshot jobs, or intelligence aggregation.

**Execution rule:** finish, test, and bug-check one phase before starting the next. Do not move to the next phase until the current phase has a concrete validation note here.

Target latency:
- Channel click first useful render: under 1s from cached/summary data.
- Cached WTP response: under 500ms-1s.
- Cold WTP response: under 2-3s where possible, otherwise return stale/partial cache and queue refresh.
- No blank WTP loading skeletons caused by background jobs.

| Phase | Scope | Status |
|---|---|---|
| P0 | WAL + observability. Verify SQLite WAL/busy settings, add API timing and DB slow-call telemetry, and identify startup/route bottlenecks before changing architecture. | Done |
| P1 | Split API from background jobs. `server/index.js` becomes API-first/no-cron by default; a separate worker entrypoint owns RSS, DNA refresh, snapshots, intelligence aggregation, and other crons. | Done |
| P4 | Refresh queue skeleton. Add a small DB-backed queue before WTP cache so stale/missing cache refreshes do not use ad-hoc timers or direct cron calls. Include force-refresh priority bump. | Done |
| P2 | WTP cache. Add `channel_wtp_cache` and serve fresh/stale cached WTP immediately while queueing refreshes. Use time-based expiry only in V1. | Done |
| P3 | Channel summary cache. Audit existing summary/profile tables first, then consolidate or add fast channel summary tables only where needed. | Done |
| P5 | Stale-while-revalidate UI. Show cached results instantly, surface freshness/refreshing state, and update when refresh completes without blocking the screen. | Done |
| P6 | Query/index optimization. Use P0 telemetry to add indexes and rewrite slow WTP/community/channel queries. Data-change invalidation can be considered here if telemetry justifies it. | Done |
| P7 | Production DB path. Keep SQLite short-term; prepare a Postgres migration path after cache/worker architecture stabilizes. | Done |
| P8 | Load and UI validation. Run channel-click/WTP tests with worker on/off, edge CSP families, and queue backlog scenarios. | Done |

Phase P0 validation (2026-06-08):
- `server/db/init.js` already enables `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=60000`, `PRAGMA synchronous=NORMAL`, and app-connection `PRAGMA wal_autocheckpoint=2000`.
- Read-only PRAGMA audit confirmed `journal_mode=wal` and `busy_timeout=60000`.
- Added DB slow-call timing in `server/db/init.js` with `DB_SLOW_MS` defaulting to 250ms and optional `DB_TIMING_DEBUG=1`.
- Added API timing middleware in `server/index.js` with `API_SLOW_MS` defaulting to 1000ms and always logging WTP/support routes.
- Syntax checks passed: `node -c server/index.js`, `node -c server/db/init.js`.
- Finding: full `getDb()` initialization can exceed 2 minutes on the large local DB because startup still runs migration/backfill/check logic. P1/P6 should keep the API process lightweight and move heavy startup work to worker-controlled paths.

Phase P1 acceptance criteria:
- Starting the API server does not schedule or run RSS sweep, creator DNA refresh, historical ingest, snapshots, intelligence aggregation, backup, crawler, country detection, embedding, clustering, promotion, or corpus scheduler jobs by default.
- A separate worker entrypoint starts background jobs intentionally.
- Existing `E2E_NO_CRONS` / `DISABLE_STARTUP_CRONS` behavior remains compatible.
- Local dev can run API-only, worker-only, or both.
- Syntax checks pass for changed entrypoints and package scripts.
- API health and a WTP request can be tested while worker is off.

Phase P1 validation (2026-06-08):
- Added `server/jobs/backgroundJobs.js` as the single scheduler startup list and `server/worker.js` as the intentional background worker entrypoint.
- `server/index.js` is API-only/no-cron by default. It starts background jobs only when `ENABLE_API_CRONS=1`; existing `E2E_NO_CRONS` / `DISABLE_STARTUP_CRONS` still block legacy cron startup.
- Added local scripts: `server` `start:api`, `start:worker`, `dev:api`, `dev:worker`; root `dev:worker` and `dev:with-worker`.
- Moved repeated startup data rewrites out of API default startup: legacy niche rename, `primary_niche` backfill, feature backfill, OpenAI niche override, shorts full-table backfill, and governance roadmap seed now run only in the worker/explicit backfill lane.
- Syntax checks passed: `node -c server/index.js`, `node -c server/worker.js`, `node -c server/jobs/backgroundJobs.js`, `node -c server/db/init.js`; package JSON parse passed.
- API-only runtime validation on port `3199`: `/health` returned 200, Aevy TV WTP returned 200 in 1,961ms with 5 ideas, 1 Original Bet, and 1 More Sources block while the worker was off.
- Runtime logs showed `API process running without background crons` and no RSS/DNA/snapshot/historical ingest/background scheduler startup logs.

Phase P4 acceptance criteria:
- Add `refresh_jobs` table with job type, channel id, priority, status, run_after, attempts, lock metadata, timestamps, and error message.
- Add enqueue/claim/complete/fail helpers with idempotent `(job_type, channel_id)` behavior for pending jobs.
- Add force-refresh helper that bumps priority and run_after.
- No WTP cache refresh should use ad-hoc timers once P2 starts.

Phase P4 validation (2026-06-08):
- Added `refresh_jobs` schema with pending-job uniqueness by `(job_type, channel_id)`, claim indexes, lock metadata, attempts, timestamps, payload/result JSON, refresh reason, and error message.
- Added `server/services/refreshQueue.js` with `enqueueRefreshJob`, `forceRefreshJob`, `claimRefreshJobs`, `completeRefreshJob`, `failRefreshJob`, `getRefreshJob`, and queue stats helpers.
- Added `server/scripts/validateRefreshQueue.js` for focused queue behavior validation with temporary rows that are cleaned up after the run.
- Syntax checks passed: `node -c server/services/refreshQueue.js`, `node -c server/scripts/validateRefreshQueue.js`, `node -c server/db/init.js`.
- Validation run passed: enqueue, pending dedupe, force priority bump, claim/lock, complete, new pending after done, and fail-to-retry behavior all passed.

Phase P2 acceptance criteria:
- Add `channel_wtp_cache` with payload JSON, computed_at, expires_at, status, source versions, and refresh reason.
- WTP returns fresh cache immediately.
- WTP returns stale cache immediately and enqueues refresh.
- Missing cache computes once, saves, and returns; long cold compute must fail gracefully rather than spinning forever.
- V1 invalidation is time-based only.

Phase P2 validation (2026-06-08):
- Added `channel_wtp_cache` with payload JSON, computed/expires timestamps, status, source versions, refresh reason, and error message.
- Added `server/services/wtpCache.js`, `server/services/whatToPostContext.js`, and `server/jobs/wtpCacheRefreshJob.js`.
- `/api/intel/what-to-post` now uses cache for normal channel-id requests; debug/reference-date/uncacheable variants bypass cache.
- Stale WTP cache rows return immediately and enqueue `refresh_jobs.job_type='wtp_cache'`; worker-side refresh claims queued jobs and refreshes cache.
- Syntax checks passed for WTP cache service, context builder, refresh worker job, background job list, creator intel controller, DB init, and validation script.
- `node server/scripts/validateWtpCache.js` passed on Aevy TV: cold compute saved cache, second read came from cache, forced stale row returned stale payload and queued refresh, worker batch completed the refresh and wrote a non-stale cache row.
- API-only route validation on port `3199`: first Aevy WTP request returned 200 in 1,559ms with `cache.source=api_cold`; second request returned 200 in 73ms with `cache.source=cache`; no background crons started in the API process.

Phase P3 acceptance criteria:
- Audit existing channel/cache/profile/snapshot tables before adding new tables.
- Channel header/details should render from compact summary/profile rows without scanning raw videos.

Phase P3 validation (2026-06-08):
- Existing table audit found strong profile coverage but no single compact channel detail summary: `ingested_channels=30,847`, `ingested_videos=1,874,856`, `channel_content_strategy_profiles=30,678`, `creator_idea_dna=30,678`, `channel_identity=24,129`, `channel_territory_profiles=38,173`, `channel_evolution_summary=51,343`.
- Added `channel_runtime_summary` as a materialized channel header/detail row consolidating channel metadata, CSP, creator DNA, territories, video counts, format/routing/creator mode, and WTP cache freshness.
- Added `server/services/channelRuntimeSummary.js`, `server/scripts/validateChannelRuntimeSummary.js`, and `server/scripts/backfillChannelRuntimeSummary.js`.
- Added `GET /api/channel-cache/summary/:channelId`; `GET /api/channel-cache/channel?id=...` can use `channel_runtime_summary` as a fast fallback before scanning raw ingested channel rows.
- Syntax checks passed for the summary service, validation script, backfill script, channel cache route, and DB init.
- Aevy TV summary validation passed: built/read compact row with `video_count=72`, `primary_csp=curiosity_explainer`, `format_profile=curiosity_explainer`, `territory_count=7`, and `wtp_cache_status=ready`.
- API-only validation on port `3199`: `/api/channel-cache/summary/UCA295QVkf9O1RQ8_-s3FVXg` returned 200 in 51ms from `channel_runtime_summary`; no background crons started.
- Small backfill validation passed: `node server/scripts/backfillChannelRuntimeSummary.js 25` selected 25, built 25, failed 0.

Phase P5 acceptance criteria:
- WTP UI distinguishes cached/stale/refreshing states.
- Original Bets, peer topics, Community Hot, and More Sources render progressively.
- Support panels never block main WTP cards.

Phase P5 validation (2026-06-08):
- V2 WTP now reads `data.cache` from the WTP response and shows `Fresh`, `Cached`, or `Refreshing` state in the header.
- If WTP returns stale cached results with a queued refresh, the UI keeps the main cards visible and polls a bounded 3 attempts for a refreshed cache payload. When fresh data arrives, main ideas, Original Bets, and metadata update without blocking the screen.
- Existing support panels remain progressive: main WTP fetch completes first, then Adjacent, Foreign Signal, Trends, and Community Hot load independently.
- The More Sources divider still renders only when a support source is loading or has content, avoiding a blank section.
- `npm run build:v2` passed.

Phase P6 acceptance criteria:
- Use `[API_TIMING]` and `[DB_TIMING]` logs to identify slow paths.
- Any interactive DB call over 500ms is either indexed, cached, paginated, or explicitly accepted with a reason.

Phase P6 validation (2026-06-08):
- Used P2/P3 telemetry to target actual slow paths: cold WTP peer/title-window queries and channel summary backfill selection.
- Added composite performance indexes for CSP peer routing, subscriber-ordered channel pools, lifecycle lookups, and channel video ordering: `idx_ccsp_primary_conf_channel`, `idx_ic_enabled_subs_name`, `idx_ic_region_enabled_subs`, `idx_ic_format_enabled_subs`, `idx_ctl_channel_phrase_stage`, `idx_iv_channel_published`, and `idx_iv_channel_views_desc`.
- Heavy `ingested_videos` indexes are gated behind worker/explicit mode so normal API startup does not build large indexes. Explicit P6 index install was run once with `RUN_HEAVY_INDEX_MIGRATIONS=1`; it completed in about 93s on 1.87M videos.
- Rewrote the channel summary backfill ordering from `ORDER BY COALESCE(ic.channel_subscribers, 0)` to `ORDER BY ic.channel_subscribers` so the subscriber index can be used.
- Syntax checks passed for `server/db/init.js` and `server/scripts/backfillChannelRuntimeSummary.js`.
- Post-index WTP cache validation passed; the remaining logged cold WTP title-window query was 325ms, below the 500ms interactive threshold.
- The 25-channel summary backfill still logged multi-second selection/insert work, but that path is a background/backfill job, not a user-facing interactive API. It is accepted for P6 and should be run in batches from the worker/maintenance lane.

Phase P7 acceptance criteria:
- Document local Postgres setup and migration path, but do not block product speed work on migration.

Phase P7 validation (2026-06-08):
- Added `docs/production-db-path.md`.
- Decision recorded: keep SQLite for laptop/local phase and rely on WAL, API/worker split, WTP cache, refresh queue, channel summary cache, and targeted indexes first.
- Postgres migration triggers documented: multi-user/multi-writer concurrency, persistent p95 latency after caching, worker queue backlog, cloud deployment needs, or risky DB file operations.
- Migration order documented: move `refresh_jobs`, then `channel_wtp_cache`, then `channel_runtime_summary`, then hot profile tables, and only later raw video/channel tables if telemetry still requires it.

Phase P8 acceptance criteria:
- Run WTP/channel UI tests with worker off and worker on.
- No hidden-ideas bug, no blank More Sources divider, no WTP request timeout under expected worker load.

Phase P8 validation (2026-06-08):
- `npm run build:v2` passed after the P5 UI changes.
- Browser WTP audit passed for Aevy TV using `server/scripts/auditWtpUiUserFlow.js 1 0`: completed 1/1, failed 0, hidden ideas bug 0, original hidden bug 0, blank More Sources 0, zero ideas 0, fallback channels 0, average peer ideas 5, average Original Bets 6. Report: `tmp/wtp-ui-audit-2026-06-08T02-01-54-153Z.json`.
- The browser audit proved the UI renders visible WTP cards and the new cache badge. The API port `3002` was already occupied during that browser run, so no-cron status for that specific UI API process was not asserted.
- Controlled API worker-on validation used API on port `3199` and a separate worker process with startup backfills disabled for the test. Worker scheduler startup completed `24/24`.
- With worker running, five Aevy WTP requests returned 200 with cache source `cache`: first client request 3,030ms during startup/lock warmup, then 107ms, 90ms, 93ms, and 76ms. Server-side API timing for the last four cached requests was 11ms, 5ms, 6ms, and 4ms.
- Controlled API logs confirmed the API process was running without background crons while the worker owned background schedulers.
- No WTP request timed out in the controlled worker-on run.

---

## 6. Refactor summary (2026-05-27)

All planned phases complete. This section records what shipped and what is permanently deferred.

### What shipped

**Backend split (§1):**
- `server/routes/creatorIntel.js` reduced from 492 → 47 lines (thin router only)
- All 24 inline handlers extracted to `server/controllers/creatorIntelController.js`
- Service modules extracted: podcastLanes, podcastGuestExtract, podcastThemes, podcastIntel, whatToPost, communityHot, creatorPeerContext, phrases

**Post-publish repair engine (Phase A + B):**
- `server/services/repair/` — 6 scoring modules + orchestrator + AI advisor
- `server/routes/videoRepair.js` — `GET /api/repair/:id` + `POST /api/repair/:id/ai`
- `server/db/init.js` — `video_repair_cache` migration
- Validation: 28/28 checks pass

**v2 native screens:**
- `src-v2/screens/PrePublish.jsx` — native v2 pre-publish UI using shared scoring engine
- `src-v2/screens/VideoRepair.jsx` — native v2 post-publish repair UI
- `src-shared/prepublish/validateVideo.js` — shared 7-layer scoring engine (used by v1 + v2)
- Scoring parity validated: 44/44 checks pass

**v2 as default shell:**
- `npm run dev` / `build` / `preview` now target v2
- v1 accessible via `dev:v1` / `build:v1` / `preview:v1`
- `dev:all` runs both frontends + scoring server

### What is permanently deferred

| Item | Reason |
|---|---|
| Archive backfill scripts (`backfill*.js`, seed scripts) | Classifier/profile systems still being iterated — may need re-run |
| Delete `src/` | Permanent protected reference — never delete |
| Delete v1 PrePublishValidator, VideoAnalysis, ImproveHub, scoring engines | Same as above |
| Migrate v1 tools into v2 | Cancelled — v2 is its own product |
| Further v1 extractions beyond `src-shared/` | Extraction boundary is closed |

### What triggers revisiting deferred items

- Backfill archive: 60+ days of no routing/format/lifecycle schema changes
- `src/` deletion: only if v1 is explicitly retired with a full port audit and sign-off
