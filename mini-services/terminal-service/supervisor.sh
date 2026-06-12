#!/bin/bash
cd /home/z/my-project/mini-services/terminal-service
while true; do
  node start.cjs 2>&1
  echo "[Supervisor] Process exited with code $?, restarting in 2s..." >&2
  sleep 2
done
