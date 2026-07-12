# Production DB Path

Date: 2026-06-08

## Current Decision

Keep SQLite for the laptop/local phase. The speed work should come from API/worker separation, WTP cache, refresh queue, channel summaries, and indexes first.

Do not switch to Postgres just because the DB is large. Switch when concurrency, deployment, or operational needs require it.

## Why SQLite Is Still OK Short-Term

- WAL mode is enabled, so reads can continue while a writer is active.
- The API process is now no-cron by default, so user requests do not share one process with RSS, DNA, snapshot, ingest, backup, or intelligence jobs.
- WTP can be served from `channel_wtp_cache`.
- Channel header/detail reads can be served from `channel_runtime_summary`.
- Heavy backfills and large index work are worker/maintenance responsibilities.

## When To Move To Postgres

Move when at least one is true:

- More than one real user or machine needs to write at the same time.
- API p95 latency stays high even after cached WTP and channel summaries are populated.
- Background worker queue depth grows faster than workers can drain it.
- You need cloud deployment with durable backups, monitoring, role-based access, or remote workers.
- DB file management becomes operationally risky on the laptop.

## Local Postgres Bridge

When ready, start with local Postgres on the laptop before a dedicated server:

- Keep the Node API and worker split unchanged.
- Add a DB adapter layer only around high-traffic tables first.
- Migrate cache/queue/summary tables first: `refresh_jobs`, `channel_wtp_cache`, `channel_runtime_summary`.
- Keep archival/source tables in SQLite until the app proves Postgres is needed for them.
- Run dual-read validation for a small channel set before moving writes.

## Migration Order

1. Create Postgres schema for `refresh_jobs`.
2. Move queue writes/claims to Postgres.
3. Move `channel_wtp_cache`.
4. Move `channel_runtime_summary`.
5. Move hot profile tables if needed: `creator_idea_dna`, `channel_content_strategy_profiles`, `channel_territory_profiles`.
6. Move raw video/channel tables only if telemetry still says they are the bottleneck.

## Non-Goals For Now

- Do not rewrite all queries for Postgres during the laptop phase.
- Do not require a dedicated server before launch prep.
- Do not block WTP speed work on database migration.
