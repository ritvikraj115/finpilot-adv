# ml_models/kafka_producer.py
import os
import json
import atexit
from kafka import KafkaProducer

KAFKA_BROKERS = os.environ.get('KAFKA_BROKERS', 'localhost:9092')

_producer = None

def get_producer():
    global _producer
    if _producer is None:
        _producer = KafkaProducer(
            bootstrap_servers=KAFKA_BROKERS.split(','),
            value_serializer=lambda v: json.dumps(v).encode('utf8'),
            key_serializer=lambda k: k.encode('utf8') if isinstance(k, str) else None,
            acks='all'
        )
        # ensure clean shutdown
        atexit.register(shutdown)
    return _producer

def shutdown():
    global _producer
    try:
        if _producer:
            _producer.flush(timeout=5)
            _producer.close()
            _producer = None
    except Exception:
        pass

def publish(topic, key, value):
    """
    Publish a JSON value to topic. key is optional (string).
    Non-blocking send; flush recommended by caller if strict durability required.
    """
    prod = get_producer()
    if key is None:
        prod.send(topic, value=value)
    else:
        prod.send(topic, key=str(key), value=value)
