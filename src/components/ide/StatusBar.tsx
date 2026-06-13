'use client';

import React from 'react';
import { useIDEStore } from '@/store/useIDEStore';
import { LANGUAGE_NAMES } from '@/lib/api';
import {
  GitBranch,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Wifi,
  WifiOff,
  Loader2,
  Lightbulb,
} from 'lucide-react';

interface StatusBarProps {
  isConnected: boolean;
}

const PHASE_ICONS: Record<string, string> = {
  lexical_analysis: '📝',
  parsing: '🌳',
  semantic_analysis: '🔍',
  ir_generation: '⚙️',
  optimization: '🚀',
  security_analysis: '🛡️',
  compilation: '🔨',
  execution: '▶️',
  output_processing: '📊',
};

export function StatusBar({ isConnected }: StatusBarProps) {
  const { language, tabs, activeTabId, isExecuting, pipelineState, diagnostics } = useIDEStore();
  const activeTab = tabs.find(t => t.id === activeTabId);

  // Get latest phase info
  const currentPhase = pipelineState.currentPhase;
  const completedPhases = pipelineState.phases.filter(p => p.status === 'completed');
  const failedPhases = pipelineState.phases.filter(p => p.status === 'failed');
  const metrics = pipelineState.metrics;

  // Diagnostic counts
  const errorCount = diagnostics.filter(d => d.severity === 'error').length;
  const warningCount = diagnostics.filter(d => d.severity === 'warning').length;
  const hintCount = diagnostics.filter(d => d.severity === 'hint').length;

  return (
    <div
      className="h-6 border-t flex items-center justify-between px-3 shrink-0 select-none"
      style={{ backgroundColor: 'var(--ide-bg-statusbar)', borderColor: 'var(--ide-border)' }}
    >
      {/* Left section */}
      <div className="flex items-center gap-3">
        {/* Git branch placeholder */}
        <div className="flex items-center gap-1" style={{ color: 'var(--ide-success)' }}>
          <GitBranch className="h-3 w-3" />
          <span className="text-[10px]">main</span>
        </div>

        {/* Error/Warning indicators */}
        <div className="flex items-center gap-2">
          {errorCount > 0 ? (
            <div
              className="ide-status-item flex items-center gap-1"
              onClick={() => {
                // Navigate to first error
                const firstError = diagnostics.find(d => d.severity === 'error');
                if (firstError) {
                  const { toggleProblemsPanel } = useIDEStore.getState();
                  toggleProblemsPanel();
                }
              }}
            >
              <AlertCircle className="h-3 w-3" style={{ color: 'var(--ide-error)' }} />
              <span className="text-[10px]" style={{ color: 'var(--ide-error)' }}>{errorCount}</span>
            </div>
          ) : null}
          {warningCount > 0 ? (
            <div
              className="ide-status-item flex items-center gap-1"
              onClick={() => {
                const { toggleProblemsPanel } = useIDEStore.getState();
                toggleProblemsPanel();
              }}
            >
              <AlertTriangle className="h-3 w-3" style={{ color: 'var(--ide-warning)' }} />
              <span className="text-[10px]" style={{ color: 'var(--ide-warning)' }}>{warningCount}</span>
            </div>
          ) : null}
          {hintCount > 0 ? (
            <div
              className="ide-status-item flex items-center gap-1"
              onClick={() => {
                const { toggleProblemsPanel } = useIDEStore.getState();
                toggleProblemsPanel();
              }}
            >
              <Lightbulb className="h-3 w-3" style={{ color: 'var(--ide-hint, #94e2d5)' }} />
              <span className="text-[10px]" style={{ color: 'var(--ide-hint, #94e2d5)' }}>{hintCount}</span>
            </div>
          ) : null}
          {errorCount === 0 && warningCount === 0 && hintCount === 0 && activeTab ? (
            <div className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3" style={{ color: 'var(--ide-success)' }} />
              <span className="text-[10px]" style={{ color: 'var(--ide-text-dim)' }}>No issues</span>
            </div>
          ) : null}
        </div>

        {/* Execution status with pipeline info */}
        {isExecuting && currentPhase && (
          <div className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" style={{ color: 'var(--ide-warning)' }} />
            <span className="text-[10px]" style={{ color: 'var(--ide-warning)' }}>
              {PHASE_ICONS[currentPhase] || '⚙️'} {currentPhase.replace(/_/g, ' ')}
            </span>
          </div>
        )}

        {/* Pipeline summary when not executing but has completed */}
        {!isExecuting && completedPhases.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px]" style={{ color: 'var(--ide-text-dim)' }}>
              {failedPhases.length > 0 ? (
                <span style={{ color: 'var(--ide-error)' }}>✗ Pipeline failed</span>
              ) : (
                <span style={{ color: 'var(--ide-success)' }}>✓ Pipeline: {completedPhases.length} phases</span>
              )}
            </span>
            {metrics && (
              <>
                {typeof metrics.totalTokens === 'number' && metrics.totalTokens > 0 && (
                  <span className="text-[10px]" style={{ color: 'var(--ide-text-dim)' }}>{String(metrics.totalTokens)} tokens</span>
                )}
                {typeof metrics.cyclomaticComplexity === 'number' && metrics.cyclomaticComplexity > 1 && (
                  <span className="text-[10px]" style={{ color: 'var(--ide-text-dim)' }}>complexity: {String(metrics.cyclomaticComplexity)}</span>
                )}
                {typeof metrics.optimizationReduction === 'number' && metrics.optimizationReduction > 0 && (
                  <span className="text-[10px]" style={{ color: 'var(--ide-success)' }}>-{String(metrics.optimizationReduction)} instr</span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3">
        {/* Active tab info */}
        {activeTab && (
          <>
            <span className="text-[10px]" style={{ color: 'var(--ide-text-dim)' }}>
              Ln {activeTab.cursorLine}, Col {activeTab.cursorColumn}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--ide-text-dim)' }}>
              UTF-8
            </span>
          </>
        )}

        {/* Language */}
        <span className="text-[10px]" style={{ color: 'var(--ide-accent)' }}>
          {LANGUAGE_NAMES[language] || language}
        </span>

        {/* Connection status */}
        <div className="flex items-center gap-1">
          {isConnected ? (
            <>
              <Wifi className="h-3 w-3" style={{ color: 'var(--ide-success)' }} />
              <span className="text-[10px]" style={{ color: 'var(--ide-success)' }}>Connected</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3" style={{ color: 'var(--ide-error)' }} />
              <span className="text-[10px]" style={{ color: 'var(--ide-error)' }}>Disconnected</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
