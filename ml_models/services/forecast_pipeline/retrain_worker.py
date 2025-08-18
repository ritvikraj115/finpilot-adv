# ml_models/retrain_worker.py
import os
import json
import time
from kafka import KafkaConsumer
from forecast_pipeline import run_pipeline

# import the same publish helper used in forecast_service
from kafka_producer import publish as kafka_publish

BROKERS = os.environ.get('KAFKA_BROKERS', 'localhost:9092')
RETRAIN_TOPIC = os.environ.get('TOPIC_RETRAIN', 'finpilot.model.retrain')
REGISTRY_TOPIC = os.environ.get('TOPIC_MODEL_REGISTRY', 'finpilot.model.registry')
SERVICE_NAME = os.environ.get('RETRAIN_WORKER_NAME', 'retrain-worker')

consumer = KafkaConsumer(
    RETRAIN_TOPIC,
    bootstrap_servers=BROKERS.split(','),
    value_deserializer=lambda m: json.loads(m.decode('utf8')),
    auto_offset_reset='earliest',
    group_id='retrain-workers'
)

print('[retrain_worker] listening on', RETRAIN_TOPIC)

for msg in consumer:
    req = msg.value
    print('[retrain_worker] received retrain request:', req)
    try:
        meta = run_pipeline()
        registry_event = {
            'model_name': req.get('model_name', 'forecast'),
            'run_id': meta['run_id'],
            'local_model_path': meta['local_model_path'],
            'scaler_path': meta['scaler_path'],
            'metrics': {},   # already logged to mlflow; you can add more
            'timestamp': meta['timestamp']
        }

        # Publish registry event with envelope
        kafka_publish(
            REGISTRY_TOPIC,
            registry_event,
            key=str(registry_event.get('run_id') or ''),
            event_type='model.registry',
            source=SERVICE_NAME,
            event_id=registry_event.get('run_id'),
            model_run_id=registry_event.get('run_id')
        )
        print('[retrain_worker] published model.registry event', registry_event)
    except Exception as e:
        print('[retrain_worker] retrain failed:', e)
        # TODO: Optionally publish to DLQ or notify admin
    time.sleep(1)

