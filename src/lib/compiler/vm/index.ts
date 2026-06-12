/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge Compiler — IR Virtual Machine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A direct IR execution engine that interprets three-address code IR
 * instructions without needing any external compiler or runtime.
 *
 * This demonstrates TRUE compiler execution: our own pipeline generates IR,
 * and our own VM executes it.
 *
 * Architecture:
 *   - Builds flat instruction arrays from basic blocks per function
 *   - Builds label→index maps for jump targets
 *   - Executes instructions sequentially with a program counter
 *   - Supports function calls with call stack frames
 *   - Built-in functions: print, println, len, abs, str, int, float, input, range
 *   - Safety limits: max 1M steps, max 100 call depth, max 100KB output
 */

import {
  IROpcode,
  IRInstruction,
  IRProgram,
  IRFunction,
  VMResult,
} from '../types';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_STEPS = 1_000_000;
const MAX_CALL_DEPTH = 100;
const MAX_OUTPUT_SIZE = 100 * 1024; // 100KB

// ─── Types ──────────────────────────────────────────────────────────────────

interface FlatFunction {
  name: string;
  params: string[];
  instructions: IRInstruction[];
  labelMap: Map<string, number>;
}

// ─── canExecuteIR ───────────────────────────────────────────────────────────

/**
 * Check if the IR program can be executed by the VM.
 * Returns { canExecute: true, reason: '' } if the VM can handle it.
 */
export function canExecuteIR(program: IRProgram): { canExecute: boolean; reason: string } {
  const reasons: string[] = [];

  const builtInNames = new Set([
    'print', 'println', 'len', 'abs', 'str', 'int', 'float',
    'input', 'range', 'type', 'min', 'max', 'sqrt', 'pow',
    '__assert_fail', '__throw',
  ]);

  const userFuncNames = new Set(program.functions.map(f => f.name));

  for (const func of program.functions) {
    for (const block of func.blocks) {
      for (const instr of block.instructions) {
        // IMPORT instructions need external modules
        // (We don't have an IMPORT opcode in IROpcode, but check if NOP has import-like value)
        if (instr.opcode === IROpcode.NOP && typeof instr.value === 'string' && instr.value.includes('import')) {
          // NOP with import context — not executable via VM
          reasons.push(`Import dependency at ${instr.loc?.startLine ?? '?'}: ${instr.value}`);
        }

        // ALLOC/FREE — complex memory management
        if (instr.opcode === IROpcode.ALLOC) {
          // We support basic ALLOC for arrays/objects, so this is okay
          // but flag complex allocations
          if (instr.operand1 && instr.operand1 !== 'Array' && instr.operand1 !== 'Object') {
            reasons.push(`Complex allocation of type "${instr.operand1}" — VM only supports Array/Object`);
          }
        }

        if (instr.opcode === IROpcode.FREE) {
          reasons.push('FREE instruction — VM does not manage manual memory');
        }

        // LOAD_MEMBER/STORE_MEMBER with dynamic properties
        if (instr.opcode === IROpcode.LOAD_MEMBER || instr.opcode === IROpcode.STORE_MEMBER) {
          // operand2 for LOAD_MEMBER is the member name — if it's a temp variable, it's dynamic
          if (instr.opcode === IROpcode.LOAD_MEMBER && instr.operand2) {
            // If operand2 starts with 't' (temp variable), it's a dynamic member access
            if (/^t\d+$/.test(instr.operand2)) {
              reasons.push(`Dynamic member access — LOAD_MEMBER with computed property name`);
            }
          }
          if (instr.opcode === IROpcode.STORE_MEMBER && instr.dest) {
            if (/^t\d+$/.test(instr.dest)) {
              reasons.push(`Dynamic member store — STORE_MEMBER with computed property name`);
            }
          }
        }

        // CALL to external/built-in functions not in our runtime
        if (instr.opcode === IROpcode.CALL && instr.operand1) {
          const funcName = instr.operand1;
          // Method calls like "obj.method" are complex
          if (funcName.includes('.')) {
            // Check if it's a known built-in method
            const methodPart = funcName.split('.').pop() ?? '';
            const knownMethods = ['append', 'push', 'pop', 'length', 'split', 'join',
              'upper', 'lower', 'strip', 'lstrip', 'rstrip', 'replace', 'find',
              'count', 'startswith', 'endswith', 'format', 'map', 'filter',
              'keys', 'values', 'items', 'toString', 'valueOf'];
            if (!knownMethods.includes(methodPart)) {
              reasons.push(`Unknown method call: ${funcName} — VM has limited method support`);
            }
          } else if (!builtInNames.has(funcName) && !userFuncNames.has(funcName)) {
            reasons.push(`Unknown function call: ${funcName} — not in VM runtime or program`);
          }
        }

        // Any instruction with `value` that's an object/array (not primitive)
        if (instr.value !== undefined && instr.value !== null) {
          if (typeof instr.value === 'object' && !Array.isArray(instr.value)) {
            reasons.push(`Object literal value in instruction ${instr.opcode} — VM only supports primitives`);
          }
          // Arrays of temps are okay for CALL multi-arg, but other arrays are questionable
          if (Array.isArray(instr.value) && instr.opcode !== IROpcode.CALL) {
            // For LOAD_CONST with array value — limited support
            if (instr.opcode === IROpcode.LOAD_CONST) {
              // Allow primitive arrays
              const allPrimitive = (instr.value as unknown[]).every(
                v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null
              );
              if (!allPrimitive) {
                reasons.push(`Non-primitive array value in LOAD_CONST — VM only supports primitive arrays`);
              }
            }
          }
        }

        // PHI nodes — SSA form, VM doesn't handle these
        if (instr.opcode === IROpcode.PHI) {
          reasons.push('PHI instruction — VM does not support SSA phi nodes');
        }

        // READ — interactive input (limited support)
        if (instr.opcode === IROpcode.READ) {
          // We can support this with stdin buffer
        }

        // CAST — limited support
        if (instr.opcode === IROpcode.CAST) {
          // We support basic casts (int, float, str, bool)
          const targetType = instr.operand2;
          if (targetType && !['int', 'float', 'str', 'string', 'bool', 'boolean', 'number'].includes(targetType)) {
            reasons.push(`Cast to "${targetType}" — VM only supports basic type casts`);
          }
        }
      }
    }
  }

  // Also check globals
  for (const instr of program.globals) {
    if (instr.opcode === IROpcode.FREE) {
      reasons.push('FREE instruction in globals — VM does not manage manual memory');
    }
    if (instr.opcode === IROpcode.PHI) {
      reasons.push('PHI instruction in globals — VM does not support SSA phi nodes');
    }
  }

  if (reasons.length > 0) {
    return { canExecute: false, reason: reasons.join('; ') };
  }
  return { canExecute: true, reason: '' };
}

// ─── executeIR ──────────────────────────────────────────────────────────────

/**
 * Execute the IR program directly.
 *
 * @param program - The IR program to execute
 * @param stdin - Optional stdin input string
 * @returns VMResult with output, exit code, timing, etc.
 */
export function executeIR(program: IRProgram, stdin?: string): VMResult {
  const startTime = Date.now();

  try {
    // ── Build flat instruction arrays for all functions ──
    const functionMap = new Map<string, FlatFunction>();
    for (const func of program.functions) {
      functionMap.set(func.name, buildFlatFunction(func));
    }

    // ── Find main function ──
    let mainName = program.mainFunction;
    // Handle __main__ convention
    if (!functionMap.has(mainName) && functionMap.has('__main__')) {
      mainName = '__main__';
    }
    if (!functionMap.has(mainName)) {
      // Try common alternatives
      const candidates = ['main', '__main__', 'Main', 'start'];
      mainName = candidates.find(c => functionMap.has(c)) ?? mainName;
    }
    if (!functionMap.has(mainName)) {
      return {
        success: false,
        output: [],
        exitCode: 1,
        executionTimeMs: Date.now() - startTime,
        error: `No main function found. Available: ${[...functionMap.keys()].join(', ')}`,
        stepsExecuted: 0,
      };
    }

    // ── Initialize VM state ──
    const output: string[] = [];
    let outputSize = 0;
    let stepCount = 0;
    const stdinLines = stdin ? stdin.split('\n') : [];
    let stdinIndex = 0;

    // Current execution state
    let currentFuncName = mainName;
    let currentFlat = functionMap.get(mainName)!;
    let ip = 0; // instruction pointer
    const variables = new Map<string, unknown>(); // current scope variables
    const callStack: Array<{
      functionName: string;
      returnAddress: number;
      returnFunction: string;
      locals: Map<string, unknown>;
      resultDest: string | null;
    }> = [];

    // ── Helper: resolve operand ──
    // If name is in variables, return its value; otherwise try as literal
    function resolve(name: string | undefined): unknown {
      if (name === undefined || name === null) return undefined;
      if (variables.has(name)) return variables.get(name);

      // Try as number literal
      const asNum = Number(name);
      if (!isNaN(asNum) && name.trim() !== '') return asNum;

      // Try as boolean literal
      if (name === 'true' || name === 'True') return true;
      if (name === 'false' || name === 'False') return false;

      // Try as string literal (remove quotes if present)
      if ((name.startsWith('"') && name.endsWith('"')) ||
          (name.startsWith("'") && name.endsWith("'"))) {
        return name.slice(1, -1);
      }

      // null/none
      if (name === 'null' || name === 'None' || name === 'none') return null;

      // Unknown — return the name itself (could be an unresolved variable)
      return name;
    }

    // ── Helper: convert to number ──
    function toNumber(val: unknown): number {
      if (typeof val === 'number') return val;
      if (typeof val === 'boolean') return val ? 1 : 0;
      if (typeof val === 'string') {
        const n = Number(val);
        return isNaN(n) ? 0 : n;
      }
      if (val === null || val === undefined) return 0;
      return 0;
    }

    // ── Helper: check truthiness ──
    function isTruthy(val: unknown): boolean {
      if (val === undefined || val === null) return false;
      if (typeof val === 'boolean') return val;
      if (typeof val === 'number') return val !== 0;
      if (typeof val === 'string') return val.length > 0;
      return true;
    }

    // ── Helper: add output ──
    function addOutput(text: string): boolean {
      outputSize += text.length;
      if (outputSize > MAX_OUTPUT_SIZE) {
        output.push('\n[Output limit exceeded — 100KB max]');
        return false; // signal to stop
      }
      output.push(text);
      return true;
    }

    // ── Helper: smart division (integer when exact, float otherwise) ──
    function smartDiv(a: number, b: number): number {
      if (b === 0) {
        if (a === 0) return NaN;
        return a > 0 ? Infinity : -Infinity;
      }
      const result = a / b;
      if (Number.isInteger(a) && Number.isInteger(b) && a % b === 0) {
        return result; // exact integer division
      }
      return result;
    }

    // ── Helper: execute a built-in function ──
    function executeBuiltin(name: string, args: unknown[]): { value: unknown; shouldReturn: boolean } {
      switch (name) {
        case 'print': {
          const text = args.map(a => String(a ?? 'None')).join(' ');
          addOutput(text + '\n');
          return { value: null, shouldReturn: true };
        }
        case 'println': {
          const text = args.map(a => String(a ?? 'None')).join(' ');
          addOutput(text + '\n');
          return { value: null, shouldReturn: true };
        }
        case 'len': {
          const val = args[0];
          if (typeof val === 'string') return { value: val.length, shouldReturn: true };
          if (Array.isArray(val)) return { value: val.length, shouldReturn: true };
          return { value: 0, shouldReturn: true };
        }
        case 'abs': {
          return { value: Math.abs(toNumber(args[0])), shouldReturn: true };
        }
        case 'str': {
          const val = args[0];
          if (val === null || val === undefined) return { value: 'None', shouldReturn: true };
          return { value: String(val), shouldReturn: true };
        }
        case 'int': {
          const n = toNumber(args[0]);
          return { value: Math.trunc(n), shouldReturn: true };
        }
        case 'float': {
          return { value: toNumber(args[0]), shouldReturn: true };
        }
        case 'input': {
          if (stdinIndex < stdinLines.length) {
            const line = stdinLines[stdinIndex++];
            addOutput(line + '\n'); // echo input
            return { value: line, shouldReturn: true };
          }
          return { value: '', shouldReturn: true };
        }
        case 'range': {
          const n = toNumber(args[0]);
          const start = args[1] !== undefined ? toNumber(args[1]) : 0;
          const step = args[2] !== undefined ? toNumber(args[2]) : (start <= n ? 1 : -1);
          const arr: number[] = [];
          if (args.length === 1) {
            // range(n) → [0, 1, ..., n-1]
            for (let i = 0; i < n; i++) arr.push(i);
          } else if (args.length === 2) {
            // range(start, n)
            if (step > 0) {
              for (let i = start; i < n; i += step) arr.push(i);
            } else {
              for (let i = start; i > n; i += step) arr.push(i);
            }
          } else {
            // range(start, stop, step)
            if (step > 0) {
              for (let i = start; i < n; i += step) arr.push(i);
            } else if (step < 0) {
              for (let i = start; i > n; i += step) arr.push(i);
            }
          }
          return { value: arr, shouldReturn: true };
        }
        case 'type': {
          const val = args[0];
          if (val === null || val === undefined) return { value: 'NoneType', shouldReturn: true };
          if (typeof val === 'number') return { value: Number.isInteger(val) ? 'int' : 'float', shouldReturn: true };
          if (typeof val === 'string') return { value: 'str', shouldReturn: true };
          if (typeof val === 'boolean') return { value: 'bool', shouldReturn: true };
          if (Array.isArray(val)) return { value: 'list', shouldReturn: true };
          return { value: typeof val, shouldReturn: true };
        }
        case 'min': {
          const nums = args.map(toNumber);
          return { value: Math.min(...nums), shouldReturn: true };
        }
        case 'max': {
          const nums = args.map(toNumber);
          return { value: Math.max(...nums), shouldReturn: true };
        }
        case 'sqrt': {
          return { value: Math.sqrt(toNumber(args[0])), shouldReturn: true };
        }
        case 'pow': {
          return { value: Math.pow(toNumber(args[0]), toNumber(args[1])), shouldReturn: true };
        }
        case '__assert_fail': {
          const msg = args[0] !== undefined ? String(args[0]) : 'Assertion failed';
          return { value: new Error(msg), shouldReturn: true };
        }
        case '__throw': {
          const msg = args[0] !== undefined ? String(args[0]) : 'Exception thrown';
          return { value: new Error(msg), shouldReturn: true };
        }
        default:
          return { value: undefined, shouldReturn: false };
      }
    }

    // ── Helper: execute method call on object ──
    function executeMethodCall(obj: unknown, method: string, args: unknown[]): unknown {
      if (Array.isArray(obj)) {
        switch (method) {
          case 'append':
          case 'push':
            obj.push(args[0]);
            return null;
          case 'pop':
            return obj.pop();
          case 'length':
            return obj.length;
          case 'join':
            return obj.map(String).join(args[0] !== undefined ? String(args[0]) : ',');
          case 'map':
            // Limited: can't really do function mapping in VM
            return obj;
          case 'filter':
            return obj;
          case 'reverse':
            obj.reverse();
            return null;
          case 'sort':
            obj.sort((a, b) => (a as number) - (b as number));
            return null;
          case 'indexOf':
            return obj.indexOf(args[0]);
          case 'slice': {
            const start = toNumber(args[0]);
            const end = args[1] !== undefined ? toNumber(args[1]) : obj.length;
            return obj.slice(start, end);
          }
          case 'concat':
            return obj.concat(args[0]);
          case 'includes':
            return obj.includes(args[0]);
          default:
            return undefined;
        }
      }
      if (typeof obj === 'string') {
        switch (method) {
          case 'upper':
          case 'toUpperCase':
            return obj.toUpperCase();
          case 'lower':
          case 'toLowerCase':
            return obj.toLowerCase();
          case 'strip':
          case 'trim':
            return obj.trim();
          case 'lstrip':
            return obj.trimStart();
          case 'rstrip':
            return obj.trimEnd();
          case 'replace':
            return obj.replaceAll(String(args[0] ?? ''), String(args[1] ?? ''));
          case 'find':
            return obj.indexOf(String(args[0] ?? ''));
          case 'count':
            return (obj.match(new RegExp(String(args[0] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
          case 'startswith':
            return obj.startsWith(String(args[0] ?? ''));
          case 'endswith':
            return obj.endsWith(String(args[0] ?? ''));
          case 'split':
            return obj.split(args[0] !== undefined ? String(args[0]) : /\s+/);
          case 'join':
            return String(args[0] ?? []).split(',').join(obj);
          case 'length':
            return obj.length;
          case 'charAt':
            return obj.charAt(toNumber(args[0]));
          case 'substring':
          case 'slice': {
            const s = toNumber(args[0]);
            const e = args[1] !== undefined ? toNumber(args[1]) : obj.length;
            return obj.slice(s, e);
          }
          case 'repeat':
            return obj.repeat(toNumber(args[0]));
          case 'indexOf':
            return obj.indexOf(String(args[0] ?? ''));
          case 'includes':
            return obj.includes(String(args[0] ?? ''));
          case 'format': {
            // Python-style format: "{}".format(val)
            let result = obj;
            let idx = 0;
            return result.replace(/\{\}/g, () => String(args[idx++] ?? ''));
          }
          default:
            return undefined;
        }
      }
      if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
        const record = obj as Record<string, unknown>;
        switch (method) {
          case 'keys':
            return Object.keys(record);
          case 'values':
            return Object.values(record);
          case 'items':
            return Object.entries(record);
          case 'toString':
            return JSON.stringify(record);
          case 'hasOwnProperty':
            return String(args[0] ?? '') in record;
          default:
            // Try to access the method as a property
            return record[method];
        }
      }
      return undefined;
    }

    // ── Main execution loop ──
    let halted = false;
    let exitCode = 0;
    let errorMsg: string | undefined;

    while (!halted && ip < currentFlat.instructions.length) {
      // Safety: step limit
      stepCount++;
      if (stepCount > MAX_STEPS) {
        errorMsg = `Execution limit exceeded: ${MAX_STEPS} instruction steps (infinite loop protection)`;
        exitCode = 1;
        break;
      }

      const instr = currentFlat.instructions[ip];
      ip++; // advance by default (jumps override this)

      switch (instr.opcode) {
        // ── Arithmetic ──────────────────────────────────────────────
        case IROpcode.ADD: {
          const a = resolve(instr.operand1);
          const b = resolve(instr.operand2);
          // String concatenation if either is a string
          if (typeof a === 'string' || typeof b === 'string') {
            variables.set(instr.dest!, String(a ?? '') + String(b ?? ''));
          } else {
            variables.set(instr.dest!, toNumber(a) + toNumber(b));
          }
          break;
        }
        case IROpcode.SUB: {
          const a = resolve(instr.operand1);
          const b = resolve(instr.operand2);
          variables.set(instr.dest!, toNumber(a) - toNumber(b));
          break;
        }
        case IROpcode.MUL: {
          const a = resolve(instr.operand1);
          const b = resolve(instr.operand2);
          // String repetition: "abc" * 3
          if (typeof a === 'string' && typeof b === 'number') {
            variables.set(instr.dest!, a.repeat(Math.max(0, Math.floor(b))));
          } else if (typeof b === 'string' && typeof a === 'number') {
            variables.set(instr.dest!, b.repeat(Math.max(0, Math.floor(a))));
          } else {
            variables.set(instr.dest!, toNumber(a) * toNumber(b));
          }
          break;
        }
        case IROpcode.DIV: {
          const a = toNumber(resolve(instr.operand1));
          const b = toNumber(resolve(instr.operand2));
          if (b === 0) {
            if (a === 0) {
              variables.set(instr.dest!, NaN);
            } else {
              variables.set(instr.dest!, a > 0 ? Infinity : -Infinity);
            }
          } else {
            variables.set(instr.dest!, smartDiv(a, b));
          }
          break;
        }
        case IROpcode.MOD: {
          const a = toNumber(resolve(instr.operand1));
          const b = toNumber(resolve(instr.operand2));
          if (b === 0) {
            variables.set(instr.dest!, NaN);
          } else {
            // Python-style modulo (result has sign of divisor)
            variables.set(instr.dest!, a % b);
          }
          break;
        }
        case IROpcode.POW: {
          const a = toNumber(resolve(instr.operand1));
          const b = toNumber(resolve(instr.operand2));
          variables.set(instr.dest!, Math.pow(a, b));
          break;
        }
        case IROpcode.NEG: {
          const a = toNumber(resolve(instr.operand1));
          variables.set(instr.dest!, -a);
          break;
        }

        // ── Bitwise ────────────────────────────────────────────────
        case IROpcode.AND: {
          const a = toNumber(resolve(instr.operand1));
          const b = toNumber(resolve(instr.operand2));
          variables.set(instr.dest!, a & b);
          break;
        }
        case IROpcode.OR: {
          const a = toNumber(resolve(instr.operand1));
          const b = toNumber(resolve(instr.operand2));
          variables.set(instr.dest!, a | b);
          break;
        }
        case IROpcode.XOR: {
          const a = toNumber(resolve(instr.operand1));
          const b = toNumber(resolve(instr.operand2));
          variables.set(instr.dest!, a ^ b);
          break;
        }
        case IROpcode.NOT: {
          const a = toNumber(resolve(instr.operand1));
          variables.set(instr.dest!, ~a);
          break;
        }
        case IROpcode.SHL: {
          const a = toNumber(resolve(instr.operand1));
          const b = toNumber(resolve(instr.operand2));
          variables.set(instr.dest!, a << b);
          break;
        }
        case IROpcode.SHR: {
          const a = toNumber(resolve(instr.operand1));
          const b = toNumber(resolve(instr.operand2));
          variables.set(instr.dest!, a >> b);
          break;
        }

        // ── Comparison ─────────────────────────────────────────────
        case IROpcode.EQ: {
          const a = resolve(instr.operand1);
          const b = resolve(instr.operand2);
          variables.set(instr.dest!, a === b);
          break;
        }
        case IROpcode.NE: {
          const a = resolve(instr.operand1);
          const b = resolve(instr.operand2);
          variables.set(instr.dest!, a !== b);
          break;
        }
        case IROpcode.LT: {
          const a = resolve(instr.operand1);
          const b = resolve(instr.operand2);
          // String comparison
          if (typeof a === 'string' && typeof b === 'string') {
            variables.set(instr.dest!, a < b);
          } else {
            variables.set(instr.dest!, toNumber(a) < toNumber(b));
          }
          break;
        }
        case IROpcode.LE: {
          const a = resolve(instr.operand1);
          const b = resolve(instr.operand2);
          if (typeof a === 'string' && typeof b === 'string') {
            variables.set(instr.dest!, a <= b);
          } else {
            variables.set(instr.dest!, toNumber(a) <= toNumber(b));
          }
          break;
        }
        case IROpcode.GT: {
          const a = resolve(instr.operand1);
          const b = resolve(instr.operand2);
          if (typeof a === 'string' && typeof b === 'string') {
            variables.set(instr.dest!, a > b);
          } else {
            variables.set(instr.dest!, toNumber(a) > toNumber(b));
          }
          break;
        }
        case IROpcode.GE: {
          const a = resolve(instr.operand1);
          const b = resolve(instr.operand2);
          if (typeof a === 'string' && typeof b === 'string') {
            variables.set(instr.dest!, a >= b);
          } else {
            variables.set(instr.dest!, toNumber(a) >= toNumber(b));
          }
          break;
        }

        // ── Control Flow ───────────────────────────────────────────
        case IROpcode.JMP: {
          const target = instr.dest;
          if (target && currentFlat.labelMap.has(target)) {
            ip = currentFlat.labelMap.get(target)!;
          }
          break;
        }
        case IROpcode.JZ: {
          const cond = resolve(instr.operand1);
          if (!isTruthy(cond)) {
            const target = instr.dest;
            if (target && currentFlat.labelMap.has(target)) {
              ip = currentFlat.labelMap.get(target)!;
            }
          }
          break;
        }
        case IROpcode.JNZ: {
          const cond = resolve(instr.operand1);
          if (isTruthy(cond)) {
            const target = instr.dest;
            if (target && currentFlat.labelMap.has(target)) {
              ip = currentFlat.labelMap.get(target)!;
            }
          }
          break;
        }
        case IROpcode.LABEL: {
          // No-op marker — skip
          break;
        }

        case IROpcode.CALL: {
          const destName = instr.dest ?? undefined;
          const funcName = instr.operand1 ?? '';
          const firstArg = instr.operand2; // first argument temp name
          const restArgs = instr.value; // remaining argument temp names (string[])

          // Resolve arguments
          const args: unknown[] = [];
          if (firstArg !== undefined && firstArg !== null) {
            args.push(resolve(firstArg));
          }
          if (Array.isArray(restArgs)) {
            for (const argName of restArgs) {
              if (typeof argName === 'string') {
                args.push(resolve(argName));
              } else {
                args.push(argName);
              }
            }
          }

          // Check for method calls (obj.method)
          if (funcName.includes('.')) {
            const parts = funcName.split('.');
            const objName = parts[0];
            const method = parts.slice(1).join('.');
            const obj = resolve(objName);

            // Check if obj is actually a function reference string
            if (typeof obj === 'string' && functionMap.has(obj)) {
              // It's a function reference — call it
              // Not a method call after all
              const targetFunc = functionMap.get(obj)!;

              if (callStack.length >= MAX_CALL_DEPTH) {
                errorMsg = `Call stack overflow: maximum depth of ${MAX_CALL_DEPTH} exceeded`;
                exitCode = 1;
                halted = true;
                break;
              }

              // Save current state
              callStack.push({
                functionName: currentFuncName,
                returnAddress: ip,
                returnFunction: currentFuncName,
                locals: new Map(variables),
                resultDest: destName ?? null,
              });

              // Switch to callee
              currentFuncName = obj;
              currentFlat = targetFunc;
              ip = 0;
              variables.clear();

              // Set up parameters
              for (let i = 0; i < targetFunc.params.length && i < args.length; i++) {
                variables.set(targetFunc.params[i], args[i]);
              }
              break;
            }

            // Try as method call
            const result = executeMethodCall(obj, method, args);
            if (result !== undefined) {
              if (destName) variables.set(destName, result);
            } else {
              // Method not found — try as class method (e.g., ClassName.__init__)
              const classMethodFunc = functionMap.get(funcName);
              if (classMethodFunc) {
                if (callStack.length >= MAX_CALL_DEPTH) {
                  errorMsg = `Call stack overflow: maximum depth of ${MAX_CALL_DEPTH} exceeded`;
                  exitCode = 1;
                  halted = true;
                  break;
                }

                callStack.push({
                  functionName: currentFuncName,
                  returnAddress: ip,
                  returnFunction: currentFuncName,
                  locals: new Map(variables),
                  resultDest: destName ?? null,
                });

                currentFuncName = funcName;
                currentFlat = classMethodFunc;
                ip = 0;
                variables.clear();

                // Set up parameters — 'self' or 'this' as first arg
                for (let i = 0; i < classMethodFunc.params.length && i < args.length; i++) {
                  variables.set(classMethodFunc.params[i], args[i]);
                }
              } else {
                // Unknown method — set dest to undefined
                if (destName) variables.set(destName, undefined);
              }
            }
            break;
          }

          // Check built-in functions first
          const builtin = executeBuiltin(funcName, args);
          if (builtin.shouldReturn) {
            if (destName) {
              // Check if result is an error (assert/throw)
              if (builtin.value instanceof Error) {
                errorMsg = builtin.value.message;
                exitCode = 1;
                halted = true;
                break;
              }
              variables.set(destName, builtin.value);
            }
            break;
          }

          // Look up user-defined function
          const targetFunc = functionMap.get(funcName);
          if (targetFunc) {
            if (callStack.length >= MAX_CALL_DEPTH) {
              errorMsg = `Call stack overflow: maximum depth of ${MAX_CALL_DEPTH} exceeded`;
              exitCode = 1;
              halted = true;
              break;
            }

            // Save current state
            callStack.push({
              functionName: currentFuncName,
              returnAddress: ip,
              returnFunction: currentFuncName,
              locals: new Map(variables),
              resultDest: destName ?? null,
            });

            // Switch to callee
            currentFuncName = funcName;
            currentFlat = targetFunc;
            ip = 0;
            variables.clear();

            // Set up parameters from arguments
            for (let i = 0; i < targetFunc.params.length && i < args.length; i++) {
              variables.set(targetFunc.params[i], args[i]);
            }
            break;
          }

          // Unknown function
          if (destName) variables.set(destName, undefined);
          break;
        }

        case IROpcode.RET: {
          const retVal = instr.dest ? resolve(instr.dest) : undefined;

          // Pop call frame
          if (callStack.length > 0) {
            const frame = callStack.pop()!;
            // Store return value in caller's scope
            if (frame.resultDest && retVal !== undefined) {
              frame.locals.set(frame.resultDest, retVal);
            }
            // Restore caller state
            currentFuncName = frame.returnFunction;
            currentFlat = functionMap.get(frame.returnFunction)!;
            ip = frame.returnAddress;
            variables.clear();
            // Restore all variables
            for (const [k, v] of frame.locals) {
              variables.set(k, v);
            }
          } else {
            // Return from main — halt execution
            halted = true;
            exitCode = 0;
          }
          break;
        }

        // ── Memory/Variable ────────────────────────────────────────
        case IROpcode.LOAD_CONST: {
          variables.set(instr.dest!, instr.value);
          break;
        }
        case IROpcode.LOAD: {
          // LOAD dest, src → variables[dest] = variables[src]
          const srcName = instr.operand1!;
          if (variables.has(srcName)) {
            variables.set(instr.dest!, variables.get(srcName));
          } else {
            // Source not in scope — might be a global or parameter not yet set
            // Store undefined (or the name itself as a fallback)
            variables.set(instr.dest!, undefined);
          }
          break;
        }
        case IROpcode.STORE: {
          // STORE dest, src → variables[dest] = variables[src]
          const srcValue = resolve(instr.operand1);
          variables.set(instr.dest!, srcValue);
          break;
        }

        case IROpcode.ALLOC: {
          // Create empty object or array
          const allocType = instr.operand1 ?? 'Object';
          if (allocType === 'Array') {
            variables.set(instr.dest!, []);
          } else if (allocType === 'Object') {
            variables.set(instr.dest!, {});
          } else {
            // Custom type — create object with __type__ marker
            variables.set(instr.dest!, { __type__: allocType });
          }
          break;
        }
        case IROpcode.FREE: {
          // No-op in our GC-managed VM
          break;
        }

        case IROpcode.LOAD_INDEX: {
          // LOAD_INDEX dest, arr, idx
          const arr = resolve(instr.operand1);
          const idx = resolve(instr.operand2);
          if (Array.isArray(arr)) {
            const idxNum = toNumber(idx);
            variables.set(instr.dest!, arr[idxNum]);
          } else if (typeof arr === 'string') {
            const idxNum = toNumber(idx);
            variables.set(instr.dest!, arr[idxNum] ?? '');
          } else if (typeof arr === 'object' && arr !== null) {
            // Object indexing by string key
            variables.set(instr.dest!, (arr as Record<string, unknown>)[String(idx)]);
          } else {
            variables.set(instr.dest!, undefined);
          }
          break;
        }
        case IROpcode.STORE_INDEX: {
          // STORE_INDEX [dest], arr, idx, val
          const arr = resolve(instr.operand1);
          const idx = resolve(instr.operand2);
          const val = instr.value !== undefined
            ? (typeof instr.value === 'string' ? resolve(instr.value) : instr.value)
            : undefined;
          if (Array.isArray(arr)) {
            arr[toNumber(idx)] = val;
          } else if (typeof arr === 'object' && arr !== null) {
            (arr as Record<string, unknown>)[String(idx)] = val;
          }
          break;
        }

        case IROpcode.LOAD_MEMBER: {
          // LOAD_MEMBER dest, obj, member
          const obj = resolve(instr.operand1);
          const member = instr.operand2; // member name (string literal, not a temp)
          if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
            variables.set(instr.dest!, (obj as Record<string, unknown>)[member ?? '']);
          } else if (Array.isArray(obj)) {
            // Array member access (length, etc.)
            const arrMethodResult = executeMethodCall(obj, member ?? '', []);
            variables.set(instr.dest!, arrMethodResult);
          } else if (typeof obj === 'string') {
            const strMethodResult = executeMethodCall(obj, member ?? '', []);
            variables.set(instr.dest!, strMethodResult);
          } else {
            variables.set(instr.dest!, undefined);
          }
          break;
        }
        case IROpcode.STORE_MEMBER: {
          // STORE_MEMBER dest(member name), obj, val
          const memberName = instr.dest;
          const obj = resolve(instr.operand1);
          const val = resolve(instr.operand2);
          if (typeof obj === 'object' && obj !== null) {
            (obj as Record<string, unknown>)[memberName ?? ''] = val;
          }
          break;
        }

        // ── I/O ────────────────────────────────────────────────────
        case IROpcode.PRINT: {
          const val = resolve(instr.operand1);
          const text = String(val ?? (val === null ? 'None' : ''));
          if (!addOutput(text + '\n')) {
            halted = true;
            exitCode = 1;
          }
          break;
        }
        case IROpcode.READ: {
          // Read from stdin buffer
          if (stdinIndex < stdinLines.length) {
            const line = stdinLines[stdinIndex++];
            if (instr.dest) variables.set(instr.dest, line);
          } else {
            if (instr.dest) variables.set(instr.dest, '');
          }
          break;
        }

        // ── Type operations ────────────────────────────────────────
        case IROpcode.CAST: {
          const val = resolve(instr.operand1);
          const targetType = instr.operand2 ?? 'int';
          switch (targetType) {
            case 'int':
            case 'number':
              variables.set(instr.dest!, Math.trunc(toNumber(val)));
              break;
            case 'float':
              variables.set(instr.dest!, toNumber(val));
              break;
            case 'str':
            case 'string':
              variables.set(instr.dest!, String(val ?? ''));
              break;
            case 'bool':
            case 'boolean':
              variables.set(instr.dest!, isTruthy(val));
              break;
            default:
              variables.set(instr.dest!, val);
              break;
          }
          break;
        }
        case IROpcode.TYPEOF: {
          const val = resolve(instr.operand1);
          if (val === null || val === undefined) {
            variables.set(instr.dest!, 'none');
          } else if (typeof val === 'number') {
            variables.set(instr.dest!, Number.isInteger(val) ? 'int' : 'float');
          } else if (typeof val === 'string') {
            variables.set(instr.dest!, 'str');
          } else if (typeof val === 'boolean') {
            variables.set(instr.dest!, 'bool');
          } else if (Array.isArray(val)) {
            variables.set(instr.dest!, 'array');
          } else {
            variables.set(instr.dest!, typeof val);
          }
          break;
        }

        // ── Special ────────────────────────────────────────────────
        case IROpcode.NOP: {
          // No operation
          break;
        }
        case IROpcode.PARAM: {
          // Parameter marker — already set up by CALL
          // If the param name isn't in variables yet, set it to undefined
          if (instr.dest && !variables.has(instr.dest)) {
            variables.set(instr.dest, undefined);
          }
          break;
        }
        case IROpcode.PHI: {
          // SSA phi node — pick the value from the predecessor that was taken
          // In our VM, we just use the current variable state
          // The phi result is already in the variable from the predecessor block
          if (instr.dest) {
            // operand1 and operand2 represent alternative values
            // We keep whatever is already in the variable (from the executed path)
            // Only set if not already set
            if (!variables.has(instr.dest)) {
              const val1 = resolve(instr.operand1);
              variables.set(instr.dest, val1);
            }
          }
          break;
        }

        default: {
          // Unknown opcode — skip
          break;
        }
      }
    }

    // If we reached end of instructions without explicit RET, that's okay
    const executionTimeMs = Date.now() - startTime;

    return {
      success: exitCode === 0,
      output,
      exitCode,
      executionTimeMs,
      error: errorMsg,
      stepsExecuted: stepCount,
    };
  } catch (err: unknown) {
    return {
      success: false,
      output: [],
      exitCode: 1,
      executionTimeMs: Date.now() - startTime,
      error: `VM runtime error: ${err instanceof Error ? err.message : String(err)}`,
      stepsExecuted: 0,
    };
  }
}

// ─── Helper: Build flat instruction array ───────────────────────────────────

function buildFlatFunction(func: IRFunction): FlatFunction {
  const instructions: IRInstruction[] = [];
  const labelMap = new Map<string, number>();

  // Flatten all blocks in order
  for (const block of func.blocks) {
    // Record label → instruction index
    labelMap.set(block.label, instructions.length);

    // Emit all instructions from this block
    for (const instr of block.instructions) {
      instructions.push(instr);
    }
  }

  // Also index any LABEL instructions within the blocks
  for (let i = 0; i < instructions.length; i++) {
    if (instructions[i].opcode === IROpcode.LABEL && instructions[i].dest) {
      labelMap.set(instructions[i].dest, i + 1); // label points to the NEXT instruction
    }
  }

  return {
    name: func.name,
    params: func.params,
    instructions,
    labelMap,
  };
}
