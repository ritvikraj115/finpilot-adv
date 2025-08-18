# ml_models/kafka_producer.py
import os, json
from uuid import uuid4
from datetime import datetime
from kafka import KafkaProducer

BROKERS = os.environ.get('KAFKA_BROKERS', 'localhost:9092').split(',')
PRED_TOPIC = os.environ.get('TOPIC_PREDICTIONS', 'finpilot.predictions')
DLQ_TOPIC = os.environ.get('TOPIC_DLQ', 'finpilot.dlq')

producer = KafkaProducer(
    bootstrap_servers=BROKERS,
    value_serializer=lambda v: json.dumps(v).encode('utf-8'),
    key_serializer=lambda k: k.encode('utf-8') if k else None
)

def make_envelope(maybe_payload, *, event_type=None, source=None, event_id=None, user_id=None, model_run_id=None):
    # if it's already an envelope, pass through (simple check)
    if isinstance(maybe_payload, dict) and 'event_type' in maybe_payload and 'payload' in maybe_payload:
        return maybe_payload
    inferred_type = event_type or ('forecast' if (isinstance(maybe_payload, dict) and ('daywise' in maybe_payload or 'horizon' in maybe_payload)) else 'classification')
    return {
        "version": "v1",
        "event_type": inferred_type,
        "source": source or ("forecast-service" if inferred_type == 'forecast' else 'transactions-service'),
        "event_id": event_id or (maybe_payload.get('event_id') if isinstance(maybe_payload, dict) else str(uuid4())),
        "user_id": user_id or (maybe_payload.get('user_id') if isinstance(maybe_payload, dict) else None),
        "timestamp": datetime.utcnow().isoformat() + 'Z',
        "model_run_id": model_run_id or (maybe_payload.get('model_run_id') if isinstance(maybe_payload, dict) else None),
        "payload": maybe_payload if isinstance(maybe_payload, dict) else {}
    }

def publish(topic, payload, key=None, **opts):
    env = make_envelope(payload, **opts)
    k = key if key else (env.get("user_id") or env.get("event_id"))
    try:
        producer.send(topic or PRED_TOPIC, value=env, key=k)
        producer.flush()
        print(f"[kafka_publish] published to {topic or PRED_TOPIC} key={k} event_type={env['event_type']}")
    except Exception as e:
        # send to DLQ (best effort)
        try:
            producer.send(DLQ_TOPIC, value={"failed_publish": env, "error": str(e)})
            producer.flush()
        except Exception:
            pass
        raise
