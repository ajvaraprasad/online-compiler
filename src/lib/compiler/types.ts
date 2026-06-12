/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge Compiler — Core Type System
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Defines all types used across the compiler pipeline:
 *   Token → AST → Semantic Info → IR → Optimized IR
 *
 * Architecture:
 *   Lexer        → Token[]
 *   Parser       → ASTNode
 *   Semantic     → ASTNode + SymbolTable + TypeMap
 *   IR Generator → IRProgram
 *   Optimizer    → IRProgram (optimized)
 *   Security     → SecurityReport
 */

// ─── Token Types (Lexer Output) ────────────────────────────────────────────

export enum TokenType {
  // Literals
  Number = 'Number',
  String = 'String',
  Boolean = 'Boolean',
  None = 'None',

  // Identifiers & Keywords
  Identifier = 'Identifier',
  Keyword = 'Keyword',

  // Operators
  Operator = 'Operator',
  Assignment = 'Assignment',
  Arrow = 'Arrow',
  FatArrow = 'FatArrow',
  Ellipsis = 'Ellipsis',

  // Delimiters
  LeftParen = 'LeftParen',
  RightParen = 'RightParen',
  LeftBracket = 'LeftBracket',
  RightBracket = 'RightBracket',
  LeftBrace = 'LeftBrace',
  RightBrace = 'RightBrace',
  Comma = 'Comma',
  Semicolon = 'Semicolon',
  Colon = 'Colon',
  Dot = 'Dot',

  // Python-specific
  Indent = 'Indent',
  Dedent = 'Dedent',
  Newline = 'Newline',

  // Comments & Formatting
  Comment = 'Comment',
  Decorator = 'Decorator',
  Preprocessor = 'Preprocessor',

  // Special
  EOF = 'EOF',
  Unknown = 'Unknown',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
  /** For Python: indentation level */
  indent?: number;
}

export interface LexResult {
  tokens: Token[];
  errors: CompilerError[];
  stats: LexStats;
}

export interface LexStats {
  totalTokens: number;
  keywords: number;
  identifiers: number;
  literals: number;
  operators: number;
  linesOfCode: number;
  commentRatio: number;
}

// ─── AST Node Types (Parser Output) ───────────────────────────────────────

export enum ASTNodeType {
  // Top-level
  Program = 'Program',
  Module = 'Module',

  // Declarations
  FunctionDecl = 'FunctionDecl',
  ClassDecl = 'ClassDecl',
  VariableDecl = 'VariableDecl',
  ImportDecl = 'ImportDecl',

  // Statements
  ExpressionStatement = 'ExpressionStatement',
  ReturnStatement = 'ReturnStatement',
  IfStatement = 'IfStatement',
  ForStatement = 'ForStatement',
  WhileStatement = 'WhileStatement',
  DoWhileStatement = 'DoWhileStatement',
  SwitchStatement = 'SwitchStatement',
  BreakStatement = 'BreakStatement',
  ContinueStatement = 'ContinueStatement',
  TryCatchStatement = 'TryCatchStatement',
  ThrowStatement = 'ThrowStatement',
  BlockStatement = 'BlockStatement',
  EmptyStatement = 'EmptyStatement',

  // Expressions
  BinaryExpression = 'BinaryExpression',
  UnaryExpression = 'UnaryExpression',
  AssignmentExpression = 'AssignmentExpression',
  CallExpression = 'CallExpression',
  MemberExpression = 'MemberExpression',
  IndexExpression = 'IndexExpression',
  ConditionalExpression = 'ConditionalExpression',
  NewExpression = 'NewExpression',
  ArrayExpression = 'ArrayExpression',
  ObjectExpression = 'ObjectExpression',
  LambdaExpression = 'LambdaExpression',
  AwaitExpression = 'AwaitExpression',
  YieldExpression = 'YieldExpression',
  SpreadExpression = 'SpreadExpression',
  TemplateLiteral = 'TemplateLiteral',
  FStringExpression = 'FStringExpression',
  ComprehensionExpression = 'ComprehensionExpression',

  // Literals
  NumberLiteral = 'NumberLiteral',
  StringLiteral = 'StringLiteral',
  BooleanLiteral = 'BooleanLiteral',
  NoneLiteral = 'NoneLiteral',
  Identifier = 'Identifier',

  // C/C++ specific
  StructDecl = 'StructDecl',
  EnumDecl = 'EnumDecl',
  TypedefDecl = 'TypedefDecl',
  PreprocessorDirective = 'PreprocessorDirective',
  CastExpression = 'CastExpression',
  SizeofExpression = 'SizeofExpression',
  PointerExpression = 'PointerExpression',

  // Java specific
  InterfaceDecl = 'InterfaceDecl',
  PackageDecl = 'PackageDecl',
  AnnotationExpression = 'AnnotationExpression',

  // Python specific
  WithStatement = 'WithStatement',
  AssertStatement = 'AssertStatement',
  GlobalStatement = 'GlobalStatement',
  NonlocalStatement = 'NonlocalStatement',
  DecoratorExpression = 'DecoratorExpression',
  SliceExpression = 'SliceExpression',
}

export interface ASTNode {
  type: ASTNodeType;
  /** Child nodes */
  children?: ASTNode[];
  /** Key-value properties specific to each node type */
  props: Record<string, unknown>;
  /** Source location */
  loc: SourceLocation;
  /** Unique ID for the node */
  id: string;
}

export interface SourceLocation {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface ParseResult {
  ast: ASTNode | null;
  errors: CompilerError[];
  stats: ParseStats;
}

export interface ParseStats {
  totalNodes: number;
  maxDepth: number;
  functionCount: number;
  classCount: number;
  importCount: number;
  cyclomaticComplexity: number;
}

// ─── Semantic Analysis Types ──────────────────────────────────────────────

export interface SymbolEntry {
  name: string;
  type: SymbolType;
  kind: SymbolKind;
  scopeId: string;
  line: number;
  col: number;
  /** Is this symbol used? (for dead code detection) */
  used: boolean;
  /** Is this symbol mutated? */
  mutated: boolean;
  /** Type information */
  inferredType?: InferredType;
}

export enum SymbolKind {
  Variable = 'Variable',
  Function = 'Function',
  Class = 'Class',
  Parameter = 'Parameter',
  Import = 'Import',
  Constant = 'Constant',
  Enum = 'Enum',
  Struct = 'Struct',
  Interface = 'Interface',
  Namespace = 'Namespace',
}

export enum SymbolType {
  Local = 'Local',
  Global = 'Global',
  BuiltIn = 'BuiltIn',
  Parameter = 'Parameter',
  Member = 'Member',
  Module = 'Module',
}

export interface InferredType {
  kind: TypeKind;
  name: string;
  /** For generic/collection types */
  typeParams?: InferredType[];
  /** Is this type nullable? */
  nullable?: boolean;
}

export enum TypeKind {
  Primitive = 'Primitive',
  Number = 'Number',
  String = 'String',
  Boolean = 'Boolean',
  Void = 'Void',
  None = 'None',
  Array = 'Array',
  Object = 'Object',
  Function = 'Function',
  Class = 'Class',
  Any = 'Any',
  Unknown = 'Unknown',
  Union = 'Union',
  Generic = 'Generic',
}

export interface Scope {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'global' | 'function' | 'class' | 'block' | 'module';
  symbols: Map<string, SymbolEntry>;
  children: Scope[];
  line: number;
}

export interface SemanticResult {
  symbolTable: SymbolEntry[];
  scopes: Scope[];
  typeMap: Map<string, InferredType>;
  errors: CompilerError[];
  warnings: CompilerWarning[];
  stats: SemanticStats;
}

export interface SemanticStats {
  totalSymbols: number;
  totalScopes: number;
  unusedSymbols: number;
  typeErrors: number;
  globalVariables: number;
  maxScopeDepth: number;
}

// ─── IR Types (Intermediate Representation) ───────────────────────────────

export enum IROpcode {
  // Arithmetic
  ADD = 'ADD',
  SUB = 'SUB',
  MUL = 'MUL',
  DIV = 'DIV',
  MOD = 'MOD',
  POW = 'POW',
  NEG = 'NEG',

  // Bitwise
  AND = 'AND',
  OR = 'OR',
  XOR = 'XOR',
  NOT = 'NOT',
  SHL = 'SHL',
  SHR = 'SHR',

  // Comparison
  EQ = 'EQ',
  NE = 'NE',
  LT = 'LT',
  LE = 'LE',
  GT = 'GT',
  GE = 'GE',

  // Control flow
  JMP = 'JMP',
  JZ = 'JZ',
  JNZ = 'JNZ',
  CALL = 'CALL',
  RET = 'RET',
  LABEL = 'LABEL',

  // Memory/Variable
  LOAD = 'LOAD',
  STORE = 'STORE',
  LOAD_CONST = 'LOAD_CONST',
  LOAD_MEMBER = 'LOAD_MEMBER',
  STORE_MEMBER = 'STORE_MEMBER',
  LOAD_INDEX = 'LOAD_INDEX',
  STORE_INDEX = 'STORE_INDEX',

  // I/O
  PRINT = 'PRINT',
  READ = 'READ',

  // Type operations
  CAST = 'CAST',
  TYPEOF = 'TYPEOF',

  // Special
  NOP = 'NOP',
  PHI = 'PHI',
  ALLOC = 'ALLOC',
  FREE = 'FREE',
  PARAM = 'PARAM',
}

export interface IRInstruction {
  opcode: IROpcode;
  /** Result destination (temporary or variable name) */
  dest?: string;
  /** First operand */
  operand1?: string;
  /** Second operand */
  operand2?: string;
  /** For LOAD_CONST: the literal value */
  value?: unknown;
  /** Source location for debugging */
  loc?: SourceLocation;
  /** Unique instruction ID */
  id: string;
}

export interface IRBasicBlock {
  label: string;
  instructions: IRInstruction[];
  /** Successor block labels */
  successors: string[];
  /** Predecessor block labels */
  predecessors: string[];
}

export interface IRFunction {
  name: string;
  params: string[];
  blocks: IRBasicBlock[];
  entryBlock: string;
  tempCounter: number;
}

export interface IRProgram {
  functions: IRFunction[];
  globals: IRInstruction[];
  mainFunction: string;
  stats: IRStats;
}

export interface IRStats {
  totalInstructions: number;
  totalBlocks: number;
  totalFunctions: number;
  totalTemps: number;
}

export interface IRGenerationResult {
  program: IRProgram;
  errors: CompilerError[];
  stats: IRStats;
}

// ─── Optimization Types ──────────────────────────────────────────────────

export interface OptimizationPass {
  name: string;
  description: string;
  run(program: IRProgram): IRProgram;
}

export interface OptimizationResult {
  program: IRProgram;
  passes: OptimizationPassResult[];
  stats: OptimizationStats;
}

export interface OptimizationPassResult {
  name: string;
  applied: number;
  details: string;
}

export interface OptimizationStats {
  instructionsBefore: number;
  instructionsAfter: number;
  reduction: number;
  reductionPercent: number;
  passesApplied: number;
  constantsFolded: number;
  deadCodeEliminated: number;
  commonSubExprEliminated: number;
}

// ─── Security Analysis Types ──────────────────────────────────────────────

export enum SecuritySeverity {
  Critical = 'critical',
  High = 'high',
  Medium = 'medium',
  Low = 'low',
  Info = 'info',
}

export interface SecurityFinding {
  rule: string;
  message: string;
  severity: SecuritySeverity;
  node: ASTNode;
  category: SecurityCategory;
}

export enum SecurityCategory {
  SystemExecution = 'SystemExecution',
  FileAccess = 'FileAccess',
  NetworkAccess = 'NetworkAccess',
  DynamicCode = 'DynamicCode',
  MemoryManipulation = 'MemoryManipulation',
  InfiniteLoop = 'InfiniteLoop',
  InformationLeak = 'InformationLeak',
  PrivilegeEscalation = 'PrivilegeEscalation',
  DangerousImport = 'DangerousImport',
  UnsafeOperation = 'UnsafeOperation',
}

export interface SecurityReport {
  safe: boolean;
  riskLevel: SecuritySeverity;
  findings: SecurityFinding[];
  blockingFindings: SecurityFinding[];
  warningFindings: SecurityFinding[];
  stats: SecurityStats;
}

export interface SecurityStats {
  totalChecks: number;
  blocked: number;
  warnings: number;
  categories: Record<string, number>;
}

// ─── Pipeline Types ──────────────────────────────────────────────────────

export interface CompilerError {
  phase: CompilerPhase;
  message: string;
  line?: number;
  col?: number;
  severity: 'error' | 'warning';
  raw?: string;
  code?: string;
}

export interface CompilerWarning {
  phase: CompilerPhase;
  message: string;
  line?: number;
  col?: number;
  raw?: string;
}

export enum CompilerPhase {
  LexicalAnalysis = 'lexical_analysis',
  Parsing = 'parsing',
  SemanticAnalysis = 'semantic_analysis',
  IRGeneration = 'ir_generation',
  Optimization = 'optimization',
  SecurityAnalysis = 'security_analysis',
  CodeGeneration = 'code_generation',
  Compilation = 'compilation',
  Execution = 'execution',
  OutputProcessing = 'output_processing',
}

export type PhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PhaseResult {
  phase: CompilerPhase;
  status: PhaseStatus;
  durationMs: number;
  data?: unknown;
  errors: CompilerError[];
  warnings: CompilerWarning[];
}

export interface PipelineResult {
  success: boolean;
  exitCode: number | null;
  totalDurationMs: number;
  phases: Record<CompilerPhase, PhaseResult>;
  diagnostics: CompilerError[];
  metrics: PipelineMetrics;
}

export interface PipelineMetrics {
  linesOfCode: number;
  totalTokens: number;
  totalASTNodes: number;
  cyclomaticComplexity: number;
  totalSymbols: number;
  totalScopes: number;
  irInstructions: number;
  optimizedInstructions: number;
  optimizationReduction: number;
  riskLevel: SecuritySeverity;
  astValid: boolean;
}

// ─── Supported Languages ─────────────────────────────────────────────────

export type SupportedLanguage = 'python' | 'c' | 'cpp' | 'java' | 'javascript';

export function normalizeLanguage(lang: string): SupportedLanguage {
  const l = lang.toLowerCase().replace(/[^a-z]/g, '');
  if (l === 'python' || l === 'py') return 'python';
  if (l === 'cpp' || l === 'cplusplus') return 'cpp';
  if (l === 'c') return 'c';
  if (l === 'java') return 'java';
  if (l === 'javascript' || l === 'js' || l === 'typescript' || l === 'ts') return 'javascript';
  return 'javascript';
}

// ─── Utility ─────────────────────────────────────────────────────────────

let nodeIdCounter = 0;
export function generateNodeId(): string {
  return `n${++nodeIdCounter}`;
}

let instrIdCounter = 0;
export function generateInstrId(): string {
  return `i${++instrIdCounter}`;
}

export function resetCounters(): void {
  nodeIdCounter = 0;
  instrIdCounter = 0;
}

// ─── Code Generation Types ────────────────────────────────────────────────

export type ExecutionMode = 'ir_vm' | 'codegen' | 'native';

export interface CodegenResult {
  /** Generated source code in the target language */
  code: string;
  /** The language of the generated code */
  language: SupportedLanguage;
  /** Whether code generation was fully successful */
  success: boolean;
  /** Features that could not be code-generated (fallback triggers) */
  unsupportedFeatures: string[];
  /** Statistics about the generated code */
  stats: CodegenStats;
  /** Any errors during code generation */
  errors: CompilerError[];
}

export interface CodegenStats {
  /** Number of IR instructions processed */
  instructionsProcessed: number;
  /** Number of lines in generated code */
  linesGenerated: number;
  /** Number of functions generated */
  functionsGenerated: number;
  /** Whether control flow was fully reconstructed */
  controlFlowReconstructed: boolean;
  /** Number of basic blocks processed */
  blocksProcessed: number;
}

// ─── IR Virtual Machine Types ─────────────────────────────────────────────

export interface VMState {
  /** Variable store: name → value */
  variables: Map<string, unknown>;
  /** Call stack frames */
  callStack: VMFrame[];
  /** Output buffer */
  output: string[];
  /** Whether the VM has halted */
  halted: boolean;
  /** Current instruction pointer (per function) */
  instructionPointer: number;
  /** Current function being executed */
  currentFunction: string;
  /** Step counter for infinite loop detection */
  stepCount: number;
}

export interface VMFrame {
  /** Function name */
  functionName: string;
  /** Return address (instruction index in caller) */
  returnAddress: number;
  /** Return function name */
  returnFunction: string;
  /** Local variables snapshot */
  locals: Map<string, unknown>;
  /** Result destination in caller */
  resultDest: string | null;
}

export interface VMResult {
  /** Whether execution completed successfully */
  success: boolean;
  /** Captured output lines */
  output: string[];
  /** Exit code (0 = success) */
  exitCode: number;
  /** Execution time in ms */
  executionTimeMs: number;
  /** Error message if execution failed */
  error?: string;
  /** Total steps executed */
  stepsExecuted: number;
}

// ─── Execution Engine Types ───────────────────────────────────────────────

export interface ExecutionPlan {
  /** Which execution mode to use */
  mode: ExecutionMode;
  /** Reason for choosing this mode */
  reason: string;
  /** Whether the IR is complete enough for codegen/VM */
  irComplete: boolean;
  /** Complexity assessment of the program */
  complexity: 'simple' | 'moderate' | 'complex';
  /** Features that require native execution */
  nativeRequiredFeatures: string[];
}

export interface ExecutionEngineResult {
  /** The execution mode that was actually used */
  mode: ExecutionMode;
  /** Code generation result (if codegen mode) */
  codegenResult?: CodegenResult;
  /** VM execution result (if IR VM mode) */
  vmResult?: VMResult;
  /** Execution plan */
  plan: ExecutionPlan;
}
