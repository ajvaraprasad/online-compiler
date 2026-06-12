/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge Compiler — Recursive Descent Parser
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Builds Abstract Syntax Trees from lexer token streams using recursive
 * descent parsing with a Pratt expression parser for operator precedence.
 *
 * Architecture:
 *   BaseParser      — token management, error recovery, node creation,
 *                     Pratt expression parsing
 *   PythonParser    — indentation-based blocks, Python-specific constructs
 *   CStyleParser    — brace-based blocks (C, C++, Java, JavaScript)
 */

import {
  Token,
  TokenType,
  ASTNode,
  ASTNodeType,
  ParseResult,
  ParseStats,
  CompilerError,
  CompilerPhase,
  SourceLocation,
  SupportedLanguage,
  generateNodeId,
} from '../types';

// ─── Parser Interface ─────────────────────────────────────────────────────

export interface Parser {
  parse(): ParseResult;
  /** Enable/disable debug mode — when enabled, parser records rule entry/exit trace */
  setDebugMode(enabled: boolean): void;
  /** Get the debug trace (only populated when debug mode is enabled) */
  getDebugTrace(): ParserDebugEntry[];
}

/** A single parser debug trace entry */
export interface ParserDebugEntry {
  /** The grammar rule being entered or exited */
  rule: string;
  /** Whether this is 'enter' or 'exit' */
  event: 'enter' | 'exit';
  /** Current token at the time of the event */
  currentToken: { type: string; value: string; line: number; col: number };
  /** Expected tokens at this point (if known) */
  expectedTokens?: string[];
  /** Source line text (if available) */
  sourceLine?: string;
  /** Timestamp (ms since parse start) */
  timestamp: number;
}

// ─── Binding Power Constants (Pratt Parser) ──────────────────────────────

const BP = {
  NONE: 0,
  COMMA: 1,
  ASSIGNMENT: 2,
  TERNARY: 4,
  LOGICAL_OR: 5,
  LOGICAL_AND: 6,
  BITWISE_OR: 7,
  BITWISE_XOR: 8,
  BITWISE_AND: 9,
  EQUALITY: 10,
  RELATIONAL: 11,
  IN: 12,
  INSTANCEOF: 12,
  SHIFT: 13,
  ADDITIVE: 14,
  MULTIPLICATIVE: 15,
  FLOOR_DIV: 16,
  EXPONENTIATION: 17,
  UNARY: 18,
  POSTFIX: 19,
  CALL: 21,
  MEMBER: 22,
  PRIMARY: 23,
} as const;

// ─── Language Keyword / Type Sets ────────────────────────────────────────

const C_CPP_TYPE_KEYWORDS = new Set([
  'int', 'float', 'double', 'void', 'char', 'bool',
  'long', 'short', 'unsigned', 'signed', 'auto', 'wchar_t',
  'size_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'string', 'std', 'nullptr_t',
]);

const JAVA_TYPE_KEYWORDS = new Set([
  'int', 'float', 'double', 'void', 'char', 'boolean', 'byte', 'long', 'short',
]);

const C_CPP_MODIFIERS = new Set([
  'const', 'static', 'extern', 'volatile', 'register', 'inline',
  'virtual', 'override', 'final', 'mutable', 'friend', 'explicit',
  'constexpr', 'typedef', 'typename', 'thread_local',
]);

const JAVA_MODIFIERS = new Set([
  'public', 'private', 'protected', 'static', 'final', 'abstract',
  'synchronized', 'volatile', 'transient', 'native', 'strictfp',
]);

const JS_DECL_KEYWORDS = new Set(['let', 'const', 'var']);

const ASSIGNMENT_OPS = new Set([
  '=', '+=', '-=', '*=', '/=', '%=', '**=', '//=', '&=', '|=',
  '^=', '<<=', '>>=', '>>>=', ':=',
]);

const AUGMENTED_ASSIGNMENT_OPS = new Set([
  '+=', '-=', '*=', '/=', '%=', '**=', '//=', '&=', '|=',
  '^=', '<<=', '>>=', '>>>=', ':=',
]);

const JS_MODIFIERS = new Set(['async', 'export', 'default', 'static']);

// ─── Utility: Merge SourceLocations ──────────────────────────────────────

function mergeLoc(start: SourceLocation, end: SourceLocation): SourceLocation {
  return {
    startLine: start.startLine,
    startCol: start.startCol,
    endLine: end.endLine,
    endCol: end.endCol,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Base Parser
// ═══════════════════════════════════════════════════════════════════════════

abstract class BaseParser {
  protected tokens: Token[];
  protected pos: number = 0;
  protected errors: CompilerError[] = [];
  protected language: SupportedLanguage;
  /** Debug mode — when enabled, records rule entry/exit trace */
  protected debugMode = false;
  /** Debug trace entries */
  protected debugTrace: ParserDebugEntry[] = [];
  /** Parse start time for debug timestamps */
  protected parseStartTime = 0;
  /** Source lines for debug context */
  protected sourceLines: string[] = [];

  constructor(tokens: Token[], language: SupportedLanguage) {
    this.tokens = tokens;
    this.language = language;
  }

  // ─── Debug Mode ─────────────────────────────────────────────────────

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  getDebugTrace(): ParserDebugEntry[] {
    return this.debugTrace;
  }

  /** Enter a grammar rule (records debug trace if debug mode is on) */
  protected enterRule(rule: string, expectedTokens?: string[]): void {
    if (!this.debugMode) return;
    const tok = this.peek();
    this.debugTrace.push({
      rule,
      event: 'enter',
      currentToken: { type: tok.type, value: tok.value, line: tok.line, col: tok.col },
      expectedTokens,
      sourceLine: this.sourceLines[tok.line - 1],
      timestamp: Date.now() - this.parseStartTime,
    });
  }

  /** Exit a grammar rule (records debug trace if debug mode is on) */
  protected exitRule(rule: string): void {
    if (!this.debugMode) return;
    const tok = this.peek();
    this.debugTrace.push({
      rule,
      event: 'exit',
      currentToken: { type: tok.type, value: tok.value, line: tok.line, col: tok.col },
      sourceLine: this.sourceLines[tok.line - 1],
      timestamp: Date.now() - this.parseStartTime,
    });
  }

  // ─── Abstract: subclasses implement statement/program parsing ──────────

  abstract parse(): ParseResult;

  // ─── Token Management ─────────────────────────────────────────────────

  protected advance(): Token {
    if (!this.isAtEnd()) this.pos++;
    return this.previous();
  }

  protected peek(): Token {
    if (this.pos >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1] ?? this.makeEOFToken();
    }
    return this.tokens[this.pos];
  }

  protected peekAhead(n: number): Token {
    const idx = this.pos + n;
    if (idx >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1] ?? this.makeEOFToken();
    }
    return this.tokens[idx];
  }

  protected previous(): Token {
    if (this.pos <= 0) return this.tokens[0] ?? this.makeEOFToken();
    return this.tokens[this.pos - 1];
  }

  protected isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  protected match(type: TokenType, value?: string): boolean {
    if (this.check(type, value)) {
      this.advance();
      return true;
    }
    return false;
  }

  protected check(type: TokenType, value?: string): boolean {
    const tok = this.peek();
    if (tok.type !== type) return false;
    if (value !== undefined && tok.value !== value) return false;
    return true;
  }

  protected checkAhead(n: number, type: TokenType, value?: string): boolean {
    const tok = this.peekAhead(n);
    if (tok.type !== type) return false;
    if (value !== undefined && tok.value !== value) return false;
    return true;
  }

  protected expect(type: TokenType, value?: string): Token {
    if (this.check(type, value)) {
      return this.advance();
    }
    const tok = this.peek();
    this.addDetailedError(
      `Expected ${type}${value ? ` '${value}'` : ''} but found ${tok.type} '${tok.value}'`,
      tok,
      {
        grammarRule: 'expect',
        expectedTokens: [value ? `${type}('${value}')` : `${type}`],
      }
    );
    return tok; // Return the unexpected token for recovery
  }

  protected consumeIf(type: TokenType, value?: string): Token | null {
    if (this.check(type, value)) {
      return this.advance();
    }
    return null;
  }

  protected skipTokens(...types: TokenType[]): void {
    while (!this.isAtEnd() && types.includes(this.peek().type)) {
      this.advance();
    }
  }

  private makeEOFToken(): Token {
    const last = this.tokens[this.tokens.length - 1];
    return {
      type: TokenType.EOF,
      value: '',
      line: last?.line ?? 1,
      col: last?.col ?? 0,
    };
  }

  // ─── Error Handling ───────────────────────────────────────────────────

  protected addError(message: string, token?: Token): void {
    this.errors.push({
      phase: CompilerPhase.Parsing,
      message,
      line: token?.line,
      col: token?.col,
      severity: 'error',
    });
  }

  protected addWarning(message: string, token?: Token): void {
    this.errors.push({
      phase: CompilerPhase.Parsing,
      message,
      line: token?.line,
      col: token?.col,
      severity: 'warning',
    });
  }

  protected addDetailedError(
    message: string,
    token?: Token,
    context?: {
      grammarRule?: string;
      expectedTokens?: string[];
      sourceLine?: string;
    }
  ): void {
    const error: CompilerError = {
      phase: CompilerPhase.Parsing,
      message,
      line: token?.line,
      col: token?.col,
      severity: 'error',
    };
    if (context) {
      (error as any).grammarRule = context.grammarRule;
      (error as any).expectedTokens = context.expectedTokens;
      (error as any).sourceLine = context.sourceLine;
    }
    this.errors.push(error);
  }

  // ─── Error Recovery: Synchronization ──────────────────────────────────

  protected synchronize(): void {
    while (!this.isAtEnd()) {
      const tok = this.peek();
      // Stop at statement boundaries
      if (tok.type === TokenType.Semicolon) {
        this.advance();
        return;
      }
      if (tok.type === TokenType.RightBrace) {
        return;
      }
      if (tok.type === TokenType.Newline && this.language === 'python') {
        return;
      }
      if (tok.type === TokenType.Dedent && this.language === 'python') {
        return;
      }
      // Stop at keywords that begin new statements
      if (tok.type === TokenType.Keyword) {
        const stmtKeywords = this.language === 'python'
          ? ['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'try',
             'with', 'import', 'from', 'return', 'raise', 'global', 'nonlocal',
             'assert', 'pass', 'break', 'continue', 'yield']
          : ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return',
             'break', 'continue', 'throw', 'try', 'catch', 'finally', 'class',
             'struct', 'enum', 'interface', 'namespace', 'using', 'public',
             'private', 'protected', 'static', 'void', 'int', 'float',
             'double', 'char', 'boolean', 'long', 'short', 'byte'];
        if (stmtKeywords.includes(tok.value)) return;
      }
      this.advance();
    }
  }

  // ─── Node Construction ────────────────────────────────────────────────

  protected loc(startToken?: Token, endToken?: Token): SourceLocation {
    const s = startToken ?? this.peek();
    const e = endToken ?? this.previous();
    return {
      startLine: s.line,
      startCol: s.col,
      endLine: e.line,
      endCol: e.col + Math.max(e.value.length, 1),
    };
  }

  protected createNode(
    type: ASTNodeType,
    children: ASTNode[],
    props: Record<string, unknown>,
    startToken?: Token,
    endToken?: Token,
  ): ASTNode {
    return {
      type,
      children,
      props,
      loc: this.loc(startToken, endToken),
      id: generateNodeId(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Pratt Expression Parser
  // ═══════════════════════════════════════════════════════════════════════

  protected parseExpression(minBP: number = BP.NONE): ASTNode {
    const startTok = this.peek();

    // Parse the left-hand side (prefix / primary)
    let left = this.parsePrefix();

    // Loop: while the next token is an infix/postfix operator with sufficient BP
    while (!this.isAtEnd()) {
      const infixBP = this.getInfixBindingPower(this.peek());
      if (infixBP === null || infixBP[0] < minBP) break;

      left = this.parseInfix(left, infixBP, startTok);
    }

    return left;
  }

  // ─── Prefix / Primary Parsing ─────────────────────────────────────────

  private parsePrefix(): ASTNode {
    const tok = this.peek();

    // Unary prefix operators
    if (this.isUnaryPrefix(tok)) {
      return this.parseUnaryPrefix();
    }

    // Grouping / parenthesized expression — or C-style cast (Type)expr
    if (tok.type === TokenType.LeftParen) {
      if (this.language === 'c' || this.language === 'cpp') {
        return this.parseParenOrCast();
      }
      return this.parseParenthesizedExpression();
    }

    // Array literal
    if (tok.type === TokenType.LeftBracket) {
      return this.parseArrayLiteral();
    }

    // C/C++ initializer list: {1, 2, 3}
    if (tok.type === TokenType.LeftBrace && (this.language === 'c' || this.language === 'cpp')) {
      return this.parseInitializerList();
    }

    // Object literal (JavaScript) or dict/set (Python)
    if (tok.type === TokenType.LeftBrace && this.language === 'javascript') {
      return this.parseObjectLiteral();
    }

    // Number literal
    if (tok.type === TokenType.Number) {
      return this.parseNumberLiteral();
    }

    // String literal
    if (tok.type === TokenType.String) {
      return this.parseStringLiteral();
    }

    // Boolean literal
    if (tok.type === TokenType.Boolean) {
      return this.parseBooleanLiteral();
    }

    // None / null
    if (tok.type === TokenType.None) {
      return this.parseNoneLiteral();
    }

    // Keyword: True/False (Python)
    if (tok.type === TokenType.Keyword && (tok.value === 'True' || tok.value === 'False')) {
      return this.parseBooleanLiteral();
    }

    // Keyword: None (Python)
    if (tok.type === TokenType.Keyword && tok.value === 'None') {
      return this.parseNoneLiteral();
    }

    // Keyword: lambda (Python)
    if (tok.type === TokenType.Keyword && tok.value === 'lambda') {
      return this.parseLambdaExpression();
    }

    // Keyword: yield (Python)
    if (tok.type === TokenType.Keyword && tok.value === 'yield') {
      return this.parseYieldExpression();
    }

    // Keyword: await
    if (tok.type === TokenType.Keyword && tok.value === 'await') {
      return this.parseAwaitExpression();
    }

    // Keyword: new (C++/Java/JavaScript)
    if (tok.type === TokenType.Keyword && tok.value === 'new') {
      return this.parseNewExpression();
    }

    // Keyword: sizeof (C/C++)
    if (tok.type === TokenType.Keyword && tok.value === 'sizeof') {
      return this.parseSizeofExpression();
    }

    // Keyword: typeof (JavaScript)
    if (tok.type === TokenType.Keyword && tok.value === 'typeof') {
      return this.parseTypeofExpression();
    }

    // Keyword: delete (JavaScript)
    if (tok.type === TokenType.Keyword && tok.value === 'delete') {
      return this.parseDeleteExpression();
    }

    // Keyword: throw (as expression in some contexts)
    if (tok.type === TokenType.Keyword && tok.value === 'throw') {
      // Usually a statement, but can appear in expression context in JS
      this.advance();
      const expr = this.parseExpression(BP.UNARY);
      return this.createNode(ASTNodeType.ThrowStatement, [expr], {}, tok);
    }

    // Spread / rest: ...
    if (tok.type === TokenType.Ellipsis) {
      this.advance();
      const expr = this.parseExpression(BP.UNARY);
      return this.createNode(ASTNodeType.SpreadExpression, [expr], {}, tok);
    }

    // Decorator (@)
    if (tok.type === TokenType.Decorator) {
      return this.parseDecoratorExpression();
    }

    // Identifier
    if (tok.type === TokenType.Identifier) {
      return this.parseIdentifier();
    }

    // Keyword used as identifier or expression-start (e.g., 'this', 'super')
    if (tok.type === TokenType.Keyword && this.isExprStartKeyword(tok.value)) {
      return this.parseKeywordExpression();
    }

    // Keyword used as identifier in expression context (e.g., Python builtins like 'print')
    if (tok.type === TokenType.Keyword) {
      return this.parseKeywordExpression();
    }

    // Fallback: skip and create error node
    this.addDetailedError(`Unexpected token '${tok.value}' in expression`, tok, {
      grammarRule: 'parsePrefix',
      expectedTokens: ['Number', 'String', 'Identifier', '(', '[', 'unary(-,+,!,~,++,--,&,*)'],
    });
    this.advance();
    return this.createNode(ASTNodeType.Identifier, [], {
      name: tok.value,
      error: true,
    }, tok, tok);
  }

  private isUnaryPrefix(tok: Token): boolean {
    if (tok.type === TokenType.Operator) {
      // C/C++: & (address-of) and * (dereference) are unary prefix operators
      if (this.language === 'c' || this.language === 'cpp') {
        return ['-', '+', '!', '~', '++', '--', '&', '*'].includes(tok.value);
      }
      return ['-', '+', '!', '~', '++', '--'].includes(tok.value);
    }
    if (tok.type === TokenType.Keyword) {
      return tok.value === 'not' && this.language === 'python';
    }
    return false;
  }

  private parseUnaryPrefix(): ASTNode {
    const startTok = this.peek();
    const op = this.advance();
    const rightBP = (op.value === '++' || op.value === '--')
      ? BP.POSTFIX
      : BP.UNARY;
    const operand = this.parseExpression(rightBP);
    return this.createNode(ASTNodeType.UnaryExpression, [operand], {
      operator: op.value,
      prefix: true,
    }, startTok);
  }

  private parseParenthesizedExpression(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.LeftParen);

    // Check for empty parens → could be tuple or void call
    if (this.check(TokenType.RightParen)) {
      this.advance();
      return this.createNode(ASTNodeType.Identifier, [], {
        name: '()',
        isTuple: true,
      }, startTok);
    }

    const expr = this.parseExpression();

    // Check for tuple: (a, b, c)
    if (this.check(TokenType.Comma)) {
      return this.parseTupleExpression(expr, startTok);
    }

    this.expect(TokenType.RightParen);
    return expr; // Parenthesized expression → just the inner expression
  }

  /**
   * Parse parenthesized expression OR C-style cast for C/C++.
   * In C/C++, `(TypeName)expr` is a cast expression. We need to
   * disambiguate between casts and regular parenthesized expressions
   * using speculative parsing: if the content inside parens looks like
   * a type name, and is followed by an expression on the right, it's a cast.
   */
  private parseParenOrCast(): ASTNode {
    const savedPos = this.pos;
    const startTok = this.peek();

    // Speculative: try to parse as a cast (Type)expr
    this.advance(); // consume '('

    // Check if the content looks like a type name
    const typeResult = this.tryParseTypeForCast();

    if (typeResult && this.check(TokenType.RightParen)) {
      // This looks like a cast — (Type) — but we need to verify
      // that the next token starts an expression (not a comparison etc.)
      this.advance(); // consume ')'

      // Peek at what follows — if it starts an expression, it's a cast
      const nextTok = this.peek();
      if (this.isCastOperandStart(nextTok)) {
        // It's a cast expression: (Type)operand
        const operand = this.parseExpression(BP.UNARY);
        return this.createNode(ASTNodeType.CastExpression, [typeResult.typeNode, operand], {
          castType: typeResult.typeStr,
        }, startTok);
      }

      // Not a cast — the (Type) was actually a parenthesized variable
      // declaration or similar. Backtrack.
      this.pos = savedPos;
    } else {
      // Not a cast — backtrack
      this.pos = savedPos;
    }

    // Fall through to regular parenthesized expression
    return this.parseParenthesizedExpression();
  }

  /**
   * Try to parse a type name inside parentheses for C-style casts.
   * Returns null if it doesn't look like a type.
   */
  private tryParseTypeForCast(): { typeStr: string; typeNode: ASTNode } | null {
    const startTok = this.peek();

    // struct Type, enum Type
    if (this.peek().type === TokenType.Keyword &&
        (this.peek().value === 'struct' || this.peek().value === 'enum' || this.peek().value === 'class')) {
      const qualifier = this.advance().value;
      let typeStr = qualifier;
      if (this.check(TokenType.Identifier)) {
        typeStr += ' ' + this.advance().value;
      }
      while (this.check(TokenType.Operator, '*')) {
        this.advance();
        typeStr += '*';
      }
      const typeNode = this.createNode(ASTNodeType.Identifier, [], {
        name: typeStr,
        kind: 'type',
      }, startTok);
      return { typeStr, typeNode };
    }

    // Simple type name: int, char, float, double, void, long, etc.
    if (this.check(TokenType.Identifier) || this.isTypeKeyword(this.peek().value)) {
      let typeStr = this.advance().value;

      // Handle multi-word types: long int, unsigned int, etc.
      while ((this.check(TokenType.Identifier) || this.isTypeKeyword(this.peek().value)) &&
             !this.check(TokenType.RightParen)) {
        typeStr += ' ' + this.advance().value;
      }

      while (this.check(TokenType.Operator, '*')) {
        this.advance();
        typeStr += '*';
      }
      const typeNode = this.createNode(ASTNodeType.Identifier, [], {
        name: typeStr,
        kind: 'type',
      }, startTok);
      return { typeStr, typeNode };
    }

    return null;
  }

  /**
   * Check if the given token could start an operand for a C-style cast.
   * After (Type), the next token must start an expression for this to be a cast.
   */
  private isCastOperandStart(tok: Token): boolean {
    if (tok.type === TokenType.Identifier) return true;
    if (tok.type === TokenType.Number) return true;
    if (tok.type === TokenType.String) return true;
    if (tok.type === TokenType.LeftParen) return true;
    if (tok.type === TokenType.LeftBracket) return true;
    if (tok.type === TokenType.LeftBrace) return true;
    if (tok.type === TokenType.Operator &&
        ['-', '+', '!', '~', '*', '&', '++', '--'].includes(tok.value)) return true;
    if (tok.type === TokenType.Keyword && tok.value === 'sizeof') return true;
    return false;
  }

  private parseTupleExpression(firstExpr: ASTNode, startTok: Token): ASTNode {
    const elements: ASTNode[] = [firstExpr];
    while (this.match(TokenType.Comma)) {
      if (this.check(TokenType.RightParen)) break;
      elements.push(this.parseExpression(BP.COMMA + 1));
    }
    this.expect(TokenType.RightParen);
    return this.createNode(ASTNodeType.ArrayExpression, elements, {
      isTuple: true,
    }, startTok);
  }

  private parseArrayLiteral(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.LeftBracket);
    const elements: ASTNode[] = [];

    while (!this.check(TokenType.RightBracket) && !this.isAtEnd()) {
      // Spread
      if (this.check(TokenType.Ellipsis)) {
        this.advance();
        elements.push(this.createNode(
          ASTNodeType.SpreadExpression,
          [this.parseExpression(BP.COMMA + 1)],
          {},
        ));
      } else {
        elements.push(this.parseExpression(BP.COMMA + 1));
      }

      // Check for Python comprehension: [expr for ...]
      if (this.check(TokenType.Keyword, 'for') && this.language === 'python') {
        return this.parseComprehension(elements[0], startTok, 'list');
      }

      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightBracket);
    return this.createNode(ASTNodeType.ArrayExpression, elements, {
      isArray: true,
    }, startTok);
  }

  private parseObjectLiteral(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.LeftBrace);
    const properties: ASTNode[] = [];

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      const propStart = this.peek();
      // Key
      let key: ASTNode;
      if (this.check(TokenType.Identifier) || this.check(TokenType.String) || this.check(TokenType.Number)) {
        key = this.parseExpression(BP.COMMA + 1);
      } else if (this.check(TokenType.LeftBracket)) {
        // Computed property
        this.advance();
        key = this.parseExpression();
        this.expect(TokenType.RightBracket);
      } else {
        this.addError('Expected property name in object literal', this.peek());
        break;
      }

      if (this.match(TokenType.Colon)) {
        const value = this.parseExpression(BP.COMMA + 1);
        properties.push(this.createNode(ASTNodeType.Identifier, [key, value], {
          kind: 'property',
        }, propStart));
      } else {
        // Shorthand property { x }
        properties.push(this.createNode(ASTNodeType.Identifier, [key], {
          kind: 'shorthand',
        }, propStart));
      }

      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightBrace);
    return this.createNode(ASTNodeType.ObjectExpression, properties, {}, startTok);
  }

  /**
   * C/C++ initializer list: {1, 2, 3} or nested {{1,2,3},{4,5,6}}
   * Called from parsePrefix when we see '{' in C/C++ expression context.
   * Supports recursive initializer lists and trailing commas.
   */
  private parseInitializerList(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.LeftBrace);
    const elements: ASTNode[] = [];

    // Empty initializer list: {}
    if (this.check(TokenType.RightBrace)) {
      this.advance();
      return this.createNode(ASTNodeType.ArrayExpression, elements, {
        isInitializer: true,
      }, startTok);
    }

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      // Check for C99 designated initializers:
      //   .field = value
      //   [index] = value
      //   .field = { ... }
      if (this.check(TokenType.Dot) && (this.language === 'c' || this.language === 'cpp')) {
        // Designated initializer: .field = value
        const designatorStart = this.peek();
        this.advance(); // consume '.'
        const fieldName = this.expect(TokenType.Identifier);
        const fieldNameNode = this.createNode(ASTNodeType.Identifier, [], {
          name: fieldName.value,
          kind: 'designator',
        }, fieldName, fieldName);

        if (this.match(TokenType.Assignment, '=') || this.match(TokenType.Operator, '=')) {
          const value = this.parseExpression(BP.COMMA + 1);
          elements.push(this.createNode(ASTNodeType.AssignmentExpression, [fieldNameNode, value], {
            operator: '=',
            isDesignated: true,
            designator: fieldName.value,
          }, designatorStart));
        } else {
          // Malformed designated initializer — treat field as element
          elements.push(fieldNameNode);
        }
      } else if (this.check(TokenType.LeftBracket) && (this.language === 'c' || this.language === 'cpp')) {
        // Array designator: [index] = value
        const designatorStart = this.peek();
        this.advance(); // consume '['
        const index = this.parseExpression();
        this.expect(TokenType.RightBracket);
        if (this.match(TokenType.Assignment, '=') || this.match(TokenType.Operator, '=')) {
          const value = this.parseExpression(BP.COMMA + 1);
          elements.push(this.createNode(ASTNodeType.AssignmentExpression, [index, value], {
            operator: '=',
            isDesignated: true,
            isArrayDesignator: true,
          }, designatorStart));
        } else {
          // This might be a regular subscript expression
          elements.push(index);
        }
      } else {
        // Regular initializer element
        elements.push(this.parseExpression(BP.COMMA + 1));
      }

      // Comma separates elements; trailing comma before } is allowed
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightBrace);
    return this.createNode(ASTNodeType.ArrayExpression, elements, {
      isInitializer: true,
    }, startTok);
  }

  private parseNumberLiteral(): ASTNode {
    const tok = this.advance();
    const raw = tok.value;
    let numericValue: number;
    if (raw.startsWith('0x') || raw.startsWith('0X')) {
      numericValue = parseInt(raw, 16);
    } else if (raw.startsWith('0b') || raw.startsWith('0B')) {
      numericValue = parseInt(raw.slice(2), 2);
    } else if (raw.startsWith('0o') || raw.startsWith('0O')) {
      numericValue = parseInt(raw.slice(2), 8);
    } else {
      numericValue = parseFloat(raw);
    }
    return this.createNode(ASTNodeType.NumberLiteral, [], {
      value: numericValue,
      raw,
    }, tok, tok);
  }

  private parseStringLiteral(): ASTNode {
    const tok = this.advance();
    const raw = tok.value;
    // Check for f-string (Python)
    if (this.language === 'python' && (raw.startsWith('f"') || raw.startsWith("f'") ||
        raw.startsWith('F"') || raw.startsWith("F'"))) {
      return this.parseFStringExpression(tok);
    }
    // Check for template literal (JavaScript) — backtick strings
    if (this.language === 'javascript' && raw.startsWith('`')) {
      return this.parseTemplateLiteral(tok);
    }
    return this.createNode(ASTNodeType.StringLiteral, [], {
      value: raw,
      raw,
    }, tok, tok);
  }

  private parseFStringExpression(tok: Token): ASTNode {
    // Simplified f-string: the lexer may already have the full string
    return this.createNode(ASTNodeType.FStringExpression, [], {
      value: tok.value,
      raw: tok.value,
    }, tok, tok);
  }

  private parseTemplateLiteral(tok: Token): ASTNode {
    // Simplified template literal parsing
    return this.createNode(ASTNodeType.TemplateLiteral, [], {
      value: tok.value,
      raw: tok.value,
    }, tok, tok);
  }

  private parseBooleanLiteral(): ASTNode {
    const tok = this.advance();
    const val = tok.value === 'True' || tok.value === 'true' || tok.value === 'TRUE';
    return this.createNode(ASTNodeType.BooleanLiteral, [], {
      value: val,
      raw: tok.value,
    }, tok, tok);
  }

  private parseNoneLiteral(): ASTNode {
    const tok = this.advance();
    return this.createNode(ASTNodeType.NoneLiteral, [], {
      value: tok.value,
      raw: tok.value,
    }, tok, tok);
  }

  private parseIdentifier(): ASTNode {
    const tok = this.advance();
    return this.createNode(ASTNodeType.Identifier, [], {
      name: tok.value,
    }, tok, tok);
  }

  private isExprStartKeyword(value: string): boolean {
    return ['this', 'super', 'self', 'cls', 'true', 'false', 'null',
            'True', 'False', 'None', 'undefined', 'nil', 'NaN', 'Infinity'].includes(value);
  }

  private parseKeywordExpression(): ASTNode {
    const tok = this.advance();
    if (tok.value === 'true' || tok.value === 'True' || tok.value === 'TRUE') {
      return this.createNode(ASTNodeType.BooleanLiteral, [], {
        value: true, raw: tok.value,
      }, tok, tok);
    }
    if (tok.value === 'false' || tok.value === 'False' || tok.value === 'FALSE') {
      return this.createNode(ASTNodeType.BooleanLiteral, [], {
        value: false, raw: tok.value,
      }, tok, tok);
    }
    if (tok.value === 'None' || tok.value === 'null' || tok.value === 'nil' || tok.value === 'undefined') {
      return this.createNode(ASTNodeType.NoneLiteral, [], {
        value: tok.value, raw: tok.value,
      }, tok, tok);
    }
    // this, super, self, cls, etc.
    return this.createNode(ASTNodeType.Identifier, [], {
      name: tok.value,
      isKeyword: true,
    }, tok, tok);
  }

  private parseLambdaExpression(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'lambda'

    const params: ASTNode[] = [];
    // Parse parameters until ':'
    while (!this.check(TokenType.Colon) && !this.isAtEnd()) {
      const param = this.parseExpression(BP.COMMA + 1);
      params.push(param);
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.Colon);
    const body = this.parseExpression(BP.TERNARY);

    return this.createNode(ASTNodeType.LambdaExpression, [...params, body], {
      paramCount: params.length,
    }, startTok);
  }

  private parseYieldExpression(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'yield'
    let value: ASTNode | null = null;
    if (!this.isAtEnd() && !this.check(TokenType.Newline) && !this.check(TokenType.Semicolon) && !this.check(TokenType.RightParen) && !this.check(TokenType.RightBracket) && !this.check(TokenType.RightBrace)) {
      value = this.parseExpression(BP.ASSIGNMENT);
    }
    return this.createNode(ASTNodeType.YieldExpression, value ? [value] : [], {
      isYieldFrom: false,
    }, startTok);
  }

  private parseAwaitExpression(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'await'
    const expr = this.parseExpression(BP.UNARY);
    return this.createNode(ASTNodeType.AwaitExpression, [expr], {}, startTok);
  }

  private parseNewExpression(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'new'

    const callee = this.parseExpression(BP.CALL);
    return this.createNode(ASTNodeType.NewExpression, [callee], {}, startTok);
  }

  private parseSizeofExpression(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'sizeof'
    this.expect(TokenType.LeftParen);

    // In C/C++, sizeof can take either a type name or an expression.
    // Try parsing as a type first (for cases like sizeof(int), sizeof(struct Point))
    const savedPos = this.pos;
    const typeResult = this.tryParseTypeForCast();
    if (typeResult && this.check(TokenType.RightParen)) {
      this.advance(); // consume ')'
      return this.createNode(ASTNodeType.SizeofExpression, [typeResult.typeNode], {
        operandType: typeResult.typeStr,
      }, startTok);
    }
    // Not a type — backtrack and parse as expression
    this.pos = savedPos;

    const expr = this.parseExpression();
    this.expect(TokenType.RightParen);
    return this.createNode(ASTNodeType.SizeofExpression, [expr], {}, startTok);
  }

  private parseTypeofExpression(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'typeof'
    const expr = this.parseExpression(BP.UNARY);
    return this.createNode(ASTNodeType.UnaryExpression, [expr], {
      operator: 'typeof',
      prefix: true,
    }, startTok);
  }

  private parseDeleteExpression(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'delete'
    const expr = this.parseExpression(BP.UNARY);
    return this.createNode(ASTNodeType.UnaryExpression, [expr], {
      operator: 'delete',
      prefix: true,
    }, startTok);
  }

  protected parseDecoratorExpression(): ASTNode {
    const startTok = this.peek();
    const tok = this.advance(); // consume decorator token
    const name = tok.value.startsWith('@') ? tok.value.slice(1) : tok.value;
    let args: ASTNode[] = [];
    if (this.check(TokenType.LeftParen)) {
      this.advance();
      while (!this.check(TokenType.RightParen) && !this.isAtEnd()) {
        args.push(this.parseExpression(BP.COMMA + 1));
        if (!this.match(TokenType.Comma)) break;
      }
      this.expect(TokenType.RightParen);
    }
    return this.createNode(ASTNodeType.DecoratorExpression, args, {
      name,
    }, startTok);
  }

  // ─── Infix / Postfix Parsing ──────────────────────────────────────────

  private getInfixBindingPower(tok: Token): [number, number] | null {
    const { type, value } = tok;

    // Assignment (right-associative)
    if (type === TokenType.Assignment && ASSIGNMENT_OPS.has(value)) {
      return [BP.ASSIGNMENT, BP.ASSIGNMENT - 1];
    }

    // Also treat = as assignment in some contexts
    if (type === TokenType.Operator && value === '=' && !this.checkAhead(-1, TokenType.Operator, '=')) {
      return [BP.ASSIGNMENT, BP.ASSIGNMENT - 1];
    }

    // Ternary ? :
    if (type === TokenType.Operator && value === '?') {
      return [BP.TERNARY, BP.TERNARY - 1];
    }

    // Logical OR
    if (type === TokenType.Operator && value === '||') {
      return [BP.LOGICAL_OR, BP.LOGICAL_OR];
    }
    if (this.language === 'python' && type === TokenType.Keyword && value === 'or') {
      return [BP.LOGICAL_OR, BP.LOGICAL_OR];
    }

    // Logical AND
    if (type === TokenType.Operator && value === '&&') {
      return [BP.LOGICAL_AND, BP.LOGICAL_AND];
    }
    if (this.language === 'python' && type === TokenType.Keyword && value === 'and') {
      return [BP.LOGICAL_AND, BP.LOGICAL_AND];
    }

    // Bitwise OR
    if (type === TokenType.Operator && value === '|') {
      return [BP.BITWISE_OR, BP.BITWISE_OR];
    }

    // Bitwise XOR
    if (type === TokenType.Operator && value === '^') {
      return [BP.BITWISE_XOR, BP.BITWISE_XOR];
    }

    // Bitwise AND
    if (type === TokenType.Operator && value === '&') {
      return [BP.BITWISE_AND, BP.BITWISE_AND];
    }

    // Equality
    if (type === TokenType.Operator && (value === '==' || value === '!=')) {
      return [BP.EQUALITY, BP.EQUALITY];
    }
    if (this.language === 'python' && type === TokenType.Keyword && value === 'is') {
      return [BP.EQUALITY, BP.EQUALITY];
    }

    // Relational
    if (type === TokenType.Operator && (value === '<' || value === '>' || value === '<=' || value === '>=')) {
      return [BP.RELATIONAL, BP.RELATIONAL];
    }
    if (this.language === 'python' && type === TokenType.Keyword && value === 'in') {
      return [BP.IN, BP.IN];
    }
    if (type === TokenType.Keyword && value === 'instanceof') {
      return [BP.INSTANCEOF, BP.INSTANCEOF];
    }

    // Shift
    if (type === TokenType.Operator && (value === '<<' || value === '>>' || value === '>>>')) {
      return [BP.SHIFT, BP.SHIFT];
    }

    // Additive
    if (type === TokenType.Operator && (value === '+' || value === '-')) {
      return [BP.ADDITIVE, BP.ADDITIVE];
    }

    // Multiplicative
    if (type === TokenType.Operator && (value === '*' || value === '/' || value === '%')) {
      return [BP.MULTIPLICATIVE, BP.MULTIPLICATIVE];
    }

    // Floor division (Python)
    if (type === TokenType.Operator && value === '//') {
      return [BP.FLOOR_DIV, BP.FLOOR_DIV];
    }

    // Exponentiation (right-associative)
    if (type === TokenType.Operator && value === '**') {
      return [BP.EXPONENTIATION, BP.EXPONENTIATION - 1];
    }

    // Comma
    if (type === TokenType.Comma) {
      return [BP.COMMA, BP.COMMA];
    }

    // Colon is NOT an infix operator — it terminates expression parsing
    // so that constructs like `if cond:` and `def foo():` work correctly.
    // Colons inside slices and ternary are handled by their respective
    // parsing functions (parseSliceExpression, parseInfix for ? :).
    if (type === TokenType.Colon) {
      return null;
    }

    // Postfix: function call (
    if (type === TokenType.LeftParen) {
      return [BP.CALL, BP.CALL];
    }

    // Postfix: index [
    if (type === TokenType.LeftBracket) {
      return [BP.CALL, BP.CALL];
    }

    // Postfix: member access .
    if (type === TokenType.Dot) {
      return [BP.MEMBER, BP.MEMBER];
    }

    // Postfix: arrow access ->
    if (type === TokenType.Arrow) {
      return [BP.MEMBER, BP.MEMBER];
    }

    // Postfix: ++ / --
    if (type === TokenType.Operator && (value === '++' || value === '--')) {
      return [BP.POSTFIX, BP.POSTFIX];
    }

    // Fat arrow => (JavaScript arrow function)
    if (type === TokenType.FatArrow) {
      return [BP.ASSIGNMENT, BP.ASSIGNMENT - 1];
    }

    return null;
  }

  private parseInfix(left: ASTNode, bp: [number, number], startTok: Token): ASTNode {
    const tok = this.peek();
    const { type, value } = tok;

    // Assignment
    if (type === TokenType.Assignment && ASSIGNMENT_OPS.has(value)) {
      this.advance();
      const right = this.parseExpression(bp[1]);
      return this.createNode(ASTNodeType.AssignmentExpression, [left, right], {
        operator: value,
      }, startTok);
    }

    // Operator = as assignment (context-dependent)
    if (type === TokenType.Operator && value === '=') {
      this.advance();
      const right = this.parseExpression(bp[1]);
      return this.createNode(ASTNodeType.AssignmentExpression, [left, right], {
        operator: '=',
      }, startTok);
    }

    // Ternary conditional ? :
    if (type === TokenType.Operator && value === '?') {
      this.advance();
      const consequent = this.parseExpression(BP.NONE);
      this.expect(TokenType.Colon);
      const alternate = this.parseExpression(bp[1]);
      return this.createNode(ASTNodeType.ConditionalExpression, [left, consequent, alternate], {
        operator: '?:',
      }, startTok);
    }

    // Binary operators
    if (this.isBinaryOperator(tok)) {
      this.advance();
      const right = this.parseExpression(bp[1]);
      return this.createNode(ASTNodeType.BinaryExpression, [left, right], {
        operator: value,
      }, startTok);
    }

    // Function call
    if (type === TokenType.LeftParen) {
      return this.parseCallExpression(left, startTok);
    }

    // Index access
    if (type === TokenType.LeftBracket) {
      return this.parseIndexExpression(left, startTok);
    }

    // Member access (dot)
    if (type === TokenType.Dot) {
      this.advance();
      const member = this.expect(TokenType.Identifier);
      const memberNode = this.createNode(ASTNodeType.Identifier, [], {
        name: member.value,
      }, member, member);
      return this.createNode(ASTNodeType.MemberExpression, [left, memberNode], {
        computed: false,
        optional: false,
      }, startTok);
    }

    // Arrow access (->)
    if (type === TokenType.Arrow) {
      this.advance();
      const member = this.expect(TokenType.Identifier);
      const memberNode = this.createNode(ASTNodeType.Identifier, [], {
        name: member.value,
      }, member, member);
      return this.createNode(ASTNodeType.PointerExpression, [left, memberNode], {
        operator: '->',
      }, startTok);
    }

    // Optional chaining ?.
    if (type === TokenType.Operator && value === '?.') {
      this.advance();
      const member = this.expect(TokenType.Identifier);
      const memberNode = this.createNode(ASTNodeType.Identifier, [], {
        name: member.value,
      }, member, member);
      return this.createNode(ASTNodeType.MemberExpression, [left, memberNode], {
        computed: false,
        optional: true,
      }, startTok);
    }

    // Postfix ++ / --
    if (type === TokenType.Operator && (value === '++' || value === '--')) {
      this.advance();
      return this.createNode(ASTNodeType.UnaryExpression, [left], {
        operator: value,
        prefix: false,
      }, startTok);
    }

    // Fat arrow => (JavaScript arrow function)
    if (type === TokenType.FatArrow) {
      return this.parseArrowFunction(left, startTok);
    }

    // Fallback
    this.addError(`Unexpected infix operator '${value}'`, tok);
    this.advance();
    return left;
  }

  private isBinaryOperator(tok: Token): boolean {
    if (tok.type !== TokenType.Operator && tok.type !== TokenType.Keyword) return false;
    const v = tok.value;
    const binaryOps = ['+', '-', '*', '/', '%', '//', '**', '|', '&', '^',
      '<<', '>>', '>>>', '==', '!=', '<', '>', '<=', '>=',
      '&&', '||'];
    if (binaryOps.includes(v)) return true;
    // Python keyword operators
    if (this.language === 'python' && (v === 'and' || v === 'or' || v === 'in' || v === 'is')) {
      return true;
    }
    if (v === 'instanceof') return true;
    return false;
  }

  private parseCallExpression(callee: ASTNode, startTok: Token): ASTNode {
    this.expect(TokenType.LeftParen);
    const args: ASTNode[] = [];

    while (!this.check(TokenType.RightParen) && !this.isAtEnd()) {
      if (this.check(TokenType.Ellipsis)) {
        this.advance();
        args.push(this.createNode(
          ASTNodeType.SpreadExpression,
          [this.parseExpression(BP.COMMA + 1)],
          {},
        ));
      } else {
        args.push(this.parseExpression(BP.COMMA + 1));
      }
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightParen);
    return this.createNode(ASTNodeType.CallExpression, [callee, ...args], {}, startTok);
  }

  private parseIndexExpression(object: ASTNode, startTok: Token): ASTNode {
    this.expect(TokenType.LeftBracket);
    const index = this.parseExpression();

    // Check for Python slice: [start:stop] or [start:stop:step]
    if (this.language === 'python' && this.check(TokenType.Colon)) {
      return this.parseSliceExpression(object, index, startTok);
    }

    this.expect(TokenType.RightBracket);
    return this.createNode(ASTNodeType.IndexExpression, [object, index], {
      computed: true,
    }, startTok);
  }

  private parseSliceExpression(object: ASTNode, start: ASTNode, startTok: Token): ASTNode {
    let stop: ASTNode | null = null;
    let step: ASTNode | null = null;

    if (this.match(TokenType.Colon)) {
      if (!this.check(TokenType.RightBracket) && !this.check(TokenType.Colon)) {
        stop = this.parseExpression();
      }
      if (this.match(TokenType.Colon)) {
        if (!this.check(TokenType.RightBracket)) {
          step = this.parseExpression();
        }
      }
    }

    this.expect(TokenType.RightBracket);
    const children = [object, start];
    if (stop) children.push(stop);
    if (step) children.push(step);
    return this.createNode(ASTNodeType.SliceExpression, children, {
      hasStop: stop !== null,
      hasStep: step !== null,
    }, startTok);
  }

  private parseArrowFunction(params: ASTNode, startTok: Token): ASTNode {
    this.advance(); // consume '=>'

    // Convert params into parameter nodes
    let paramNodes: ASTNode[];
    if (params.type === ASTNodeType.Identifier) {
      paramNodes = [params];
    } else if (params.type === ASTNodeType.ArrayExpression && params.props.isTuple) {
      paramNodes = params.children ?? [];
    } else {
      paramNodes = [params];
    }

    let body: ASTNode;
    if (this.check(TokenType.LeftBrace)) {
      // Block body
      body = this.parseBlockStatement();
    } else {
      // Expression body
      body = this.parseExpression(BP.COMMA);
    }

    return this.createNode(ASTNodeType.LambdaExpression, [...paramNodes, body], {
      isArrow: true,
      paramCount: paramNodes.length,
    }, startTok);
  }

  // ─── Python Comprehension Parsing ─────────────────────────────────────

  private parseComprehension(firstExpr: ASTNode, startTok: Token, kind: 'list' | 'set' | 'dict' | 'generator'): ASTNode {
    const clauses: ASTNode[] = [firstExpr];

    while (this.check(TokenType.Keyword, 'for') || this.check(TokenType.Keyword, 'if')) {
      if (this.check(TokenType.Keyword, 'for')) {
        this.advance(); // consume 'for'
        const target = this.parseExpression(BP.TERNARY);
        this.expect(TokenType.Keyword, 'in');
        const iter = this.parseExpression(BP.TERNARY);
        clauses.push(this.createNode(ASTNodeType.ForStatement, [target, iter], {
          isComprehension: true,
        }));
      } else if (this.check(TokenType.Keyword, 'if')) {
        this.advance(); // consume 'if'
        const condition = this.parseExpression(BP.TERNARY);
        clauses.push(this.createNode(ASTNodeType.IfStatement, [condition], {
          isComprehension: true,
        }));
      }
    }

    // Close the comprehension
    if (this.check(TokenType.RightBracket)) {
      this.advance();
    } else if (this.check(TokenType.RightParen)) {
      this.advance();
    } else if (this.check(TokenType.RightBrace)) {
      this.advance();
    }

    return this.createNode(ASTNodeType.ComprehensionExpression, clauses, {
      kind,
    }, startTok);
  }

  // ─── Block / Statement Helpers ────────────────────────────────────────

  protected parseBlockStatement(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.LeftBrace);
    const stmts: ASTNode[] = [];

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      const stmt = this.parseCStyleStatement();
      if (stmt) stmts.push(stmt);
    }

    this.expect(TokenType.RightBrace);
    return this.createNode(ASTNodeType.BlockStatement, stmts, {}, startTok);
  }

  // Placeholder — overridden by subclasses
  protected parseCStyleStatement(): ASTNode | null {
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Statistics Computation
  // ═══════════════════════════════════════════════════════════════════════

  protected computeStats(ast: ASTNode | null): ParseStats {
    if (!ast) {
      return { totalNodes: 0, maxDepth: 0, functionCount: 0, classCount: 0, importCount: 0, cyclomaticComplexity: 1 };
    }

    let totalNodes = 0;
    let maxDepth = 0;
    let functionCount = 0;
    let classCount = 0;
    let importCount = 0;
    let branchPoints = 0;

    const walk = (node: ASTNode, depth: number): void => {
      totalNodes++;
      if (depth > maxDepth) maxDepth = depth;

      switch (node.type) {
        case ASTNodeType.FunctionDecl:
        case ASTNodeType.LambdaExpression:
          functionCount++;
          break;
        case ASTNodeType.ClassDecl:
        case ASTNodeType.StructDecl:
        case ASTNodeType.InterfaceDecl:
          classCount++;
          break;
        case ASTNodeType.ImportDecl:
        case ASTNodeType.PreprocessorDirective:
          if (node.props.directive === 'include' || node.type === ASTNodeType.ImportDecl) {
            importCount++;
          }
          break;
        // Branch points for cyclomatic complexity
        case ASTNodeType.IfStatement:
          branchPoints++; // if
          // Each elif/else branch adds 1
          if (node.props.hasElif) branchPoints += (node.props.elifCount as number) ?? 0;
          if (node.props.hasElse) branchPoints++;
          break;
        case ASTNodeType.ForStatement:
        case ASTNodeType.WhileStatement:
        case ASTNodeType.DoWhileStatement:
          branchPoints++;
          break;
        case ASTNodeType.SwitchStatement:
          branchPoints += ((node.props.caseCount as number) ?? 1);
          break;
        case ASTNodeType.TryCatchStatement:
          branchPoints += ((node.props.catchCount as number) ?? 1);
          break;
        case ASTNodeType.ConditionalExpression:
          branchPoints++;
          break;
        case ASTNodeType.BinaryExpression:
          if (node.props.operator === '&&' || node.props.operator === '||' ||
              node.props.operator === 'and' || node.props.operator === 'or') {
            branchPoints++;
          }
          break;
        case ASTNodeType.WithStatement:
          branchPoints++;
          break;
      }

      if (node.children) {
        for (const child of node.children) {
          walk(child, depth + 1);
        }
      }
    };

    walk(ast, 0);

    return {
      totalNodes,
      maxDepth,
      functionCount,
      classCount,
      importCount,
      cyclomaticComplexity: branchPoints + 1,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Python Parser
// ═══════════════════════════════════════════════════════════════════════════

class PythonParser extends BaseParser {
  constructor(tokens: Token[]) {
    super(tokens, 'python');
  }

  parse(): ParseResult {
    const ast = this.parseModule();
    return {
      ast,
      errors: this.errors,
      stats: this.computeStats(ast),
    };
  }

  // ─── Module (Top-Level) ───────────────────────────────────────────────

  private parseModule(): ASTNode {
    const startTok = this.peek();
    const body: ASTNode[] = [];

    this.skipNewlines();

    while (!this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }

    return this.createNode(ASTNodeType.Module, body, {
      language: 'python',
    }, startTok);
  }

  // ─── Statement Dispatch ───────────────────────────────────────────────

  private parseStatement(): ASTNode | null {
    const tok = this.peek();

    // Skip comments
    if (tok.type === TokenType.Comment) {
      this.advance();
      return null;
    }

    // Decorators
    if (tok.type === TokenType.Decorator) {
      return this.parseDecoratedStatement();
    }

    // Keyword-based dispatch
    if (tok.type === TokenType.Keyword) {
      switch (tok.value) {
        case 'def': return this.parseFunctionDef();
        case 'class': return this.parseClassDef();
        case 'if': return this.parseIfStatement();
        case 'for': return this.parseForStatement();
        case 'while': return this.parseWhileStatement();
        case 'try': return this.parseTryStatement();
        case 'with': return this.parseWithStatement();
        case 'import': return this.parseImport();
        case 'from': return this.parseFromImport();
        case 'return': return this.parseReturnStatement();
        case 'raise': return this.parseRaiseStatement();
        case 'global': return this.parseGlobalStatement();
        case 'nonlocal': return this.parseNonlocalStatement();
        case 'assert': return this.parseAssertStatement();
        case 'pass': return this.parsePassStatement();
        case 'break': return this.parseBreakStatement();
        case 'continue': return this.parseContinueStatement();
        case 'del': return this.parseDelStatement();
        case 'yield': {
          const startTok = this.advance();
          let value: ASTNode | null = null;
          if (!this.check(TokenType.Newline) && !this.check(TokenType.Semicolon) && !this.isAtEnd()) {
            value = this.parseExpression(BP.ASSIGNMENT);
          }
          return this.createNode(ASTNodeType.YieldExpression, value ? [value] : [], {}, startTok);
        }
        case 'async': return this.parseAsyncStatement();
        default: break;
      }
    }

    // Expression or assignment statement
    return this.parseExpressionOrAssignment();
  }

  // ─── Decorated Statement ──────────────────────────────────────────────

  private parseDecoratedStatement(): ASTNode {
    const decorators: ASTNode[] = [];

    while (this.check(TokenType.Decorator)) {
      decorators.push(this.parseDecoratorExpression());
      this.skipNewlines();
    }

    const stmt = this.parseStatement();
    if (stmt) {
      stmt.children = [...decorators, ...(stmt.children ?? [])];
      stmt.props.decorators = decorators.map(d => d.props.name);
    }

    return stmt ?? this.createNode(ASTNodeType.EmptyStatement, decorators, {}, this.peek());
  }

  // ─── Function Definition ──────────────────────────────────────────────

  private parseFunctionDef(): ASTNode {
    const startTok = this.peek();
    const isAsync = this.check(TokenType.Keyword, 'async');
    if (isAsync) this.advance();

    this.expect(TokenType.Keyword, 'def');
    const nameTok = this.expect(TokenType.Identifier);
    this.expect(TokenType.LeftParen);

    const params = this.parseParameterList();
    this.expect(TokenType.RightParen);

    let returnType: string | undefined;
    // Python 3 return type annotation: def foo() -> int:
    if (this.match(TokenType.Arrow)) {
      const typeExpr = this.parseExpression();
      returnType = this.typeExprToString(typeExpr);
    }

    // Expect the colon starting the function body
    this.expect(TokenType.Colon);

    this.skipNewlines();
    const body = this.parseBlock();

    return this.createNode(ASTNodeType.FunctionDecl, [...params, body], {
      name: nameTok.value,
      returnType,
      isAsync,
      paramCount: params.length,
      language: 'python',
    }, startTok);
  }

  // ─── Class Definition ─────────────────────────────────────────────────

  private parseClassDef(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'class');
    const nameTok = this.expect(TokenType.Identifier);

    let bases: ASTNode[] = [];
    if (this.match(TokenType.LeftParen)) {
      bases = this.parseArgumentList();
      this.expect(TokenType.RightParen);
    }

    this.expect(TokenType.Colon);
    this.skipNewlines();
    const body = this.parseBlock();

    return this.createNode(ASTNodeType.ClassDecl, [...bases, body], {
      name: nameTok.value,
      baseCount: bases.length,
      language: 'python',
    }, startTok);
  }

  // ─── If / Elif / Else ─────────────────────────────────────────────────

  private parseIfStatement(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'if');
    const condition = this.parseExpression();
    this.expect(TokenType.Colon);
    this.skipNewlines();
    const body = this.parseBlock();

    const children: ASTNode[] = [condition, body];
    let elifCount = 0;
    let hasElse = false;

    this.skipNewlines();

    // elif clauses
    while (this.check(TokenType.Keyword, 'elif')) {
      elifCount++;
      const elifTok = this.advance();
      const elifCond = this.parseExpression();
      this.expect(TokenType.Colon);
      this.skipNewlines();
      const elifBody = this.parseBlock();
      children.push(
        this.createNode(ASTNodeType.IfStatement, [elifCond, elifBody], {
          isElif: true,
        }, elifTok),
      );
      this.skipNewlines();
    }

    // else clause
    if (this.check(TokenType.Keyword, 'else')) {
      hasElse = true;
      this.advance();
      this.expect(TokenType.Colon);
      this.skipNewlines();
      const elseBody = this.parseBlock();
      children.push(elseBody);
    }

    return this.createNode(ASTNodeType.IfStatement, children, {
      hasElif: elifCount > 0,
      elifCount,
      hasElse,
    }, startTok);
  }

  // ─── For Statement ────────────────────────────────────────────────────

  private parseForStatement(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'for');
    const target = this.parseExpression();
    this.expect(TokenType.Keyword, 'in');
    const iter = this.parseExpression();
    this.expect(TokenType.Colon);
    this.skipNewlines();
    const body = this.parseBlock();

    let elseBody: ASTNode | null = null;
    this.skipNewlines();
    if (this.check(TokenType.Keyword, 'else')) {
      this.advance();
      this.expect(TokenType.Colon);
      this.skipNewlines();
      elseBody = this.parseBlock();
    }

    const children = [target, iter, body];
    if (elseBody) children.push(elseBody);

    return this.createNode(ASTNodeType.ForStatement, children, {
      hasElse: elseBody !== null,
      language: 'python',
    }, startTok);
  }

  // ─── While Statement ──────────────────────────────────────────────────

  private parseWhileStatement(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'while');
    const condition = this.parseExpression();
    this.expect(TokenType.Colon);
    this.skipNewlines();
    const body = this.parseBlock();

    let elseBody: ASTNode | null = null;
    this.skipNewlines();
    if (this.check(TokenType.Keyword, 'else')) {
      this.advance();
      this.expect(TokenType.Colon);
      this.skipNewlines();
      elseBody = this.parseBlock();
    }

    const children = [condition, body];
    if (elseBody) children.push(elseBody);

    return this.createNode(ASTNodeType.WhileStatement, children, {
      hasElse: elseBody !== null,
      language: 'python',
    }, startTok);
  }

  // ─── Try / Except / Finally ───────────────────────────────────────────

  private parseTryStatement(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'try');
    this.expect(TokenType.Colon);
    this.skipNewlines();
    const body = this.parseBlock();

    const handlers: ASTNode[] = [body];
    let catchCount = 0;
    let hasFinally = false;

    this.skipNewlines();

    // except clauses
    while (this.check(TokenType.Keyword, 'except')) {
      catchCount++;
      this.advance();

      let exceptionType: ASTNode | null = null;
      let exceptionName: string | undefined;

      if (!this.check(TokenType.Colon)) {
        exceptionType = this.parseExpression();
        if (this.match(TokenType.Keyword, 'as')) {
          const nameTok = this.expect(TokenType.Identifier);
          exceptionName = nameTok.value;
        }
      }

      this.expect(TokenType.Colon);
      this.skipNewlines();
      const handlerBody = this.parseBlock();

      const handlerChildren: ASTNode[] = [];
      if (exceptionType) handlerChildren.push(exceptionType);
      handlerChildren.push(handlerBody);

      handlers.push(this.createNode(ASTNodeType.BlockStatement, handlerChildren, {
        isCatch: true,
        exceptionName,
      }));
      this.skipNewlines();
    }

    // finally clause
    if (this.check(TokenType.Keyword, 'finally')) {
      hasFinally = true;
      this.advance();
      this.expect(TokenType.Colon);
      this.skipNewlines();
      handlers.push(this.parseBlock());
    }

    return this.createNode(ASTNodeType.TryCatchStatement, handlers, {
      catchCount,
      hasFinally,
      language: 'python',
    }, startTok);
  }

  // ─── With Statement ───────────────────────────────────────────────────

  private parseWithStatement(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'with');

    const items: ASTNode[] = [];
    do {
      const expr = this.parseExpression();
      let alias: ASTNode | null = null;
      if (this.match(TokenType.Keyword, 'as')) {
        alias = this.parseExpression();
      }
      items.push(this.createNode(ASTNodeType.Identifier, alias ? [expr, alias] : [expr], {
        kind: 'withItem',
      }));
    } while (this.match(TokenType.Comma));

    this.expect(TokenType.Colon);
    this.skipNewlines();
    const body = this.parseBlock();

    return this.createNode(ASTNodeType.WithStatement, [...items, body], {
      itemCount: items.length,
    }, startTok);
  }

  // ─── Import Statements ────────────────────────────────────────────────

  private parseImport(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'import');

    const modules: ASTNode[] = [];
    do {
      const mod = this.parseDottedName();
      if (this.match(TokenType.Keyword, 'as')) {
        const alias = this.expect(TokenType.Identifier);
        modules.push(this.createNode(ASTNodeType.Identifier, [mod], {
          name: mod.props.name,
          alias: alias.value,
          kind: 'importItem',
        }));
      } else {
        modules.push(mod);
      }
    } while (this.match(TokenType.Comma));

    return this.createNode(ASTNodeType.ImportDecl, modules, {
      importKind: 'import',
      moduleCount: modules.length,
    }, startTok);
  }

  private parseFromImport(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'from');
    const mod = this.parseDottedName();
    this.expect(TokenType.Keyword, 'import');

    const names: ASTNode[] = [mod];
    const isStar = this.match(TokenType.Operator, '*');

    if (isStar) {
      names.push(this.createNode(ASTNodeType.Identifier, [], {
        name: '*',
        kind: 'starImport',
      }));
    } else if (this.match(TokenType.LeftParen)) {
      // from x import (a, b, c)
      do {
        const name = this.expect(TokenType.Identifier);
        let alias: string | undefined;
        if (this.match(TokenType.Keyword, 'as')) {
          alias = this.expect(TokenType.Identifier).value;
        }
        names.push(this.createNode(ASTNodeType.Identifier, [], {
          name: name.value,
          alias,
          kind: 'importItem',
        }));
      } while (this.match(TokenType.Comma));
      this.expect(TokenType.RightParen);
    } else {
      do {
        const name = this.expect(TokenType.Identifier);
        let alias: string | undefined;
        if (this.match(TokenType.Keyword, 'as')) {
          alias = this.expect(TokenType.Identifier).value;
        }
        names.push(this.createNode(ASTNodeType.Identifier, [], {
          name: name.value,
          alias,
          kind: 'importItem',
        }));
      } while (this.match(TokenType.Comma));
    }

    return this.createNode(ASTNodeType.ImportDecl, names, {
      importKind: 'from',
      module: mod.props.name,
      isStar,
    }, startTok);
  }

  private parseDottedName(): ASTNode {
    const startTok = this.peek();
    const parts: string[] = [];
    parts.push(this.expect(TokenType.Identifier).value);

    while (this.match(TokenType.Dot)) {
      parts.push(this.expect(TokenType.Identifier).value);
    }

    return this.createNode(ASTNodeType.Identifier, [], {
      name: parts.join('.'),
      kind: 'dottedName',
    }, startTok);
  }

  // ─── Simple Statements ────────────────────────────────────────────────

  private parseReturnStatement(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'return'

    let value: ASTNode | null = null;
    if (!this.check(TokenType.Newline) && !this.check(TokenType.Semicolon) && !this.isAtEnd()) {
      value = this.parseExpression();
    }

    return this.createNode(ASTNodeType.ReturnStatement, value ? [value] : [], {}, startTok);
  }

  private parseRaiseStatement(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'raise'

    let value: ASTNode | null = null;
    if (!this.check(TokenType.Newline) && !this.check(TokenType.Semicolon) && !this.isAtEnd()) {
      if (this.check(TokenType.Keyword, 'from')) {
        this.advance();
        value = this.parseExpression();
        return this.createNode(ASTNodeType.ThrowStatement, [value], {
          isRaiseFrom: true,
        }, startTok);
      }
      value = this.parseExpression();
    }

    return this.createNode(ASTNodeType.ThrowStatement, value ? [value] : [], {}, startTok);
  }

  private parseGlobalStatement(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'global'

    const names: ASTNode[] = [];
    do {
      const nameTok = this.expect(TokenType.Identifier);
      names.push(this.createNode(ASTNodeType.Identifier, [], {
        name: nameTok.value,
      }, nameTok, nameTok));
    } while (this.match(TokenType.Comma));

    return this.createNode(ASTNodeType.GlobalStatement, names, {}, startTok);
  }

  private parseNonlocalStatement(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'nonlocal'

    const names: ASTNode[] = [];
    do {
      const nameTok = this.expect(TokenType.Identifier);
      names.push(this.createNode(ASTNodeType.Identifier, [], {
        name: nameTok.value,
      }, nameTok, nameTok));
    } while (this.match(TokenType.Comma));

    return this.createNode(ASTNodeType.NonlocalStatement, names, {}, startTok);
  }

  private parseAssertStatement(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'assert'
    const condition = this.parseExpression();
    let message: ASTNode | null = null;
    if (this.match(TokenType.Comma)) {
      message = this.parseExpression();
    }
    return this.createNode(ASTNodeType.AssertStatement, message ? [condition, message] : [condition], {}, startTok);
  }

  private parsePassStatement(): ASTNode {
    const startTok = this.peek();
    this.advance();
    return this.createNode(ASTNodeType.EmptyStatement, [], {
      isPass: true,
    }, startTok, startTok);
  }

  private parseBreakStatement(): ASTNode {
    const startTok = this.peek();
    this.advance();
    return this.createNode(ASTNodeType.BreakStatement, [], {}, startTok, startTok);
  }

  private parseContinueStatement(): ASTNode {
    const startTok = this.peek();
    this.advance();
    return this.createNode(ASTNodeType.ContinueStatement, [], {}, startTok, startTok);
  }

  private parseDelStatement(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'del'
    const targets: ASTNode[] = [];
    do {
      targets.push(this.parseExpression());
    } while (this.match(TokenType.Comma));
    return this.createNode(ASTNodeType.UnaryExpression, targets, {
      operator: 'del',
      prefix: true,
    }, startTok);
  }

  private parseAsyncStatement(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'async'

    if (this.check(TokenType.Keyword, 'def')) {
      return this.parseFunctionDef(); // Will handle async flag
    }
    if (this.check(TokenType.Keyword, 'with')) {
      const withStmt = this.parseWithStatement();
      withStmt.props.isAsync = true;
      return withStmt;
    }
    if (this.check(TokenType.Keyword, 'for')) {
      const forStmt = this.parseForStatement();
      forStmt.props.isAsync = true;
      return forStmt;
    }

    // Fallback: parse as expression with 'async' prefix
    const expr = this.parseExpression();
    return this.createNode(ASTNodeType.ExpressionStatement, [expr], {
      isAsync: true,
    }, startTok);
  }

  // ─── Expression or Assignment ─────────────────────────────────────────

  private parseExpressionOrAssignment(): ASTNode {
    const startTok = this.peek();
    const expr = this.parseExpression();

    // Check for assignment
    if (this.check(TokenType.Assignment) || (this.check(TokenType.Operator) && this.peek().value === '=')) {
      const opTok = this.advance();
      const op = opTok.value;

      // Multiple assignment: a = b = 5
      const right = this.parseExpression();
      return this.createNode(ASTNodeType.AssignmentExpression, [expr, right], {
        operator: op,
        isStatement: true,
      }, startTok);
    }

    // Check for augmented assignment
    if (this.check(TokenType.Colon)) {
      // Annotated assignment: x: int = 5
      this.advance();
      const typeAnnotation = this.parseExpression();

      if (this.check(TokenType.Assignment)) {
        this.advance();
        const value = this.parseExpression();
        return this.createNode(ASTNodeType.VariableDecl, [expr, typeAnnotation, value], {
          isAnnotated: true,
          language: 'python',
        }, startTok);
      }

      return this.createNode(ASTNodeType.VariableDecl, [expr, typeAnnotation], {
        isAnnotated: true,
        hasValue: false,
        language: 'python',
      }, startTok);
    }

    return this.createNode(ASTNodeType.ExpressionStatement, [expr], {}, startTok);
  }

  // ─── Python Block (Indentation-Based) ─────────────────────────────────

  private parseBlock(): ASTNode {
    const startTok = this.peek();
    const stmts: ASTNode[] = [];

    if (this.match(TokenType.Indent)) {
      while (!this.check(TokenType.Dedent) && !this.isAtEnd()) {
        this.skipNewlines();
        if (this.check(TokenType.Dedent) || this.isAtEnd()) break;
        const stmt = this.parseStatement();
        if (stmt) stmts.push(stmt);
        this.skipNewlines();
      }
      this.match(TokenType.Dedent);
    } else {
      // Single-line block: statement on same line as colon
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }

    return this.createNode(ASTNodeType.BlockStatement, stmts, {}, startTok);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private parseParameterList(): ASTNode[] {
    const params: ASTNode[] = [];

    while (!this.check(TokenType.RightParen) && !this.isAtEnd()) {
      const param = this.parseParameter();
      params.push(param);
      if (!this.match(TokenType.Comma)) break;
    }

    return params;
  }

  private parseParameter(): ASTNode {
    const startTok = this.peek();

    // *args or **kwargs
    if (this.check(TokenType.Operator, '*')) {
      this.advance();
      if (this.check(TokenType.Identifier)) {
        const nameTok = this.advance();
        let typeAnnotation: ASTNode | null = null;
        if (this.match(TokenType.Colon)) {
          typeAnnotation = this.parseExpression();
        }
        return this.createNode(ASTNodeType.Identifier, typeAnnotation ? [typeAnnotation] : [], {
          name: nameTok.value,
          kind: 'starParam',
        }, startTok);
      }
      // Bare * — keyword-only separator
      return this.createNode(ASTNodeType.Identifier, [], {
        name: '*',
        kind: 'keywordOnlySeparator',
      }, startTok, startTok);
    }

    if (this.check(TokenType.Operator, '**')) {
      this.advance();
      const nameTok = this.expect(TokenType.Identifier);
      return this.createNode(ASTNodeType.Identifier, [], {
        name: nameTok.value,
        kind: 'doubleStarParam',
      }, startTok);
    }

    // Regular parameter
    const nameTok = this.expect(TokenType.Identifier);
    let typeAnnotation: ASTNode | null = null;
    let defaultValue: ASTNode | null = null;

    if (this.match(TokenType.Colon)) {
      typeAnnotation = this.parseExpression();
    }

    if (this.match(TokenType.Assignment, '=') || this.match(TokenType.Operator, '=')) {
      defaultValue = this.parseExpression();
    }

    const children: ASTNode[] = [];
    if (typeAnnotation) children.push(typeAnnotation);
    if (defaultValue) children.push(defaultValue);

    return this.createNode(ASTNodeType.Identifier, children, {
      name: nameTok.value,
      kind: 'param',
      hasType: typeAnnotation !== null,
      hasDefault: defaultValue !== null,
    }, startTok);
  }

  private parseArgumentList(): ASTNode[] {
    const args: ASTNode[] = [];
    while (!this.check(TokenType.RightParen) && !this.check(TokenType.Colon) && !this.isAtEnd()) {
      const expr = this.parseExpression(BP.COMMA + 1);
      args.push(expr);
      if (!this.match(TokenType.Comma)) break;
    }
    return args;
  }

  private skipNewlines(): void {
    while (this.check(TokenType.Newline) || this.check(TokenType.Comment)) {
      this.advance();
    }
  }

  private typeExprToString(node: ASTNode): string {
    if (node.type === ASTNodeType.Identifier) {
      return (node.props.name as string) ?? 'unknown';
    }
    if (node.type === ASTNodeType.MemberExpression && node.children) {
      const parts = node.children.map(c => this.typeExprToString(c));
      return parts.join('.');
    }
    return 'unknown';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// C-Style Parser (C, C++, Java, JavaScript)
// ═══════════════════════════════════════════════════════════════════════════

class CStyleParser extends BaseParser {
  private lang: 'c' | 'cpp' | 'java' | 'javascript';
  /** Recursion depth guard for parseDeclaration → parseStatement → parseDeclaration */
  private declarationRecursionDepth = 0;

  constructor(tokens: Token[], language: SupportedLanguage) {
    super(tokens, language);
    this.lang = language as 'c' | 'cpp' | 'java' | 'javascript';
  }

  parse(): ParseResult {
    this.parseStartTime = Date.now();
    // Extract source lines for debug context (from original token positions)
    if (this.debugMode) {
      const sourceText = this.tokens.map(t => t.value).join(' ');
      this.sourceLines = sourceText.split('\n');
    }
    const ast = this.parseTranslationUnit();
    return {
      ast,
      errors: this.errors,
      stats: this.computeStats(ast),
    };
  }

  // ─── Translation Unit (Top-Level) ─────────────────────────────────────

  private parseTranslationUnit(): ASTNode {
    this.enterRule('translation_unit');
    const startTok = this.peek();
    const body: ASTNode[] = [];

    while (!this.isAtEnd()) {
      const decl = this.parseTopLevelDeclaration();
      if (decl) body.push(decl);
    }

    const result = this.createNode(ASTNodeType.Program, body, {
      language: this.lang,
    }, startTok);
    this.exitRule('translation_unit');
    return result;
  }

  // ─── Top-Level Declaration Dispatch ───────────────────────────────────

  private parseTopLevelDeclaration(): ASTNode | null {
    const tok = this.peek();

    // Skip semicolons
    if (this.match(TokenType.Semicolon)) {
      return this.createNode(ASTNodeType.EmptyStatement, [], {}, tok, tok);
    }

    // Comments
    if (tok.type === TokenType.Comment) {
      this.advance();
      return null;
    }

    // Preprocessor directive (C/C++)
    if (tok.type === TokenType.Preprocessor) {
      return this.parsePreprocessorDirective();
    }

    // Namespace (C++)
    if (this.lang === 'cpp' && this.checkKeyword('namespace')) {
      return this.parseNamespace();
    }

    // Using directive (C++)
    if (this.lang === 'cpp' && this.checkKeyword('using')) {
      return this.parseUsingDirective();
    }

    // Package declaration (Java)
    if (this.lang === 'java' && this.checkKeyword('package')) {
      return this.parsePackageDeclaration();
    }

    // Import (Java)
    if (this.lang === 'java' && this.checkKeyword('import')) {
      return this.parseJavaImport();
    }

    // Import/include (JavaScript)
    if (this.lang === 'javascript' && this.checkKeyword('import')) {
      return this.parseJSImport();
    }

    return this.parseDeclaration();
  }

  // ─── Declaration Parsing ──────────────────────────────────────────────

  private parseDeclaration(): ASTNode | null {
    this.enterRule('declaration', ['type', 'identifier', 'modifier']);
    const tok = this.peek();

    // ── Recursion guard ─────────────────────────────────────────────────
    // If we're at the same position as when we entered parseDeclaration
    // before, we're in an infinite loop. Break out by parsing as expression.
    if (this.declarationRecursionDepth > 3) {
      // Prevent infinite recursion: parse as expression statement
      const expr = this.parseExpression();
      this.match(TokenType.Semicolon);
      return this.createNode(ASTNodeType.ExpressionStatement, [expr], {
        isFallback: true,
      }, tok);
    }
    this.declarationRecursionDepth++;
    try {

    // Template declaration (C++)
    if (this.lang === 'cpp' && this.checkKeyword('template')) {
      return this.parseTemplateDeclaration();
    }

    // Collect modifiers and type
    const modifiers: string[] = [];
    const startTok = this.peek();

    // Parse modifiers
    while (this.isModifierStart()) {
      modifiers.push(this.advance().value);
    }

    // Struct / class / enum / interface TYPE DECLARATION
    // But ONLY if it's actually a type definition (has name + {)
    // Otherwise it might be a variable declaration like "struct Point p;"
    if (this.checkKeyword('class') || this.checkKeyword('struct') ||
        this.checkKeyword('enum') || this.checkKeyword('interface')) {
      // Disambiguate: is this a type declaration or a variable using a struct/enum type?
      // Type declaration: struct Name { ... } or struct { ... }
      // Variable declaration: struct Name variable;
      const lookAhead1 = this.peekAhead(1);
      const lookAhead2 = this.peekAhead(2);

      // If next is '{' → anonymous type declaration: struct { int x; } var;
      if (lookAhead1.type === TokenType.LeftBrace) {
        return this.parseTypeDeclaration(modifiers, startTok);
      }
      // If next is identifier and then '{' → named type declaration: struct Point { ... }
      if (lookAhead1.type === TokenType.Identifier && lookAhead2.type === TokenType.LeftBrace) {
        return this.parseTypeDeclaration(modifiers, startTok);
      }
      // If next is identifier and then ':' (inheritance) → type declaration
      if (lookAhead1.type === TokenType.Identifier && lookAhead2.type === TokenType.Colon) {
        return this.parseTypeDeclaration(modifiers, startTok);
      }
      // Otherwise: it's a variable declaration using struct/enum/class type
      // e.g., "struct Point p;" → fall through to tryParseType()
    }

    // Function or variable declaration — use speculative parsing with backtrack
    const savedPos = this.pos;
    const typeResult = this.tryParseType();
    if (typeResult) {
      const nameTok = this.peek();
      if (nameTok.type === TokenType.Identifier || this.isTypeKeyword(nameTok.value)) {
        const name = this.advance().value;

        // Function declaration/definition
        if (this.check(TokenType.LeftParen)) {
          return this.parseFunctionDeclaration(name, typeResult, modifiers, startTok);
        }

        // Variable declaration
        return this.parseVariableDeclaration(name, typeResult, modifiers, startTok);
      }
      // Not a declaration — backtrack
      this.pos = savedPos;
    }

    // JavaScript-specific: let/const/var declarations
    if (this.lang === 'javascript' && JS_DECL_KEYWORDS.has(tok.value)) {
      return this.parseJSVariableDeclaration();
    }

    // JavaScript: function declaration
    if (this.lang === 'javascript' && this.checkKeyword('function')) {
      return this.parseJSFunctionDeclaration(modifiers);
    }

    // JavaScript: export
    if (this.lang === 'javascript' && this.checkKeyword('export')) {
      return this.parseJSExport();
    }

    // Fallback: try parsing as statement
    return this.parseStatement();
    } finally {
      this.declarationRecursionDepth--;
    }
  }

  // ─── Type Parsing ─────────────────────────────────────────────────────

  private isModifierStart(): boolean {
    const tok = this.peek();
    if (tok.type !== TokenType.Keyword) return false;

    if (this.lang === 'c' || this.lang === 'cpp') {
      return C_CPP_MODIFIERS.has(tok.value);
    }
    if (this.lang === 'java') {
      return JAVA_MODIFIERS.has(tok.value);
    }
    // JavaScript: async, export, default
    return JS_MODIFIERS.has(tok.value) || tok.value === 'static' || tok.value === 'async';
  }

  private isTypeKeyword(value: string): boolean {
    if (this.lang === 'c' || this.lang === 'cpp') {
      return C_CPP_TYPE_KEYWORDS.has(value);
    }
    if (this.lang === 'java') {
      return JAVA_TYPE_KEYWORDS.has(value);
    }
    return false;
  }

  private tryParseType(): { typeStr: string; typeNode: ASTNode } | null {
    const startTok = this.peek();

    // ── Compound type names: struct Type, enum Type, class Type ──────────
    // In C/C++, "struct Point", "enum Color", "class Foo" are valid type
    // specifiers and must be parsed as a single type unit.
    if ((this.lang === 'c' || this.lang === 'cpp') &&
        this.peek().type === TokenType.Keyword &&
        (this.peek().value === 'struct' || this.peek().value === 'enum' || this.peek().value === 'class')) {
      const savedPos = this.pos;
      const qualifier = this.advance().value; // struct / enum / class
      let typeStr = qualifier;

      // The name after struct/enum/class is optional in some contexts
      // (e.g., struct { int x; } var;) but required in most declarations.
      if (this.check(TokenType.Identifier)) {
        typeStr += ' ' + this.advance().value;
      }

      // Template/generic parameters: <T>
      if (this.check(TokenType.Operator, '<') && this.lang === 'cpp') {
        typeStr += this.parseTemplateArgs();
      }

      // Pointer: *
      while (this.check(TokenType.Operator, '*')) {
        this.advance();
        typeStr += '*';
      }

      // Reference: &
      if (this.lang === 'cpp' && this.check(TokenType.Operator, '&')) {
        if (!this.checkAhead(0, TokenType.Operator, '&&')) {
          this.advance();
          typeStr += '&';
        }
      }

      // Array brackets: []
      while (this.check(TokenType.LeftBracket) && this.checkAhead(1, TokenType.RightBracket)) {
        this.advance(); // [
        this.advance(); // ]
        typeStr += '[]';
      }

      const typeNode = this.createNode(ASTNodeType.Identifier, [], {
        name: typeStr,
        kind: 'type',
      }, startTok);

      return { typeStr, typeNode };
    }

    // ── Simple type names ────────────────────────────────────────────────
    if (this.check(TokenType.Identifier) || this.isTypeKeyword(this.peek().value)) {
      let typeStr = this.advance().value;

      // Template/generic parameters: <T>
      if (this.check(TokenType.Operator, '<') && (this.lang === 'cpp' || this.lang === 'java')) {
        typeStr += this.parseTemplateArgs();
      }

      // Pointer: *
      while (this.check(TokenType.Operator, '*')) {
        this.advance();
        typeStr += '*';
      }

      // Reference: &
      if (this.lang === 'cpp' && this.check(TokenType.Operator, '&')) {
        // Check it's not && (which is a move reference or logical AND)
        if (!this.checkAhead(0, TokenType.Operator, '&&')) {
          this.advance();
          typeStr += '&';
        }
      }

      // Array brackets: []
      while (this.check(TokenType.LeftBracket) && this.checkAhead(1, TokenType.RightBracket)) {
        this.advance(); // [
        this.advance(); // ]
        typeStr += '[]';
      }

      const typeNode = this.createNode(ASTNodeType.Identifier, [], {
        name: typeStr,
        kind: 'type',
      }, startTok);

      return { typeStr, typeNode };
    }

    return null;
  }

  private parseTemplateArgs(): string {
    let result = '';
    this.advance(); // consume <
    let depth = 1;
    result += '<';

    while (depth > 0 && !this.isAtEnd()) {
      const tok = this.advance();
      result += tok.value + ' ';
      if (tok.value === '<') depth++;
      if (tok.value === '>') depth--;
    }

    return result.trim();
  }

  // ─── Type Declarations ────────────────────────────────────────────────

  private parseTypeDeclaration(modifiers: string[], startTok: Token): ASTNode {
    const keyword = this.advance().value; // class, struct, enum, interface

    // Anonymous struct/enum: typedef struct { int x; } Point;
    // If the next token after struct/enum/class is '{', there's no name.
    let nameTok: Token;
    if (this.check(TokenType.LeftBrace)) {
      // Anonymous — create a synthetic empty-name token at the current position
      const currentPeek = this.peek();
      nameTok = { type: TokenType.Identifier, value: '', line: currentPeek.line, col: currentPeek.col };
    } else {
      nameTok = this.expect(TokenType.Identifier);
    }

    // Inheritance / extends / implements
    let supers: ASTNode[] = [];
    if (this.match(TokenType.Colon) || this.match(TokenType.Operator, '<')) {
      // C++ inheritance, Java extends/implements
      do {
        supers.push(this.parseExpression(BP.COMMA + 1));
      } while (this.match(TokenType.Comma));
    }

    // Java: extends/implements after potential type params
    if (this.lang === 'java') {
      if (this.checkKeyword('extends')) {
        this.advance();
        supers.push(this.parseExpression(BP.COMMA + 1));
        while (this.match(TokenType.Comma)) {
          supers.push(this.parseExpression(BP.COMMA + 1));
        }
      }
      if (this.checkKeyword('implements')) {
        this.advance();
        do {
          supers.push(this.parseExpression(BP.COMMA + 1));
        } while (this.match(TokenType.Comma));
      }
    }

    this.expect(TokenType.LeftBrace);
    const members: ASTNode[] = [];

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      const member = this.parseClassMember();
      if (member) members.push(member);
    }

    this.expect(TokenType.RightBrace);
    this.match(TokenType.Semicolon);

    const nodeType = keyword === 'class'
      ? ASTNodeType.ClassDecl
      : keyword === 'struct'
        ? ASTNodeType.StructDecl
        : keyword === 'enum'
          ? ASTNodeType.EnumDecl
          : ASTNodeType.InterfaceDecl;

    return this.createNode(nodeType, [...supers, ...members], {
      name: nameTok.value,
      keyword,
      modifiers,
      isAnonymous: nameTok.value === '',
      memberCount: members.length,
      language: this.lang,
    }, startTok);
  }

  private parseClassMember(): ASTNode | null {
    if (this.match(TokenType.Semicolon)) {
      return this.createNode(ASTNodeType.EmptyStatement, [], {}, this.previous(), this.previous());
    }

    if (this.peek().type === TokenType.Comment) {
      this.advance();
      return null;
    }

    // Access specifier (C++/Java)
    if (this.checkKeyword('public') || this.checkKeyword('private') ||
        this.checkKeyword('protected')) {
      // Check if it's just a label (colon after)
      if (this.checkAhead(1, TokenType.Colon)) {
        const startTok = this.advance();
        this.advance(); // consume ':'
        return this.createNode(ASTNodeType.Identifier, [], {
          name: startTok.value,
          kind: 'accessSpecifier',
        }, startTok, startTok);
      }
    }

    // Enum values
    if (this.peek().type === TokenType.Identifier && !this.isModifierStart()) {
      // Could be enum constant or field/method
      const startTok = this.peek();
      const saved = this.pos;

      const nameTok = this.advance();

      // Enum constant with optional value
      if (this.check(TokenType.LeftParen) || this.check(TokenType.Comma) || this.check(TokenType.RightBrace)) {
        if (this.check(TokenType.LeftParen)) {
          // Enum constant with arguments
          this.pos = saved;
          return this.parseDeclaration();
        }
        // Simple enum constant
        const children: ASTNode[] = [];
        if (this.match(TokenType.Assignment, '=') || this.match(TokenType.Operator, '=')) {
          children.push(this.parseExpression());
        }
        this.match(TokenType.Comma);
        return this.createNode(ASTNodeType.Identifier, children, {
          name: nameTok.value,
          kind: 'enumConstant',
        }, startTok, nameTok);
      }

      this.pos = saved;
    }

    return this.parseDeclaration();
  }

  // ─── Function Declaration ─────────────────────────────────────────────

  private parseFunctionDeclaration(
    name: string,
    typeResult: { typeStr: string; typeNode: ASTNode },
    modifiers: string[],
    startTok: Token,
  ): ASTNode {
    this.enterRule('function_definition', ['(', '{']);
    if (this.check(TokenType.LeftParen)) {
      this.advance(); // consume (
    } else {
      this.addDetailedError(
        `Expected '(' after function name '${name}' in function definition`,
        this.peek(),
        { grammarRule: 'function_definition', expectedTokens: ['('] }
      );
    }
    const params = this.parseCStyleParameterList();
    if (this.check(TokenType.RightParen)) {
      this.advance(); // consume )
    } else {
      this.addDetailedError(
        "Expected ')' after function parameters",
        this.peek(),
        { grammarRule: 'function_definition', expectedTokens: [')'] }
      );
    }

    // Const method (C++)
    if (this.lang === 'cpp' && this.checkKeyword('const')) {
      modifiers.push(this.advance().value);
    }

    let body: ASTNode | null = null;
    let isDefinition = false;

    if (this.check(TokenType.LeftBrace)) {
      isDefinition = true;
      body = this.parseBlockStatement();
    } else if (this.lang === 'javascript' && this.check(TokenType.FatArrow)) {
      isDefinition = true;
      this.advance(); // consume =>
      if (this.check(TokenType.LeftBrace)) {
        body = this.parseBlockStatement();
      } else {
        body = this.parseExpression(BP.COMMA);
      }
    } else {
      this.match(TokenType.Semicolon);
    }

    const children: ASTNode[] = [typeResult.typeNode, ...params];
    if (body) children.push(body);

    const result = this.createNode(ASTNodeType.FunctionDecl, children, {
      name,
      returnType: typeResult.typeStr,
      modifiers,
      paramCount: params.length,
      isDefinition,
      language: this.lang,
    }, startTok);
    this.exitRule('function_definition');
    return result;
  }

  // ─── Variable Declaration ─────────────────────────────────────────────

  private parseVariableDeclaration(
    name: string,
    typeResult: { typeStr: string; typeNode: ASTNode },
    modifiers: string[],
    startTok: Token,
  ): ASTNode {
    this.enterRule('variable_declaration', ['identifier', '=']);
    let initializer: ASTNode | null = null;

    if (this.match(TokenType.Assignment, '=') || this.match(TokenType.Operator, '=')) {
      initializer = this.parseExpression(BP.COMMA + 1);
    }

    // Handle multiple declarators: int a, b, c;
    const declarators: ASTNode[] = [
      this.createNode(ASTNodeType.Identifier, initializer ? [initializer] : [], {
        name,
        kind: 'declarator',
      }),
    ];

    while (this.match(TokenType.Comma)) {
      let declName: Token;
      if (this.check(TokenType.Identifier)) {
        declName = this.advance();
      } else {
        this.addDetailedError(
          'Expected variable name after comma in variable declaration',
          this.peek(),
          { grammarRule: 'variable_declaration', expectedTokens: ['Identifier'] }
        );
        declName = this.peek();
      }
      let declInit: ASTNode | null = null;
      if (this.match(TokenType.Assignment, '=') || this.match(TokenType.Operator, '=')) {
        declInit = this.parseExpression(BP.COMMA + 1);
      }
      declarators.push(this.createNode(ASTNodeType.Identifier, declInit ? [declInit] : [], {
        name: declName.value,
        kind: 'declarator',
      }));
    }

    this.match(TokenType.Semicolon);

    const result = this.createNode(ASTNodeType.VariableDecl, [typeResult.typeNode, ...declarators], {
      name,
      varType: typeResult.typeStr,
      modifiers,
      declaratorCount: declarators.length,
      language: this.lang,
    }, startTok);
    this.exitRule('variable_declaration');
    return result;
  }

  // ─── C-Style Parameter List ───────────────────────────────────────────

  private parseCStyleParameterList(): ASTNode[] {
    const params: ASTNode[] = [];

    while (!this.check(TokenType.RightParen) && !this.isAtEnd()) {
      // Variadic: ...
      if (this.check(TokenType.Ellipsis)) {
        const ellipsisTok = this.advance();
        params.push(this.createNode(ASTNodeType.Identifier, [], {
          name: '...',
          kind: 'variadic',
        }, ellipsisTok, ellipsisTok));
        break;
      }

      const param = this.parseCStyleParameter();
      params.push(param);
      if (!this.match(TokenType.Comma)) break;
    }

    return params;
  }

  private parseCStyleParameter(): ASTNode {
    const startTok = this.peek();

    // Collect modifiers
    const modifiers: string[] = [];
    while (this.isModifierStart()) {
      modifiers.push(this.advance().value);
    }

    // Parse type
    const typeResult = this.tryParseType();
    if (!typeResult) {
      // Could be a nameless parameter type or an error
      if (this.check(TokenType.Identifier)) {
        const name = this.advance().value;
        return this.createNode(ASTNodeType.Identifier, [], {
          name,
          kind: 'param',
          modifiers,
        }, startTok);
      }
      this.addDetailedError('Expected parameter declaration', this.peek(), {
        grammarRule: 'parameter',
        expectedTokens: ['type', 'Identifier', '...'],
      });
      this.advance();
      return this.createNode(ASTNodeType.Identifier, [], {
        name: '<error>',
        kind: 'param',
        error: true,
      }, startTok);
    }

    // Check for parameter name
    let name: string | undefined;
    if (this.check(TokenType.Identifier)) {
      name = this.advance().value;
    }

    // Handle array brackets after parameter name: char *argv[]
    // In C, argv[] means "array of pointers" — the [] modifies the type
    let paramTypeSuffix = '';
    while (this.check(TokenType.LeftBracket)) {
      this.advance(); // consume [
      // Check for size expression inside brackets: int arr[10]
      if (!this.check(TokenType.RightBracket)) {
        this.parseExpression();
      }
      if (this.check(TokenType.RightBracket)) {
        this.advance(); // consume ]
      }
      paramTypeSuffix += '[]';
    }
    const finalParamType = typeResult.typeStr + paramTypeSuffix;

    // Default value (C++/JavaScript)
    let defaultValue: ASTNode | null = null;
    if (this.match(TokenType.Assignment, '=') || this.match(TokenType.Operator, '=')) {
      defaultValue = this.parseExpression(BP.COMMA + 1);
    }

    const children: ASTNode[] = [typeResult.typeNode];
    if (defaultValue) children.push(defaultValue);

    return this.createNode(ASTNodeType.Identifier, children, {
      name: name ?? '',
      kind: 'param',
      paramType: finalParamType,
      modifiers,
      hasDefault: defaultValue !== null,
    }, startTok);
  }

  // ─── Statement Parsing ────────────────────────────────────────────────

  private parseStatement(): ASTNode | null {
    this.enterRule('statement');
    const tok = this.peek();

    // Semicolon
    if (this.match(TokenType.Semicolon)) {
      return this.createNode(ASTNodeType.EmptyStatement, [], {}, tok, tok);
    }

    // Comments
    if (tok.type === TokenType.Comment) {
      this.advance();
      return null;
    }

    // Preprocessor
    if (tok.type === TokenType.Preprocessor) {
      return this.parsePreprocessorDirective();
    }

    // Block
    if (tok.type === TokenType.LeftBrace) {
      return this.parseBlockStatement();
    }

    // Keyword dispatch
    if (tok.type === TokenType.Keyword) {
      switch (tok.value) {
        case 'if': return this.parseIfStatement();
        case 'else': {
          this.addDetailedError("'else' without matching 'if'", tok, {
            grammarRule: 'statement',
            expectedTokens: ['if'],
          });
          this.advance();
          return this.parseStatement();
        }
        case 'for': return this.parseForStatement();
        case 'while': return this.parseWhileStatement();
        case 'do': return this.parseDoWhileStatement();
        case 'switch': return this.parseSwitchStatement();
        case 'case': return this.parseCaseClause();
        case 'default': return this.parseDefaultClause();
        case 'try': return this.parseTryCatchStatement();
        case 'catch': return this.parseCatchClause();
        case 'finally': return this.parseFinallyClause();
        case 'return': return this.parseReturnStatement();
        case 'throw': return this.parseThrowStatement();
        case 'break': return this.parseBreakStatement();
        case 'continue': return this.parseContinueStatement();
        case 'goto': {
          this.advance();
          const label = this.expect(TokenType.Identifier);
          this.match(TokenType.Semicolon);
          return this.createNode(ASTNodeType.Identifier, [], {
            name: label.value,
            kind: 'gotoLabel',
          }, tok);
        }
        case 'class': case 'struct': case 'enum': case 'interface': {
          // Disambiguate: type declaration vs variable using struct/enum type
          // struct Point { ... } → type declaration
          // struct Point p;     → variable declaration (fall through)
          const la1 = this.peekAhead(1);
          const la2 = this.peekAhead(2);
          if (la1.type === TokenType.LeftBrace ||
              (la1.type === TokenType.Identifier && la2.type === TokenType.LeftBrace) ||
              (la1.type === TokenType.Identifier && la2.type === TokenType.Colon)) {
            return this.parseTypeDeclaration([], tok);
          }
          // Otherwise: it's a declaration using struct/enum/class type
          // e.g., "struct Point p;" → fall through to parseDeclarationOrExpression
          break;
        }
        default: break;
      }
    }

    // JavaScript-specific
    if (this.lang === 'javascript') {
      if (JS_DECL_KEYWORDS.has(tok.value)) {
        return this.parseJSVariableDeclaration();
      }
      if (tok.value === 'function') {
        return this.parseJSFunctionDeclaration([]);
      }
      if (tok.value === 'export') {
        return this.parseJSExport();
      }
    }

    // Label: identifier followed by ':'
    if (tok.type === TokenType.Identifier && this.checkAhead(1, TokenType.Colon)) {
      return this.parseLabel();
    }

    // Declaration or expression statement
    const result = this.parseDeclarationOrExpression();
    this.exitRule('statement');
    return result;
  }

  // ─── If / Else ────────────────────────────────────────────────────────

  private parseIfStatement(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'if');
    this.expect(TokenType.LeftParen);
    const condition = this.parseExpression();
    this.expect(TokenType.RightParen);

    const consequent = this.parseStatement() ?? this.createNode(ASTNodeType.EmptyStatement, [], {}, this.peek());

    let alternate: ASTNode | null = null;
    if (this.checkKeyword('else')) {
      this.advance();
      alternate = this.parseStatement();
    }

    const children: ASTNode[] = [condition, consequent];
    if (alternate) children.push(alternate);

    return this.createNode(ASTNodeType.IfStatement, children, {
      hasElse: alternate !== null,
    }, startTok);
  }

  // ─── For Statement ────────────────────────────────────────────────────

  private parseForStatement(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'for');
    this.expect(TokenType.LeftParen);

    // For-in / for-of (JavaScript)
    if (this.lang === 'javascript' && this.checkAhead(1, TokenType.Keyword, 'in')) {
      return this.parseForInStatement(startTok);
    }
    if (this.lang === 'javascript' && this.checkAhead(1, TokenType.Keyword, 'of')) {
      return this.parseForOfStatement(startTok);
    }

    // Init
    let init: ASTNode | null = null;
    if (!this.check(TokenType.Semicolon)) {
      init = this.parseDeclarationOrExpression();
    }
    this.match(TokenType.Semicolon);

    // Condition
    let condition: ASTNode | null = null;
    if (!this.check(TokenType.Semicolon)) {
      condition = this.parseExpression();
    }
    this.match(TokenType.Semicolon);

    // Update
    let update: ASTNode | null = null;
    if (!this.check(TokenType.RightParen)) {
      update = this.parseExpression();
    }
    this.expect(TokenType.RightParen);

    const body = this.parseStatement() ?? this.createNode(ASTNodeType.EmptyStatement, [], {}, this.peek());

    const children: ASTNode[] = [];
    if (init) children.push(init);
    if (condition) children.push(condition);
    if (update) children.push(update);
    children.push(body);

    return this.createNode(ASTNodeType.ForStatement, children, {
      isCStyleFor: true,
    }, startTok);
  }

  private parseForInStatement(startTok: Token): ASTNode {
    const target = this.parseExpression();
    this.expect(TokenType.Keyword, 'in');
    const iter = this.parseExpression();
    this.expect(TokenType.RightParen);
    const body = this.parseStatement() ?? this.createNode(ASTNodeType.EmptyStatement, [], {}, this.peek());
    return this.createNode(ASTNodeType.ForStatement, [target, iter, body], {
      isForIn: true,
    }, startTok);
  }

  private parseForOfStatement(startTok: Token): ASTNode {
    const target = this.parseExpression();
    this.expect(TokenType.Keyword, 'of');
    const iter = this.parseExpression();
    this.expect(TokenType.RightParen);
    const body = this.parseStatement() ?? this.createNode(ASTNodeType.EmptyStatement, [], {}, this.peek());
    return this.createNode(ASTNodeType.ForStatement, [target, iter, body], {
      isForOf: true,
    }, startTok);
  }

  // ─── While Statement ──────────────────────────────────────────────────

  private parseWhileStatement(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'while');
    this.expect(TokenType.LeftParen);
    const condition = this.parseExpression();
    this.expect(TokenType.RightParen);
    const body = this.parseStatement() ?? this.createNode(ASTNodeType.EmptyStatement, [], {}, this.peek());
    return this.createNode(ASTNodeType.WhileStatement, [condition, body], {}, startTok);
  }

  // ─── Do-While Statement ───────────────────────────────────────────────

  private parseDoWhileStatement(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'do');
    const body = this.parseStatement() ?? this.createNode(ASTNodeType.EmptyStatement, [], {}, this.peek());
    this.expect(TokenType.Keyword, 'while');
    this.expect(TokenType.LeftParen);
    const condition = this.parseExpression();
    this.expect(TokenType.RightParen);
    this.match(TokenType.Semicolon);
    return this.createNode(ASTNodeType.DoWhileStatement, [body, condition], {}, startTok);
  }

  // ─── Switch Statement ─────────────────────────────────────────────────

  private parseSwitchStatement(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'switch');
    this.expect(TokenType.LeftParen);
    const discriminant = this.parseExpression();
    this.expect(TokenType.RightParen);
    this.expect(TokenType.LeftBrace);

    const cases: ASTNode[] = [discriminant];
    let caseCount = 0;

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      if (this.checkKeyword('case')) {
        caseCount++;
        this.advance();
        const test = this.parseExpression();
        this.expect(TokenType.Colon);
        const body: ASTNode[] = [];
        while (!this.checkKeyword('case') && !this.checkKeyword('default') &&
               !this.check(TokenType.RightBrace) && !this.isAtEnd()) {
          const stmt = this.parseStatement();
          if (stmt) body.push(stmt);
        }
        cases.push(this.createNode(ASTNodeType.BlockStatement, [test, ...body], {
          isCase: true,
        }));
      } else if (this.checkKeyword('default')) {
        caseCount++;
        this.advance();
        this.expect(TokenType.Colon);
        const body: ASTNode[] = [];
        while (!this.checkKeyword('case') && !this.checkKeyword('default') &&
               !this.check(TokenType.RightBrace) && !this.isAtEnd()) {
          const stmt = this.parseStatement();
          if (stmt) body.push(stmt);
        }
        cases.push(this.createNode(ASTNodeType.BlockStatement, body, {
          isDefault: true,
        }));
      } else {
        this.advance(); // skip unexpected token
      }
    }

    this.expect(TokenType.RightBrace);
    return this.createNode(ASTNodeType.SwitchStatement, cases, {
      caseCount,
    }, startTok);
  }

  private parseCaseClause(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'case');
    const test = this.parseExpression();
    this.expect(TokenType.Colon);
    return this.createNode(ASTNodeType.BlockStatement, [test], {
      isCase: true,
    }, startTok);
  }

  private parseDefaultClause(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'default');
    this.expect(TokenType.Colon);
    return this.createNode(ASTNodeType.BlockStatement, [], {
      isDefault: true,
    }, startTok);
  }

  // ─── Try / Catch / Finally ────────────────────────────────────────────

  private parseTryCatchStatement(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'try');
    const body = this.parseBlockStatement();

    const handlers: ASTNode[] = [body];
    let catchCount = 0;
    let hasFinally = false;

    while (this.checkKeyword('catch')) {
      catchCount++;
      this.advance();
      let exceptionVar: ASTNode | null = null;
      if (this.match(TokenType.LeftParen)) {
        exceptionVar = this.parseExpression();
        this.expect(TokenType.RightParen);
      }
      const catchBody = this.parseBlockStatement();
      const catchChildren: ASTNode[] = [];
      if (exceptionVar) catchChildren.push(exceptionVar);
      catchChildren.push(catchBody);
      handlers.push(this.createNode(ASTNodeType.BlockStatement, catchChildren, {
        isCatch: true,
      }));
    }

    if (this.checkKeyword('finally')) {
      hasFinally = true;
      this.advance();
      handlers.push(this.parseBlockStatement());
    }

    return this.createNode(ASTNodeType.TryCatchStatement, handlers, {
      catchCount,
      hasFinally,
    }, startTok);
  }

  private parseCatchClause(): ASTNode {
    const startTok = this.peek();
    this.advance();
    let exceptionVar: ASTNode | null = null;
    if (this.match(TokenType.LeftParen)) {
      exceptionVar = this.parseExpression();
      this.expect(TokenType.RightParen);
    }
    const body = this.parseBlockStatement();
    const children: ASTNode[] = [];
    if (exceptionVar) children.push(exceptionVar);
    children.push(body);
    return this.createNode(ASTNodeType.BlockStatement, children, {
      isCatch: true,
    }, startTok);
  }

  private parseFinallyClause(): ASTNode {
    this.advance();
    return this.parseBlockStatement();
  }

  // ─── Simple Statements ────────────────────────────────────────────────

  private parseReturnStatement(): ASTNode {
    const startTok = this.peek();
    this.advance();
    let value: ASTNode | null = null;
    if (!this.check(TokenType.Semicolon) && !this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      value = this.parseExpression();
    }
    this.match(TokenType.Semicolon);
    return this.createNode(ASTNodeType.ReturnStatement, value ? [value] : [], {}, startTok);
  }

  private parseThrowStatement(): ASTNode {
    const startTok = this.peek();
    this.advance();
    const value = this.parseExpression();
    this.match(TokenType.Semicolon);
    return this.createNode(ASTNodeType.ThrowStatement, [value], {}, startTok);
  }

  private parseBreakStatement(): ASTNode {
    const startTok = this.peek();
    this.advance();
    let label: string | undefined;
    if (this.check(TokenType.Identifier)) {
      label = this.advance().value;
    }
    this.match(TokenType.Semicolon);
    return this.createNode(ASTNodeType.BreakStatement, [], {
      label,
    }, startTok, startTok);
  }

  private parseContinueStatement(): ASTNode {
    const startTok = this.peek();
    this.advance();
    let label: string | undefined;
    if (this.check(TokenType.Identifier)) {
      label = this.advance().value;
    }
    this.match(TokenType.Semicolon);
    return this.createNode(ASTNodeType.ContinueStatement, [], {
      label,
    }, startTok, startTok);
  }

  // ─── Label ────────────────────────────────────────────────────────────

  private parseLabel(): ASTNode {
    const startTok = this.peek();
    const name = this.advance().value;
    this.expect(TokenType.Colon);
    const stmt = this.parseStatement();
    return this.createNode(ASTNodeType.Identifier, stmt ? [stmt] : [], {
      name,
      kind: 'label',
    }, startTok);
  }

  // ─── Declaration or Expression Statement ──────────────────────────────

  private parseDeclarationOrExpression(): ASTNode {
    this.enterRule('declaration_or_expression');
    const startTok = this.peek();

    // Try to detect if this is a declaration
    if (this.isDeclarationStart()) {
      return this.parseDeclaration() ?? this.createNode(ASTNodeType.EmptyStatement, [], {}, startTok);
    }

    // Expression statement
    const expr = this.parseExpression();

    // Check for assignment
    if (this.check(TokenType.Assignment) || (this.check(TokenType.Operator) && this.peek().value === '=')) {
      const opTok = this.advance();
      const right = this.parseExpression();
      this.match(TokenType.Semicolon);
      return this.createNode(ASTNodeType.AssignmentExpression, [expr, right], {
        operator: opTok.value,
        isStatement: true,
      }, startTok);
    }

    this.match(TokenType.Semicolon);
    return this.createNode(ASTNodeType.ExpressionStatement, [expr], {}, startTok);
  }

  private isDeclarationStart(): boolean {
    const tok = this.peek();

    // JavaScript let/const/var
    if (this.lang === 'javascript' && JS_DECL_KEYWORDS.has(tok.value)) {
      return true;
    }

    // Type keyword followed by identifier
    if (this.isTypeKeyword(tok.value)) {
      return true;
    }

    // C/C++: struct/enum/class followed by name — declaration like "struct Point p;"
    if ((this.lang === 'c' || this.lang === 'cpp') &&
        tok.type === TokenType.Keyword &&
        (tok.value === 'struct' || tok.value === 'enum' || tok.value === 'class')) {
      // Look ahead: struct Name ... or struct { ... }
      const next = this.peekAhead(1);
      if (next.type === TokenType.Identifier || next.type === TokenType.LeftBrace) {
        return true;
      }
    }

    // Modifier followed by type/identifier
    if (this.isModifierStart()) {
      return true;
    }

    // Identifier followed by identifier (type name pattern)
    if (tok.type === TokenType.Identifier) {
      // Look ahead to see if next is also an identifier (type name pattern)
      let lookAhead = 1;
      // Skip template args if present
      if (this.checkAhead(1, TokenType.Operator, '<')) {
        let depth = 0;
        let i = 1;
        while (i < this.tokens.length - this.pos) {
          const t = this.peekAhead(i);
          if (t.value === '<') depth++;
          if (t.value === '>') depth--;
          if (depth === 0) { lookAhead = i + 1; break; }
          i++;
        }
      }
      // Also skip pointer/reference operators
      let idx = lookAhead;
      while (this.peekAhead(idx).value === '*' || this.peekAhead(idx).value === '&') {
        idx++;
      }
      if (this.peekAhead(idx).type === TokenType.Identifier) {
        return true;
      }
    }

    return false;
  }

  // ─── Preprocessor Directive (C/C++) ───────────────────────────────────

  private parsePreprocessorDirective(): ASTNode {
    const startTok = this.peek();
    const tok = this.advance();
    const value = tok.value;

    // Extract directive name
    const match = value.match(/^#\s*(\w+)/);
    const directive = match ? match[1] : 'unknown';

    return this.createNode(ASTNodeType.PreprocessorDirective, [], {
      directive,
      value,
      raw: value,
    }, startTok, startTok);
  }

  // ─── Namespace (C++) ─────────────────────────────────────────────────

  private parseNamespace(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'namespace');
    const nameTok = this.expect(TokenType.Identifier);
    this.expect(TokenType.LeftBrace);

    const members: ASTNode[] = [];
    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      const decl = this.parseTopLevelDeclaration();
      if (decl) members.push(decl);
    }

    this.expect(TokenType.RightBrace);
    return this.createNode(ASTNodeType.ClassDecl, members, {
      name: nameTok.value,
      kind: 'namespace',
      language: 'cpp',
    }, startTok);
  }

  // ─── Using Directive (C++) ────────────────────────────────────────────

  private parseUsingDirective(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'using'

    let value = '';
    while (!this.check(TokenType.Semicolon) && !this.isAtEnd()) {
      value += this.advance().value + ' ';
    }
    this.match(TokenType.Semicolon);

    return this.createNode(ASTNodeType.ImportDecl, [], {
      importKind: 'using',
      value: value.trim(),
    }, startTok);
  }

  // ─── Package Declaration (Java) ───────────────────────────────────────

  private parsePackageDeclaration(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'package'

    let name = '';
    while (!this.check(TokenType.Semicolon) && !this.isAtEnd()) {
      name += this.advance().value;
    }
    this.match(TokenType.Semicolon);

    return this.createNode(ASTNodeType.PackageDecl, [], {
      name,
    }, startTok);
  }

  // ─── Java Import ──────────────────────────────────────────────────────

  private parseJavaImport(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'import'

    const isStatic = this.matchKeyword('static');
    let name = '';
    while (!this.check(TokenType.Semicolon) && !this.isAtEnd()) {
      name += this.advance().value;
    }
    this.match(TokenType.Semicolon);

    return this.createNode(ASTNodeType.ImportDecl, [], {
      importKind: 'java',
      name,
      isStatic,
    }, startTok);
  }

  // ─── JavaScript Import ────────────────────────────────────────────────

  private parseJSImport(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'import'

    const children: ASTNode[] = [];
    let source = '';

    if (this.check(TokenType.LeftBrace)) {
      // Named import: import { a, b } from 'module'
      this.advance();
      while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
        const name = this.expect(TokenType.Identifier);
        let alias: string | undefined;
        if (this.checkKeyword('as')) {
          this.advance();
          alias = this.expect(TokenType.Identifier).value;
        }
        children.push(this.createNode(ASTNodeType.Identifier, [], {
          name: name.value,
          alias,
          kind: 'importSpecifier',
        }, name, name));
        this.match(TokenType.Comma);
      }
      this.expect(TokenType.RightBrace);
    } else if (this.check(TokenType.Operator, '*')) {
      // Namespace import: import * as name from 'module'
      this.advance();
      this.expectKeyword('as');
      const alias = this.expect(TokenType.Identifier);
      children.push(this.createNode(ASTNodeType.Identifier, [], {
        name: '*',
        alias: alias.value,
        kind: 'namespaceImport',
      }));
    } else if (this.check(TokenType.Identifier)) {
      // Default import: import name from 'module'
      const name = this.advance();
      children.push(this.createNode(ASTNodeType.Identifier, [], {
        name: name.value,
        kind: 'defaultImport',
      }, name, name));
    }

    if (this.checkKeyword('from')) {
      this.advance();
      source = this.expect(TokenType.String).value;
    }

    this.match(TokenType.Semicolon);

    return this.createNode(ASTNodeType.ImportDecl, children, {
      importKind: 'javascript',
      source,
    }, startTok);
  }

  // ─── JavaScript Variable Declaration ──────────────────────────────────

  private parseJSVariableDeclaration(): ASTNode {
    const startTok = this.peek();
    const kind = this.advance().value; // let, const, var

    const declarators: ASTNode[] = [];

    do {
      // Destructuring
      if (this.check(TokenType.LeftBracket) || this.check(TokenType.LeftBrace)) {
        const pattern = this.parseExpression();
        let init: ASTNode | null = null;
        if (this.match(TokenType.Assignment, '=') || this.match(TokenType.Operator, '=')) {
          init = this.parseExpression(BP.COMMA + 1);
        }
        declarators.push(this.createNode(ASTNodeType.Identifier, init ? [pattern, init] : [pattern], {
          kind: 'destructuring',
          destructuringKind: this.check(TokenType.LeftBracket) ? 'array' : 'object',
        }));
      } else {
        const name = this.expect(TokenType.Identifier);
        let init: ASTNode | null = null;
        if (this.match(TokenType.Assignment, '=') || this.match(TokenType.Operator, '=')) {
          init = this.parseExpression(BP.COMMA + 1);
        }
        declarators.push(this.createNode(ASTNodeType.Identifier, init ? [init] : [], {
          name: name.value,
          kind: 'declarator',
        }, name, name));
      }
    } while (this.match(TokenType.Comma));

    this.match(TokenType.Semicolon);

    return this.createNode(ASTNodeType.VariableDecl, declarators, {
      declKind: kind,
      language: 'javascript',
      declaratorCount: declarators.length,
    }, startTok);
  }

  // ─── JavaScript Function Declaration ──────────────────────────────────

  private parseJSFunctionDeclaration(modifiers: string[]): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'function');

    let name = '';
    if (this.check(TokenType.Identifier)) {
      name = this.advance().value;
    }

    this.expect(TokenType.LeftParen);
    const params = this.parseCStyleParameterList();
    this.expect(TokenType.RightParen);

    let body: ASTNode;
    if (this.check(TokenType.LeftBrace)) {
      body = this.parseBlockStatement();
    } else {
      // Arrow-like: function(x) expression
      body = this.parseExpression(BP.COMMA);
    }

    return this.createNode(ASTNodeType.FunctionDecl, [...params, body], {
      name,
      returnType: '',
      modifiers,
      paramCount: params.length,
      isDefinition: true,
      language: 'javascript',
      declKind: 'function',
    }, startTok);
  }

  // ─── JavaScript Export ────────────────────────────────────────────────

  private parseJSExport(): ASTNode {
    const startTok = this.peek();
    this.advance(); // consume 'export'

    const isDefault = this.matchKeyword('default');

    let decl: ASTNode | null = null;

    if (this.checkKeyword('function')) {
      decl = this.parseJSFunctionDeclaration(isDefault ? ['default'] : []);
    } else if (this.checkKeyword('class')) {
      decl = this.parseTypeDeclaration(isDefault ? ['default'] : [], this.peek());
    } else if (JS_DECL_KEYWORDS.has(this.peek().value)) {
      decl = this.parseJSVariableDeclaration();
    } else if (this.check(TokenType.LeftBrace)) {
      // Named re-export: export { a, b }
      this.advance();
      const names: ASTNode[] = [];
      while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
        const name = this.expect(TokenType.Identifier);
        let alias: string | undefined;
        if (this.checkKeyword('as')) {
          this.advance();
          alias = this.expect(TokenType.Identifier).value;
        }
        names.push(this.createNode(ASTNodeType.Identifier, [], {
          name: name.value,
          alias,
          kind: 'exportSpecifier',
        }, name, name));
        this.match(TokenType.Comma);
      }
      this.expect(TokenType.RightBrace);
      this.match(TokenType.Semicolon);
      decl = this.createNode(ASTNodeType.Identifier, names, {
        kind: 'namedExport',
      });
    } else {
      // Default export expression
      decl = this.parseExpression();
      this.match(TokenType.Semicolon);
    }

    if (decl) {
      decl.props.isExported = true;
      if (isDefault) decl.props.isDefaultExport = true;
    }

    return decl ?? this.createNode(ASTNodeType.EmptyStatement, [], {}, startTok);
  }

  // ─── Template Declaration (C++) ───────────────────────────────────────

  private parseTemplateDeclaration(): ASTNode {
    const startTok = this.peek();
    this.expect(TokenType.Keyword, 'template');
    this.expect(TokenType.Operator, '<');

    const typeParams: ASTNode[] = [];
    while (!this.check(TokenType.Operator, '>') && !this.isAtEnd()) {
      if (this.checkKeyword('typename') || this.checkKeyword('class')) {
        this.advance();
        const name = this.expect(TokenType.Identifier);
        typeParams.push(this.createNode(ASTNodeType.Identifier, [], {
          name: name.value,
          kind: 'typeParam',
        }, name, name));
      } else {
        // Non-type template parameter
        typeParams.push(this.parseExpression(BP.COMMA + 1));
      }
      this.match(TokenType.Comma);
    }

    this.expect(TokenType.Operator, '>');

    const decl = this.parseDeclaration();
    if (decl) {
      decl.children = [...typeParams, ...(decl.children ?? [])];
      decl.props.isTemplate = true;
      decl.props.typeParamCount = typeParams.length;
    }

    return decl ?? this.createNode(ASTNodeType.Identifier, typeParams, {
      kind: 'templateDecl',
    }, startTok);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private checkKeyword(value: string): boolean {
    return this.check(TokenType.Keyword, value);
  }

  private matchKeyword(value: string): boolean {
    return this.match(TokenType.Keyword, value);
  }

  private expectKeyword(value: string): Token {
    return this.expect(TokenType.Keyword, value);
  }

  // Override for BaseParser.parseCStyleStatement
  protected parseCStyleStatement(): ASTNode | null {
    return this.parseStatement();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory Function & Exports
// ═══════════════════════════════════════════════════════════════════════════

export function createParser(tokens: Token[], language: SupportedLanguage): Parser {
  switch (language) {
    case 'python':
      return new PythonParser(tokens);
    case 'c':
    case 'cpp':
    case 'java':
    case 'javascript':
      return new CStyleParser(tokens, language);
    default:
      return new CStyleParser(tokens, 'javascript');
  }
}
