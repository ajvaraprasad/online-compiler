# Task 4-b: Runtime Error Navigation in Terminal

## Agent: full-stack-developer

## Summary
Implemented runtime error navigation — when the user clicks on an error line in the terminal output, the Monaco editor jumps to that line and highlights it temporarily.

## Files Changed
1. **CREATED** `/src/lib/terminal-error-parser.ts` — Error pattern parser for 5+ languages
2. **MODIFIED** `/src/components/ide/Terminal.tsx` — Added xterm registerLinkProvider for clickable error lines
3. **MODIFIED** `/src/app/globals.css` — Added error highlight and link color CSS classes

## Key Implementation Details

### terminal-error-parser.ts
- `parseTerminalError(line)` returns `{line, column?, matchStart, matchEnd} | null`
- 7 regex patterns in priority order: Python → C/C++ with col → C/C++ line only → Java → Node.js stack → Node.js SyntaxError → General fallback
- `isPotentialErrorLine(line)` quick pre-filter checks for keywords: error, warning, traceback, exception, "line ", ":"

### Terminal.tsx
- Uses xterm.js v6 `registerLinkProvider` API
- `provideLinks(bufferLineNumber, callback)` reads buffer line, pre-filters, parses, creates ILink
- ILink has pointerCursor + underline decorations, activate navigates editor, hover shows tooltip
- `navigateEditorToLine()` uses `getEditorInstance()` from ProblemsPanel
- Editor navigation: revealLineInCenter → setPosition → focus → deltaDecorations (3s highlight)
- Hover tooltip: DOM element with xterm-hover class positioned near cursor
- All parsing wrapped in try/catch — never blocks terminal rendering

### globals.css
- `.error-line-highlight` — pink background + red left border on error line
- `.error-line-glyph` — red circle in gutter
- `.xterm-link-layer a` — #89b4fa color for error links

## No Breaking Changes
- WebSocket input handling unchanged
- Terminal resize handling unchanged
- Show/hide lifecycle unchanged
- ProblemsPanel not modified (getEditorInstance already exported)
