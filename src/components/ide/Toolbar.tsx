'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useIDEStore } from '@/store/useIDEStore';
import { filesAPI, LANGUAGE_NAMES, LANGUAGE_EXTENSIONS } from '@/lib/api';
import { executeCode, killExecution, onConnectionChange, isConnected } from '@/lib/executor-client';
import { waitForTerminalReady } from './Terminal';
import { getEditorInstance } from './ProblemsPanel';
import type { WSEvent } from '@/lib/executor-client';
import type { CompilerPhaseInfo } from '@/store/useIDEStore';
import {
  Play,
  Square,
  Download,
  Save,
  Plus,
  Sun,
  Moon,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

// ANSI escape codes for colored terminal output
// Consistent, minimal color scheme:
//   - Green: success / info messages
//   - Red: errors / failures
//   - Yellow: warnings
//   - Gray/DIM: skipped / secondary info
const ANSI = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  CYAN: '\x1b[36m',
  GRAY: '\x1b[90m',
};

// Phase display names — no emojis, clean text only
const PHASE_DISPLAY: Record<string, { name: string }> = {
  lexical_analysis: { name: 'Lexical Analysis' },
  parsing: { name: 'Parsing' },
  semantic_analysis: { name: 'Semantic Analysis' },
  ir_generation: { name: 'IR Generation' },
  optimization: { name: 'Optimization' },
  security_analysis: { name: 'Security Analysis' },
  code_generation: { name: 'Code Generation' },
  compilation: { name: 'Compilation' },
  execution: { name: 'Execution' },
  output_processing: { name: 'Output Processing' },
};

// Execution mode display — clean text labels
const MODE_DISPLAY: Record<string, { name: string; color: string }> = {
  ir_vm: { name: 'IR VM', color: ANSI.CYAN },
  codegen: { name: 'Codegen', color: ANSI.YELLOW },
  native: { name: 'Native', color: ANSI.GREEN },
};

function formatPhaseData(phase: string, data: Record<string, unknown>): string {
  const parts: string[] = [];
  switch (phase) {
    case 'lexical_analysis':
      if (data.totalTokens) parts.push(`${data.totalTokens} tokens`);
      if (data.linesOfCode) parts.push(`${data.linesOfCode} LOC`);
      break;
    case 'parsing':
      if (data.totalNodes) parts.push(`${data.totalNodes} nodes`);
      if (data.functionCount) parts.push(`${data.functionCount} functions`);
      break;
    case 'semantic_analysis':
      if (data.totalSymbols) parts.push(`${data.totalSymbols} symbols`);
      break;
    case 'ir_generation':
      if (data.totalInstructions) parts.push(`${data.totalInstructions} instructions`);
      break;
    case 'optimization':
      if (data.instructionsBefore && data.instructionsAfter) {
        parts.push(`${data.instructionsBefore} -> ${data.instructionsAfter} instructions`);
      }
      break;
    case 'security_analysis':
      if (data.riskLevel) parts.push(`risk: ${data.riskLevel}`);
      break;
    case 'code_generation':
      if (data.mode) {
        const modeInfo = MODE_DISPLAY[data.mode as string];
        parts.push(modeInfo?.name || String(data.mode));
      }
      if (data.linesGenerated) parts.push(`${data.linesGenerated} lines`);
      break;
    case 'compilation':
      break;
    case 'execution':
      if (data.mode) {
        const modeInfo = MODE_DISPLAY[data.mode as string];
        parts.push(modeInfo?.name || String(data.mode));
      }
      break;
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

export function Toolbar() {
  const {
    tabs,
    activeTabId,
    language,
    isExecuting,
    isAuthenticated,
    setLanguage,
    addTab,
    markTabClean,
    updateTabContent,
    setTerminalOpen,
    writeToTerminal,
    setExecuting,
    setCurrentRequestId,
    remoteFiles,
    setRemoteFiles,
    theme,
    setTheme,
    updatePipelinePhase,
    resetPipeline,
    setPipelineMetrics,
    diagnostics,
  } = useIDEStore();

  const [isSaving, setIsSaving] = useState(false);
  const [isStdinDialog, setIsStdinDialog] = useState(false);
  const currentRequestIdRef = useRef<string | null>(null);
  const forceRunRef = useRef(false);

  const activeTab = tabs.find(t => t.id === activeTabId);

  const handleRun = useCallback(() => {
    if (!activeTab || isExecuting) return;

    // ─── Check for syntax errors before executing ──────────────────────
    // If the code has error-level diagnostics, show a concise summary in
    // the terminal (NOT the full error list — that belongs in the Problems
    // panel). Navigate to the first error. The user can still force-run by
    // clicking Run again within 3 seconds.
    const { diagnostics } = useIDEStore.getState();
    const errors = diagnostics.filter(d => d.severity === 'error');

    if (errors.length > 0 && !forceRunRef.current) {
      // Show concise error summary in terminal (VS Code behavior)
      setTerminalOpen(true);
      const store = useIDEStore.getState();

      // Wait for terminal to be ready before writing
      const terminalReadyWithTimeout = Promise.race([
        waitForTerminalReady(),
        new Promise<void>((resolve) => setTimeout(resolve, 200)),
      ]);

      terminalReadyWithTimeout.then(() => {
        if (store.settings.terminalClearOnRun) {
          store.clearTerminal();
        }

        const errorCount = errors.length;
        const errorWord = errorCount === 1 ? 'Error' : 'Errors';

        store.writeToTerminal(
          ANSI.RED + ANSI.BOLD + 'Compilation failed.' + ANSI.RESET + '\r\n'
        );
        store.writeToTerminal(
          ANSI.RED + `${errorCount} ${errorWord} found.` + ANSI.RESET + '\r\n'
        );
        store.writeToTerminal(
          ANSI.DIM + 'See Problems panel for details.' + ANSI.RESET + '\r\n'
        );
        store.writeToTerminal(
          '\r\n' + ANSI.YELLOW + 'Fix the errors or press Run again to force execution.' + ANSI.RESET + '\r\n'
        );

        // Navigate to the first error
        const firstError = errors[0];
        const editor = getEditorInstance();
        if (editor && firstError) {
          editor.revealLineInCenter(firstError.line);
          editor.setPosition({
            lineNumber: firstError.line,
            column: firstError.column,
          });
          // Highlight the error range temporarily
          const monaco = (window as any).monaco;
          if (monaco && firstError.endColumn > firstError.column) {
            editor.setSelection(new monaco.Range(
              firstError.line, firstError.column,
              firstError.endLine || firstError.line, firstError.endColumn
            ));
          }
          editor.focus();
        }
      });

      // Allow force-run on next click within 3 seconds
      forceRunRef.current = true;
      setTimeout(() => { forceRunRef.current = false; }, 3000);
      return;
    }

    // Reset force-run flag
    forceRunRef.current = false;

    setTerminalOpen(true);
    setExecuting(true);
    resetPipeline();

    const requestId = `exec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setCurrentRequestId(requestId);
    currentRequestIdRef.current = requestId;

    // Wait for the terminal to be visible and the xterm renderer to complete
    // a fit+refresh cycle before writing any data.  This eliminates the race
    // condition where output is written while the container still has zero
    // dimensions after transitioning from display:none / visibility:hidden.
    //
    // The terminalReady promise is resolved inside Terminal.tsx after:
    //   1. The container becomes visible (CSS transition completes)
    //   2. fitAddon.fit() succeeds (dimensions are non-zero)
    //   3. terminal.refresh() forces a full repaint
    //
    // Fallback: if the promise takes too long (e.g. terminal was already
    // visible), the 200ms timeout ensures we don't hang forever.
    const terminalReadyWithTimeout = Promise.race([
      waitForTerminalReady(),
      new Promise<void>((resolve) => setTimeout(resolve, 200)),
    ]);

    terminalReadyWithTimeout.then(() => {
      const store = useIDEStore.getState();
      if (store.settings.terminalClearOnRun) {
        store.clearTerminal();
      }

      // Check if the terminal service is reachable
      if (!isConnected()) {
        store.writeToTerminal(
          ANSI.YELLOW + '[WARN]  Terminal service not connected. Attempting to connect...' + ANSI.RESET + '\r\n'
        );
      }

      // Define the WebSocket event handler — handles pipeline events from the compiler engine
      const handleEvent = (event: WSEvent) => {
        const currentState = useIDEStore.getState();
        // Ignore events for a different requestId
        if (currentState.currentRequestId !== requestId) return;

        switch (event.type) {
          case 'start': {
            // Already set executing=true above
            break;
          }
          case 'phase': {
            // Pipeline phase transitions from the compiler engine
            try {
              const phaseData = JSON.parse(event.data || '{}');
              const phaseName = phaseData.phase;
              const display = PHASE_DISPLAY[phaseName] || { name: phaseName };
              const phaseInfo: CompilerPhaseInfo = {
                phase: phaseName,
                status: phaseData.status,
                durationMs: phaseData.durationMs,
                data: phaseData.data,
              };
              currentState.updatePipelinePhase(phaseInfo);

              if (phaseData.status === 'running') {
                // [INFO] Phase Name...
                currentState.writeToTerminal(
                  ANSI.GREEN + `[INFO]  ${display.name}...` + ANSI.RESET + '\r\n'
                );
              } else if (phaseData.status === 'completed') {
                const dataStr = phaseData.data ? formatPhaseData(phaseName, phaseData.data) : '';
                if (phaseData.warning) {
                  // [WARN] Phase completed with warnings
                  currentState.writeToTerminal(
                    ANSI.YELLOW + `[WARN]  ${display.name}${dataStr}` + ANSI.RESET + '\r\n'
                  );
                } else {
                  // [OK] Phase completed successfully
                  currentState.writeToTerminal(
                    ANSI.DIM + `[OK]    ${display.name}${dataStr}` + ANSI.RESET + '\r\n'
                  );
                }
              } else if (phaseData.status === 'failed') {
                const dataStr = phaseData.data ? formatPhaseData(phaseName, phaseData.data) : '';
                if (phaseData.fatal) {
                  // [FATAL] Phase failed — pipeline terminates
                  currentState.writeToTerminal(
                    ANSI.RED + ANSI.BOLD + `[FATAL] ${display.name} failed${dataStr}` + ANSI.RESET + '\r\n'
                  );
                } else {
                  // [ERROR] Phase failed (non-fatal)
                  currentState.writeToTerminal(
                    ANSI.RED + `[ERROR] ${display.name} failed${dataStr}` + ANSI.RESET + '\r\n'
                  );
                }
              } else if (phaseData.status === 'skipped') {
                const reason = phaseData.message ? ` -- ${phaseData.message}` : '';
                // [SKIP] Phase -- reason
                currentState.writeToTerminal(
                  ANSI.DIM + `[SKIP]  ${display.name}${reason}` + ANSI.RESET + '\r\n'
                );
              }
            } catch {}
            break;
          }
          case 'stdout': {
            // PTY output includes echo + program output — just display it
            currentState.writeToTerminal(event.data || '');
            break;
          }
          case 'stderr': {
            // Check if this is a pipeline diagnostic (already has ANSI codes)
            const data = event.data || '';
            if (data.includes('[ERROR]') || data.includes('[WARN]') || data.includes('[FATAL]') || data.includes('Compilation terminated.')) {
              // Pipeline diagnostic messages — display as-is (already have ANSI codes)
              currentState.writeToTerminal(data);
            } else {
              // Regular stderr from program — display in red
              currentState.writeToTerminal(ANSI.RED + data + ANSI.RESET);
            }
            break;
          }
          case 'killed': {
            currentState.writeToTerminal('\r\n' + ANSI.YELLOW + 'Execution killed' + ANSI.RESET + '\r\n');
            break;
          }
          case 'end': {
            currentState.setExecuting(false);

            const exitCode = event.exitCode;
            const executionTime = event.executionTime || 0;
            const timeStr = (executionTime / 1000).toFixed(2);

            // Parse summary if available
            let summary: Record<string, any> | undefined;
            try {
              const endPayload = JSON.parse(event.data || '{}');
              summary = endPayload.summary;
              // Store metrics in pipeline state
              if (summary?.metrics) {
                currentState.setPipelineMetrics(summary.metrics);
              }
            } catch {}

            currentState.writeToTerminal('\r\n');

            if (exitCode === 0) {
              // VS Code style: clean exit status
              currentState.writeToTerminal(
                ANSI.DIM + `Process exited with code 0 in ${timeStr}s` + ANSI.RESET + '\r\n'
              );
            } else if (exitCode === -1) {
              currentState.writeToTerminal(
                ANSI.RED + `Process timed out after ${timeStr}s` + ANSI.RESET + '\r\n'
              );
            } else {
              // Check if it was blocked by a pipeline phase
              const phases = currentState.pipelineState.phases;
              const failedPhase = phases.find(p => p.status === 'failed');
              if (failedPhase) {
                const display = PHASE_DISPLAY[failedPhase.phase] || { name: failedPhase.phase };
                currentState.writeToTerminal(
                  ANSI.RED + `Execution blocked: ${display.name} failed` + ANSI.RESET + '\r\n'
                );
              } else {
                currentState.writeToTerminal(
                  ANSI.RED + `Process exited with code ${exitCode} in ${timeStr}s` + ANSI.RESET + '\r\n'
                );
              }
            }

            if (currentRequestIdRef.current === requestId) {
              currentState.setCurrentRequestId(null);
              currentRequestIdRef.current = null;
            }
            break;
          }
        }
      };

      // Start execution via WebSocket -> PTY on the backend.
      executeCode(
        activeTab.content,
        language,
        requestId,
        undefined, // interactive: all input via terminal
        true,
        handleEvent
      );
    }); // Wait for terminal ready
  }, [activeTab, isExecuting, language, setTerminalOpen, setExecuting, setCurrentRequestId, resetPipeline, updatePipelinePhase, setPipelineMetrics]);

  const handleStop = useCallback(async () => {
    const state = useIDEStore.getState();
    const requestId = state.currentRequestId || currentRequestIdRef.current;

    if (requestId) {
      await killExecution(requestId);
    }

    setExecuting(false);
    setCurrentRequestId(null);
    currentRequestIdRef.current = null;
    writeToTerminal(ANSI.YELLOW + 'Execution stopped by user' + ANSI.RESET + '\r\n');
  }, [setExecuting, setCurrentRequestId, writeToTerminal]);

  const handleDownload = () => {
    if (!activeTab) return;

    const blob = new Blob([activeTab.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeTab.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (!activeTab || !isAuthenticated) return;

    setIsSaving(true);
    try {
      if (activeTab.isRemote) {
        await filesAPI.update(activeTab.id, {
          content: activeTab.content,
          name: activeTab.name,
          language: activeTab.language,
        });
      } else {
        const data = await filesAPI.create(activeTab.name, activeTab.language, activeTab.content);
        setRemoteFiles([...remoteFiles, data.file]);
      }
      markTabClean(activeTab.id);
    } catch (err: any) {
      console.error('Save failed:', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleNewFile = () => {
    const ext = LANGUAGE_EXTENSIONS[language] || '.txt';
    addTab(`untitled${ext}`, language);
  };

  const handleLanguageChange = (newLang: string) => {
    if (activeTab) {
      const ext = LANGUAGE_EXTENSIONS[newLang] || '.txt';
      const baseName = activeTab.name.replace(/\.[^.]+$/, '');
      const newName = baseName + ext;
      // Only change language and file extension — do NOT replace content with template
      useIDEStore.setState(state => ({
        language: newLang,
        tabs: state.tabs.map(t =>
          t.id === activeTab.id ? { ...t, language: newLang, name: newName, isDirty: true } : t
        ),
      }));
    } else {
      setLanguage(newLang);
    }
  };

  // Get current pipeline phase for the run button
  const { pipelineState } = useIDEStore();
  const errorCount = diagnostics.filter(d => d.severity === 'error').length;
  const currentPhaseDisplay = pipelineState.currentPhase
    ? (PHASE_DISPLAY[pipelineState.currentPhase]?.name || pipelineState.currentPhase)
    : null;

  return (
    <>
      <div className="h-10 border-b flex items-center justify-between px-3 shrink-0" style={{ backgroundColor: 'var(--ide-bg-toolbar)', borderColor: 'var(--ide-border)' }}>
        {/* Left section - Logo and file actions */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-3">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-[#89b4fa] to-[#cba6f7] flex items-center justify-center">
              <span className="text-[10px] font-bold text-[#1e1e2e]">CF</span>
            </div>
            <span className="text-xs font-semibold hidden sm:inline" style={{ color: 'var(--ide-text-primary)' }}>CodeForge</span>
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ide-icon-btn h-7 w-7"
                  style={{ color: 'var(--ide-text-dim)' }}
                  onClick={handleNewFile}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="text-xs" style={{ backgroundColor: 'var(--ide-bg-surface)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                New File
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ide-icon-btn h-7 w-7"
                  style={{ color: 'var(--ide-text-dim)' }}
                  onClick={handleSave}
                  disabled={!activeTab || isSaving}
                >
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="text-xs" style={{ backgroundColor: 'var(--ide-bg-surface)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                Save (Ctrl+S)
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Center section - Language selector and run controls */}
        <div className="flex items-center gap-2">
          <Select value={language} onValueChange={handleLanguageChange}>
            <SelectTrigger className="h-7 w-[130px] text-xs" style={{ backgroundColor: 'var(--ide-bg-input)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ backgroundColor: 'var(--ide-bg-surface)', borderColor: 'var(--ide-border)' }}>
              {Object.entries(LANGUAGE_NAMES).map(([key, name]) => (
                <SelectItem key={key} value={key} className="text-xs" style={{ color: 'var(--ide-text-primary)' }}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[10px]"
                  style={{ color: 'var(--ide-text-dim)' }}
                  onClick={() => setIsStdinDialog(true)}
                >
                  INPUT
                </Button>
              </TooltipTrigger>
              <TooltipContent className="text-xs" style={{ backgroundColor: 'var(--ide-bg-surface)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                How to Provide Input
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {isExecuting ? (
            <Button
              size="sm"
              className="ide-btn-hover h-7 text-xs font-medium gap-1.5 px-3"
              style={{ backgroundColor: 'var(--ide-error)', color: 'var(--ide-bg-base)' }}
              onClick={handleStop}
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                className="ide-btn-hover h-7 text-xs font-medium gap-1.5 px-3"
                style={{ backgroundColor: errorCount > 0 ? 'var(--ide-warning)' : 'var(--ide-success)', color: 'var(--ide-bg-base)' }}
                onClick={handleRun}
                disabled={!activeTab}
              >
                <Play className="h-3 w-3 fill-current" />
                Run
              </Button>
              {errorCount > 0 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="ide-status-item flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-sm" style={{ backgroundColor: 'var(--ide-error)', opacity: 0.15 }}
                        onClick={() => {
                          // Navigate to first error
                          const firstError = diagnostics.find(d => d.severity === 'error');
                          if (firstError) {
                            const editor = getEditorInstance();
                            if (editor) {
                              editor.revealLineInCenter(firstError.line);
                              editor.setPosition({ lineNumber: firstError.line, column: firstError.column });
                              editor.focus();
                            }
                          }
                        }}
                      >
                        <AlertCircle className="h-3 w-3" style={{ color: 'var(--ide-error)' }} />
                        <span className="text-[9px] font-bold ml-0.5" style={{ color: 'var(--ide-error)' }}>{errorCount}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs" style={{ backgroundColor: 'var(--ide-bg-surface)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                      {errorCount} error{errorCount > 1 ? 's' : ''} — click to jump to first
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}

          {/* Current compiler phase indicator */}
          {isExecuting && currentPhaseDisplay && (
            <span className="text-[10px] animate-pulse hidden sm:inline" style={{ color: 'var(--ide-warning)' }}>
              {currentPhaseDisplay}...
            </span>
          )}
        </div>

        {/* Right section */}
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ide-icon-btn h-7 w-7"
                  style={{ color: 'var(--ide-text-dim)' }}
                  onClick={handleDownload}
                  disabled={!activeTab}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="text-xs" style={{ backgroundColor: 'var(--ide-bg-surface)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                Download File
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ide-icon-btn h-7 w-7"
                  style={{ color: 'var(--ide-text-dim)' }}
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="text-xs" style={{ backgroundColor: 'var(--ide-bg-surface)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                Toggle Theme
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Stdin Help Dialog */}
      <Dialog open={isStdinDialog} onOpenChange={setIsStdinDialog}>
        <DialogContent className="sm:max-w-[500px]" style={{ backgroundColor: 'var(--ide-bg-surface)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--ide-text-primary)' }}>How to Provide Input</DialogTitle>
            <DialogDescription style={{ color: 'var(--ide-text-secondary)' }}>
              Type directly in the terminal while your program is running
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="rounded-md p-4 border" style={{ backgroundColor: 'var(--ide-bg-input)', borderColor: 'var(--ide-border)' }}>
              <p className="text-sm font-medium mb-3" style={{ color: 'var(--ide-success)' }}>Interactive Terminal Input</p>
              <ul className="text-xs space-y-2.5" style={{ color: 'var(--ide-text-secondary)' }}>
                <li className="flex items-start gap-2">
                  <span className="font-bold shrink-0" style={{ color: 'var(--ide-accent)' }}>1.</span>
                  <span>Click <strong style={{ color: 'var(--ide-success)' }}>Run</strong> to start your program</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold shrink-0" style={{ color: 'var(--ide-accent)' }}>2.</span>
                  <span>The compiler pipeline runs: <span style={{ color: 'var(--ide-warning)' }}>Lexer, Parser, Semantic, IR, Optimize, Security, CodeGen</span></span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold shrink-0" style={{ color: 'var(--ide-accent)' }}>3.</span>
                  <span>Program output appears in the terminal in real-time</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold shrink-0" style={{ color: 'var(--ide-accent)' }}>4.</span>
                  <span>When the program asks for input, <strong style={{ color: 'var(--ide-warning)' }}>type in the terminal</strong> and press <kbd className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: 'var(--ide-bg-hover)' }}>Enter</kbd></span>
                </li>
              </ul>
            </div>
            <div className="rounded-md p-3 border" style={{ backgroundColor: 'var(--ide-bg-input)', borderColor: 'var(--ide-border)' }}>
              <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--ide-warning)' }}>Example (Python):</p>
              <div className="rounded p-2 font-mono text-[11px] leading-relaxed" style={{ backgroundColor: 'var(--ide-bg-surface)' }}>
                <div style={{ color: 'var(--ide-text-dim)' }}># Your code:</div>
                <div><span style={{ color: 'var(--ide-accent)' }}>print</span>(<span style={{ color: 'var(--ide-success)' }}>&quot;Hello, World!&quot;</span>)</div>
                <div>name = <span style={{ color: 'var(--ide-accent)' }}>input</span>(<span style={{ color: 'var(--ide-success)' }}>&quot;Enter your name: &quot;</span>)</div>
                <div><span style={{ color: 'var(--ide-accent)' }}>print</span>(<span style={{ color: 'var(--ide-success)' }}>f&quot;Hello, {'{name}'}&quot;</span>)</div>
              </div>
              <div className="mt-2 rounded p-2 font-mono text-[11px] leading-relaxed" style={{ backgroundColor: 'var(--ide-bg-surface)' }}>
                <div style={{ color: 'var(--ide-text-dim)' }}># Terminal output:</div>
                <div style={{ color: 'var(--ide-text-dim)' }}>[INFO] Lexical Analysis...</div>
                <div style={{ color: 'var(--ide-text-dim)' }}>[OK]   Lexical Analysis (8 tokens, 4 LOC)</div>
                <div style={{ color: 'var(--ide-text-dim)' }}>[OK]   Parsing (12 nodes, 1 functions)</div>
                <div style={{ color: 'var(--ide-text-dim)' }}>[OK]   Semantic Analysis (3 symbols)</div>
                <div style={{ color: 'var(--ide-text-dim)' }}>[OK]   IR Generation (8 instructions)</div>
                <div style={{ color: 'var(--ide-text-dim)' }}>[OK]   Optimization (8 -&gt; 6 instructions)</div>
                <div style={{ color: 'var(--ide-text-dim)' }}>[OK]   Security Analysis (risk: low)</div>
                <div style={{ color: 'var(--ide-text-dim)' }}>[OK]   Code Generation (Native)</div>
                <div style={{ color: 'var(--ide-text-primary)' }}>Hello, World!</div>
                <div style={{ color: 'var(--ide-text-primary)' }}>Enter your name: <span style={{ color: 'var(--ide-warning)' }}>yuva</span> <span style={{ color: 'var(--ide-text-dim)' }}>&lt;- type here</span></div>
                <div style={{ color: 'var(--ide-text-primary)' }}>Hello, yuva!</div>
              </div>
            </div>
            <div className="rounded-md p-3 border" style={{ backgroundColor: 'var(--ide-bg-input)', borderColor: 'var(--ide-border)' }}>
              <p className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--ide-purple)' }}>Keyboard Shortcuts:</p>
              <ul className="text-[10px] space-y-1" style={{ color: 'var(--ide-text-secondary)' }}>
                <li><kbd className="px-1 py-0.5 rounded text-[10px]" style={{ backgroundColor: 'var(--ide-bg-hover)' }}>Enter</kbd> -- Send input line to the program</li>
                <li><kbd className="px-1 py-0.5 rounded text-[10px]" style={{ backgroundColor: 'var(--ide-bg-hover)' }}>Backspace</kbd> -- Delete last character</li>
                <li><kbd className="px-1 py-0.5 rounded text-[10px]" style={{ backgroundColor: 'var(--ide-bg-hover)' }}>Ctrl+C</kbd> -- Kill the running program</li>
              </ul>
            </div>
            <Button
              onClick={() => setIsStdinDialog(false)}
              className="ide-btn-hover w-full font-medium"
              style={{ backgroundColor: 'var(--ide-accent)', color: 'var(--ide-bg-base)' }}
            >
              Got it!
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
