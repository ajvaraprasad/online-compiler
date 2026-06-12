/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge — Terminal Error Parser
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Parses common error output formats from compilers and runtimes to extract
 * line/column numbers. Used by the Terminal component to make error lines
 * clickable — clicking navigates the Monaco editor to the error location.
 *
 * Supported formats:
 *   - Python:  File "filename.py", line 5  |  line 5
 *   - C/C++:   filename.c:10:5: error:     |  filename.c:10: error:
 *   - Java:    Main.java:5: error:          |  Main.java:5:
 *   - Node.js: at filename.js:5:10          |  SyntaxError ... at line 5
 *   - General: line N  (fallback pattern)
 */

export interface ParsedErrorLocation {
  /** 1-based line number */
  line: number;
  /** 1-based column number (optional) */
  column?: number;
  /** The start index of the match in the original line string */
  matchStart: number;
  /** The end index of the match in the original line string */
  matchEnd: number;
}

/**
 * Parse a terminal output line for error location information.
 *
 * Returns the first matching error pattern found, or null if no pattern matches.
 * The matchStart/matchEnd indicate where in the original string the clickable
 * region should be (used for xterm link provider range calculation).
 */
export function parseTerminalError(line: string): ParsedErrorLocation | null {
  if (!line || line.trim().length === 0) return null;

  // Try each pattern in order of specificity
  // More specific patterns (with filename) are tried first

  // ─── Python: File "filename.py", line 5[, column 3] ──────────────────────
  let match = line.match(/File\s+"[^"]+",\s+line\s+(\d+)(?:,\s+column\s+(\d+))?/);
  if (match && match.index !== undefined) {
    return {
      line: parseInt(match[1], 10),
      column: match[2] ? parseInt(match[2], 10) : undefined,
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
    };
  }

  // ─── C/C++ (GCC/Clang): filename.c:10:5: error: ────────────────────────
  // Matches: file.ext:line:col: or file.ext:line: (with optional trailing text)
  match = line.match(/[\w./\-]+\.[\w]+:(\d+):(\d+):/);
  if (match && match.index !== undefined) {
    return {
      line: parseInt(match[1], 10),
      column: parseInt(match[2], 10),
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
    };
  }

  // ─── C/C++ (GCC/Clang): filename.c:10: error: ──────────────────────────
  // Only line number, no column (e.g., linker error)
  match = line.match(/[\w./\-]+\.[\w]+:(\d+):\s/);
  if (match && match.index !== undefined) {
    return {
      line: parseInt(match[1], 10),
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
    };
  }

  // ─── Java (javac): Main.java:5: error: ──────────────────────────────────
  // Also handles: Main.java:5: warning:
  match = line.match(/([\w./\-]+\.java):(\d+):\s*(?:error|warning)/);
  if (match && match.index !== undefined) {
    return {
      line: parseInt(match[2], 10),
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
    };
  }

  // ─── Node.js stack trace: at filename.js:5:10 ──────────────────────────
  // Matches: at <path>:line:col (typically in stack traces)
  match = line.match(/at\s+[\w./\-<>]+:(\d+):(\d+)/);
  if (match && match.index !== undefined) {
    return {
      line: parseInt(match[1], 10),
      column: parseInt(match[2], 10),
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
    };
  }

  // ─── Node.js: SyntaxError: ... at line 5 ────────────────────────────────
  match = line.match(/at\s+line\s+(\d+)/);
  if (match && match.index !== undefined) {
    return {
      line: parseInt(match[1], 10),
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
    };
  }

  // ─── General fallback: line N (where N is a number) ─────────────────────
  // Only match "line N" when it looks like it's part of an error message
  // (preceded by common error context words or starts the line)
  match = line.match(/(?:on|at|near|around)\s+line\s+(\d+)/i);
  if (match && match.index !== undefined) {
    return {
      line: parseInt(match[1], 10),
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
    };
  }

  return null;
}

/**
 * Check if a line contains typical error indicators that make it worth
 * checking for error patterns. This is a quick pre-filter to avoid running
 * the full regex set on every line.
 */
export function isPotentialErrorLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.includes('error') ||
    lower.includes('warning') ||
    lower.includes('traceback') ||
    lower.includes('exception') ||
    lower.includes('line ') ||
    lower.includes(':') // C/Java error formats contain colons
  );
}
