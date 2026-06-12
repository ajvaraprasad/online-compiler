#!/bin/bash
# Start Next.js dev server and keep it alive
cd /home/z/my-project
exec node node_modules/.bin/next dev --port 3000
