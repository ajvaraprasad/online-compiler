# Task 4-6: Fix C Parser — Unary Prefix Operators + GCC Validation

## Summary

Fixed the CodeForge compiler's C parser to handle `&` (address-of) and `*` (dereference) as unary prefix operators, added GCC/G++ validation as source of truth, and made C/C++ parsing non-blocking.

## Changes Made

### `/home/z/my-project/src/lib/compiler/parser/index.ts`
1. **Fix 1**: `isUnaryPrefix()` — Added `&` and `*` to the unary prefix operator list for C/C++ languages
2. **Fix 2**: Added `addDetailedError()` method to BaseParser with grammar rule, expected tokens, and source line context
3. **Fix 3**: Modified `expect()` to use `addDetailedError()` for richer diagnostics
4. **Fix 4**: Updated `parsePrefix()` fallback error with grammar rule context and expected tokens

### `/home/z/my-project/src/lib/compiler/pipeline.ts`
5. **Fix 5**: Added `validateCSyntax()` function using `gcc -fsyntax-only` / `g++ -fsyntax-only` as source of truth
6. **Fix 6**: Made C/C++ parsing non-blocking — parse errors are downgraded to warnings when GCC/G++ validates the code, pipeline continues with fallback AST and native execution
7. **Fix 7**: Updated fallback AST execution plan reason to be language-aware (Python/C/C++ specific messages)

## Validation
- `bun run lint` passes with zero errors
