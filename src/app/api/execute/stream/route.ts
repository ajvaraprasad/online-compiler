/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge Execution Engine — API Route (v4.0 — True Compiler Architecture)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Full compiler pipeline:
 *   Phase 1:  LEXICAL ANALYSIS    — Character-by-character tokenization
 *   Phase 2:  PARSING             — Recursive descent → AST
 *   Phase 3:  SEMANTIC ANALYSIS   — Symbol table, type checking, scope resolution
 *   Phase 4:  IR GENERATION       — AST → Three-address code
 *   Phase 5:  OPTIMIZATION        — Constant folding, DCE, algebraic simplification
 *   Phase 6:  SECURITY ANALYSIS   — AST-based security scanning
 *   Phase 7:  CODE GENERATION     — Optimized IR → target source / execution plan
 *   Phase 8:  COMPILATION         — Real compiler invocation (gcc/g++/javac)
 *   Phase 9:  EXECUTION           — PTY-based execution with terminal semantics
 *   Phase 10: OUTPUT PROCESSING   — Structured error reporting & diagnostics
 *
 * Execution modes:
 *   ir_vm    — Direct IR interpretation (for simple programs)
 *   codegen  — Generate target source from IR, compile & execute
 *   native   — Execute original source via real compilers/runtimes
 *
 * Endpoints:
 *   POST   /api/execute/stream  — Start execution (returns SSE stream)
 *   PUT    /api/execute/stream  — Send stdin to running process
 *   PATCH  /api/execute/stream  — Resize PTY terminal
 *   DELETE /api/execute/stream  — Kill running process
 */

import { NextRequest } from 'next/server';
import { spawn, ChildProcess } from 'child_process';
import { writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ─── Lazy-loaded Compiler Pipeline ─────────────────────────────────────────

type CompilerPipelineType = typeof import('@/lib/compiler/pipeline').CompilerPipeline;
type ParseCompilationErrorsType = typeof import('@/lib/compiler/pipeline').parseCompilationErrors;
type ParseRuntimeErrorType = typeof import('@/lib/compiler/pipeline').parseRuntimeError;
type CompilerPhaseType = import('@/lib/compiler/pipeline').PhaseEventData;
type PipelineResultType = import('@/lib/compiler/types').PipelineResult;
type ExecutionPlanType = import('@/lib/compiler/types').ExecutionPlan;
type CodegenResultType = import('@/lib/compiler/types').CodegenResult;
type VMResultType = import('@/lib/compiler/types').VMResult;

let _pipelineModule: typeof import('@/lib/compiler/pipeline') | null = null;
let _vmModule: typeof import('@/lib/compiler/vm') | null = null;

async function getPipeline() {
  if (!_pipelineModule) {
    _pipelineModule = await import('@/lib/compiler/pipeline');
    console.log('[Engine] Compiler pipeline modules loaded (v4.0 — True Compiler Architecture)');
  }
  return _pipelineModule;
}

async function getVM() {
  if (!_vmModule) {
    _vmModule = await import('@/lib/compiler/vm');
    console.log('[Engine] IR VM module loaded');
  }
  return _vmModule;
}

// ─── PTY Import ─────────────────────────────────────────────────────────────

let pty: any = null;
let ptyAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  pty = require('node-pty');
  ptyAvailable = true;
  console.log('[Engine] node-pty loaded successfully');
} catch (e) {
  console.warn('[Engine] node-pty NOT available, falling back to pipes:', e);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActiveExecution {
  ptyProcess: any;
  process?: ChildProcess;
  tempDir: string;
  startTime: number;
  killed: boolean;
  pipelineDiagnostics: PipelineDiagnostic[];
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
const INTERACTIVE_TIMEOUT = 5 * 60_000;
const HEARTBEAT_INTERVAL = 15_000;

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
        prependCode: "// Auto-injected: ensure Node.js exits when stdin closes\nprocess.stdin.on('end', () => process.exit(0));\n\n",
      };
    default:
      return null;
  }
}

// ─── Compile Step ────────────────────────────────────────────────────────────

async function compileStep(
  compileCmd: { command: string; args: string[] },
  tempDir: string,
  sendData: (type: string, data: string) => void
): Promise<{ success: boolean; stderr: string; diagnostics: PipelineDiagnostic[] }> {
  return new Promise((resolve) => {
    const proc = spawn(compileCmd.command, compileCmd.args, {
      cwd: tempDir,
      env: RESTRICTED_ENV,
    });
    let stderr = '';

    proc.stdout?.on('data', () => {});
    proc.stderr?.on('data', (data: Buffer) => {
      const str = data.toString();
      stderr += str;
      sendData('stderr', str);
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
      const pipeline = await getPipeline();
      const diagnostics: PipelineDiagnostic[] = pipeline.parseCompilationErrors(stderr, '').map(d => ({
        type: d.type || 'compilation_error',
        phase: d.phase,
        message: d.message,
        line: d.line,
        col: d.col,
        severity: d.severity,
        raw: d.raw,
      }));
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

// ─── POST: Start execution with SSE stream (Full Pipeline) ──────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, language, requestId, rows, cols } = body;

    // ── Basic Validation ──────────────────────────────────────────────
    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ error: 'Code is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!ALLOWED_LANGUAGES.includes(language)) {
      return new Response(
        JSON.stringify({ error: `Unsupported language: ${language}. Supported: ${ALLOWED_LANGUAGES.join(', ')}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (Buffer.byteLength(code, 'utf-8') > MAX_CODE_SIZE) {
      return new Response(
        JSON.stringify({ error: `Code size exceeds limit (${MAX_CODE_SIZE} bytes)` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (requestId && activeExecutions.has(requestId)) {
      return new Response(
        JSON.stringify({ error: 'This requestId is already being executed' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Setup ─────────────────────────────────────────────────────────
    const execId = randomUUID().slice(0, 8);
    const tempDir = join(tmpdir(), `exec_${execId}`);
    const langConfig = getLanguageConfig(language, tempDir);

    if (!langConfig) {
      return new Response(
        JSON.stringify({ error: 'Invalid language configuration' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await mkdir(tempDir, { recursive: true });

    let codeToWrite = code;
    if (langConfig.prependCode) {
      codeToWrite = langConfig.prependCode + code;
    }

    const filePath = join(tempDir, langConfig.fileName);
    await writeFile(filePath, codeToWrite, 'utf-8');

    const startTime = Date.now();
    const procId = requestId || `proc_${execId}`;
    const termRows = rows || 24;
    const termCols = cols || 80;

    // ── Create SSE Stream with Full Pipeline ──────────────────────────
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const allDiagnostics: PipelineDiagnostic[] = [];

        const sendData = (type: string, data: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
          } catch {
            closed = true;
          }
        };

        const sendEnd = (exitCode: number, executionTime: number, pipelineSummary?: Record<string, unknown>) => {
          if (closed) return;
          const endData: Record<string, unknown> = { exitCode, executionTime };
          if (pipelineSummary) {
            endData.summary = pipelineSummary;
          }
          sendData('end', JSON.stringify(endData));
          closeStream();
        };

        const closeStream = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          try { controller.close(); } catch {}
        };

        // Start event
        sendData('start', JSON.stringify({
          requestId: procId,
          timestamp: startTime,
          engine: 'CodeForge v4.0 — True Compiler Architecture',
          pipeline: [
            'lexical_analysis', 'parsing', 'semantic_analysis',
            'ir_generation', 'optimization', 'security_analysis',
            'code_generation', 'compilation', 'execution', 'output_processing',
          ],
        }));

        // Heartbeat
        const heartbeat = setInterval(() => {
          sendData('heartbeat', Date.now().toString());
        }, HEARTBEAT_INTERVAL);

        // Cleanup
        const cleanup = () => {
          activeExecutions.delete(procId);
          cleanupDir(tempDir);
        };

        // Client disconnect handler
        request.signal.addEventListener('abort', () => {
          if (closed) return;
          console.log(`[Engine] Client disconnected for ${procId}`);
          const execution = activeExecutions.get(procId);
          if (execution && !execution.killed) {
            execution.killed = true;
            killPtyProcess(execution);
          }
          closeStream();
          cleanup();
        });

        // ══════════════════════════════════════════════════════════════
        //  RUN FULL COMPILER PIPELINE (Phases 1-7)
        // ══════════════════════════════════════════════════════════════
        (async () => {
          try {
            const pipelineModule = await getPipeline();
            const vmModule = await getVM();

            // Create and run the full pipeline (phases 1-7)
            const pipeline = new pipelineModule.CompilerPipeline({
              code,
              language,
              onEvent: sendData,
            });

            const pipelineResult = await pipeline.run();

            // Collect diagnostics from the pipeline
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

            // If pipeline phases 1-6 failed, stop here
            if (!pipelineResult.success) {
              console.log(`[Engine] Pipeline blocked for ${procId}: analysis failed`);

              const summary = {
                success: false,
                diagnostics: allDiagnostics.slice(0, 50),
                phases: Object.fromEntries(
                  Object.entries(pipelineResult.phases).map(([k, v]) => [k, v.status])
                ),
                metrics: pipelineResult.metrics,
              };

              sendEnd(1, Date.now() - startTime, summary);
              cleanup();
              return;
            }

            // Get the execution plan from the pipeline
            const executionPlan = pipeline.getExecutionPlan();
            const codegenResult = pipeline.getCodegenResult();
            const executionMode = executionPlan?.mode || 'native';

            console.log(`[Engine] Execution plan for ${procId}: mode=${executionMode}, reason=${executionPlan?.reason}`);

            // ══════════════════════════════════════════════════════════
            //  PHASE 8: COMPILATION / EXECUTION based on mode
            // ══════════════════════════════════════════════════════════

            // SAFETY CHECK: If the code contains input functions, NEVER use IR VM.
            // IR VM cannot handle interactive stdin — it will silently fail.
            // This is a redundant safety net in case the execution engine misses it.
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
              console.log(`[Engine] Forcing native mode for ${procId}: code contains input functions requiring PTY`);
              // Override the execution plan
              // Fall through to native execution below
            } else if (executionMode === 'ir_vm') {
              // ── IR VM Execution ──────────────────────────────────────
              sendData('phase', JSON.stringify({
                phase: 'compilation',
                status: 'skipped',
                message: 'Using IR Virtual Machine — no compilation needed',
              }));

              sendData('phase', JSON.stringify({
                phase: 'execution',
                status: 'running',
                mode: 'ir_vm',
              }));

              const optimizedProgram = pipeline.getOptimizationResult()?.program ?? pipeline.getIRResult()?.program;
              if (!optimizedProgram) {
                // This shouldn't happen if plan is 'ir_vm', but handle gracefully
                sendData('stderr', '\x1b[31mError: IR program not available for VM execution\x1b[0m\r\n');
                sendEnd(1, Date.now() - startTime);
                cleanup();
                return;
              }

              const vmStartTime = Date.now();
              const vmResult = vmModule.executeIR(optimizedProgram);
              const vmExecutionTime = Date.now() - vmStartTime;

              // Send VM output
              for (const line of vmResult.output) {
                sendData('stdout', line + '\n');
              }

              if (vmResult.error) {
                sendData('stderr', `\x1b[31m${vmResult.error}\x1b[0m\r\n`);
              }

              sendData('phase', JSON.stringify({
                phase: 'execution',
                status: vmResult.success ? 'completed' : 'failed',
                durationMs: vmExecutionTime,
                mode: 'ir_vm',
                stepsExecuted: vmResult.stepsExecuted,
              }));

              // Output processing
              sendData('phase', JSON.stringify({ phase: 'output_processing', status: 'completed' }));

              const summary = {
                success: vmResult.success,
                diagnostics: allDiagnostics.slice(0, 50),
                executionMode: 'ir_vm',
                phases: Object.fromEntries(
                  Object.entries(pipelineResult.phases).map(([k, v]) => [k, v.status])
                ),
                metrics: pipelineResult.metrics,
                vmSteps: vmResult.stepsExecuted,
              };

              sendEnd(vmResult.exitCode, Date.now() - startTime, summary);
              cleanup();
              return;
            }

            if (executionMode === 'codegen' && codegenResult?.success && codegenResult.code) {
              // ── Code Generation → Compile → Execute ────────────────
              console.log(`[Engine] Using codegen mode for ${procId}, generated ${codegenResult.stats.linesGenerated} lines`);

              // Write the GENERATED code instead of the original
              const generatedFilePath = join(tempDir, langConfig.fileName);
              let generatedCode = codegenResult.code;
              if (langConfig.prependCode) {
                generatedCode = langConfig.prependCode + generatedCode;
              }
              await writeFile(generatedFilePath, generatedCode, 'utf-8');

              // Continue to compilation phase with the generated code
              sendData('phase', JSON.stringify({
                phase: 'compilation',
                status: 'pending',
                mode: 'codegen',
                generatedLines: codegenResult.stats.linesGenerated,
                generatedFunctions: codegenResult.stats.functionsGenerated,
              }));
            } else {
              // ── Native Mode ─────────────────────────────────────────
              // Use the original source code (already written to tempDir)
              if (executionMode === 'codegen') {
                console.log(`[Engine] Codegen failed for ${procId}, falling back to native mode`);
              }

              sendData('phase', JSON.stringify({
                phase: 'compilation',
                status: 'pending',
                mode: 'native',
                reason: executionPlan?.reason || 'Using original source',
              }));
            }

            // ══════════════════════════════════════════════════════════
            //  COMPILATION (for C, C++ — using generated or original code)
            // ══════════════════════════════════════════════════════════
            if (langConfig.compileCmd) {
              sendData('phase', JSON.stringify({
                phase: 'compilation',
                status: 'running',
                command: langConfig.compileCmd.command + ' ' + langConfig.compileCmd.args.join(' '),
              }));

              const compileResult = await compileStep(langConfig.compileCmd, tempDir, sendData);
              allDiagnostics.push(...compileResult.diagnostics);

              if (!compileResult.success) {
                sendData('phase', JSON.stringify({
                  phase: 'compilation',
                  status: 'failed',
                  errors: compileResult.diagnostics.filter(d => d.severity === 'error').length,
                  warnings: compileResult.diagnostics.filter(d => d.severity === 'warning').length,
                }));

                const summary = {
                  success: false,
                  diagnostics: allDiagnostics.slice(0, 50),
                  executionMode,
                  phases: {
                    ...Object.fromEntries(
                      Object.entries(pipelineResult.phases).map(([k, v]) => [k, v.status])
                    ),
                    compilation: 'failed',
                    execution: 'skipped',
                    output_processing: 'skipped',
                  },
                  metrics: pipelineResult.metrics,
                };

                sendEnd(1, Date.now() - startTime, summary);
                cleanup();
                return;
              }

              sendData('phase', JSON.stringify({
                phase: 'compilation',
                status: 'completed',
                warnings: compileResult.diagnostics.filter(d => d.severity === 'warning').length,
              }));
            } else {
              sendData('phase', JSON.stringify({
                phase: 'compilation',
                status: 'skipped',
                message: `No compilation required for ${language}`,
              }));
            }

            // ══════════════════════════════════════════════════════════
            //  EXECUTION (PTY-based)
            // ══════════════════════════════════════════════════════════
            sendData('phase', JSON.stringify({ phase: 'execution', status: 'starting' }));

            if (ptyAvailable && pty) {
              console.log(`[Engine] Using PTY for ${procId} (mode: ${executionMode})`);
              startWithPty(executionMode);
            } else {
              console.log(`[Engine] Using pipes (no PTY) for ${procId} (mode: ${executionMode})`);
              startWithPipes(executionMode);
            }

          } catch (error: any) {
            console.error(`[Engine] Pipeline error for ${procId}:`, error);
            sendData('stderr', `\r\n\x1b[31m[Engine Error] ${error.message}\x1b[0m\r\n`);
            sendEnd(1, Date.now() - startTime);
            cleanup();
          }
        })();

        // ─── PTY-based execution ────────────────────────────────────

        function startWithPty(executionMode: string) {
          const runCmd = langConfig!.runCmd;
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
            console.log(`[Engine] PTY spawned for ${procId}, PID=${ptyProcess.pid}`);
          } catch (err: any) {
            console.error(`[Engine] PTY spawn failed:`, err.message);
            sendData('stderr', `\x1b[31mError: Failed to start PTY: ${err.message}\x1b[0m\r\n`);
            sendEnd(1, Date.now() - startTime);
            cleanup();
            return;
          }

          const execution: ActiveExecution = {
            ptyProcess,
            tempDir,
            startTime,
            killed: false,
            pipelineDiagnostics: allDiagnostics,
            executionMode,
          };
          activeExecutions.set(procId, execution);

          sendData('phase', JSON.stringify({
            phase: 'execution',
            status: 'running',
            pid: ptyProcess.pid,
            mode: executionMode,
          }));

          // Safety timeout
          const timeoutHandle = setTimeout(() => {
            if (execution.killed) return;
            execution.killed = true;
            killPtyProcess(execution);
            sendData('stderr', '\r\n\x1b[31mError: Execution timed out\x1b[0m\r\n');
            allDiagnostics.push({
              type: 'timeout',
              phase: 'execution',
              message: `Execution timed out after ${INTERACTIVE_TIMEOUT / 1000}s`,
              severity: 'error',
            });
            sendEnd(-1, INTERACTIVE_TIMEOUT, buildSummary(-1, allDiagnostics, executionMode));
            cleanup();
          }, INTERACTIVE_TIMEOUT);

          // Stream PTY output
          ptyProcess.onData((data: string) => {
            sendData('stdout', data);
          });

          // Handle process exit
          ptyProcess.onExit(async ({ exitCode }: { exitCode: number }) => {
            clearTimeout(timeoutHandle);
            if (!execution.killed) {
              sendEnd(exitCode, Date.now() - startTime, buildSummary(exitCode, allDiagnostics, executionMode));
            }
            cleanup();
          });
        }

        // ─── Pipe-based fallback ────────────────────────────────────

        function startWithPipes(executionMode: string) {
          const runCmd = langConfig!.runCmd;
          const runProc = spawn(runCmd.command, runCmd.args, {
            cwd: tempDir,
            env: RESTRICTED_ENV,
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          const execution: ActiveExecution = {
            ptyProcess: null,
            process: runProc,
            tempDir,
            startTime,
            killed: false,
            pipelineDiagnostics: allDiagnostics,
            executionMode,
          };
          activeExecutions.set(procId, execution);

          sendData('phase', JSON.stringify({
            phase: 'execution',
            status: 'running',
            pid: runProc.pid,
            mode: executionMode,
          }));

          const timeoutHandle = setTimeout(() => {
            if (execution.killed) return;
            execution.killed = true;
            try { runProc.stdin?.end(); } catch {}
            killPtyProcess(execution);
            sendData('stderr', '\n\x1b[31mError: Execution timed out\x1b[0m');
            sendEnd(-1, INTERACTIVE_TIMEOUT);
            cleanup();
          }, INTERACTIVE_TIMEOUT);

          runProc.stdout?.on('data', (data: Buffer) => {
            sendData('stdout', data.toString());
          });

          runProc.stderr?.on('data', (data: Buffer) => {
            const str = data.toString();
            sendData('stderr', str);
          });

          runProc.on('error', (err) => {
            clearTimeout(timeoutHandle);
            sendData('stderr', `\x1b[31mError: Failed to execute: ${err.message}\x1b[0m`);
            sendEnd(1, Date.now() - startTime);
            cleanup();
          });

          runProc.on('close', (exitCode) => {
            clearTimeout(timeoutHandle);
            if (!execution.killed) {
              sendEnd(exitCode ?? 1, Date.now() - startTime);
            }
            cleanup();
          });
        }

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
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Execute stream error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── PUT: Send stdin to a running process ───────────────────────────────────

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { requestId, data } = body;

    if (!requestId || data === undefined) {
      return new Response(JSON.stringify({ error: 'requestId and data required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const execution = activeExecutions.get(requestId);
    if (!execution) {
      return new Response(JSON.stringify({ error: 'No running process found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      if (execution.ptyProcess) {
        execution.ptyProcess.write(data);
      } else if (execution.process?.stdin) {
        execution.process.stdin.write(data);
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to write stdin' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── PATCH: Resize PTY terminal ─────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { requestId, rows, cols } = body;

    if (!requestId || rows === undefined || cols === undefined) {
      return new Response(JSON.stringify({ error: 'requestId, rows, and cols required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const execution = activeExecutions.get(requestId);
    if (!execution) {
      return new Response(JSON.stringify({ error: 'No running process found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      if (execution.ptyProcess) {
        execution.ptyProcess.resize(cols, rows);
      }
      return new Response(JSON.stringify({ success: true, rows, cols }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── DELETE: Kill a running process ─────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { requestId } = body;

    if (!requestId) {
      return new Response(JSON.stringify({ error: 'requestId required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const execution = activeExecutions.get(requestId);
    if (!execution) {
      return new Response(JSON.stringify({ error: 'No running process found', killed: false }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    execution.killed = true;
    killPtyProcess(execution);
    activeExecutions.delete(requestId);
    cleanupDir(execution.tempDir);

    return new Response(JSON.stringify({ killed: true, requestId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
}
