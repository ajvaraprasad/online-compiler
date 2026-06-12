/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge Compiler — IR Code Generator
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Converts optimized IR (three-address code) back into executable source code
 * in the target language. This is the critical "code generation" phase that
 * makes the compiler pipeline REAL — instead of just analyzing code and then
 * running the original source through external compilers, we generate new
 * source code from the optimized IR.
 *
 * Supported targets: Python, JavaScript, C, C++, Java
 *
 * Architecture:
 *   1. Flatten IR — Convert basic blocks to flat instruction list per function
 *   2. Analyze — Detect features requiring native execution, track variables/types
 *   3. Reconstruct Control Flow — Identify if/else, while loops from JZ/JNZ/JMP
 *   4. Generate Code — Walk instructions and emit target-language code
 *   5. Wrap Boilerplate — Add includes, class declarations, main function wrappers
 */

import {
  IROpcode,
  IRInstruction,
  IRBasicBlock,
  IRFunction,
  IRProgram,
  SupportedLanguage,
  CodegenResult,
  CodegenStats,
  CompilerError,
  CompilerPhase,
} from '../types';

// ═════════════════════════════════════════════════════════════════════════════
// Type Inference
// ═════════════════════════════════════════════════════════════════════════════

type InferredVarType = 'int' | 'double' | 'string' | 'boolean' | 'void' | 'unknown';

/** Determine type from a LOAD_CONST value */
function inferTypeFromValue(value: unknown): InferredVarType {
  if (value === null || value === undefined) return 'void';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'double';
  }
  if (typeof value === 'string') return 'string';
  return 'unknown';
}

/** Determine type from an opcode */
function inferTypeFromOpcode(opcode: IROpcode): InferredVarType {
  switch (opcode) {
    case IROpcode.ADD:
    case IROpcode.SUB:
    case IROpcode.MUL:
    case IROpcode.DIV:
    case IROpcode.MOD:
    case IROpcode.POW:
    case IROpcode.NEG:
    case IROpcode.SHL:
    case IROpcode.SHR:
    case IROpcode.AND:
    case IROpcode.OR:
    case IROpcode.XOR:
      return 'int';
    case IROpcode.EQ:
    case IROpcode.NE:
    case IROpcode.LT:
    case IROpcode.LE:
    case IROpcode.GT:
    case IROpcode.GE:
    case IROpcode.NOT:
      return 'boolean';
    case IROpcode.LOAD_CONST:
      return 'unknown'; // will be refined
    case IROpcode.RET:
      return 'void';
    default:
      return 'unknown';
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Utility: Flatten basic blocks into a single instruction list
// ═════════════════════════════════════════════════════════════════════════════

interface FlatInstruction {
  instr: IRInstruction;
  /** Label that should appear before this instruction (if any) */
  labelBefore?: string;
  /** Index in the flat list */
  index: number;
}

function flattenBlocks(func: IRFunction): FlatInstruction[] {
  const result: FlatInstruction[] = [];
  let idx = 0;

  // Build a label→block map
  const blockMap = new Map<string, IRBasicBlock>();
  for (const block of func.blocks) {
    blockMap.set(block.label, block);
  }

  // Walk blocks in order; for each block, emit the label first then instructions
  for (const block of func.blocks) {
    for (let i = 0; i < block.instructions.length; i++) {
      const instr = block.instructions[i];
      if (instr.opcode === IROpcode.LABEL && instr.dest) {
        // LABEL instruction: attach as labelBefore for the next instruction
        // or emit as a standalone marker if it's the last instruction
        if (i + 1 < block.instructions.length) {
          // Attach label to the next instruction
          const nextInstr = block.instructions[i + 1];
          result.push({
            instr: nextInstr,
            labelBefore: instr.dest,
            index: idx++,
          });
          i++; // skip the next instruction since we already processed it
        } else {
          // Label at end of block — emit as standalone
          result.push({
            instr,
            index: idx++,
          });
        }
      } else {
        result.push({ instr, index: idx++ });
      }
    }
  }

  return result;
}

// Alternative: simpler flattening that keeps LABEL instructions as-is
function flattenBlocksSimple(func: IRFunction): IRInstruction[] {
  const result: IRInstruction[] = [];
  for (const block of func.blocks) {
    for (const instr of block.instructions) {
      result.push(instr);
    }
  }
  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// Variable Tracker
// ═════════════════════════════════════════════════════════════════════════════

interface VarInfo {
  name: string;
  type: InferredVarType;
  isTemp: boolean;
  declared: boolean;
}

class VariableTracker {
  private vars = new Map<string, VarInfo>();

  /** Record a variable assignment and infer its type */
  track(dest: string, instr: IRInstruction): void {
    let vtype: InferredVarType = 'unknown';

    if (instr.opcode === IROpcode.LOAD_CONST) {
      vtype = inferTypeFromValue(instr.value);
    } else {
      vtype = inferTypeFromOpcode(instr.opcode);
    }

    const existing = this.vars.get(dest);
    if (existing) {
      // Upgrade type if we have better info
      if (existing.type === 'unknown' && vtype !== 'unknown') {
        existing.type = vtype;
      }
      // If one is int and the other is double, upgrade to double
      if (existing.type === 'int' && vtype === 'double') {
        existing.type = 'double';
      }
    } else {
      this.vars.set(dest, {
        name: dest,
        type: vtype,
        isTemp: dest.startsWith('t') && /^t\d+$/.test(dest),
        declared: false,
      });
    }
  }

  /** Get the type for a variable, considering propagated types from LOAD_CONST */
  getType(name: string): InferredVarType {
    return this.vars.get(name)?.type ?? 'unknown';
  }

  /** Get all tracked variables */
  getAllVars(): VarInfo[] {
    return Array.from(this.vars.values());
  }

  /** Mark a variable as declared */
  markDeclared(name: string): void {
    const v = this.vars.get(name);
    if (v) v.declared = true;
  }

  /** Check if a variable is a temporary */
  isTemp(name: string): boolean {
    return this.vars.get(name)?.isTemp ?? /^t\d+$/.test(name);
  }

  /** Get variable info */
  getVar(name: string): VarInfo | undefined {
    return this.vars.get(name);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Control Flow Analysis
// ═════════════════════════════════════════════════════════════════════════════

interface ControlFlowRegion {
  type: 'if' | 'if_else' | 'while' | 'do_while' | 'plain';
  /** Label of the condition (for while: loop header, for if: the JZ instruction position) */
  condLabel?: string;
  /** Label where the true/then branch starts */
  thenLabel?: string;
  /** Label where the else branch starts */
  elseLabel?: string;
  /** Label after the entire construct */
  endLabel?: string;
  /** Label for loop back edge */
  loopLabel?: string;
}

/**
 * Analyze the flat instruction list to identify structured control flow patterns.
 *
 * Patterns:
 *   if:        JZ else_label   ... JMP end_label  LABEL else_label  ... LABEL end_label
 *   if/else:   same as above but with else body before end_label
 *   while:     LABEL loop_header ... JZ end_label ... JMP loop_header  LABEL end_label
 */
function analyzeControlFlow(instructions: IRInstruction[]): Map<number, ControlFlowRegion> {
  const regions = new Map<number, ControlFlowRegion>();

  // Build a label→index map
  const labelIndex = new Map<string, number>();
  for (let i = 0; i < instructions.length; i++) {
    if (instructions[i].opcode === IROpcode.LABEL && instructions[i].dest) {
      labelIndex.set(instructions[i].dest, i);
    }
  }

  // Walk instructions looking for JZ/JNZ/JMP patterns
  for (let i = 0; i < instructions.length; i++) {
    const instr = instructions[i];

    if (instr.opcode === IROpcode.JZ && instr.dest) {
      const targetLabel = instr.dest;
      const targetIdx = labelIndex.get(targetLabel);

      if (targetIdx !== undefined && targetIdx > i) {
        // Forward jump: this is an if or if/else
        // Look for JMP before the target label (indicates else branch)
        let hasElse = false;
        let endLabel: string | undefined;
        let endIdx: number | undefined;

        // Scan from i+1 to targetIdx-1 for a JMP
        for (let j = targetIdx - 1; j > i; j--) {
          if (instructions[j].opcode === IROpcode.JMP && instructions[j].dest) {
            const jmpTarget = instructions[j].dest;
            const jmpTargetIdx = labelIndex.get(jmpTarget);
            if (jmpTargetIdx !== undefined && jmpTargetIdx > targetIdx) {
              hasElse = true;
              endLabel = jmpTarget;
              endIdx = jmpTargetIdx;
              break;
            }
          }
          // Stop if we hit another LABEL or control flow instruction
          if (instructions[j].opcode === IROpcode.LABEL) break;
        }

        if (hasElse) {
          regions.set(i, {
            type: 'if_else',
            elseLabel: targetLabel,
            endLabel,
          });
        } else {
          regions.set(i, {
            type: 'if',
            elseLabel: targetLabel,
            endLabel: targetLabel, // for if without else, end = else label
          });
        }
      }
    }

    if (instr.opcode === IROpcode.JMP && instr.dest) {
      const targetLabel = instr.dest;
      const targetIdx = labelIndex.get(targetLabel);

      if (targetIdx !== undefined && targetIdx <= i) {
        // Backward jump: this is a while loop
        // The label at targetIdx is the loop header
        regions.set(i, {
          type: 'while',
          loopLabel: targetLabel,
        });
      }
    }
  }

  return regions;
}

// ═════════════════════════════════════════════════════════════════════════════
// Code Emitter — builds output strings with indentation
// ═════════════════════════════════════════════════════════════════════════════

class CodeEmitter {
  private lines: string[] = [];
  private indentLevel = 0;
  private indentStr = '  ';

  setIndent(str: string): void {
    this.indentStr = str;
  }

  indent(): void {
    this.indentLevel++;
  }

  dedent(): void {
    if (this.indentLevel > 0) this.indentLevel--;
  }

  emit(line: string): void {
    this.lines.push(this.indentStr.repeat(this.indentLevel) + line);
  }

  emitRaw(line: string): void {
    this.lines.push(line);
  }

  blank(): void {
    this.lines.push('');
  }

  toString(): string {
    return this.lines.join('\n');
  }

  getLines(): string[] {
    return [...this.lines];
  }

  get lineCount(): number {
    return this.lines.length;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Language-specific helpers
// ═════════════════════════════════════════════════════════════════════════════

/** Escape a string value for embedding in source code */
function escapeString(value: string, language: SupportedLanguage): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');

  // Python prefers single quotes but both work; C/Java/JS use double quotes
  if (language === 'python') {
    // Use single quotes unless the string contains them
    if (!value.includes("'")) {
      return `'${escaped.replace(/\\'/g, "'")}'`;
    }
    return `"${escaped}"`;
  }
  return `"${escaped}"`;
}

/** Format a literal value for the target language */
function formatLiteral(value: unknown, language: SupportedLanguage): string {
  if (value === null || value === undefined) {
    switch (language) {
      case 'python': return 'None';
      case 'javascript': return 'null';
      case 'c':
      case 'cpp': return 'NULL';
      case 'java': return 'null';
    }
  }
  if (typeof value === 'boolean') {
    switch (language) {
      case 'python': return value ? 'True' : 'False';
      case 'javascript': return value ? 'true' : 'false';
      case 'c': return value ? '1' : '0';
      case 'cpp': return value ? 'true' : 'false';
      case 'java': return value ? 'true' : 'false';
    }
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return String(value);
  }
  if (typeof value === 'string') {
    return escapeString(value, language);
  }
  return String(value);
}

/** Map an IR binary operator to the target language operator */
function formatBinaryOp(opcode: IROpcode, _language: SupportedLanguage): string {
  switch (opcode) {
    case IROpcode.ADD: return '+';
    case IROpcode.SUB: return '-';
    case IROpcode.MUL: return '*';
    case IROpcode.DIV: return '/';
    case IROpcode.MOD: return '%';
    case IROpcode.POW: return '**'; // language-specific handling done elsewhere
    case IROpcode.AND: return '&';
    case IROpcode.OR: return '|';
    case IROpcode.XOR: return '^';
    case IROpcode.SHL: return '<<';
    case IROpcode.SHR: return '>>';
    case IROpcode.EQ: return '==';
    case IROpcode.NE: return '!=';
    case IROpcode.LT: return '<';
    case IROpcode.LE: return '<=';
    case IROpcode.GT: return '>';
    case IROpcode.GE: return '>=';
    default: return '/* unknown op */';
  }
}

/** Get the C/C++/Java type for a variable */
function getCType(vtype: InferredVarType, language: SupportedLanguage): string {
  switch (vtype) {
    case 'int': return 'int';
    case 'double': return 'double';
    case 'string':
      if (language === 'c') return 'char*';
      if (language === 'cpp') return 'string';
      if (language === 'java') return 'String';
      return 'char*';
    case 'boolean':
      if (language === 'c') return 'int';
      if (language === 'java') return 'boolean';
      return 'bool';
    case 'void': return 'void';
    default: return 'int'; // default to int for unknown
  }
}

/** Get the PRINT function call for a language */
function formatPrint(value: string, language: SupportedLanguage): string {
  switch (language) {
    case 'python': return `print(${value})`;
    case 'javascript': return `console.log(${value})`;
    case 'c': return `printf("%d\\n", ${value})`;
    case 'cpp': return `cout << ${value} << endl`;
    case 'java': return `System.out.println(${value})`;
  }
}

/** Get the READ function call for a language */
function formatRead(dest: string, language: SupportedLanguage): string {
  switch (language) {
    case 'python': return `${dest} = input()`;
    case 'javascript': return `${dest} = readline()`;
    case 'c': return `scanf("%d", &${dest})`;
    case 'cpp': return `cin >> ${dest}`;
    case 'java': return `${dest} = scanner.nextInt()`;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Unsupported Feature Detection
// ═════════════════════════════════════════════════════════════════════════════

function detectUnsupportedFeatures(program: IRProgram): string[] {
  const unsupported: string[] = [];

  for (const func of program.functions) {
    for (const block of func.blocks) {
      for (const instr of block.instructions) {
        // ALLOC for objects
        if (instr.opcode === IROpcode.ALLOC) {
          const allocType = instr.operand1;
          if (allocType === 'Object' || allocType === 'Array') {
            unsupported.push(`Dynamic allocation (${allocType}) — requires heap management`);
          } else if (allocType && allocType !== 'Array') {
            unsupported.push(`Object allocation (class ${allocType}) — requires class definition`);
          }
        }

        // FREE
        if (instr.opcode === IROpcode.FREE) {
          unsupported.push('Memory deallocation (FREE) — requires manual memory management');
        }

        // LOAD_MEMBER / STORE_MEMBER
        if (instr.opcode === IROpcode.LOAD_MEMBER || instr.opcode === IROpcode.STORE_MEMBER) {
          unsupported.push('Member access (obj.prop) — requires class/object support');
        }

        // LOAD_INDEX / STORE_INDEX
        if (instr.opcode === IROpcode.LOAD_INDEX || instr.opcode === IROpcode.STORE_INDEX) {
          // Index access is common for arrays — only flag if complex
          // For simple integer index access, we can handle it
          // But flag it as potentially unsupported for C
        }

        // PHI
        if (instr.opcode === IROpcode.PHI) {
          unsupported.push('SSA Phi function — requires variable merging at control flow joins');
        }

        // TRY/CATCH pattern detection (CALL __throw)
        if (instr.opcode === IROpcode.CALL && instr.operand1 === '__throw') {
          unsupported.push('Exception throwing — requires try/catch support');
        }
        if (instr.opcode === IROpcode.CALL && instr.operand1 === '__assert_fail') {
          // Assert is manageable
        }

        // CAST with complex types
        if (instr.opcode === IROpcode.CAST && instr.operand2) {
          // Cast is OK for basic types
        }

        // NOP with value (import)
        if (instr.opcode === IROpcode.NOP && instr.value && typeof instr.value === 'string' && instr.value.includes('import')) {
          unsupported.push(`Import (${instr.value}) — requires runtime library support`);
        }
      }
    }
  }

  // Deduplicate
  return [...new Set(unsupported)];
}

// ═════════════════════════════════════════════════════════════════════════════
// Main Code Generation Engine
// ═════════════════════════════════════════════════════════════════════════════

export function generateCode(program: IRProgram, language: SupportedLanguage): CodegenResult {
  const errors: CompilerError[] = [];
  const unsupportedFeatures = detectUnsupportedFeatures(program);

  // Track stats
  let totalInstructions = 0;
  let totalBlocks = 0;
  let functionsGenerated = 0;

  // Count instructions
  for (const func of program.functions) {
    for (const block of func.blocks) {
      totalInstructions += block.instructions.length;
      totalBlocks++;
    }
  }

  // Find the main function
  const mainFunc = program.functions.find(f => f.name === program.mainFunction || f.name === '__main__');
  const otherFuncs = program.functions.filter(f => f !== mainFunc);

  // Generate code based on language
  let code = '';
  let controlFlowReconstructed = true;

  try {
    switch (language) {
      case 'python':
        code = generatePython(program, mainFunc, otherFuncs);
        break;
      case 'javascript':
        code = generateJavaScript(program, mainFunc, otherFuncs);
        break;
      case 'c':
        code = generateC(program, mainFunc, otherFuncs);
        break;
      case 'cpp':
        code = generateCpp(program, mainFunc, otherFuncs);
        break;
      case 'java':
        code = generateJava(program, mainFunc, otherFuncs);
        break;
    }
    functionsGenerated = program.functions.length;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push({
      phase: CompilerPhase.CodeGeneration,
      message: `Code generation failed: ${msg}`,
      severity: 'error',
    });
    controlFlowReconstructed = false;
  }

  const linesGenerated = code.split('\n').length;

  const stats: CodegenStats = {
    instructionsProcessed: totalInstructions,
    linesGenerated,
    functionsGenerated,
    controlFlowReconstructed,
    blocksProcessed: totalBlocks,
  };

  // Determine success: code is generated and no major unsupported features
  // that would prevent execution
  const majorUnsupported = unsupportedFeatures.filter(f =>
    f.includes('Object allocation') ||
    f.includes('Member access') ||
    f.includes('Exception throwing') ||
    f.includes('SSA Phi')
  );

  const success = code.length > 0 && majorUnsupported.length === 0 && errors.length === 0;

  return {
    code,
    language,
    success,
    unsupportedFeatures,
    stats,
    errors,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Python Code Generator
// ═════════════════════════════════════════════════════════════════════════════

function generatePython(
  program: IRProgram,
  mainFunc: IRFunction | undefined,
  otherFuncs: IRFunction[],
): string {
  const emitter = new CodeEmitter();
  emitter.setIndent('    '); // Python uses 4-space indent

  emitter.emit('# Generated from optimized IR by CodeForge');
  emitter.blank();

  // Generate non-main functions first
  for (const func of otherFuncs) {
    generatePythonFunction(emitter, func);
    emitter.blank();
  }

  // Generate main function body (top-level code in Python)
  // isMain=true so we skip the final RET (top-level code doesn't return)
  if (mainFunc) {
    generatePythonFunctionBody(emitter, mainFunc, true);
  }

  return emitter.toString();
}

function generatePythonFunction(emitter: CodeEmitter, func: IRFunction): void {
  const params = func.params.join(', ');
  const funcName = func.name === '__main__' ? 'main' : func.name;
  emitter.emit(`def ${funcName}(${params}):`);
  emitter.indent();
  generatePythonFunctionBody(emitter, func, false);
  emitter.dedent();
}

function generatePythonFunctionBody(emitter: CodeEmitter, func: IRFunction, isMain: boolean = false): void {
  const instructions = flattenBlocksSimple(func);
  const tracker = new VariableTracker();
  const labelSet = new Set<string>();

  // Pre-scan: collect all labels and track variables
  for (const instr of instructions) {
    if (instr.opcode === IROpcode.LABEL && instr.dest) {
      labelSet.add(instr.dest);
    }
    if (instr.dest && instr.opcode !== IROpcode.LABEL && instr.opcode !== IROpcode.JZ &&
        instr.opcode !== IROpcode.JNZ && instr.opcode !== IROpcode.JMP) {
      tracker.track(instr.dest, instr);
    }
  }

  // Build label→index map
  const labelIndex = new Map<string, number>();
  for (let i = 0; i < instructions.length; i++) {
    if (instructions[i].opcode === IROpcode.LABEL && instructions[i].dest) {
      labelIndex.set(instructions[i].dest, i);
    }
  }

  // Track which labels are loop headers (have backward jumps to them)
  const loopHeaders = new Set<string>();
  for (const instr of instructions) {
    if (instr.opcode === IROpcode.JMP && instr.dest) {
      const targetIdx = labelIndex.get(instr.dest);
      // Back edge detection: JMP to a label that appeared earlier
      if (targetIdx !== undefined) {
        const instrIdx = instructions.indexOf(instr);
        if (targetIdx <= instrIdx) {
          loopHeaders.add(instr.dest);
        }
      }
    }
  }

  // Track active control flow constructs
  const openBlocks: Array<{ type: string; endLabel?: string }> = [];

  // Generate code
  for (let i = 0; i < instructions.length; i++) {
    const instr = instructions[i];

    // Handle LABEL
    if (instr.opcode === IROpcode.LABEL && instr.dest) {
      // Check if this label is a loop header
      if (loopHeaders.has(instr.dest)) {
        // Emit while True loop — the exit condition will be handled by JZ/JNZ as if/break
        emitter.emit('while True:');
        emitter.indent();
        openBlocks.push({ type: 'while', endLabel: instr.dest });
        continue;
      }

      // Check if this label closes any open blocks
      while (openBlocks.length > 0) {
        const top = openBlocks[openBlocks.length - 1];
        if (top.endLabel === instr.dest) {
          emitter.dedent();
          openBlocks.pop();
        } else {
          break;
        }
      }

      continue; // Don't emit label as a statement in Python
    }

    // Handle JZ/JNZ — either loop exit (if/break) or if/else
    if (instr.opcode === IROpcode.JZ || instr.opcode === IROpcode.JNZ) {
      if (instr.dest) {
        // Check if we're inside a while loop and this exits it
        const whileBlock = openBlocks.find(b => b.type === 'while');
        if (whileBlock) {
          // This is a loop exit condition — emit as if/break
          const condVar = instr.operand1 || 'True';
          const isJZ = instr.opcode === IROpcode.JZ;
          if (isJZ) {
            // JZ: jump if false → "if not condVar: break"
            emitter.emit(`if not ${condVar}:`);
          } else {
            // JNZ: jump if true → "if condVar: break"
            emitter.emit(`if ${condVar}:`);
          }
          emitter.indent();
          emitter.emit('break');
          emitter.dedent();
        } else {
          // Not inside a loop — this is an if/else
          const targetIdx = labelIndex.get(instr.dest);
          if (targetIdx !== undefined) {
            let hasElse = false;
            for (let j = i + 1; j < targetIdx; j++) {
              if (instructions[j].opcode === IROpcode.JMP && instructions[j].dest) {
                const jmpTarget = labelIndex.get(instructions[j].dest);
                if (jmpTarget !== undefined && jmpTarget > targetIdx) {
                  hasElse = true;
                  openBlocks.push({ type: 'if_then', endLabel: instructions[j].dest });
                  break;
                }
              }
              if (instructions[j].opcode === IROpcode.LABEL) break;
            }

            const condVar = instr.operand1 || 'True';
            const isJZ = instr.opcode === IROpcode.JZ;
            if (hasElse) {
              emitter.emit(`if ${isJZ ? condVar : `not ${condVar}`}:`);
            } else {
              emitter.emit(`if ${isJZ ? condVar : `not ${condVar}`}:`);
              openBlocks.push({ type: 'if_then', endLabel: instr.dest });
            }
            emitter.indent();
          }
        }
      }
      continue;
    }

    if (instr.opcode === IROpcode.JMP && instr.dest) {
      // Check if this is a back-edge (loop continuation)
      const targetIdx = labelIndex.get(instr.dest);
      if (targetIdx !== undefined && targetIdx <= i) {
        // Loop back-edge — just continue (the while True handles looping)
        const top = openBlocks[openBlocks.length - 1];
        if (top && top.type === 'while') {
          emitter.dedent();
          openBlocks.pop();
        }
        continue;
      }

      // Forward JMP: this is the end of a then-block before else
      const top = openBlocks[openBlocks.length - 1];
      if (top && top.type === 'if_then') {
        emitter.dedent();
        openBlocks.pop();
        emitter.emit('else:');
        emitter.indent();
        openBlocks.push({ type: 'if_else', endLabel: instr.dest });
      }
      continue;
    }

    // Handle regular instructions
    emitPythonInstruction(emitter, instr, tracker, isMain);
  }

  // Close any remaining open blocks
  while (openBlocks.length > 0) {
    emitter.dedent();
    openBlocks.pop();
  }

  // If the function body is empty, emit pass
  const code = emitter.toString();
  if (code.trim().split('\n').every(l => l.trim() === '' || l.trim().startsWith('#') || l.trim().startsWith('def '))) {
    // The function body might be empty
  }
}

function emitPythonInstruction(
  emitter: CodeEmitter,
  instr: IRInstruction,
  tracker: VariableTracker,
  isMain: boolean = false,
): void {
  switch (instr.opcode) {
    case IROpcode.LOAD_CONST: {
      if (instr.dest) {
        tracker.track(instr.dest, instr);
        const val = formatLiteral(instr.value, 'python');
        emitter.emit(`${instr.dest} = ${val}`);
      }
      break;
    }

    case IROpcode.LOAD: {
      if (instr.dest && instr.operand1) {
        tracker.track(instr.dest, instr);
        emitter.emit(`${instr.dest} = ${instr.operand1}`);
      }
      break;
    }

    case IROpcode.STORE: {
      if (instr.dest && instr.operand1) {
        emitter.emit(`${instr.dest} = ${instr.operand1}`);
      }
      break;
    }

    case IROpcode.ADD:
    case IROpcode.SUB:
    case IROpcode.MUL:
    case IROpcode.DIV:
    case IROpcode.MOD:
    case IROpcode.AND:
    case IROpcode.OR:
    case IROpcode.XOR:
    case IROpcode.SHL:
    case IROpcode.SHR:
    case IROpcode.EQ:
    case IROpcode.NE:
    case IROpcode.LT:
    case IROpcode.LE:
    case IROpcode.GT:
    case IROpcode.GE: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        tracker.track(instr.dest, instr);
        const op = formatBinaryOp(instr.opcode, 'python');
        // For Python, AND/OR/XOR need special handling (bitwise vs logical)
        let opStr = op;
        if (instr.opcode === IROpcode.AND) opStr = '&';
        if (instr.opcode === IROpcode.OR) opStr = '|';
        emitter.emit(`${instr.dest} = ${instr.operand1} ${opStr} ${instr.operand2}`);
      }
      break;
    }

    case IROpcode.POW: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        tracker.track(instr.dest, instr);
        emitter.emit(`${instr.dest} = ${instr.operand1} ** ${instr.operand2}`);
      }
      break;
    }

    case IROpcode.NEG: {
      if (instr.dest && instr.operand1) {
        tracker.track(instr.dest, instr);
        emitter.emit(`${instr.dest} = -${instr.operand1}`);
      }
      break;
    }

    case IROpcode.NOT: {
      if (instr.dest && instr.operand1) {
        tracker.track(instr.dest, instr);
        // Could be logical not or bitwise not
        const vtype = tracker.getType(instr.operand1);
        if (vtype === 'boolean') {
          emitter.emit(`${instr.dest} = not ${instr.operand1}`);
        } else {
          emitter.emit(`${instr.dest} = ~${instr.operand1}`);
        }
      }
      break;
    }

    case IROpcode.PRINT: {
      const val = instr.operand1 || instr.dest || '';
      if (val) {
        // Determine the print type based on the value type
        const vtype = tracker.getType(val);
        if (vtype === 'string') {
          emitter.emit(`print(${val})`);
        } else {
          emitter.emit(`print(${val})`);
        }
      }
      break;
    }

    case IROpcode.READ: {
      if (instr.dest) {
        emitter.emit(`${instr.dest} = input()`);
      }
      break;
    }

    case IROpcode.CALL: {
      if (instr.dest && instr.operand1) {
        const funcName = instr.operand1;
        const args = buildCallArgs(instr);
        tracker.track(instr.dest, instr);
        emitter.emit(`${instr.dest} = ${funcName}(${args.join(', ')})`);
      } else if (instr.operand1) {
        const funcName = instr.operand1;
        const args = buildCallArgs(instr);
        emitter.emit(`${funcName}(${args.join(', ')})`);
      }
      break;
    }

    case IROpcode.RET: {
      // Skip RET for main/top-level code
      if (isMain) break;
      if (instr.dest) {
        emitter.emit(`return ${instr.dest}`);
      } else {
        emitter.emit('return');
      }
      break;
    }

    case IROpcode.PARAM: {
      // Params are handled in function signature
      break;
    }

    case IROpcode.CAST: {
      if (instr.dest && instr.operand1) {
        const targetType = instr.operand2;
        tracker.track(instr.dest, instr);
        switch (targetType) {
          case 'int':
            emitter.emit(`${instr.dest} = int(${instr.operand1})`);
            break;
          case 'double':
          case 'float':
            emitter.emit(`${instr.dest} = float(${instr.operand1})`);
            break;
          case 'string':
            emitter.emit(`${instr.dest} = str(${instr.operand1})`);
            break;
          default:
            emitter.emit(`${instr.dest} = ${instr.operand1}`);
        }
      }
      break;
    }

    case IROpcode.TYPEOF: {
      if (instr.dest && instr.operand1) {
        tracker.track(instr.dest, instr);
        emitter.emit(`${instr.dest} = type(${instr.operand1})`);
      }
      break;
    }

    case IROpcode.LOAD_MEMBER: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        tracker.track(instr.dest, instr);
        emitter.emit(`${instr.dest} = ${instr.operand1}.${instr.operand2}`);
      }
      break;
    }

    case IROpcode.STORE_MEMBER: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        emitter.emit(`${instr.operand1}.${instr.dest} = ${instr.operand2}`);
      }
      break;
    }

    case IROpcode.LOAD_INDEX: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        tracker.track(instr.dest, instr);
        emitter.emit(`${instr.dest} = ${instr.operand1}[${instr.operand2}]`);
      }
      break;
    }

    case IROpcode.STORE_INDEX: {
      if (instr.operand1 && instr.operand2 && instr.value) {
        emitter.emit(`${instr.operand1}[${instr.operand2}] = ${instr.value}`);
      }
      break;
    }

    case IROpcode.ALLOC: {
      if (instr.dest && instr.operand1) {
        tracker.track(instr.dest, instr);
        if (instr.operand1 === 'Array') {
          emitter.emit(`${instr.dest} = []`);
        } else if (instr.operand1 === 'Object') {
          emitter.emit(`${instr.dest} = {}`);
        } else {
          emitter.emit(`${instr.dest} = ${instr.operand1}()`);
        }
      }
      break;
    }

    case IROpcode.NOP: {
      // Skip NOPs
      break;
    }

    default: {
      // Unknown opcode — emit as comment
      emitter.emit(`# unhandled: ${instr.opcode} ${instr.dest || ''} ${instr.operand1 || ''} ${instr.operand2 || ''}`);
      break;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// JavaScript Code Generator
// ═════════════════════════════════════════════════════════════════════════════

function generateJavaScript(
  program: IRProgram,
  mainFunc: IRFunction | undefined,
  otherFuncs: IRFunction[],
): string {
  const emitter = new CodeEmitter();

  emitter.emit('// Generated from optimized IR by CodeForge');
  emitter.blank();

  // Generate helper for input
  const needsRead = program.functions.some(f =>
    f.blocks.some(b => b.instructions.some(i => i.opcode === IROpcode.READ))
  );
  if (needsRead) {
    emitter.emit('const readline = require("readline-sync");');
    emitter.blank();
  }

  // Generate non-main functions
  for (const func of otherFuncs) {
    generateJSFunction(emitter, func);
    emitter.blank();
  }

  // Generate main function body (top-level code, skip return)
  if (mainFunc) {
    generateJSFunctionBody(emitter, mainFunc, true);
  }

  return emitter.toString();
}

function generateJSFunction(emitter: CodeEmitter, func: IRFunction): void {
  const params = func.params.join(', ');
  const funcName = func.name === '__main__' ? 'main' : func.name;
  emitter.emit(`function ${funcName}(${params}) {`);
  emitter.indent();
  generateJSFunctionBody(emitter, func, false);
  emitter.dedent();
  emitter.emit('}');
}

function generateJSFunctionBody(emitter: CodeEmitter, func: IRFunction, isMain: boolean = false): void {
  let instructions = flattenBlocksSimple(func);
  // For main/top-level code, strip the trailing RET
  if (isMain) {
    instructions = instructions.filter(i => i.opcode !== IROpcode.RET);
  }
  const tracker = new VariableTracker();

  // Pre-scan: track variables
  for (const instr of instructions) {
    if (instr.dest && instr.opcode !== IROpcode.LABEL && instr.opcode !== IROpcode.JZ &&
        instr.opcode !== IROpcode.JNZ && instr.opcode !== IROpcode.JMP) {
      tracker.track(instr.dest, instr);
    }
  }

  // Build label→index map
  const labelIndex = new Map<string, number>();
  for (let i = 0; i < instructions.length; i++) {
    if (instructions[i].opcode === IROpcode.LABEL && instructions[i].dest) {
      labelIndex.set(instructions[i].dest, i);
    }
  }

  // Detect loop headers
  const loopHeaders = new Set<string>();
  for (let i = 0; i < instructions.length; i++) {
    if (instructions[i].opcode === IROpcode.JMP && instructions[i].dest) {
      const targetIdx = labelIndex.get(instructions[i].dest);
      if (targetIdx !== undefined && targetIdx <= i) {
        loopHeaders.add(instructions[i].dest);
      }
    }
  }

  const openBlocks: Array<{ type: string; endLabel?: string }> = [];

  for (let i = 0; i < instructions.length; i++) {
    const instr = instructions[i];

    // LABEL
    if (instr.opcode === IROpcode.LABEL && instr.dest) {
      if (loopHeaders.has(instr.dest)) {
        // Emit while (true) — exit condition will be handled by JZ/JNZ as if/break
        emitter.emit('while (true) {');
        emitter.indent();
        openBlocks.push({ type: 'while', endLabel: instr.dest });
        continue;
      }

      // Close blocks that end at this label
      while (openBlocks.length > 0) {
        const top = openBlocks[openBlocks.length - 1];
        if (top.endLabel === instr.dest) {
          emitter.dedent();
          emitter.emit('}');
          openBlocks.pop();
        } else {
          break;
        }
      }
      continue;
    }

    // JZ/JNZ — either loop exit or if/else
    if (instr.opcode === IROpcode.JZ || instr.opcode === IROpcode.JNZ) {
      if (instr.dest) {
        // Check if we're inside a while loop
        const whileBlock = openBlocks.find(b => b.type === 'while');
        if (whileBlock) {
          // Loop exit condition — emit as if/break
          const condVar = instr.operand1 || 'true';
          const isJZ = instr.opcode === IROpcode.JZ;
          if (isJZ) {
            emitter.emit(`if (!${condVar}) {`);
          } else {
            emitter.emit(`if (${condVar}) {`);
          }
          emitter.indent();
          emitter.emit('break;');
          emitter.dedent();
          emitter.emit('}');
        } else {
          // Not inside a loop — if/else
          const targetIdx = labelIndex.get(instr.dest);
          if (targetIdx !== undefined) {
            let hasElse = false;
            let endLabel: string | undefined;

            for (let j = i + 1; j < targetIdx; j++) {
              if (instructions[j].opcode === IROpcode.JMP && instructions[j].dest) {
                const jmpTarget = labelIndex.get(instructions[j].dest);
                if (jmpTarget !== undefined && jmpTarget > targetIdx) {
                  hasElse = true;
                  endLabel = instructions[j].dest;
                  break;
                }
              }
              if (instructions[j].opcode === IROpcode.LABEL) break;
            }

            const condVar = instr.operand1 || 'true';
            const isJZ = instr.opcode === IROpcode.JZ;
            emitter.emit(`if (${isJZ ? condVar : `!${condVar}`}) {`);
            emitter.indent();

            if (hasElse && endLabel) {
              openBlocks.push({ type: 'if_then', endLabel });
            } else {
              openBlocks.push({ type: 'if_then', endLabel: instr.dest });
            }
          }
        }
      }
      continue;
    }

    // JMP
    if (instr.opcode === IROpcode.JMP && instr.dest) {
      const targetIdx = labelIndex.get(instr.dest);
      if (targetIdx !== undefined && targetIdx <= i) {
        // Loop back-edge
        const top = openBlocks[openBlocks.length - 1];
        if (top && top.type === 'while') {
          emitter.dedent();
          emitter.emit('}');
          openBlocks.pop();
        }
        continue;
      }

      // Forward JMP — end of then-block, start else
      const top = openBlocks[openBlocks.length - 1];
      if (top && top.type === 'if_then') {
        emitter.dedent();
        emitter.emit('} else {');
        emitter.indent();
        openBlocks.pop();
        openBlocks.push({ type: 'if_else', endLabel: instr.dest });
      }
      continue;
    }

    // Regular instructions
    emitJSInstruction(emitter, instr, tracker);
  }

  // Close remaining blocks
  while (openBlocks.length > 0) {
    emitter.dedent();
    emitter.emit('}');
    openBlocks.pop();
  }
}

function emitJSInstruction(
  emitter: CodeEmitter,
  instr: IRInstruction,
  tracker: VariableTracker,
): void {
  switch (instr.opcode) {
    case IROpcode.LOAD_CONST: {
      if (instr.dest) {
        tracker.track(instr.dest, instr);
        const val = formatLiteral(instr.value, 'javascript');
        const keyword = tracker.isTemp(instr.dest) ? 'let' : 'let';
        emitter.emit(`${keyword} ${instr.dest} = ${val};`);
      }
      break;
    }

    case IROpcode.LOAD: {
      if (instr.dest && instr.operand1) {
        tracker.track(instr.dest, instr);
        emitter.emit(`let ${instr.dest} = ${instr.operand1};`);
      }
      break;
    }

    case IROpcode.STORE: {
      if (instr.dest && instr.operand1) {
        if (!tracker.getVar(instr.dest)?.declared) {
          emitter.emit(`let ${instr.dest} = ${instr.operand1};`);
          tracker.markDeclared(instr.dest);
        } else {
          emitter.emit(`${instr.dest} = ${instr.operand1};`);
        }
      }
      break;
    }

    case IROpcode.ADD:
    case IROpcode.SUB:
    case IROpcode.MUL:
    case IROpcode.DIV:
    case IROpcode.MOD:
    case IROpcode.AND:
    case IROpcode.OR:
    case IROpcode.XOR:
    case IROpcode.SHL:
    case IROpcode.SHR:
    case IROpcode.EQ:
    case IROpcode.NE:
    case IROpcode.LT:
    case IROpcode.LE:
    case IROpcode.GT:
    case IROpcode.GE: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        tracker.track(instr.dest, instr);
        const op = formatBinaryOp(instr.opcode, 'javascript');
        emitter.emit(`let ${instr.dest} = ${instr.operand1} ${op} ${instr.operand2};`);
      }
      break;
    }

    case IROpcode.POW: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        tracker.track(instr.dest, instr);
        emitter.emit(`let ${instr.dest} = Math.pow(${instr.operand1}, ${instr.operand2});`);
      }
      break;
    }

    case IROpcode.NEG: {
      if (instr.dest && instr.operand1) {
        tracker.track(instr.dest, instr);
        emitter.emit(`let ${instr.dest} = -${instr.operand1};`);
      }
      break;
    }

    case IROpcode.NOT: {
      if (instr.dest && instr.operand1) {
        tracker.track(instr.dest, instr);
        const vtype = tracker.getType(instr.operand1);
        if (vtype === 'boolean') {
          emitter.emit(`let ${instr.dest} = !${instr.operand1};`);
        } else {
          emitter.emit(`let ${instr.dest} = ~${instr.operand1};`);
        }
      }
      break;
    }

    case IROpcode.PRINT: {
      const val = instr.operand1 || instr.dest || '';
      if (val) {
        emitter.emit(`console.log(${val});`);
      }
      break;
    }

    case IROpcode.READ: {
      if (instr.dest) {
        emitter.emit(`let ${instr.dest} = readline.question();`);
      }
      break;
    }

    case IROpcode.CALL: {
      if (instr.dest && instr.operand1) {
        const funcName = instr.operand1;
        const args = buildCallArgs(instr);
        tracker.track(instr.dest, instr);
        emitter.emit(`let ${instr.dest} = ${funcName}(${args.join(', ')});`);
      } else if (instr.operand1) {
        const funcName = instr.operand1;
        const args = buildCallArgs(instr);
        emitter.emit(`${funcName}(${args.join(', ')});`);
      }
      break;
    }

    case IROpcode.RET: {
      if (instr.dest) {
        emitter.emit(`return ${instr.dest};`);
      } else {
        emitter.emit('return;');
      }
      break;
    }

    case IROpcode.PARAM: {
      break;
    }

    case IROpcode.CAST: {
      if (instr.dest && instr.operand1) {
        const targetType = instr.operand2;
        tracker.track(instr.dest, instr);
        switch (targetType) {
          case 'int':
            emitter.emit(`let ${instr.dest} = parseInt(${instr.operand1});`);
            break;
          case 'double':
          case 'float':
            emitter.emit(`let ${instr.dest} = parseFloat(${instr.operand1});`);
            break;
          case 'string':
            emitter.emit(`let ${instr.dest} = String(${instr.operand1});`);
            break;
          default:
            emitter.emit(`let ${instr.dest} = ${instr.operand1};`);
        }
      }
      break;
    }

    case IROpcode.TYPEOF: {
      if (instr.dest && instr.operand1) {
        tracker.track(instr.dest, instr);
        emitter.emit(`let ${instr.dest} = typeof ${instr.operand1};`);
      }
      break;
    }

    case IROpcode.LOAD_MEMBER: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        tracker.track(instr.dest, instr);
        emitter.emit(`let ${instr.dest} = ${instr.operand1}.${instr.operand2};`);
      }
      break;
    }

    case IROpcode.STORE_MEMBER: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        emitter.emit(`${instr.operand1}.${instr.dest} = ${instr.operand2};`);
      }
      break;
    }

    case IROpcode.LOAD_INDEX: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        tracker.track(instr.dest, instr);
        emitter.emit(`let ${instr.dest} = ${instr.operand1}[${instr.operand2}];`);
      }
      break;
    }

    case IROpcode.STORE_INDEX: {
      if (instr.operand1 && instr.operand2 && instr.value) {
        emitter.emit(`${instr.operand1}[${instr.operand2}] = ${instr.value};`);
      }
      break;
    }

    case IROpcode.ALLOC: {
      if (instr.dest && instr.operand1) {
        tracker.track(instr.dest, instr);
        if (instr.operand1 === 'Array') {
          emitter.emit(`let ${instr.dest} = [];`);
        } else if (instr.operand1 === 'Object') {
          emitter.emit(`let ${instr.dest} = {};`);
        } else {
          emitter.emit(`let ${instr.dest} = new ${instr.operand1}();`);
        }
      }
      break;
    }

    case IROpcode.NOP: {
      break;
    }

    default: {
      emitter.emit(`/* unhandled: ${instr.opcode} */`);
      break;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// C Code Generator
// ═════════════════════════════════════════════════════════════════════════════

function generateC(
  program: IRProgram,
  mainFunc: IRFunction | undefined,
  otherFuncs: IRFunction[],
): string {
  const emitter = new CodeEmitter();

  emitter.emit('/* Generated from optimized IR by CodeForge */');
  emitter.blank();
  emitter.emit('#include <stdio.h>');
  emitter.emit('#include <stdlib.h>');
  emitter.emit('#include <math.h>');
  emitter.emit('#include <string.h>');
  emitter.blank();

  // Check if we need boolean support
  const needsBool = program.functions.some(f =>
    f.blocks.some(b => b.instructions.some(i =>
      i.opcode === IROpcode.NOT && i.operand1
    ))
  );
  if (needsBool) {
    emitter.emit('#include <stdbool.h>');
  }

  // Forward declarations for non-main functions
  if (otherFuncs.length > 0) {
    for (const func of otherFuncs) {
      const funcTracker = new VariableTracker();
      preTrackVariables(funcTracker, func);
      const returnType = inferFunctionReturnType(func, funcTracker);
      const params = formatCParams(func, funcTracker);
      emitter.emit(`${returnType} ${func.name}(${params});`);
    }
    emitter.blank();
  }

  // Generate non-main functions
  for (const func of otherFuncs) {
    generateCFunction(emitter, func);
    emitter.blank();
  }

  // Generate main function
  emitter.emit('int main() {');
  emitter.indent();

  if (mainFunc) {
    generateCFunctionBody(emitter, mainFunc, true);
  }

  emitter.emit('return 0;');
  emitter.dedent();
  emitter.emit('}');

  return emitter.toString();
}

function generateCFunction(emitter: CodeEmitter, func: IRFunction): void {
  const tracker = new VariableTracker();
  preTrackVariables(tracker, func);
  const returnType = inferFunctionReturnType(func, tracker);
  const params = formatCParams(func, tracker);

  emitter.emit(`${returnType} ${func.name}(${params}) {`);
  emitter.indent();
  generateCFunctionBody(emitter, func);
  emitter.dedent();
  emitter.emit('}');
}

function generateCFunctionBody(emitter: CodeEmitter, func: IRFunction, isMain: boolean = false): void {
  let instructions = flattenBlocksSimple(func);
  // For main function, strip the trailing RET (we add 'return 0;' explicitly)
  if (isMain) {
    instructions = instructions.filter(i => i.opcode !== IROpcode.RET);
  }
  const tracker = new VariableTracker();

  // Pre-scan: track all variables
  preTrackVariables(tracker, func);

  // Build label→index map
  const labelIndex = new Map<string, number>();
  for (let i = 0; i < instructions.length; i++) {
    if (instructions[i].opcode === IROpcode.LABEL && instructions[i].dest) {
      labelIndex.set(instructions[i].dest, i);
    }
  }

  // Detect loop headers
  const loopHeaders = new Set<string>();
  for (let i = 0; i < instructions.length; i++) {
    if (instructions[i].opcode === IROpcode.JMP && instructions[i].dest) {
      const targetIdx = labelIndex.get(instructions[i].dest);
      if (targetIdx !== undefined && targetIdx <= i) {
        loopHeaders.add(instructions[i].dest);
      }
    }
  }

  // Declare all variables at the top (C89 style)
  const allVars = tracker.getAllVars().filter(v => !v.isTemp || needsDeclaration(v.name, instructions));
  for (const v of allVars) {
    const ctype = getCType(v.type, 'c');
    emitter.emit(`${ctype} ${v.name};`);
    tracker.markDeclared(v.name);
  }
  if (allVars.length > 0) emitter.blank();

  const openBlocks: Array<{ type: string; endLabel?: string }> = [];

  for (let i = 0; i < instructions.length; i++) {
    const instr = instructions[i];

    // LABEL
    if (instr.opcode === IROpcode.LABEL && instr.dest) {
      if (loopHeaders.has(instr.dest)) {
        // Emit while (1) — exit condition handled by JZ/JNZ as if/break
        emitter.emit('while (1) {');
        emitter.indent();
        openBlocks.push({ type: 'while', endLabel: instr.dest });
        continue;
      }

      // Close blocks ending at this label
      while (openBlocks.length > 0) {
        const top = openBlocks[openBlocks.length - 1];
        if (top.endLabel === instr.dest) {
          emitter.dedent();
          emitter.emit('}');
          openBlocks.pop();
        } else {
          break;
        }
      }
      continue;
    }

    // JZ/JNZ — either loop exit or if/else
    if (instr.opcode === IROpcode.JZ || instr.opcode === IROpcode.JNZ) {
      if (instr.dest) {
        // Check if we're inside a while loop
        const whileBlock = openBlocks.find(b => b.type === 'while');
        if (whileBlock) {
          // Loop exit condition — emit as if/break
          const condVar = instr.operand1 || '1';
          const isJZ = instr.opcode === IROpcode.JZ;
          if (isJZ) {
            emitter.emit(`if (!${condVar}) {`);
          } else {
            emitter.emit(`if (${condVar}) {`);
          }
          emitter.indent();
          emitter.emit('break;');
          emitter.dedent();
          emitter.emit('}');
        } else {
          // Not inside a loop — if/else
          const targetIdx = labelIndex.get(instr.dest);
          if (targetIdx !== undefined) {
            let hasElse = false;
            let endLabel: string | undefined;

            for (let j = i + 1; j < targetIdx; j++) {
              if (instructions[j].opcode === IROpcode.JMP && instructions[j].dest) {
                const jmpTarget = labelIndex.get(instructions[j].dest);
                if (jmpTarget !== undefined && jmpTarget > targetIdx) {
                  hasElse = true;
                  endLabel = instructions[j].dest;
                  break;
                }
              }
              if (instructions[j].opcode === IROpcode.LABEL) break;
            }

            const condVar = instr.operand1 || '1';
            const isJZ = instr.opcode === IROpcode.JZ;
            if (isJZ) {
              emitter.emit(`if (${condVar}) {`);
            } else {
              emitter.emit(`if (!${condVar}) {`);
            }
            emitter.indent();

            if (hasElse && endLabel) {
              openBlocks.push({ type: 'if_then', endLabel });
            } else {
              openBlocks.push({ type: 'if_then', endLabel: instr.dest });
            }
          }
        }
      }
      continue;
    }

    // JMP
    if (instr.opcode === IROpcode.JMP && instr.dest) {
      const targetIdx = labelIndex.get(instr.dest);
      if (targetIdx !== undefined && targetIdx <= i) {
        // Loop back-edge
        const top = openBlocks[openBlocks.length - 1];
        if (top && top.type === 'while') {
          emitter.dedent();
          emitter.emit('}');
          openBlocks.pop();
        }
        continue;
      }

      // Forward JMP — end of then-block, start else
      const top = openBlocks[openBlocks.length - 1];
      if (top && top.type === 'if_then') {
        emitter.dedent();
        emitter.emit('} else {');
        emitter.indent();
        openBlocks.pop();
        openBlocks.push({ type: 'if_else', endLabel: instr.dest });
      }
      continue;
    }

    // Regular instructions
    emitCInstruction(emitter, instr, tracker);
  }

  // Close remaining blocks
  while (openBlocks.length > 0) {
    emitter.dedent();
    emitter.emit('}');
    openBlocks.pop();
  }
}

function emitCInstruction(
  emitter: CodeEmitter,
  instr: IRInstruction,
  tracker: VariableTracker,
): void {
  switch (instr.opcode) {
    case IROpcode.LOAD_CONST: {
      if (instr.dest) {
        const val = formatLiteral(instr.value, 'c');
        if (tracker.isTemp(instr.dest) && !tracker.getVar(instr.dest)?.declared) {
          const vtype = inferTypeFromValue(instr.value);
          const ctype = getCType(vtype, 'c');
          emitter.emit(`${ctype} ${instr.dest} = ${val};`);
          tracker.markDeclared(instr.dest);
        } else {
          emitter.emit(`${instr.dest} = ${val};`);
        }
      }
      break;
    }

    case IROpcode.LOAD: {
      if (instr.dest && instr.operand1) {
        emitter.emit(`${instr.dest} = ${instr.operand1};`);
      }
      break;
    }

    case IROpcode.STORE: {
      if (instr.dest && instr.operand1) {
        emitter.emit(`${instr.dest} = ${instr.operand1};`);
      }
      break;
    }

    case IROpcode.ADD:
    case IROpcode.SUB:
    case IROpcode.MUL:
    case IROpcode.DIV:
    case IROpcode.MOD:
    case IROpcode.AND:
    case IROpcode.OR:
    case IROpcode.XOR:
    case IROpcode.SHL:
    case IROpcode.SHR:
    case IROpcode.EQ:
    case IROpcode.NE:
    case IROpcode.LT:
    case IROpcode.LE:
    case IROpcode.GT:
    case IROpcode.GE: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        const op = formatBinaryOp(instr.opcode, 'c');
        // For C, boolean ops return int (0 or 1)
        if (instr.opcode >= IROpcode.EQ && instr.opcode <= IROpcode.GE) {
          emitter.emit(`${instr.dest} = ${instr.operand1} ${op} ${instr.operand2};`);
        } else {
          emitter.emit(`${instr.dest} = ${instr.operand1} ${op} ${instr.operand2};`);
        }
      }
      break;
    }

    case IROpcode.POW: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        emitter.emit(`${instr.dest} = (int)pow(${instr.operand1}, ${instr.operand2});`);
      }
      break;
    }

    case IROpcode.NEG: {
      if (instr.dest && instr.operand1) {
        emitter.emit(`${instr.dest} = -${instr.operand1};`);
      }
      break;
    }

    case IROpcode.NOT: {
      if (instr.dest && instr.operand1) {
        const vtype = tracker.getType(instr.operand1);
        if (vtype === 'boolean') {
          emitter.emit(`${instr.dest} = !${instr.operand1};`);
        } else {
          emitter.emit(`${instr.dest} = ~${instr.operand1};`);
        }
      }
      break;
    }

    case IROpcode.PRINT: {
      const val = instr.operand1 || instr.dest || '';
      if (val) {
        const vtype = tracker.getType(val);
        const fmtStr = getPrintfFormat(vtype);
        emitter.emit(`printf("${fmtStr}\\n", ${val});`);
      }
      break;
    }

    case IROpcode.READ: {
      if (instr.dest) {
        emitter.emit(`scanf("%d", &${instr.dest});`);
      }
      break;
    }

    case IROpcode.CALL: {
      if (instr.dest && instr.operand1) {
        const funcName = instr.operand1;
        const args = buildCallArgs(instr);
        emitter.emit(`${instr.dest} = ${funcName}(${args.join(', ')});`);
      } else if (instr.operand1) {
        const funcName = instr.operand1;
        const args = buildCallArgs(instr);
        emitter.emit(`${funcName}(${args.join(', ')});`);
      }
      break;
    }

    case IROpcode.RET: {
      if (instr.dest) {
        emitter.emit(`return ${instr.dest};`);
      } else {
        emitter.emit('return;');
      }
      break;
    }

    case IROpcode.PARAM: {
      break;
    }

    case IROpcode.CAST: {
      if (instr.dest && instr.operand1) {
        const targetType = instr.operand2;
        switch (targetType) {
          case 'int':
            emitter.emit(`${instr.dest} = (int)${instr.operand1};`);
            break;
          case 'double':
          case 'float':
            emitter.emit(`${instr.dest} = (double)${instr.operand1};`);
            break;
          default:
            emitter.emit(`${instr.dest} = ${instr.operand1};`);
        }
      }
      break;
    }

    case IROpcode.LOAD_INDEX: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        emitter.emit(`${instr.dest} = ${instr.operand1}[${instr.operand2}];`);
      }
      break;
    }

    case IROpcode.STORE_INDEX: {
      if (instr.operand1 && instr.operand2 && instr.value) {
        emitter.emit(`${instr.operand1}[${instr.operand2}] = ${instr.value};`);
      }
      break;
    }

    case IROpcode.NOP: {
      break;
    }

    default: {
      emitter.emit(`/* unhandled: ${instr.opcode} */`);
      break;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// C++ Code Generator
// ═════════════════════════════════════════════════════════════════════════════

function generateCpp(
  program: IRProgram,
  mainFunc: IRFunction | undefined,
  otherFuncs: IRFunction[],
): string {
  const emitter = new CodeEmitter();

  emitter.emit('// Generated from optimized IR by CodeForge');
  emitter.blank();
  emitter.emit('#include <iostream>');
  emitter.emit('#include <cmath>');
  emitter.emit('#include <string>');
  emitter.emit('using namespace std;');
  emitter.blank();

  // Forward declarations
  if (otherFuncs.length > 0) {
    for (const func of otherFuncs) {
      const tracker = new VariableTracker();
      preTrackVariables(tracker, func);
      const returnType = inferFunctionReturnType(func, tracker);
      const params = formatCppParams(func, tracker);
      emitter.emit(`${returnType} ${func.name}(${params});`);
    }
    emitter.blank();
  }

  // Generate non-main functions
  for (const func of otherFuncs) {
    generateCppFunction(emitter, func);
    emitter.blank();
  }

  // Generate main function
  emitter.emit('int main() {');
  emitter.indent();

  if (mainFunc) {
    generateCppFunctionBody(emitter, mainFunc, true);
  }

  emitter.emit('return 0;');
  emitter.dedent();
  emitter.emit('}');

  return emitter.toString();
}

function generateCppFunction(emitter: CodeEmitter, func: IRFunction): void {
  const tracker = new VariableTracker();
  preTrackVariables(tracker, func);
  const returnType = inferFunctionReturnType(func, tracker);
  const params = formatCppParams(func, tracker);

  emitter.emit(`${returnType} ${func.name}(${params}) {`);
  emitter.indent();
  generateCppFunctionBody(emitter, func);
  emitter.dedent();
  emitter.emit('}');
}

function generateCppFunctionBody(emitter: CodeEmitter, func: IRFunction, isMain: boolean = false): void {
  let instructions = flattenBlocksSimple(func);
  // For main function, strip the trailing RET (we add 'return 0;' explicitly)
  if (isMain) {
    instructions = instructions.filter(i => i.opcode !== IROpcode.RET);
  }
  const tracker = new VariableTracker();

  preTrackVariables(tracker, func);

  // Build label→index map
  const labelIndex = new Map<string, number>();
  for (let i = 0; i < instructions.length; i++) {
    if (instructions[i].opcode === IROpcode.LABEL && instructions[i].dest) {
      labelIndex.set(instructions[i].dest, i);
    }
  }

  // Detect loop headers
  const loopHeaders = new Set<string>();
  for (let i = 0; i < instructions.length; i++) {
    if (instructions[i].opcode === IROpcode.JMP && instructions[i].dest) {
      const targetIdx = labelIndex.get(instructions[i].dest);
      if (targetIdx !== undefined && targetIdx <= i) {
        loopHeaders.add(instructions[i].dest);
      }
    }
  }

  const openBlocks: Array<{ type: string; endLabel?: string }> = [];

  for (let i = 0; i < instructions.length; i++) {
    const instr = instructions[i];

    // LABEL
    if (instr.opcode === IROpcode.LABEL && instr.dest) {
      if (loopHeaders.has(instr.dest)) {
        // Emit while (true) — exit handled by JZ/JNZ as if/break
        emitter.emit('while (true) {');
        emitter.indent();
        openBlocks.push({ type: 'while', endLabel: instr.dest });
        continue;
      }

      while (openBlocks.length > 0) {
        const top = openBlocks[openBlocks.length - 1];
        if (top.endLabel === instr.dest) {
          emitter.dedent();
          emitter.emit('}');
          openBlocks.pop();
        } else {
          break;
        }
      }
      continue;
    }

    // JZ/JNZ — either loop exit or if/else
    if (instr.opcode === IROpcode.JZ || instr.opcode === IROpcode.JNZ) {
      if (instr.dest) {
        // Check if we're inside a while loop
        const whileBlock = openBlocks.find(b => b.type === 'while');
        if (whileBlock) {
          // Loop exit condition — emit as if/break
          const condVar = instr.operand1 || 'true';
          const isJZ = instr.opcode === IROpcode.JZ;
          if (isJZ) {
            emitter.emit(`if (!${condVar}) {`);
          } else {
            emitter.emit(`if (${condVar}) {`);
          }
          emitter.indent();
          emitter.emit('break;');
          emitter.dedent();
          emitter.emit('}');
        } else {
          // Not inside a loop — if/else
          const targetIdx = labelIndex.get(instr.dest);
          if (targetIdx !== undefined) {
            let hasElse = false;
            let endLabel: string | undefined;

            for (let j = i + 1; j < targetIdx; j++) {
              if (instructions[j].opcode === IROpcode.JMP && instructions[j].dest) {
                const jmpTarget = labelIndex.get(instructions[j].dest);
                if (jmpTarget !== undefined && jmpTarget > targetIdx) {
                  hasElse = true;
                  endLabel = instructions[j].dest;
                  break;
                }
              }
              if (instructions[j].opcode === IROpcode.LABEL) break;
            }

            const condVar = instr.operand1 || 'true';
            const isJZ = instr.opcode === IROpcode.JZ;
            emitter.emit(`if (${isJZ ? condVar : `!${condVar}`}) {`);
            emitter.indent();

            if (hasElse && endLabel) {
              openBlocks.push({ type: 'if_then', endLabel });
            } else {
              openBlocks.push({ type: 'if_then', endLabel: instr.dest });
            }
          }
        }
      }
      continue;
    }

    // JMP
    if (instr.opcode === IROpcode.JMP && instr.dest) {
      const targetIdx = labelIndex.get(instr.dest);
      if (targetIdx !== undefined && targetIdx <= i) {
        const top = openBlocks[openBlocks.length - 1];
        if (top && top.type === 'while') {
          emitter.dedent();
          emitter.emit('}');
          openBlocks.pop();
        }
        continue;
      }

      const top = openBlocks[openBlocks.length - 1];
      if (top && top.type === 'if_then') {
        emitter.dedent();
        emitter.emit('} else {');
        emitter.indent();
        openBlocks.pop();
        openBlocks.push({ type: 'if_else', endLabel: instr.dest });
      }
      continue;
    }

    emitCppInstruction(emitter, instr, tracker);
  }

  while (openBlocks.length > 0) {
    emitter.dedent();
    emitter.emit('}');
    openBlocks.pop();
  }
}

function emitCppInstruction(
  emitter: CodeEmitter,
  instr: IRInstruction,
  tracker: VariableTracker,
): void {
  switch (instr.opcode) {
    case IROpcode.LOAD_CONST: {
      if (instr.dest) {
        const val = formatLiteral(instr.value, 'cpp');
        const vtype = inferTypeFromValue(instr.value);
        const ctype = getCType(vtype, 'cpp');
        if (tracker.getVar(instr.dest)?.declared) {
          emitter.emit(`${instr.dest} = ${val};`);
        } else {
          emitter.emit(`${ctype} ${instr.dest} = ${val};`);
          tracker.markDeclared(instr.dest);
        }
      }
      break;
    }

    case IROpcode.LOAD: {
      if (instr.dest && instr.operand1) {
        if (tracker.getVar(instr.dest)?.declared) {
          emitter.emit(`${instr.dest} = ${instr.operand1};`);
        } else {
          const vtype = tracker.getType(instr.operand1);
          const ctype = getCType(vtype, 'cpp');
          emitter.emit(`${ctype} ${instr.dest} = ${instr.operand1};`);
          tracker.markDeclared(instr.dest);
        }
      }
      break;
    }

    case IROpcode.STORE: {
      if (instr.dest && instr.operand1) {
        if (!tracker.getVar(instr.dest)?.declared) {
          const srcType = tracker.getType(instr.operand1);
          const ctype = getCType(srcType === 'unknown' ? 'int' : srcType, 'cpp');
          emitter.emit(`${ctype} ${instr.dest} = ${instr.operand1};`);
          tracker.markDeclared(instr.dest);
        } else {
          emitter.emit(`${instr.dest} = ${instr.operand1};`);
        }
      }
      break;
    }

    case IROpcode.ADD:
    case IROpcode.SUB:
    case IROpcode.MUL:
    case IROpcode.DIV:
    case IROpcode.MOD:
    case IROpcode.AND:
    case IROpcode.OR:
    case IROpcode.XOR:
    case IROpcode.SHL:
    case IROpcode.SHR:
    case IROpcode.EQ:
    case IROpcode.NE:
    case IROpcode.LT:
    case IROpcode.LE:
    case IROpcode.GT:
    case IROpcode.GE: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        const op = formatBinaryOp(instr.opcode, 'cpp');
        const vtype = inferTypeFromOpcode(instr.opcode);
        const ctype = getCType(vtype, 'cpp');
        if (tracker.getVar(instr.dest)?.declared) {
          emitter.emit(`${instr.dest} = ${instr.operand1} ${op} ${instr.operand2};`);
        } else {
          emitter.emit(`${ctype} ${instr.dest} = ${instr.operand1} ${op} ${instr.operand2};`);
          tracker.markDeclared(instr.dest);
        }
      }
      break;
    }

    case IROpcode.POW: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        if (tracker.getVar(instr.dest)?.declared) {
          emitter.emit(`${instr.dest} = (int)pow(${instr.operand1}, ${instr.operand2});`);
        } else {
          emitter.emit(`int ${instr.dest} = (int)pow(${instr.operand1}, ${instr.operand2});`);
          tracker.markDeclared(instr.dest);
        }
      }
      break;
    }

    case IROpcode.NEG: {
      if (instr.dest && instr.operand1) {
        if (tracker.getVar(instr.dest)?.declared) {
          emitter.emit(`${instr.dest} = -${instr.operand1};`);
        } else {
          emitter.emit(`int ${instr.dest} = -${instr.operand1};`);
          tracker.markDeclared(instr.dest);
        }
      }
      break;
    }

    case IROpcode.NOT: {
      if (instr.dest && instr.operand1) {
        const vtype = tracker.getType(instr.operand1);
        const op = vtype === 'boolean' ? '!' : '~';
        if (tracker.getVar(instr.dest)?.declared) {
          emitter.emit(`${instr.dest} = ${op}${instr.operand1};`);
        } else {
          const ctype = getCType(vtype, 'cpp');
          emitter.emit(`${ctype} ${instr.dest} = ${op}${instr.operand1};`);
          tracker.markDeclared(instr.dest);
        }
      }
      break;
    }

    case IROpcode.PRINT: {
      const val = instr.operand1 || instr.dest || '';
      if (val) {
        emitter.emit(`cout << ${val} << endl;`);
      }
      break;
    }

    case IROpcode.READ: {
      if (instr.dest) {
        emitter.emit(`cin >> ${instr.dest};`);
      }
      break;
    }

    case IROpcode.CALL: {
      if (instr.dest && instr.operand1) {
        const funcName = instr.operand1;
        const args = buildCallArgs(instr);
        emitter.emit(`${instr.dest} = ${funcName}(${args.join(', ')});`);
      } else if (instr.operand1) {
        const funcName = instr.operand1;
        const args = buildCallArgs(instr);
        emitter.emit(`${funcName}(${args.join(', ')});`);
      }
      break;
    }

    case IROpcode.RET: {
      if (instr.dest) {
        emitter.emit(`return ${instr.dest};`);
      } else {
        emitter.emit('return;');
      }
      break;
    }

    case IROpcode.PARAM: {
      break;
    }

    case IROpcode.CAST: {
      if (instr.dest && instr.operand1) {
        const targetType = instr.operand2;
        switch (targetType) {
          case 'int':
            emitter.emit(`${instr.dest} = (int)${instr.operand1};`);
            break;
          case 'double':
          case 'float':
            emitter.emit(`${instr.dest} = (double)${instr.operand1};`);
            break;
          default:
            emitter.emit(`${instr.dest} = ${instr.operand1};`);
        }
      }
      break;
    }

    case IROpcode.LOAD_INDEX: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        emitter.emit(`${instr.dest} = ${instr.operand1}[${instr.operand2}];`);
      }
      break;
    }

    case IROpcode.STORE_INDEX: {
      if (instr.operand1 && instr.operand2 && instr.value) {
        emitter.emit(`${instr.operand1}[${instr.operand2}] = ${instr.value};`);
      }
      break;
    }

    case IROpcode.NOP: {
      break;
    }

    default: {
      emitter.emit(`/* unhandled: ${instr.opcode} */`);
      break;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Java Code Generator
// ═════════════════════════════════════════════════════════════════════════════

function generateJava(
  program: IRProgram,
  mainFunc: IRFunction | undefined,
  otherFuncs: IRFunction[],
): string {
  const emitter = new CodeEmitter();

  emitter.emit('// Generated from optimized IR by CodeForge');
  emitter.blank();
  emitter.emit('import java.util.Scanner;');
  emitter.blank();
  emitter.emit('public class Main {');
  emitter.indent();

  // Scanner field for input
  const needsRead = program.functions.some(f =>
    f.blocks.some(b => b.instructions.some(i => i.opcode === IROpcode.READ))
  );
  if (needsRead) {
    emitter.emit('static Scanner scanner = new Scanner(System.in);');
    emitter.blank();
  }

  // Generate non-main functions as static methods
  for (const func of otherFuncs) {
    generateJavaFunction(emitter, func);
    emitter.blank();
  }

  // Generate main method
  emitter.emit('public static void main(String[] args) {');
  emitter.indent();

  if (mainFunc) {
    generateJavaFunctionBody(emitter, mainFunc, true);
  }

  emitter.dedent();
  emitter.emit('}');

  emitter.dedent();
  emitter.emit('}');

  return emitter.toString();
}

function generateJavaFunction(emitter: CodeEmitter, func: IRFunction): void {
  const tracker = new VariableTracker();
  preTrackVariables(tracker, func);
  const returnType = inferFunctionReturnType(func, tracker);
  const params = formatJavaParams(func, tracker);

  emitter.emit(`public static ${returnType} ${func.name}(${params}) {`);
  emitter.indent();
  generateJavaFunctionBody(emitter, func);
  emitter.dedent();
  emitter.emit('}');
}

function generateJavaFunctionBody(emitter: CodeEmitter, func: IRFunction, isMain: boolean = false): void {
  let instructions = flattenBlocksSimple(func);
  // For main method, strip the trailing RET
  if (isMain) {
    instructions = instructions.filter(i => i.opcode !== IROpcode.RET);
  }
  const tracker = new VariableTracker();

  preTrackVariables(tracker, func);

  // Build label→index map
  const labelIndex = new Map<string, number>();
  for (let i = 0; i < instructions.length; i++) {
    if (instructions[i].opcode === IROpcode.LABEL && instructions[i].dest) {
      labelIndex.set(instructions[i].dest, i);
    }
  }

  // Detect loop headers
  const loopHeaders = new Set<string>();
  for (let i = 0; i < instructions.length; i++) {
    if (instructions[i].opcode === IROpcode.JMP && instructions[i].dest) {
      const targetIdx = labelIndex.get(instructions[i].dest);
      if (targetIdx !== undefined && targetIdx <= i) {
        loopHeaders.add(instructions[i].dest);
      }
    }
  }

  const openBlocks: Array<{ type: string; endLabel?: string }> = [];

  for (let i = 0; i < instructions.length; i++) {
    const instr = instructions[i];

    // LABEL
    if (instr.opcode === IROpcode.LABEL && instr.dest) {
      if (loopHeaders.has(instr.dest)) {
        // Emit while (true) — exit handled by JZ/JNZ as if/break
        emitter.emit('while (true) {');
        emitter.indent();
        openBlocks.push({ type: 'while', endLabel: instr.dest });
        continue;
      }

      while (openBlocks.length > 0) {
        const top = openBlocks[openBlocks.length - 1];
        if (top.endLabel === instr.dest) {
          emitter.dedent();
          emitter.emit('}');
          openBlocks.pop();
        } else {
          break;
        }
      }
      continue;
    }

    // JZ/JNZ — either loop exit or if/else
    if (instr.opcode === IROpcode.JZ || instr.opcode === IROpcode.JNZ) {
      if (instr.dest) {
        // Check if we're inside a while loop
        const whileBlock = openBlocks.find(b => b.type === 'while');
        if (whileBlock) {
          // Loop exit condition — emit as if/break
          const condVar = instr.operand1 || 'true';
          const isJZ = instr.opcode === IROpcode.JZ;
          if (isJZ) {
            emitter.emit(`if (!${condVar}) {`);
          } else {
            emitter.emit(`if (${condVar}) {`);
          }
          emitter.indent();
          emitter.emit('break;');
          emitter.dedent();
          emitter.emit('}');
        } else {
          // Not inside a loop — if/else
          const targetIdx = labelIndex.get(instr.dest);
          if (targetIdx !== undefined) {
            let hasElse = false;
            let endLabel: string | undefined;

            for (let j = i + 1; j < targetIdx; j++) {
              if (instructions[j].opcode === IROpcode.JMP && instructions[j].dest) {
                const jmpTarget = labelIndex.get(instructions[j].dest);
                if (jmpTarget !== undefined && jmpTarget > targetIdx) {
                  hasElse = true;
                  endLabel = instructions[j].dest;
                  break;
                }
              }
              if (instructions[j].opcode === IROpcode.LABEL) break;
            }

            const condVar = instr.operand1 || 'true';
            const isJZ = instr.opcode === IROpcode.JZ;
            emitter.emit(`if (${isJZ ? condVar : `!${condVar}`}) {`);
            emitter.indent();

            if (hasElse && endLabel) {
              openBlocks.push({ type: 'if_then', endLabel });
            } else {
              openBlocks.push({ type: 'if_then', endLabel: instr.dest });
            }
          }
        }
      }
      continue;
    }

    // JMP
    if (instr.opcode === IROpcode.JMP && instr.dest) {
      const targetIdx = labelIndex.get(instr.dest);
      if (targetIdx !== undefined && targetIdx <= i) {
        const top = openBlocks[openBlocks.length - 1];
        if (top && top.type === 'while') {
          emitter.dedent();
          emitter.emit('}');
          openBlocks.pop();
        }
        continue;
      }

      const top = openBlocks[openBlocks.length - 1];
      if (top && top.type === 'if_then') {
        emitter.dedent();
        emitter.emit('} else {');
        emitter.indent();
        openBlocks.pop();
        openBlocks.push({ type: 'if_else', endLabel: instr.dest });
      }
      continue;
    }

    emitJavaInstruction(emitter, instr, tracker);
  }

  while (openBlocks.length > 0) {
    emitter.dedent();
    emitter.emit('}');
    openBlocks.pop();
  }
}

function emitJavaInstruction(
  emitter: CodeEmitter,
  instr: IRInstruction,
  tracker: VariableTracker,
): void {
  switch (instr.opcode) {
    case IROpcode.LOAD_CONST: {
      if (instr.dest) {
        const val = formatLiteral(instr.value, 'java');
        const vtype = inferTypeFromValue(instr.value);
        const jtype = getCType(vtype, 'java');
        if (tracker.getVar(instr.dest)?.declared) {
          emitter.emit(`${instr.dest} = ${val};`);
        } else {
          emitter.emit(`${jtype} ${instr.dest} = ${val};`);
          tracker.markDeclared(instr.dest);
        }
      }
      break;
    }

    case IROpcode.LOAD: {
      if (instr.dest && instr.operand1) {
        if (tracker.getVar(instr.dest)?.declared) {
          emitter.emit(`${instr.dest} = ${instr.operand1};`);
        } else {
          const vtype = tracker.getType(instr.operand1);
          const jtype = getCType(vtype, 'java');
          emitter.emit(`${jtype} ${instr.dest} = ${instr.operand1};`);
          tracker.markDeclared(instr.dest);
        }
      }
      break;
    }

    case IROpcode.STORE: {
      if (instr.dest && instr.operand1) {
        if (!tracker.getVar(instr.dest)?.declared) {
          const srcType = tracker.getType(instr.operand1);
          const jtype = getCType(srcType === 'unknown' ? 'int' : srcType, 'java');
          emitter.emit(`${jtype} ${instr.dest} = ${instr.operand1};`);
          tracker.markDeclared(instr.dest);
        } else {
          emitter.emit(`${instr.dest} = ${instr.operand1};`);
        }
      }
      break;
    }

    case IROpcode.ADD:
    case IROpcode.SUB:
    case IROpcode.MUL:
    case IROpcode.DIV:
    case IROpcode.MOD:
    case IROpcode.AND:
    case IROpcode.OR:
    case IROpcode.XOR:
    case IROpcode.SHL:
    case IROpcode.SHR:
    case IROpcode.EQ:
    case IROpcode.NE:
    case IROpcode.LT:
    case IROpcode.LE:
    case IROpcode.GT:
    case IROpcode.GE: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        const op = formatBinaryOp(instr.opcode, 'java');
        const vtype = inferTypeFromOpcode(instr.opcode);
        const jtype = getCType(vtype, 'java');
        // For Java, integer division is default, but we need to handle boolean results
        if (tracker.getVar(instr.dest)?.declared) {
          emitter.emit(`${instr.dest} = ${instr.operand1} ${op} ${instr.operand2};`);
        } else {
          emitter.emit(`${jtype} ${instr.dest} = ${instr.operand1} ${op} ${instr.operand2};`);
          tracker.markDeclared(instr.dest);
        }
      }
      break;
    }

    case IROpcode.POW: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        if (tracker.getVar(instr.dest)?.declared) {
          emitter.emit(`${instr.dest} = (int)Math.pow(${instr.operand1}, ${instr.operand2});`);
        } else {
          emitter.emit(`int ${instr.dest} = (int)Math.pow(${instr.operand1}, ${instr.operand2});`);
          tracker.markDeclared(instr.dest);
        }
      }
      break;
    }

    case IROpcode.NEG: {
      if (instr.dest && instr.operand1) {
        if (tracker.getVar(instr.dest)?.declared) {
          emitter.emit(`${instr.dest} = -${instr.operand1};`);
        } else {
          emitter.emit(`int ${instr.dest} = -${instr.operand1};`);
          tracker.markDeclared(instr.dest);
        }
      }
      break;
    }

    case IROpcode.NOT: {
      if (instr.dest && instr.operand1) {
        const vtype = tracker.getType(instr.operand1);
        const op = vtype === 'boolean' ? '!' : '~';
        if (tracker.getVar(instr.dest)?.declared) {
          emitter.emit(`${instr.dest} = ${op}${instr.operand1};`);
        } else {
          const jtype = getCType(vtype, 'java');
          emitter.emit(`${jtype} ${instr.dest} = ${op}${instr.operand1};`);
          tracker.markDeclared(instr.dest);
        }
      }
      break;
    }

    case IROpcode.PRINT: {
      const val = instr.operand1 || instr.dest || '';
      if (val) {
        emitter.emit(`System.out.println(${val});`);
      }
      break;
    }

    case IROpcode.READ: {
      if (instr.dest) {
        emitter.emit(`int ${instr.dest} = scanner.nextInt();`);
        tracker.markDeclared(instr.dest);
      }
      break;
    }

    case IROpcode.CALL: {
      if (instr.dest && instr.operand1) {
        const funcName = instr.operand1;
        const args = buildCallArgs(instr);
        emitter.emit(`${instr.dest} = ${funcName}(${args.join(', ')});`);
      } else if (instr.operand1) {
        const funcName = instr.operand1;
        const args = buildCallArgs(instr);
        emitter.emit(`${funcName}(${args.join(', ')});`);
      }
      break;
    }

    case IROpcode.RET: {
      if (instr.dest) {
        emitter.emit(`return ${instr.dest};`);
      } else {
        emitter.emit('return;');
      }
      break;
    }

    case IROpcode.PARAM: {
      break;
    }

    case IROpcode.CAST: {
      if (instr.dest && instr.operand1) {
        const targetType = instr.operand2;
        switch (targetType) {
          case 'int':
            emitter.emit(`${instr.dest} = (int)${instr.operand1};`);
            break;
          case 'double':
          case 'float':
            emitter.emit(`${instr.dest} = (double)${instr.operand1};`);
            break;
          default:
            emitter.emit(`${instr.dest} = ${instr.operand1};`);
        }
      }
      break;
    }

    case IROpcode.LOAD_INDEX: {
      if (instr.dest && instr.operand1 && instr.operand2) {
        emitter.emit(`${instr.dest} = ${instr.operand1}[${instr.operand2}];`);
      }
      break;
    }

    case IROpcode.STORE_INDEX: {
      if (instr.operand1 && instr.operand2 && instr.value) {
        emitter.emit(`${instr.operand1}[${instr.operand2}] = ${instr.value};`);
      }
      break;
    }

    case IROpcode.NOP: {
      break;
    }

    default: {
      emitter.emit(`/* unhandled: ${instr.opcode} */`);
      break;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Shared Helpers
// ═════════════════════════════════════════════════════════════════════════════

/** Build argument list from a CALL instruction */
function buildCallArgs(instr: IRInstruction): string[] {
  const args: string[] = [];

  // operand2 can be the first arg (single arg) or part of multi-arg
  if (instr.operand2) {
    // If value is an array, it contains additional args
    if (Array.isArray(instr.value)) {
      if (instr.operand2) args.push(instr.operand2);
      for (const arg of instr.value as string[]) {
        args.push(arg);
      }
    } else {
      args.push(instr.operand2);
    }
  }

  return args;
}

/** Pre-track variables from a function's IR */
function preTrackVariables(tracker: VariableTracker, func: IRFunction): void {
  for (const block of func.blocks) {
    for (const instr of block.instructions) {
      if (instr.dest && instr.opcode !== IROpcode.LABEL &&
          instr.opcode !== IROpcode.JZ && instr.opcode !== IROpcode.JNZ &&
          instr.opcode !== IROpcode.JMP) {
        tracker.track(instr.dest, instr);
      }
    }
  }
}

/** Check if a variable name needs declaration (appears as dest in instructions) */
function needsDeclaration(name: string, instructions: IRInstruction[]): boolean {
  return instructions.some(i => i.dest === name);
}

/** Infer the return type of a function from its RET instructions */
function inferFunctionReturnType(func: IRFunction, tracker: VariableTracker): string {
  for (const block of func.blocks) {
    for (const instr of block.instructions) {
      if (instr.opcode === IROpcode.RET && instr.dest) {
        const vtype = tracker.getType(instr.dest);
        if (vtype !== 'unknown') {
          // Map to C/C++/Java type
          return getCType(vtype, 'c');
        }
      }
    }
  }
  return 'void';
}

/** Format function parameters for C */
function formatCParams(func: IRFunction, tracker: VariableTracker): string {
  if (func.params.length === 0) return 'void';
  return func.params.map(p => {
    const vtype = tracker.getType(p);
    const ctype = getCType(vtype === 'unknown' ? 'int' : vtype, 'c');
    return `${ctype} ${p}`;
  }).join(', ');
}

/** Format function parameters for C++ */
function formatCppParams(func: IRFunction, tracker: VariableTracker): string {
  if (func.params.length === 0) return '';
  return func.params.map(p => {
    const vtype = tracker.getType(p);
    const ctype = getCType(vtype === 'unknown' ? 'int' : vtype, 'cpp');
    return `${ctype} ${p}`;
  }).join(', ');
}

/** Format function parameters for Java */
function formatJavaParams(func: IRFunction, tracker: VariableTracker): string {
  if (func.params.length === 0) return '';
  return func.params.map(p => {
    const vtype = tracker.getType(p);
    const jtype = getCType(vtype === 'unknown' ? 'int' : vtype, 'java');
    return `${jtype} ${p}`;
  }).join(', ');
}

/** Get printf format specifier for a C type */
function getPrintfFormat(vtype: InferredVarType): string {
  switch (vtype) {
    case 'int': return '%d';
    case 'double': return '%f';
    case 'string': return '%s';
    case 'boolean': return '%d';
    default: return '%d';
  }
}
