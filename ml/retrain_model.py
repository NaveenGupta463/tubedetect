"""
retrain_model.py
Same as train_model.py but:
  - Only retrains if training_ready count > 300
  - Logs performance delta vs previous model
  - Backs up old model before replacing
"""

import sys
import json
import sqlite3
import pickle
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from scipy.stats import spearmanr

BASE_DIR   = Path(__file__).parent
DB_PATH    = BASE_DIR.parent / "server" / "data" / "scoring.db"
MODELS_DIR = BASE_DIR / "models"
MODEL_PATH = MODELS_DIR / "model.pkl"
META_PATH  = MODELS_DIR / "meta.json"
BACKUP_PATH = MODELS_DIR / "model_prev.pkl"

MODELS_DIR.mkdir(exist_ok=True)

MIN_ROWS = 300

FEATURE_COLS = [
    "title_length", "has_number", "has_power_word",
    "hook_question_present", "upload_day",
    "days_since_last_upload", "niche_trend_score",
]

def load_data():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("""
        SELECT
            f.title_length, f.has_number, f.has_power_word,
            f.hook_question_present, f.upload_day,
            f.days_since_last_upload, f.niche_trend_score,
            v.channel_size,
            pm.views_30d, pm.performance_score
        FROM performance_metrics pm
        JOIN videos   v ON v.id = pm.video_id
        JOIN features f ON f.video_id = pm.video_id
        WHERE pm.training_ready = 1
    """, conn)
    conn.close()
    return df

def clean_data(df):
    df = df[df["views_30d"] >= 100].copy()
    df = df[df["performance_score"].notna()].copy()
    df = df[np.isfinite(df["performance_score"])].copy()
    df = df[FEATURE_COLS + ["performance_score"]].dropna()
    return df

def main():
    print("[retrain] Checking training_ready count...")
    conn = sqlite3.connect(DB_PATH)
    count = conn.execute(
        "SELECT COUNT(*) FROM performance_metrics WHERE training_ready = 1"
    ).fetchone()[0]
    conn.close()

    print(f"[retrain] training_ready rows: {count} (minimum: {MIN_ROWS})")
    if count < MIN_ROWS:
        print(f"[retrain] Not enough data. Skipping retrain.")
        sys.exit(0)

    df = load_data()
    df = clean_data(df)

    if len(df) < MIN_ROWS:
        print(f"[retrain] After cleaning only {len(df)} rows remain. Skipping.")
        sys.exit(0)

    X = df[FEATURE_COLS].values
    y = df["performance_score"].values

    # Sample weights: log-normalized channel size
    sizes = df.get("channel_size", None)
    if sizes is not None and sizes.notna().all():
        log_sizes = np.log1p(sizes.values)
        weights   = log_sizes / log_sizes.sum() * len(log_sizes)
    else:
        weights = np.ones(len(df))

    new_pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("model",  Ridge(alpha=1.0)),
    ])
    new_pipeline.fit(X, y, model__sample_weight=weights)

    y_pred  = new_pipeline.predict(X)
    mae_new = float(np.mean(np.abs(y - y_pred)))
    rho_new = float(spearmanr(y, y_pred)[0])

    # Compare with previous model if it exists
    if MODEL_PATH.exists():
        with open(MODEL_PATH, "rb") as f:
            old_pipeline = pickle.load(f)
        y_old   = old_pipeline.predict(X)
        mae_old = float(np.mean(np.abs(y - y_old)))
        rho_old = float(spearmanr(y, y_old)[0])
        print(f"[retrain] Previous model  → MAE: {mae_old:.4f}, Spearman: {rho_old:.4f}")
        print(f"[retrain] New model       → MAE: {mae_new:.4f}, Spearman: {rho_new:.4f}")
        delta_mae = mae_new - mae_old
        print(f"[retrain] Delta MAE: {delta_mae:+.4f} ({'worse' if delta_mae > 0 else 'better'})")
        # Backup old model
        shutil.copy(MODEL_PATH, BACKUP_PATH)
    else:
        print(f"[retrain] No previous model found. Fresh training.")
        print(f"[retrain] New model → MAE: {mae_new:.4f}, Spearman: {rho_new:.4f}")

    with open(MODEL_PATH, "wb") as f:
        pickle.dump(new_pipeline, f)

    meta = {
        "trained_at":    datetime.utcnow().isoformat() + "Z",
        "training_rows": len(df),
        "mae":           round(mae_new, 4),
        "spearman":      round(rho_new, 4),
        "feature_cols":  FEATURE_COLS,
    }
    with open(META_PATH, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"[retrain] Model saved to {MODEL_PATH}")

if __name__ == "__main__":
    main()
