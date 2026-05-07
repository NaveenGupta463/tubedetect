"""
predict.py
Reads feature JSON from stdin, returns {"ml_score": float} on stdout.
Called by ensembleScoring.js via child_process.execSync with input option.
"""

import sys
import json
import pickle
import numpy as np
from pathlib import Path

BASE_DIR   = Path(__file__).parent
MODEL_PATH = BASE_DIR / "models" / "model.pkl"

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

def error_exit(msg):
    print(json.dumps({"error": msg}), file=sys.stderr)
    sys.exit(1)

def main():
    if not MODEL_PATH.exists():
        error_exit(f"Model not found at {MODEL_PATH}")

    raw = sys.stdin.read().strip()
    if not raw:
        error_exit("No input received on stdin")

    try:
        features = json.loads(raw)
    except json.JSONDecodeError as e:
        error_exit(f"Invalid JSON: {e}")

    # Fill missing fields with 0
    x = np.array([[features.get(col, 0) or 0 for col in FEATURE_COLS]], dtype=float)

    try:
        with open(MODEL_PATH, "rb") as f:
            pipeline = pickle.load(f)
    except Exception as e:
        error_exit(f"Failed to load model: {e}")

    # Model predicts llm_score / 100 — scale back to 0-100
    raw_pred = float(pipeline.predict(x)[0])
    ml_score = round(min(100.0, max(0.0, raw_pred * 100)), 2)

    print(json.dumps({"ml_score": ml_score}))

if __name__ == "__main__":
    main()
