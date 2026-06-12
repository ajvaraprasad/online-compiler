/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge Compiler — Optimization Engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Runs optimization passes on the IR to improve the code.
 *
 * Pipeline: Constant Folding → Constant Propagation → Dead Code Elimination
 *           → Algebraic Simplification → CSE → DCE
 * Runs up to 3 iterations until no more improvements.
 */

import {
  IROpcode,
  IRInstruction,
  IRBasicBlock,
  IRFunction,
  IRProgram,
  OptimizationResult,
  OptimizationPass,
  OptimizationPassResult,
  OptimizationStats,
  generateInstrId,
} from '../types';

// ─── Helper: count total instructions in a program ────────────────────────────

function countInstructions(program: IRProgram): number {
  let count = program.globals.length;
  for (const func of program.functions) {
    for (const block of func.blocks) {
      count += block.instructions.length;
    }
  }
  return count;
}

// ─── Helper: deep clone an IR program ────────────────────────────────────────

function cloneProgram(program: IRProgram): IRProgram {
  return JSON.parse(JSON.stringify(program));
}

// ─── Helper: check if an opcode has side effects ─────────────────────────────

function hasSideEffects(opcode: IROpcode): boolean {
  switch (opcode) {
    case IROpcode.CALL:
    case IROpcode.STORE:
    case IROpcode.STORE_MEMBER:
    case IROpcode.STORE_INDEX:
    case IROpcode.PRINT:
    case IROpcode.READ:
    case IROpcode.ALLOC:
    case IROpcode.FREE:
    case IROpcode.RET:
    case IROpcode.JMP:
    case IROpcode.JZ:
    case IROpcode.JNZ:
    case IROpcode.LABEL:
      return true;
    default:
      return false;
  }
}

// ─── Helper: check if an opcode is a binary arithmetic operation ─────────────

function isBinaryArithmetic(opcode: IROpcode): boolean {
  return [
    IROpcode.ADD, IROpcode.SUB, IROpcode.MUL, IROpcode.DIV,
    IROpcode.MOD, IROpcode.POW, IROpcode.AND, IROpcode.OR,
    IROpcode.XOR, IROpcode.SHL, IROpcode.SHR,
    IROpcode.EQ, IROpcode.NE, IROpcode.LT, IROpcode.LE,
    IROpcode.GT, IROpcode.GE,
  ].includes(opcode);
}

// ═════════════════════════════════════════════════════════════════════════════
// Optimization Pass: Constant Folding
// ═════════════════════════════════════════════════════════════════════════════

class ConstantFoldingPass implements OptimizationPass {
  name = 'constant_folding';
  description = 'Evaluate constant expressions at compile time';
  applied = 0;

  run(program: IRProgram): IRProgram {
    this.applied = 0;
    const result = cloneProgram(program);

    for (const func of result.functions) {
      for (const block of func.blocks) {
        this.foldBlock(block);
      }
    }

    return result;
  }

  private foldBlock(block: IRBasicBlock): void {
    // Build map of temps holding constant values
    const constMap: Map<string, unknown> = new Map();

    // First pass: collect LOAD_CONST values
    for (const instr of block.instructions) {
      if (instr.opcode === IROpcode.LOAD_CONST && instr.dest) {
        constMap.set(instr.dest, instr.value);
      }
    }

    // Second pass: fold binary operations on constants
    const newInstrs: IRInstruction[] = [];

    for (const instr of block.instructions) {
      if (isBinaryArithmetic(instr.opcode) && instr.dest && instr.operand1 && instr.operand2) {
        const leftVal = constMap.get(instr.operand1);
        const rightVal = constMap.get(instr.operand2);

        if (leftVal !== undefined && rightVal !== undefined &&
            typeof leftVal === 'number' && typeof rightVal === 'number') {
          const folded = this.evalBinaryOp(instr.opcode, leftVal, rightVal);
          if (folded !== undefined) {
            // Replace with LOAD_CONST
            const newInstr: IRInstruction = {
              opcode: IROpcode.LOAD_CONST,
              dest: instr.dest,
              value: folded,
              id: generateInstrId(),
              loc: instr.loc,
            };
            newInstrs.push(newInstr);
            constMap.set(instr.dest, folded);
            this.applied++;
            continue;
          }
        }
      }

      // Fold unary operations on constants
      if (instr.opcode === IROpcode.NEG && instr.dest && instr.operand1) {
        const val = constMap.get(instr.operand1);
        if (val !== undefined && typeof val === 'number') {
          const newInstr: IRInstruction = {
            opcode: IROpcode.LOAD_CONST,
            dest: instr.dest,
            value: -val,
            id: generateInstrId(),
            loc: instr.loc,
          };
          newInstrs.push(newInstr);
          constMap.set(instr.dest, -val);
          this.applied++;
          continue;
        }
      }

      // Fold NOT on constants
      if (instr.opcode === IROpcode.NOT && instr.dest && instr.operand1) {
        const val = constMap.get(instr.operand1);
        if (val !== undefined && typeof val === 'boolean') {
          const newInstr: IRInstruction = {
            opcode: IROpcode.LOAD_CONST,
            dest: instr.dest,
            value: !val,
            id: generateInstrId(),
            loc: instr.loc,
          };
          newInstrs.push(newInstr);
          constMap.set(instr.dest, !val);
          this.applied++;
          continue;
        }
        if (val !== undefined && typeof val === 'number') {
          const newInstr: IRInstruction = {
            opcode: IROpcode.LOAD_CONST,
            dest: instr.dest,
            value: ~val,
            id: generateInstrId(),
            loc: instr.loc,
          };
          newInstrs.push(newInstr);
          constMap.set(instr.dest, ~val);
          this.applied++;
          continue;
        }
      }

      // If a STORE writes a constant to a variable, track it
      if (instr.opcode === IROpcode.STORE && instr.dest && instr.operand1) {
        const val = constMap.get(instr.operand1);
        if (val !== undefined) {
          constMap.set(instr.dest, val);
        }
      }

      newInstrs.push(instr);
    }

    block.instructions = newInstrs;
  }

  private evalBinaryOp(opcode: IROpcode, left: number, right: number): unknown {
    switch (opcode) {
      case IROpcode.ADD: return left + right;
      case IROpcode.SUB: return left - right;
      case IROpcode.MUL: return left * right;
      case IROpcode.DIV: return right !== 0 ? left / right : undefined;
      case IROpcode.MOD: return right !== 0 ? left % right : undefined;
      case IROpcode.POW: return Math.pow(left, right);
      case IROpcode.AND: return left & right;
      case IROpcode.OR: return left | right;
      case IROpcode.XOR: return left ^ right;
      case IROpcode.SHL: return left << right;
      case IROpcode.SHR: return left >> right;
      case IROpcode.EQ: return left === right;
      case IROpcode.NE: return left !== right;
      case IROpcode.LT: return left < right;
      case IROpcode.LE: return left <= right;
      case IROpcode.GT: return left > right;
      case IROpcode.GE: return left >= right;
      default: return undefined;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Optimization Pass: Constant Propagation
// ═════════════════════════════════════════════════════════════════════════════

class ConstantPropagationPass implements OptimizationPass {
  name = 'constant_propagation';
  description = 'Replace uses of variables that hold constant values with the constant';
  applied = 0;

  run(program: IRProgram): IRProgram {
    this.applied = 0;
    const result = cloneProgram(program);

    for (const func of result.functions) {
      for (const block of func.blocks) {
        this.propagateBlock(block);
      }
    }

    return result;
  }

  private propagateBlock(block: IRBasicBlock): void {
    // Map variable/temp names → constant values
    const constMap: Map<string, unknown> = new Map();

    const newInstrs: IRInstruction[] = [];

    for (const instr of block.instructions) {
      // Collect constants from LOAD_CONST
      if (instr.opcode === IROpcode.LOAD_CONST && instr.dest) {
        constMap.set(instr.dest, instr.value);
      }

      // Track STORE of constants
      if (instr.opcode === IROpcode.STORE && instr.dest && instr.operand1) {
        const val = constMap.get(instr.operand1);
        if (val !== undefined) {
          constMap.set(instr.dest, val);
        } else {
          // Variable is no longer constant if assigned non-constant
          constMap.delete(instr.dest);
        }
      }

      // Replace operand references with constants where possible
      const newInstr = { ...instr };

      if (newInstr.operand1 && constMap.has(newInstr.operand1)) {
        // For binary/unary ops: replace operand with constant LOAD
        // But we need to be careful — only replace if it leads to further folding
        // For simplicity, we replace in non-control-flow instructions
        if (!hasSideEffects(newInstr.opcode) && newInstr.opcode !== IROpcode.LABEL) {
          // Check if the operand is a constant that we can propagate
          const constVal = constMap.get(newInstr.operand1);
          if (constVal !== undefined && (typeof constVal === 'number' || typeof constVal === 'boolean' || typeof constVal === 'string')) {
            // Insert a LOAD_CONST before this instruction to replace the variable reference
            const tempForConst = `__cprop_${newInstr.operand1}`;
            // Only propagate if the operand isn't already a constant
            const constLoadInstr: IRInstruction = {
              opcode: IROpcode.LOAD_CONST,
              dest: tempForConst,
              value: constVal,
              id: generateInstrId(),
              loc: instr.loc,
            };
            newInstrs.push(constLoadInstr);
            newInstr.operand1 = tempForConst;
            constMap.set(tempForConst, constVal);
            this.applied++;
          }
        }
      }

      if (newInstr.operand2 && constMap.has(newInstr.operand2)) {
        if (!hasSideEffects(newInstr.opcode) && newInstr.opcode !== IROpcode.LABEL) {
          const constVal = constMap.get(newInstr.operand2);
          if (constVal !== undefined && (typeof constVal === 'number' || typeof constVal === 'boolean' || typeof constVal === 'string')) {
            const tempForConst = `__cprop_${newInstr.operand2}`;
            const constLoadInstr: IRInstruction = {
              opcode: IROpcode.LOAD_CONST,
              dest: tempForConst,
              value: constVal,
              id: generateInstrId(),
              loc: instr.loc,
            };
            newInstrs.push(constLoadInstr);
            newInstr.operand2 = tempForConst;
            constMap.set(tempForConst, constVal);
            this.applied++;
          }
        }
      }

      newInstrs.push(newInstr);
    }

    block.instructions = newInstrs;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Optimization Pass: Dead Code Elimination
// ═════════════════════════════════════════════════════════════════════════════

class DeadCodeEliminationPass implements OptimizationPass {
  name = 'dead_code_elimination';
  description = 'Remove instructions whose results are never used and unreachable blocks';
  applied = 0;

  run(program: IRProgram): IRProgram {
    this.applied = 0;
    const result = cloneProgram(program);

    for (const func of result.functions) {
      // 1. Remove unreachable blocks
      this.removeUnreachableBlocks(func);

      // 2. Remove dead instructions within blocks
      this.removeDeadInstructions(func);

      // 3. Remove NOP instructions
      this.removeNOPs(func);
    }

    return result;
  }

  private removeUnreachableBlocks(func: IRFunction): void {
    if (func.blocks.length === 0) return;

    // BFS from entry block
    const reachable: Set<string> = new Set();
    const queue: string[] = [func.entryBlock];

    while (queue.length > 0) {
      const label = queue.shift()!;
      if (reachable.has(label)) continue;
      reachable.add(label);

      const block = func.blocks.find(b => b.label === label);
      if (block) {
        for (const succ of block.successors) {
          if (!reachable.has(succ)) {
            queue.push(succ);
          }
        }
      }
    }

    const beforeCount = func.blocks.length;
    func.blocks = func.blocks.filter(b => reachable.has(b.label));

    // Update predecessor/successor references
    for (const block of func.blocks) {
      block.successors = block.successors.filter(s => reachable.has(s));
      block.predecessors = block.predecessors.filter(p => reachable.has(p));
    }

    this.applied += beforeCount - func.blocks.length;
  }

  private removeDeadInstructions(func: IRFunction): void {
    // Collect all used variables/temps
    const used: Set<string> = new Set();

    // Multiple passes since removing one instruction may free another
    let changed = true;
    while (changed) {
      changed = false;
      used.clear();

      // Collect all operand references
      for (const block of func.blocks) {
        for (const instr of block.instructions) {
          if (instr.operand1) used.add(instr.operand1);
          if (instr.operand2) used.add(instr.operand2);
          // For JZ/JNZ, the dest is a label, not a variable — don't add
          if (instr.opcode !== IROpcode.JZ && instr.opcode !== IROpcode.JNZ && instr.opcode !== IROpcode.JMP && instr.opcode !== IROpcode.LABEL) {
            if (instr.dest) used.add(instr.dest);
          }
          // CALL may have args in value
          if (instr.opcode === IROpcode.CALL && Array.isArray(instr.value)) {
            for (const arg of instr.value as string[]) {
              used.add(arg);
            }
          }
          // STORE_INDEX has value as the source
          if (instr.opcode === IROpcode.STORE_INDEX && instr.value) {
            used.add(instr.value as string);
          }
        }
      }

      // For STORE: the dest is the variable being stored to, and it's "used" if it's
      // referenced elsewhere. But STORE also has side effects. We keep all STOREs.
      // For STORE, add the dest to used set (the variable must exist)
      for (const block of func.blocks) {
        for (const instr of block.instructions) {
          if (instr.opcode === IROpcode.STORE && instr.dest) {
            used.add(instr.dest);
          }
          if (instr.opcode === IROpcode.STORE_MEMBER && instr.dest) {
            used.add(instr.dest);
          }
        }
      }

      // Remove instructions whose dest is never used and have no side effects
      for (const block of func.blocks) {
        const newInstrs: IRInstruction[] = [];
        for (const instr of block.instructions) {
          // Keep instructions with side effects
          if (hasSideEffects(instr.opcode)) {
            newInstrs.push(instr);
            continue;
          }
          // Keep instructions without a dest (shouldn't happen for pure ops, but safety)
          if (!instr.dest) {
            newInstrs.push(instr);
            continue;
          }
          // Keep if dest is used somewhere
          if (used.has(instr.dest)) {
            newInstrs.push(instr);
            continue;
          }
          // Dead instruction — remove
          this.applied++;
          changed = true;
        }
        block.instructions = newInstrs;
      }
    }
  }

  private removeNOPs(func: IRFunction): void {
    for (const block of func.blocks) {
      const before = block.instructions.length;
      block.instructions = block.instructions.filter(i => i.opcode !== IROpcode.NOP);
      this.applied += before - block.instructions.length;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Optimization Pass: Algebraic Simplification
// ═════════════════════════════════════════════════════════════════════════════

class AlgebraicSimplificationPass implements OptimizationPass {
  name = 'algebraic_simplification';
  description = 'Simplify algebraic identities like x+0, x*1, x*0';
  applied = 0;

  run(program: IRProgram): IRProgram {
    this.applied = 0;
    const result = cloneProgram(program);

    for (const func of result.functions) {
      for (const block of func.blocks) {
        this.simplifyBlock(block);
      }
    }

    return result;
  }

  private simplifyBlock(block: IRBasicBlock): void {
    const constMap: Map<string, unknown> = new Map();

    // Collect constants
    for (const instr of block.instructions) {
      if (instr.opcode === IROpcode.LOAD_CONST && instr.dest) {
        constMap.set(instr.dest, instr.value);
      }
    }

    const newInstrs: IRInstruction[] = [];

    for (const instr of block.instructions) {
      if (isBinaryArithmetic(instr.opcode) && instr.dest && instr.operand1 && instr.operand2) {
        const simplified = this.trySimplify(instr, constMap);
        if (simplified) {
          newInstrs.push(simplified);
          if (simplified.opcode === IROpcode.LOAD_CONST && simplified.dest) {
            constMap.set(simplified.dest, simplified.value);
          }
          this.applied++;
          continue;
        }
      }
      newInstrs.push(instr);
    }

    block.instructions = newInstrs;
  }

  private trySimplify(instr: IRInstruction, constMap: Map<string, unknown>): IRInstruction | null {
    const leftVal = constMap.get(instr.operand1!);
    const rightVal = constMap.get(instr.operand2!);

    const isLeftZero = leftVal === 0;
    const isRightZero = rightVal === 0;
    const isLeftOne = leftVal === 1;
    const isRightOne = rightVal === 1;

    switch (instr.opcode) {
      case IROpcode.ADD:
        // x + 0 → x
        if (isRightZero) {
          return this.makeCopy(instr.dest!, instr.operand1!, instr.loc);
        }
        // 0 + x → x
        if (isLeftZero) {
          return this.makeCopy(instr.dest!, instr.operand2!, instr.loc);
        }
        break;

      case IROpcode.SUB:
        // x - 0 → x
        if (isRightZero) {
          return this.makeCopy(instr.dest!, instr.operand1!, instr.loc);
        }
        // x - x → 0
        if (instr.operand1 === instr.operand2) {
          return this.makeConst(instr.dest!, 0, instr.loc);
        }
        break;

      case IROpcode.MUL:
        // x * 0 → 0
        if (isRightZero || isLeftZero) {
          return this.makeConst(instr.dest!, 0, instr.loc);
        }
        // x * 1 → x
        if (isRightOne) {
          return this.makeCopy(instr.dest!, instr.operand1!, instr.loc);
        }
        // 1 * x → x
        if (isLeftOne) {
          return this.makeCopy(instr.dest!, instr.operand2!, instr.loc);
        }
        break;

      case IROpcode.DIV:
        // x / 1 → x
        if (isRightOne) {
          return this.makeCopy(instr.dest!, instr.operand1!, instr.loc);
        }
        // x / x → 1 (if x != 0)
        if (instr.operand1 === instr.operand2) {
          return this.makeConst(instr.dest!, 1, instr.loc);
        }
        break;

      case IROpcode.MOD:
        // x % 1 → 0
        if (isRightOne) {
          return this.makeConst(instr.dest!, 0, instr.loc);
        }
        break;

      case IROpcode.POW:
        // x ** 0 → 1
        if (isRightZero) {
          return this.makeConst(instr.dest!, 1, instr.loc);
        }
        // x ** 1 → x
        if (isRightOne) {
          return this.makeCopy(instr.dest!, instr.operand1!, instr.loc);
        }
        break;

      case IROpcode.AND:
        // x & 0 → 0
        if (isRightZero || isLeftZero) {
          return this.makeConst(instr.dest!, 0, instr.loc);
        }
        // x & -1 (all ones) → x
        if (rightVal === -1) {
          return this.makeCopy(instr.dest!, instr.operand1!, instr.loc);
        }
        break;

      case IROpcode.OR:
        // x | 0 → x
        if (isRightZero) {
          return this.makeCopy(instr.dest!, instr.operand1!, instr.loc);
        }
        if (isLeftZero) {
          return this.makeCopy(instr.dest!, instr.operand2!, instr.loc);
        }
        break;

      case IROpcode.XOR:
        // x ^ 0 → x
        if (isRightZero) {
          return this.makeCopy(instr.dest!, instr.operand1!, instr.loc);
        }
        if (isLeftZero) {
          return this.makeCopy(instr.dest!, instr.operand2!, instr.loc);
        }
        // x ^ x → 0
        if (instr.operand1 === instr.operand2) {
          return this.makeConst(instr.dest!, 0, instr.loc);
        }
        break;

      case IROpcode.SHL:
      case IROpcode.SHR:
        // x << 0 → x, x >> 0 → x
        if (isRightZero) {
          return this.makeCopy(instr.dest!, instr.operand1!, instr.loc);
        }
        break;
    }

    return null;
  }

  private makeCopy(dest: string, src: string, loc: IRInstruction['loc']): IRInstruction {
    return {
      opcode: IROpcode.LOAD,
      dest,
      operand1: src,
      id: generateInstrId(),
      loc,
    };
  }

  private makeConst(dest: string, value: unknown, loc: IRInstruction['loc']): IRInstruction {
    return {
      opcode: IROpcode.LOAD_CONST,
      dest,
      value,
      id: generateInstrId(),
      loc,
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Optimization Pass: Common Subexpression Elimination (basic, intra-block)
// ═════════════════════════════════════════════════════════════════════════════

class CommonSubexpressionEliminationPass implements OptimizationPass {
  name = 'common_subexpression_elimination';
  description = 'Reuse results of identical computations within the same basic block';
  applied = 0;

  run(program: IRProgram): IRProgram {
    this.applied = 0;
    const result = cloneProgram(program);

    for (const func of result.functions) {
      for (const block of func.blocks) {
        this.cseBlock(block);
      }
    }

    return result;
  }

  private cseBlock(block: IRBasicBlock): void {
    // Map: "opcode:operand1:operand2" → dest (first computation)
    const exprMap: Map<string, string> = new Map();
    // Track which temps have been invalidated by STOREs
    const invalidated: Set<string> = new Set();

    const newInstrs: IRInstruction[] = [];

    for (const instr of block.instructions) {
      // If this is a STORE, invalidate any expressions that use the stored variable
      if (instr.opcode === IROpcode.STORE && instr.dest) {
        // Invalidate expressions that use this variable as an operand
        const varName = instr.dest;
        exprMap.forEach((_val, key) => {
          if (key.includes(varName)) {
            invalidated.add(key);
          }
        });
      }

      // For pure binary/unary operations, check if we've seen this expression before
      if (this.isCseCandidate(instr) && instr.dest && instr.operand1) {
        const exprKey = this.makeExprKey(instr);

        if (exprKey && exprMap.has(exprKey) && !invalidated.has(exprKey)) {
          // Replace with a copy of the previously computed value
          const prevDest = exprMap.get(exprKey)!;
          const copyInstr: IRInstruction = {
            opcode: IROpcode.LOAD,
            dest: instr.dest,
            operand1: prevDest,
            id: generateInstrId(),
            loc: instr.loc,
          };
          newInstrs.push(copyInstr);
          this.applied++;
          continue;
        }

        // Record this expression
        if (exprKey) {
          exprMap.set(exprKey, instr.dest);
        }
      }

      newInstrs.push(instr);
    }

    block.instructions = newInstrs;
  }

  private isCseCandidate(instr: IRInstruction): boolean {
    // Only pure computations (no side effects)
    return isBinaryArithmetic(instr.opcode) ||
           instr.opcode === IROpcode.NEG ||
           instr.opcode === IROpcode.NOT ||
           instr.opcode === IROpcode.LOAD ||
           instr.opcode === IROpcode.LOAD_MEMBER ||
           instr.opcode === IROpcode.LOAD_INDEX;
  }

  private makeExprKey(instr: IRInstruction): string | null {
    if (instr.opcode === IROpcode.LOAD_CONST) {
      // Constants are unique by value, not worth CSE-ing
      return null;
    }
    const parts: string[] = [instr.opcode];
    if (instr.operand1) parts.push(instr.operand1);
    if (instr.operand2) parts.push(instr.operand2);
    // For LOAD_MEMBER, include the member name
    if (instr.opcode === IROpcode.LOAD_MEMBER && instr.operand2) {
      parts.push(instr.operand2);
    }
    return parts.join(':');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Optimization Pipeline
// ═════════════════════════════════════════════════════════════════════════════

export function optimizeIR(program: IRProgram): OptimizationResult {
  const instrBefore = countInstructions(program);

  const passes: OptimizationPass[] = [
    new ConstantFoldingPass(),
    new ConstantPropagationPass(),
    new DeadCodeEliminationPass(),
    new AlgebraicSimplificationPass(),
    new CommonSubexpressionEliminationPass(),
    new DeadCodeEliminationPass(), // Final DCE
  ];

  const passResults: OptimizationPassResult[] = [];
  let currentProgram = cloneProgram(program);
  let totalConstantsFolded = 0;
  let totalDeadCodeEliminated = 0;
  let totalCSE = 0;

  const MAX_ITERATIONS = 3;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let improved = false;
    const instrsAtStart = countInstructions(currentProgram);

    for (const pass of passes) {
      const beforeInstrCount = countInstructions(currentProgram);
      currentProgram = pass.run(currentProgram);
      const afterInstrCount = countInstructions(currentProgram);

      const applied = (pass as any).applied ?? 0;
      if (applied > 0) {
        improved = true;
      }

      // Track stats by pass name
      if (pass.name === 'constant_folding') {
        totalConstantsFolded += applied;
      } else if (pass.name === 'dead_code_elimination') {
        totalDeadCodeEliminated += applied;
      } else if (pass.name === 'common_subexpression_elimination') {
        totalCSE += applied;
      }

      // Only record pass results from the last iteration (or if applied > 0)
      const existingResult = passResults.find(pr => pr.name === pass.name);
      const detail = `${pass.description}: ${applied} simplification(s) applied (iteration ${iteration + 1})`;

      if (existingResult) {
        existingResult.applied += applied;
        existingResult.details += `; ${detail}`;
      } else if (applied > 0) {
        passResults.push({
          name: pass.name,
          applied,
          details: detail,
        });
      }
    }

    // If no improvements, stop iterating
    if (!improved) break;
  }

  // Recompute stats on the optimized program
  const instrAfter = countInstructions(currentProgram);
  const reduction = instrBefore - instrAfter;
  const reductionPercent = instrBefore > 0 ? (reduction / instrBefore) * 100 : 0;

  // Recompute block/instruction counts in the stats
  let totalInstrs = currentProgram.globals.length;
  let totalBlocks = 0;
  for (const func of currentProgram.functions) {
    for (const block of func.blocks) {
      totalInstrs += block.instructions.length;
    }
    totalBlocks += func.blocks.length;
  }
  currentProgram.stats = {
    totalInstructions: totalInstrs,
    totalBlocks,
    totalFunctions: currentProgram.functions.length,
    totalTemps: currentProgram.stats.totalTemps,
  };

  const stats: OptimizationStats = {
    instructionsBefore: instrBefore,
    instructionsAfter: instrAfter,
    reduction,
    reductionPercent: Math.round(reductionPercent * 100) / 100,
    passesApplied: passResults.length,
    constantsFolded: totalConstantsFolded,
    deadCodeEliminated: totalDeadCodeEliminated,
    commonSubExprEliminated: totalCSE,
  };

  return {
    program: currentProgram,
    passes: passResults,
    stats,
  };
}
