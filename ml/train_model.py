"""
train_model.py
Dual-target Ridge regression.

Priority:
  1. performance_score from performance_metrics (real views data, training_ready=1)
  2. llm_score / 100 fallback for rows without real data
"""

import sys
import json
import sqlite3
import pickle
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from scipy.stats import spearmanr

BASE_DIR   = Path(__file__).parent
DB_PATH    = BASE_DIR.parent / "server" / "data" / "scoring.db"
MODELS_DIR = BASE_DIR / "models"
MODEL_PATH = MODELS_DIR / "model.pkl"
META_PATH  = MODELS_DIR / "meta.json"

MODELS_DIR.mkdir(exist_ok=True)

FEATURE_COLS = [
    "title_length",
    "has_number",
    "has_power_word",
    "hook_question_present",
    "upload_day",
    "days_since_last_upload",
    "niche_trend_score",
    "curiosity_score",
    "urgency_score",
    "specificity_score",
    "power_word_score",
    "sentiment_score",
]

def load_data():
    conn = sqlite3.connect(DB_PATH)

    # Include ALL videos that have features + either:
    #   a) real performance data (training_ready=1) — ingested videos
    #   b) an LLM score — manually analyzed videos
    # Left-join predictions so ingested videos (no LLM) are not excluded.
    df = pd.read_sql_query("""
        SELECT
            v.id AS video_id,
            f.title_length,
            f.has_number,
            f.has_power_word,
            f.hook_question_present,
            f.upload_day,
            f.days_since_last_upload,
            f.niche_trend_score,
            f.curiosity_score,
            f.urgency_score,
            f.specificity_score,
            f.power_word_score,
            f.sentiment_score,
            p.llm_score,
            pm.performance_score,
            COALESCE(pm.training_ready, 0) AS training_ready
        FROM videos v
        JOIN features f ON f.video_id = v.id
        LEFT JOIN predictions p ON p.video_id = v.id
        LEFT JOIN performance_metrics pm ON pm.video_id = v.id
        WHERE pm.training_ready = 1 OR p.llm_score IS NOT NULL
    """, conn)
    conn.close()
    return df

def normalize_performance_score(series):
    """
    Map raw performance_score (log-scale, ~-5 to +4) onto [0, 1].
    Clip to [-3, 3] then scale: (score + 3) / 6
      -3 → 0.00  (dead video)
       0 → 0.50  (average)
      +3 → 1.00  (viral)
    Comparable to llm_score / 100 which lives in ~[0.60, 0.85].
    """
    clipped = series.clip(-3, 3)
    return (clipped + 3) / 6

def build_target(df):
    """
    Assign training target per row (both sources normalized to [0, 1]):
      - normalized performance_score if training_ready=1 and value is finite
      - llm_score / 100 otherwise
    """
    df = df.copy()
    df["target_source"] = "llm_fallback"
    df["target"]        = df["llm_score"] / 100.0

    perf_mask = (
        (df["training_ready"] == 1) &
        df["performance_score"].notna() &
        np.isfinite(df["performance_score"].fillna(0))
    )

    if perf_mask.any():
        normalized = normalize_performance_score(df.loc[perf_mask, "performance_score"])
        print(f"[train_model] normalized_score range: "
              f"min={normalized.min():.4f}  max={normalized.max():.4f}  "
              f"mean={normalized.mean():.4f}")
        df.loc[perf_mask, "target"]        = normalized
        df.loc[perf_mask, "target_source"] = "performance"

    return df

def main():
    print("[train_model] Loading data from SQLite...")
    df = load_data()
    print(f"[train_model] Raw rows loaded: {len(df)}")

    df["days_since_last_upload"] = df["days_since_last_upload"].fillna(0)

    # Drop rows missing all feature columns
    df = df.dropna(subset=FEATURE_COLS)
    # Drop rows with no viable target (neither real performance nor llm score)
    df = df[df["llm_score"].notna() | (df["training_ready"] == 1)]
    print(f"[train_model] Rows after dropping nulls: {len(df)}")

    if len(df) < 10:
        print("[train_model] Not enough data (need >= 10 rows). Aborting.")
        sys.exit(1)

    df = build_target(df)

    n_perf = (df["target_source"] == "performance").sum()
    n_llm  = (df["target_source"] == "llm_fallback").sum()
    pct_perf = round(100 * n_perf / len(df), 1)
    pct_llm  = round(100 * n_llm  / len(df), 1)

    print(f"[train_model] TRAINING TARGET = {'PERFORMANCE' if n_perf > 0 else 'LLM FALLBACK'}")
    print(f"[train_model] performance rows : {n_perf} ({pct_perf}%)")
    print(f"[train_model] llm_fallback rows : {n_llm} ({pct_llm}%)")

    X = df[FEATURE_COLS].values.astype(float)
    y = df["target"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    print(f"[train_model] Train: {len(X_train)} | Test: {len(X_test)}")

    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("model",  Ridge(alpha=1.0)),
    ])
    pipeline.fit(X_train, y_train)

    y_pred = pipeline.predict(X_test)
    mae    = float(np.mean(np.abs(y_test - y_pred)))
    rho, _ = spearmanr(y_test, y_pred)

    print(f"[train_model] MAE:      {mae:.4f}")
    print(f"[train_model] Spearman: {rho:.4f}")

    with open(MODEL_PATH, "wb") as f:
        pickle.dump(pipeline, f)

    dominant_target = "performance" if n_perf >= n_llm else "llm_score / 100"
    meta = {
        "trained_at":        datetime.utcnow().isoformat() + "Z",
        "target":            dominant_target,
        "performance_rows":  int(n_perf),
        "llm_fallback_rows": int(n_llm),
        "training_rows":     len(X_train),
        "test_rows":         len(X_test),
        "mae":               round(mae, 4),
        "spearman":          round(float(rho), 4),
        "feature_cols":      FEATURE_COLS,
    }
    with open(META_PATH, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"[train_model] Saved to {MODEL_PATH}")

if __name__ == "__main__":
    main()
