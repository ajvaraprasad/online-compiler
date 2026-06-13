'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Terminal as XTerm, type ILinkProvider, type ILink, type IBufferRange } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useIDEStore } from '@/store/useIDEStore';
import { sendStdin, killExecution, resizeTerminal } from '@/lib/executor-client';
import { parseTerminalError, isPotentialErrorLine } from '@/lib/terminal-error-parser';
import { getEditorInstance } from '@/components/ide/ProblemsPanel';
import {
  Terminal as TerminalIcon,
  X,
  ChevronUp,
  ChevronDown,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

import '@xterm/xterm/css/xterm.css';

// ─── Terminal Ready Promise ────────────────────────────────────────────────
// External code (Toolbar/handleRun) can await this to ensure the terminal
// panel is visible and the xterm renderer has completed a fit+refresh cycle
// before writing data.  This eliminates the race condition where output is
// written while the container still has zero dimensions.

let terminalReadyResolve: (() => void) | null = null;
let terminalReadyPromise: Promise<void> = Promise.resolve();

export function waitForTerminalReady(): Promise<void> {
  return terminalReadyPromise;
}

function resetTerminalReady(): void {
  terminalReadyPromise = new Promise<void>((resolve) => {
    terminalReadyResolve = resolve;
  });
}

function signalTerminalReady(): void {
  if (terminalReadyResolve) {
    terminalReadyResolve();
    terminalReadyResolve = null;
  }
}

// ─── Strip ANSI escape sequences from a string ──────────────────────────────
// Terminal output often contains color/formatting codes that should not be
// considered when parsing for error patterns.

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

// ─── Error Link Tooltip ─────────────────────────────────────────────────────
// A simple DOM-based tooltip that appears when hovering over a detected
// error link in the terminal. Follows xterm's guidance to create the element
// within Terminal.element and add the `xterm-hover` class.

let hoverTooltip: HTMLDivElement | null = null;

function getOrCreateTooltip(terminalElement: HTMLElement): HTMLDivElement {
  if (hoverTooltip && hoverTooltip.parentElement === terminalElement) {
    return hoverTooltip;
  }
  // Clean up any stale tooltip
  if (hoverTooltip && hoverTooltip.parentElement) {
    hoverTooltip.parentElement.removeChild(hoverTooltip);
  }
  const tooltip = document.createElement('div');
  tooltip.className = 'xterm-hover';
  tooltip.style.cssText = `
    position: absolute;
    background: #1e1e2e;
    color: #89b4fa;
    font-size: 11px;
    font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid #45475a;
    pointer-events: none;
    z-index: 1000;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  `;
  terminalElement.appendChild(tooltip);
  hoverTooltip = tooltip;
  return tooltip;
}

function hideTooltip() {
  if (hoverTooltip) {
    hoverTooltip.style.display = 'none';
  }
}

// ─── Navigate to error line in Monaco editor ─────────────────────────────────

function navigateEditorToLine(lineNumber: number, column?: number) {
  const editor = getEditorInstance();
  if (!editor) {
    console.warn('[Terminal] Cannot navigate: no Monaco editor instance');
    return;
  }

  try {
    // Reveal the line in the center of the viewport
    editor.revealLineInCenter(lineNumber);

    // Set cursor position
    editor.setPosition({
      lineNumber,
      column: column || 1,
    });

    // Focus the editor
    editor.focus();

    // Temporarily highlight the line with a decoration that fades after 3s
    const monaco = (window as any).monaco;
    if (monaco) {
      const decorations = editor.deltaDecorations([], [{
        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
        options: {
          isWholeLine: true,
          className: 'error-line-highlight',
          glyphMarginClassName: 'error-line-glyph',
        },
      }]);

      // Remove highlight after 3 seconds
      setTimeout(() => {
        try {
          editor.deltaDecorations(decorations, []);
        } catch {}
      }, 3000);
    }

    console.log(`[Terminal] Navigated to line ${lineNumber}${column ? `:${column}` : ''}`);
  } catch (err) {
    console.warn('[Terminal] Navigation failed:', err);
  }
}

// ─── Register error link provider on xterm instance ──────────────────────────
// Uses xterm.js v6 registerLinkProvider API to make detected error patterns
// clickable. When a line contains a recognizable error format (Python, C/C++,
// Java, Node.js), the matching region becomes a link with underline styling
// and a pointer cursor. Clicking navigates the Monaco editor to the error line.

function registerErrorLinkProvider(xterm: XTerm) {
  const linkProvider: ILinkProvider = {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
      try {
        // Get the buffer line at the given row
        const bufferLine = xterm.buffer.active.getLine(bufferLineNumber);
        if (!bufferLine) {
          callback(undefined);
          return;
        }

        // Translate the buffer line to a plain string (visible text only)
        const lineText = bufferLine.translateToString(true);
        if (!lineText || lineText.trim().length === 0) {
          callback(undefined);
          return;
        }

        // Quick pre-filter: skip lines that don't look like errors
        if (!isPotentialErrorLine(lineText)) {
          callback(undefined);
          return;
        }

        // Strip ANSI codes for parsing (the visible text from translateToString
        // should already be clean, but be defensive)
        const cleanText = stripAnsi(lineText);

        // Parse for error patterns
        const parsed = parseTerminalError(cleanText);
        if (!parsed) {
          callback(undefined);
          return;
        }

        // Calculate the range for the clickable region.
        // xterm positions are 1-based. matchStart/matchEnd are 0-based string indices.
        const startX = parsed.matchStart + 1;  // Convert 0-based → 1-based
        const endX = Math.min(parsed.matchEnd + 1, lineText.length); // Inclusive end → +1, clamp
        const y = bufferLineNumber;

        const range: IBufferRange = {
          start: { x: startX, y },
          end: { x: endX, y },
        };

        const linkText = cleanText.substring(parsed.matchStart, parsed.matchEnd);

        const link: ILink = {
          range,
          text: linkText,
          decorations: {
            pointerCursor: true,
            underline: true,
          },
          activate(_event: MouseEvent, _text: string): void {
            navigateEditorToLine(parsed.line, parsed.column);
          },
          hover(event: MouseEvent, _text: string): void {
            // Show tooltip near the mouse position
            const terminalEl = xterm.element;
            if (!terminalEl) return;

            const tooltip = getOrCreateTooltip(terminalEl);
            tooltip.textContent = `Click to go to line ${parsed.line}${parsed.column ? `:${parsed.column}` : ''}`;
            tooltip.style.display = 'block';

            // Position relative to the terminal element
            const termRect = terminalEl.getBoundingClientRect();
            const offsetX = event.clientX - termRect.left + 12;
            const offsetY = event.clientY - termRect.top - 28;
            tooltip.style.left = `${offsetX}px`;
            tooltip.style.top = `${offsetY}px`;
          },
          leave(): void {
            hideTooltip();
          },
          dispose(): void {
            hideTooltip();
          },
        };

        callback([link]);
      } catch (err) {
        // Non-blocking: never let link parsing break terminal rendering
        console.warn('[Terminal] Link provider error:', err);
        callback(undefined);
      }
    },
  };

  xterm.registerLinkProvider(linkProvider);
  console.log('[Terminal] Error link provider registered');
}

export function Terminal() {
  const {
    isTerminalOpen,
    isExecuting,
    setTerminalOpen,
    setExecuting,
    setCurrentRequestId,
    setTerminalWriter,
  } = useIDEStore();

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  // Track whether xterm has been initialized — persists across show/hide cycles
  const isInitializedRef = useRef(false);
  // Track the previous visibility state to detect hidden→visible transitions
  const prevOpenRef = useRef(isTerminalOpen);
  // Refs for cleanup of pending async operations (RAF / retry timers)
  const pendingRafsRef = useRef<number[]>([]);
  const pendingTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ─── Helper: cancel all pending RAFs and timers ─────────────────────────

  const cancelPending = useCallback(() => {
    pendingRafsRef.current.forEach(id => cancelAnimationFrame(id));
    pendingRafsRef.current = [];
    pendingTimersRef.current.forEach(id => clearTimeout(id));
    pendingTimersRef.current = [];
  }, []);

  // ─── Initialize xterm.js ONCE ──────────────────────────────────────────────
  // The xterm instance is created only once and persists for the component's
  // entire lifetime.  Hiding the terminal with CSS does NOT destroy it.
  // This is the KEY fix: closing the terminal panel only hides it visually,
  // it does NOT unmount the component or dispose the xterm instance.

  useEffect(() => {
    if (!terminalRef.current || isInitializedRef.current) return;

    console.log('[Terminal] Creating xterm instance');

    const xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      lineHeight: 1.35,
      letterSpacing: 0,
      theme: {
        // VS Code Dark+ inspired theme
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        selectionForeground: '#d4d4d4',
        black: '#000000',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#d7ba7d',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#d4d4d4',
        brightBlack: '#666666',
        brightRed: '#f44747',
        brightGreen: '#6a9955',
        brightYellow: '#d7ba7d',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0',
        brightWhite: '#d4d4d4',
      },
      allowTransparency: false,
      scrollback: 5000,
      convertEol: false, // PTY output already has proper \r\n; converting would cause double \r
      scrollSensitivity: 1,
      fastScrollSensitivity: 5,
      smoothScrollDuration: 0,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);

    // Open xterm in the container — the container is visible on first mount
    // (isTerminalOpen defaults to true in the store)
    xterm.open(terminalRef.current);

    // Use double-RAF for initial fit — ensures layout is fully computed
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch {}
        xterm.focus();
        console.log('[Terminal] Initial fit and focus complete');
      });
    });

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;
    isInitializedRef.current = true;

    // Store xterm reference on the DOM element so executor-client can read dimensions
    const termEl = terminalRef.current.querySelector('.xterm');
    if (termEl) {
      (termEl as any).__xterm = xterm;
    }

    // Register the terminal writer in the store so other components can write
    setTerminalWriter((data: string) => {
      xterm.write(data);
    });
    console.log('[Terminal] WebSocket attached (terminalWriter registered)');

    // Minimal welcome message — VS Code style
    xterm.writeln('\x1b[90mPress Run to execute.\x1b[0m');

    // ─── Handle keyboard input ──────────────────────────────────────────────
    // WebSocket + PTY architecture — keystrokes flow directly through
    // the WebSocket to the PTY, and the PTY echo comes back through the same
    // connection.
    xterm.onData((data: string) => {
      // Only accept input when a process is running
      const state = useIDEStore.getState();
      const isExec = state.isExecuting;
      const reqId = state.currentRequestId;

      if (!isExec) {
        return;
      }

      if (!reqId) {
        return;
      }

      // Send raw keystroke directly to the PTY via WebSocket
      sendStdin(reqId, data);
    });

    // ─── Handle terminal resize ─────────────────────────────────────────────
    xterm.onResize(({ rows, cols }) => {
      const requestId = useIDEStore.getState().currentRequestId;
      if (requestId && useIDEStore.getState().isExecuting) {
        resizeTerminal(requestId, rows, cols);
      }
    });

    // ─── Register link provider for clickable error lines ──────────────────
    // When the user clicks on an error line in the terminal output
    // (e.g., `File "main.py", line 5` or `main.c:10:5: error:`),
    // the Monaco editor navigates to that line and highlights it.
    registerErrorLinkProvider(xterm);

    // Cleanup only on actual component unmount (page navigation, etc.)
    return () => {
      console.log('[Terminal] Component unmounting — disposing xterm');
      cancelPending();
      cancelAnimationFrame(raf1);
      setTerminalWriter(null);
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      isInitializedRef.current = false;
    };
  }, [setTerminalWriter, cancelPending]);

  // ─── Refit when terminal becomes visible ──────────────────────────────────
  //
  // ROOT CAUSE of the blank-terminal bug:
  //   Previously used Tailwind `hidden` class → `display: none` which completely
  //   removes the element from the layout.  When `display: none` is active,
  //   the xterm container has zero dimensions, the canvas renderer stops, and
  //   requestAnimationFrame callbacks are paused.  When the element becomes
  //   visible again, the browser needs a full layout pass before dimensions
  //   are available.  The old setTimeout(100) was a race condition — sometimes
  //   fit() ran before layout completed → 0 cols/0 rows → blank terminal.
  //
  // FIX (3-pronged approach):
  //
  //   A) CSS: Replace `display: none` with `visibility: hidden; height: 0;
  //      overflow: hidden` — the element stays in the layout flow so the
  //      browser can compute dimensions immediately when it becomes visible.
  //      No CSS transition on height (instant show) to avoid mid-animation
  //      fit() calls with intermediate dimensions.
  //
  //   B) Timing: Use double-requestAnimationFrame instead of setTimeout for
  //      reliable post-layout timing.  RAF-1 fires after style recalc,
  //      RAF-2 fires after layout paint — dimensions are guaranteed.
  //
  //   C) Coordination: After fit+refresh completes, resolve a "terminalReady"
  //      promise that handleRun awaits before writing any data.  This
  //      eliminates the race between "terminal shows" and "data starts
  //      flowing".  If the terminal was already visible, the promise is
  //      already resolved (no delay).

  useEffect(() => {
    const becameVisible = isTerminalOpen && !prevOpenRef.current;
    prevOpenRef.current = isTerminalOpen;

    if (!isTerminalOpen) {
      console.log('[Terminal] Hidden');
      cancelPending();
      return;
    }

    if (!xtermRef.current || !fitAddonRef.current) return;

    console.log(becameVisible ? '[Terminal] Shown (was hidden)' : '[Terminal] Refitting');

    // Reset the ready promise — callers will await the new one
    if (becameVisible) {
      resetTerminalReady();
    }

    // Cancel any previous pending operations
    cancelPending();

    // Robust refit using double-RAF:
    //   RAF 1 — fires after the browser has calculated styles/layout
    //   RAF 2 — fires after the browser has painted, guaranteeing
    //           container dimensions are available
    let cancelled = false;

    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;

      const raf2 = requestAnimationFrame(() => {
        if (cancelled) return;

        const container = terminalRef.current;
        const xterm = xtermRef.current;
        const fitAddon = fitAddonRef.current;

        if (!container || !xterm || !fitAddon) {
          // Signal ready anyway so handleRun doesn't hang
          signalTerminalReady();
          return;
        }

        // ── Verify container has non-zero dimensions ──────────────────
        if (container.offsetWidth === 0 || container.offsetHeight === 0) {
          console.warn('[Terminal] Container has zero dimensions after show, retrying in 50ms...');

          // Retry — the layout hasn't settled yet
          const retryTimer = setTimeout(() => {
            if (cancelled) return;
            try {
              fitAddon.fit();
              xterm.refresh(0, (xterm.rows || 1) - 1);
              console.log('[Terminal] Reattached (retry fit succeeded)');
            } catch (err) {
              console.warn('[Terminal] Retry fit failed:', err);
            }
            signalTerminalReady();
          }, 50);
          pendingTimersRef.current.push(retryTimer);
          return;
        }

        // ── Fit and refresh ────────────────────────────────────────────
        try {
          fitAddon.fit();
          xterm.refresh(0, (xterm.rows || 1) - 1);
          console.log('[Terminal] Fit executed after show');
        } catch (err) {
          console.warn('[Terminal] Fit failed after show:', err);
        }

        // Update the __xterm reference for executor-client (DOM may have changed)
        const termEl = container.querySelector('.xterm');
        if (termEl && xterm) {
          (termEl as any).__xterm = xterm;
        }

        console.log('[Terminal] Reattached');

        // Auto-focus if executing (the user clicked Run and terminal auto-opened)
        if (useIDEStore.getState().isExecuting) {
          xterm.focus();
          console.log('[Terminal] Focused after show (executing)');
        }

        // Signal that the terminal is ready for data
        signalTerminalReady();
        console.log('[Terminal] WebSocket attached (output listeners active)');
      });

      pendingRafsRef.current.push(raf2);
    });

    pendingRafsRef.current.push(raf1);

    return () => {
      cancelled = true;
      cancelPending();
    };
  }, [isTerminalOpen, cancelPending]);

  // ─── Auto-focus terminal when execution starts ──────────────────────────

  useEffect(() => {
    if (isExecuting && isTerminalOpen && xtermRef.current) {
      requestAnimationFrame(() => {
        xtermRef.current?.focus();
        console.log('[Terminal] Focused (execution started)');
      });
    }
  }, [isExecuting, isTerminalOpen]);

  // ─── Resize handling ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!isTerminalOpen) return;

    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();
      } catch {}
    };

    const timeout = setTimeout(handleResize, 50);
    window.addEventListener('resize', handleResize);

    const observer = new ResizeObserver(() => {
      try { fitAddonRef.current?.fit(); } catch {}
    });

    if (terminalRef.current) {
      observer.observe(terminalRef.current);
    }

    return () => {
      clearTimeout(timeout);
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [isTerminalOpen, isMaximized]);

  // ─── Clear terminal ──────────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    const term = xtermRef.current;
    if (term) {
      term.clear();
      term.write('\x1b[H');
    }
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────
  //
  // KEY FIX: Instead of returning null when hidden, we render the terminal
  // container but hide it with CSS. This keeps the xterm instance alive,
  // preserves the buffer, and maintains the terminalWriter connection.
  //
  // Previous behavior: `if (!isTerminalOpen) return null;`
  //   → Unmounts component → xterm.dispose() → terminalWriter = null → LOST OUTPUT
  //
  // Old CSS fix: Tailwind `hidden` class → `display: none`
  //   → Element removed from layout → zero dimensions → xterm canvas renderer stops
  //   → Race condition: fit() runs before layout completes → 0 cols/0 rows → BLANK
  //
  // NEW behavior: `visibility: hidden; height: 0; overflow: hidden`
  //   → Element stays in layout flow → browser can compute dimensions immediately
  //   → xterm canvas maintains internal state → buffer preserved
  //   → terminalWriter stays connected → output accumulates in buffer
  //   → When shown: fitAddon.fit() + refresh() restores rendering IMMEDIATELY
  //   → No race condition because dimensions are available on first paint
  //   → NO CSS transition — instant show/hide avoids mid-animation fit() issues

  return (
    <div
      className={`flex flex-col ${
        isMaximized && isTerminalOpen ? 'absolute inset-x-0 bottom-0 top-10 z-50' : ''
      }`}
      style={{
        // Instead of display:none (Tailwind `hidden`), use visibility + height.
        // This keeps the element in the layout flow so xterm dimensions are
        // computable the moment the terminal becomes visible again.
        //
        // NO CSS transition on height — we need instant show/hide to avoid
        // fit() computing dimensions during the animation (intermediate values).
        ...(isTerminalOpen
          ? {
              height: isMaximized ? undefined : '16rem',  // h-64 = 16rem
              backgroundColor: 'var(--ide-bg-terminal)',
              borderTop: '1px solid var(--ide-border)',
              cursor: 'default',
            }
          : {
              height: 0,
              minHeight: 0,
              overflow: 'hidden',
              visibility: 'hidden' as const,
              borderTop: 'none',
              cursor: 'default',
            }),
      }}
    >
      {/* Terminal Header — VS Code style */}
      <div
        className="flex items-center justify-between px-3 py-1 border-b shrink-0"
        style={{ backgroundColor: 'var(--ide-bg-terminal-header)', borderColor: 'var(--ide-border)' }}
      >
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-3.5 w-3.5" style={{ color: 'var(--ide-text-primary)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--ide-text-primary)' }}>Terminal</span>
          {isExecuting && (
            <div className="flex items-center gap-1.5 ml-2">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--ide-success)' }} />
              <span className="text-[10px]" style={{ color: 'var(--ide-success)' }}>Running</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="ide-terminal-btn h-6 w-6"
            style={{ color: 'var(--ide-text-muted)' }}
            onClick={handleClear}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ide-terminal-btn h-6 w-6"
            style={{ color: 'var(--ide-text-muted)' }}
            onClick={() => setIsMaximized(!isMaximized)}
          >
            {isMaximized ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ide-terminal-btn h-6 w-6"
            style={{ color: 'var(--ide-text-muted)' }}
            onClick={() => setTerminalOpen(false)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* xterm.js Container — always in DOM, visibility-hidden when terminal is closed */}
      <div
        ref={terminalRef}
        className="ide-terminal-area flex-1 overflow-hidden"
        style={{ minHeight: 0 }}
        onClick={() => xtermRef.current?.focus()}
      />
    </div>
  );
}
