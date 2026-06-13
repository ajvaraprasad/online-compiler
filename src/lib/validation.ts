// ─── Frontend Validation Service ──────────────────────────────────────────────
// Manages real-time code validation using both client-side quick checks AND
// the backend validation API. Client-side checks provide INSTANT feedback (0ms)
// while backend validation is in-flight (200-500ms).
// ──────────────────────────────────────────────────────────────────────────────

import type { Diagnostic } from '@/store/useIDEStore';

// ─── Re-export Diagnostic type ────────────────────────────────────────────────
export type { Diagnostic };

// ─── Internal DiagnosticError (from CodeEditor.tsx) ──────────────────────────

interface DiagnosticError {
  line: number;
  col: number;
  endCol: number;
  message: string;
  severity: 'error' | 'warning';
}

// ─── Bracket Matching Utilities ───────────────────────────────────────────────

interface BracketInfo {
  char: '(' | '[' | '{' | ')' | ']' | '}';
  line: number;
  col: number; // 0-based column index
}

// Scan code and return all brackets outside strings/comments, with their positions.
// This is a multi-line scanner that properly handles:
// - String literals (single, double, triple for Python, template literals for JS)
// - Comments (line comments, block comments)
// - Escape sequences
function scanBrackets(
  code: string,
  language: string
): BracketInfo[] {
  const brackets: BracketInfo[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    let j = 0;
    let inString: string | null = null;
    let inChar = false;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;
    let tripleQuoteCount = 0; // for Python triple-quoted strings

    for (j = 0; j < line.length; j++) {
      const ch = line[j];
      const nextCh = j + 1 < line.length ? line[j + 1] : '';
      const prevCh = j > 0 ? line[j - 1] : '';

      // Skip if inside a line comment
      if (inLineComment) continue;

      // Handle block comments
      if (inBlockComment) {
        if (ch === '*' && nextCh === '/') {
          inBlockComment = false;
          j++; // skip the '/'
        }
        continue;
      }

      // Handle escape sequences
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && (inString || inChar)) {
        escaped = true;
        continue;
      }

      // Python triple-quote strings
      if (language === 'python' && !inString && !inChar) {
        if ((ch === '"' && nextCh === '"' && line[j + 2] === '"') ||
            (ch === "'" && nextCh === "'" && line[j + 2] === "'")) {
          const quote = ch;
          // Check if we're starting or ending a triple-quoted string
          if (tripleQuoteCount === 0) {
            tripleQuoteCount = 3;
            inString = quote;
            j += 2; // skip the next two quotes
            continue;
          } else if (inString === quote) {
            tripleQuoteCount = 0;
            inString = null;
            j += 2;
            continue;
          }
        }
      }

      // Handle string boundaries
      if (inString) {
        if (tripleQuoteCount > 0) {
          // Inside triple-quoted string — only end with matching triple quote
          // (handled above)
          continue;
        }
        if (ch === inString) {
          inString = null;
        }
        continue;
      }

      if (inChar) {
        if (ch === "'") {
          inChar = false;
        }
        continue;
      }

      // Check for comment starts
      if (ch === '/' && nextCh === '/') {
        inLineComment = true;
        continue;
      }
      if (ch === '/' && nextCh === '*') {
        inBlockComment = true;
        j++; // skip the '*'
        continue;
      }

      // Python comment
      if (language === 'python' && ch === '#') {
        inLineComment = true;
        continue;
      }

      // JavaScript template literals
      if (language === 'javascript' && ch === '`') {
        // Find closing backtick
        let k = j + 1;
        while (k < line.length && line[k] !== '`') {
          if (line[k] === '\\') k++; // skip escaped chars
          k++;
        }
        j = k; // skip past closing backtick (or end of line)
        continue;
      }

      // String starts
      if (ch === '"') { inString = '"'; continue; }
      if (ch === "'" && language !== 'c' && language !== 'cpp' && language !== 'java') {
        inString = "'"; continue;
      }
      if ((language === 'c' || language === 'cpp' || language === 'java') && ch === "'") {
        inChar = true;
        continue;
      }

      // Record brackets
      if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '{' || ch === '}') {
        brackets.push({ char: ch as BracketInfo['char'], line: lineNum, col: j });
      }
    }
  }

  return brackets;
}

/**
 * Match brackets using a stack approach. Returns an array of unmatched bracket positions.
 */
function findUnmatchedBrackets(
  code: string,
  language: string
): DiagnosticError[] {
  const errors: DiagnosticError[] = [];
  const brackets = scanBrackets(code, language);

  const openToClose: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const closeToOpen: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

  // Stack stores opening bracket info
  const stack: Array<{ char: string; line: number; col: number }> = [];

  for (const bracket of brackets) {
    if (openToClose[bracket.char]) {
      // Opening bracket — push onto stack
      stack.push(bracket);
    } else if (closeToOpen[bracket.char]) {
      // Closing bracket — check if it matches the top of stack
      if (stack.length > 0 && stack[stack.length - 1].char === closeToOpen[bracket.char]) {
        stack.pop(); // matched!
      } else {
        // Unmatched closing bracket
        const charName = bracket.char === ')' ? 'parenthesis' :
                         bracket.char === ']' ? 'bracket' : 'brace';
        const expected = stack.length > 0
          ? `Expected '${openToClose[stack[stack.length - 1].char]}' but found '${bracket.char}'`
          : `Unmatched closing ${charName} '${bracket.char}'`;
        errors.push({
          line: bracket.line,
          col: bracket.col + 1, // 1-based
          endCol: bracket.col + 2,
          message: expected,
          severity: 'error',
        });
      }
    }
  }

  // Any remaining opening brackets on the stack are unclosed
  for (const unclosed of stack) {
    const charName = unclosed.char === '(' ? 'parenthesis' :
                     unclosed.char === '[' ? 'bracket' : 'brace';
    const closingChar = openToClose[unclosed.char];
    errors.push({
      line: unclosed.line,
      col: unclosed.col + 1, // 1-based
      endCol: unclosed.col + 2,
      message: `Unclosed ${charName} '${unclosed.char}' — missing '${closingChar}'`,
      severity: 'error',
    });
  }

  return errors;
}

// ─── Language-Specific Validation Functions ───────────────────────────────────

function validatePython(code: string): DiagnosticError[] {
  const errors: DiagnosticError[] = [];
  const lines = code.split('\n');

  // Multi-line bracket matching
  errors.push(...findUnmatchedBrackets(code, 'python'));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for missing colons after statements that require them
    const colonStatements = ['if ', 'elif ', 'else', 'for ', 'while ', 'def ', 'class ', 'try', 'except', 'finally', 'with '];
    for (const stmt of colonStatements) {
      const trimmed = line.trim();
      if (trimmed.startsWith(stmt) && !trimmed.includes('#') && !trimmed.endsWith(':') && !trimmed.endsWith(':\\')) {
        // Make sure it's actually a block statement, not a one-liner or inside a string
        const beforeComment = trimmed.split('#')[0].trimEnd();
        if (beforeComment.startsWith(stmt) && !beforeComment.endsWith(':')) {
          // Skip if it's a one-liner (e.g., "if x: y" is valid)
          if (stmt === 'else' || stmt === 'try' || stmt === 'finally') {
            // Point to the end of the keyword (e.g., after "else")
            const stmtIdx = line.indexOf(stmt.trim());
            const afterStmt = stmtIdx + stmt.trim().length;
            errors.push({
              line: lineNum,
              col: afterStmt + 1, // 1-based column after the keyword
              endCol: afterStmt + 2,
              message: `Expected ':' after '${stmt.trim()}' statement`,
              severity: 'error',
            });
          } else if (!beforeComment.includes(':')) {
            // Point to the end of the condition/expression where ':' is expected
            const colonPos = beforeComment.length;
            // Find the actual column in the original line (account for leading whitespace)
            const leadingWs = line.length - line.trimStart().length;
            const actualCol = leadingWs + colonPos;
            errors.push({
              line: lineNum,
              col: actualCol,
              endCol: actualCol + 1,
              message: `Expected ':' after '${stmt.trim()}' statement`,
              severity: 'error',
            });
          }
        }
      }
    }

    // Check for common Python errors: using = instead of == in conditions
    const ifWhileMatch = line.match(/^\s*(if|while)\s+(.+):/);
    if (ifWhileMatch) {
      const condition = ifWhileMatch[2];
      // Simple check: single = not inside function calls
      if (condition.includes('=') && !condition.includes('==') && !condition.includes('!=') && !condition.includes('<=') && !condition.includes('>=') && !condition.includes('= ') && condition.match(/[^=!<>]=[^=]/)) {
        // Only warn, don't error (could be valid walrus operator :=)
        const eqIndex = condition.indexOf('=');
        errors.push({
          line: lineNum,
          col: (line.indexOf(condition) + eqIndex) + 1,
          endCol: (line.indexOf(condition) + eqIndex) + 2,
          message: 'Possible assignment in condition — did you mean "=="?',
          severity: 'warning',
        });
      }
    }

    // Check for print used without parentheses (Python 3)
    const printMatch = line.match(/^(\s*)print\s+[^(/]/);
    if (printMatch && !line.trim().startsWith('#')) {
      const printIdx = line.indexOf('print');
      // Find the first non-space char after 'print' — that's where '(' should be
      const afterPrint = printIdx + 5; // length of 'print'
      let parenShouldBe = afterPrint;
      while (parenShouldBe < line.length && line[parenShouldBe] === ' ') {
        parenShouldBe++;
      }
      errors.push({
        line: lineNum,
        col: afterPrint + 1, // 1-based column right after 'print'
        endCol: Math.min(parenShouldBe + 1, line.length),
        message: 'Missing parentheses in call to \'print\'. Did you mean print(...)?',
        severity: 'error',
      });
    }
  }

  return errors;
}

function validateC(code: string): DiagnosticError[] {
  const errors: DiagnosticError[] = [];

  // Multi-line bracket matching
  errors.push(...findUnmatchedBrackets(code, 'c'));

  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments and preprocessor directives
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) continue;

    // Check for missing semicolons (basic check)
    if (trimmed.length > 0 &&
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('#') &&
        !trimmed.startsWith('{') &&
        !trimmed.startsWith('}') &&
        !trimmed.endsWith('{') &&
        !trimmed.endsWith('}') &&
        !trimmed.endsWith(';') &&
        !trimmed.endsWith(',') &&
        !trimmed.endsWith(':') &&
        !trimmed.endsWith('\\') &&
        !trimmed.startsWith('if') &&
        !trimmed.startsWith('else') &&
        !trimmed.startsWith('while') &&
        !trimmed.startsWith('for') &&
        !trimmed.startsWith('do') &&
        !trimmed.startsWith('return') &&
        !trimmed.endsWith(')') &&
        trimmed.length > 2) {
      // Check if it looks like a statement that should end with ;
      if (trimmed.match(/^(int|float|double|char|long|short|unsigned|void|auto|static|const|struct|enum|typedef)\b/) ||
          trimmed.match(/\w+\s*=\s*.+/) ||
          trimmed.match(/\w+\+\+/) ||
          trimmed.match(/\w+--/) ||
          trimmed.match(/printf\s*\(/) ||
          trimmed.match(/scanf\s*\(/) ||
          trimmed.match(/return\s+/)) {
        if (!trimmed.match(/\/\//) || trimmed.split('//')[0].trim().length > 0) {
          const stmtPart = trimmed.includes('//') ? trimmed.split('//')[0].trim() : trimmed;
          if (stmtPart.length > 0 && !stmtPart.endsWith(';') && !stmtPart.endsWith('{') && !stmtPart.endsWith('}') && !stmtPart.endsWith(',')) {
            // Point to the exact position where ';' is missing (end of statement)
            const stmtEndInLine = line.indexOf(stmtPart) + stmtPart.length;
            errors.push({
              line: lineNum,
              col: stmtEndInLine,
              endCol: stmtEndInLine + 1,
              message: `Expected ';' at end of statement`,
              severity: 'error',
            });
          }
        }
      }
    }
  }

  // Check for missing main function
  if (!code.includes('main')) {
    errors.push({
      line: 1,
      col: 1,
      endCol: 1,
      message: 'Warning: No main() function found',
      severity: 'warning',
    });
  }

  return errors;
}

function validateCpp(code: string): DiagnosticError[] {
  const errors: DiagnosticError[] = validateC(code);
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Check for cout/cin without proper includes
    if ((trimmed.includes('cout') || trimmed.includes('cin') || trimmed.includes('endl')) &&
        !code.includes('#include <iostream>')) {
      // Find the actual token position for precise error marker
      const tokenMatch = trimmed.match(/(cout|cin|endl)/);
      const tokenInLine = tokenMatch ? line.indexOf(tokenMatch[1]) : 0;
      errors.push({
        line: lineNum,
        col: tokenInLine + 1, // 1-based column of the token
        endCol: tokenInLine + (tokenMatch ? tokenMatch[1].length + 1 : 2),
        message: 'Missing #include <iostream> for cout/cin/endl',
        severity: 'warning',
      });
      break; // Only report once
    }

    // Check for using namespace std without include
    if (trimmed.includes('using namespace std') && !code.includes('#include <iostream>')) {
      const nsIdx = line.indexOf('using namespace std');
      errors.push({
        line: lineNum,
        col: nsIdx + 1,
        endCol: nsIdx + 20, // length of 'using namespace std'
        message: 'using namespace std without including headers',
        severity: 'warning',
      });
    }

    // Check for vector without include
    if (trimmed.includes('vector') && !code.includes('#include <vector>') && !code.includes('#include <bits/stdc++.h>')) {
      const vecIdx = line.indexOf('vector');
      errors.push({
        line: lineNum,
        col: vecIdx + 1,
        endCol: vecIdx + 7, // length of 'vector'
        message: 'Missing #include <vector>',
        severity: 'warning',
      });
      break;
    }

    // Check for string without include
    if (trimmed.includes('std::string') && !code.includes('#include <string>') && !code.includes('#include <bits/stdc++.h>')) {
      const strIdx = line.indexOf('std::string');
      errors.push({
        line: lineNum,
        col: strIdx + 1,
        endCol: strIdx + 12, // length of 'std::string'
        message: 'Missing #include <string>',
        severity: 'warning',
      });
      break;
    }
  }

  return errors;
}

function validateJava(code: string): DiagnosticError[] {
  const errors: DiagnosticError[] = [];

  // Multi-line bracket matching
  errors.push(...findUnmatchedBrackets(code, 'java'));

  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    // Check for missing semicolons
    if (trimmed.length > 0 &&
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('{') &&
        !trimmed.startsWith('}') &&
        !trimmed.endsWith('{') &&
        !trimmed.endsWith('}') &&
        !trimmed.endsWith(';') &&
        !trimmed.endsWith(',') &&
        !trimmed.endsWith(':') &&
        !trimmed.endsWith('\\') &&
        !trimmed.endsWith(')') &&
        !trimmed.startsWith('if') &&
        !trimmed.startsWith('else') &&
        !trimmed.startsWith('while') &&
        !trimmed.startsWith('for') &&
        !trimmed.startsWith('class') &&
        !trimmed.startsWith('interface') &&
        !trimmed.startsWith('enum') &&
        !trimmed.startsWith('@') &&
        trimmed.length > 2) {

      if (trimmed.match(/^(int|float|double|char|long|short|boolean|byte|String|void|static|final|public|private|protected|abstract)\b/) ||
          trimmed.match(/\w+\s*=\s*.+/) ||
          trimmed.match(/return\s+/) ||
          trimmed.match(/System\.(out|in)\./)) {
        const stmtPart = trimmed.includes('//') ? trimmed.split('//')[0].trim() : trimmed;
        if (stmtPart.length > 0 && !stmtPart.endsWith(';') && !stmtPart.endsWith('{') && !stmtPart.endsWith('}') && !stmtPart.endsWith(',')) {
          // Point to the exact position where ';' is missing (end of statement)
          const stmtEndInLine = line.indexOf(stmtPart) + stmtPart.length;
          errors.push({
            line: lineNum,
            col: stmtEndInLine,
            endCol: stmtEndInLine + 1,
            message: `Expected ';' at end of statement`,
            severity: 'error',
          });
        }
      }
    }
  }

  // Check for class declaration
  if (!code.includes('class ')) {
    errors.push({
      line: 1,
      col: 1,
      endCol: 1,
      message: 'Java requires at least one class declaration',
      severity: 'error',
    });
  }

  // Check for missing main method
  if (!code.includes('public static void main') && !code.includes('static void main')) {
    errors.push({
      line: 1,
      col: 1,
      endCol: 1,
      message: 'Warning: No main() method found',
      severity: 'warning',
    });
  }

  return errors;
}

function validateJavaScript(code: string): DiagnosticError[] {
  const errors: DiagnosticError[] = [];

  // Multi-line bracket matching
  errors.push(...findUnmatchedBrackets(code, 'javascript'));

  // Note: Monaco's built-in TypeScript/JS validation will handle most JS errors
  // Our custom validation just adds extra checks for unmatched brackets etc.
  return errors;
}

// ─── Internal validateCode dispatcher ─────────────────────────────────────────

function validateCode(code: string, language: string): DiagnosticError[] {
  switch (language) {
    case 'python': return validatePython(code);
    case 'c': return validateC(code);
    case 'cpp': return validateCpp(code);
    case 'java': return validateJava(code);
    case 'javascript': return validateJavaScript(code);
    default: return [];
  }
}

// ─── DiagnosticError → Diagnostic mapping ────────────────────────────────────

let diagnosticCounter = 0;

function mapDiagnosticError(
  err: DiagnosticError,
  language: string,
  prefix: string = 'client'
): Diagnostic {
  return {
    id: `${prefix}_${language}_${Date.now()}_${++diagnosticCounter}`,
    message: err.message,
    line: err.line,
    column: err.col,
    endLine: err.line,
    endColumn: err.endCol,
    severity: err.severity,
    source: language,
  };
}

// ─── ValidationProvider Interface ─────────────────────────────────────────────

interface ValidationProvider {
  validate(code: string): Promise<Diagnostic[]>;
}

// ─── Backend Validation Provider ──────────────────────────────────────────────

class BackendValidationProvider implements ValidationProvider {
  private language: string;

  constructor(language: string) {
    this.language = language;
  }

  async validate(code: string): Promise<Diagnostic[]> {
    try {
      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language: this.language }),
      });

      if (!response.ok) return [];

      const data = await response.json();
      return (data.diagnostics || []).map((d: Record<string, unknown>, i: number) => ({
        id: `backend_${this.language}_${Date.now()}_${i}`,
        message: String(d.message ?? ''),
        line: Number(d.line ?? 1),
        column: Number(d.column ?? 1),
        endLine: Number(d.endLine ?? d.line ?? 1),
        endColumn: Number(d.endColumn ?? (Number(d.column ?? 1) + 1)),
        severity: (['error', 'warning', 'info'].includes(String(d.severity))
          ? String(d.severity)
          : 'error') as Diagnostic['severity'],
        source: String(d.source ?? this.language),
      }));
    } catch {
      return []; // Graceful degradation
    }
  }
}

// ─── Cascading Error Suppression ──────────────────────────────────────────────

/**
 * Detect and suppress cascading errors — errors that are a direct consequence
 * of a prior error on the same or adjacent line. Modern compilers (like VS Code's
 * built-in diagnostics) suppress these to avoid noise.
 *
 * Heuristic: If two errors are on the same line or within 1 line of each other,
 * and one is a "root cause" type (unterminated string, unclosed bracket, missing
 * quote), the second is likely cascading and should be suppressed.
 *
 * Cascading patterns (these secondary errors are commonly caused by root errors):
 *   - "missing ')'" after "unterminated string"
 *   - "unexpected token" after "unterminated string"
 *   - "expected ';'" after a syntax error on the same line
 *   - "Unclosed parenthesis" after "unterminated string literal"
 */
const ROOT_CAUSE_PATTERNS = [
  /unterminated\s+string/i,
  /unclosed\s+(string|quote)/i,
  /missing\s+['"]quote/i,
  /EOL\s+while\s+scanning\s+string/i,
  /unterminated\s+string\s+literal/i,
  /missing\s+closing\s+quote/i,
];

const CASCADING_PATTERNS = [
  /unclosed\s+(parenthesis|bracket|brace)/i,
  /missing\s+['")\]}/]/i,
  /unexpected\s+(token|end|character)/i,
  /expected\s+['");\]}/]/i,
  /missing\s+['");\]}/]/i,
  /unmatched\s+closing/i,
  /unexpected\s+indent/i,
  /expected\s+['");\]}\s]/i,
];

function isRootCauseError(message: string): boolean {
  return ROOT_CAUSE_PATTERNS.some(p => p.test(message));
}

function isLikelyCascading(message: string): boolean {
  return CASCADING_PATTERNS.some(p => p.test(message));
}

/**
 * Suppress cascading errors from the diagnostic list.
 * Returns a filtered list where obvious cascading errors are removed.
 */
export function suppressCascadingErrors(diagnostics: Diagnostic[]): Diagnostic[] {
  if (diagnostics.length <= 1) return diagnostics;

  // Find root cause errors
  const rootErrors = diagnostics.filter(d =>
    d.severity === 'error' && isRootCauseError(d.message)
  );

  if (rootErrors.length === 0) return diagnostics;

  // Build a set of root error lines (with ±1 tolerance for adjacent cascading)
  const rootLines = new Set<number>();
  for (const root of rootErrors) {
    rootLines.add(root.line);
    rootLines.add(root.line - 1);
    rootLines.add(root.line + 1);
  }

  // Filter: keep diagnostics that are NOT likely cascading on a root line
  return diagnostics.filter(d => {
    if (d.severity !== 'error') return true; // Keep warnings/info always
    if (!isLikelyCascading(d.message)) return true; // Keep non-cascading errors
    if (!rootLines.has(d.line)) return true; // Not near a root error
    // This is likely a cascading error — mark it
    return false;
  });
}

// ─── Merge Logic ──────────────────────────────────────────────────────────────

/**
 * Merge client-side and backend diagnostics intelligently.
 * - Backend diagnostics are the source of truth (more accurate).
 * - Client diagnostics are kept only if they don't overlap with a backend
 *   diagnostic at the same line with the same severity.
 * - Cascading errors are suppressed after merging.
 */
export function mergeDiagnostics(
  clientDiagnostics: Diagnostic[],
  backendDiagnostics: Diagnostic[]
): Diagnostic[] {
  // Build a set of "line:severity" keys from backend diagnostics for dedup
  const backendLines = new Set(
    backendDiagnostics.map(d => `${d.line}:${d.severity}`)
  );

  // Keep client diagnostics that don't overlap with backend at the same line
  const uniqueClientDiagnostics = clientDiagnostics.filter(
    d => !backendLines.has(`${d.line}:${d.severity}`)
  );

  const merged = [...backendDiagnostics, ...uniqueClientDiagnostics];

  // Suppress cascading errors
  return suppressCascadingErrors(merged);
}

// ─── Helper: Client-side Quick Diagnostics (instant, no network) ──────────────

export function getClientSideDiagnostics(
  code: string,
  language: string
): Diagnostic[] {
  const errors = validateCode(code, language);
  return errors.map(err => mapDiagnosticError(err, language, 'client'));
}

// ─── Helper: Backend Diagnostics (network call, more accurate) ────────────────

export async function getBackendDiagnostics(
  code: string,
  language: string
): Promise<Diagnostic[]> {
  const provider = new BackendValidationProvider(language);
  return provider.validate(code);
}

// ─── ValidationManager ────────────────────────────────────────────────────────

class ValidationManager {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs = 400; // 400ms debounce
  private activeAbortController: AbortController | null = null;

  /**
   * Schedule validation with debounce.
   * 1. Immediately provides client-side quick validation results (0ms).
   * 2. After debounce delay, fetches backend validation and merges both sources.
   */
  scheduleValidation(
    code: string,
    language: string,
    callback: (diagnostics: Diagnostic[]) => void
  ): void {
    // Clear previous timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Abort previous in-flight backend request
    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }

    // Immediately provide client-side quick validation results (0ms)
    const quickResults = getClientSideDiagnostics(code, language);
    callback(quickResults);

    // Then schedule backend validation after debounce
    this.debounceTimer = setTimeout(async () => {
      try {
        const backendResults = await getBackendDiagnostics(code, language);

        // Merge: backend results take priority, remove duplicates
        const merged = mergeDiagnostics(quickResults, backendResults);
        callback(merged);
      } catch {
        // If backend fails, just keep the client-side results (already sent)
      }
    }, this.debounceMs);
  }

  /** Cancel any pending validation */
  cancel(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const validationManager = new ValidationManager();
