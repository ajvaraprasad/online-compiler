#!/bin/bash
cd /home/z/my-project
rm -f .next/dev/lock
export NODE_OPTIONS="--max-old-space-size=1024"
exec npx tsx server.ts >> /home/z/my-project/dev.log 2>&1
