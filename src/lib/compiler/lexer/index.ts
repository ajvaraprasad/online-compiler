/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge Compiler — Character-by-Character Lexical Analyzer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * True character-by-character scanning using a finite automaton approach.
 * No regex-based token matching — every token is recognized by advancing
 * through the source code one character at a time.
 *
 * Supported languages: Python, C, C++, Java, JavaScript
 * Architecture: BaseLexer → PythonLexer | CStyleLexer (factory pattern)
 */

import {
  Token,
  TokenType,
  LexResult,
  LexStats,
  CompilerError,
  CompilerPhase,
  SupportedLanguage,
  normalizeLanguage,
} from '../types';

// ─── Lexer Interface ───────────────────────────────────────────────────────

export interface Lexer {
  tokenize(): LexResult;
}

// ─── Keyword Maps ──────────────────────────────────────────────────────────

const PYTHON_KEYWORDS: Set<string> = new Set([
  'def', 'class', 'if', 'elif', 'else', 'for', 'while', 'return',
  'import', 'from', 'try', 'except', 'finally', 'with', 'as',
  'and', 'or', 'not', 'in', 'is', 'True', 'False', 'None',
  'pass', 'break', 'continue', 'yield', 'lambda', 'global',
  'nonlocal', 'async', 'await', 'raise', 'del',
]);

const C_KEYWORDS: Set<string> = new Set([
  'int', 'char', 'float', 'double', 'void', 'if', 'else', 'for',
  'while', 'do', 'return', 'break', 'continue', 'switch', 'case',
  'default', 'struct', 'typedef', 'sizeof', 'static', 'extern',
  'const', 'goto', 'enum', 'union', 'signed', 'unsigned', 'long',
  'short', 'auto', 'register', 'volatile', 'inline',
]);

const CPP_KEYWORDS: Set<string> = new Set(
  Array.from(C_KEYWORDS).concat([
    'class', 'public', 'private', 'protected', 'virtual', 'new',
    'delete', 'try', 'catch', 'throw', 'namespace', 'using',
    'template', 'typename', 'bool', 'override', 'final', 'nullptr',
    'constexpr',
  ])
);

const JAVA_KEYWORDS: Set<string> = new Set([
  'class', 'interface', 'extends', 'implements', 'public', 'private',
  'protected', 'static', 'final', 'void', 'int', 'long', 'double',
  'float', 'char', 'boolean', 'new', 'try', 'catch', 'throw',
  'import', 'package', 'this', 'super', 'abstract', 'synchronized',
  'native', 'instanceof', 'null', 'true', 'false', 'if', 'else',
  'for', 'while', 'do', 'return', 'break', 'continue', 'switch',
  'case', 'default', 'const', 'goto', 'enum', 'assert', 'transient',
  'volatile', 'strictfp',
]);

const JS_KEYWORDS: Set<string> = new Set([
  'function', 'var', 'let', 'const', 'if', 'else', 'for', 'while',
  'do', 'return', 'break', 'continue', 'switch', 'case', 'default',
  'new', 'delete', 'try', 'catch', 'throw', 'class', 'extends',
  'import', 'export', 'async', 'await', 'yield', 'typeof',
  'instanceof', 'void', 'this', 'super', 'of', 'in', 'null',
  'true', 'false', 'undefined', 'from', 'as', 'debugger', 'with',
  'static', 'get', 'set',
]);

const PYTHON_BOOLEANS: Set<string> = new Set(['True', 'False']);
const PYTHON_NONE: Set<string> = new Set(['None']);
const JAVA_BOOLEANS: Set<string> = new Set(['true', 'false']);
const JAVA_NULL: Set<string> = new Set(['null']);
const JS_BOOLEANS: Set<string> = new Set(['true', 'false']);
const JS_NULL: Set<string> = new Set(['null', 'undefined']);

// ─── Operator Tables (sorted longest first for greedy matching) ────────────

const PYTHON_OPERATORS: string[] = [
  '**=', '//=', '<<=', '>>=',
  '**', '//', '<<', '>>', '==', '!=', '<=', '>=',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '->',
  '+', '-', '*', '/', '%', '=', '<', '>', '&', '|', '^', '~', '@',
];

const C_STYLE_OPERATORS: string[] = [
  '...', '<<=', '>>=', '=>', '==', '!=', '<=', '>=', '&&', '||',
  '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '<<', '>>', '->', '::', '?.', '??',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~', '?',
  ':',
];

// ─── Delimiter Map ─────────────────────────────────────────────────────────

const DELIMITERS: Record<string, TokenType> = {
  '(': TokenType.LeftParen,
  ')': TokenType.RightParen,
  '[': TokenType.LeftBracket,
  ']': TokenType.RightBracket,
  '{': TokenType.LeftBrace,
  '}': TokenType.RightBrace,
  ',': TokenType.Comma,
  ';': TokenType.Semicolon,
  ':': TokenType.Colon,
  '.': TokenType.Dot,
};

const PYTHON_DELIMITERS: Record<string, TokenType> = {
  ...DELIMITERS,
  '@': TokenType.Decorator,
};

// ─── Escape Sequence Handler ───────────────────────────────────────────────

function scanEscapeSequence(
  source: string,
  pos: number,
): { value: string; newPos: number } {
  if (pos >= source.length) {
    return { value: '\\', newPos: pos };
  }

  const ch = source[pos];
  const simpleEscapes: Record<string, string> = {
    'n': '\n',
    't': '\t',
    'r': '\r',
    '\\': '\\',
    "'": "'",
    '"': '"',
    '0': '\0',
    'a': '\a',
    'b': '\b',
    'f': '\f',
    'v': '\v',
  };

  if (simpleEscapes[ch] !== undefined) {
    return { value: simpleEscapes[ch], newPos: pos + 1 };
  }

  // \xHH - hex escape
  if (ch === 'x') {
    let hex = '';
    let i = pos + 1;
    while (i < source.length && i < pos + 3 && isHexDigit(source[i])) {
      hex += source[i];
      i++;
    }
    if (hex.length >= 1) {
      const code = parseInt(hex, 16);
      return { value: String.fromCharCode(code), newPos: i };
    }
    return { value: '\\x', newPos: pos + 1 };
  }

  // \uHHHH - unicode escape
  if (ch === 'u') {
    let hex = '';
    let i = pos + 1;
    // Handle \u{HHHHH} for ES6
    if (i < source.length && source[i] === '{') {
      i++;
      while (i < source.length && source[i] !== '}') {
        hex += source[i];
        i++;
      }
      if (i < source.length && source[i] === '}') {
        i++;
        const code = parseInt(hex, 16);
        if (!isNaN(code)) {
          return { value: String.fromCodePoint(code), newPos: i };
        }
      }
      return { value: '\\u', newPos: pos + 1 };
    }
    while (i < source.length && i < pos + 5 && isHexDigit(source[i])) {
      hex += source[i];
      i++;
    }
    if (hex.length === 4) {
      const code = parseInt(hex, 16);
      return { value: String.fromCharCode(code), newPos: i };
    }
    return { value: '\\u', newPos: pos + 1 };
  }

  // \UHHHHHHHH - extended unicode (Python)
  if (ch === 'U') {
    let hex = '';
    let i = pos + 1;
    while (i < source.length && i < pos + 9 && isHexDigit(source[i])) {
      hex += source[i];
      i++;
    }
    if (hex.length === 8) {
      const code = parseInt(hex, 16);
      if (!isNaN(code)) {
        return { value: String.fromCodePoint(code), newPos: i };
      }
    }
    return { value: '\\U', newPos: pos + 1 };
  }

  // Octal escape \NNN (C-style)
  if (isOctalDigit(ch)) {
    let octal = '';
    let i = pos;
    while (i < source.length && i < pos + 3 && isOctalDigit(source[i])) {
      octal += source[i];
      i++;
    }
    const code = parseInt(octal, 8);
    if (!isNaN(code) && code <= 0o377) {
      return { value: String.fromCharCode(code), newPos: i };
    }
  }

  // Unknown escape — return as-is
  return { value: ch, newPos: pos + 1 };
}

// ─── Helper Predicates ─────────────────────────────────────────────────────

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isHexDigit(ch: string): boolean {
  return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function isOctalDigit(ch: string): boolean {
  return ch >= '0' && ch <= '7';
}

function isBinaryDigit(ch: string): boolean {
  return ch === '0' || ch === '1';
}

function isIdentifierStart(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    ch === '_' ||
    ch === '$'
  );
}

function isIdentifierPart(ch: string): boolean {
  return isIdentifierStart(ch) || isDigit(ch);
}

// ─── Base Lexer Class ──────────────────────────────────────────────────────

abstract class BaseLexer implements Lexer {
  protected source: string;
  protected pos: number;
  protected line: number;
  protected col: number;
  protected tokens: Token[];
  protected errors: CompilerError[];
  protected tokenStartLine: number;
  protected tokenStartCol: number;
  /** The language this lexer targets */
  protected language: SupportedLanguage;

  constructor(source: string, language: SupportedLanguage) {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
    this.errors = [];
    this.tokenStartLine = 1;
    this.tokenStartCol = 1;
    this.language = language;
  }

  // ── Character Navigation ──────────────────────────────────────────────

  /** Return current character without consuming, or null at EOF */
  protected peek(): string | null {
    if (this.pos >= this.source.length) return null;
    return this.source[this.pos];
  }

  /** Look ahead n characters without consuming */
  protected peekAhead(n: number): string | null {
    const idx = this.pos + n;
    if (idx >= this.source.length) return null;
    return this.source[idx];
  }

  /** Consume and return current character, advancing position, line, col */
  protected advance(): string | null {
    if (this.pos >= this.source.length) return null;
    const ch = this.source[this.pos];
    this.pos++;
    if (ch === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  }

  /** Check if we've reached the end of input */
  protected isAtEnd(): boolean {
    return this.pos >= this.source.length;
  }

  // ── Position Tracking ─────────────────────────────────────────────────

  /** Mark the start of a new token */
  protected startToken(): void {
    this.tokenStartLine = this.line;
    this.tokenStartCol = this.col;
  }

  // ── Token Creation ────────────────────────────────────────────────────

  /** Create a token at the marked start position */
  protected makeToken(type: TokenType, value: string): Token {
    return {
      type,
      value,
      line: this.tokenStartLine,
      col: this.tokenStartCol,
    };
  }

  /** Add token directly to the list */
  protected emitToken(type: TokenType, value: string): void {
    this.tokens.push(this.makeToken(type, value));
  }

  // ── Error Handling ────────────────────────────────────────────────────

  protected addError(message: string, severity: 'error' | 'warning' = 'error'): void {
    this.errors.push({
      phase: CompilerPhase.LexicalAnalysis,
      message,
      line: this.line,
      col: this.col,
      severity,
    });
  }

  // ── Whitespace / Comment Skipping ─────────────────────────────────────

  /** Skip spaces and tabs (NOT newlines — Python overrides this) */
  protected skipWhitespace(): void {
    while (!this.isAtEnd()) {
      const ch = this.peek()!;
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance();
      } else if (ch === '\n') {
        this.advance();
        // C-style: newlines are just whitespace, Python overrides
        if (this.language !== 'python') {
          // continue skipping
        } else {
          return; // Python: stop at newline for indent handling
        }
      } else {
        break;
      }
    }
  }

  /** Skip a line comment starting at current position */
  protected skipLineComment(): string {
    const value: string[] = [];
    while (!this.isAtEnd()) {
      const ch = this.peek()!;
      if (ch === '\n') break;
      value.push(ch);
      this.advance();
    }
    return value.join('');
  }

  /** Skip a block comment starting at current position (after /*). Returns the comment text. */
  protected skipBlockComment(): string {
    const value: string[] = [];
    let depth = 1;
    // We're positioned just after /*
    while (!this.isAtEnd() && depth > 0) {
      const ch = this.peek()!;
      if (ch === '*' && this.peekAhead(1) === '/') {
        if (depth === 1) {
          this.advance(); // *
          this.advance(); // /
          depth = 0;
          break;
        }
        depth--;
        value.push('*');
        this.advance(); // past '*'
        this.advance(); // past '/'
      } else if (ch === '/' && this.peekAhead(1) === '*') {
        depth++;
        value.push('/');
        this.advance(); // past '/'
        this.advance(); // past '*'
      } else {
        value.push(ch);
        this.advance();
      }
    }
    if (depth > 0) {
      this.addError('Unterminated block comment');
    }
    return value.join('');
  }

  // ── Number Scanning ───────────────────────────────────────────────────

  protected scanNumber(): Token {
    this.startToken();

    // Check for hex, binary, octal prefixes
    if (this.peek() === '0') {
      const next = this.peekAhead(1);
      if (next === 'x' || next === 'X') {
        return this.scanHexNumber();
      }
      if (next === 'b' || next === 'B') {
        return this.scanBinaryNumber();
      }
      if (next === 'o' || next === 'O') {
        return this.scanOctalNumber();
      }
      // C-style: leading 0 could be old-style octal
      if (this.language !== 'python' && next !== null && isOctalDigit(next)) {
        return this.scanOctalNumberLegacy();
      }
    }

    const start = this.pos;
    let hasDot = false;
    let hasExponent = false;

    // Scan integer part
    while (!this.isAtEnd() && isDigit(this.peek()!)) {
      this.advance();
    }

    // Floating point: decimal part
    if (
      !this.isAtEnd() &&
      this.peek() === '.' &&
      // Ensure the dot isn't followed by another dot (like .. or ...) 
      // or a digit that starts a new number (method call)
      this.peekAhead(1) !== null &&
      (isDigit(this.peekAhead(1)!) || !isIdentifierStart(this.peekAhead(1)!))
    ) {
      // Check it's not .. or ...
      const ahead1 = this.peekAhead(1);
      if (ahead1 === '.') {
        // This is likely a .. or ... operator, don't consume the dot
      } else {
        hasDot = true;
        this.advance(); // consume '.'
        while (!this.isAtEnd() && isDigit(this.peek()!)) {
          this.advance();
        }
      }
    }

    // Scientific notation
    if (!this.isAtEnd() && (this.peek() === 'e' || this.peek() === 'E')) {
      hasExponent = true;
      this.advance(); // consume e/E
      if (!this.isAtEnd() && (this.peek() === '+' || this.peek() === '-')) {
        this.advance();
      }
      while (!this.isAtEnd() && isDigit(this.peek()!)) {
        this.advance();
      }
    }

    // Numeric suffixes for C/C++/Java (L, LL, U, UL, ULL, F, f, etc.)
    if (this.language === 'c' || this.language === 'cpp' || this.language === 'java') {
      if (!this.isAtEnd() && this.peek() !== null) {
        const ch = this.peek()!;
        if (ch === 'L' || ch === 'l') {
          this.advance();
          if (!this.isAtEnd() && (this.peek() === 'L' || this.peek() === 'l')) {
            this.advance();
          }
          if (!this.isAtEnd() && (this.peek() === 'U' || this.peek() === 'u')) {
            this.advance();
          }
        } else if (ch === 'U' || ch === 'u') {
          this.advance();
          if (!this.isAtEnd() && (this.peek() === 'L' || this.peek() === 'l')) {
            this.advance();
            if (!this.isAtEnd() && (this.peek() === 'L' || this.peek() === 'l')) {
              this.advance();
            }
          }
        } else if (ch === 'F' || ch === 'f') {
          this.advance();
        }
      }
    }

    // BigInt suffix for JavaScript
    if (this.language === 'javascript' && !this.isAtEnd() && this.peek() === 'n') {
      // Only if no dot or exponent (bigint can't be float)
      if (!hasDot && !hasExponent) {
        this.advance(); // consume 'n'
      }
    }

    const value = this.source.substring(start, this.pos);
    return this.makeToken(TokenType.Number, value);
  }

  private scanHexNumber(): Token {
    const start = this.pos;
    this.advance(); // '0'
    this.advance(); // 'x' or 'X'

    if (this.isAtEnd() || !isHexDigit(this.peek()!)) {
      this.addError('Invalid hex literal: expected hex digits after 0x');
    }

    while (!this.isAtEnd() && isHexDigit(this.peek()!)) {
      this.advance();
    }

    // C/C++/Java suffixes
    if (this.language === 'c' || this.language === 'cpp' || this.language === 'java') {
      if (!this.isAtEnd() && this.peek() !== null) {
        const ch = this.peek()!;
        if (ch === 'L' || ch === 'l' || ch === 'U' || ch === 'u') {
          this.advance();
          if (!this.isAtEnd()) {
            const ch2 = this.peek()!;
            if (ch2 === 'L' || ch2 === 'l' || ch2 === 'U' || ch2 === 'u') {
              this.advance();
            }
          }
        }
      }
    }

    const value = this.source.substring(start, this.pos);
    return this.makeToken(TokenType.Number, value);
  }

  private scanBinaryNumber(): Token {
    const start = this.pos;
    this.advance(); // '0'
    this.advance(); // 'b' or 'B'

    if (this.isAtEnd() || !isBinaryDigit(this.peek()!)) {
      this.addError('Invalid binary literal: expected binary digits after 0b');
    }

    while (!this.isAtEnd() && isBinaryDigit(this.peek()!)) {
      this.advance();
    }

    const value = this.source.substring(start, this.pos);
    return this.makeToken(TokenType.Number, value);
  }

  private scanOctalNumber(): Token {
    const start = this.pos;
    this.advance(); // '0'
    this.advance(); // 'o' or 'O'

    if (this.isAtEnd() || !isOctalDigit(this.peek()!)) {
      this.addError('Invalid octal literal: expected octal digits after 0o');
    }

    while (!this.isAtEnd() && isOctalDigit(this.peek()!)) {
      this.advance();
    }

    const value = this.source.substring(start, this.pos);
    return this.makeToken(TokenType.Number, value);
  }

  /** Legacy C-style octal: 0777 */
  private scanOctalNumberLegacy(): Token {
    const start = this.pos;
    this.advance(); // leading '0'

    while (!this.isAtEnd() && isOctalDigit(this.peek()!)) {
      this.advance();
    }

    // If digits after 0 aren't octal, it's just 0 followed by a decimal
    if (!this.isAtEnd() && isDigit(this.peek()!) && !isOctalDigit(this.peek()!)) {
      while (!this.isAtEnd() && isDigit(this.peek()!)) {
        this.advance();
      }
    }

    const value = this.source.substring(start, this.pos);
    return this.makeToken(TokenType.Number, value);
  }

  // ── String Scanning ───────────────────────────────────────────────────

  /** Scan a single-line string (double or single quoted). 
   *  Position should be at the opening quote. */
  protected scanString(quote: string): Token {
    this.startToken();
    const start = this.pos;
    this.advance(); // consume opening quote

    const chars: string[] = [quote];

    while (!this.isAtEnd()) {
      const ch = this.peek()!;

      if (ch === '\\') {
        chars.push(ch);
        this.advance(); // consume backslash
        if (this.isAtEnd()) {
          this.addError('Unterminated escape sequence in string');
          break;
        }
        // Scan the escape
        const escStart = this.pos;
        const nextCh = this.peek()!;
        if (nextCh === '\n') {
          // Line continuation (Python, C)
          this.advance();
          chars.push('\n');
        } else {
          const escResult = scanEscapeSequence(this.source, this.pos);
          // Advance past the escape sequence
          for (let i = escStart; i < escResult.newPos; i++) {
            this.advance();
          }
          chars.push(this.source.substring(escStart, escResult.newPos));
        }
      } else if (ch === quote) {
        chars.push(ch);
        this.advance(); // consume closing quote
        break;
      } else if (ch === '\n') {
        // Unterminated string (single-line strings can't span lines)
        this.addError('Unterminated string literal');
        break;
      } else {
        chars.push(ch);
        this.advance();
      }
    }

    if (this.isAtEnd() && chars[chars.length - 1] !== quote) {
      this.addError('Unterminated string literal');
    }

    const value = this.source.substring(start, this.pos);
    return this.makeToken(TokenType.String, value);
  }

  // ── Identifier / Keyword Scanning ─────────────────────────────────────

  protected scanIdentifier(): Token {
    this.startToken();
    const start = this.pos;

    while (!this.isAtEnd() && isIdentifierPart(this.peek()!)) {
      this.advance();
    }

    const value = this.source.substring(start, this.pos);
    const tokenType = this.resolveIdentifierType(value);
    return this.makeToken(tokenType, value);
  }

  /** Determine if an identifier is a keyword, boolean, null, etc. */
  protected abstract resolveIdentifierType(value: string): TokenType;

  // ── Abstract ──────────────────────────────────────────────────────────

  abstract tokenize(): LexResult;

  // ── Bracket Matching ──────────────────────────────────────────────────

  protected checkBracketMatching(): void {
    const bracketStack: { char: string; line: number; col: number }[] = [];
    const pairs: Record<string, string> = {
      ')': '(',
      ']': '[',
      '}': '{',
    };
    const openers = new Set(['(', '[', '{']);

    for (const token of this.tokens) {
      if (token.type === TokenType.LeftParen ||
          token.type === TokenType.LeftBracket ||
          token.type === TokenType.LeftBrace) {
        bracketStack.push({ char: token.value, line: token.line, col: token.col });
      } else if (
        token.type === TokenType.RightParen ||
        token.type === TokenType.RightBracket ||
        token.type === TokenType.RightBrace
      ) {
        const expected = pairs[token.value];
        if (bracketStack.length === 0) {
          this.errors.push({
            phase: CompilerPhase.LexicalAnalysis,
            message: `Unexpected closing bracket '${token.value}'`,
            line: token.line,
            col: token.col,
            severity: 'error',
          });
        } else {
          const top = bracketStack.pop()!;
          if (top.char !== expected) {
            this.errors.push({
              phase: CompilerPhase.LexicalAnalysis,
              message: `Mismatched bracket: expected '${this.closingFor(top.char)}' to match '${top.char}' at line ${top.line}, col ${top.col}, but got '${token.value}'`,
              line: token.line,
              col: token.col,
              severity: 'error',
            });
          }
        }
      }
    }

    for (const unmatched of bracketStack) {
      this.errors.push({
        phase: CompilerPhase.LexicalAnalysis,
        message: `Unclosed bracket '${unmatched.char}'`,
        line: unmatched.line,
        col: unmatched.col,
        severity: 'error',
      });
    }
  }

  private closingFor(open: string): string {
    if (open === '(') return ')';
    if (open === '[') return ']';
    if (open === '{') return '}';
    return open;
  }

  // ── Stats Computation ─────────────────────────────────────────────────

  protected computeStats(): LexStats {
    let keywords = 0;
    let identifiers = 0;
    let literals = 0;
    let operators = 0;
    let commentTokens = 0;
    let maxLine = 0;

    for (const token of this.tokens) {
      if (token.line > maxLine) maxLine = token.line;

      switch (token.type) {
        case TokenType.Keyword:
          keywords++;
          break;
        case TokenType.Identifier:
          identifiers++;
          break;
        case TokenType.Number:
        case TokenType.String:
        case TokenType.Boolean:
        case TokenType.None:
          literals++;
          break;
        case TokenType.Operator:
        case TokenType.Assignment:
        case TokenType.Arrow:
        case TokenType.FatArrow:
        case TokenType.Ellipsis:
          operators++;
          break;
        case TokenType.Comment:
          commentTokens++;
          break;
      }
    }

    const totalTokens = this.tokens.length;
    const linesOfCode = maxLine;
    const commentRatio = totalTokens > 0 ? commentTokens / totalTokens : 0;

    return {
      totalTokens,
      keywords,
      identifiers,
      literals,
      operators,
      linesOfCode,
      commentRatio,
    };
  }
}

// ─── Python Lexer ──────────────────────────────────────────────────────────

class PythonLexer extends BaseLexer {
  private indentStack: number[];
  private atLineStart: boolean;
  private pendingTokens: Token[];
  /** Track whether we use tabs or spaces for indentation mixing detection */
  private indentChar: 'tab' | 'space' | null;
  /** Parenthesis/bracket/brace nesting depth — suppresses indentation when > 0 */
  private bracketDepth: number;

  constructor(source: string) {
    super(source, 'python');
    this.indentStack = [0];
    this.atLineStart = true;
    this.pendingTokens = [];
    this.indentChar = null;
    this.bracketDepth = 0;
  }

  tokenize(): LexResult {
    // Emit initial NEWLINE? No — Python expects INDENT/DEDENT only at line starts.
    // First line starts at indent level 0.

    while (!this.isAtEnd() || this.pendingTokens.length > 0) {
      if (this.pendingTokens.length > 0) {
        const tok = this.pendingTokens.shift()!;
        this.tokens.push(tok);
        continue;
      }

      // At line start, handle indentation
      if (this.atLineStart) {
        this.handleIndentation();
        if (this.isAtEnd()) break;
        this.atLineStart = false;
        // CRITICAL: After handleIndentation(), pendingTokens may contain
        // INDENT/DEDENT tokens that must be emitted BEFORE the next
        // regular token. Continue the loop to drain pendingTokens first.
        if (this.pendingTokens.length > 0) continue;
      }

      this.skipSpacesAndTabs();

      if (this.isAtEnd()) break;

      const ch = this.peek()!;

      // Newline
      if (ch === '\n') {
        if (this.bracketDepth === 0) {
          this.startToken();
          this.advance();
          this.emitToken(TokenType.Newline, '\n');
        } else {
          this.advance();
        }
        this.atLineStart = true;
        continue;
      }

      // Carriage return
      if (ch === '\r') {
        this.advance();
        if (!this.isAtEnd() && this.peek() === '\n') {
          this.advance();
        }
        if (this.bracketDepth === 0) {
          this.startToken();
          this.emitToken(TokenType.Newline, '\n');
        }
        this.atLineStart = true;
        continue;
      }

      // Comment
      if (ch === '#') {
        this.startToken();
        const commentText = this.skipLineComment();
        this.emitToken(TokenType.Comment, '#' + commentText);
        // After a comment, the line ends
        if (this.bracketDepth === 0) {
          this.startToken();
          this.emitToken(TokenType.Newline, '\n');
        }
        this.atLineStart = true;
        continue;
      }

      // Decorator
      if (ch === '@') {
        this.startToken();
        this.advance();
        this.emitToken(TokenType.Decorator, '@');
        continue;
      }

      // String
      if (ch === '"' || ch === "'") {
        const token = this.scanPythonString();
        this.tokens.push(token);
        continue;
      }

      // F-string
      if (ch === 'f' && (this.peekAhead(1) === '"' || this.peekAhead(1) === "'")) {
        const token = this.scanFString();
        this.tokens.push(token);
        continue;
      }

      // r-string / b-string / rb-string / br-string (prefix strings)
      if (
        (ch === 'r' || ch === 'b' || ch === 'R' || ch === 'B') &&
        this.peekAhead(1) !== null &&
        (this.peekAhead(1) === '"' || this.peekAhead(1) === "'" ||
         this.peekAhead(1) === 'f' || this.peekAhead(1) === 'F' ||
         this.peekAhead(1) === 'r' || this.peekAhead(1) === 'R' ||
         this.peekAhead(1) === 'b' || this.peekAhead(1) === 'B')
      ) {
        const token = this.scanPrefixedString();
        this.tokens.push(token);
        continue;
      }

      // Number
      if (isDigit(ch) || (ch === '.' && this.peekAhead(1) !== null && isDigit(this.peekAhead(1)!))) {
        const token = this.scanNumber();
        this.tokens.push(token);
        continue;
      }

      // Identifier / keyword
      if (isIdentifierStart(ch)) {
        const token = this.scanIdentifier();
        this.tokens.push(token);
        continue;
      }

      // Delimiters (non-operator ones)
      if (PYTHON_DELIMITERS[ch] && ch !== '@') {
        this.startToken();
        this.advance();
        const tokType = PYTHON_DELIMITERS[ch];
        this.emitToken(tokType, ch);
        if (ch === '(' || ch === '[' || ch === '{') {
          this.bracketDepth++;
        } else if (ch === ')' || ch === ']' || ch === '}') {
          this.bracketDepth = Math.max(0, this.bracketDepth - 1);
        }
        continue;
      }

      // Operators — longest match first
      const opToken = this.scanOperator(PYTHON_OPERATORS);
      if (opToken) {
        this.tokens.push(opToken);
        continue;
      }

      // Unknown character
      this.startToken();
      this.advance();
      this.emitToken(TokenType.Unknown, ch);
    }

    // Emit remaining DEDENTs at end of file
    this.emitRemainingDedents();

    // Emit EOF
    this.startToken();
    this.emitToken(TokenType.EOF, '');

    // Check bracket matching
    this.checkBracketMatching();

    // Compute stats
    const stats = this.computeStats();

    return {
      tokens: this.tokens,
      errors: this.errors,
      stats,
    };
  }

  protected resolveIdentifierType(value: string): TokenType {
    if (PYTHON_KEYWORDS.has(value)) {
      if (PYTHON_BOOLEANS.has(value)) return TokenType.Boolean;
      if (PYTHON_NONE.has(value)) return TokenType.None;
      return TokenType.Keyword;
    }
    return TokenType.Identifier;
  }

  // ── Indentation Handling ──────────────────────────────────────────────

  private handleIndentation(): void {
    let indent = 0;
    const startLine = this.line;
    const startCol = this.col;

    while (!this.isAtEnd()) {
      const ch = this.peek()!;
      if (ch === ' ') {
        // Check for mixing
        if (this.indentChar === 'tab') {
          this.addError('Mixed tabs and spaces in indentation', 'warning');
        }
        this.indentChar = 'space';
        indent++;
        this.advance();
      } else if (ch === '\t') {
        if (this.indentChar === 'space') {
          this.addError('Mixed tabs and spaces in indentation', 'warning');
        }
        this.indentChar = 'tab';
        indent += 8; // Tab = 8 spaces (common convention)
        this.advance();
      } else if (ch === '\n' || ch === '\r') {
        // Blank line — skip it entirely
        this.advance();
        if (ch === '\r' && !this.isAtEnd() && this.peek() === '\n') {
          this.advance();
        }
        indent = 0;
        continue;
      } else if (ch === '#') {
        // Comment-only line — skip
        this.skipLineComment();
        indent = 0;
        continue;
      } else {
        break;
      }
    }

    // If we're at end after whitespace, no indent tokens needed
    if (this.isAtEnd()) return;

    // Suppress indent/dedent inside brackets
    if (this.bracketDepth > 0) return;

    const currentIndent = this.indentStack[this.indentStack.length - 1];

    if (indent > currentIndent) {
      this.indentStack.push(indent);
      this.pendingTokens.push({
        type: TokenType.Indent,
        value: '',
        line: startLine,
        col: startCol,
        indent,
      });
    } else if (indent < currentIndent) {
      while (
        this.indentStack.length > 1 &&
        this.indentStack[this.indentStack.length - 1] > indent
      ) {
        this.indentStack.pop();
        this.pendingTokens.push({
          type: TokenType.Dedent,
          value: '',
          line: startLine,
          col: startCol,
          indent: this.indentStack[this.indentStack.length - 1],
        });
      }
      if (this.indentStack[this.indentStack.length - 1] !== indent) {
        this.addError(`Unindent does not match any outer indentation level (got ${indent}, expected ${this.indentStack[this.indentStack.length - 1]})`);
      }
    }
    // If indent === currentIndent, nothing to emit
  }

  private emitRemainingDedents(): void {
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.tokens.push({
        type: TokenType.Dedent,
        value: '',
        line: this.line,
        col: this.col,
        indent: this.indentStack[this.indentStack.length - 1],
      });
    }
  }

  // ── Python-specific String Scanning ───────────────────────────────────

  private scanPythonString(): Token {
    const quote = this.peek()!;
    // Check for triple quote
    if (
      this.peekAhead(1) === quote &&
      this.peekAhead(2) === quote
    ) {
      return this.scanTripleQuotedString(quote);
    }
    return this.scanString(quote);
  }

  private scanTripleQuotedString(quote: string): Token {
    this.startToken();
    const start = this.pos;
    // Consume opening triple quote
    this.advance(); // first quote
    this.advance(); // second quote
    this.advance(); // third quote

    const chars: string[] = [quote, quote, quote];

    while (!this.isAtEnd()) {
      const ch = this.peek()!;

      if (ch === '\\') {
        chars.push(ch);
        this.advance();
        if (this.isAtEnd()) break;
        const escStart = this.pos;
        const escResult = scanEscapeSequence(this.source, this.pos);
        for (let i = escStart; i < escResult.newPos; i++) {
          this.advance();
        }
        chars.push(this.source.substring(escStart, escResult.newPos));
      } else if (ch === quote) {
        // Check for closing triple quote
        if (this.peekAhead(1) === quote && this.peekAhead(2) === quote) {
          chars.push(quote, quote, quote);
          this.advance(); // first
          this.advance(); // second
          this.advance(); // third
          break;
        } else {
          chars.push(ch);
          this.advance();
        }
      } else {
        chars.push(ch);
        this.advance();
      }
    }

    const last3 = chars.slice(-3).join('');
    if (last3 !== quote + quote + quote) {
      this.addError('Unterminated triple-quoted string');
    }

    const value = this.source.substring(start, this.pos);
    return this.makeToken(TokenType.String, value);
  }

  private scanFString(): Token {
    this.startToken();
    const start = this.pos;
    this.advance(); // consume 'f'

    const quote = this.peek()!;
    // Check for triple-quoted f-string
    if (this.peekAhead(1) === quote && this.peekAhead(2) === quote) {
      this.advance(); // first quote
      this.advance(); // second quote
      this.advance(); // third quote

      // Scan to closing triple quote
      while (!this.isAtEnd()) {
        const ch = this.peek()!;
        if (ch === '\\') {
          this.advance();
          if (!this.isAtEnd()) this.advance();
        } else if (ch === '{') {
          this.advance();
          this.skipFStringExpression();
        } else if (ch === quote && this.peekAhead(1) === quote && this.peekAhead(2) === quote) {
          this.advance();
          this.advance();
          this.advance();
          break;
        } else {
          this.advance();
        }
      }
    } else {
      // Single-line f-string
      this.advance(); // consume opening quote

      while (!this.isAtEnd()) {
        const ch = this.peek()!;
        if (ch === '\\') {
          this.advance();
          if (!this.isAtEnd()) this.advance();
        } else if (ch === '{') {
          this.advance();
          this.skipFStringExpression();
        } else if (ch === quote) {
          this.advance(); // consume closing quote
          break;
        } else if (ch === '\n') {
          this.addError('Unterminated f-string literal');
          break;
        } else {
          this.advance();
        }
      }
    }

    const value = this.source.substring(start, this.pos);
    return this.makeToken(TokenType.String, value);
  }

  /** Skip the expression inside ${...} or {...} in f-strings */
  private skipFStringExpression(): void {
    let depth = 1;
    while (!this.isAtEnd() && depth > 0) {
      const ch = this.peek()!;
      if (ch === '{') {
        depth++;
        this.advance();
      } else if (ch === '}') {
        depth--;
        this.advance();
      } else if (ch === '"' || ch === "'") {
        // Skip nested string inside expression
        const q = ch;
        this.advance();
        while (!this.isAtEnd() && this.peek() !== q) {
          if (this.peek() === '\\') this.advance();
          if (!this.isAtEnd()) this.advance();
        }
        if (!this.isAtEnd()) this.advance(); // close quote
      } else {
        this.advance();
      }
    }
  }

  private scanPrefixedString(): Token {
    this.startToken();
    const start = this.pos;
    // Consume prefix (r, b, rb, br, etc.)
    let prefix = '';
    while (!this.isAtEnd() && isIdentifierPart(this.peek()!)) {
      const next = this.peek()!;
      if (next === '"' || next === "'") break;
      prefix += next;
      this.advance();
    }

    if (this.isAtEnd()) {
      // It was an identifier after all
      const value = this.source.substring(start, this.pos);
      return this.makeToken(this.resolveIdentifierType(value), value);
    }

    const quote = this.peek()!;
    // Check triple quote
    if (this.peekAhead(1) === quote && this.peekAhead(2) === quote) {
      // Triple quoted with prefix
      this.advance(); // first quote
      this.advance(); // second
      this.advance(); // third

      while (!this.isAtEnd()) {
        const ch = this.peek()!;
        if (ch === '\\') {
          this.advance();
          if (!this.isAtEnd()) this.advance();
        } else if (ch === quote && this.peekAhead(1) === quote && this.peekAhead(2) === quote) {
          this.advance();
          this.advance();
          this.advance();
          break;
        } else {
          this.advance();
        }
      }
    } else {
      // Single quoted with prefix
      this.advance(); // opening quote
      while (!this.isAtEnd()) {
        const ch = this.peek()!;
        if (ch === '\\') {
          this.advance();
          if (!this.isAtEnd()) this.advance();
        } else if (ch === quote) {
          this.advance();
          break;
        } else if (ch === '\n') {
          this.addError('Unterminated string literal');
          break;
        } else {
          this.advance();
        }
      }
    }

    const value = this.source.substring(start, this.pos);
    return this.makeToken(TokenType.String, value);
  }

  // ── Operator Scanning ─────────────────────────────────────────────────

  private scanOperator(operators: string[]): Token | null {
    for (const op of operators) {
      let match = true;
      for (let i = 0; i < op.length; i++) {
        if (this.peekAhead(i) !== op[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        this.startToken();
        // Advance past the operator
        for (let i = 0; i < op.length; i++) {
          this.advance();
        }
        // Classify the operator
        const tokenType = this.classifyOperator(op);
        return this.makeToken(tokenType, op);
      }
    }
    return null;
  }

  private classifyOperator(op: string): TokenType {
    // Arrow
    if (op === '->') return TokenType.Arrow;
    // Fat arrow
    if (op === '=>') return TokenType.FatArrow;
    // Ellipsis
    if (op === '...') return TokenType.Ellipsis;
    // Assignment operators
    const assignmentOps = ['=', '+=', '-=', '*=', '/=', '//=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>='];
    if (assignmentOps.includes(op)) {
      return TokenType.Assignment;
    }
    return TokenType.Operator;
  }

  private skipSpacesAndTabs(): void {
    while (!this.isAtEnd()) {
      const ch = this.peek()!;
      if (ch === ' ' || ch === '\t') {
        this.advance();
      } else {
        break;
      }
    }
  }
}

// ─── C-Style Lexer ─────────────────────────────────────────────────────────

class CStyleLexer extends BaseLexer {
  private keywords: Set<string>;
  private booleans: Set<string>;
  private nulls: Set<string>;

  constructor(source: string, language: SupportedLanguage) {
    super(source, language);

    switch (language) {
      case 'c':
        this.keywords = C_KEYWORDS;
        this.booleans = new Set();
        this.nulls = new Set();
        break;
      case 'cpp':
        this.keywords = CPP_KEYWORDS;
        this.booleans = new Set(['true', 'false']);
        this.nulls = new Set(['nullptr']);
        break;
      case 'java':
        this.keywords = JAVA_KEYWORDS;
        this.booleans = JAVA_BOOLEANS;
        this.nulls = JAVA_NULL;
        break;
      case 'javascript':
        this.keywords = JS_KEYWORDS;
        this.booleans = JS_BOOLEANS;
        this.nulls = JS_NULL;
        break;
      default:
        this.keywords = C_KEYWORDS;
        this.booleans = new Set();
        this.nulls = new Set();
    }
  }

  protected resolveIdentifierType(value: string): TokenType {
    if (this.booleans.has(value)) return TokenType.Boolean;
    if (this.nulls.has(value)) return TokenType.None;
    if (this.keywords.has(value)) return TokenType.Keyword;
    return TokenType.Identifier;
  }

  tokenize(): LexResult {
    while (!this.isAtEnd()) {
      this.skipWhitespace();

      if (this.isAtEnd()) break;

      const ch = this.peek()!;

      // Preprocessor directive (C/C++)
      if (
        (this.language === 'c' || this.language === 'cpp') &&
        ch === '#' &&
        // At start of line or after whitespace at start
        (this.col === 1 || this.isAfterWhitespaceOnLine())
      ) {
        const token = this.scanPreprocessorDirective();
        this.tokens.push(token);
        continue;
      }

      // Line comment //
      if (ch === '/' && this.peekAhead(1) === '/') {
        this.startToken();
        this.advance(); // /
        this.advance(); // /
        const commentText = this.skipLineComment();
        this.emitToken(TokenType.Comment, '//' + commentText);
        continue;
      }

      // Block comment /* */
      if (ch === '/' && this.peekAhead(1) === '*') {
        this.startToken();
        this.advance(); // /
        this.advance(); // *
        const commentText = this.skipBlockComment();
        this.emitToken(TokenType.Comment, '/*' + commentText + '*/');
        continue;
      }

      // Template literal (JavaScript)
      if (this.language === 'javascript' && ch === '`') {
        const token = this.scanTemplateLiteral();
        this.tokens.push(token);
        continue;
      }

      // String literals
      if (ch === '"' || ch === "'") {
        const token = this.scanString(ch);
        this.tokens.push(token);
        continue;
      }

      // C/C++: L"..." or L'...' wide string/char literals
      if (
        (this.language === 'c' || this.language === 'cpp') &&
        (ch === 'L' || ch === 'u' || ch === 'U' || ch === 'u8') &&
        (this.peekAhead(1) === '"' || this.peekAhead(1) === "'")
      ) {
        const token = this.scanWideStringLiteral();
        this.tokens.push(token);
        continue;
      }

      // Java annotation (@Foo)
      if (this.language === 'java' && ch === '@') {
        this.startToken();
        this.advance();
        this.emitToken(TokenType.Decorator, '@');
        continue;
      }

      // Number
      if (isDigit(ch) || (ch === '.' && this.peekAhead(1) !== null && isDigit(this.peekAhead(1)!))) {
        const token = this.scanNumber();
        this.tokens.push(token);
        continue;
      }

      // Ellipsis (must check before dot)
      if (ch === '.' && this.peekAhead(1) === '.' && this.peekAhead(2) === '.') {
        this.startToken();
        this.advance();
        this.advance();
        this.advance();
        this.emitToken(TokenType.Ellipsis, '...');
        continue;
      }

      // Identifier / keyword
      if (isIdentifierStart(ch)) {
        const token = this.scanIdentifier();
        this.tokens.push(token);
        continue;
      }

      // Delimiters
      if (DELIMITERS[ch]) {
        this.startToken();
        this.advance();
        this.emitToken(DELIMITERS[ch], ch);
        continue;
      }

      // Operators — longest match first
      const opToken = this.scanOperator(C_STYLE_OPERATORS);
      if (opToken) {
        this.tokens.push(opToken);
        continue;
      }

      // Unknown character
      this.startToken();
      this.advance();
      this.emitToken(TokenType.Unknown, ch);
    }

    // Emit EOF
    this.startToken();
    this.emitToken(TokenType.EOF, '');

    // Check bracket matching
    this.checkBracketMatching();

    // Compute stats
    const stats = this.computeStats();

    return {
      tokens: this.tokens,
      errors: this.errors,
      stats,
    };
  }

  // ── Preprocessor Directive Scanning ───────────────────────────────────

  private scanPreprocessorDirective(): Token {
    this.startToken();
    const start = this.pos;
    this.advance(); // consume '#'

    // Skip spaces between # and directive
    while (!this.isAtEnd() && (this.peek() === ' ' || this.peek() === '\t')) {
      this.advance();
    }

    // Read directive name
    while (!this.isAtEnd() && isIdentifierPart(this.peek()!)) {
      this.advance();
    }

    // Read the rest of the line
    while (!this.isAtEnd()) {
      const ch = this.peek()!;
      if (ch === '\n') break;
      if (ch === '\\' && this.peekAhead(1) === '\n') {
        // Line continuation
        this.advance();
        this.advance();
        continue;
      }
      if (ch === '\\' && this.peekAhead(1) === '\r' && this.peekAhead(2) === '\n') {
        this.advance();
        this.advance();
        this.advance();
        continue;
      }
      this.advance();
    }

    const value = this.source.substring(start, this.pos);
    return this.makeToken(TokenType.Preprocessor, value);
  }

  private isAfterWhitespaceOnLine(): boolean {
    // Check if # appears after only whitespace on the current line
    // We look back from the current position
    let p = this.pos - 1;
    while (p >= 0) {
      const ch = this.source[p];
      if (ch === '\n') return true;
      if (ch !== ' ' && ch !== '\t') return false;
      p--;
    }
    return true;
  }

  // ── Template Literal Scanning (JavaScript) ────────────────────────────

  private scanTemplateLiteral(): Token {
    this.startToken();
    const start = this.pos;
    this.advance(); // consume opening backtick

    while (!this.isAtEnd()) {
      const ch = this.peek()!;

      if (ch === '\\') {
        this.advance();
        if (!this.isAtEnd()) this.advance();
      } else if (ch === '$' && this.peekAhead(1) === '{') {
        this.advance(); // $
        this.advance(); // {
        this.skipTemplateExpression();
      } else if (ch === '`') {
        this.advance(); // closing backtick
        break;
      } else {
        this.advance();
      }
    }

    if (this.isAtEnd() && this.source[this.pos - 1] !== '`') {
      this.addError('Unterminated template literal');
    }

    const value = this.source.substring(start, this.pos);
    return this.makeToken(TokenType.String, value);
  }

  /** Skip the expression inside ${...} in template literals */
  private skipTemplateExpression(): void {
    let depth = 1;
    while (!this.isAtEnd() && depth > 0) {
      const ch = this.peek()!;
      if (ch === '{') {
        depth++;
        this.advance();
      } else if (ch === '}') {
        depth--;
        this.advance();
      } else if (ch === '`') {
        // Nested template literal
        this.advance();
        while (!this.isAtEnd() && this.peek() !== '`') {
          if (this.peek() === '\\') this.advance();
          if (!this.isAtEnd()) this.advance();
        }
        if (!this.isAtEnd()) this.advance(); // closing backtick
      } else if (ch === '"' || ch === "'") {
        // Skip nested string
        const q = ch;
        this.advance();
        while (!this.isAtEnd() && this.peek() !== q) {
          if (this.peek() === '\\') this.advance();
          if (!this.isAtEnd()) this.advance();
        }
        if (!this.isAtEnd()) this.advance();
      } else if (ch === '/' && this.peekAhead(1) === '/') {
        // Skip line comment inside expression
        while (!this.isAtEnd() && this.peek() !== '\n') {
          this.advance();
        }
      } else if (ch === '/' && this.peekAhead(1) === '*') {
        this.advance();
        this.advance();
        this.skipBlockComment();
      } else {
        this.advance();
      }
    }
  }

  // ── Wide String Literal (C/C++) ───────────────────────────────────────

  private scanWideStringLiteral(): Token {
    this.startToken();
    const start = this.pos;

    // Consume prefix (L, u, U, u8)
    while (!this.isAtEnd() && isIdentifierPart(this.peek()!) && this.peek() !== '"' && this.peek() !== "'") {
      this.advance();
    }

    if (this.isAtEnd()) {
      // Was an identifier
      const value = this.source.substring(start, this.pos);
      return this.makeToken(this.resolveIdentifierType(value), value);
    }

    const quote = this.peek()!;
    this.advance(); // opening quote

    while (!this.isAtEnd()) {
      const ch = this.peek()!;
      if (ch === '\\') {
        this.advance();
        if (!this.isAtEnd()) this.advance();
      } else if (ch === quote) {
        this.advance();
        break;
      } else if (ch === '\n') {
        this.addError('Unterminated string literal');
        break;
      } else {
        this.advance();
      }
    }

    const value = this.source.substring(start, this.pos);
    return this.makeToken(TokenType.String, value);
  }

  // ── Operator Scanning ─────────────────────────────────────────────────

  private scanOperator(operators: string[]): Token | null {
    for (const op of operators) {
      let match = true;
      for (let i = 0; i < op.length; i++) {
        if (this.peekAhead(i) !== op[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        this.startToken();
        for (let i = 0; i < op.length; i++) {
          this.advance();
        }
        const tokenType = this.classifyOperator(op);
        return this.makeToken(tokenType, op);
      }
    }
    return null;
  }

  private classifyOperator(op: string): TokenType {
    if (op === '->') return TokenType.Arrow;
    if (op === '=>') return TokenType.FatArrow;
    if (op === '...') return TokenType.Ellipsis;
    const assignmentOps = [
      '=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=',
    ];
    if (assignmentOps.includes(op)) {
      return TokenType.Assignment;
    }
    return TokenType.Operator;
  }

  // ── Override skipWhitespace for C-style (newlines are whitespace) ─────

  protected skipWhitespace(): void {
    while (!this.isAtEnd()) {
      const ch = this.peek()!;
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
      } else {
        break;
      }
    }
  }
}

// ─── Factory Function ──────────────────────────────────────────────────────

export function createLexer(code: string, language: SupportedLanguage): Lexer {
  const normalizedLang = normalizeLanguage(language);

  switch (normalizedLang) {
    case 'python':
      return new PythonLexer(code);
    case 'c':
    case 'cpp':
    case 'java':
    case 'javascript':
      return new CStyleLexer(code, normalizedLang);
    default:
      return new CStyleLexer(code, 'javascript');
  }
}
