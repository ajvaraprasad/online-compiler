/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge Compiler — Execution Engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The "brain" that decides HOW to execute code:
 *   - IR VM:   Direct interpretation of three-address code
 *   - Codegen: Translate IR to target source, then compile natively
 *   - Native:  Direct native execution (safest fallback)
 *
 * Decision Logic:
 *   1. Native-only features (imports, exceptions, external calls, etc.) → native
 *   2. Complexity assessment (function/block/instruction counts)
 *   3. Language-specific heuristics
 *   4. Semantic analysis input (if available)
 */

import type {
  ExecutionMode,
  ExecutionPlan,
  IRProgram,
  IRFunction,
  IRInstruction,
  IROpcode,
  SupportedLanguage,
  SemanticResult,
  SymbolKind,
} from '../types';

// ─── Built-in Functions per Language ─────────────────────────────────────

const BUILTINS: Record<SupportedLanguage, Set<string>> = {
  python: new Set([
    'print', 'input', 'len', 'range', 'abs', 'str', 'int', 'float',
    'type', 'isinstance', 'list', 'dict', 'set', 'tuple', 'enumerate',
    'zip', 'map', 'filter', 'sorted', 'min', 'max', 'sum', 'round', 'open',
  ]),
  javascript: new Set([
    'console.log', 'console.error', 'console.warn', 'console.info',
    'Math.abs', 'Math.floor', 'Math.ceil', 'Math.round', 'Math.max',
    'Math.min', 'Math.pow', 'Math.sqrt', 'Math.random',
    'parseInt', 'parseFloat', 'String', 'Number', 'Boolean',
    'Array.isArray', 'Array.from', 'Array.of',
    'JSON.stringify', 'JSON.parse',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'Promise.resolve', 'Promise.all', 'Promise.race',
  ]),
  c: new Set([
    'printf', 'scanf', 'fprintf', 'fscanf', 'sprintf', 'sscanf',
    'malloc', 'calloc', 'realloc', 'free', 'sizeof',
    'strlen', 'strcmp', 'strncmp', 'strcpy', 'strncpy', 'strcat', 'strncat',
    'abs', 'sqrt', 'pow', 'sin', 'cos', 'tan', 'log', 'log10', 'exp',
    'rand', 'srand', 'time', 'clock',
    'exit', 'abort', 'atexit',
    'fopen', 'fclose', 'fgets', 'fputs', 'feof', 'ferror',
    'memcpy', 'memmove', 'memset', 'memcmp',
  ]),
  cpp: new Set([
    'cout', 'cin', 'endl', 'cerr', 'clog',
    'std::cout', 'std::cin', 'std::endl', 'std::cerr', 'std::clog',
    'std::string', 'std::vector', 'std::map', 'std::set', 'std::unordered_map',
    'std::unordered_set', 'std::list', 'std::deque', 'std::queue', 'std::stack',
    'std::sort', 'std::find', 'std::binary_search', 'std::lower_bound', 'std::upper_bound',
    'std::min', 'std::max', 'std::abs', 'std::sqrt', 'std::pow',
    'std::make_shared', 'std::make_unique', 'std::make_pair',
    'malloc', 'free', 'sizeof', 'strlen', 'abs', 'sqrt', 'pow', 'exit',
  ]),
  java: new Set([
    'System.out.println', 'System.out.print', 'System.out.printf',
    'System.err.println', 'System.err.print', 'System.err.printf',
    'String.valueOf', 'String.format', 'String.join',
    'Integer.parseInt', 'Integer.toString', 'Integer.valueOf',
    'Double.parseDouble', 'Double.toString', 'Double.valueOf',
    'Long.parseLong', 'Long.toString', 'Long.valueOf',
    'Math.abs', 'Math.sqrt', 'Math.pow', 'Math.max', 'Math.min',
    'Math.random', 'Math.floor', 'Math.ceil', 'Math.round',
    'Arrays.toString', 'Arrays.sort', 'Arrays.asList', 'Arrays.copyOf',
    'Collections.sort', 'Collections.max', 'Collections.min', 'Collections.reverse',
    'Scanner',
  ]),
};

// ─── Feature Counting ───────────────────────────────────────────────────

export interface FeatureCounts {
  importCount: number;
  allocCount: number;
  memberAccessCount: number;
  tryCatchCount: number;
  nopCount: number;
  callCount: number;
  externalCallCount: number;
  readCount: number;
  totalInstructions: number;
  totalFunctions: number;
  totalBlocks: number;
}

/**
 * Walk all instructions in an IR program and count various features
 * that influence the execution mode decision.
 */
export function countFeatures(program: IRProgram): FeatureCounts {
  const defined = getDefinedFunctions(program);

  let importCount = 0;
  let allocCount = 0;
  let memberAccessCount = 0;
  let tryCatchCount = 0;
  let nopCount = 0;
  let callCount = 0;
  let externalCallCount = 0;
  let readCount = 0;
  let totalInstructions = 0;

  // Count globals
  for (const instr of program.globals) {
    totalInstructions++;
    classifyInstruction(instr, defined, {
      incImport: () => importCount++,
      incAlloc: () => allocCount++,
      incMember: () => memberAccessCount++,
      incTryCatch: () => tryCatchCount++,
      incNop: () => nopCount++,
      incCall: () => callCount++,
      incExternalCall: () => externalCallCount++,
      incRead: () => readCount++,
    });
  }

  // Count instructions in all functions and blocks
  let totalBlocks = 0;
  for (const fn of program.functions) {
    for (const block of fn.blocks) {
      totalBlocks++;
      for (const instr of block.instructions) {
        totalInstructions++;
        classifyInstruction(instr, defined, {
          incImport: () => importCount++,
          incAlloc: () => allocCount++,
          incMember: () => memberAccessCount++,
          incTryCatch: () => tryCatchCount++,
          incNop: () => nopCount++,
          incCall: () => callCount++,
          incExternalCall: () => externalCallCount++,
          incRead: () => readCount++,
        });
      }
    }
  }

  return {
    importCount,
    allocCount,
    memberAccessCount,
    tryCatchCount,
    nopCount,
    callCount,
    externalCallCount,
    readCount,
    totalInstructions,
    totalFunctions: program.functions.length,
    totalBlocks,
  };
}

/** Helper: classify a single instruction and invoke the appropriate counter callback */
function classifyInstruction(
  instr: IRInstruction,
  definedFunctions: Set<string>,
  callbacks: {
    incImport: () => void;
    incAlloc: () => void;
    incMember: () => void;
    incTryCatch: () => void;
    incNop: () => void;
    incCall: () => void;
    incExternalCall: () => void;
    incRead: () => void;
  }
): void {
  const { incImport, incAlloc, incMember, incTryCatch, incNop, incCall, incExternalCall, incRead } = callbacks;

  switch (instr.opcode) {
    // NOP — signals unsupported/placeholder code
    case 'NOP' as IROpcode:
      incNop();
      break;

    // ALLOC — memory/object allocation
    case 'ALLOC' as IROpcode:
      incAlloc();
      break;

    // Member access — object manipulation
    case 'LOAD_MEMBER' as IROpcode:
    case 'STORE_MEMBER' as IROpcode:
      incMember();
      break;

    // CALL — function calls
    case 'CALL' as IROpcode: {
      incCall();
      const target = instr.operand1;
      if (target && !definedFunctions.has(target)) {
        // Not defined locally — check if it's built-in (we check per-language later in planExecution)
        // For counting purposes, we mark it; the planExecution function does the built-in check.
        // We conservatively mark as external here; built-in resolution happens at plan time.
        incExternalCall();
      }
      break;
    }

    // READ — stdin input (input(), scanf(), cin, Scanner, readline)
    // This is CRITICAL: programs with READ instructions MUST use native+PTY
    // because the IR VM cannot handle interactive stdin.
    case 'READ' as IROpcode:
      incRead();
      break;

    // PRINT can also indicate the program does I/O, but PRINT alone
    // doesn't require interactive terminal. Only READ does.

    // Import-like instructions: we treat LOAD_CONST of string values that start with
    // "import" as imports (some IR generators encode imports this way).
    // Also, any ALLOC of a class with method calls is handled via allocCount + memberAccessCount.
    default:
      break;
  }

  // Try/catch detection: JMP instructions that jump to labels containing "catch" or "exception"
  // and JZ/JNZ that test exception-related temporaries
  if (
    (instr.opcode === 'JMP' as IROpcode ||
      instr.opcode === 'JZ' as IROpcode ||
      instr.opcode === 'JNZ' as IROpcode) &&
    instr.operand1
  ) {
    const label = instr.operand1.toLowerCase();
    if (label.includes('catch') || label.includes('exception') || label.includes('try') || label.includes('finally')) {
      incTryCatch();
    }
  }
}

// ─── Helper: Get Defined Functions ──────────────────────────────────────

/**
 * Returns a Set of all function names defined in the IR program.
 */
export function getDefinedFunctions(program: IRProgram): Set<string> {
  const names = new Set<string>();
  for (const fn of program.functions) {
    names.add(fn.name);
  }
  return names;
}

// ─── Helper: Get All CALL Targets ───────────────────────────────────────

/**
 * Walk through all instructions in all functions and collect every CALL target.
 */
export function getCallTargets(program: IRProgram): Set<string> {
  const targets = new Set<string>();

  // Check globals
  for (const instr of program.globals) {
    if (instr.opcode === ('CALL' as IROpcode) && instr.operand1) {
      targets.add(instr.operand1);
    }
  }

  // Check all functions and blocks
  for (const fn of program.functions) {
    for (const block of fn.blocks) {
      for (const instr of block.instructions) {
        if (instr.opcode === ('CALL' as IROpcode) && instr.operand1) {
          targets.add(instr.operand1);
        }
      }
    }
  }

  return targets;
}

// ─── Helper: Get External (Non-Builtin, Non-Defined) Call Targets ───────

/**
 * Returns CALL targets that are neither defined in the program nor built-in
 * for the given language.
 */
export function getExternalCallTargets(
  program: IRProgram,
  language: SupportedLanguage
): string[] {
  const defined = getDefinedFunctions(program);
  const builtins = BUILTINS[language];
  const allTargets = getCallTargets(program);

  const external: string[] = [];
  for (const target of allTargets) {
    if (!defined.has(target) && !builtins.has(target)) {
      external.push(target);
    }
  }
  return external;
}

// ─── Helper: Determine Complexity ───────────────────────────────────────

type Complexity = 'simple' | 'moderate' | 'complex';

function determineComplexity(features: FeatureCounts): Complexity {
  const { totalFunctions, totalBlocks, totalInstructions } = features;

  // Simple: ≤3 functions, ≤10 blocks, no complex features
  if (totalFunctions <= 3 && totalBlocks <= 10 && totalInstructions <= 50) {
    return 'simple';
  }

  // Moderate: ≤10 functions, ≤30 blocks
  if (totalFunctions <= 10 && totalBlocks <= 30 && totalInstructions <= 200) {
    return 'moderate';
  }

  // Complex: anything larger
  return 'complex';
}

// ─── Main: planExecution ────────────────────────────────────────────────

/**
 * Analyze an IR program and determine the best execution path.
 *
 * Decision priority:
 *   1. Native-only features → force native
 *   2. Complexity + language heuristics → ir_vm | codegen | native
 *   3. Semantic analysis input (if available) → refine decision
 *   4. Fallback → native (safest)
 */
export function planExecution(
  program: IRProgram,
  language: SupportedLanguage,
  semanticResult?: SemanticResult | null,
  sourceCode?: string
): ExecutionPlan {
  const features = countFeatures(program);
  const complexity = determineComplexity(features);
  const definedFunctions = getDefinedFunctions(program);
  const builtins = BUILTINS[language];
  const externalCalls = getExternalCallTargets(program, language);

  // ── Step 0: Source-level input detection ────────────────────────────────
  // Check the raw source code for input patterns BEFORE analyzing IR.
  // This catches cases where the IR generator doesn't emit READ instructions
  // but the program still needs interactive stdin.
  const sourceNeedsInput = sourceCode ? detectInputInSource(sourceCode, language) : false;

  // ── Step 0.5: Compiled languages always use native execution ──────────
  // C, C++, and Java are compiled languages that need a real compiler/runtime.
  // The IR VM cannot handle:
  //   - C/C++: printf, scanf, malloc, pointers, format specifiers, stdio
  //   - Java: System.out.println, class structure, type system, Scanner
  // Even "simple" programs like printf("Hello") fail in the IR VM
  // because the VM doesn't implement these language-specific features.
  if (language === 'c' || language === 'cpp' || language === 'java') {
    const compilerName = language === 'cpp' ? 'g++' : language === 'java' ? 'javac/java' : 'gcc';
    const langLabel = language === 'cpp' ? 'C++' : language === 'java' ? 'Java' : 'C';
    return {
      mode: 'native',
      reason: `${langLabel} is a compiled language — native execution with ${compilerName} is required. ` +
        `The IR VM does not implement ${langLabel} standard library functions, ` +
        `type system, or runtime semantics. Native compilation ensures correct execution.`,
      irComplete: false,
      complexity,
      nativeRequiredFeatures: ['compiled_language'],
    };
  }

  // ── Step 1: Check for native-only features ──────────────────────────
  const nativeRequiredFeatures: string[] = [];

  // 1a. IMPORT instructions — the program uses external libraries
  if (features.importCount > 0) {
    nativeRequiredFeatures.push(`import (${features.importCount} import instruction(s))`);
  }

  // 1b. ALLOC for classes/objects with method calls
  if (features.allocCount > 0 && features.memberAccessCount > 0) {
    nativeRequiredFeatures.push(
      `class/object allocation with member access (${features.allocCount} alloc(s), ${features.memberAccessCount} member access(es))`
    );
  }

  // 1c. TRY/CATCH patterns (exception handling)
  if (features.tryCatchCount > 0) {
    nativeRequiredFeatures.push(
      `exception handling (${features.tryCatchCount} try/catch pattern(s))`
    );
  }

  // 1d. CALL to external (non-builtin, non-defined) functions
  if (externalCalls.length > 0) {
    nativeRequiredFeatures.push(
      `external function calls (${externalCalls.join(', ')})`
    );
  }

  // 1e. STORE_MEMBER/LOAD_MEMBER for complex object manipulation
  // (even without ALLOC — e.g., manipulating objects passed as parameters)
  if (features.memberAccessCount > 3) {
    nativeRequiredFeatures.push(
      `complex object manipulation (${features.memberAccessCount} member access(es))`
    );
  }

  // 1f. More than 5 NOP instructions (suggests many unsupported features)
  if (features.nopCount > 5) {
    nativeRequiredFeatures.push(
      `high NOP count (${features.nopCount} NOP instructions suggest unsupported features)`
    );
  }

  // 1g. IR is empty or insufficient (parsing may have failed)
  if (features.totalInstructions === 0 || features.totalBlocks === 0) {
    nativeRequiredFeatures.push(
      `IR is empty or insufficient (${features.totalInstructions} instructions, ${features.totalBlocks} blocks) — pipeline likely had parsing errors`
    );
  }

  // 1h. READ instructions — the program reads from stdin (input(), scanf(), etc.)
  // CRITICAL: IR VM cannot handle interactive stdin. Must use native+PTY.
  if (features.readCount > 0) {
    nativeRequiredFeatures.push(
      `program reads from stdin (${features.readCount} input call(s)) — requires interactive terminal (PTY)`
    );
  }

  // 1i. Source-level input detection — catches input() even if IR doesn't have READ
  if (sourceNeedsInput) {
    nativeRequiredFeatures.push(
      `source code contains input functions — requires interactive terminal (PTY)`
    );
  }

  // If any native-only features were found → force native
  if (nativeRequiredFeatures.length > 0) {
    return {
      mode: 'native',
      reason: `Native execution required: ${nativeRequiredFeatures.join('; ')}. ` +
        `The IR does not fully capture these features — direct native compilation is the safest path.`,
      irComplete: false,
      complexity,
      nativeRequiredFeatures,
    };
  }

  // ── Step 2: Semantic analysis input (if available) ──────────────────
  if (semanticResult) {
    const semaNativeFeatures = analyzeSemanticResult(semanticResult, language);
    if (semaNativeFeatures.length > 0) {
      return {
        mode: 'native',
        reason: `Native execution recommended by semantic analysis: ${semaNativeFeatures.join('; ')}. ` +
          `The program's structure requires features beyond IR representation.`,
        irComplete: false,
        complexity,
        nativeRequiredFeatures: [...nativeRequiredFeatures, ...semaNativeFeatures],
      };
    }
  }

  // ── Step 3: Complexity + language-specific heuristics ───────────────

  // Determine if IR is complete (no NOPs, no external calls, no member access = likely complete)
  const irComplete =
    features.nopCount === 0 &&
    externalCalls.length === 0 &&
    features.memberAccessCount === 0 &&
    features.tryCatchCount === 0;

  // Language-specific preference
  if (complexity === 'simple') {
    // Simple programs: prefer ir_vm, especially for Python
    if (language === 'python') {
      return {
        mode: 'ir_vm',
        reason: `Program is simple (${features.totalFunctions} function(s), ${features.totalBlocks} block(s), ${features.totalInstructions} instruction(s)). ` +
          `Python's interpreted nature makes direct IR VM execution efficient and sufficient.`,
        irComplete,
        complexity,
        nativeRequiredFeatures,
      };
    }

    // For other languages, ir_vm is also fine for simple programs
    return {
      mode: 'ir_vm',
      reason: `Program is simple (${features.totalFunctions} function(s), ${features.totalBlocks} block(s), ${features.totalInstructions} instruction(s)). ` +
        `Direct IR VM execution is sufficient — the IR captures all program semantics.`,
      irComplete,
      complexity,
      nativeRequiredFeatures,
    };
  }

  if (complexity === 'moderate') {
    // Moderate programs: prefer codegen, with language variations
    if (language === 'javascript') {
      return {
        mode: 'codegen',
        reason: `Program is moderate complexity (${features.totalFunctions} function(s), ${features.totalBlocks} block(s)). ` +
          `The optimized IR will be compiled to clean JavaScript — codegen produces idiomatic and efficient output.`,
        irComplete,
        complexity,
        nativeRequiredFeatures,
      };
    }

    if (language === 'c' || language === 'cpp') {
      return {
        mode: 'codegen',
        reason: `Program is moderate complexity (${features.totalFunctions} function(s), ${features.totalBlocks} block(s)). ` +
          `The optimized IR will be compiled to C/C++ source, then compiled natively for maximum performance.`,
        irComplete,
        complexity,
        nativeRequiredFeatures,
      };
    }

    if (language === 'java') {
      // Java: codegen for moderate programs, but class structure can be tricky
      if (features.allocCount > 0 || features.memberAccessCount > 0) {
        return {
          mode: 'native',
          reason: `Program is moderate complexity but contains class/object patterns ` +
            `(${features.allocCount} alloc(s), ${features.memberAccessCount} member access(es)) ` +
            `that are difficult to codegen for Java. Native execution is safer.`,
          irComplete: false,
          complexity,
          nativeRequiredFeatures: [
            ...nativeRequiredFeatures,
            'Java class structure is hard to reconstruct via codegen',
          ],
        };
      }
      return {
        mode: 'codegen',
        reason: `Program is moderate complexity (${features.totalFunctions} function(s), ${features.totalBlocks} block(s)). ` +
          `The optimized IR will be compiled to Java source code.`,
        irComplete,
        complexity,
        nativeRequiredFeatures,
      };
    }

    if (language === 'python') {
      // Python: moderate programs can go either way
      // Prefer ir_vm if IR is complete, codegen otherwise
      if (irComplete) {
        return {
          mode: 'ir_vm',
          reason: `Program is moderate complexity (${features.totalFunctions} function(s), ${features.totalBlocks} block(s)). ` +
            `IR captures all semantics — direct VM execution avoids code generation overhead.`,
          irComplete,
          complexity,
          nativeRequiredFeatures,
        };
      }
      return {
        mode: 'codegen',
        reason: `Program is moderate complexity (${features.totalFunctions} function(s), ${features.totalBlocks} block(s)). ` +
          `The optimized IR will be compiled to Python source code for reliable execution.`,
        irComplete,
        complexity,
        nativeRequiredFeatures,
      };
    }

    // Default for moderate
    return {
      mode: 'codegen',
      reason: `Program is moderate complexity (${features.totalFunctions} function(s), ${features.totalBlocks} block(s)). ` +
        `The optimized IR will be compiled to target source code.`,
      irComplete,
      complexity,
      nativeRequiredFeatures,
    };
  }

  // Complex programs
  if (complexity === 'complex') {
    // Java: always native for complex programs
    if (language === 'java') {
      return {
        mode: 'native',
        reason: `Program is complex (${features.totalFunctions} function(s), ${features.totalBlocks} block(s), ${features.totalInstructions} instruction(s)). ` +
          `Java's class structure and type system make native compilation the most reliable execution path.`,
        irComplete: false,
        complexity,
        nativeRequiredFeatures: [
          ...nativeRequiredFeatures,
          'Complex Java programs require native compilation for reliable execution',
        ],
      };
    }

    // C/C++: codegen for complex (they compile efficiently)
    if (language === 'c' || language === 'cpp') {
      if (irComplete) {
        return {
          mode: 'codegen',
          reason: `Program is complex (${features.totalFunctions} function(s), ${features.totalBlocks} block(s)) but the IR is complete. ` +
            `The optimized IR will be compiled to C/C++ source for native compilation — best performance path.`,
          irComplete,
          complexity,
          nativeRequiredFeatures,
        };
      }
      return {
        mode: 'native',
        reason: `Program is complex (${features.totalFunctions} function(s), ${features.totalBlocks} block(s)) and the IR is incomplete. ` +
          `Native execution is the safest path for complex programs with gaps in IR representation.`,
        irComplete: false,
        complexity,
        nativeRequiredFeatures: [
          ...nativeRequiredFeatures,
          'Complex program with incomplete IR requires native execution',
        ],
      };
    }

    // JavaScript: codegen for complex (can generate large but functional JS)
    if (language === 'javascript') {
      if (irComplete) {
        return {
          mode: 'codegen',
          reason: `Program is complex (${features.totalFunctions} function(s), ${features.totalBlocks} block(s)) but the IR is complete. ` +
            `The optimized IR will be compiled to JavaScript source code.`,
          irComplete,
          complexity,
          nativeRequiredFeatures,
        };
      }
      return {
        mode: 'native',
        reason: `Program is complex (${features.totalFunctions} function(s), ${features.totalBlocks} block(s)) and the IR is incomplete. ` +
          `Native execution via Node.js is the safest path.`,
        irComplete: false,
        complexity,
        nativeRequiredFeatures: [
          ...nativeRequiredFeatures,
          'Complex program with incomplete IR requires native execution',
        ],
      };
    }

    // Python: ir_vm for complex if complete, native otherwise
    if (language === 'python') {
      if (irComplete && features.totalInstructions <= 500) {
        return {
          mode: 'ir_vm',
          reason: `Program is complex (${features.totalFunctions} function(s), ${features.totalBlocks} block(s)) but the IR is complete and manageable. ` +
            `Direct VM execution avoids code generation overhead.`,
          irComplete,
          complexity,
          nativeRequiredFeatures,
        };
      }
      return {
        mode: 'native',
        reason: `Program is complex (${features.totalFunctions} function(s), ${features.totalBlocks} block(s), ${features.totalInstructions} instruction(s)). ` +
          `Native execution via Python interpreter is the safest and most reliable path.`,
        irComplete: false,
        complexity,
        nativeRequiredFeatures: [
          ...nativeRequiredFeatures,
          'Complex Python program requires native interpreter execution',
        ],
      };
    }

    // Default for complex: native (safest fallback)
    return {
      mode: 'native',
      reason: `Program is complex (${features.totalFunctions} function(s), ${features.totalBlocks} block(s), ${features.totalInstructions} instruction(s)). ` +
        `Native execution is the safest path for complex programs.`,
      irComplete: false,
      complexity,
      nativeRequiredFeatures: [
        ...nativeRequiredFeatures,
        'Complex program requires native execution as safest fallback',
      ],
    };
  }

  // Ultimate fallback — should never reach here but just in case
  return {
    mode: 'native',
    reason: 'Defaulting to native execution as the safest option.',
    irComplete: false,
    complexity,
    nativeRequiredFeatures: [...nativeRequiredFeatures, 'Default safe fallback'],
  };
}

// ─── Helper: Analyze Semantic Result ────────────────────────────────────

/**
 * Examine the semantic analysis result for features that require native execution.
 * Returns a list of feature descriptions that force native mode.
 */
function analyzeSemanticResult(
  semanticResult: SemanticResult,
  language: SupportedLanguage
): string[] {
  const features: string[] = [];

  // Check symbol table for import declarations
  const importSymbols = semanticResult.symbolTable.filter(
    (sym) => sym.kind === ('Import' as SymbolKind)
  );
  if (importSymbols.length > 0) {
    const importNames = importSymbols.map((s) => s.name).join(', ');
    features.push(`semantic analysis found import declarations (${importNames})`);
  }

  // Check symbol table for class declarations with methods
  const classSymbols = semanticResult.symbolTable.filter(
    (sym) => sym.kind === ('Class' as SymbolKind)
  );
  if (classSymbols.length > 0) {
    // Check scopes for class scopes that contain function members
    const classScopes = semanticResult.scopes.filter((s) => s.kind === 'class');
    const classesWithMethods = classScopes.filter((scope) => {
      const methodSymbols = Array.from(scope.symbols.values()).filter(
        (sym) => sym.kind === ('Function' as SymbolKind)
      );
      return methodSymbols.length > 0;
    });

    if (classesWithMethods.length > 0) {
      features.push(
        `semantic analysis found class declarations with methods (${classesWithMethods.map((s) => s.name).join(', ')})`
      );
    }
  }

  // Check for only simple variable/flow → confirm ir_vm is fine
  // This is the inverse: if semantic analysis shows only simple constructs,
  // it reinforces the ir_vm decision (handled by the caller already).
  // But if there are complex type relationships, we flag them.
  const complexTypes = Array.from(semanticResult.typeMap.values()).filter(
    (t) =>
      t.kind === ('Class' as unknown) ||
      t.kind === ('Union' as unknown) ||
      t.kind === ('Generic' as unknown)
  );
  if (complexTypes.length > 10) {
    features.push(
      `semantic analysis found complex type relationships (${complexTypes.length} complex types)`
    );
  }

  // Java-specific: any class declaration at all suggests native is preferred for complex programs
  if (language === 'java' && classSymbols.length > 2) {
    features.push(
      `Java program has multiple class declarations (${classSymbols.length} classes) — class structure is hard to codegen`
    );
  }

  return features;
}

// ─── Helper: Recount external calls with built-in awareness ─────────────

/**
 * Given a program and language, return the count of external (non-builtin, non-defined) calls.
 * This is used by countFeatures which doesn't have language context.
 */
export function countExternalCalls(
  program: IRProgram,
  language: SupportedLanguage
): number {
  return getExternalCallTargets(program, language).length;
}

// ─── Source-Level Input Detection ──────────────────────────────────────────

/**
 * Detects whether the source code contains input-reading functions.
 * This is the LAST LINE OF DEFENSE: even if the IR generator doesn't
 * emit READ instructions, we MUST force native+PTY mode for programs
 * that call input(), scanf(), cin, Scanner, readline(), etc.
 *
 * Without this, the IR VM would silently produce no output for programs
 * that need interactive input — the user would see a blank terminal.
 */
const INPUT_PATTERNS: Record<SupportedLanguage, RegExp[]> = {
  python: [
    /\binput\s*\(/,           // input()
    /\bsys\.stdin/,            // sys.stdin
    /\braw_input\s*\(/,        // raw_input() (Python 2)
  ],
  javascript: [
    /\breadline\s*\(/,         // readline()
    /\bprompt\s*\(/,           // prompt()
    /\.question\s*\(/,         // readline-sync .question()
    /\.prompt\s*\(/,           // inquirer .prompt()
    /process\.stdin/,          // process.stdin
  ],
  c: [
    /\bscanf\s*\(/,            // scanf()
    /\bfscanf\s*\(/,           // fscanf()
    /\bsscanf\s*\(/,           // sscanf()
    /\bgets\s*\(/,             // gets()
    /\bfgets\s*\(/,            // fgets()
    /\bgetchar\s*\(/,          // getchar()
    /\bgetch\s*\(/,            // getch()
    /\bgetc\s*\(/,             // getc()
    /\bread\s*\(/,             // read()
  ],
  cpp: [
    /\bcin\s*>>/,              // cin >>
    /\bscanf\s*\(/,            // scanf()
    /\bgets\s*\(/,             // gets()
    /\bfgets\s*\(/,            // fgets()
    /\bgetchar\s*\(/,          // getchar()
    /\bgetline\s*\(/,          // getline()
  ],
  java: [
    /\bScanner\s/,             // Scanner
    /\.nextLine\s*\(/,         // .nextLine()
    /\.nextInt\s*\(/,          // .nextInt()
    /\.nextDouble\s*\(/,       // .nextDouble()
    /\.next\s*\(/,             // .next()
    /\.nextByte\s*\(/,         // .nextByte()
    /\.nextFloat\s*\(/,        // .nextFloat()
    /\.nextLong\s*\(/,         // .nextLong()
    /\bBufferedReader/,        // BufferedReader
    /\bConsole\s*\./,          // Console.
    /System\.in/,              // System.in
  ],
};

function detectInputInSource(sourceCode: string, language: SupportedLanguage): boolean {
  const patterns = INPUT_PATTERNS[language];
  if (!patterns) return false;

  // Remove comments to avoid false positives
  let cleanCode = sourceCode;

  // Remove single-line comments
  if (language === 'python') {
    cleanCode = cleanCode.replace(/#.*$/gm, '');
    // Remove triple-quoted strings (might contain fake patterns)
    cleanCode = cleanCode.replace(/"""[\s\S]*?"""/g, '""');
    cleanCode = cleanCode.replace(/'''[\s\S]*?'''/g, "''");
  } else {
    cleanCode = cleanCode.replace(/\/\/.*$/gm, '');
    // Remove multi-line comments
    cleanCode = cleanCode.replace(/\/\*[\s\S]*?\*\//g, '');
  }

  // Remove string literals (they might contain fake patterns like "input()" in a string)
  if (language === 'python') {
    cleanCode = cleanCode.replace(/f?r?b?("""|''')[\s\S]*?\1/g, '""');
    cleanCode = cleanCode.replace(/f?r?b?"[^"]*"/g, '""');
    cleanCode = cleanCode.replace(/f?r?b?'[^']*'/g, "''");
  } else {
    cleanCode = cleanCode.replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '""');
    cleanCode = cleanCode.replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, "''");
  }

  for (const pattern of patterns) {
    if (pattern.test(cleanCode)) {
      return true;
    }
  }
  return false;
}

// ─── Re-export types for convenience ────────────────────────────────────

export type { ExecutionPlan, FeatureCounts };
