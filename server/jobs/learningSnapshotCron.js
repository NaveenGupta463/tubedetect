'use strict';

const cron   = require('node-cron');
const crypto = require('crypto');
const { getDb }                                              = require('../db/init');
const logger                                                 = require('../utils/logger');
const { computeLearningSnapshot }                            = require('../services/intelligenceHealth');
const { insertLearningSnapshot, getLatestLearningSnapshot,
        upsertNicheReliability, insertScoringWeightAudit,
        insertIntelligenceVersion, getLatestBenchmarkSnapshotId,
        getActiveScoringVersionByType, getMostRecentAuditForType }  = require('../db/queries');
const { computeNicheReliability, backfillFreshnessWeights }  = require('../services/calibrationEngine');
const { runSyntheticTransition }                             = require('../services/syntheticTransition');
const scoreCache                                             = require('../services/scoreCache');

// ── Health snapshot ────────────────────────────────────────────────────────────

async function runLearningSnapshotCycle() {
  const db   = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const existing = getLatestLearningSnapshot(db);
  if (existing?.snapshot_date === today) {
    logger.info('learningSnapshotCron', `Snapshot already exists for ${today} — skipping`);
    return { skipped: true, date: today };
  }

  const snapshot = computeLearningSnapshot(db);
  insertLearningSnapshot(db, snapshot);

  logger.info('learningSnapshotCron', `Snapshot saved for ${today}: mae=${snapshot.mae} trust=${snapshot.calibration_trust_score} total=${snapshot.total_calibration_rows}`);

  // E3 — Update per-niche reliability scores
  computeAndSaveNicheReliability(db);

  // E2 — Run synthetic transition policy
  try {
    const transResult = runSyntheticTransition(db);
    if (transResult.total_expired > 0) {
      logger.info('learningSnapshotCron', `Synthetic transition: expired ${transResult.total_expired} rows across ${transResult.niches_processed} niches`);
    }
  } catch (err) {
    logger.warn('learningSnapshotCron', `Synthetic transition error: ${err.message}`);
  }

  // Backfill freshness weights for rows that still have default value
  try {
    const backfilled = backfillFreshnessWeights(db);
    if (backfilled > 0) {
      logger.info('learningSnapshotCron', `Backfilled freshness weights for ${backfilled} outcome rows`);
    }
  } catch (err) {
    logger.warn('learningSnapshotCron', `Freshness backfill error: ${err.message}`);
  }

  // E7 — Auto-rollback gate: trigger if health dropped >20pts in 7 days
  try {
    await checkAutoRollbackGate(db, snapshot);
  } catch (err) {
    logger.warn('learningSnapshotCron', `Auto-rollback check error: ${err.message}`);
  }

  return { ok: true, snapshot };
}

// ── E3: Niche Reliability ─────────────────────────────────────────────────────

function computeAndSaveNicheReliability(db) {
  const niches = db.all(
    `SELECT DISTINCT LOWER(TRIM(COALESCE(niche, 'unknown'))) AS niche
     FROM video_outcomes WHERE actual_performance_score IS NOT NULL`,
  ).map(r => r.niche);

  let saved = 0;
  for (const niche of niches) {
    try {
      const rel = computeNicheReliability(db, niche);
      upsertNicheReliability(db, rel);
      saved++;
    } catch (err) {
      logger.warn('learningSnapshotCron', `Reliability compute error for ${niche}: ${err.message}`);
    }
  }
  logger.info('learningSnapshotCron', `Niche reliability updated for ${saved} niches`);
}

// ── E7: Auto-Rollback Gate ─────────────────────────────────────────────────────
// Rolls back ensemble_weights if health_score dropped >20pts vs 7 days ago.

async function checkAutoRollbackGate(db, currentSnapshot) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const oldSnapshot = db.get(
    `SELECT calibration_trust_score FROM learning_health_snapshots
     WHERE snapshot_date <= ? ORDER BY snapshot_date DESC LIMIT 1`,
    [sevenDaysAgo],
  );

  if (!oldSnapshot) return;

  const currentScore = currentSnapshot.calibration_trust_score ?? 0;
  const oldScore     = oldSnapshot.calibration_trust_score ?? 0;
  const drop         = oldScore - currentScore;

  if (drop <= 20) return;

  logger.warn('learningSnapshotCron', `AUTO-ROLLBACK TRIGGERED: health dropped ${drop.toFixed(1)}pts over 7 days (${oldScore} → ${currentScore})`);

  const versionType  = 'ensemble_weights';
  const currentActive = getActiveScoringVersionByType(db, versionType);
  const lastAudit     = getMostRecentAuditForType(db, versionType);

  if (!lastAudit?.old_version_id) {
    logger.warn('learningSnapshotCron', 'Auto-rollback: no previous version in audit log — skipping');
    return;
  }

  const targetVersion = db.get('SELECT * FROM scoring_versions WHERE id = ?', [lastAudit.old_version_id]);
  if (!targetVersion) {
    logger.warn('learningSnapshotCron', 'Auto-rollback: previous version not found — skipping');
    return;
  }

  db.run('UPDATE scoring_versions SET active = 0 WHERE version_type = ?', [versionType]);
  db.run('UPDATE scoring_versions SET active = 1 WHERE id = ?', [targetVersion.id]);

  insertScoringWeightAudit(db, {
    id:                   crypto.randomUUID(),
    version_type:         versionType,
    old_version_id:       currentActive?.id ?? null,
    new_version_id:       targetVersion.id,
    old_weights_json:     currentActive?.weights_json ?? null,
    new_weights_json:     targetVersion.weights_json ?? '{}',
    trigger_reason:       'auto_rollback_health_drop',
    applied_by:           'auto_rollback_gate',
    rollback_of_audit_id: lastAudit.id,
  });

  insertIntelligenceVersion(db, {
    id:                         crypto.randomUUID(),
    trigger:                    'rollback',
    scoring_version_id:         targetVersion.id,
    prev_weights_json:          currentActive?.weights_json ?? null,
    new_weights_json:           targetVersion.weights_json ?? null,
    health_score:               currentScore,
    learning_velocity:          currentSnapshot.learning_velocity ?? 'unknown',
    benchmark_snapshot_id:      getLatestBenchmarkSnapshotId(db),
    notes:                      `Auto-rollback: health dropped ${drop.toFixed(1)}pts in 7 days (${oldScore.toFixed(1)} → ${currentScore.toFixed(1)})`,
    rollback_tag:               'auto_health_drop',
    rollback_source_version_id: currentActive?.id ?? null,
  });

  scoreCache.bumpVersionStamp();

  logger.info('learningSnapshotCron', `Auto-rollback complete: reverted to version ${targetVersion.id} (${targetVersion.version_name})`);
}

function startLearningSnapshotCron() {
  cron.schedule('0 2 * * *', () => {
    runLearningSnapshotCycle().catch(err =>
      logger.error('learningSnapshotCron', err.message),
    );
  });
  logger.info('learningSnapshotCron', 'Scheduled — daily at 02:00 UTC');
}

module.exports = { runLearningSnapshotCycle, startLearningSnapshotCron };
