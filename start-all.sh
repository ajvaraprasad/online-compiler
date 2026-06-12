#!/bin/bash

# Start terminal service
cd /home/z/my-project/mini-services/terminal-service
npx tsx index.ts &
TS_PID=$!
echo "Terminal service PID: $TS_PID"

# Start Next.js
cd /home/z/my-project
bun --bun next dev --port 3000 &
NEXT_PID=$!
echo "Next.js PID: $NEXT_PID"

# Wait for either to exit, but DON'T kill the other
wait -n 2>/dev/null || wait $TS_PID $NEXT_PID 2>/dev/null
echo "One process exited. Keeping the other alive..."
wait
