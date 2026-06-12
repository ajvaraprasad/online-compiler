# Fix C Parser Gaps — Parser Changes

## Task
Fix C parser gaps and improve diagnostics in `/home/z/my-project/src/lib/compiler/parser/index.ts`

## Changes Made

### Fix A: Array Initializer Lists
- **Location**: `parsePrefix()` method in `BaseParser` (line ~377)
- Added a new case for C/C++ initializer lists: when `{` is encountered in C/C++ mode at the start of an expression, parse it as an initializer list instead of falling through to error
- Added new method `parseInitializerList()` in `BaseParser` (after `parseObjectLiteral()`)
  - Expects `{`
  - Parses comma-separated expressions (each can be a nested initializer list recursively via parsePrefix)
  - Handles trailing comma before `}`
  - Expects `}`
  - Returns `ArrayExpression` node with `isInitializer: true` prop
- **Test results**: `int arr[5] = {1, 2, 3, 4, 5};` → 0 errors, 14 AST nodes
- **Test results**: `int matrix[2][3] = {{1,2,3},{4,5,6}};` → 0 errors, 19 AST nodes

### Fix B: Anonymous Struct in typedef
- **Location**: `parseTypeDeclaration()` method in `CStyleParser` (line ~2366)
- Changed `const nameTok = this.expect(TokenType.Identifier)` to check if next token is `{` first
- If `{` follows struct/enum/class keyword, create a synthetic empty-name token (anonymous)
- If identifier follows, proceed as before with `expect()`
- Added `isAnonymous: nameTok.value === ''` to the node props
- **Test results**: `typedef struct { int x; int y; } Point;` → 0 errors, 10 AST nodes

### Fix C: Improved Parser Diagnostics
- **`parseCStyleParameter`**: Changed `addError` to `addDetailedError` with `grammarRule: 'parameter'`
- **`parseStatement`**: Changed `addError` to `addDetailedError` for "'else' without matching 'if'" with `grammarRule: 'statement'`
- **`parseFunctionDeclaration`**: Replaced `expect(LeftParen)` and `expect(RightParen)` with explicit check + `addDetailedError` using `grammarRule: 'function_definition'`
- **`parseVariableDeclaration`**: Replaced `expect(Identifier)` for declarator names with explicit check + `addDetailedError` using `grammarRule: 'variable_declaration'`

## Backward Compatibility
- Sample C program with scanf: 0 errors, 21 AST nodes, 1 function (same as before)
- All lint checks pass
- TypeScript compilation passes for parser/index.ts
