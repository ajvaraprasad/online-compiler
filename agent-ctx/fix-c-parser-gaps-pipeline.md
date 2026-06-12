# Fix C Parser Gaps — Pipeline Changes

## Task
Fix pipeline.ts for better terminal output when GCC overrides custom parser

## Changes Made

### Fix D: Better Terminal Output when GCC Overrides Custom Parser
- **Location**: `/home/z/my-project/src/lib/compiler/pipeline.ts`, lines ~306-336
- When `externalValid` is true for C/C++ (GCC validates but custom parser failed), the warning message now includes:
  1. **Number of diagnostics**: `Custom parser produced N diagnostic(s) (M error(s) downgraded to warning(s))`
  2. **Clear GCC validation statement**: `[OK] gcc -fsyntax-only validation PASSED — code is valid C`
  3. **Specific unsupported constructs**: Analyzes parse error messages to identify likely unsupported constructs (array/struct initializer lists, anonymous structs/enums in typedef, designated initializers, compound literals, generic selections)
  4. **Fallback explanation**: `Falling back to native execution — gcc will compile at runtime`

## Code Quality
- No lint errors
- No TypeScript errors in pipeline.ts (pre-existing SecurityReport.findings error is unrelated)
- Dev server running normally
