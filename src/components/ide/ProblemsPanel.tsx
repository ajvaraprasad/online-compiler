'use client';

import React, { useCallback, useState } from 'react';
import { useIDEStore, Diagnostic } from '@/store/useIDEStore';
import {
  AlertTriangle,
  Info,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  XCircle,
  Lightbulb,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Global Editor Reference ────────────────────────────────────────────────
// The Monaco editor instance is stored here so the ProblemsPanel can
// navigate to a specific line/column when a diagnostic item is clicked.
// The CodeEditor component calls setEditorInstance() on mount.

let editorInstance: any = null;

export function setEditorInstance(editor: any) {
  editorInstance = editor;
}

export function getEditorInstance(): any {
  return editorInstance;
}

// ─── Navigate to Error ──────────────────────────────────────────────────────

function navigateToError(diagnostic: Diagnostic) {
  const editor = editorInstance;
  if (!editor) return;

  // Reveal the line in the center of the viewport
  editor.revealLineInCenter(diagnostic.line);

  // Set cursor position
  editor.setPosition({
    lineNumber: diagnostic.line,
    column: diagnostic.column,
  });

  // Select the error range if we have precise columns
  const monaco = (window as any).monaco;
  if (monaco && diagnostic.endColumn > diagnostic.column) {
    editor.setSelection(new monaco.Range(
      diagnostic.line, diagnostic.column,
      diagnostic.endLine || diagnostic.line, diagnostic.endColumn
    ));
  }

  // Focus the editor
  editor.focus();
}

// ─── Severity Icon ──────────────────────────────────────────────────────────

function SeverityIcon({ severity }: { severity: Diagnostic['severity'] }) {
  switch (severity) {
    case 'error':
      return <XCircle className="h-3.5 w-3.5 shrink-0" style={{ color: '#f38ba8' }} />;
    case 'warning':
      return <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: '#f9e2af' }} />;
    case 'info':
      return <Info className="h-3.5 w-3.5 shrink-0" style={{ color: '#89b4fa' }} />;
    case 'hint':
      return <Lightbulb className="h-3.5 w-3.5 shrink-0" style={{ color: '#94e2d5' }} />;
  }
}

// ─── Severity Label ─────────────────────────────────────────────────────────

function SeverityLabel({ severity }: { severity: Diagnostic['severity'] }) {
  const colors: Record<Diagnostic['severity'], string> = {
    error: '#f38ba8',
    warning: '#f9e2af',
    info: '#89b4fa',
    hint: '#94e2d5',
  };
  const labels: Record<Diagnostic['severity'], string> = {
    error: 'Error',
    warning: 'Warning',
    info: 'Info',
    hint: 'Hint',
  };
  return (
    <span
      className="shrink-0 text-[10px] font-medium uppercase"
      style={{ color: colors[severity], minWidth: '42px' }}
    >
      {labels[severity]}
    </span>
  );
}

// ─── Badge Component ────────────────────────────────────────────────────────

function CountBadge({ count, color, bgColor }: { count: number; color: string; bgColor: string }) {
  if (count === 0) return null;
  return (
    <span
      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-sm text-[10px] font-semibold leading-none"
      style={{ color, backgroundColor: bgColor }}
    >
      {count}
    </span>
  );
}

// ─── Diagnostic Item ────────────────────────────────────────────────────────

function DiagnosticItem({
  diagnostic,
  isSelected,
  onSelect,
}: {
  diagnostic: Diagnostic;
  isSelected: boolean;
  onSelect: (d: Diagnostic) => void;
}) {
  const handleClick = useCallback(() => {
    onSelect(diagnostic);
  }, [diagnostic, onSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(diagnostic);
      }
    },
    [diagnostic, onSelect]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="ide-diagnostic-item flex items-center gap-2 pl-6 pr-3 py-1"
      style={{
        backgroundColor: isSelected ? '#094771' : 'transparent',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
        fontSize: '11px',
        lineHeight: '18px',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = '#2a2d2e';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = 'transparent';
        }
      }}
      aria-label={`${diagnostic.severity}: ${diagnostic.message} at line ${diagnostic.line}, column ${diagnostic.column}`}
    >
      <SeverityIcon severity={diagnostic.severity} />
      <SeverityLabel severity={diagnostic.severity} />
      <span className="truncate" style={{ color: '#d4d4d4' }}>
        {diagnostic.message}
      </span>
      <span className="ml-auto shrink-0 pl-3" style={{ color: '#999999' }}>
        {diagnostic.source}
      </span>
      <span className="shrink-0" style={{ color: '#999999' }}>
        Ln {diagnostic.line}, Col {diagnostic.column}
      </span>
    </div>
  );
}

// ─── Problems Panel ─────────────────────────────────────────────────────────

export function ProblemsPanel() {
  const { diagnostics, isProblemsPanelOpen, toggleProblemsPanel, activeTabId, tabs } =
    useIDEStore();

  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const infos = diagnostics.filter((d) => d.severity === 'info');
  const hints = diagnostics.filter((d) => d.severity === 'hint');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isFileGroupExpanded, setIsFileGroupExpanded] = useState(true);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const fileName = activeTab?.name ?? 'untitled';

  const handleSelect = useCallback((d: Diagnostic) => {
    setSelectedId(d.id);
    navigateToError(d);
  }, []);

  if (!isProblemsPanelOpen) {
    // Collapsed state — just show the header bar with counts
    return (
      <div
        className="shrink-0 border-t"
        style={{ backgroundColor: 'var(--ide-bg-terminal-header)', borderColor: 'var(--ide-border)' }}
      >
        <div className="flex items-center justify-between px-3 h-7">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-wide" style={{ color: 'var(--ide-text-muted)' }}>
              PROBLEMS
            </span>
            <CountBadge count={errors.length} color="#f38ba8" bgColor="#f38ba820" />
            <CountBadge count={warnings.length} color="#f9e2af" bgColor="#f9e2af20" />
            {infos.length > 0 && (
              <CountBadge count={infos.length} color="#89b4fa" bgColor="#89b4fa20" />
            )}
            {hints.length > 0 && (
              <CountBadge count={hints.length} color="#94e2d5" bgColor="#94e2d520" />
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="ide-icon-btn h-5 w-5"
            style={{ color: 'var(--ide-text-dim)' }}
            onClick={toggleProblemsPanel}
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 flex flex-col border-t"
      style={{
        backgroundColor: 'var(--ide-bg-terminal)',
        borderColor: 'var(--ide-border)',
        maxHeight: '150px',
      }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-3 h-7 shrink-0 border-b"
        style={{ backgroundColor: 'var(--ide-bg-terminal-header)', borderColor: 'var(--ide-border)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wide" style={{ color: 'var(--ide-text-muted)' }}>
            PROBLEMS
          </span>
          <CountBadge count={errors.length} color="#f38ba8" bgColor="#f38ba820" />
          <CountBadge count={warnings.length} color="#f9e2af" bgColor="#f9e2af20" />
          {infos.length > 0 && (
            <CountBadge count={infos.length} color="#89b4fa" bgColor="#89b4fa20" />
          )}
          {hints.length > 0 && (
            <CountBadge count={hints.length} color="#94e2d5" bgColor="#94e2d520" />
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="ide-icon-btn h-5 w-5"
          style={{ color: 'var(--ide-text-dim)' }}
          onClick={toggleProblemsPanel}
        >
          <ChevronDown className="h-3 w-3" />
        </Button>
      </div>

      {/* Error list */}
      <div
        className="flex-1 overflow-y-auto"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#424242 transparent',
        }}
      >
        {diagnostics.length === 0 ? (
          // Empty state
          <div className="flex items-center gap-2 px-3 py-3" style={{ color: '#6a9955' }}>
            <CheckCircle className="h-3.5 w-3.5 shrink-0" />
            <span
              style={{
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
                fontSize: '11px',
                color: '#6a9955',
              }}
            >
              No problems detected
            </span>
          </div>
        ) : (
          // File group — VS Code style with collapsible file header
          <div>
            {/* File group header */}
            <button
              className="ide-file-item flex items-center gap-1.5 w-full px-2 py-1 text-left"
              onClick={() => setIsFileGroupExpanded(!isFileGroupExpanded)}
              aria-expanded={isFileGroupExpanded}
              aria-label={`Toggle ${fileName} diagnostics`}
            >
              {isFileGroupExpanded ? (
                <ChevronDown className="h-3 w-3 shrink-0" style={{ color: '#cccccc' }} />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0" style={{ color: '#cccccc' }} />
              )}
              <span
                className="text-[11px] truncate"
                style={{
                  color: '#cccccc',
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
                }}
              >
                {fileName}
              </span>
              {/* Severity summary badges next to file name */}
              <div className="flex items-center gap-1 ml-1">
                {errors.length > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px]" style={{ color: '#f38ba8' }}>
                    <XCircle className="h-2.5 w-2.5" />{errors.length}
                  </span>
                )}
                {warnings.length > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px]" style={{ color: '#f9e2af' }}>
                    <AlertTriangle className="h-2.5 w-2.5" />{warnings.length}
                  </span>
                )}
                {infos.length > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px]" style={{ color: '#89b4fa' }}>
                    <Info className="h-2.5 w-2.5" />{infos.length}
                  </span>
                )}
                {hints.length > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px]" style={{ color: '#94e2d5' }}>
                    <Lightbulb className="h-2.5 w-2.5" />{hints.length}
                  </span>
                )}
              </div>
            </button>

            {/* Diagnostic items */}
            {isFileGroupExpanded && (
              <div>
                {diagnostics.map((d) => (
                  <DiagnosticItem
                    key={d.id}
                    diagnostic={d}
                    isSelected={selectedId === d.id}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
