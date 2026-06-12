/**
 * WebSocket Executor Service with PTY Support
 * =============================================
 * A production-quality code execution service that uses node-pty for
 * real terminal semantics — exactly like VS Code, Replit, and JDoodle.
 *
 * Architecture:
 *   User types in xterm.js
 *     → raw keystroke sent via WebSocket
 *     → this service writes to PTY master
 *     → PTY echoes back through its output
 *     → this service reads echo + program output
 *     → sends back via WebSocket
 *     → xterm.js displays it
 *
 * WebSocket Protocol (Client → Server):
 *   {"type": "execute", "code": "...", "language": "python", "sessionId": "id", "rows": 24, "cols": 80}
 *   {"type": "stdin", "data": "raw keystroke data"}
 *   {"type": "kill"}
 *   {"type": "resize", "rows": 30, "cols": 120}
 *
 * WebSocket Protocol (Server → Client):
 *   {"type": "start", "sessionId": "...", "timestamp": 12345}
 *   {"type": "stdout", "data": "terminal output (includes echo)"}
 *   {"type": "stderr", "data": "compilation errors only"}
 *   {"type": "end", "exitCode": 0, "executionTime": 1234}
 *   {"type": "killed", "sessionId": "..."}
 */

const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// ─── Constants ───────────────────────────────────────────────────────────────

const PORT = 3003;
const HOST = '0.0.0.0';

const MAX_CODE_SIZE = 256 * 1024;       // 256 KB
const INTERACTIVE_TIMEOUT_MS = 300000;   // 5 minutes
const COMPILE_TIMEOUT_MS = 30000;        // 30 seconds

const SUPPORTED_LANGUAGES = ['python', 'c', 'cpp', 'java', 'javascript'];

const RESTRICTED_ENV = {
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
  HOME: '/tmp',
  USER: 'nobody',
  LANG: 'en_US.UTF-8',
  TERM: 'xterm-256color',
};

// ─── Active Execution Tracking ───────────────────────────────────────────────

const activeExecutions = new Map(); // sessionId → ActiveExecution

class ActiveExecution {
  constructor(sessionId, ptyProcess, tempDir, startTime) {
    this.sessionId = sessionId;
    this.ptyProcess = ptyProcess;
    this.tempDir = tempDir;
    this.startTime = startTime;
    this.timeoutHandle = null;
    this.killed = false;
    this.ended = false;
    this.ws = null; // set after construction
  }
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function createTempDir() {
  const execId = crypto.randomBytes(4).toString('hex');
  const dirPath = path.join(os.tmpdir(), `exec_${execId}`);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function cleanupTempDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (e) {
    console.error(`Failed to cleanup temp dir ${dirPath}:`, e.message);
  }
}

function safeSend(ws, data) {
  try {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(data));
      return true;
    }
  } catch (e) {
    console.debug('Failed to send WebSocket message:', e.message);
  }
  return false;
}

// ─── Language Configuration ──────────────────────────────────────────────────

function getLanguageConfig(language, tempDir) {
  const mainPath = path.join(tempDir, 'main');

  switch (language) {
    case 'python':
      return {
        fileName: 'main.py',
        runCmd: ['python3', '-u', path.join(tempDir, 'main.py')],
      };

    case 'c':
      return {
        fileName: 'main.c',
        compileCmd: ['gcc', '-o', mainPath, path.join(tempDir, 'main.c'), '-lm'],
        runCmd: [mainPath],
      };

    case 'cpp':
      return {
        fileName: 'main.cpp',
        compileCmd: ['g++', '-o', mainPath, path.join(tempDir, 'main.cpp'), '-lm'],
        runCmd: [mainPath],
      };

    case 'java':
      return {
        fileName: 'Main.java',
        runCmd: ['java', path.join(tempDir, 'Main.java')],
      };

    case 'javascript':
      return {
        fileName: 'main.js',
        runCmd: ['node', path.join(tempDir, 'main.js')],
        prependCode:
          "// Auto-injected: ensure Node.js exits when stdin closes\n" +
          "process.stdin.on('end', () => process.exit(0));\n\n",
      };

    default:
      return null;
  }
}

// ─── Compile Step ────────────────────────────────────────────────────────────

function compileCode(compileCmd, tempDir, ws, sessionId) {
  return new Promise((resolve) => {
    console.log(`[${sessionId}] Compiling: ${compileCmd.join(' ')}`);

    const proc = spawn(compileCmd[0], compileCmd.slice(1), {
      cwd: tempDir,
      env: { ...RESTRICTED_ENV },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      stderr += text;
      safeSend(ws, { type: 'stderr', data: text });
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      safeSend(ws, { type: 'stderr', data: '\nError: Compilation timed out' });
      resolve(false);
    }, COMPILE_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        console.log(`[${sessionId}] Compilation failed with exit code ${code}`);
        resolve(false);
      } else {
        console.log(`[${sessionId}] Compilation succeeded`);
        resolve(true);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      safeSend(ws, { type: 'stderr', data: `Error: Compilation failed: ${err.message}` });
      resolve(false);
    });
  });
}

// ─── Execute Code with PTY ──────────────────────────────────────────────────

async function executeCode(ws, code, language, sessionId, rows = 24, cols = 80) {
  // ── Validate inputs ──────────────────────────────────────────────────

  if (!code || typeof code !== 'string') {
    safeSend(ws, { type: 'stderr', data: 'Error: No code provided' });
    safeSend(ws, { type: 'end', exitCode: 1, executionTime: 0 });
    return;
  }

  if (!SUPPORTED_LANGUAGES.includes(language)) {
    safeSend(ws, { type: 'stderr', data: `Error: Unsupported language '${language}'. Supported: ${SUPPORTED_LANGUAGES.join(', ')}` });
    safeSend(ws, { type: 'end', exitCode: 1, executionTime: 0 });
    return;
  }

  if (Buffer.byteLength(code, 'utf-8') > MAX_CODE_SIZE) {
    safeSend(ws, { type: 'stderr', data: `Error: Code size exceeds limit (${MAX_CODE_SIZE} bytes)` });
    safeSend(ws, { type: 'end', exitCode: 1, executionTime: 0 });
    return;
  }

  if (activeExecutions.has(sessionId)) {
    safeSend(ws, { type: 'stderr', data: 'Error: This sessionId is already being executed' });
    safeSend(ws, { type: 'end', exitCode: 1, executionTime: 0 });
    return;
  }

  // ── Create temp directory and write source file ──────────────────────

  const tempDir = createTempDir();
  const langConfig = getLanguageConfig(language, tempDir);

  if (!langConfig) {
    cleanupTempDir(tempDir);
    safeSend(ws, { type: 'stderr', data: `Error: No configuration found for language '${language}'` });
    safeSend(ws, { type: 'end', exitCode: 1, executionTime: 0 });
    return;
  }

  // Prepare code with optional prepend (for JavaScript)
  let codeToWrite = code;
  if (langConfig.prependCode) {
    codeToWrite = langConfig.prependCode + code;
  }

  const filePath = path.join(tempDir, langConfig.fileName);
  try {
    fs.writeFileSync(filePath, codeToWrite, 'utf-8');
  } catch (e) {
    cleanupTempDir(tempDir);
    safeSend(ws, { type: 'stderr', data: `Error: Failed to write source file: ${e.message}` });
    safeSend(ws, { type: 'end', exitCode: 1, executionTime: 0 });
    return;
  }

  // ── Send start event ─────────────────────────────────────────────────

  const startTime = Date.now();
  safeSend(ws, {
    type: 'start',
    sessionId,
    timestamp: startTime,
  });

  // ── Compile step (for C, C++) ────────────────────────────────────────

  const env = { ...RESTRICTED_ENV };

  if (langConfig.compileCmd) {
    const success = await compileCode(langConfig.compileCmd, tempDir, ws, sessionId);
    if (!success) {
      const executionTime = Date.now() - startTime;
      safeSend(ws, { type: 'end', exitCode: 1, executionTime });
      cleanupTempDir(tempDir);
      return;
    }
  }

  // ── Start PTY process ────────────────────────────────────────────────

  console.log(`[${sessionId}] Executing with PTY: ${langConfig.runCmd.join(' ')}`);

  let ptyProcess;
  try {
    ptyProcess = pty.spawn(langConfig.runCmd[0], langConfig.runCmd.slice(1), {
      name: 'xterm-256color',
      cols: cols,
      rows: rows,
      cwd: tempDir,
      env: env,
    });
  } catch (e) {
    const executionTime = Date.now() - startTime;
    safeSend(ws, { type: 'stderr', data: `Error: Failed to start process: ${e.message}` });
    safeSend(ws, { type: 'end', exitCode: 1, executionTime });
    cleanupTempDir(tempDir);
    return;
  }

  // ── Track the execution ──────────────────────────────────────────────

  const execution = new ActiveExecution(sessionId, ptyProcess, tempDir, startTime);
  execution.ws = ws;
  activeExecutions.set(sessionId, execution);

  // ── Stream PTY output to WebSocket ───────────────────────────────────

  ptyProcess.onData((data) => {
    // Send PTY output (includes echo + program output) to WebSocket
    safeSend(ws, { type: 'stdout', data });
  });

  // ── Set up timeout ───────────────────────────────────────────────────

  execution.timeoutHandle = setTimeout(() => {
    if (execution.ended) return;
    execution.killed = true;
    execution.ended = true;

    console.log(`[${sessionId}] Execution timed out`);
    try { ptyProcess.kill('SIGKILL'); } catch {}

    safeSend(ws, { type: 'stderr', data: '\r\nError: Execution timed out\r\n' });
    safeSend(ws, { type: 'end', exitCode: -1, executionTime: INTERACTIVE_TIMEOUT_MS });

    activeExecutions.delete(sessionId);
    cleanupTempDir(tempDir);
  }, INTERACTIVE_TIMEOUT_MS);

  // ── Handle process exit ──────────────────────────────────────────────

  ptyProcess.onExit(({ exitCode }) => {
    if (execution.ended) return;
    execution.ended = true;

    // Cancel timeout
    if (execution.timeoutHandle) {
      clearTimeout(execution.timeoutHandle);
    }

    const executionTime = Date.now() - startTime;

    if (!execution.killed) {
      safeSend(ws, { type: 'end', exitCode, executionTime });
    }

    console.log(`[${sessionId}] Process exited with code ${exitCode} in ${executionTime}ms`);

    activeExecutions.delete(sessionId);
    cleanupTempDir(tempDir);
  });
}

// ─── Handle Stdin ────────────────────────────────────────────────────────────

function handleStdin(sessionId, data) {
  const execution = activeExecutions.get(sessionId);
  if (!execution) {
    console.debug(`[${sessionId}] Stdin received but no active execution`);
    return;
  }

  try {
    // Write raw data to PTY — the PTY handles echo and line discipline
    execution.ptyProcess.write(data);
    console.debug(`[${sessionId}] Stdin written to PTY: ${JSON.stringify(data)}`);
  } catch (e) {
    console.debug(`[${sessionId}] Stdin write failed: ${e.message}`);
  }
}

// ─── Handle Kill ─────────────────────────────────────────────────────────────

function handleKill(ws, sessionId) {
  const execution = activeExecutions.get(sessionId);
  if (!execution) {
    safeSend(ws, { type: 'killed', sessionId, error: 'No running execution found' });
    return;
  }

  if (execution.ended) {
    safeSend(ws, { type: 'killed', sessionId });
    return;
  }

  execution.killed = true;
  execution.ended = true;

  // Cancel timeout
  if (execution.timeoutHandle) {
    clearTimeout(execution.timeoutHandle);
  }

  // Kill the PTY process
  try { execution.ptyProcess.kill('SIGKILL'); } catch {}

  const executionTime = Date.now() - execution.startTime;

  safeSend(ws, { type: 'killed', sessionId });
  safeSend(ws, { type: 'end', exitCode: -1, executionTime });

  console.log(`[${sessionId}] Execution killed after ${executionTime}ms`);

  activeExecutions.delete(sessionId);
  cleanupTempDir(execution.tempDir);
}

// ─── Handle Resize ───────────────────────────────────────────────────────────

function handleResize(sessionId, rows, cols) {
  const execution = activeExecutions.get(sessionId);
  if (!execution) return;

  try {
    execution.ptyProcess.resize(cols, rows);
    console.debug(`[${sessionId}] PTY resized to ${rows}x${cols}`);
  } catch (e) {
    console.debug(`[${sessionId}] PTY resize failed: ${e.message}`);
  }
}

// ─── HTTP + WebSocket Server ─────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      activeExecutions: activeExecutions.size,
      supportedLanguages: SUPPORTED_LANGUAGES,
      ptySupport: true,
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

// WebSocket server — path "/" to work with Caddy XTransformPort routing
const wss = new WebSocketServer({ server: httpServer, path: '/' });

wss.on('connection', (ws) => {
  const wsId = ws.hashCode || Date.now();
  console.log(`WebSocket client connected`);

  // Track sessions for this WebSocket
  const wsSessions = new Set();

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      safeSend(ws, { type: 'stderr', data: 'Error: Invalid JSON message' });
      return;
    }

    const msgType = message.type;

    switch (msgType) {
      case 'execute': {
        const { code, language, sessionId, rows, cols } = message;
        if (!sessionId) {
          safeSend(ws, { type: 'stderr', data: 'Error: sessionId is required' });
          return;
        }
        console.log(`Execute request: language=${language}, sessionId=${sessionId}, size=${rows}x${cols}`);
        wsSessions.add(sessionId);
        executeCode(ws, code || '', language || '', sessionId, rows || 24, cols || 80);
        break;
      }

      case 'stdin': {
        const { sessionId, data } = message;
        const sid = sessionId || (wsSessions.size > 0 ? wsSessions.values().next().value : null);
        if (sid) handleStdin(sid, data || '');
        break;
      }

      case 'kill': {
        const { sessionId } = message;
        const sid = sessionId || (wsSessions.size > 0 ? wsSessions.values().next().value : null);
        if (sid) {
          console.log(`Kill request: sessionId=${sid}`);
          handleKill(ws, sid);
        }
        break;
      }

      case 'resize': {
        const { sessionId, rows, cols } = message;
        const sid = sessionId || (wsSessions.size > 0 ? wsSessions.values().next().value : null);
        if (sid) handleResize(sid, rows || 24, cols || 80);
        break;
      }

      default:
        safeSend(ws, { type: 'stderr', data: `Error: Unknown message type '${msgType}'` });
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    // Kill all running executions for this WebSocket
    for (const sessionId of wsSessions) {
      const execution = activeExecutions.get(sessionId);
      if (execution && !execution.ended) {
        execution.killed = true;
        execution.ended = true;
        if (execution.timeoutHandle) clearTimeout(execution.timeoutHandle);
        try { execution.ptyProcess.kill('SIGKILL'); } catch {}
        cleanupTempDir(execution.tempDir);
        activeExecutions.delete(sessionId);
      }
    }
    wsSessions.clear();
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

// ─── Start Server ────────────────────────────────────────────────────────────

httpServer.listen(PORT, HOST, () => {
  console.log(`Executor Service running on ${HOST}:${PORT}`);
  console.log(`PTY support: enabled (node-pty ${pty.version || 'available'})`);
  console.log(`Supported languages: ${SUPPORTED_LANGUAGES.join(', ')}`);
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

function gracefulShutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);

  for (const [sessionId, execution] of activeExecutions) {
    if (execution.timeoutHandle) clearTimeout(execution.timeoutHandle);
    try { execution.ptyProcess.kill('SIGKILL'); } catch {}
    cleanupTempDir(execution.tempDir);
  }
  activeExecutions.clear();

  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force exit after 3 seconds
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
