# forecast_service.py
# Flask service for sequence-to-sequence LSTM forecasting
import os
import json
from datetime import datetime, timedelta

from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import pandas as pd
import joblib
from tensorflow.keras.models import load_model

# config.py constants
from config import SEQ_LEN, HORIZON, FEATURE_COLS, MODEL_PATH as CFG_MODEL_PATH, SCALER_PATH as CFG_SCALER_PATH, FILE_PATH

# Optional environment overrides
MODEL_METADATA_PATH = os.environ.get('MODEL_METADATA_PATH', 'model_metadata.json')
FORECAST_SERVICE_HOST = os.environ.get('FORECAST_SERVICE_HOST', '0.0.0.0')
FORECAST_SERVICE_PORT = int(os.environ.get('FORECAST_SERVICE_PORT', 8000))
CATEGORY_MODEL_PATH = os.environ.get('CATEGORY_MODEL_PATH', '../../models/expense_category_model.pkl')

# Initialize Flask app once
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Globals that hold loaded models/scalers and run id
MODEL_OBJ = None
SCALER_OBJ = None
CURRENT_MODEL_RUN_ID = None

# sanitize CFG_MODEL_PATH (fix accidental double suffix e.g., '...h5.h5')
MODEL_PATH = CFG_MODEL_PATH
if MODEL_PATH.endswith('.h5.h5'):
    MODEL_PATH = MODEL_PATH.replace('.h5.h5', '.h5')

SCALER_PATH = CFG_SCALER_PATH

# Category model (loaded lazily to avoid crash if not present at startup)
CATEGORY_MODEL = None


def load_model_and_scaler_from_metadata():
    """
    If MODEL_METADATA_PATH exists and contains local_model_path/scaler_path/run_id,
    prefer those. Otherwise fall back to MODEL_PATH / SCALER_PATH from config.
    """
    global MODEL_OBJ, SCALER_OBJ, CURRENT_MODEL_RUN_ID, MODEL_PATH, SCALER_PATH
    model_path = MODEL_PATH
    scaler_path = SCALER_PATH
    run_id = None

    if os.path.exists(MODEL_METADATA_PATH):
        try:
            with open(MODEL_METADATA_PATH, 'r') as f:
                meta = json.load(f)
            # prefer meta local paths if provided
            model_path = meta.get('local_model_path') or model_path
            scaler_path = meta.get('scaler_path') or scaler_path
            run_id = meta.get('run_id') or meta.get('mlflow_run') or meta.get('run')
            print(f"[forecast_service] using metadata model_path={model_path}, scaler_path={scaler_path}, run_id={run_id}")
        except Exception as e:
            print("[forecast_service] failed to read metadata file:", e)

    # attempt to load Keras model
    try:
        MODEL_OBJ = load_model(model_path)
        print(f"[forecast_service] loaded model from {model_path}")
    except Exception as e:
        MODEL_OBJ = None
        print(f"[forecast_service] failed to load model at {model_path}: {e}")

    # attempt to load scaler
    try:
        SCALER_OBJ = joblib.load(scaler_path)
        print(f"[forecast_service] loaded scaler from {scaler_path}")
    except Exception as e:
        SCALER_OBJ = None
        print(f"[forecast_service] failed to load scaler at {scaler_path}: {e}")

    CURRENT_MODEL_RUN_ID = run_id


# Load model/scaler at startup (best-effort)
load_model_and_scaler_from_metadata()

# CATEGORY MODEL helpers (lazy load)
def load_category_model():
    global CATEGORY_MODEL
    if CATEGORY_MODEL is None:
        try:
            CATEGORY_MODEL = joblib.load(CATEGORY_MODEL_PATH)
            print(f"[forecast_service] loaded category model from {CATEGORY_MODEL_PATH}")
        except Exception as e:
            CATEGORY_MODEL = None
            print(f"[forecast_service] failed to load category model at {CATEGORY_MODEL_PATH}: {e}")
    return CATEGORY_MODEL


@app.route('/predict', methods=['POST'])
def predict():
    """
    Category prediction endpoint.
    Note: depends on how your category model expects input — adapt preprocess accordingly.
    """
    model = load_category_model()
    if model is None:
        return jsonify({'error': 'category model not available'}), 503

    data = request.get_json(force=True)
    description = data.get('description', '')
    if not description:
        return jsonify({'error': 'Description is required'}), 400

    try:
        # If your model expects tokenized vectors, you must preprocess the description before predict.
        # Here we call predict directly as your previous code did — adjust as needed.
        pred = model.predict([description])
        category = pred[0]
        return jsonify({'category': category})
    except Exception as e:
        print('[forecast_service] category predict error:', e)
        return jsonify({'error': 'prediction failed', 'details': str(e)}), 500


@app.route('/forecast', methods=['POST'])
def forecast():
    """
    Expects JSON input with:
      {
        "series": [numeric values],    # historical daily totals (most recent last)
        // "dates" is optional; if not provided, dates are assumed to be consecutive days ending today
      }

    Returns:
      {
        "daywise": [...],
        "forecast": <sum>,
        "horizon_days": HORIZON,
        "model_run_id": <run_id or null>
      }
    """
    global MODEL_OBJ, SCALER_OBJ, CURRENT_MODEL_RUN_ID

    data = request.get_json(force=True)
    series = data.get('series')
    dates = data.get('dates', None)

    # Validate series
    if not isinstance(series, list) or len(series) < SEQ_LEN:
        return jsonify({"error": f"'series' must be a list of at least {SEQ_LEN} values."}), 400

    # Generate or validate dates
    if dates is None:
        end = pd.Timestamp.today().normalize()
        start = end - pd.Timedelta(days=len(series) - 1)
        dates = pd.date_range(start, periods=len(series), freq='D').strftime('%Y-%m-%d').tolist()
    else:
        if not isinstance(dates, list) or len(dates) != len(series):
            return jsonify({"error": "If provided, 'dates' must be a list matching length of 'series'."}), 400

    # Build DataFrame with rolling values and features
    df = pd.DataFrame({'roll7': series}, index=pd.to_datetime(dates))
    df['log_amt'] = np.log1p(df['roll7'])
    df['dow'] = df.index.dayofweek
    df['is_weekend'] = (df['dow'] >= 5).astype(int)

    if SCALER_OBJ is None or MODEL_OBJ is None:
        # Attempt to reload once more if models weren't present at startup
        load_model_and_scaler_from_metadata()
        if SCALER_OBJ is None or MODEL_OBJ is None:
            return jsonify({'error': 'server model not loaded; try again later'}), 503

    try:
        # Scale features
        feat_vals = df[FEATURE_COLS].values
        scaled_vals = SCALER_OBJ.transform(feat_vals)

        # Prepare last sequence window
        last_seq = scaled_vals[-SEQ_LEN:]
        input_seq = last_seq.reshape(1, SEQ_LEN, len(FEATURE_COLS))

        # Predict next HORIZON days
        pred_scaled = MODEL_OBJ.predict(input_seq)[0, :, 0]

        # Invert scaling and log transformation
        dummy = np.zeros((HORIZON, len(FEATURE_COLS)))
        dummy[:, 0] = pred_scaled
        inv = SCALER_OBJ.inverse_transform(dummy)[:, 0]  # back to log_amt
        forecast = np.expm1(inv).tolist()

        amount = float(sum(forecast))

        return jsonify({
            "daywise": forecast,
            "forecast": amount,
            "horizon_days": HORIZON,
            "model_run_id": CURRENT_MODEL_RUN_ID
        })
    except Exception as e:
        print('[forecast_service] forecast error:', e)
        return jsonify({'error': 'forecast failed', 'details': str(e)}), 500


@app.route('/retrain', methods=['POST'])
def retrain():
    """
    Convenience endpoint to retrain the model from posted series (or using internal data).
    In production we will trigger retrains via Kafka and a retrain worker; keep this for local/manual usage.
    """
    data = request.get_json(silent=True) or {}
    series = data.get('series', [])

    if not isinstance(series, list):
        # allow empty body to trigger pipeline on existing FILE_PATH as well
        series = []

    # Basic validation if provided
    if series and (len(series) < 30 or len(series) > 365):
        return jsonify({'error': 'Series must be a list of 30–365 numeric values.'}), 400

    # If a series is provided, construct and save it to FILE_PATH so pipeline uses it
    if series:
        start_date = datetime.today() - timedelta(days=len(series) - 1)
        dates = pd.date_range(start=start_date, periods=len(series))
        df = pd.DataFrame({'Date / Time': dates, 'Debit/Credit': series})
        df.set_index('Date / Time', inplace=True)
        # Save to configured FILE_PATH used by pipeline
        df.to_excel(FILE_PATH)
        print(f'[forecast_service] saved training file to {FILE_PATH} (rows={len(series)})')

    # Run pipeline (synchronous). In production, prefer publishing retrain request to Kafka.
    try:
        # Lazy import to avoid circular import problems
        from forecast_pipeline import run_pipeline
        meta = run_pipeline()
        # After pipeline finishes, reload model/scaler
        load_model_and_scaler_from_metadata()
        return jsonify({'status': 'retraining complete', 'meta': meta})
    except Exception as e:
        print('[forecast_service] retrain failed:', e)
        return jsonify({'error': 'retrain failed', 'details': str(e)}), 500


@app.route('/reload_model', methods=['POST'])
def reload_model():
    """
    Internal endpoint: ask service to reload the latest model and scaler.
    Intended to be called by your ModelRegistry consumer after a retrain completes.
    Protect this endpoint in production (internal secret or mutual TLS).
    """
    try:
        payload = request.get_json(silent=True) or {}
        requested_run = payload.get('run_id')
        # We ignore requested_run for now and simply reload metadata-based model
        load_model_and_scaler_from_metadata()
        return jsonify({'ok': True, 'run_id': CURRENT_MODEL_RUN_ID})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


if __name__ == '__main__':
    # Use explicit host/port from env or defaults
    app.run(host=FORECAST_SERVICE_HOST, port=FORECAST_SERVICE_PORT)
