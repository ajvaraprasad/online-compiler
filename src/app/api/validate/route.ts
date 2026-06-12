import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { writeFile, unlink, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Diagnostic {
  message: string;
  line: number;       // 1-based
  column: number;     // 1-based
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning' | 'info';
  source: string;     // e.g. 'gcc', 'python', 'node', 'javac'
}

interface ValidateRequestBody {
  code: string;
  language: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_LANGUAGES = ['python', 'c', 'cpp', 'javascript', 'java'];
const VALIDATION_TIMEOUT = 5000;       // 5 seconds
const MAX_CODE_SIZE = 256 * 1024;      // 256 KB

// ---------------------------------------------------------------------------
// Utility – run a command with timeout
// ---------------------------------------------------------------------------

interface CmdResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCommand(command: string, cwd?: string): Promise<CmdResult> {
  return new Promise((resolve) => {
    const child = exec(
      command,
      {
        cwd,
        timeout: VALIDATION_TIMEOUT,
        maxBuffer: 512 * 1024, // 512 KB output buffer
        env: { ...process.env, HOME: tmpdir() },
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: error ? error.killed ? -1 : (error.code as number ?? 1) : 0,
        });
      },
    );

    // Safety net – kill after timeout if exec timeout doesn't trigger
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
    }, VALIDATION_TIMEOUT + 500);
  });
}

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `validate_${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Swallow – temp cleanup is best-effort
  }
}

// ---------------------------------------------------------------------------
// Check whether a command is available on PATH
// ---------------------------------------------------------------------------

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const result = await runCommand(`which ${cmd} 2>/dev/null`);
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// Lazy caches so we don't run `which` on every request
const commandCache = new Map<string, boolean>();

async function isAvailable(cmd: string): Promise<boolean> {
  if (commandCache.has(cmd)) return commandCache.get(cmd)!;
  const exists = await commandExists(cmd);
  commandCache.set(cmd, exists);
  return exists;
}

// ---------------------------------------------------------------------------
// Python validation  –  python3 -c "compile(...)"
// ---------------------------------------------------------------------------

async function validatePython(code: string): Promise<Diagnostic[]> {
  if (!(await isAvailable('python3'))) return [];

  // Escape single quotes and backslashes in the code for embedding in a shell string
  const escaped = code
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');

  // Use compile() – no file needed, very fast
  const result = await runCommand(
    `python3 -c 'import sys; compile("""${escaped}""", "<string>", "exec")'`,
  );

  if (result.exitCode === 0) return [];

  return parsePythonErrors(result.stderr);
}

function parsePythonErrors(stderr: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = stderr.split('\n');

  let currentLine = 1;
  let currentMessage = '';
  let currentSeverity: Diagnostic['severity'] = 'error';

  for (const line of lines) {
    // Match:   File "<string>", line N
    const lineMatch = line.match(/File ["']<string>["'],\s*line\s+(\d+)/);
    if (lineMatch) {
      currentLine = parseInt(lineMatch[1], 10);
      continue;
    }

    // Match:   SyntaxError: message   or   IndentationError: message
    const errorMatch = line.match(/^(SyntaxError|IndentationError|NameError|TypeError|ValueError):\s*(.*)/);
    if (errorMatch) {
      currentMessage = errorMatch[2].trim() || errorMatch[1];
      currentSeverity = 'error';
      diagnostics.push({
        message: currentMessage,
        line: currentLine,
        column: 1,
        severity: currentSeverity,
        source: 'python',
      });
      continue;
    }

    // Match:   Warning: message  (less common but handle it)
    const warningMatch = line.match(/^Warning:\s*(.*)/i);
    if (warningMatch) {
      diagnostics.push({
        message: warningMatch[1].trim(),
        line: currentLine,
        column: 1,
        severity: 'warning',
        source: 'python',
      });
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// GCC / G++ validation  –  -fsyntax-only -Wall
// ---------------------------------------------------------------------------

async function validateGcc(code: string, language: 'c' | 'cpp'): Promise<Diagnostic[]> {
  const compiler = language === 'c' ? 'gcc' : 'g++';
  const stdFlag = language === 'c' ? '-std=c17' : '-std=c++17';
  const ext = language === 'c' ? '.c' : '.cpp';
  const source = `source${ext}`;

  if (!(await isAvailable(compiler))) return [];

  const tempDir = await createTempDir();
  try {
    const sourcePath = join(tempDir, source);
    await writeFile(sourcePath, code, 'utf-8');

    const result = await runCommand(
      `${compiler} -fsyntax-only -Wall ${stdFlag} "${sourcePath}" 2>&1`,
      tempDir,
    );

    if (result.exitCode === 0 && result.stderr.trim() === '' && result.stdout.trim() === '') return [];

    // GCC writes diagnostics to stderr, but we merged it into stdout with 2>&1
    const output = result.stderr || result.stdout;
    return parseGccErrors(output, source);
  } catch {
    return [];
  } finally {
    await cleanupTempDir(tempDir);
  }
}

function parseGccErrors(output: string, filename: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split('\n');

  // Escape filename for regex
  const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const line of lines) {
    // GCC format: file.c:line:col: error: message
    //             file.c:line:col: warning: message
    //             file.c:line:col: note: message
    const gccRegex = new RegExp(
      `${escapedFilename}:(\\d+):(\\d+):\\s*(error|warning|note):\\s*(.*)`,
    );
    const match = line.match(gccRegex);
    if (match) {
      const ln = parseInt(match[1], 10);
      const col = parseInt(match[2], 10);
      const severity = match[3] === 'warning' ? 'warning' as const
        : match[3] === 'note' ? 'info' as const
        : 'error' as const;
      const message = match[4].trim();

      diagnostics.push({
        message,
        line: ln,
        column: col,
        severity,
        source: match[3] === 'note' ? 'gcc' : (severity === 'error' ? 'gcc' : 'gcc'),
      });
    }
  }

  // Set source explicitly
  for (const d of diagnostics) {
    d.source = 'gcc';
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// JavaScript validation  –  node --check
// ---------------------------------------------------------------------------

async function validateJavaScript(code: string): Promise<Diagnostic[]> {
  if (!(await isAvailable('node'))) return [];

  // Write to a temp file because `node -e` can have escaping issues
  const tempDir = await createTempDir();
  try {
    const sourcePath = join(tempDir, 'script.js');
    await writeFile(sourcePath, code, 'utf-8');

    // node --check only does syntax checking, doesn't execute
    const result = await runCommand(`node --check "${sourcePath}" 2>&1`, tempDir);

    if (result.exitCode === 0) return [];

    const output = result.stderr || result.stdout;
    return parseNodeErrors(output);
  } catch {
    return [];
  } finally {
    await cleanupTempDir(tempDir);
  }
}

function parseNodeErrors(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Node.js syntax error format:
  //   [filename]:line
  //   ... pointer ...
  //   SyntaxError: Unexpected token ...
  //
  // Or:
  //   SyntaxError: Unexpected token ...
  //       at ...
  //       ...

  let detectedLine = 1;
  let detectedCol = 1;

  const lines = output.split('\n');
  let syntaxErrorMessage = '';

  for (const line of lines) {
    // Match line pointer: "    ^^^^"
    // or match file:line prefix
    const fileLineMatch = line.match(/^(?:\S+):(\d+)(?::(\d+))?/);
    if (fileLineMatch) {
      detectedLine = parseInt(fileLineMatch[1], 10);
      if (fileLineMatch[2]) {
        detectedCol = parseInt(fileLineMatch[2], 10);
      }
    }

    // Match SyntaxError line
    const syntaxMatch = line.match(/^SyntaxError:\s*(.*)/);
    if (syntaxMatch) {
      syntaxErrorMessage = syntaxMatch[1].trim();
    }
  }

  if (syntaxErrorMessage) {
    diagnostics.push({
      message: syntaxErrorMessage,
      line: detectedLine,
      column: detectedCol,
      severity: 'error',
      source: 'node',
    });
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Java validation  –  javac
// ---------------------------------------------------------------------------

async function validateJava(code: string): Promise<Diagnostic[]> {
  if (!(await isAvailable('javac'))) return [];

  const tempDir = await createTempDir();
  try {
    const sourcePath = join(tempDir, 'Main.java');
    await writeFile(sourcePath, code, 'utf-8');

    // javac -Xstdout writes errors to stdout instead of stderr
    // -proc:none skips annotation processing for speed
    const result = await runCommand(
      `javac -Xstdout /dev/null -proc:none "${sourcePath}" 2>&1`,
      tempDir,
    );

    if (result.exitCode === 0) return [];

    // javac writes to stderr by default
    const output = result.stderr || result.stdout;
    return parseJavaErrors(output);
  } catch {
    return [];
  } finally {
    await cleanupTempDir(tempDir);
  }
}

function parseJavaErrors(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Java format: Main.java:line: error: message
    //              Main.java:line: warning: message
    const javaRegex = /^Main\.java:(\d+):\s*(error|warning):\s*(.*)/;
    const match = line.match(javaRegex);
    if (match) {
      const ln = parseInt(match[1], 10);
      const severity = match[2] === 'warning' ? 'warning' as const : 'error' as const;
      const message = match[3].trim();

      diagnostics.push({
        message,
        line: ln,
        column: 1,
        severity,
        source: 'javac',
      });
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body: ValidateRequestBody = await request.json();
    const { code, language } = body;

    // --- Input validation ---
    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { diagnostics: [], error: 'Code is required and must be a string' },
        { status: 400 },
      );
    }

    if (!language || typeof language !== 'string') {
      return NextResponse.json(
        { diagnostics: [], error: 'Language is required and must be a string' },
        { status: 400 },
      );
    }

    if (!ALLOWED_LANGUAGES.includes(language)) {
      return NextResponse.json(
        {
          diagnostics: [],
          error: `Language "${language}" is not supported. Supported: ${ALLOWED_LANGUAGES.join(', ')}`,
        },
        { status: 400 },
      );
    }

    if (Buffer.byteLength(code, 'utf-8') > MAX_CODE_SIZE) {
      return NextResponse.json(
        { diagnostics: [], error: `Code exceeds maximum size of ${MAX_CODE_SIZE / 1024}KB` },
        { status: 400 },
      );
    }

    // --- Run language-specific validation ---
    let diagnostics: Diagnostic[];

    switch (language) {
      case 'python':
        diagnostics = await validatePython(code);
        break;
      case 'c':
        diagnostics = await validateGcc(code, 'c');
        break;
      case 'cpp':
        diagnostics = await validateGcc(code, 'cpp');
        break;
      case 'javascript':
        diagnostics = await validateJavaScript(code);
        break;
      case 'java':
        diagnostics = await validateJava(code);
        break;
      default:
        diagnostics = [];
    }

    return NextResponse.json({ diagnostics });
  } catch (error) {
    // Graceful degradation – never return a 500 for validation failures
    console.error('Validation error:', error);
    return NextResponse.json({ diagnostics: [] });
  }
}
