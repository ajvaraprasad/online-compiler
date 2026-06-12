/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge Compiler — IR Generator
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Converts the AST into three-address code intermediate representation.
 * Constructs basic blocks with control flow edges.
 */

import {
  ASTNode,
  ASTNodeType,
  SupportedLanguage,
  IROpcode,
  IRInstruction,
  IRBasicBlock,
  IRFunction,
  IRProgram,
  IRStats,
  IRGenerationResult,
  CompilerError,
  CompilerPhase,
  generateInstrId,
} from '../types';

// ─── Label / Temp counter ────────────────────────────────────────────────────

class LabelGenerator {
  private counter = 0;
  next(): string {
    return `L${++this.counter}`;
  }
  reset(): void {
    this.counter = 0;
  }
}

class TempGenerator {
  private counter = 0;
  next(): string {
    return `t${++this.counter}`;
  }
  reset(): void {
    this.counter = 0;
  }
}

// ─── IR Generator Class ──────────────────────────────────────────────────────

class IRGenerator {
  private language: SupportedLanguage;
  private labelGen = new LabelGenerator();
  private tempGen = new TempGenerator();
  private errors: CompilerError[] = [];

  // Current function being generated
  private currentInstructions: IRInstruction[] = [];
  private currentFunctionName: string = '__main__';
  private currentParams: string[] = [];
  private functions: IRFunction[] = [];
  private globals: IRInstruction[] = [];
  private loopStack: { breakLabel: string; continueLabel: string }[] = [];

  constructor(language: SupportedLanguage) {
    this.language = language;
  }

  generate(ast: ASTNode): IRGenerationResult {
    // Generate code for the whole program
    this.emitProgram(ast);

    // Build basic blocks and construct the IR program
    const program = this.buildProgram();

    return {
      program,
      errors: this.errors,
      stats: program.stats,
    };
  }

  // ─── Instruction emission ───────────────────────────────────────────────

  private emit(opcode: IROpcode, dest?: string, operand1?: string, operand2?: string, value?: unknown, loc?: ASTNode['loc']): IRInstruction {
    const instr: IRInstruction = {
      opcode,
      dest,
      operand1,
      operand2,
      value,
      id: generateInstrId(),
      loc: loc ? { startLine: loc.startLine, startCol: loc.startCol, endLine: loc.endLine, endCol: loc.endCol } : undefined,
    };
    this.currentInstructions.push(instr);
    return instr;
  }

  private newTemp(): string {
    return this.tempGen.next();
  }

  private newLabel(): string {
    return this.labelGen.next();
  }

  // ─── Program entry ──────────────────────────────────────────────────────

  private emitProgram(node: ASTNode): void {
    // Top-level code goes into __main__
    this.currentFunctionName = '__main__';
    this.currentParams = [];
    this.currentInstructions = [];

    // Visit top-level children
    for (const child of node.children ?? []) {
      if (child.type === ASTNodeType.FunctionDecl) {
        // First, generate the function separately
        this.emitFunctionDecl(child);
      } else if (child.type === ASTNodeType.ClassDecl) {
        this.emitClassDecl(child);
      } else {
        this.emitStatement(child);
      }
    }

    // Add implicit return for main
    this.emit(IROpcode.RET, undefined, undefined, undefined, undefined);

    this.finishCurrentFunction();
  }

  // ─── Function handling ──────────────────────────────────────────────────

  private emitFunctionDecl(node: ASTNode): void {
    const name = node.props.name as string;
    const paramNames = (node.props.params as string[]) ?? [];
    const children = node.children ?? [];
    const body = children.find(
      c => c.type === ASTNodeType.BlockStatement || !(c.type === ASTNodeType.Identifier && c.props.isParam === true)
    );

    // Save current function state
    const savedName = this.currentFunctionName;
    const savedParams = this.currentParams;
    const savedInstrs = this.currentInstructions;

    // Start new function
    this.currentFunctionName = name;
    this.currentParams = [...paramNames];
    this.currentInstructions = [];
    this.tempGen.reset();

    // Emit PARAM instructions
    for (const param of paramNames) {
      this.emit(IROpcode.PARAM, param, undefined, undefined, undefined, node.loc);
    }

    // Emit entry label
    this.emit(IROpcode.LABEL, name, undefined, undefined, undefined, node.loc);

    // Visit body
    if (body) {
      this.emitStatement(body);
    }

    // Add implicit return
    this.emit(IROpcode.RET, undefined, undefined, undefined, undefined);

    this.finishCurrentFunction();

    // Restore previous function state
    this.currentFunctionName = savedName;
    this.currentParams = savedParams;
    this.currentInstructions = savedInstrs;
  }

  private emitClassDecl(node: ASTNode): void {
    const name = node.props.name as string;
    // For classes, we generate __init__ and method functions
    for (const child of node.children ?? []) {
      if (child.type === ASTNodeType.FunctionDecl) {
        // Prefix method name with class name
        const origName = child.props.name as string;
        child.props.name = `${name}__${origName}`;
        this.emitFunctionDecl(child);
        child.props.name = origName; // restore
      } else {
        this.emitStatement(child);
      }
    }
  }

  private finishCurrentFunction(): void {
    const func: IRFunction = {
      name: this.currentFunctionName,
      params: this.currentParams,
      blocks: [], // Will be built later
      entryBlock: this.currentFunctionName,
      tempCounter: parseInt(this.tempGen.next().replace('t', '')) || 0,
    };

    // Build basic blocks from instructions
    func.blocks = this.buildBasicBlocks(func.name, this.currentInstructions);

    this.functions.push(func);
  }

  // ─── Statement emission ─────────────────────────────────────────────────

  private emitStatement(node: ASTNode): void {
    if (!node) return;

    switch (node.type) {
      case ASTNodeType.VariableDecl:
        this.emitVariableDecl(node);
        break;
      case ASTNodeType.ExpressionStatement:
        this.emitExpressionStatement(node);
        break;
      case ASTNodeType.ReturnStatement:
        this.emitReturnStatement(node);
        break;
      case ASTNodeType.IfStatement:
        this.emitIfStatement(node);
        break;
      case ASTNodeType.ForStatement:
        this.emitForStatement(node);
        break;
      case ASTNodeType.WhileStatement:
        this.emitWhileStatement(node);
        break;
      case ASTNodeType.DoWhileStatement:
        this.emitDoWhileStatement(node);
        break;
      case ASTNodeType.BreakStatement:
        this.emitBreakStatement(node);
        break;
      case ASTNodeType.ContinueStatement:
        this.emitContinueStatement(node);
        break;
      case ASTNodeType.BlockStatement:
        this.emitBlockStatement(node);
        break;
      case ASTNodeType.TryCatchStatement:
        this.emitTryCatchStatement(node);
        break;
      case ASTNodeType.ThrowStatement:
        this.emitThrowStatement(node);
        break;
      case ASTNodeType.ImportDecl:
        this.emitImportDecl(node);
        break;
      case ASTNodeType.EmptyStatement:
        // Nothing
        break;
      case ASTNodeType.FunctionDecl:
        this.emitFunctionDecl(node);
        break;
      case ASTNodeType.ClassDecl:
        this.emitClassDecl(node);
        break;
      case ASTNodeType.SwitchStatement:
        this.emitSwitchStatement(node);
        break;
      case ASTNodeType.WithStatement:
        this.emitBlockStatement(node);
        break;
      case ASTNodeType.AssertStatement:
        this.emitAssertStatement(node);
        break;
      case ASTNodeType.GlobalStatement:
      case ASTNodeType.NonlocalStatement:
        // No IR for these — they're semantic-only
        break;
      default:
        // Try as expression
        this.emitExpression(node);
        break;
    }
  }

  private emitVariableDecl(node: ASTNode): void {
    const name = node.props.name as string;
    const initExpr = (node.children ?? [])[0];

    if (initExpr) {
      const initTemp = this.emitExpression(initExpr);
      this.emit(IROpcode.STORE, name, initTemp, undefined, undefined, node.loc);
    }
    // If no initializer, variable is declared but uninitialized (no STORE needed)
  }

  private emitExpressionStatement(node: ASTNode): void {
    const child = (node.children ?? [])[0];
    if (child) {
      this.emitExpression(child);
    }
  }

  private emitReturnStatement(node: ASTNode): void {
    const value = (node.children ?? [])[0];
    if (value) {
      const temp = this.emitExpression(value);
      this.emit(IROpcode.RET, temp, undefined, undefined, undefined, node.loc);
    } else {
      this.emit(IROpcode.RET, undefined, undefined, undefined, undefined, node.loc);
    }
  }

  private emitIfStatement(node: ASTNode): void {
    const children = node.children ?? [];
    const condition = children[0];
    const thenBlock = children[1];
    const elseBlock = children[2];

    const elseLabel = this.newLabel();
    const endLabel = this.newLabel();

    // Emit condition
    const condTemp = this.emitExpression(condition);
    this.emit(IROpcode.JZ, elseLabel, condTemp, undefined, undefined, condition?.loc);

    // Then block
    if (thenBlock) {
      this.emitStatement(thenBlock);
    }
    this.emit(IROpcode.JMP, endLabel, undefined, undefined, undefined);

    // Else label
    this.emit(IROpcode.LABEL, elseLabel, undefined, undefined, undefined);
    if (elseBlock) {
      this.emitStatement(elseBlock);
    }

    // End label
    this.emit(IROpcode.LABEL, endLabel, undefined, undefined, undefined);
  }

  private emitForStatement(node: ASTNode): void {
    const children = node.children ?? [];
    const isPythonStyle = node.props.iterator !== undefined;

    if (isPythonStyle) {
      // Python-style: for x in iterable: body
      this.emitPythonForStatement(node);
      return;
    }

    // C-style: for (init; cond; update) body
    const init = children[0];
    const condition = children[1];
    const update = children[2];
    const body = children[3];

    const condLabel = this.newLabel();
    const bodyLabel = this.newLabel();
    const endLabel = this.newLabel();
    const continueLabel = condLabel; // continue goes to condition check

    // Init
    if (init) {
      this.emitStatement(init);
    }

    // Jump to condition
    this.emit(IROpcode.JMP, condLabel, undefined, undefined, undefined);

    // Condition label
    this.emit(IROpcode.LABEL, condLabel, undefined, undefined, undefined);
    if (condition) {
      const condTemp = this.emitExpression(condition);
      this.emit(IROpcode.JZ, endLabel, condTemp, undefined, undefined, condition.loc);
    }

    // Body
    this.loopStack.push({ breakLabel: endLabel, continueLabel });
    if (body) {
      this.emitStatement(body);
    }
    this.loopStack.pop();

    // Update (if any)
    if (update) {
      this.emitStatement(update);
    }

    // Loop back
    this.emit(IROpcode.JMP, condLabel, undefined, undefined, undefined);

    // End label
    this.emit(IROpcode.LABEL, endLabel, undefined, undefined, undefined);
  }

  private emitPythonForStatement(node: ASTNode): void {
    const iteratorName = node.props.iterator as string;
    const iterable = (node.children ?? [])[0];
    const body = (node.children ?? [])[1];

    const loopLabel = this.newLabel();
    const endLabel = this.newLabel();

    // Get iterable
    const iterTemp = iterable ? this.emitExpression(iterable) : this.newTemp();

    // Loop header
    this.emit(IROpcode.LABEL, loopLabel, undefined, undefined, undefined);

    // Has next check (simplified — just loop for now)
    // In a real compiler, this would call __next__ and check for StopIteration
    const hasNext = this.newTemp();
    this.emit(IROpcode.LOAD_INDEX, hasNext, iterTemp, iteratorName, undefined, node.loc);
    this.emit(IROpcode.STORE, iteratorName, hasNext, undefined, undefined, node.loc);

    // Body
    this.loopStack.push({ breakLabel: endLabel, continueLabel: loopLabel });
    if (body) {
      this.emitStatement(body);
    }
    this.loopStack.pop();

    // Loop back
    this.emit(IROpcode.JMP, loopLabel, undefined, undefined, undefined);

    // End
    this.emit(IROpcode.LABEL, endLabel, undefined, undefined, undefined);
  }

  private emitWhileStatement(node: ASTNode): void {
    const children = node.children ?? [];
    const condition = children[0];
    const body = children[1];

    const loopLabel = this.newLabel();
    const endLabel = this.newLabel();

    // Loop header
    this.emit(IROpcode.LABEL, loopLabel, undefined, undefined, undefined);

    // Condition
    if (condition) {
      const condTemp = this.emitExpression(condition);
      this.emit(IROpcode.JZ, endLabel, condTemp, undefined, undefined, condition.loc);
    }

    // Body
    this.loopStack.push({ breakLabel: endLabel, continueLabel: loopLabel });
    if (body) {
      this.emitStatement(body);
    }
    this.loopStack.pop();

    // Loop back
    this.emit(IROpcode.JMP, loopLabel, undefined, undefined, undefined);

    // End
    this.emit(IROpcode.LABEL, endLabel, undefined, undefined, undefined);
  }

  private emitDoWhileStatement(node: ASTNode): void {
    const children = node.children ?? [];
    const body = children[0];
    const condition = children[1];

    const loopLabel = this.newLabel();
    const endLabel = this.newLabel();

    // Loop start
    this.emit(IROpcode.LABEL, loopLabel, undefined, undefined, undefined);

    // Body
    this.loopStack.push({ breakLabel: endLabel, continueLabel: loopLabel });
    if (body) {
      this.emitStatement(body);
    }
    this.loopStack.pop();

    // Condition (at bottom)
    if (condition) {
      const condTemp = this.emitExpression(condition);
      this.emit(IROpcode.JNZ, loopLabel, condTemp, undefined, undefined, condition.loc);
    }

    // End
    this.emit(IROpcode.LABEL, endLabel, undefined, undefined, undefined);
  }

  private emitSwitchStatement(node: ASTNode): void {
    const children = node.children ?? [];
    const discriminant = children[0];
    const cases = children.slice(1);

    const endLabel = this.newLabel();
    const caseLabels = cases.map(() => this.newLabel());

    // Evaluate discriminant
    const discTemp = discriminant ? this.emitExpression(discriminant) : this.newTemp();

    // Emit comparisons for each case and jumps
    for (let i = 0; i < cases.length; i++) {
      const caseNode = cases[i];
      const testExpr = (caseNode.children ?? [])[0]; // the test value

      if (testExpr) {
        const testTemp = this.emitExpression(testExpr);
        const eqTemp = this.newTemp();
        this.emit(IROpcode.EQ, eqTemp, discTemp, testTemp, undefined, caseNode.loc);
        this.emit(IROpcode.JNZ, caseLabels[i], eqTemp, undefined, undefined);
      } else {
        // Default case — always jump
        this.emit(IROpcode.JMP, caseLabels[i], undefined, undefined, undefined);
      }
    }

    // If no case matched, jump to end
    this.emit(IROpcode.JMP, endLabel, undefined, undefined, undefined);

    // Emit each case body
    for (let i = 0; i < cases.length; i++) {
      this.emit(IROpcode.LABEL, caseLabels[i], undefined, undefined, undefined);
      const bodyChildren = (cases[i].children ?? []).slice(1); // skip test expression
      for (const stmt of bodyChildren) {
        this.emitStatement(stmt);
      }
    }

    this.emit(IROpcode.LABEL, endLabel, undefined, undefined, undefined);
  }

  private emitBreakStatement(node: ASTNode): void {
    if (this.loopStack.length === 0) {
      this.errors.push({
        phase: CompilerPhase.IRGeneration,
        message: 'Break statement outside of loop',
        line: node.loc.startLine,
        severity: 'error',
      });
      return;
    }
    const loopInfo = this.loopStack[this.loopStack.length - 1];
    this.emit(IROpcode.JMP, loopInfo.breakLabel, undefined, undefined, undefined, node.loc);
  }

  private emitContinueStatement(node: ASTNode): void {
    if (this.loopStack.length === 0) {
      this.errors.push({
        phase: CompilerPhase.IRGeneration,
        message: 'Continue statement outside of loop',
        line: node.loc.startLine,
        severity: 'error',
      });
      return;
    }
    const loopInfo = this.loopStack[this.loopStack.length - 1];
    this.emit(IROpcode.JMP, loopInfo.continueLabel, undefined, undefined, undefined, node.loc);
  }

  private emitBlockStatement(node: ASTNode): void {
    for (const child of node.children ?? []) {
      this.emitStatement(child);
    }
  }

  private emitTryCatchStatement(node: ASTNode): void {
    const children = node.children ?? [];
    const tryBlock = children[0];
    const catchBlock = children[1];
    const finallyBlock = children[2];

    const catchLabel = this.newLabel();
    const endTryLabel = this.newLabel();
    const finallyLabel = this.newLabel();
    const endLabel = this.newLabel();

    // Try block
    if (tryBlock) {
      this.emitStatement(tryBlock);
    }
    // If no exception, skip catch
    this.emit(IROpcode.JMP, endTryLabel, undefined, undefined, undefined);

    // Catch label
    this.emit(IROpcode.LABEL, catchLabel, undefined, undefined, undefined);
    if (catchBlock) {
      this.emitStatement(catchBlock);
    }
    this.emit(IROpcode.JMP, finallyBlock ? finallyLabel : endLabel, undefined, undefined, undefined);

    // End of try
    this.emit(IROpcode.LABEL, endTryLabel, undefined, undefined, undefined);

    // Finally
    if (finallyBlock) {
      this.emit(IROpcode.LABEL, finallyLabel, undefined, undefined, undefined);
      this.emitStatement(finallyBlock);
    }

    this.emit(IROpcode.LABEL, endLabel, undefined, undefined, undefined);
  }

  private emitThrowStatement(node: ASTNode): void {
    const value = (node.children ?? [])[0];
    if (value) {
      const temp = this.emitExpression(value);
      this.emit(IROpcode.CALL, undefined, '__throw', temp, undefined, node.loc);
    }
  }

  private emitImportDecl(node: ASTNode): void {
    // Imports don't generate executable IR; they're resolved at link time
    // We emit a NOP to preserve source mapping
    this.emit(IROpcode.NOP, undefined, undefined, undefined, node.props.source, node.loc);
  }

  private emitAssertStatement(node: ASTNode): void {
    const condition = (node.children ?? [])[0];
    const message = (node.children ?? [])[1];

    if (condition) {
      const condTemp = this.emitExpression(condition);
      const failLabel = this.newLabel();
      const endLabel = this.newLabel();
      this.emit(IROpcode.JZ, failLabel, condTemp, undefined, undefined, condition.loc);
      this.emit(IROpcode.JMP, endLabel, undefined, undefined, undefined);
      this.emit(IROpcode.LABEL, failLabel, undefined, undefined, undefined);
      if (message) {
        const msgTemp = this.emitExpression(message);
        this.emit(IROpcode.CALL, undefined, '__assert_fail', msgTemp, undefined, node.loc);
      } else {
        this.emit(IROpcode.CALL, undefined, '__assert_fail', undefined, undefined, node.loc);
      }
      this.emit(IROpcode.LABEL, endLabel, undefined, undefined, undefined);
    }
  }

  // ─── Expression emission ────────────────────────────────────────────────

  /**
   * Emit IR for an expression and return the temporary/variable holding the result.
   */
  private emitExpression(node: ASTNode): string {
    if (!node) return this.newTemp();

    switch (node.type) {
      case ASTNodeType.NumberLiteral:
        return this.emitNumberLiteral(node);
      case ASTNodeType.StringLiteral:
        return this.emitStringLiteral(node);
      case ASTNodeType.BooleanLiteral:
        return this.emitBooleanLiteral(node);
      case ASTNodeType.NoneLiteral:
        return this.emitNoneLiteral(node);
      case ASTNodeType.Identifier:
        return this.emitIdentifier(node);
      case ASTNodeType.BinaryExpression:
        return this.emitBinaryExpression(node);
      case ASTNodeType.UnaryExpression:
        return this.emitUnaryExpression(node);
      case ASTNodeType.AssignmentExpression:
        return this.emitAssignmentExpression(node);
      case ASTNodeType.CallExpression:
        return this.emitCallExpression(node);
      case ASTNodeType.MemberExpression:
        return this.emitMemberExpression(node);
      case ASTNodeType.IndexExpression:
        return this.emitIndexExpression(node);
      case ASTNodeType.ConditionalExpression:
        return this.emitConditionalExpression(node);
      case ASTNodeType.NewExpression:
        return this.emitNewExpression(node);
      case ASTNodeType.ArrayExpression:
        return this.emitArrayExpression(node);
      case ASTNodeType.ObjectExpression:
        return this.emitObjectExpression(node);
      case ASTNodeType.LambdaExpression:
        return this.emitLambdaExpression(node);
      case ASTNodeType.CastExpression:
        return this.emitCastExpression(node);
      case ASTNodeType.SizeofExpression:
        return this.emitSizeofExpression(node);
      case ASTNodeType.TemplateLiteral:
      case ASTNodeType.FStringExpression:
        return this.emitTemplateLiteral(node);
      default:
        // Unknown expression — emit a placeholder
        const temp = this.newTemp();
        this.emit(IROpcode.NOP, temp, undefined, undefined, undefined, node.loc);
        return temp;
    }
  }

  private emitNumberLiteral(node: ASTNode): string {
    const temp = this.newTemp();
    const value = node.props.value as number ?? parseFloat(node.props.raw as string ?? '0');
    this.emit(IROpcode.LOAD_CONST, temp, undefined, undefined, value, node.loc);
    return temp;
  }

  private emitStringLiteral(node: ASTNode): string {
    const temp = this.newTemp();
    const value = node.props.value as string ?? (node.props.raw as string ?? '');
    this.emit(IROpcode.LOAD_CONST, temp, undefined, undefined, value, node.loc);
    return temp;
  }

  private emitBooleanLiteral(node: ASTNode): string {
    const temp = this.newTemp();
    const value = node.props.value as boolean ?? (node.props.raw === 'true' || node.props.raw === 'True');
    this.emit(IROpcode.LOAD_CONST, temp, undefined, undefined, value, node.loc);
    return temp;
  }

  private emitNoneLiteral(node: ASTNode): string {
    const temp = this.newTemp();
    this.emit(IROpcode.LOAD_CONST, temp, undefined, undefined, null, node.loc);
    return temp;
  }

  private emitIdentifier(node: ASTNode): string {
    const name = node.props.name as string;
    const temp = this.newTemp();
    this.emit(IROpcode.LOAD, temp, name, undefined, undefined, node.loc);
    return temp;
  }

  private emitBinaryExpression(node: ASTNode): string {
    const children = node.children ?? [];
    const op = node.props.operator as string;
    const leftNode = children[0];
    const rightNode = children[1];

    // Short-circuit evaluation for && and ||
    if (op === '&&' || op === 'and') {
      return this.emitShortCircuitAnd(leftNode, rightNode, node.loc);
    }
    if (op === '||' || op === 'or') {
      return this.emitShortCircuitOr(leftNode, rightNode, node.loc);
    }

    const leftTemp = leftNode ? this.emitExpression(leftNode) : this.newTemp();
    const rightTemp = rightNode ? this.emitExpression(rightNode) : this.newTemp();
    const resultTemp = this.newTemp();
    const opcode = this.binaryOpToIROpcode(op);

    this.emit(opcode, resultTemp, leftTemp, rightTemp, undefined, node.loc);
    return resultTemp;
  }

  private emitShortCircuitAnd(left: ASTNode, right: ASTNode, loc: ASTNode['loc']): string {
    const resultTemp = this.newTemp();
    const rightLabel = this.newLabel();
    const endLabel = this.newLabel();

    const leftTemp = this.emitExpression(left);
    this.emit(IROpcode.STORE, resultTemp, leftTemp, undefined, undefined, loc);
    this.emit(IROpcode.JNZ, rightLabel, leftTemp, undefined, undefined, loc);

    // Left is falsy — result is false, skip right
    this.emit(IROpcode.JMP, endLabel, undefined, undefined, undefined);

    // Evaluate right
    this.emit(IROpcode.LABEL, rightLabel, undefined, undefined, undefined);
    const rightTemp = this.emitExpression(right);
    this.emit(IROpcode.STORE, resultTemp, rightTemp, undefined, undefined, loc);

    this.emit(IROpcode.LABEL, endLabel, undefined, undefined, undefined);
    return resultTemp;
  }

  private emitShortCircuitOr(left: ASTNode, right: ASTNode, loc: ASTNode['loc']): string {
    const resultTemp = this.newTemp();
    const rightLabel = this.newLabel();
    const endLabel = this.newLabel();

    const leftTemp = this.emitExpression(left);
    this.emit(IROpcode.STORE, resultTemp, leftTemp, undefined, undefined, loc);
    this.emit(IROpcode.JZ, rightLabel, leftTemp, undefined, undefined, loc);

    // Left is truthy — result is left, skip right
    this.emit(IROpcode.JMP, endLabel, undefined, undefined, undefined);

    // Evaluate right
    this.emit(IROpcode.LABEL, rightLabel, undefined, undefined, undefined);
    const rightTemp = this.emitExpression(right);
    this.emit(IROpcode.STORE, resultTemp, rightTemp, undefined, undefined, loc);

    this.emit(IROpcode.LABEL, endLabel, undefined, undefined, undefined);
    return resultTemp;
  }

  private emitUnaryExpression(node: ASTNode): string {
    const child = (node.children ?? [])[0];
    const op = node.props.operator as string;
    const operandTemp = child ? this.emitExpression(child) : this.newTemp();
    const resultTemp = this.newTemp();

    if (op === '-' || op === 'neg') {
      this.emit(IROpcode.NEG, resultTemp, operandTemp, undefined, undefined, node.loc);
    } else if (op === '!' || op === 'not') {
      this.emit(IROpcode.NOT, resultTemp, operandTemp, undefined, undefined, node.loc);
    } else if (op === '~') {
      this.emit(IROpcode.NOT, resultTemp, operandTemp, undefined, undefined, node.loc);
    } else if (op === '+' || op === 'pos') {
      // Unary plus is a no-op
      return operandTemp;
    } else if (op === '*' || op === 'deref') {
      this.emit(IROpcode.LOAD, resultTemp, operandTemp, undefined, undefined, node.loc);
    } else if (op === '&' || op === 'addr') {
      this.emit(IROpcode.STORE, resultTemp, operandTemp, undefined, undefined, node.loc);
    } else {
      this.emit(IROpcode.NOP, resultTemp, operandTemp, undefined, op, node.loc);
    }

    return resultTemp;
  }

  private emitAssignmentExpression(node: ASTNode): string {
    const children = node.children ?? [];
    const left = children[0];
    const right = children[1];

    const rightTemp = right ? this.emitExpression(right) : this.newTemp();

    if (left) {
      if (left.type === ASTNodeType.Identifier) {
        const name = left.props.name as string;
        this.emit(IROpcode.STORE, name, rightTemp, undefined, undefined, node.loc);
        return name;
      } else if (left.type === ASTNodeType.MemberExpression) {
        const obj = (left.children ?? [])[0];
        const member = left.props.property as string;
        const objTemp = obj ? this.emitExpression(obj) : this.newTemp();
        this.emit(IROpcode.STORE_MEMBER, member, objTemp, rightTemp, undefined, node.loc);
        return rightTemp;
      } else if (left.type === ASTNodeType.IndexExpression) {
        const obj = (left.children ?? [])[0];
        const index = (left.children ?? [])[1];
        const objTemp = obj ? this.emitExpression(obj) : this.newTemp();
        const idxTemp = index ? this.emitExpression(index) : this.newTemp();
        this.emit(IROpcode.STORE_INDEX, undefined, objTemp, idxTemp, rightTemp, node.loc);
        return rightTemp;
      }
    }

    return rightTemp;
  }

  private emitCallExpression(node: ASTNode): string {
    const children = node.children ?? [];
    const callee = children[0];
    const args = children.slice(1);

    // Evaluate arguments
    const argTemps: string[] = [];
    for (const arg of args) {
      argTemps.push(this.emitExpression(arg));
    }

    const resultTemp = this.newTemp();

    if (callee) {
      if (callee.type === ASTNodeType.Identifier) {
        const funcName = callee.props.name as string;
        // Pack arguments: first arg in operand1, rest encoded in value
        if (argTemps.length === 0) {
          this.emit(IROpcode.CALL, resultTemp, funcName, undefined, undefined, node.loc);
        } else if (argTemps.length === 1) {
          this.emit(IROpcode.CALL, resultTemp, funcName, argTemps[0], undefined, node.loc);
        } else {
          // Multiple args: store args in value as an array
          this.emit(IROpcode.CALL, resultTemp, funcName, argTemps[0], argTemps.slice(1), node.loc);
        }
      } else if (callee.type === ASTNodeType.MemberExpression) {
        const obj = (callee.children ?? [])[0];
        const member = callee.props.property as string;
        const objTemp = obj ? this.emitExpression(obj) : this.newTemp();

        // Method call: CALL result, obj.method, args
        const methodRef = `${objTemp}.${member}`;
        if (argTemps.length === 0) {
          this.emit(IROpcode.CALL, resultTemp, methodRef, undefined, undefined, node.loc);
        } else {
          this.emit(IROpcode.CALL, resultTemp, methodRef, argTemps[0], argTemps.slice(1), node.loc);
        }
      } else {
        // Complex callee — evaluate it
        const calleeTemp = this.emitExpression(callee);
        if (argTemps.length === 0) {
          this.emit(IROpcode.CALL, resultTemp, calleeTemp, undefined, undefined, node.loc);
        } else {
          this.emit(IROpcode.CALL, resultTemp, calleeTemp, argTemps[0], argTemps.slice(1), node.loc);
        }
      }
    }

    return resultTemp;
  }

  private emitMemberExpression(node: ASTNode): string {
    const children = node.children ?? [];
    const obj = children[0];
    const member = node.props.property as string;
    const objTemp = obj ? this.emitExpression(obj) : this.newTemp();
    const resultTemp = this.newTemp();
    this.emit(IROpcode.LOAD_MEMBER, resultTemp, objTemp, member, undefined, node.loc);
    return resultTemp;
  }

  private emitIndexExpression(node: ASTNode): string {
    const children = node.children ?? [];
    const obj = children[0];
    const index = children[1];
    const objTemp = obj ? this.emitExpression(obj) : this.newTemp();
    const idxTemp = index ? this.emitExpression(index) : this.newTemp();
    const resultTemp = this.newTemp();
    this.emit(IROpcode.LOAD_INDEX, resultTemp, objTemp, idxTemp, undefined, node.loc);
    return resultTemp;
  }

  private emitConditionalExpression(node: ASTNode): string {
    const children = node.children ?? [];
    const condition = children[0];
    const trueExpr = children[1];
    const falseExpr = children[2];

    const resultTemp = this.newTemp();
    const trueLabel = this.newLabel();
    const endLabel = this.newLabel();

    const condTemp = condition ? this.emitExpression(condition) : this.newTemp();
    this.emit(IROpcode.JNZ, trueLabel, condTemp, undefined, undefined, node.loc);

    // False branch
    const falseTemp = falseExpr ? this.emitExpression(falseExpr) : this.newTemp();
    this.emit(IROpcode.STORE, resultTemp, falseTemp, undefined, undefined, node.loc);
    this.emit(IROpcode.JMP, endLabel, undefined, undefined, undefined);

    // True branch
    this.emit(IROpcode.LABEL, trueLabel, undefined, undefined, undefined);
    const trueTemp = trueExpr ? this.emitExpression(trueExpr) : this.newTemp();
    this.emit(IROpcode.STORE, resultTemp, trueTemp, undefined, undefined, node.loc);

    this.emit(IROpcode.LABEL, endLabel, undefined, undefined, undefined);
    return resultTemp;
  }

  private emitNewExpression(node: ASTNode): string {
    const children = node.children ?? [];
    const callee = children[0];
    const args = children.slice(1);

    const argTemps: string[] = [];
    for (const arg of args) {
      argTemps.push(this.emitExpression(arg));
    }

    const resultTemp = this.newTemp();
    const className = callee?.type === ASTNodeType.Identifier
      ? (callee.props.name as string)
      : (callee ? this.emitExpression(callee) : this.newTemp());

    // ALLOC for the new object
    this.emit(IROpcode.ALLOC, resultTemp, className, undefined, undefined, node.loc);

    // CALL constructor if there are args
    if (argTemps.length > 0) {
      this.emit(IROpcode.CALL, undefined, `${className}.__init__`, resultTemp, argTemps, node.loc);
    }

    return resultTemp;
  }

  private emitArrayExpression(node: ASTNode): string {
    const resultTemp = this.newTemp();
    // ALLOC the array
    this.emit(IROpcode.ALLOC, resultTemp, 'Array', undefined, undefined, node.loc);
    // Store each element
    for (let i = 0; i < (node.children ?? []).length; i++) {
      const elemTemp = this.emitExpression(node.children![i]);
      const idxTemp = this.newTemp();
      this.emit(IROpcode.LOAD_CONST, idxTemp, undefined, undefined, i, node.loc);
      this.emit(IROpcode.STORE_INDEX, undefined, resultTemp, idxTemp, elemTemp, node.loc);
    }
    return resultTemp;
  }

  private emitObjectExpression(node: ASTNode): string {
    const resultTemp = this.newTemp();
    this.emit(IROpcode.ALLOC, resultTemp, 'Object', undefined, undefined, node.loc);
    // Store each property
    const keys = (node.props.keys as string[]) ?? [];
    for (let i = 0; i < keys.length && i < (node.children ?? []).length; i++) {
      const valTemp = this.emitExpression(node.children![i]);
      this.emit(IROpcode.STORE_MEMBER, keys[i], resultTemp, valTemp, undefined, node.loc);
    }
    // If no explicit keys, just visit children
    if (keys.length === 0) {
      for (const child of node.children ?? []) {
        this.emitExpression(child);
      }
    }
    return resultTemp;
  }

  private emitLambdaExpression(node: ASTNode): string {
    // Lambda as a function — generate a function and return a reference
    const lambdaName = `__lambda_${this.currentFunctionName}_${this.tempGen.next()}`;
    const params = (node.props.params as string[]) ?? [];
    const body = (node.children ?? [])[0];

    // Save state
    const savedName = this.currentFunctionName;
    const savedParams = this.currentParams;
    const savedInstrs = this.currentInstructions;

    // Generate lambda function
    this.currentFunctionName = lambdaName;
    this.currentParams = [...params];
    this.currentInstructions = [];
    this.tempGen.reset();

    for (const param of params) {
      this.emit(IROpcode.PARAM, param, undefined, undefined, undefined, node.loc);
    }
    this.emit(IROpcode.LABEL, lambdaName, undefined, undefined, undefined, node.loc);

    if (body) {
      const resultTemp = this.emitExpression(body);
      this.emit(IROpcode.RET, resultTemp, undefined, undefined, undefined, node.loc);
    } else {
      this.emit(IROpcode.RET, undefined, undefined, undefined, undefined);
    }

    this.finishCurrentFunction();

    // Restore state
    this.currentFunctionName = savedName;
    this.currentParams = savedParams;
    this.currentInstructions = savedInstrs;

    // Return reference to lambda
    const temp = this.newTemp();
    this.emit(IROpcode.LOAD_CONST, temp, undefined, undefined, lambdaName, node.loc);
    return temp;
  }

  private emitCastExpression(node: ASTNode): string {
    const child = (node.children ?? [])[0];
    const targetType = node.props.castType as string;
    const srcTemp = child ? this.emitExpression(child) : this.newTemp();
    const resultTemp = this.newTemp();
    this.emit(IROpcode.CAST, resultTemp, srcTemp, targetType, undefined, node.loc);
    return resultTemp;
  }

  private emitSizeofExpression(node: ASTNode): string {
    const resultTemp = this.newTemp();
    const targetType = node.props.sizeofType as string;
    this.emit(IROpcode.TYPEOF, resultTemp, targetType, undefined, undefined, node.loc);
    return resultTemp;
  }

  private emitTemplateLiteral(node: ASTNode): string {
    // Concatenate all parts
    const parts = node.children ?? [];
    if (parts.length === 0) {
      const temp = this.newTemp();
      this.emit(IROpcode.LOAD_CONST, temp, undefined, undefined, '', node.loc);
      return temp;
    }

    let currentTemp = this.emitExpression(parts[0]);
    for (let i = 1; i < parts.length; i++) {
      const nextTemp = this.emitExpression(parts[i]);
      const concatTemp = this.newTemp();
      this.emit(IROpcode.ADD, concatTemp, currentTemp, nextTemp, undefined, node.loc);
      currentTemp = concatTemp;
    }
    return currentTemp;
  }

  // ─── Binary operator mapping ────────────────────────────────────────────

  private binaryOpToIROpcode(op: string): IROpcode {
    const map: Record<string, IROpcode> = {
      '+': IROpcode.ADD,
      '-': IROpcode.SUB,
      '*': IROpcode.MUL,
      '/': IROpcode.DIV,
      '%': IROpcode.MOD,
      '**': IROpcode.POW,
      '//': IROpcode.DIV, // floor division
      '&': IROpcode.AND,
      '|': IROpcode.OR,
      '^': IROpcode.XOR,
      '<<': IROpcode.SHL,
      '>>': IROpcode.SHR,
      '==': IROpcode.EQ,
      '!=': IROpcode.NE,
      '===': IROpcode.EQ,
      '!==': IROpcode.NE,
      '<': IROpcode.LT,
      '<=': IROpcode.LE,
      '>': IROpcode.GT,
      '>=': IROpcode.GE,
      'and': IROpcode.AND,
      'or': IROpcode.OR,
      'in': IROpcode.EQ, // simplified
      'is': IROpcode.EQ, // simplified
    };
    return map[op] ?? IROpcode.NOP;
  }

  // ─── Basic Block Construction ───────────────────────────────────────────

  private buildBasicBlocks(funcName: string, instructions: IRInstruction[]): IRBasicBlock[] {
    if (instructions.length === 0) return [];

    const blocks: IRBasicBlock[] = [];
    let currentBlockInstrs: IRInstruction[] = [];
    let currentLabel = funcName; // Entry block starts with function name

    // Find the first label to determine the entry block label
    const firstLabel = instructions.find(i => i.opcode === IROpcode.LABEL);
    if (firstLabel && firstLabel.dest) {
      currentLabel = firstLabel.dest;
    }

    const labelToBlockIndex: Map<string, number> = new Map();
    const jumpTargets: Set<string> = new Set();

    // First pass: collect all jump targets
    for (const instr of instructions) {
      if (instr.opcode === IROpcode.JMP || instr.opcode === IROpcode.JZ || instr.opcode === IROpcode.JNZ) {
        if (instr.dest) jumpTargets.add(instr.dest);
      }
    }

    const startNewBlock = (label: string) => {
      if (currentBlockInstrs.length > 0) {
        const block: IRBasicBlock = {
          label: currentLabel,
          instructions: [...currentBlockInstrs],
          successors: [],
          predecessors: [],
        };
        labelToBlockIndex.set(currentLabel, blocks.length);
        blocks.push(block);
      }
      currentBlockInstrs = [];
      currentLabel = label;
    };

    // Second pass: split into basic blocks
    for (let i = 0; i < instructions.length; i++) {
      const instr = instructions[i];

      // Start a new block at labels (if they are jump targets)
      if (instr.opcode === IROpcode.LABEL) {
        if (currentBlockInstrs.length > 0) {
          startNewBlock(instr.dest ?? `block_${i}`);
        }
        currentLabel = instr.dest ?? `block_${i}`;
        currentBlockInstrs.push(instr);
        continue;
      }

      // Start a new block after jumps
      if (instr.opcode === IROpcode.JMP || instr.opcode === IROpcode.RET) {
        currentBlockInstrs.push(instr);
        const nextLabel = (i + 1 < instructions.length) ? `block_${i + 1}` : `end_${funcName}`;
        startNewBlock(nextLabel);
        continue;
      }

      // JZ and JNZ: conditional jump — current block continues, but target is a new block
      if (instr.opcode === IROpcode.JZ || instr.opcode === IROpcode.JNZ) {
        currentBlockInstrs.push(instr);
        const nextLabel = `block_${i + 1}`;
        startNewBlock(nextLabel);
        continue;
      }

      currentBlockInstrs.push(instr);
    }

    // Flush remaining instructions
    if (currentBlockInstrs.length > 0) {
      const block: IRBasicBlock = {
        label: currentLabel,
        instructions: [...currentBlockInstrs],
        successors: [],
        predecessors: [],
      };
      labelToBlockIndex.set(currentLabel, blocks.length);
      blocks.push(block);
    }

    // Third pass: compute successors and predecessors
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const lastInstr = block.instructions[block.instructions.length - 1];

      if (!lastInstr) continue;

      if (lastInstr.opcode === IROpcode.JMP) {
        // Unconditional jump — single successor
        const target = lastInstr.dest;
        if (target) {
          block.successors.push(target);
          const targetIdx = labelToBlockIndex.get(target);
          if (targetIdx !== undefined) {
            blocks[targetIdx].predecessors.push(block.label);
          }
        }
      } else if (lastInstr.opcode === IROpcode.JZ || lastInstr.opcode === IROpcode.JNZ) {
        // Conditional jump — two successors: jump target and fall-through
        const target = lastInstr.dest;
        if (target) {
          block.successors.push(target);
          const targetIdx = labelToBlockIndex.get(target);
          if (targetIdx !== undefined) {
            blocks[targetIdx].predecessors.push(block.label);
          }
        }
        // Fall-through
        if (i + 1 < blocks.length) {
          block.successors.push(blocks[i + 1].label);
          blocks[i + 1].predecessors.push(block.label);
        }
      } else if (lastInstr.opcode === IROpcode.RET) {
        // No successors
      } else {
        // Fall-through to next block
        if (i + 1 < blocks.length) {
          block.successors.push(blocks[i + 1].label);
          blocks[i + 1].predecessors.push(block.label);
        }
      }
    }

    // Remove empty blocks
    return blocks.filter(b => b.instructions.length > 0);
  }

  // ─── Build IR Program ───────────────────────────────────────────────────

  private buildProgram(): IRProgram {
    const mainFunc = this.functions.find(f => f.name === '__main__');

    let totalInstructions = 0;
    let totalBlocks = 0;
    let totalTemps = 0;

    for (const func of this.functions) {
      for (const block of func.blocks) {
        totalInstructions += block.instructions.length;
      }
      totalBlocks += func.blocks.length;
      totalTemps += func.tempCounter;
    }

    totalInstructions += this.globals.length;

    return {
      functions: this.functions,
      globals: this.globals,
      mainFunction: '__main__',
      stats: {
        totalInstructions,
        totalBlocks,
        totalFunctions: this.functions.length,
        totalTemps,
      },
    };
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function generateIR(ast: ASTNode, language: SupportedLanguage): IRGenerationResult {
  const generator = new IRGenerator(language);
  return generator.generate(ast);
}
