#!/bin/bash
# Start the FastAPI executor service with auto-restart
cd "$(dirname "$0")"

while true; do
    echo "[$(date)] Starting executor service..."
    python3 main.py
    EXIT_CODE=$?
    echo "[$(date)] Executor service exited with code $EXIT_CODE"
    if [ $EXIT_CODE -eq 0 ]; then
        break  # Clean shutdown
    fi
    echo "[$(date)] Restarting in 2 seconds..."
    sleep 2
done
