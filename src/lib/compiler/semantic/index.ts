/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge Compiler — Semantic Analyzer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Walks the AST to build symbol tables, perform type checking, resolve scopes,
 * and detect semantic errors.
 */

import {
  ASTNode,
  ASTNodeType,
  SupportedLanguage,
  SymbolEntry,
  SymbolKind,
  SymbolType,
  InferredType,
  TypeKind,
  Scope,
  SemanticResult,
  SemanticStats,
  CompilerError,
  CompilerWarning,
  CompilerPhase,
  generateNodeId,
} from '../types';

// ─── Built-in symbols per language ──────────────────────────────────────────

const PYTHON_BUILTINS: Record<string, InferredType> = {
  print: { kind: TypeKind.Function, name: 'print' },
  len: { kind: TypeKind.Function, name: 'len' },
  range: { kind: TypeKind.Function, name: 'range' },
  int: { kind: TypeKind.Function, name: 'int' },
  float: { kind: TypeKind.Function, name: 'float' },
  str: { kind: TypeKind.Function, name: 'str' },
  bool: { kind: TypeKind.Function, name: 'bool' },
  list: { kind: TypeKind.Function, name: 'list' },
  dict: { kind: TypeKind.Function, name: 'dict' },
  set: { kind: TypeKind.Function, name: 'set' },
  tuple: { kind: TypeKind.Function, name: 'tuple' },
  type: { kind: TypeKind.Function, name: 'type' },
  isinstance: { kind: TypeKind.Function, name: 'isinstance' },
  enumerate: { kind: TypeKind.Function, name: 'enumerate' },
  zip: { kind: TypeKind.Function, name: 'zip' },
  map: { kind: TypeKind.Function, name: 'map' },
  filter: { kind: TypeKind.Function, name: 'filter' },
  sorted: { kind: TypeKind.Function, name: 'sorted' },
  reversed: { kind: TypeKind.Function, name: 'reversed' },
  abs: { kind: TypeKind.Function, name: 'abs' },
  min: { kind: TypeKind.Function, name: 'min' },
  max: { kind: TypeKind.Function, name: 'max' },
  sum: { kind: TypeKind.Function, name: 'sum' },
  input: { kind: TypeKind.Function, name: 'input' },
  open: { kind: TypeKind.Function, name: 'open' },
  super: { kind: TypeKind.Function, name: 'super' },
  property: { kind: TypeKind.Function, name: 'property' },
  staticmethod: { kind: TypeKind.Function, name: 'staticmethod' },
  classmethod: { kind: TypeKind.Function, name: 'classmethod' },
  None: { kind: TypeKind.None, name: 'None' },
  True: { kind: TypeKind.Boolean, name: 'bool' },
  False: { kind: TypeKind.Boolean, name: 'bool' },
  self: { kind: TypeKind.Any, name: 'self' },
  cls: { kind: TypeKind.Any, name: 'cls' },
  Exception: { kind: TypeKind.Class, name: 'Exception' },
  ValueError: { kind: TypeKind.Class, name: 'ValueError' },
  TypeError: { kind: TypeKind.Class, name: 'TypeError' },
  KeyError: { kind: TypeKind.Class, name: 'KeyError' },
  IndexError: { kind: TypeKind.Class, name: 'IndexError' },
  RuntimeError: { kind: TypeKind.Class, name: 'RuntimeError' },
  AttributeError: { kind: TypeKind.Class, name: 'AttributeError' },
};

const JS_BUILTINS: Record<string, InferredType> = {
  console: { kind: TypeKind.Object, name: 'console' },
  Math: { kind: TypeKind.Object, name: 'Math' },
  JSON: { kind: TypeKind.Object, name: 'JSON' },
  Object: { kind: TypeKind.Class, name: 'Object' },
  Array: { kind: TypeKind.Class, name: 'Array' },
  String: { kind: TypeKind.Class, name: 'String' },
  Number: { kind: TypeKind.Class, name: 'Number' },
  Boolean: { kind: TypeKind.Class, name: 'Boolean' },
  Function: { kind: TypeKind.Class, name: 'Function' },
  Promise: { kind: TypeKind.Class, name: 'Promise' },
  Map: { kind: TypeKind.Class, name: 'Map' },
  Set: { kind: TypeKind.Class, name: 'Set' },
  Date: { kind: TypeKind.Class, name: 'Date' },
  RegExp: { kind: TypeKind.Class, name: 'RegExp' },
  Error: { kind: TypeKind.Class, name: 'Error' },
  TypeError: { kind: TypeKind.Class, name: 'TypeError' },
  RangeError: { kind: TypeKind.Class, name: 'RangeError' },
  parseInt: { kind: TypeKind.Function, name: 'parseInt' },
  parseFloat: { kind: TypeKind.Function, name: 'parseFloat' },
  isNaN: { kind: TypeKind.Function, name: 'isNaN' },
  isFinite: { kind: TypeKind.Function, name: 'isFinite' },
  undefined: { kind: TypeKind.Void, name: 'undefined' },
  NaN: { kind: TypeKind.Number, name: 'NaN' },
  Infinity: { kind: TypeKind.Number, name: 'Infinity' },
  document: { kind: TypeKind.Object, name: 'document' },
  window: { kind: TypeKind.Object, name: 'window' },
  setTimeout: { kind: TypeKind.Function, name: 'setTimeout' },
  setInterval: { kind: TypeKind.Function, name: 'setInterval' },
  fetch: { kind: TypeKind.Function, name: 'fetch' },
  require: { kind: TypeKind.Function, name: 'require' },
};

const C_BUILTINS: Record<string, InferredType> = {
  printf: { kind: TypeKind.Function, name: 'printf' },
  scanf: { kind: TypeKind.Function, name: 'scanf' },
  malloc: { kind: TypeKind.Function, name: 'malloc' },
  free: { kind: TypeKind.Function, name: 'free' },
  sizeof: { kind: TypeKind.Function, name: 'sizeof' },
  NULL: { kind: TypeKind.None, name: 'NULL' },
  int: { kind: TypeKind.Number, name: 'int' },
  float: { kind: TypeKind.Number, name: 'float' },
  double: { kind: TypeKind.Number, name: 'double' },
  char: { kind: TypeKind.Number, name: 'char' },
  void: { kind: TypeKind.Void, name: 'void' },
  long: { kind: TypeKind.Number, name: 'long' },
  short: { kind: TypeKind.Number, name: 'short' },
  unsigned: { kind: TypeKind.Number, name: 'unsigned' },
  bool: { kind: TypeKind.Boolean, name: 'bool' },
  size_t: { kind: TypeKind.Number, name: 'size_t' },
  FILE: { kind: TypeKind.Class, name: 'FILE' },
  exit: { kind: TypeKind.Function, name: 'exit' },
  abs: { kind: TypeKind.Function, name: 'abs' },
  strlen: { kind: TypeKind.Function, name: 'strlen' },
  strcpy: { kind: TypeKind.Function, name: 'strcpy' },
  strcmp: { kind: TypeKind.Function, name: 'strcmp' },
};

const JAVA_BUILTINS: Record<string, InferredType> = {
  System: { kind: TypeKind.Object, name: 'System' },
  String: { kind: TypeKind.Class, name: 'String' },
  Integer: { kind: TypeKind.Class, name: 'Integer' },
  Double: { kind: TypeKind.Class, name: 'Double' },
  Float: { kind: TypeKind.Class, name: 'Float' },
  Boolean: { kind: TypeKind.Class, name: 'Boolean' },
  Long: { kind: TypeKind.Class, name: 'Long' },
  Object: { kind: TypeKind.Class, name: 'Object' },
  Class: { kind: TypeKind.Class, name: 'Class' },
  Exception: { kind: TypeKind.Class, name: 'Exception' },
  RuntimeException: { kind: TypeKind.Class, name: 'RuntimeException' },
  ArrayList: { kind: TypeKind.Class, name: 'ArrayList' },
  HashMap: { kind: TypeKind.Class, name: 'HashMap' },
  LinkedList: { kind: TypeKind.Class, name: 'LinkedList' },
  Scanner: { kind: TypeKind.Class, name: 'Scanner' },
  Math: { kind: TypeKind.Object, name: 'Math' },
  Arrays: { kind: TypeKind.Object, name: 'Arrays' },
  Collections: { kind: TypeKind.Object, name: 'Collections' },
  Override: { kind: TypeKind.Function, name: 'Override' },
  null: { kind: TypeKind.None, name: 'null' },
  this: { kind: TypeKind.Any, name: 'this' },
  super: { kind: TypeKind.Any, name: 'super' },
};

function getBuiltins(language: SupportedLanguage): Record<string, InferredType> {
  switch (language) {
    case 'python':
      return PYTHON_BUILTINS;
    case 'javascript':
      return JS_BUILTINS;
    case 'c':
    case 'cpp':
      return C_BUILTINS;
    case 'java':
      return JAVA_BUILTINS;
  }
}

// ─── Analyzer Class ─────────────────────────────────────────────────────────

class SemanticAnalyzer {
  private language: SupportedLanguage;
  private symbolTable: SymbolEntry[] = [];
  private typeMap: Map<string, InferredType> = new Map();
  private errors: CompilerError[] = [];
  private warnings: CompilerWarning[] = [];
  private scopes: Scope[] = [];
  private scopeStack: Scope[] = [];
  private scopeCounter = 0;
  private currentFunctionScope: Scope | null = null;
  private loopDepth = 0;
  private functionReturnTypes: Map<string, InferredType | null> = new Map();
  private functionHasReturn: Map<string, boolean> = new Map();

  constructor(language: SupportedLanguage) {
    this.language = language;
  }

  analyze(ast: ASTNode): SemanticResult {
    // Create global scope
    const globalScope = this.createScope(null, 'global', 'global', 1);

    // Populate builtins into global scope
    const builtins = getBuiltins(this.language);
    for (const [name, type] of Object.entries(builtins)) {
      const entry: SymbolEntry = {
        name,
        type: SymbolType.BuiltIn,
        kind: type.kind === TypeKind.Function ? SymbolKind.Function : type.kind === TypeKind.Class ? SymbolKind.Class : SymbolKind.Variable,
        scopeId: globalScope.id,
        line: 0,
        col: 0,
        used: false,
        mutated: false,
        inferredType: type,
      };
      globalScope.symbols.set(name, entry);
      this.symbolTable.push(entry);
      this.typeMap.set(`${globalScope.id}:${name}`, type);
    }

    // Walk the AST
    this.visitNode(ast);

    // Post-processing: check for unused symbols, missing returns, etc.
    this.postAnalysis();

    return {
      symbolTable: this.symbolTable,
      scopes: this.scopes,
      typeMap: this.typeMap,
      errors: this.errors,
      warnings: this.warnings,
      stats: this.computeStats(),
    };
  }

  // ─── Scope management ───────────────────────────────────────────────────

  private createScope(parentId: string | null, name: string, kind: Scope['kind'], line: number): Scope {
    const scope: Scope = {
      id: `s${++this.scopeCounter}`,
      parentId,
      name,
      kind,
      symbols: new Map(),
      children: [],
      line,
    };

    // Add as child of parent
    if (parentId !== null) {
      const parent = this.scopes.find(s => s.id === parentId);
      if (parent) {
        parent.children.push(scope);
      }
    }

    this.scopes.push(scope);
    this.scopeStack.push(scope);
    return scope;
  }

  private currentScope(): Scope {
    return this.scopeStack[this.scopeStack.length - 1];
  }

  private exitScope(): void {
    this.scopeStack.pop();
  }

  private scopeDepth(): number {
    return this.scopeStack.length - 1; // subtract global
  }

  // ─── Symbol lookup ──────────────────────────────────────────────────────

  private lookupSymbol(name: string): SymbolEntry | null {
    // Walk up the scope stack
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const scope = this.scopeStack[i];
      const sym = scope.symbols.get(name);
      if (sym) return sym;
    }
    return null;
  }

  private lookupSymbolInScope(name: string, scope: Scope): SymbolEntry | null {
    return scope.symbols.get(name) ?? null;
  }

  // ─── Symbol declaration ─────────────────────────────────────────────────

  private declareSymbol(
    name: string,
    kind: SymbolKind,
    symType: SymbolType,
    inferredType: InferredType | undefined,
    line: number,
    col: number,
  ): SymbolEntry | null {
    const scope = this.currentScope();

    // Check for duplicate declarations in the same scope
    const existing = scope.symbols.get(name);
    if (existing && existing.type !== SymbolType.BuiltIn) {
      // Allow re-declaration of variables in some languages
      if (!(this.language === 'python' && kind === SymbolKind.Variable && existing.kind === SymbolKind.Variable)) {
        this.errors.push({
          phase: CompilerPhase.SemanticAnalysis,
          message: `Duplicate declaration of '${name}' in scope '${scope.name}'`,
          line,
          col,
          severity: 'error',
        });
        return existing;
      }
    }

    const entry: SymbolEntry = {
      name,
      type: symType,
      kind,
      scopeId: scope.id,
      line,
      col,
      used: false,
      mutated: false,
      inferredType,
    };

    scope.symbols.set(name, entry);
    this.symbolTable.push(entry);
    if (inferredType) {
      this.typeMap.set(`${scope.id}:${name}`, inferredType);
    }

    return entry;
  }

  // ─── Symbol usage ───────────────────────────────────────────────────────

  private markUsed(name: string): void {
    const sym = this.lookupSymbol(name);
    if (sym) {
      sym.used = true;
    }
  }

  private markMutated(name: string): void {
    const sym = this.lookupSymbol(name);
    if (sym) {
      sym.mutated = true;
    }
  }

  // ─── Type inference helpers ─────────────────────────────────────────────

  private numberType: InferredType = { kind: TypeKind.Number, name: 'number' };
  private stringType: InferredType = { kind: TypeKind.String, name: 'string' };
  private booleanType: InferredType = { kind: TypeKind.Boolean, name: 'bool' };
  private voidType: InferredType = { kind: TypeKind.Void, name: 'void' };
  private noneType: InferredType = { kind: TypeKind.None, name: 'None' };
  private anyType: InferredType = { kind: TypeKind.Any, name: 'any' };
  private unknownType: InferredType = { kind: TypeKind.Unknown, name: 'unknown' };

  private inferType(node: ASTNode): InferredType {
    switch (node.type) {
      case ASTNodeType.NumberLiteral:
        return this.numberType;

      case ASTNodeType.StringLiteral:
        return this.stringType;

      case ASTNodeType.BooleanLiteral:
        return this.booleanType;

      case ASTNodeType.NoneLiteral:
        return this.noneType;

      case ASTNodeType.Identifier: {
        const name = node.props.name as string;
        const sym = this.lookupSymbol(name);
        if (sym && sym.inferredType) {
          return sym.inferredType;
        }
        return this.unknownType;
      }

      case ASTNodeType.BinaryExpression: {
        const op = node.props.operator as string;
        const leftType = this.inferType((node.children ?? [])[0]);
        const rightType = this.inferType((node.children ?? [])[1]);

        // Comparison operators return boolean
        if (['==', '!=', '<', '<=', '>', '>=', '===', '!=='].includes(op)) {
          return this.booleanType;
        }
        // Logical operators
        if (['&&', '||', 'and', 'or'].includes(op)) {
          return this.booleanType;
        }
        // Arithmetic on numbers → number
        if (leftType.kind === TypeKind.Number && rightType.kind === TypeKind.Number) {
          return this.numberType;
        }
        // String concatenation
        if (op === '+' && (leftType.kind === TypeKind.String || rightType.kind === TypeKind.String)) {
          return this.stringType;
        }
        return this.unknownType;
      }

      case ASTNodeType.UnaryExpression: {
        const op = node.props.operator as string;
        if (op === 'not' || op === '!') {
          return this.booleanType;
        }
        if (op === '-' || op === '+' || op === '~') {
          const operandType = this.inferType((node.children ?? [])[0]);
          if (operandType.kind === TypeKind.Number) {
            return this.numberType;
          }
        }
        return this.unknownType;
      }

      case ASTNodeType.CallExpression: {
        const callee = (node.children ?? [])[0];
        if (callee) {
          const calleeType = this.inferType(callee);
          if (calleeType.kind === TypeKind.Function) {
            // Try to get return type from props
            const retType = node.props.returnType as InferredType | undefined;
            if (retType) return retType;
            // Known builtins
            const calleeName = callee.type === ASTNodeType.Identifier ? (callee.props.name as string) : undefined;
            if (calleeName) {
              const returnMap: Record<string, InferredType> = {
                len: this.numberType,
                range: { kind: TypeKind.Array, name: 'list', typeParams: [this.numberType] },
                abs: this.numberType,
                min: this.numberType,
                max: this.numberType,
                sum: this.numberType,
                parseInt: this.numberType,
                parseFloat: this.numberType,
                str: this.stringType,
                int: this.numberType,
                float: this.numberType,
                bool: this.booleanType,
                input: this.stringType,
                typeof: this.stringType,
              };
              if (returnMap[calleeName]) return returnMap[calleeName];
            }
            return this.anyType;
          }
          if (calleeType.kind === TypeKind.Class) {
            // Constructor call returns instance
            return { kind: TypeKind.Object, name: calleeType.name };
          }
        }
        return this.anyType;
      }

      case ASTNodeType.ArrayExpression:
        return { kind: TypeKind.Array, name: 'array', typeParams: [this.anyType] };

      case ASTNodeType.ObjectExpression:
        return { kind: TypeKind.Object, name: 'object' };

      case ASTNodeType.ConditionalExpression: {
        const trueType = this.inferType((node.children ?? [])[1]);
        const falseType = this.inferType((node.children ?? [])[2]);
        if (this.typesEqual(trueType, falseType)) return trueType;
        return { kind: TypeKind.Union, name: 'union', typeParams: [trueType, falseType] };
      }

      case ASTNodeType.MemberExpression: {
        // Basic member access type inference
        const obj = (node.children ?? [])[0];
        const objType = obj ? this.inferType(obj) : this.anyType;
        const member = node.props.property as string;
        // Known member types
        if (objType.name === 'console' && member === 'log') {
          return { kind: TypeKind.Function, name: 'log' };
        }
        if (objType.name === 'Math') {
          if (['floor', 'ceil', 'round', 'abs', 'sqrt', 'pow'].includes(member)) {
            return { kind: TypeKind.Function, name: member };
          }
          if (['PI', 'E'].includes(member)) {
            return this.numberType;
          }
        }
        return this.anyType;
      }

      case ASTNodeType.LambdaExpression:
        return { kind: TypeKind.Function, name: 'lambda' };

      case ASTNodeType.NewExpression: {
        const callee = (node.children ?? [])[0];
        if (callee && callee.type === ASTNodeType.Identifier) {
          const name = callee.props.name as string;
          return { kind: TypeKind.Object, name };
        }
        return this.anyType;
      }

      case ASTNodeType.IndexExpression:
        return this.anyType;

      default:
        return this.unknownType;
    }
  }

  private typesEqual(a: InferredType, b: InferredType): boolean {
    return a.kind === b.kind && a.name === b.name;
  }

  // ─── AST Visitor ────────────────────────────────────────────────────────

  private visitNode(node: ASTNode): InferredType {
    if (!node) return this.unknownType;

    switch (node.type) {
      case ASTNodeType.Program:
        return this.visitProgram(node);
      case ASTNodeType.Module:
        return this.visitModule(node);
      case ASTNodeType.FunctionDecl:
        return this.visitFunctionDecl(node);
      case ASTNodeType.ClassDecl:
        return this.visitClassDecl(node);
      case ASTNodeType.VariableDecl:
        return this.visitVariableDecl(node);
      case ASTNodeType.ImportDecl:
        return this.visitImportDecl(node);
      case ASTNodeType.ExpressionStatement:
        return this.visitExpressionStatement(node);
      case ASTNodeType.ReturnStatement:
        return this.visitReturnStatement(node);
      case ASTNodeType.IfStatement:
        return this.visitIfStatement(node);
      case ASTNodeType.ForStatement:
        return this.visitForStatement(node);
      case ASTNodeType.WhileStatement:
        return this.visitWhileStatement(node);
      case ASTNodeType.DoWhileStatement:
        return this.visitDoWhileStatement(node);
      case ASTNodeType.SwitchStatement:
        return this.visitSwitchStatement(node);
      case ASTNodeType.BreakStatement:
        return this.visitBreakStatement(node);
      case ASTNodeType.ContinueStatement:
        return this.visitContinueStatement(node);
      case ASTNodeType.TryCatchStatement:
        return this.visitTryCatchStatement(node);
      case ASTNodeType.ThrowStatement:
        return this.visitThrowStatement(node);
      case ASTNodeType.BlockStatement:
        return this.visitBlockStatement(node);
      case ASTNodeType.BinaryExpression:
        return this.visitBinaryExpression(node);
      case ASTNodeType.UnaryExpression:
        return this.visitUnaryExpression(node);
      case ASTNodeType.AssignmentExpression:
        return this.visitAssignmentExpression(node);
      case ASTNodeType.CallExpression:
        return this.visitCallExpression(node);
      case ASTNodeType.MemberExpression:
        return this.visitMemberExpression(node);
      case ASTNodeType.IndexExpression:
        return this.visitIndexExpression(node);
      case ASTNodeType.ConditionalExpression:
        return this.visitConditionalExpression(node);
      case ASTNodeType.NewExpression:
        return this.visitNewExpression(node);
      case ASTNodeType.ArrayExpression:
        return this.visitArrayExpression(node);
      case ASTNodeType.ObjectExpression:
        return this.visitObjectExpression(node);
      case ASTNodeType.LambdaExpression:
        return this.visitLambdaExpression(node);
      case ASTNodeType.Identifier:
        return this.visitIdentifier(node);
      case ASTNodeType.NumberLiteral:
      case ASTNodeType.StringLiteral:
      case ASTNodeType.BooleanLiteral:
      case ASTNodeType.NoneLiteral:
        return this.inferType(node);
      case ASTNodeType.StructDecl:
        return this.visitStructDecl(node);
      case ASTNodeType.EnumDecl:
        return this.visitEnumDecl(node);
      case ASTNodeType.WithStatement:
        return this.visitWithStatement(node);
      case ASTNodeType.AssertStatement:
        return this.visitAssertStatement(node);
      case ASTNodeType.GlobalStatement:
        return this.visitGlobalStatement(node);
      case ASTNodeType.NonlocalStatement:
        return this.visitNonlocalStatement(node);
      default:
        // Visit children for unknown node types
        this.visitChildren(node);
        return this.unknownType;
    }
  }

  private visitChildren(node: ASTNode): void {
    for (const child of node.children ?? []) {
      this.visitNode(child);
    }
  }

  // ─── Node visitors ──────────────────────────────────────────────────────

  private visitProgram(node: ASTNode): InferredType {
    for (const child of node.children ?? []) {
      this.visitNode(child);
    }
    return this.voidType;
  }

  private visitModule(node: ASTNode): InferredType {
    const name = (node.props.name as string) || 'module';
    const scope = this.createScope(this.currentScope().id, name, 'module', node.loc.startLine);
    for (const child of node.children ?? []) {
      this.visitNode(child);
    }
    this.exitScope();
    return this.voidType;
  }

  private visitFunctionDecl(node: ASTNode): InferredType {
    const name = node.props.name as string;
    const params = (node.children ?? []).filter(
      c => c.type === ASTNodeType.Identifier && c.props.isParam === true
    );
    const body = (node.children ?? []).find(
      c => c.type === ASTNodeType.BlockStatement || !(c.type === ASTNodeType.Identifier && c.props.isParam === true)
    );
    const paramNames: string[] = (node.props.params as string[]) ?? params.map(p => p.props.name as string);
    const returnType = node.props.returnType as InferredType | undefined;

    // Determine if this is a global or local function
    const symType = this.currentScope().kind === 'global' ? SymbolType.Global : SymbolType.Local;

    const funcType: InferredType = {
      kind: TypeKind.Function,
      name: name,
      typeParams: returnType ? [returnType] : undefined,
    };

    this.declareSymbol(name, SymbolKind.Function, symType, funcType, node.loc.startLine, node.loc.startCol);

    // Create function scope
    const prevFunctionScope = this.currentFunctionScope;
    const scope = this.createScope(this.currentScope().id, name, 'function', node.loc.startLine);
    this.currentFunctionScope = scope;
    this.functionHasReturn.set(scope.id, false);

    // Declare return type on the scope if known
    if (returnType) {
      this.functionReturnTypes.set(scope.id, returnType);
    }

    // Declare parameters
    for (let i = 0; i < paramNames.length; i++) {
      const pName = paramNames[i];
      const paramType = node.props.paramTypes
        ? (node.props.paramTypes as InferredType[])[i]
        : this.anyType;
      this.declareSymbol(pName, SymbolKind.Parameter, SymbolType.Parameter, paramType, node.loc.startLine, node.loc.startCol);
    }

    // Visit body (skip param identifiers, visit block)
    if (body && body.type === ASTNodeType.BlockStatement) {
      this.visitNode(body);
    } else {
      // Visit non-param children
      for (const child of node.children ?? []) {
        if (!(child.type === ASTNodeType.Identifier && child.props.isParam === true)) {
          this.visitNode(child);
        }
      }
    }

    // Check for missing return in non-void functions
    const hasReturn = this.functionHasReturn.get(scope.id) ?? false;
    const expectedReturn = this.functionReturnTypes.get(scope.id);
    if (expectedReturn && expectedReturn.kind !== TypeKind.Void && expectedReturn.kind !== TypeKind.None && !hasReturn) {
      this.warnings.push({
        phase: CompilerPhase.SemanticAnalysis,
        message: `Function '${name}' may not return a value (expected ${expectedReturn.name})`,
        line: node.loc.startLine,
        col: node.loc.startCol,
      });
    }

    this.exitScope();
    this.currentFunctionScope = prevFunctionScope;

    return funcType;
  }

  private visitClassDecl(node: ASTNode): InferredType {
    const name = node.props.name as string;
    const symType = this.currentScope().kind === 'global' ? SymbolType.Global : SymbolType.Local;

    const classType: InferredType = { kind: TypeKind.Class, name };
    this.declareSymbol(name, SymbolKind.Class, symType, classType, node.loc.startLine, node.loc.startCol);

    // Create class scope
    const scope = this.createScope(this.currentScope().id, name, 'class', node.loc.startLine);

    // Visit children (methods, fields)
    for (const child of node.children ?? []) {
      this.visitNode(child);
    }

    this.exitScope();
    return classType;
  }

  private visitVariableDecl(node: ASTNode): InferredType {
    const name = node.props.name as string;
    const isConst = (node.props.constant as boolean) ?? false;
    const initExpr = (node.children ?? [])[0];

    let inferredType: InferredType = this.unknownType;
    if (initExpr) {
      inferredType = this.visitNode(initExpr);
    }

    // Also check if an explicit type annotation was given
    const explicitType = node.props.varType as InferredType | undefined;
    if (explicitType) {
      // If we have both explicit and inferred, check for mismatch
      if (initExpr && inferredType.kind !== TypeKind.Unknown && explicitType.kind !== TypeKind.Any) {
        if (!this.isAssignable(inferredType, explicitType)) {
          this.errors.push({
            phase: CompilerPhase.SemanticAnalysis,
            message: `Type mismatch: cannot assign ${inferredType.name} to ${explicitType.name}`,
            line: node.loc.startLine,
            col: node.loc.startCol,
            severity: 'error',
          });
        }
      }
      inferredType = explicitType;
    }

    const symType = this.currentScope().kind === 'global' ? SymbolType.Global : SymbolType.Local;
    const kind = isConst ? SymbolKind.Constant : SymbolKind.Variable;
    this.declareSymbol(name, kind, symType, inferredType, node.loc.startLine, node.loc.startCol);

    return inferredType;
  }

  private visitImportDecl(node: ASTNode): InferredType {
    const importKind = node.props.importKind as string | undefined;
    const source = (node.props.source ?? node.props.module) as string | undefined;

    // Extract import names from children (Identifier nodes with name prop)
    const childNames: string[] = [];
    for (const child of (node.children ?? [])) {
      if (child.props.name) {
        const name = child.props.alias
          ? `${child.props.name} as ${child.props.alias}`
          : String(child.props.name);
        childNames.push(String(child.props.name));
      }
    }

    if (childNames.length > 0) {
      for (const impName of childNames) {
        this.declareSymbol(
          impName,
          SymbolKind.Import,
          SymbolType.Module,
          { kind: TypeKind.Any, name: impName },
          node.loc.startLine,
          node.loc.startCol,
        );
      }
    } else if (source) {
      // Default import — use source name
      const name = source.split('/').pop()?.replace(/['"]/g, '') ?? source;
      this.declareSymbol(
        name,
        SymbolKind.Import,
        SymbolType.Module,
        { kind: TypeKind.Any, name },
        node.loc.startLine,
        node.loc.startCol,
      );
    }

    return this.anyType;
  }

  private visitExpressionStatement(node: ASTNode): InferredType {
    const child = (node.children ?? [])[0];
    if (child) {
      return this.visitNode(child);
    }
    return this.voidType;
  }

  private visitReturnStatement(node: ASTNode): InferredType {
    // Check if we're inside a function
    if (!this.currentFunctionScope) {
      this.errors.push({
        phase: CompilerPhase.SemanticAnalysis,
        message: 'Return statement outside of function',
        line: node.loc.startLine,
        col: node.loc.startCol,
        severity: 'error',
      });
      return this.voidType;
    }

    this.functionHasReturn.set(this.currentFunctionScope.id, true);

    const value = (node.children ?? [])[0];
    let returnType = this.voidType;
    if (value) {
      returnType = this.visitNode(value);
    }

    // Check return type matches declared return type
    const expectedReturn = this.functionReturnTypes.get(this.currentFunctionScope.id);
    if (expectedReturn && expectedReturn.kind !== TypeKind.Any && expectedReturn.kind !== TypeKind.Unknown) {
      if (returnType.kind !== TypeKind.Void && !this.isAssignable(returnType, expectedReturn)) {
        this.errors.push({
          phase: CompilerPhase.SemanticAnalysis,
          message: `Return type mismatch: expected ${expectedReturn.name}, got ${returnType.name}`,
          line: node.loc.startLine,
          col: node.loc.startCol,
          severity: 'error',
        });
      }
    }

    return returnType;
  }

  private visitIfStatement(node: ASTNode): InferredType {
    const children = node.children ?? [];
    const condition = children[0];
    const thenBlock = children[1];
    const elseBlock = children[2];

    if (condition) {
      const condType = this.visitNode(condition);
      // Check that condition is boolean-like
      if (condType.kind !== TypeKind.Unknown && condType.kind !== TypeKind.Any && condType.kind !== TypeKind.Boolean) {
        this.warnings.push({
          phase: CompilerPhase.SemanticAnalysis,
          message: `Condition of if-statement is not boolean (got ${condType.name})`,
          line: condition.loc.startLine,
        });
      }
    }

    // Then block — create a block scope
    if (thenBlock) {
      const thenScope = this.createScope(this.currentScope().id, 'if-then', 'block', thenBlock.loc.startLine);
      this.visitNode(thenBlock);
      this.exitScope();
    }

    // Else block
    if (elseBlock) {
      const elseScope = this.createScope(this.currentScope().id, 'if-else', 'block', elseBlock.loc.startLine);
      this.visitNode(elseBlock);
      this.exitScope();
    }

    return this.voidType;
  }

  private visitForStatement(node: ASTNode): InferredType {
    const children = node.children ?? [];
    const loopScope = this.createScope(this.currentScope().id, 'for', 'block', node.loc.startLine);
    this.loopDepth++;

    // Init
    if (children[0]) this.visitNode(children[0]);
    // Condition
    if (children[1]) this.visitNode(children[1]);
    // Update
    if (children[2]) this.visitNode(children[2]);
    // Body
    if (children[3]) {
      const bodyScope = this.createScope(loopScope.id, 'for-body', 'block', children[3].loc.startLine);
      this.visitNode(children[3]);
      this.exitScope();
    }

    // Also handle Python-style for (iterator style)
    // if node.props has 'iterator' and 'iterable'
    const iterator = node.props.iterator as string | undefined;
    const iterable = children[0]; // might be the iterable in Python-style for
    if (iterator && this.language === 'python') {
      this.declareSymbol(iterator, SymbolKind.Variable, SymbolType.Local, this.anyType, node.loc.startLine, node.loc.startCol);
    }

    this.loopDepth--;
    this.exitScope();
    return this.voidType;
  }

  private visitWhileStatement(node: ASTNode): InferredType {
    const children = node.children ?? [];
    const loopScope = this.createScope(this.currentScope().id, 'while', 'block', node.loc.startLine);
    this.loopDepth++;

    if (children[0]) this.visitNode(children[0]); // condition
    if (children[1]) {
      const bodyScope = this.createScope(loopScope.id, 'while-body', 'block', children[1].loc.startLine);
      this.visitNode(children[1]);
      this.exitScope();
    }

    this.loopDepth--;
    this.exitScope();
    return this.voidType;
  }

  private visitDoWhileStatement(node: ASTNode): InferredType {
    const children = node.children ?? [];
    const loopScope = this.createScope(this.currentScope().id, 'do-while', 'block', node.loc.startLine);
    this.loopDepth++;

    if (children[0]) this.visitNode(children[0]); // body
    if (children[1]) this.visitNode(children[1]); // condition

    this.loopDepth--;
    this.exitScope();
    return this.voidType;
  }

  private visitSwitchStatement(node: ASTNode): InferredType {
    const children = node.children ?? [];
    const scope = this.createScope(this.currentScope().id, 'switch', 'block', node.loc.startLine);

    if (children[0]) this.visitNode(children[0]); // discriminant
    for (let i = 1; i < children.length; i++) {
      this.visitNode(children[i]); // case clauses
    }

    this.exitScope();
    return this.voidType;
  }

  private visitBreakStatement(node: ASTNode): InferredType {
    if (this.loopDepth === 0) {
      this.errors.push({
        phase: CompilerPhase.SemanticAnalysis,
        message: 'Break statement outside of loop',
        line: node.loc.startLine,
        col: node.loc.startCol,
        severity: 'error',
      });
    }
    return this.voidType;
  }

  private visitContinueStatement(node: ASTNode): InferredType {
    if (this.loopDepth === 0) {
      this.errors.push({
        phase: CompilerPhase.SemanticAnalysis,
        message: 'Continue statement outside of loop',
        line: node.loc.startLine,
        col: node.loc.startCol,
        severity: 'error',
      });
    }
    return this.voidType;
  }

  private visitTryCatchStatement(node: ASTNode): InferredType {
    const children = node.children ?? [];
    const scope = this.createScope(this.currentScope().id, 'try', 'block', node.loc.startLine);

    // Try block
    if (children[0]) {
      const tryScope = this.createScope(scope.id, 'try-body', 'block', children[0].loc.startLine);
      this.visitNode(children[0]);
      this.exitScope();
    }

    // Catch block(s)
    if (children[1]) {
      const catchScope = this.createScope(scope.id, 'catch', 'block', children[1].loc.startLine);
      // Declare exception variable if named
      const catchVar = node.props.catchVar as string | undefined;
      if (catchVar) {
        this.declareSymbol(catchVar, SymbolKind.Variable, SymbolType.Local, this.anyType, node.loc.startLine, node.loc.startCol);
      }
      this.visitNode(children[1]);
      this.exitScope();
    }

    // Finally block
    if (children[2]) {
      const finallyScope = this.createScope(scope.id, 'finally', 'block', children[2].loc.startLine);
      this.visitNode(children[2]);
      this.exitScope();
    }

    this.exitScope();
    return this.voidType;
  }

  private visitThrowStatement(node: ASTNode): InferredType {
    const child = (node.children ?? [])[0];
    if (child) this.visitNode(child);
    return this.voidType;
  }

  private visitBlockStatement(node: ASTNode): InferredType {
    for (const child of node.children ?? []) {
      this.visitNode(child);
    }
    return this.voidType;
  }

  private visitBinaryExpression(node: ASTNode): InferredType {
    const children = node.children ?? [];
    if (children[0]) this.visitNode(children[0]);
    if (children[1]) this.visitNode(children[1]);
    return this.inferType(node);
  }

  private visitUnaryExpression(node: ASTNode): InferredType {
    const child = (node.children ?? [])[0];
    if (child) this.visitNode(child);
    return this.inferType(node);
  }

  private visitAssignmentExpression(node: ASTNode): InferredType {
    const children = node.children ?? [];
    const left = children[0];
    const right = children[1];

    let rightType = this.unknownType;
    if (right) {
      rightType = this.visitNode(right);
    }

    if (left) {
      if (left.type === ASTNodeType.Identifier) {
        const name = left.props.name as string;
        const sym = this.lookupSymbol(name);
        if (!sym) {
          this.errors.push({
            phase: CompilerPhase.SemanticAnalysis,
            message: `Undefined variable '${name}'`,
            line: left.loc.startLine,
            col: left.loc.startCol,
            severity: 'error',
          });
        } else {
          this.markMutated(name);
          // Type check assignment
          if (sym.inferredType && rightType.kind !== TypeKind.Unknown && rightType.kind !== TypeKind.Any) {
            if (!this.isAssignable(rightType, sym.inferredType)) {
              this.errors.push({
                phase: CompilerPhase.SemanticAnalysis,
                message: `Type mismatch: cannot assign ${rightType.name} to variable '${name}' of type ${sym.inferredType.name}`,
                line: left.loc.startLine,
                col: left.loc.startCol,
                severity: 'error',
              });
            }
          }
        }
      } else {
        // Member/index assignment — just visit
        this.visitNode(left);
      }
    }

    return rightType;
  }

  private visitCallExpression(node: ASTNode): InferredType {
    const children = node.children ?? [];
    const callee = children[0];

    if (callee) {
      const calleeType = this.visitNode(callee);

      // Check if callee is callable
      if (callee.type === ASTNodeType.Identifier) {
        const name = callee.props.name as string;
        const sym = this.lookupSymbol(name);
        if (sym && sym.kind !== SymbolKind.Function && sym.inferredType?.kind !== TypeKind.Function && sym.inferredType?.kind !== TypeKind.Class && sym.inferredType?.kind !== TypeKind.Any) {
          this.errors.push({
            phase: CompilerPhase.SemanticAnalysis,
            message: `'${name}' is not a function (type: ${sym.inferredType?.name ?? 'unknown'})`,
            line: callee.loc.startLine,
            col: callee.loc.startCol,
            severity: 'error',
          });
        }
        this.markUsed(name);
      }

      // Check argument count for known functions
      const args = children.slice(1);
      const argCount = args.length;

      // Known builtins with specific arg counts
      if (callee.type === ASTNodeType.Identifier) {
        const name = callee.props.name as string;
        const argChecks: Record<string, { min: number; max: number }> = {
          len: { min: 1, max: 1 },
          abs: { min: 1, max: 1 },
          range: { min: 1, max: 3 },
          int: { min: 1, max: 2 },
          float: { min: 1, max: 1 },
          str: { min: 0, max: 1 },
          bool: { min: 1, max: 1 },
          type: { min: 1, max: 1 },
          enumerate: { min: 1, max: 2 },
          parseInt: { min: 1, max: 2 },
          parseFloat: { min: 1, max: 1 },
          isNaN: { min: 1, max: 1 },
          isFinite: { min: 1, max: 1 },
        };

        const check = argChecks[name];
        if (check && (argCount < check.min || argCount > check.max)) {
          this.errors.push({
            phase: CompilerPhase.SemanticAnalysis,
            message: `Function '${name}' expects ${check.min === check.max ? check.min : `${check.min}-${check.max}`} argument(s), but ${argCount} were provided`,
            line: node.loc.startLine,
            col: node.loc.startCol,
            severity: 'error',
          });
        }
      }

      // Visit arguments
      for (const arg of args) {
        this.visitNode(arg);
      }
    }

    return this.inferType(node);
  }

  private visitMemberExpression(node: ASTNode): InferredType {
    const children = node.children ?? [];
    if (children[0]) this.visitNode(children[0]);
    return this.inferType(node);
  }

  private visitIndexExpression(node: ASTNode): InferredType {
    const children = node.children ?? [];
    if (children[0]) this.visitNode(children[0]);
    if (children[1]) this.visitNode(children[1]);
    return this.inferType(node);
  }

  private visitConditionalExpression(node: ASTNode): InferredType {
    const children = node.children ?? [];
    if (children[0]) this.visitNode(children[0]);
    if (children[1]) this.visitNode(children[1]);
    if (children[2]) this.visitNode(children[2]);
    return this.inferType(node);
  }

  private visitNewExpression(node: ASTNode): InferredType {
    const children = node.children ?? [];
    for (const child of children) {
      this.visitNode(child);
    }
    return this.inferType(node);
  }

  private visitArrayExpression(node: ASTNode): InferredType {
    for (const child of node.children ?? []) {
      this.visitNode(child);
    }
    return this.inferType(node);
  }

  private visitObjectExpression(node: ASTNode): InferredType {
    for (const child of node.children ?? []) {
      this.visitNode(child);
    }
    return this.inferType(node);
  }

  private visitLambdaExpression(node: ASTNode): InferredType {
    const params = (node.props.params as string[]) ?? [];
    const scope = this.createScope(this.currentScope().id, 'lambda', 'function', node.loc.startLine);
    const prevFunctionScope = this.currentFunctionScope;
    this.currentFunctionScope = scope;
    this.functionHasReturn.set(scope.id, false);

    for (const pName of params) {
      this.declareSymbol(pName, SymbolKind.Parameter, SymbolType.Parameter, this.anyType, node.loc.startLine, node.loc.startCol);
    }

    for (const child of node.children ?? []) {
      this.visitNode(child);
    }

    this.exitScope();
    this.currentFunctionScope = prevFunctionScope;
    return { kind: TypeKind.Function, name: 'lambda' };
  }

  private visitIdentifier(node: ASTNode): InferredType {
    const name = node.props.name as string;
    const sym = this.lookupSymbol(name);

    if (!sym) {
      this.errors.push({
        phase: CompilerPhase.SemanticAnalysis,
        message: `Undefined variable '${name}'`,
        line: node.loc.startLine,
        col: node.loc.startCol,
        severity: 'error',
      });
      return this.unknownType;
    }

    this.markUsed(name);
    return sym.inferredType ?? this.unknownType;
  }

  private visitStructDecl(node: ASTNode): InferredType {
    const name = node.props.name as string;
    const symType = this.currentScope().kind === 'global' ? SymbolType.Global : SymbolType.Local;
    this.declareSymbol(name, SymbolKind.Struct, symType, { kind: TypeKind.Class, name }, node.loc.startLine, node.loc.startCol);

    const scope = this.createScope(this.currentScope().id, name, 'class', node.loc.startLine);
    for (const child of node.children ?? []) {
      this.visitNode(child);
    }
    this.exitScope();
    return { kind: TypeKind.Class, name };
  }

  private visitEnumDecl(node: ASTNode): InferredType {
    const name = node.props.name as string;
    const symType = this.currentScope().kind === 'global' ? SymbolType.Global : SymbolType.Local;
    this.declareSymbol(name, SymbolKind.Enum, symType, { kind: TypeKind.Class, name }, node.loc.startLine, node.loc.startCol);

    // Enum members
    const members = (node.props.members as string[]) ?? [];
    for (const member of members) {
      this.declareSymbol(member, SymbolKind.Constant, SymbolType.Local, this.numberType, node.loc.startLine, node.loc.startCol);
    }

    return { kind: TypeKind.Class, name };
  }

  private visitWithStatement(node: ASTNode): InferredType {
    const children = node.children ?? [];
    const scope = this.createScope(this.currentScope().id, 'with', 'block', node.loc.startLine);
    for (const child of children) {
      this.visitNode(child);
    }
    this.exitScope();
    return this.voidType;
  }

  private visitAssertStatement(node: ASTNode): InferredType {
    const children = node.children ?? [];
    for (const child of children) {
      this.visitNode(child);
    }
    return this.voidType;
  }

  private visitGlobalStatement(node: ASTNode): InferredType {
    const names = (node.props.names as string[]) ?? [];
    for (const name of names) {
      // Mark the symbol as global in the current scope
      const globalSym = this.scopes[0]?.symbols.get(name); // global scope is first
      if (globalSym) {
        // Re-declare as global in the current scope (points to global)
        this.declareSymbol(name, SymbolKind.Variable, SymbolType.Global, globalSym.inferredType, node.loc.startLine, node.loc.startCol);
      } else {
        this.warnings.push({
          phase: CompilerPhase.SemanticAnalysis,
          message: `Global variable '${name}' not found in global scope`,
          line: node.loc.startLine,
        });
      }
    }
    return this.voidType;
  }

  private visitNonlocalStatement(node: ASTNode): InferredType {
    const names = (node.props.names as string[]) ?? [];
    for (const name of names) {
      // Look up in enclosing function scopes
      let found = false;
      for (let i = this.scopeStack.length - 2; i >= 1; i--) {
        const scopeSym = this.scopeStack[i].symbols.get(name);
        if (scopeSym) {
          this.declareSymbol(name, SymbolKind.Variable, SymbolType.Local, scopeSym.inferredType, node.loc.startLine, node.loc.startCol);
          found = true;
          break;
        }
      }
      if (!found) {
        this.warnings.push({
          phase: CompilerPhase.SemanticAnalysis,
          message: `Nonlocal variable '${name}' not found in enclosing scopes`,
          line: node.loc.startLine,
        });
      }
    }
    return this.voidType;
  }

  // ─── Type checking helpers ──────────────────────────────────────────────

  private isAssignable(from: InferredType, to: InferredType): boolean {
    // Any can be assigned to anything
    if (to.kind === TypeKind.Any || from.kind === TypeKind.Any) return true;
    if (to.kind === TypeKind.Unknown || from.kind === TypeKind.Unknown) return true;
    // Same kind
    if (from.kind === to.kind && from.name === to.name) return true;
    // Number subtypes
    if (from.kind === TypeKind.Number && to.kind === TypeKind.Number) return true;
    // None can be assigned to nullable types
    if (from.kind === TypeKind.None && to.nullable) return true;
    // Union types
    if (to.kind === TypeKind.Union && to.typeParams) {
      return to.typeParams.some(t => this.isAssignable(from, t));
    }
    return false;
  }

  // ─── Post-analysis checks ───────────────────────────────────────────────

  private postAnalysis(): void {
    // Check for unused symbols (skip builtins)
    for (const sym of this.symbolTable) {
      if (sym.type === SymbolType.BuiltIn) continue;

      if (!sym.used && sym.kind !== SymbolKind.Parameter) {
        // Unused imports are warnings
        if (sym.kind === SymbolKind.Import) {
          this.warnings.push({
            phase: CompilerPhase.SemanticAnalysis,
            message: `Unused import '${sym.name}'`,
            line: sym.line,
          });
        }
        // Unused variables/constants are warnings (not errors)
        else if (sym.kind === SymbolKind.Variable || sym.kind === SymbolKind.Constant) {
          // Don't warn about variables starting with _ (convention for intentionally unused)
          if (!sym.name.startsWith('_')) {
            this.warnings.push({
              phase: CompilerPhase.SemanticAnalysis,
              message: `Unused variable '${sym.name}'`,
              line: sym.line,
            });
          }
        }
      }
    }
  }

  // ─── Statistics ─────────────────────────────────────────────────────────

  private computeStats(): SemanticStats {
    const nonBuiltin = this.symbolTable.filter(s => s.type !== SymbolType.BuiltIn);
    const unused = nonBuiltin.filter(s => !s.used && s.kind !== SymbolKind.Parameter);
    const globals = nonBuiltin.filter(s => s.type === SymbolType.Global && s.kind === SymbolKind.Variable);
    const typeErrors = this.errors.filter(
      e => e.message.includes('Type mismatch') || e.message.includes('Return type mismatch')
    );
    let maxDepth = 0;
    const computeDepth = (scope: Scope, depth: number) => {
      if (depth > maxDepth) maxDepth = depth;
      for (const child of scope.children) {
        computeDepth(child, depth + 1);
      }
    };
    for (const scope of this.scopes) {
      if (scope.parentId === null) {
        computeDepth(scope, 0);
      }
    }

    return {
      totalSymbols: nonBuiltin.length,
      totalScopes: this.scopes.length,
      unusedSymbols: unused.length,
      typeErrors: typeErrors.length,
      globalVariables: globals.length,
      maxScopeDepth: maxDepth,
    };
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function analyzeSemantics(ast: ASTNode, language: SupportedLanguage): SemanticResult {
  const analyzer = new SemanticAnalyzer(language);
  return analyzer.analyze(ast);
}
