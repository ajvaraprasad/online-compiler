/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge Terminal Service — Raw WebSocket Interactive Terminal (v5.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Switched from socket.io to raw WebSocket (ws) for:
 *   ✓ Stability — socket.io server crashed intermittently with node-pty
 *   ✓ Simplicity — no version compatibility issues between client/server
 *   ✓ Reliability — no polling fallback issues through Caddy gateway
 *   ✓ Low latency — direct WebSocket, no protocol overhead
 *
 * Protocol: JSON messages over WebSocket
 *   Client → Server:
 *     { type: "execute", code, language, requestId, rows, cols }
 *     { type: "stdin", requestId, data }
 *     { type: "resize", requestId, rows, cols }
 *     { type: "kill", requestId }
 *
 *   Server → Client:
 *     { type: "started", requestId, ... }
 *     { type: "phase", requestId, phase, status, ... }
 *     { type: "output", requestId, data }
 *     { type: "stderr", requestId, data }
 *     { type: "exit", requestId, exitCode, executionTime, ... }
 *     { type: "error", requestId, message }
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ─── PTY Import ─────────────────────────────────────────────────────────────

let pty: any = null;
let ptyAvailable = false;
try {
  pty = require('node-pty');
  ptyAvailable = true;
  console.log('[TerminalService] node-pty loaded successfully');
} catch (e) {
  console.warn('[TerminalService] node-pty NOT available, falling back to pipes:', (e as Error).message);
}

// ─── Compiler Pipeline Import ───────────────────────────────────────────────

let pipelineModule: any = null;
let vmModule: any = null;

async function loadPipeline() {
  if (!pipelineModule) {
    try {
      pipelineModule = await import('../../src/lib/compiler/pipeline');
      console.log('[TerminalService] Compiler pipeline loaded');
    } catch (e) {
      console.warn('[TerminalService] Could not load compiler pipeline:', (e as Error).message);
    }
  }
  return pipelineModule;
}

async function loadVM() {
  if (!vmModule) {
    try {
      vmModule = await import('../../src/lib/compiler/vm');
      console.log('[TerminalService] IR VM loaded');
    } catch (e) {
      console.warn('[TerminalService] Could not load IR VM:', (e as Error).message);
    }
  }
  return vmModule;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActiveExecution {
  ptyProcess: any;
  process?: ChildProcess;
  tempDir: string;
  startTime: number;
  killed: boolean;
  ws: WebSocket;
  executionMode: string;
}

interface PipelineDiagnostic {
  type: string;
  phase: string;
  message: string;
  line?: number;
  col?: number;
  severity: string;
  raw?: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

const activeExecutions = new Map<string, ActiveExecution>();

const ALLOWED_LANGUAGES = ['python', 'c', 'cpp', 'java', 'javascript'];
const MAX_CODE_SIZE = 256 * 1024;
const INTERACTIVE_TIMEOUT = 5 * 60_000; // 5 minutes

const RESTRICTED_ENV: Record<string, string> = {
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
  HOME: '/tmp',
  USER: 'nobody',
  LANG: 'en_US.UTF-8',
  TERM: 'xterm-256color',
  PYTHONIOENCODING: 'utf-8',
  PYTHONUNBUFFERED: '1',
  NODE_OPTIONS: '--max-old-space-size=256',
};

// ─── Language Configuration ─────────────────────────────────────────────────

function getLanguageConfig(language: string, tempDir: string): {
  fileName: string;
  compileCmd?: { command: string; args: string[] };
  runCmd: { command: string; args: string[] };
  prependCode?: string;
} | null {
  switch (language) {
    case 'python':
      return {
        fileName: 'main.py',
        runCmd: { command: 'python3', args: ['-u', join(tempDir, 'main.py')] },
      };
    case 'c':
      return {
        fileName: 'main.c',
        compileCmd: {
          command: 'gcc',
          args: [
            '-o', join(tempDir, 'main'), join(tempDir, 'main.c'),
            '-lm', '-Wall', '-Wextra', '-Werror=return-type',
            '-Werror=implicit-function-declaration',
            '-std=c17',
          ],
        },
        runCmd: { command: join(tempDir, 'main'), args: [] },
      };
    case 'cpp':
      return {
        fileName: 'main.cpp',
        compileCmd: {
          command: 'g++',
          args: [
            '-o', join(tempDir, 'main'), join(tempDir, 'main.cpp'),
            '-lm', '-Wall', '-Wextra', '-Werror=return-type',
            '-std=c++17',
          ],
        },
        runCmd: { command: join(tempDir, 'main'), args: [] },
      };
    case 'java':
      return {
        fileName: 'Main.java',
        runCmd: { command: 'java', args: [join(tempDir, 'Main.java')] },
      };
    case 'javascript':
      return {
        fileName: 'main.js',
        runCmd: { command: 'node', args: [join(tempDir, 'main.js')] },
        prependCode: "process.stdin.on('end', () => process.exit(0));\n\n",
      };
    default:
      return null;
  }
}

// ─── Compile Step ────────────────────────────────────────────────────────────

async function compileStep(
  compileCmd: { command: string; args: string[] },
  tempDir: string,
  emitPhase: (phase: string, status: string, data?: Record<string, unknown>) => void,
): Promise<{ success: boolean; stderr: string; diagnostics: PipelineDiagnostic[] }> {
  return new Promise((resolve) => {
    const proc = spawn(compileCmd.command, compileCmd.args, {
      cwd: tempDir,
      env: RESTRICTED_ENV,
    });
    let stderr = '';

    proc.stdout?.on('data', () => {});
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on('error', (err) => {
      resolve({
        success: false,
        stderr: `Compilation failed: ${err.message}`,
        diagnostics: [{
          type: 'compilation_error',
          phase: 'compilation',
          message: `Compiler not found: ${err.message}`,
          severity: 'error',
        }],
      });
    });
    proc.on('close', async () => {
      const pipeline = await loadPipeline();
      const diagnostics: PipelineDiagnostic[] = pipeline
        ? pipeline.parseCompilationErrors(stderr, '').map((d: any) => ({
            type: d.type || 'compilation_error',
            phase: d.phase,
            message: d.message,
            line: d.line,
            col: d.col,
            severity: d.severity,
            raw: d.raw,
          }))
        : [];

      resolve({
        success: !stderr || !stderr.includes('error'),
        stderr,
        diagnostics,
      });
    });
  });
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

async function cleanupDir(dir: string) {
  try {
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
  } catch {}
}

function killPtyProcess(execution: ActiveExecution) {
  try {
    if (execution.ptyProcess) {
      execution.ptyProcess.kill('SIGKILL');
    } else if (execution.process) {
      if (execution.process.pid) {
        try { process.kill(-execution.process.pid, 'SIGKILL'); } catch { execution.process.kill('SIGKILL'); }
      }
    }
  } catch {}
}

// ─── Send message to client ─────────────────────────────────────────────────

function sendMsg(ws: WebSocket, msg: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ─── HTTP Server + WebSocket Server ─────────────────────────────────────────

const PORT = 3002;

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ptyAvailable, activeExecutions: activeExecutions.size }));
    return;
  }
  // Default: return 404 for non-WebSocket requests
  res.writeHead(404);
  res.end('Not found. Use WebSocket to connect.');
});

const wss = new WebSocketServer({ server: httpServer });

console.log(`[TerminalService] Starting on port ${PORT}`);

// ─── WebSocket Connection Handling ──────────────────────────────────────────

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[TerminalService] Client connected from: ${clientIp}`);

  // ── Handle messages ──────────────────────────────────────────────────
  ws.on('message', (raw: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.warn('[TerminalService] Invalid JSON message received');
      return;
    }

    switch (msg.type) {
      case 'execute':
        handleExecute(ws, msg);
        break;
      case 'stdin':
        handleStdin(ws, msg);
        break;
      case 'resize':
        handleResize(ws, msg);
        break;
      case 'kill':
        handleKill(ws, msg);
        break;
      case 'ping':
        // Heartbeat — respond with pong to keep connection alive
        sendMsg(ws, { type: 'pong' });
        break;
      default:
        console.warn(`[TerminalService] Unknown message type: ${msg.type}`);
    }
  });

  // ── Handle disconnect ────────────────────────────────────────────────
  ws.on('close', () => {
    console.log(`[TerminalService] Client disconnected: ${clientIp}`);

    // Kill any running executions for this WebSocket
    for (const [requestId, execution] of activeExecutions.entries()) {
      if (execution.ws === ws && !execution.killed) {
        console.log(`[TerminalService] Killing execution ${requestId} for disconnected client`);
        execution.killed = true;
        killPtyProcess(execution);
        cleanupDir(execution.tempDir);
        activeExecutions.delete(requestId);
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[TerminalService] WebSocket error:`, err.message);
  });
});

// ─── Handle Execute ─────────────────────────────────────────────────────────

async function handleExecute(ws: WebSocket, msg: any) {
  const { code, language, requestId, rows, cols } = msg;

  // Validation
  if (!code || typeof code !== 'string') {
    sendMsg(ws, { type: 'error', requestId, message: 'Code is required' });
    return;
  }

  if (!ALLOWED_LANGUAGES.includes(language)) {
    sendMsg(ws, { type: 'error', requestId, message: `Unsupported language: ${language}` });
    return;
  }

  if (Buffer.byteLength(code, 'utf-8') > MAX_CODE_SIZE) {
    sendMsg(ws, { type: 'error', requestId, message: `Code size exceeds limit (${MAX_CODE_SIZE} bytes)` });
    return;
  }

  if (activeExecutions.has(requestId)) {
    sendMsg(ws, { type: 'error', requestId, message: 'This requestId is already being executed' });
    return;
  }

  // Setup
  const execId = randomUUID().slice(0, 8);
  const tempDir = join(tmpdir(), `exec_${execId}`);
  const langConfig = getLanguageConfig(language, tempDir);

  if (!langConfig) {
    sendMsg(ws, { type: 'error', requestId, message: 'Invalid language configuration' });
    return;
  }

  await mkdir(tempDir, { recursive: true });

  let codeToWrite = code;
  if (langConfig.prependCode) {
    codeToWrite = langConfig.prependCode + code;
  }

  const filePath = join(tempDir, langConfig.fileName);
  await writeFile(filePath, codeToWrite, 'utf-8');

  const startTime = Date.now();
  const termRows = rows || 24;
  const termCols = cols || 80;

  // Store execution
  const execution: ActiveExecution = {
    ptyProcess: null,
    tempDir,
    startTime,
    killed: false,
    ws,
    executionMode: 'native',
  };
  activeExecutions.set(requestId, execution);

  // Emit started event
  sendMsg(ws, {
    type: 'started',
    requestId,
    timestamp: startTime,
    engine: 'CodeForge v5.1 — Raw WebSocket Interactive Terminal',
  });

  // Helper: emit phase event
  const emitPhase = (phase: string, status: string, data?: Record<string, unknown>) => {
    sendMsg(ws, { type: 'phase', requestId, phase, status, ...data });
  };

  // Helper: emit output (PTY data)
  const emitOutput = (data: string) => {
    sendMsg(ws, { type: 'output', requestId, data });
  };

  // Helper: emit exit
  const emitExit = (exitCode: number, executionTime: number, summary?: Record<string, unknown>) => {
    sendMsg(ws, { type: 'exit', requestId, exitCode, executionTime, summary });
  };

  // ═══════════════════════════════════════════════════════════════
  //  RUN FULL COMPILER PIPELINE (Phases 1-7)
  // ═══════════════════════════════════════════════════════════════
  try {
    const pipeMod = await loadPipeline();
    const vmMod = await loadVM();

    let executionMode = 'native';
    let codegenResult: any = null;
    const allDiagnostics: PipelineDiagnostic[] = [];

    if (pipeMod) {
      const pipeline = new pipeMod.CompilerPipeline({
        code,
        language,
        onEvent: (eventType: string, eventData: string) => {
          if (eventType === 'phase') {
            try {
              const parsed = JSON.parse(eventData);
              sendMsg(ws, { type: 'phase', requestId, ...parsed });
            } catch {
              sendMsg(ws, { type: 'phase', requestId, phase: 'unknown', status: 'running', data: eventData });
            }
          } else if (eventType === 'stderr') {
            sendMsg(ws, { type: 'stderr', requestId, data: eventData });
          }
        },
      });

      const pipelineResult = await pipeline.run();

      for (const d of pipelineResult.diagnostics) {
        allDiagnostics.push({
          type: d.type || d.phase,
          phase: d.phase,
          message: d.message,
          line: d.line,
          col: d.col,
          severity: d.severity,
          raw: d.raw,
        });
      }

      if (!pipelineResult.success) {
        console.log(`[TerminalService] Pipeline blocked for ${requestId}: analysis failed`);

        emitExit(1, Date.now() - startTime, {
          success: false,
          diagnostics: allDiagnostics.slice(0, 50),
          phases: Object.fromEntries(
            Object.entries(pipelineResult.phases).map(([k, v]: [string, any]) => [k, v.status])
          ),
          metrics: pipelineResult.metrics,
        });

        activeExecutions.delete(requestId);
        cleanupDir(tempDir);
        return;
      }

      const executionPlan = pipeline.getExecutionPlan();
      codegenResult = pipeline.getCodegenResult();
      executionMode = executionPlan?.mode || 'native';

      console.log(`[TerminalService] Execution plan for ${requestId}: mode=${executionMode}, reason=${executionPlan?.reason}`);

      // SAFETY CHECK: If the code contains input functions, NEVER use IR VM
      const INPUT_PATTERNS: Record<string, RegExp[]> = {
        python: [/\binput\s*\(/, /\bsys\.stdin/],
        javascript: [/\breadline\s*\(/, /\bprompt\s*\(/, /process\.stdin/],
        c: [/\bscanf\s*\(/, /\bgets\s*\(/, /\bfgets\s*\(/, /\bgetchar\s*\(/],
        cpp: [/\bcin\s*>>/, /\bscanf\s*\(/, /\bgetline\s*\(/],
        java: [/\bScanner\s/, /System\.in/],
      };
      const inputPatterns = INPUT_PATTERNS[language] || [];
      const needsInteractiveTerminal = inputPatterns.some(p => p.test(code));

      if (executionMode === 'ir_vm' && needsInteractiveTerminal) {
        console.log(`[TerminalService] Forcing native mode for ${requestId}: code contains input functions requiring PTY`);
        executionMode = 'native';
      } else if (executionMode === 'ir_vm' && vmMod) {
        // ── IR VM Execution ──────────────────────────────────────
        emitPhase('compilation', 'skipped', { message: 'Using IR Virtual Machine — no compilation needed' });
        emitPhase('execution', 'running', { mode: 'ir_vm' });

        const optimizedProgram = pipeline.getOptimizationResult()?.program ?? pipeline.getIRResult()?.program;
        if (!optimizedProgram) {
          emitOutput('\x1b[31mError: IR program not available for VM execution\x1b[0m\r\n');
          emitExit(1, Date.now() - startTime);
          activeExecutions.delete(requestId);
          cleanupDir(tempDir);
          return;
        }

        const vmStartTime = Date.now();
        const vmResult = vmMod.executeIR(optimizedProgram);
        const vmExecutionTime = Date.now() - vmStartTime;

        for (const line of vmResult.output) {
          emitOutput(line + '\n');
        }

        if (vmResult.error) {
          emitOutput(`\x1b[31m${vmResult.error}\x1b[0m\r\n`);
        }

        emitPhase('execution', vmResult.success ? 'completed' : 'failed', {
          durationMs: vmExecutionTime,
          mode: 'ir_vm',
          stepsExecuted: vmResult.stepsExecuted,
        });
        emitPhase('output_processing', 'completed', {});

        emitExit(vmResult.exitCode, Date.now() - startTime, {
          success: vmResult.success,
          executionMode: 'ir_vm',
          diagnostics: allDiagnostics.slice(0, 50),
          phases: Object.fromEntries(
            Object.entries(pipelineResult.phases).map(([k, v]: [string, any]) => [k, v.status])
          ),
          metrics: pipelineResult.metrics,
          vmSteps: vmResult.stepsExecuted,
        });

        activeExecutions.delete(requestId);
        cleanupDir(tempDir);
        return;
      }

      if (executionMode === 'codegen' && codegenResult?.success && codegenResult.code) {
        console.log(`[TerminalService] Using codegen mode for ${requestId}, generated ${codegenResult.stats.linesGenerated} lines`);

        const generatedFilePath = join(tempDir, langConfig.fileName);
        let generatedCode = codegenResult.code;
        if (langConfig.prependCode) {
          generatedCode = langConfig.prependCode + generatedCode;
        }
        await writeFile(generatedFilePath, generatedCode, 'utf-8');

        emitPhase('compilation', 'pending', {
          mode: 'codegen',
          generatedLines: codegenResult.stats.linesGenerated,
          generatedFunctions: codegenResult.stats.functionsGenerated,
        });
      } else {
        if (executionMode === 'codegen') {
          console.log(`[TerminalService] Codegen failed for ${requestId}, falling back to native mode`);
        }

        emitPhase('compilation', 'pending', {
          mode: 'native',
          reason: executionPlan?.reason || 'Using original source',
        });
      }

      execution.executionMode = executionMode;

      // COMPILATION (for C, C++)
      if (langConfig.compileCmd) {
        emitPhase('compilation', 'running', {
          command: langConfig.compileCmd.command + ' ' + langConfig.compileCmd.args.join(' '),
        });

        const compileResult = await compileStep(langConfig.compileCmd, tempDir, emitPhase);
        allDiagnostics.push(...compileResult.diagnostics);

        if (!compileResult.success) {
          emitPhase('compilation', 'failed', {
            errors: compileResult.diagnostics.filter(d => d.severity === 'error').length,
            warnings: compileResult.diagnostics.filter(d => d.severity === 'warning').length,
          });

          emitExit(1, Date.now() - startTime, {
            success: false,
            executionMode,
            diagnostics: allDiagnostics.slice(0, 50),
          });

          activeExecutions.delete(requestId);
          cleanupDir(tempDir);
          return;
        }

        emitPhase('compilation', 'completed', {
          warnings: compileResult.diagnostics.filter(d => d.severity === 'warning').length,
        });
      } else {
        emitPhase('compilation', 'skipped', { message: `No compilation required for ${language}` });
      }
    } else {
      emitPhase('compilation', 'skipped', { message: 'Pipeline not available — native execution' });
    }

    // ══════════════════════════════════════════════════════════
    //  EXECUTION (PTY-based)
    // ══════════════════════════════════════════════════════════
    emitPhase('execution', 'starting', {});

    if (ptyAvailable && pty) {
      console.log(`[TerminalService] Using PTY for ${requestId} (mode: ${executionMode})`);
      startWithPty(execution, langConfig!, tempDir, termRows, termCols, startTime, executionMode, requestId, ws, emitPhase, emitOutput, emitExit, allDiagnostics);
    } else {
      console.log(`[TerminalService] Using pipes (no PTY) for ${requestId} (mode: ${executionMode})`);
      startWithPipes(execution, langConfig!, tempDir, startTime, executionMode, requestId, ws, emitPhase, emitOutput, emitExit);
    }

  } catch (error: any) {
    console.error(`[TerminalService] Pipeline error for ${requestId}:`, error);
    emitOutput(`\r\n\x1b[31m[Engine Error] ${error.message}\x1b[0m\r\n`);
    emitExit(1, Date.now() - startTime);
    activeExecutions.delete(requestId);
    cleanupDir(tempDir);
  }
}

// ─── Handle Stdin ───────────────────────────────────────────────────────────

function handleStdin(ws: WebSocket, msg: any) {
  const { requestId, data } = msg;
  const execution = activeExecutions.get(requestId);

  const dataPreview = data?.length <= 20
    ? JSON.stringify(data)
    : JSON.stringify(data?.slice(0, 20)) + `... (${data?.length} chars)`;
  console.log(`[TerminalService] stdin: requestId=${requestId}, data=${dataPreview}, found=${!!execution}, hasPty=${!!execution?.ptyProcess}`);

  if (!execution) {
    console.warn(`[TerminalService] stdin DROPPED: no active execution for requestId=${requestId}`);
    console.log(`[TerminalService] Active executions: [${Array.from(activeExecutions.keys()).join(', ')}]`);
    return;
  }

  try {
    if (execution.ptyProcess) {
      execution.ptyProcess.write(data);
      console.log(`[TerminalService] stdin written to PTY for ${requestId}: ${dataPreview}`);
    } else if (execution.process?.stdin) {
      execution.process.stdin.write(data);
      console.log(`[TerminalService] stdin written to process.stdin for ${requestId}: ${dataPreview}`);
    } else {
      console.warn(`[TerminalService] stdin DROPPED: no PTY or process.stdin for requestId=${requestId}`);
    }
  } catch (err) {
    console.error(`[TerminalService] Failed to write stdin for ${requestId}:`, err);
  }
}

// ─── Handle Resize ──────────────────────────────────────────────────────────

function handleResize(ws: WebSocket, msg: any) {
  const { requestId, rows, cols } = msg;
  const execution = activeExecutions.get(requestId);
  if (!execution) return;

  try {
    if (execution.ptyProcess) {
      execution.ptyProcess.resize(cols, rows);
    }
  } catch {}
}

// ─── Handle Kill ────────────────────────────────────────────────────────────

function handleKill(ws: WebSocket, msg: any) {
  const { requestId } = msg;
  const execution = activeExecutions.get(requestId);
  if (!execution) return;

  execution.killed = true;
  killPtyProcess(execution);
  activeExecutions.delete(requestId);
  cleanupDir(execution.tempDir);

  sendMsg(ws, {
    type: 'exit',
    requestId,
    exitCode: -1,
    executionTime: Date.now() - execution.startTime,
    killed: true,
  });
}

// ─── PTY-based execution ──────────────────────────────────────────────────

function startWithPty(
  execution: ActiveExecution,
  langConfig: NonNullable<ReturnType<typeof getLanguageConfig>>,
  tempDir: string,
  termRows: number,
  termCols: number,
  startTime: number,
  executionMode: string,
  requestId: string,
  ws: WebSocket,
  emitPhase: (phase: string, status: string, data?: Record<string, unknown>) => void,
  emitOutput: (data: string) => void,
  emitExit: (exitCode: number, executionTime: number, summary?: Record<string, unknown>) => void,
  allDiagnostics: PipelineDiagnostic[],
) {
  const runCmd = langConfig.runCmd;
  const args = runCmd.args.length > 0 ? runCmd.args : [];

  let ptyProcess;
  try {
    ptyProcess = pty.spawn(runCmd.command, args, {
      name: 'xterm-256color',
      cols: termCols,
      rows: termRows,
      cwd: tempDir,
      env: RESTRICTED_ENV,
    });
    console.log(`[TerminalService] PTY spawned for ${requestId}, PID=${ptyProcess.pid}`);
  } catch (err: any) {
    console.error(`[TerminalService] PTY spawn failed:`, err.message);
    emitOutput(`\x1b[31mError: Failed to start PTY: ${err.message}\x1b[0m\r\n`);
    emitExit(1, Date.now() - startTime);
    activeExecutions.delete(requestId);
    cleanupDir(tempDir);
    return;
  }

  execution.ptyProcess = ptyProcess;

  emitPhase('execution', 'running', {
    pid: ptyProcess.pid,
    mode: executionMode,
  });

  // Safety timeout
  const timeoutHandle = setTimeout(() => {
    if (execution.killed) return;
    execution.killed = true;
    killPtyProcess(execution);
    emitOutput('\r\n\x1b[31mError: Execution timed out\x1b[0m\r\n');
    allDiagnostics.push({
      type: 'timeout',
      phase: 'execution',
      message: `Execution timed out after ${INTERACTIVE_TIMEOUT / 1000}s`,
      severity: 'error',
    });
    emitExit(-1, INTERACTIVE_TIMEOUT, buildSummary(-1, allDiagnostics, executionMode));
    activeExecutions.delete(requestId);
    cleanupDir(tempDir);
  }, INTERACTIVE_TIMEOUT);

  // Stream PTY output directly to the client via WebSocket
  ptyProcess.onData((data: string) => {
    emitOutput(data);
  });

  // Handle process exit
  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    clearTimeout(timeoutHandle);
    if (!execution.killed) {
      emitPhase('output_processing', 'completed', {});
      emitExit(exitCode, Date.now() - startTime, buildSummary(exitCode, allDiagnostics, executionMode));
    }
    activeExecutions.delete(requestId);
    cleanupDir(tempDir);
  });
}

// ─── Pipe-based fallback ──────────────────────────────────────────────────

function startWithPipes(
  execution: ActiveExecution,
  langConfig: NonNullable<ReturnType<typeof getLanguageConfig>>,
  tempDir: string,
  startTime: number,
  executionMode: string,
  requestId: string,
  ws: WebSocket,
  emitPhase: (phase: string, status: string, data?: Record<string, unknown>) => void,
  emitOutput: (data: string) => void,
  emitExit: (exitCode: number, executionTime: number, summary?: Record<string, unknown>) => void,
) {
  const runCmd = langConfig.runCmd;
  const runProc = spawn(runCmd.command, runCmd.args, {
    cwd: tempDir,
    env: RESTRICTED_ENV,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  execution.process = runProc;

  emitPhase('execution', 'running', {
    pid: runProc.pid,
    mode: executionMode,
  });

  const timeoutHandle = setTimeout(() => {
    if (execution.killed) return;
    execution.killed = true;
    try { runProc.stdin?.end(); } catch {}
    killPtyProcess(execution);
    emitOutput('\n\x1b[31mError: Execution timed out\x1b[0m');
    emitExit(-1, INTERACTIVE_TIMEOUT);
    activeExecutions.delete(requestId);
    cleanupDir(tempDir);
  }, INTERACTIVE_TIMEOUT);

  runProc.stdout?.on('data', (data: Buffer) => {
    emitOutput(data.toString());
  });

  runProc.stderr?.on('data', (data: Buffer) => {
    emitOutput(`\x1b[31m${data.toString()}\x1b[0m`);
  });

  runProc.on('error', (err) => {
    clearTimeout(timeoutHandle);
    emitOutput(`\x1b[31mError: Failed to execute: ${err.message}\x1b[0m`);
    emitExit(1, Date.now() - startTime);
    activeExecutions.delete(requestId);
    cleanupDir(tempDir);
  });

  runProc.on('close', (exitCode) => {
    clearTimeout(timeoutHandle);
    if (!execution.killed) {
      emitExit(exitCode ?? 1, Date.now() - startTime);
    }
    activeExecutions.delete(requestId);
    cleanupDir(tempDir);
  });
}

// ─── Build Summary ─────────────────────────────────────────────────────────

function buildSummary(exitCode: number, diagnostics: PipelineDiagnostic[], executionMode: string) {
  const runtimeDiags = diagnostics.filter(d => d.phase === 'execution' && d.type === 'runtime_error');
  return {
    success: exitCode === 0 && runtimeDiags.length === 0,
    executionMode,
    diagnostics: diagnostics.slice(0, 50),
    errorCounts: {
      lexical: diagnostics.filter(d => d.phase === 'lexical_analysis').length,
      parsing: diagnostics.filter(d => d.phase === 'parsing').length,
      semantic: diagnostics.filter(d => d.phase === 'semantic_analysis').length,
      security: diagnostics.filter(d => d.phase === 'security_analysis').length,
      compilation: diagnostics.filter(d => d.phase === 'compilation' && d.type === 'compilation_error').length,
      runtime: runtimeDiags.length,
    },
  };
}

// ─── Process Error Handlers ────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('[TerminalService] UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[TerminalService] UNHANDLED REJECTION:', reason);
});

// ─── Start Server ──────────────────────────────────────────────────────────

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[TerminalService] ══════════════════════════════════════════════`);
  console.log(`[TerminalService] CodeForge Terminal Service v5.1`);
  console.log(`[TerminalService] Raw WebSocket server listening on port ${PORT}`);
  console.log(`[TerminalService] PTY available: ${ptyAvailable}`);
  console.log(`[TerminalService] ══════════════════════════════════════════════`);
});
