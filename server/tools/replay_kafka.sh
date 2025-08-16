#!/usr/bin/env bash
# usage: ./replay_kafka.sh events.jsonl
# each line should be a JSON event; script will publish via kafka-console-producer inside container
FILE="$1"
BOOTSTRAP=${KAFKA_BROKERS:-localhost:9092}
TOPIC=${TOPIC_TRANSACTIONS:-finpilot.transactions}
if [ -z "$FILE" ]; then
  echo "Usage: $0 events.jsonl"
  exit 1
fi
# This assumes a local kafka container with kafka-console-producer available
# Adjust container name if needed
KAFKA_CONTAINER=$(docker ps --filter "ancestor=confluentinc/cp-kafka" --format "{{.Names}}" | head -n1)
if [ -z "$KAFKA_CONTAINER" ]; then
  echo "No kafka container found. Publishing via kafkacat instead if available..."
  if command -v kafkacat >/dev/null 2>&1; then
    kafkacat -P -b "$BOOTSTRAP" -t "$TOPIC" -l "$FILE"
  else
    echo "Install kafkacat or run with a dockerized kafka."
    exit 1
  fi
else
  echo "Publishing using container $KAFKA_CONTAINER..."
  docker exec -i "$KAFKA_CONTAINER" bash -c "cat > /tmp/events.jsonl && \
    while read line; do echo \$line | kafka-console-producer --broker-list localhost:9092 --topic $TOPIC; done < /tmp/events.jsonl" < "$FILE"
fi
