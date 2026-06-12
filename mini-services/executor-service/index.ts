import { createServer } from 'http'
import { Server } from 'socket.io'
import { spawn } from 'child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExecutePayload {
  code: string
  language: string
  stdin?: string
  requestId: string
  interactive?: boolean // if true, keep stdin open for interactive input
}

interface StdinPayload {
  requestId: string
  data: string
}

interface KillPayload {
  requestId: string
}

interface ActiveExecution {
  requestId: string
  process: ReturnType<typeof spawn>
  tempDir: string
  timeoutHandle: ReturnType<typeof setTimeout>
  startTime: number
  socketId: string
  interactive: boolean
  stdinBuffer: string // buffer for stdin data sent before process is ready
}

// ─── State ───────────────────────────────────────────────────────────────────

// Map socketId -> ActiveExecution[]
const activeExecutions = new Map<string, ActiveExecution[]>()

// Map requestId -> ActiveExecution (for quick kill/stdin lookup)
const executionByRequestId = new Map<string, ActiveExecution>()

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_STDIN_SIZE = 64 * 1024 // 64 KB
const MAX_CODE_SIZE = 256 * 1024 // 256 KB
const SUPPORTED_LANGUAGES = ['python', 'c', 'cpp', 'java', 'javascript']

const RESTRICTED_ENV: Record<string, string> = {
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
  HOME: '/tmp',
  USER: 'nobody',
  LANG: 'en_US.UTF-8',
  TERM: 'dumb',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getExecId(): string {
  return randomUUID().slice(0, 8)
}

function createTempDir(execId: string): string {
  const dir = `/tmp/exec_${execId}`
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupTempDir(dir: string) {
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  } catch (err) {
    console.error(`Failed to cleanup temp dir ${dir}:`, err)
  }
}

function killProcessTree(proc: ReturnType<typeof spawn>) {
  try {
    if (proc.pid) {
      // Send SIGKILL to the process group (negative PID kills the whole tree)
      try {
        process.kill(-proc.pid, 'SIGKILL')
      } catch {
        // Fallback: kill just the process
        proc.kill('SIGKILL')
      }
    }
  } catch (err) {
    // Process may have already exited
  }
}

function removeExecutionFromTracking(execution: ActiveExecution) {
  // Remove from socket tracking
  const socketExecs = activeExecutions.get(execution.socketId)
  if (socketExecs) {
    const idx = socketExecs.indexOf(execution)
    if (idx !== -1) {
      socketExecs.splice(idx, 1)
    }
    if (socketExecs.length === 0) {
      activeExecutions.delete(execution.socketId)
    }
  }

  // Remove from requestId tracking
  executionByRequestId.delete(execution.requestId)
}

function getLanguageConfig(language: string, tempDir: string): {
  fileName: string
  compileCmd?: { command: string; args: string[] }
  runCmd: { command: string; args: string[] }
} | null {
  switch (language) {
    case 'python':
      return {
        fileName: 'main.py',
        runCmd: { command: 'python3', args: ['-u', join(tempDir, 'main.py')] },
      }
    case 'c':
      return {
        fileName: 'main.c',
        compileCmd: {
          command: 'gcc',
          args: ['-o', join(tempDir, 'main'), join(tempDir, 'main.c'), '-lm'],
        },
        // Use stdbuf -o0 to disable stdout buffering so printf prompts flush immediately
        runCmd: { command: 'stdbuf', args: ['-o0', join(tempDir, 'main')] },
      }
    case 'cpp':
      return {
        fileName: 'main.cpp',
        compileCmd: {
          command: 'g++',
          args: ['-o', join(tempDir, 'main'), join(tempDir, 'main.cpp'), '-lm'],
        },
        // Use stdbuf -o0 to disable stdout buffering so cout prompts flush immediately
        runCmd: { command: 'stdbuf', args: ['-o0', join(tempDir, 'main')] },
      }
    case 'java':
      return {
        fileName: 'Main.java',
        // Use Java 11+ source-file execution mode (no javac needed)
        // This runs the .java file directly without a separate compile step
        runCmd: { command: 'java', args: [join(tempDir, 'Main.java')] },
      }
    case 'javascript':
      return {
        fileName: 'main.js',
        runCmd: { command: 'node', args: [join(tempDir, 'main.js')] },
      }
    default:
      return null
  }
}

function runCompileStep(
  compileCmd: { command: string; args: string[] },
  env: Record<string, string>,
  tempDir: string,
  socket: import('socket.io').Socket,
  requestId: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const compileProc = spawn(compileCmd.command, compileCmd.args, {
      cwd: tempDir,
      env,
      detached: false,
    })

    let compileStderr = ''

    compileProc.stderr?.on('data', (data: Buffer) => {
      const str = data.toString()
      compileStderr += str
      socket.emit('output', {
        requestId,
        type: 'stderr',
        data: str,
      })
    })

    compileProc.on('error', (err) => {
      reject(new Error(`Compilation failed: ${err.message}`))
    })

    compileProc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Compilation failed with exit code ${code}`))
      } else {
        resolve()
      }
    })
  })
}

// ─── Main Execute Handler ────────────────────────────────────────────────────

async function handleExecute(
  socket: import('socket.io').Socket,
  payload: ExecutePayload
) {
  const { code, language, stdin, requestId, interactive: isInteractive } = payload

  // Validate
  if (!code || typeof code !== 'string') {
    socket.emit('output', {
      requestId,
      type: 'stderr',
      data: 'Error: No code provided',
    })
    socket.emit('execution-end', {
      requestId,
      exitCode: 1,
      executionTime: 0,
      timestamp: Date.now(),
    })
    return
  }

  if (!SUPPORTED_LANGUAGES.includes(language)) {
    socket.emit('output', {
      requestId,
      type: 'stderr',
      data: `Error: Unsupported language '${language}'. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`,
    })
    socket.emit('execution-end', {
      requestId,
      exitCode: 1,
      executionTime: 0,
      timestamp: Date.now(),
    })
    return
  }

  if (code.length > MAX_CODE_SIZE) {
    socket.emit('output', {
      requestId,
      type: 'stderr',
      data: `Error: Code size exceeds limit (${MAX_CODE_SIZE} bytes)`,
    })
    socket.emit('execution-end', {
      requestId,
      exitCode: 1,
      executionTime: 0,
      timestamp: Date.now(),
    })
    return
  }

  if (stdin && stdin.length > MAX_STDIN_SIZE) {
    socket.emit('output', {
      requestId,
      type: 'stderr',
      data: `Error: Stdin size exceeds limit (${MAX_STDIN_SIZE} bytes)`,
    })
    socket.emit('execution-end', {
      requestId,
      exitCode: 1,
      executionTime: 0,
      timestamp: Date.now(),
    })
    return
  }

  // Check if this requestId is already running
  if (executionByRequestId.has(requestId)) {
    socket.emit('output', {
      requestId,
      type: 'stderr',
      data: 'Error: This requestId is already being executed',
    })
    socket.emit('execution-end', {
      requestId,
      exitCode: 1,
      executionTime: 0,
      timestamp: Date.now(),
    })
    return
  }

  const execId = getExecId()
  const tempDir = createTempDir(execId)
  const langConfig = getLanguageConfig(language, tempDir)!

  // Write source code to file
  const filePath = join(tempDir, langConfig.fileName)

  // For JavaScript/Node.js: prepend a stdin EOF handler so the process exits
  // when stdin is closed (e.g., when user presses Ctrl+C or timeout kills it).
  // Without this, Node.js keeps running because stdin pipe keeps the event loop alive.
  let codeToWrite = code
  if (language === 'javascript') {
    codeToWrite = `// Auto-injected: ensure Node.js exits when stdin closes\nprocess.stdin.on('end', () => process.exit(0));\n\n${code}`
  }

  try {
    writeFileSync(filePath, codeToWrite, 'utf-8')
  } catch (err: any) {
    socket.emit('output', {
      requestId,
      type: 'stderr',
      data: `Error: Failed to write source file: ${err.message}`,
    })
    socket.emit('execution-end', {
      requestId,
      exitCode: 1,
      executionTime: 0,
      timestamp: Date.now(),
    })
    cleanupTempDir(tempDir)
    return
  }

  const startTime = Date.now()
  const env = { ...RESTRICTED_ENV }

  // Emit execution-start
  socket.emit('execution-start', {
    requestId,
    timestamp: startTime,
  })

  // Compile step (for C, C++, Java)
  if (langConfig.compileCmd) {
    try {
      await runCompileStep(langConfig.compileCmd, env, tempDir, socket, requestId)
    } catch (err: any) {
      socket.emit('execution-end', {
        requestId,
        exitCode: 1,
        executionTime: Date.now() - startTime,
        timestamp: Date.now(),
      })
      cleanupTempDir(tempDir)
      return
    }
  }

  // Run step with streaming - ALWAYS use pipe for stdin to allow interactive input
  const runProc = spawn(langConfig.runCmd.command, langConfig.runCmd.args, {
    cwd: tempDir,
    env,
    detached: false,
    stdio: ['pipe', 'pipe', 'pipe'], // explicitly set up pipes
  })

  // For interactive programs: NO timeout — the terminal waits indefinitely for user input.
  // The user can stop execution with the Stop button or Ctrl+C.
  // For non-interactive programs: 60s safety timeout to prevent runaway processes.
  const timeoutMs = isInteractive ? 0 : 60_000
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      killProcessTree(runProc)
      socket.emit('output', {
        requestId,
        type: 'stderr',
        data: '\nError: Execution timed out',
      })
      socket.emit('execution-end', {
        requestId,
        exitCode: -1,
        executionTime: timeoutMs,
        timestamp: Date.now(),
      })
      cleanupTempDir(tempDir)
      removeExecutionFromTracking(execution)
    }, timeoutMs)
  }

  // Track execution
  const execution: ActiveExecution = {
    requestId,
    process: runProc,
    tempDir,
    timeoutHandle,
    startTime,
    socketId: socket.id,
    interactive: isInteractive,
    stdinBuffer: '',
  }

  // Add to tracking maps
  if (!activeExecutions.has(socket.id)) {
    activeExecutions.set(socket.id, [])
  }
  activeExecutions.get(socket.id)!.push(execution)
  executionByRequestId.set(requestId, execution)

  // Track process exit state
  let processExited = false

  // Stream stdout
  runProc.stdout?.on('data', (data: Buffer) => {
    socket.emit('output', {
      requestId,
      type: 'stdout',
      data: data.toString(),
    })
  })

  // Stream stderr
  runProc.stderr?.on('data', (data: Buffer) => {
    socket.emit('output', {
      requestId,
      type: 'stderr',
      data: data.toString(),
    })
  })

  // Handle spawn errors
  runProc.on('error', (err) => {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    processExited = true
    socket.emit('output', {
      requestId,
      type: 'stderr',
      data: `Error: Failed to execute: ${err.message}`,
    })
    socket.emit('execution-end', {
      requestId,
      exitCode: 1,
      executionTime: Date.now() - startTime,
      timestamp: Date.now(),
    })
    cleanupTempDir(tempDir)
    removeExecutionFromTracking(execution)
  })

  // Handle process exit
  runProc.on('close', (exitCode) => {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    processExited = true

    const executionTime = Date.now() - startTime
    socket.emit('execution-end', {
      requestId,
      exitCode: exitCode ?? 1,
      executionTime,
      timestamp: Date.now(),
    })

    // Clean up
    cleanupTempDir(tempDir)
    removeExecutionFromTracking(execution)
  })

  // Write pre-provided stdin if present (from STDIN dialog)
  if (stdin) {
    try {
      const stdinData = stdin.endsWith('\n') ? stdin : stdin + '\n'
      runProc.stdin?.write(stdinData)
    } catch (err) {
      // stdin write may fail if process already exited
    }
  }
  // stdin stays open for interactive input while program is running.
  // It is closed when the process exits, is killed, or the timeout fires.
}

// ─── Connection Handling ─────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Executor] Client connected: ${socket.id}`)

  socket.on('execute', (payload: ExecutePayload) => {
    console.log(`[Executor] Execute request from ${socket.id}: language=${payload.language}, requestId=${payload.requestId}, interactive=${payload.interactive}`)
    handleExecute(socket, payload)
  })

  // Handle interactive stdin input from the terminal
  socket.on('stdin', (payload: StdinPayload) => {
    const execution = executionByRequestId.get(payload.requestId)
    if (execution && execution.socketId === socket.id) {
      try {
        // Ensure data ends with newline for proper input() reading
        const data = payload.data.endsWith('\n') ? payload.data : payload.data + '\n'
        execution.process.stdin?.write(data)
      } catch (err) {
        console.error(`[Executor] Failed to write stdin for ${payload.requestId}:`, err)
      }
    }
  })

  socket.on('kill', (payload: KillPayload) => {
    console.log(`[Executor] Kill request from ${socket.id}: requestId=${payload.requestId}`)
    const execution = executionByRequestId.get(payload.requestId)

    if (execution && execution.socketId === socket.id) {
      clearTimeout(execution.timeoutHandle)
      // Close stdin before killing to prevent EPIPE errors
      try {
        execution.process.stdin?.end()
      } catch {}
      killProcessTree(execution.process)
      socket.emit('execution-killed', { requestId: payload.requestId })
      socket.emit('execution-end', {
        requestId: payload.requestId,
        exitCode: -1,
        executionTime: Date.now() - execution.startTime,
        timestamp: Date.now(),
      })
      cleanupTempDir(execution.tempDir)
      removeExecutionFromTracking(execution)
    } else {
      socket.emit('execution-killed', {
        requestId: payload.requestId,
        error: 'No running execution found for this requestId',
      })
    }
  })

  socket.on('disconnect', (reason) => {
    console.log(`[Executor] Client disconnected: ${socket.id} (reason: ${reason})`)

    // Kill all running processes for this socket
    const executions = activeExecutions.get(socket.id)
    if (executions) {
      for (const execution of [...executions]) {
        clearTimeout(execution.timeoutHandle)
        try {
          execution.process.stdin?.end()
        } catch {}
        killProcessTree(execution.process)
        cleanupTempDir(execution.tempDir)
        removeExecutionFromTracking(execution)
      }
    }
  })

  socket.on('error', (error) => {
    console.error(`[Executor] Socket error (${socket.id}):`, error)
  })
})

// ─── Start Server ────────────────────────────────────────────────────────────

const PORT = 3003
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[Executor] Code execution service running on 0.0.0.0:${PORT}`)
})

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

function gracefulShutdown(signal: string) {
  console.log(`[Executor] Received ${signal}, shutting down...`)

  // Kill all running executions
  for (const [socketId, executions] of activeExecutions) {
    for (const execution of executions) {
      clearTimeout(execution.timeoutHandle)
      try {
        execution.process.stdin?.end()
      } catch {}
      killProcessTree(execution.process)
      cleanupTempDir(execution.tempDir)
    }
  }
  activeExecutions.clear()
  executionByRequestId.clear()

  httpServer.close(() => {
    console.log('[Executor] Server closed')
    process.exit(0)
  })

  // Force exit after 5 seconds
  setTimeout(() => {
    console.error('[Executor] Forced shutdown after timeout')
    process.exit(1)
  }, 5000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
