# forecast_service.py
# Flask service for sequence-to-sequence LSTM forecasting
import os
import json
import threading
from datetime import datetime, timedelta

from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import pandas as pd
import joblib
from tensorflow.keras.models import load_model
import requests

# import your python kafka publisher (expects publish(topic, payload, key=None, **opts))
from kafka_producer import publish as kafka_publish

# config.py constants
from config import SEQ_LEN, HORIZON, FEATURE_COLS, MODEL_PATH as CFG_MODEL_PATH, SCALER_PATH as CFG_SCALER_PATH, FILE_PATH

# Optional environment overrides
MODEL_METADATA_PATH = os.environ.get('MODEL_METADATA_PATH', 'model_metadata.json')
FORECAST_SERVICE_HOST = os.environ.get('FORECAST_SERVICE_HOST', '0.0.0.0')
FORECAST_SERVICE_PORT = int(os.environ.get('FORECAST_SERVICE_PORT', 8000))
CATEGORY_MODEL_PATH = os.environ.get('CATEGORY_MODEL_PATH', '../../models/expense_category_model.pkl')
RETRAIN_TOPIC = os.environ.get('TOPIC_RETRAIN', 'finpilot.model.retrain')
PREDICTIONS_TOPIC = os.environ.get('TOPIC_PREDICTIONS', 'finpilot.predictions')
MODEL_REGISTRY_TOPIC = os.environ.get('TOPIC_MODEL_REGISTRY', 'finpilot.model.registry')
SERVICE_NAME = os.environ.get('FORECAST_SERVICE_NAME', 'forecast-service')

# Admin API (server) used to read ModelRegistry info (active per-user/global)
ADMIN_API = os.environ.get('ADMIN_API') or os.environ.get('SERVER_ADMIN_URL') or 'http://localhost:5000/api/admin'
# Internal secret expected on protected internal calls (optional)
INTERNAL_SECRET = os.environ.get('INTERNAL_SECRET')

# Cache / concurrency settings
MODEL_CACHE_MAX = int(os.environ.get('MODEL_CACHE_MAX', '20'))
MODEL_CACHE_LOCK = threading.Lock()  # guard MODEL_CACHE operations
MODEL_CACHE = {}  # structure: { user_id: { model:..., scaler:..., run_id:..., last_used: ts } }

# Globals that hold loaded models/scalers and run id (global fallback)
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


def load_keras_model_safe(path):
    """
    Attempt to load a Keras model from path; returns model or raises
    """
    return load_model(path)


def load_scaler_safe(path):
    """
    Load a scaler using joblib; returns scaler or raises
    """
    return joblib.load(path)


def load_model_and_scaler_paths(model_path, scaler_path):
    """
    Try to load model and scaler from given filesystem paths.
    Returns tuple (model_obj, scaler_obj). Raises if both can't be loaded.
    """
    model_obj = None
    scaler_obj = None
    errors = []
    if not model_path:
        errors.append('model_path missing')
    else:
        try:
            model_obj = load_keras_model_safe(model_path)
            print(f"[forecast_service] loaded keras model from {model_path}")
        except Exception as e:
            errors.append(f"model load failed: {e}")

    if not scaler_path:
        errors.append('scaler_path missing')
    else:
        try:
            scaler_obj = load_scaler_safe(scaler_path)
            print(f"[forecast_service] loaded scaler from {scaler_path}")
        except Exception as e:
            errors.append(f"scaler load failed: {e}")

    if model_obj is None or scaler_obj is None:
        raise RuntimeError("Failed to load model/scaler: " + "; ".join(errors))

    return model_obj, scaler_obj


def load_model_and_scaler_from_metadata():
    """
    If MODEL_METADATA_PATH exists and contains local_model_path/scaler_path/run_id,
    prefer those. Otherwise fall back to MODEL_PATH / SCALER_PATH from config.
    This sets the global MODEL_OBJ, SCALER_OBJ, CURRENT_MODEL_RUN_ID (global fallback).
    """
    global MODEL_OBJ, SCALER_OBJ, CURRENT_MODEL_RUN_ID, MODEL_PATH, SCALER_PATH
    model_path = MODEL_PATH
    scaler_path = SCALER_PATH
    run_id = None

    if os.path.exists(MODEL_METADATA_PATH):
        try:
            with open(MODEL_METADATA_PATH, 'r') as f:
                meta = json.load(f)
            model_path = meta.get('local_model_path') or model_path
            scaler_path = meta.get('scaler_path') or scaler_path
            run_id = meta.get('run_id') or meta.get('mlflow_run') or meta.get('run') or run_id
            print(f"[forecast_service] using metadata model_path={model_path}, scaler_path={scaler_path}, run_id={run_id}")
        except Exception as e:
            print("[forecast_service] failed to read metadata file:", e)

    try:
        MODEL_OBJ, SCALER_OBJ = load_model_and_scaler_paths(model_path, scaler_path)
    except Exception as e:
        MODEL_OBJ = None
        SCALER_OBJ = None
        print(f"[forecast_service] failed to load default model/scaler from {model_path},{scaler_path}: {e}")

    CURRENT_MODEL_RUN_ID = run_id


# Load default model/scaler at startup (best-effort)
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


# ----------------- Per-user model helpers -----------------
def _evict_if_needed_locked():
    """
    Evict least-recently-used entries if cache exceeds MODEL_CACHE_MAX.
    Caller must hold MODEL_CACHE_LOCK.
    """
    if len(MODEL_CACHE) <= MODEL_CACHE_MAX:
        return
    # Sort by last_used ascending and remove oldest entries until below threshold
    items = sorted(MODEL_CACHE.items(), key=lambda kv: kv[1].get('last_used', 0))
    while len(MODEL_CACHE) > MODEL_CACHE_MAX:
        key_to_remove, _ = items.pop(0)
        entry = MODEL_CACHE.pop(key_to_remove, None)
        print(f"[forecast_service] evicted model cache for user={key_to_remove} run_id={entry.get('run_id') if entry else 'n/a'}")


def get_cached_model_for_user(user_id, run_id):
    """
    Return (model, scaler, run_id) if cached & matches run_id (or any if run_id is None).
    Updates last_used timestamp.
    """
    with MODEL_CACHE_LOCK:
        entry = MODEL_CACHE.get(str(user_id))
        if not entry:
            return None, None, None
        # If run_id specified and mismatch, consider it not usable
        if run_id and entry.get('run_id') != run_id:
            return None, None, None
        # update last used
        entry['last_used'] = datetime.utcnow().timestamp()
        return entry.get('model'), entry.get('scaler'), entry.get('run_id')


def set_cached_model_for_user(user_id, model_obj, scaler_obj, run_id):
    """
    Store model/scaler in cache for the user.
    """
    with MODEL_CACHE_LOCK:
        MODEL_CACHE[str(user_id)] = {
            'model': model_obj,
            'scaler': scaler_obj,
            'run_id': run_id,
            'last_used': datetime.utcnow().timestamp()
        }
        _evict_if_needed_locked()


def fetch_active_model_metadata_for_user(user_id):
    """
    Ask Admin API for active model for user; falls back to global active if not found.
    Returns metadata dict or None. Expected fields include run_id, local_model_path, scaler_path.
    """
    try:
        params = {'model_name': 'forecast'}
        if user_id:
            params['user_id'] = str(user_id)
        url = f"{ADMIN_API.rstrip('/')}/models/active"
        res = requests.get(url, params=params, timeout=6)
        if res.ok:
            data = res.json()
            # admin may return {} or doc; when empty return None
            if not data:
                # fallback: if we requested user-specific and got none, ask for global (without user_id)
                if user_id:
                    res2 = requests.get(url, params={'model_name': 'forecast'}, timeout=6)
                    if res2.ok and res2.json():
                        return res2.json()
                return None
            return data
        else:
            print(f"[forecast_service] admin API returned non-200 for active model: {res.status_code} {res.text}")
            return None
    except Exception as e:
        print("[forecast_service] failed to query admin API for active model:", e)
        return None


def load_and_cache_model_for_user(user_id, metadata):
    """
    Given admin metadata dict with local_model_path & scaler_path & run_id, attempt to load and cache for user.
    Returns (model_obj, scaler_obj, run_id) or (None,None,None) on failure.
    """
    if not metadata:
        return None, None, None
    run_id = metadata.get('run_id') or metadata.get('runId') or metadata.get('run')
    model_path = metadata.get('local_model_path') or metadata.get('localModelPath') or metadata.get('local_path') or ''
    scaler_path = metadata.get('scaler_path') or metadata.get('scalerPath') or metadata.get('scaler_path') or ''
    if not run_id or not model_path or not scaler_path:
        print("[forecast_service] metadata missing required fields for user model load:", metadata)
        return None, None, None
    try:
        model_obj, scaler_obj = load_model_and_scaler_paths(model_path, scaler_path)
        set_cached_model_for_user(user_id, model_obj, scaler_obj, run_id)
        return model_obj, scaler_obj, run_id
    except Exception as e:
        print(f"[forecast_service] failed to load & cache user model run_id={run_id} for user={user_id}: {e}")
        return None, None, None


def get_model_for_user(user_id):
    """
    High-level: return (model_obj, scaler_obj, run_id) to be used for forecasting for this user.
    Strategy:
      1. If user_id is falsy -> return global MODEL_OBJ/SCALER_OBJ and CURRENT_MODEL_RUN_ID.
      2. If there is an entry in MODEL_CACHE -> return it.
      3. Query Admin API for active user model; if found, load & cache it and return.
      4. Fallback to global MODEL_OBJ/SCALER_OBJ.
    """
    global MODEL_OBJ, SCALER_OBJ, CURRENT_MODEL_RUN_ID

    if not user_id:
        return MODEL_OBJ, SCALER_OBJ, CURRENT_MODEL_RUN_ID

    # check cache first (no run_id constraint)
    model_obj, scaler_obj, run_id = get_cached_model_for_user(user_id, run_id=None)
    if model_obj and scaler_obj:
        return model_obj, scaler_obj, run_id

    # fetch active metadata from admin
    metadata = fetch_active_model_metadata_for_user(user_id)
    if metadata:
        m_obj, s_obj, r_id = load_and_cache_model_for_user(user_id, metadata)
        if m_obj and s_obj:
            return m_obj, s_obj, r_id

    # fallback to global
    return MODEL_OBJ, SCALER_OBJ, CURRENT_MODEL_RUN_ID


# ----------------- Flask app routes -----------------
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})


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
        "user_id": "<optional user id>",
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
    data = request.get_json(force=True) or {}
    series = data.get('series')
    dates = data.get('dates', None)
    user_id = data.get('user_id') or request.headers.get('X-User-Id') or None

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

    # Resolve model & scaler for this user (may be per-user or global)
    model_obj, scaler_obj, model_run_id = get_model_for_user(user_id)

    if scaler_obj is None or model_obj is None:
        # attempt to reload global metadata fallback
        load_model_and_scaler_from_metadata()
        model_obj, scaler_obj, model_run_id = MODEL_OBJ, SCALER_OBJ, CURRENT_MODEL_RUN_ID
        if scaler_obj is None or model_obj is None:
            return jsonify({'error': 'server model not loaded; try again later'}), 503

    try:
        # Scale features using the resolved scaler
        feat_vals = df[FEATURE_COLS].values
        scaled_vals = scaler_obj.transform(feat_vals)

        # Prepare last sequence window
        last_seq = scaled_vals[-SEQ_LEN:]
        input_seq = last_seq.reshape(1, SEQ_LEN, len(FEATURE_COLS))

        # Predict next HORIZON days
        pred_scaled = model_obj.predict(input_seq)[0, :, 0]

        # Invert scaling and log transformation
        dummy = np.zeros((HORIZON, len(FEATURE_COLS)))
        dummy[:, 0] = pred_scaled
        inv = scaler_obj.inverse_transform(dummy)[:, 0]  # back to log_amt
        forecast_vals = np.expm1(inv).tolist()

        total_amount = float(sum(forecast_vals))

        # Build prediction event payload (raw payload; publisher will envelope)
        pred_payload = {
            'user_id': str(user_id) if user_id else None,
            'horizon': HORIZON,
            'daywise': forecast_vals,
            'total': total_amount,
            'model_run_id': model_run_id,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'metadata': {
                'seq_len': SEQ_LEN,
                'n_input_days': len(series)
            }
        }

        # Use user_id as key if present so events for same user go to same partition (ordering)
        key = pred_payload['user_id'] or None
        try:
            # publish(topic, payload, key=None, **opts)
            kafka_publish(
                PREDICTIONS_TOPIC,
                pred_payload,
                key=key,
                event_type='forecast',
                source=SERVICE_NAME,
                model_run_id=model_run_id,
                user_id=pred_payload['user_id']
            )
        except Exception as e:
            print('[forecast_service] warning: failed to publish prediction event to kafka:', e)

        return jsonify({
            "daywise": forecast_vals,
            "forecast": total_amount,
            "horizon_days": HORIZON,
            "model_run_id": model_run_id
        })
    except Exception as e:
        print('[forecast_service] forecast error:', e)
        return jsonify({'error': 'forecast failed', 'details': str(e)}), 500


@app.route('/retrain', methods=['POST'])
def retrain():
    """
    Trigger retrain: by default, publishes a retrain request to Kafka and returns 202.
    For local/dev testing, pass ?sync=1 to run the pipeline synchronously and return results.
    Accepts optional JSON:
      { series: [...], params: {...}, user_id: '...' }
    """
    data = request.get_json(silent=True) or {}
    series = data.get('series', None)
    requested_user_id = data.get('user_id') or data.get('requested_user_id') or None

    # Basic validation if provided
    if series is not None and (not isinstance(series, list) or len(series) < 30 or len(series) > 365):
        return jsonify({'error': 'Series must be a list of 30–365 numeric values.'}), 400

    # If series provided, construct and save it to FILE_PATH so pipeline uses it
    if series:
        try:
            start_date = datetime.today() - timedelta(days=len(series) - 1)
            dates = pd.date_range(start=start_date, periods=len(series))
            df = pd.DataFrame({'Date / Time': dates, 'Debit/Credit': series})
            df.set_index('Date / Time', inplace=True)
            # Save to configured FILE_PATH used by pipeline
            df.to_excel(FILE_PATH)
            print(f'[forecast_service] saved training file to {FILE_PATH} (rows={len(series)})')
        except Exception as e:
            return jsonify({'error': 'Failed to save series for retrain', 'details': str(e)}), 500

    event = {
        'model_name': 'forecast',
        'requested_by': request.headers.get('X-User-Id') or request.headers.get('Authorization') or 'unknown',
        'requested_user_id': requested_user_id,
        'params': data.get('params', {}),
        'training_data_path': data.get('training_data_path', FILE_PATH if series else None),
        'timestamp': datetime.utcnow().isoformat() + 'Z'
    }

    # Synchronous (blocking) path useful for local dev/testing: /retrain?sync=1
    if request.args.get('sync') == '1':
        try:
            from forecast_pipeline import run_pipeline
            meta = run_pipeline()
            # after run, publish registry event so other services receive it (retrain_worker normally does this)
            try:
                registry_msg = {
                    'model_name': 'forecast',
                    'run_id': meta.get('run_id'),
                    'local_model_path': meta.get('local_model_path'),
                    'scaler_path': meta.get('scaler_path'),
                    'metrics': meta.get('metrics', {}),
                    'timestamp': meta.get('timestamp') or datetime.utcnow().isoformat() + 'Z',
                    'user_id': requested_user_id
                }
                # publish registry message (publisher will envelope)
                kafka_publish(
                    MODEL_REGISTRY_TOPIC,
                    registry_msg,
                    key=str(registry_msg.get('run_id') or ''),
                    event_type='model.registry',
                    source=SERVICE_NAME,
                    event_id=registry_msg.get('run_id'),
                    model_run_id=registry_msg.get('run_id'),
                    user_id=requested_user_id
                )
            except Exception as e:
                print('[forecast_service] warning: failed to publish registry event after sync run:', e)
            # reload model on this service (reload default metadata file)
            load_model_and_scaler_from_metadata()
            return jsonify({'status': 'retraining complete', 'meta': meta})
        except Exception as e:
            print('[forecast_service] retrain failed (sync):', e)
            return jsonify({'error': 'retrain failed', 'details': str(e)}), 500

    # Async path: publish retrain request to Kafka and return 202
    try:
        kafka_publish(
            RETRAIN_TOPIC,
            event,
            key=str(event.get('model_name') or ''),
            event_type='model.retrain',
            source=SERVICE_NAME,
            user_id=requested_user_id
        )
        return jsonify({'status': 'retrain requested', 'event': event}), 202
    except Exception as e:
        print('[forecast_service] failed to publish retrain event:', e)
        return jsonify({'error': 'failed to publish retrain event', 'details': str(e)}), 500


@app.route('/reload_model', methods=['POST'])
def reload_model():
    """
    Internal endpoint: ask service to reload the latest model and scaler.
    Intended to be called by your ModelRegistry consumer after a retrain completes.
    Accepts JSON: { run_id: '<run_id>' } to load a specific run (global fallback).
    Protect this endpoint in production (internal secret or mutual TLS).
    """
    try:
        payload = request.get_json(silent=True) or {}
        requested_run = payload.get('run_id')
        # Check internal secret header if configured
        if INTERNAL_SECRET:
            header_secret = request.headers.get('X-Internal-Secret')
            if header_secret != INTERNAL_SECRET:
                return jsonify({'ok': False, 'error': 'unauthorized'}), 401

        # If run_id provided: fetch metadata from admin API and attempt to load & set as global
        if requested_run:
            try:
                url = f"{ADMIN_API.rstrip('/')}/models"
                params = {'run_id': requested_run}
                resp = requests.get(url, params=params, timeout=10)
                if resp.ok:
                    data = resp.json()
                    # admin GET /models may return array or object; handle both
                    meta = None
                    if isinstance(data, list):
                        meta = data[0] if len(data) > 0 else None
                    elif isinstance(data, dict):
                        meta = data
                    if meta and meta.get('local_model_path') and meta.get('scaler_path'):
                        try:
                            mobj, scobj = load_model_and_scaler_paths(meta['local_model_path'], meta['scaler_path'])
                            # set as global fallback
                            global MODEL_OBJ, SCALER_OBJ, CURRENT_MODEL_RUN_ID
                            MODEL_OBJ = mobj
                            SCALER_OBJ = scobj
                            CURRENT_MODEL_RUN_ID = meta.get('run_id') or meta.get('run') or requested_run
                            print(f"[forecast_service] reloaded global model from registry run {CURRENT_MODEL_RUN_ID}")
                            return jsonify({'ok': True, 'run_id': CURRENT_MODEL_RUN_ID})
                        except Exception as e:
                            print('[forecast_service] failed to load model from metadata fetched from admin API:', e)
                            return jsonify({'ok': False, 'error': 'failed to load model', 'details': str(e)}), 500
                    else:
                        return jsonify({'ok': False, 'error': 'no metadata found for run_id'}), 404
                else:
                    return jsonify({'ok': False, 'error': 'admin API error', 'status': resp.status_code, 'text': resp.text}), 500
            except Exception as e:
                print('[forecast_service] error fetching metadata from admin API for reload:', e)
                return jsonify({'ok': False, 'error': 'admin fetch failed', 'details': str(e)}), 500
        else:
            # No run_id: reload from local metadata file (unchanged behavior)
            load_model_and_scaler_from_metadata()
            return jsonify({'ok': True, 'run_id': CURRENT_MODEL_RUN_ID})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


if __name__ == '__main__':
    # Use explicit host/port from env or defaults
    app.run(host=FORECAST_SERVICE_HOST, port=FORECAST_SERVICE_PORT)



