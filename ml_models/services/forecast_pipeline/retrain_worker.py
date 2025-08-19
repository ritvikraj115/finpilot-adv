# ml_models/retrain_worker.py
import os
import json
import time
import logging

from kafka import KafkaConsumer
from forecast_pipeline import run_pipeline

# import the same publish helper used in forecast_service
from kafka_producer import publish as kafka_publish
import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('retrain_worker')

BROKERS = os.environ.get('KAFKA_BROKERS', 'localhost:9092')
RETRAIN_TOPIC = os.environ.get('TOPIC_RETRAIN', 'finpilot.model.retrain')
REGISTRY_TOPIC = os.environ.get('TOPIC_MODEL_REGISTRY', 'finpilot.model.registry')
SERVICE_NAME = os.environ.get('RETRAIN_WORKER_NAME', 'retrain-worker')

# Admin API to persist ModelRegistry records (server-side)
ADMIN_API = os.environ.get('ADMIN_API') or os.environ.get('SERVER_ADMIN_URL') or 'http://localhost:5000/api/admin'
# Optional: auto-activate model after registry publish
AUTO_ACTIVATE = (os.environ.get('MODEL_AUTO_ACTIVATE', 'false').lower() == 'true')
# Optional internal secret header for admin calls
INTERNAL_SECRET = os.environ.get('INTERNAL_SECRET')

consumer = KafkaConsumer(
    RETRAIN_TOPIC,
    bootstrap_servers=BROKERS.split(','),
    value_deserializer=lambda m: json.loads(m.decode('utf8')),
    auto_offset_reset='earliest',
    group_id='retrain-workers'
)

logger.info('[retrain_worker] listening on %s', RETRAIN_TOPIC)

def persist_registry_admin(registry_event):
    """
    POST registry_event to Admin API /models endpoint.
    Returns True on success, False otherwise.
    """
    try:
        url = f"{ADMIN_API.rstrip('/')}/models"
        headers = {'Content-Type': 'application/json'}
        if INTERNAL_SECRET:
            headers['X-Internal-Secret'] = INTERNAL_SECRET
        resp = requests.post(url, json=registry_event, headers=headers, timeout=10)
        if resp.ok:
            logger.info('[retrain_worker] persisted registry to admin API: %s', resp.status_code)
            return True
        else:
            logger.warning('[retrain_worker] admin API returned non-OK: %s %s', resp.status_code, resp.text)
            return False
    except Exception as e:
        logger.exception('[retrain_worker] failed to persist registry to admin API: %s', e)
        return False

def activate_registry_run(run_id, user_id=None):
    """
    Call admin API to activate the given run_id for the user (or global if user_id is None).
    """
    try:
        url = f"{ADMIN_API.rstrip('/')}/models/{run_id}/activate"
        body = {'user_id': user_id}  # user_id may be None for global
        headers = {'Content-Type': 'application/json'}
        if INTERNAL_SECRET:
            headers['X-Internal-Secret'] = INTERNAL_SECRET
        resp = requests.post(url, json=body, headers=headers, timeout=10)
        if resp.ok:
            logger.info('[retrain_worker] activated run %s for user %s', run_id, user_id)
            return True
        else:
            logger.warning('[retrain_worker] activate endpoint returned non-OK: %s %s', resp.status_code, resp.text)
            return False
    except Exception as e:
        logger.exception('[retrain_worker] failed to activate registry run via admin API: %s', e)
        return False

for msg in consumer:
    req = msg.value or {}
    logger.info('[retrain_worker] received retrain request: %s', json.dumps(req)[:1000])
    # allow envelope or raw: pick payload if present
    try:
        # Support multiple field names for requesting user: requested_user_id, user_id, requested_by
        requested_user = req.get('requested_user_id') or req.get('user_id') or req.get('requested_by') or None
        model_name = req.get('model_name', 'forecast')
        params = req.get('params', {}) or {}

        # Run the pipeline (this is blocking and may take time)
        logger.info('[retrain_worker] starting pipeline for model=%s user=%s', model_name, requested_user)
        meta = run_pipeline()  # expected to return dict with run_id, local_model_path, scaler_path, timestamp, metrics optionally
        if not meta or 'run_id' not in meta:
            logger.error('[retrain_worker] run_pipeline did not return run_id meta=%s', str(meta))
            continue

        run_id = meta['run_id']
        registry_event = {
            'model_name': model_name,
            'run_id': run_id,
            'local_model_path': meta.get('local_model_path'),
            'scaler_path': meta.get('scaler_path'),
            'metrics': meta.get('metrics', {}),
            'timestamp': meta.get('timestamp'),
            # include optional user attribution for per-user models
            'user_id': str(requested_user) if requested_user else None
        }

        # Publish registry event with envelope using kafka_producer.publish signature:
        # publish(topic, payload, key=None, **opts)
        try:
            kafka_publish(
                REGISTRY_TOPIC,
                registry_event,
                key=str(run_id),
                event_type='model.registry',
                source=SERVICE_NAME,
                event_id=run_id,
                model_run_id=run_id,
                user_id=registry_event.get('user_id')
            )
            logger.info('[retrain_worker] published model.registry event %s', run_id)
        except Exception as e:
            logger.exception('[retrain_worker] failed to publish model.registry event: %s', e)

        # Persist to admin API so server has authoritative ModelRegistry entry
        try:
            ok = persist_registry_admin(registry_event)
            if not ok:
                logger.warning('[retrain_worker] admin persistence failed for run_id=%s', run_id)
        except Exception:
            # already logged inside helper
            pass

        # Optionally auto-activate via admin API (controlled by env MODEL_AUTO_ACTIVATE)
        if AUTO_ACTIVATE:
            try:
                activate_registry_run(run_id, registry_event.get('user_id'))
            except Exception:
                # logged inside helper
                pass

    except Exception as e:
        logger.exception('[retrain_worker] retrain failed: %s', e)
        # Optionally, you could publish a failure event or push to DLQ here.
    # small sleep to avoid tight loop in case of unexpected fast re-delivery
    time.sleep(1)


