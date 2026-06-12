# Task: Create Custom Next.js Server with Embedded WebSocket Terminal

## Summary
Created `/home/z/my-project/server.ts` - a custom Next.js server that embeds the WebSocket terminal service, solving the problem of background processes dying in sandbox environments.

## What was done

### 1. Created `/home/z/my-project/server.ts`
- Custom Next.js server running on port 3000
- Embedded WebSocket terminal service on port 3002
- Full PTY-based execution via `node-pty`
- Complete compiler pipeline integration (lexical analysis → code generation)
- IR VM execution for simple programs
- Native execution with PTY for interactive programs
- Pipe-based fallback when PTY unavailable
- All message types supported: execute, stdin, resize, kill
- Health check endpoint at `ws-server:3002/health`
- Graceful shutdown with SIGTERM/SIGINT handling
- Safety checks: code size limits, language validation, input detection, timeouts

### 2. Updated `/home/z/my-project/package.json`
- Changed dev script from `next dev -p 3000 2>&1 | tee dev.log` to `bun server.ts 2>&1 | tee dev.log`
- Added `ws` as explicit dependency (v8.21.0)

### 3. Fixed lint errors
- Added eslint-disable comments for required `require()` calls (next, node-pty)

## Test Results
- ✅ Next.js HTTP: 200 OK
- ✅ Terminal WS Health: `{"status":"ok","ptyAvailable":true,"activeExecutions":0}`
- ✅ Python execution (IR VM mode): EXIT_CODE=0, OUTPUT=42
- ✅ JavaScript execution (native/PTY mode): EXIT_CODE=0
- ✅ Full compiler pipeline phases (all 7 phases)
- ✅ Input detection forces native mode
- ✅ Lint passes

## Key Architecture Decisions
1. **Single process**: Both Next.js and WebSocket terminal run in one process
2. **Dynamic imports**: Compiler pipeline loaded lazily via `import('./src/lib/compiler/pipeline')`
3. **PTY with fallback**: Uses node-pty when available, falls back to child_process pipes
4. **Same protocol**: Identical JSON message protocol as the original terminal-service
5. **Port 3002**: WebSocket terminal accessible via Caddy gateway with `?XTransformPort=3002`
