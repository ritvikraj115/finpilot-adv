# ml_models/retrain_worker.py
import os
import json
import time
from kafka import KafkaConsumer, KafkaProducer
from forecast_pipeline import run_pipeline
from config import MLFLOW_EXPERIMENT

BROKERS = os.environ.get('KAFKA_BROKERS', 'localhost:9092')
RETRAIN_TOPIC = os.environ.get('TOPIC_RETRAIN', 'finpilot.model.retrain')
REGISTRY_TOPIC = os.environ.get('TOPIC_MODEL_REGISTRY', 'finpilot.model.registry')

consumer = KafkaConsumer(
    RETRAIN_TOPIC,
    bootstrap_servers=BROKERS.split(','),
    value_deserializer=lambda m: json.loads(m.decode('utf8')),
    auto_offset_reset='earliest',
    group_id='retrain-workers'
)
producer = KafkaProducer(bootstrap_servers=BROKERS.split(','), value_serializer=lambda v: json.dumps(v).encode('utf8'))

print('retrain_worker listening on', RETRAIN_TOPIC)
for msg in consumer:
    req = msg.value
    print('Received retrain request:', req)
    try:
        meta = run_pipeline()
        event = {
            'model_name': req.get('model_name', 'forecast'),
            'run_id': meta['run_id'],
            'local_model_path': meta['local_model_path'],
            'scaler_path': meta['scaler_path'],
            'metrics': {},   # already logged to mlflow; you can compute more here
            'timestamp': meta['timestamp']
        }
        producer.send(REGISTRY_TOPIC, event)
        producer.flush()
        print('Published model.registry event', event)
    except Exception as e:
        print('Retrain failed:', e)
        # Optionally publish failure to a DLQ or an admin topic
    time.sleep(1)
