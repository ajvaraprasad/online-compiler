#!/bin/bash
# CodeForge Server Watchdog - keeps the server alive
# This script starts the Next.js production server and restarts it if it dies.

cd /home/z/my-project

LOG_FILE="/tmp/codeforge-server.log"
PID_FILE="/tmp/codeforge-server.pid"

echo "[$(date)] CodeForge Server Watchdog starting..." >> "$LOG_FILE"

while true; do
    # Check if server is already running
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if kill -0 "$OLD_PID" 2>/dev/null; then
            sleep 5
            continue
        fi
    fi

    echo "[$(date)] Starting Next.js production server..." >> "$LOG_FILE"
    
    # Start the server
    node node_modules/.bin/next start --port 3000 >> "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
    echo "$SERVER_PID" > "$PID_FILE"
    
    # Wait for the server to be ready
    sleep 5
    
    # Verify it started
    if kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "[$(date)] Server started with PID $SERVER_PID" >> "$LOG_FILE"
    else
        echo "[$(date)] Server failed to start, retrying in 5s..." >> "$LOG_FILE"
        rm -f "$PID_FILE"
        sleep 5
    fi
    
    # Wait and check periodically
    while kill -0 "$SERVER_PID" 2>/dev/null; do
        sleep 10
    done
    
    echo "[$(date)] Server died, restarting in 3s..." >> "$LOG_FILE"
    rm -f "$PID_FILE"
    sleep 3
done
