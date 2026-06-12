#!/bin/bash
# Persistent launcher for CodeForge - keeps both services alive
# Usage: bash /home/z/my-project/launch.sh

cd /home/z/my-project

# Kill any existing instances
pkill -f "next dev --port 3000" 2>/dev/null
pkill -f "terminal-service.*tsx index" 2>/dev/null
sleep 2

# Start terminal service
(cd mini-services/terminal-service && exec node /home/z/my-project/node_modules/.bin/tsx index.ts) &
TERM_PID=$!

# Start Next.js
exec node node_modules/.bin/next dev --port 3000
