#!/bin/bash
cd /home/z/my-project
while true; do
  rm -f .next/dev/lock
  NODE_OPTIONS="--max-old-space-size=512" npx tsx server.ts 2>&1 | tee -a /home/z/my-project/dev.log
  echo "[keep-alive] Server exited with code $?, restarting in 3s..." >> /home/z/my-project/dev.log
  sleep 3
done
