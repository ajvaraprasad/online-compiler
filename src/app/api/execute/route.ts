import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { exec } from 'child_process';
import { writeFile, unlink, mkdir, rmdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const ALLOWED_LANGUAGES = ['python', 'c', 'cpp', 'java', 'javascript'];
const EXECUTION_TIMEOUT = 10000; // 10 seconds
const MAX_MEMORY = 50 * 1024 * 1024; // 50MB

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
}

function executeCommand(
  command: string,
  cwd?: string,
  stdin?: string
): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const child = exec(
      command,
      {
        cwd,
        timeout: EXECUTION_TIMEOUT,
        maxBuffer: 1024 * 1024, // 1MB output buffer
        env: { ...process.env, HOME: tmpdir() },
      },
      (error, stdout, stderr) => {
        const executionTime = Date.now() - startTime;
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: error ? error.code || 1 : 0,
          executionTime,
        });
      }
    );

    if (stdin && child.stdin) {
      // Ensure stdin ends with a newline for proper input() reading
      const stdinData = stdin.endsWith('\n') ? stdin : stdin + '\n';
      child.stdin.write(stdinData);
      child.stdin.end();
    }
  });
}

async function executePython(code: string, stdin?: string): Promise<ExecutionResult> {
  const tempDir = join(tmpdir(), `code-${randomUUID()}`);
  const tempFile = join(tempDir, 'script.py');

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(tempFile, code, 'utf-8');
    const result = await executeCommand(`python3 -u "${tempFile}"`, tempDir, stdin);
    return result;
  } finally {
    try {
      await unlink(tempFile).catch(() => {});
      await rmdir(tempDir).catch(() => {});
    } catch {}
  }
}

async function executeC(code: string, stdin?: string): Promise<ExecutionResult> {
  const tempDir = join(tmpdir(), `code-${randomUUID()}`);
  const sourceFile = join(tempDir, 'program.c');
  const binaryFile = join(tempDir, 'program');

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(sourceFile, code, 'utf-8');

    // Compile
    const compileResult = await executeCommand(
      `gcc -o "${binaryFile}" "${sourceFile}" -lm`,
      tempDir
    );

    if (compileResult.exitCode !== 0) {
      return {
        stdout: '',
        stderr: compileResult.stderr,
        exitCode: compileResult.exitCode,
        executionTime: compileResult.executionTime,
      };
    }

    // Run
    const result = await executeCommand(`"${binaryFile}"`, tempDir, stdin);
    return result;
  } finally {
    try {
      await unlink(sourceFile).catch(() => {});
      await unlink(binaryFile).catch(() => {});
      await rmdir(tempDir).catch(() => {});
    } catch {}
  }
}

async function executeCpp(code: string, stdin?: string): Promise<ExecutionResult> {
  const tempDir = join(tmpdir(), `code-${randomUUID()}`);
  const sourceFile = join(tempDir, 'program.cpp');
  const binaryFile = join(tempDir, 'program');

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(sourceFile, code, 'utf-8');

    // Compile
    const compileResult = await executeCommand(
      `g++ -o "${binaryFile}" "${sourceFile}" -lm`,
      tempDir
    );

    if (compileResult.exitCode !== 0) {
      return {
        stdout: '',
        stderr: compileResult.stderr,
        exitCode: compileResult.exitCode,
        executionTime: compileResult.executionTime,
      };
    }

    // Run
    const result = await executeCommand(`"${binaryFile}"`, tempDir, stdin);
    return result;
  } finally {
    try {
      await unlink(sourceFile).catch(() => {});
      await unlink(binaryFile).catch(() => {});
      await rmdir(tempDir).catch(() => {});
    } catch {}
  }
}

async function executeJava(code: string, stdin?: string): Promise<ExecutionResult> {
  const tempDir = join(tmpdir(), `code-${randomUUID()}`);
  const sourceFile = join(tempDir, 'Main.java');

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(sourceFile, code, 'utf-8');

    // Compile
    const compileResult = await executeCommand(
      `javac "${sourceFile}"`,
      tempDir
    );

    if (compileResult.exitCode !== 0) {
      return {
        stdout: '',
        stderr: compileResult.stderr,
        exitCode: compileResult.exitCode,
        executionTime: compileResult.executionTime,
      };
    }

    // Run
    const result = await executeCommand(`java -cp "${tempDir}" Main`, tempDir, stdin);
    return result;
  } finally {
    try {
      await unlink(sourceFile).catch(() => {});
      await unlink(join(tempDir, 'Main.class')).catch(() => {});
      await rmdir(tempDir).catch(() => {});
    } catch {}
  }
}

async function executeJavaScript(code: string, stdin?: string): Promise<ExecutionResult> {
  const tempDir = join(tmpdir(), `code-${randomUUID()}`);
  const tempFile = join(tempDir, 'script.js');

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(tempFile, code, 'utf-8');
    const result = await executeCommand(`node "${tempFile}"`, tempDir, stdin);
    return result;
  } finally {
    try {
      await unlink(tempFile).catch(() => {});
      await rmdir(tempDir).catch(() => {});
    } catch {}
  }
}

export async function POST(request: NextRequest) {
  try {
    // Auth is optional - allow guest execution
    const authUser = getUserFromRequest(request);

    const body = await request.json();
    const { code, language, stdin } = body;

    if (!code || !language) {
      return NextResponse.json(
        { error: 'Code and language are required' },
        { status: 400 }
      );
    }

    if (!ALLOWED_LANGUAGES.includes(language)) {
      return NextResponse.json(
        { error: `Language "${language}" is not supported. Supported languages: ${ALLOWED_LANGUAGES.join(', ')}` },
        { status: 400 }
      );
    }

    let result: ExecutionResult;

    switch (language) {
      case 'python':
        result = await executePython(code, stdin);
        break;
      case 'c':
        result = await executeC(code, stdin);
        break;
      case 'cpp':
        result = await executeCpp(code, stdin);
        break;
      case 'java':
        result = await executeJava(code, stdin);
        break;
      case 'javascript':
        result = await executeJavaScript(code, stdin);
        break;
      default:
        return NextResponse.json(
          { error: 'Unsupported language' },
          { status: 400 }
        );
    }

    // Truncate output if too large
    const maxOutputLength = 10000;
    if (result.stdout.length > maxOutputLength) {
      result.stdout = result.stdout.substring(0, maxOutputLength) + '\n... (output truncated)';
    }
    if (result.stderr.length > maxOutputLength) {
      result.stderr = result.stderr.substring(0, maxOutputLength) + '\n... (output truncated)';
    }

    return NextResponse.json({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      executionTime: result.executionTime,
    });
  } catch (error) {
    console.error('Execute error:', error);
    return NextResponse.json(
      { error: 'Internal server error during code execution' },
      { status: 500 }
    );
  }
}
