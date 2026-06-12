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

  return (
    <div className="h-6 bg-[#181825] border-t border-[#313244] flex items-center justify-between px-3 shrink-0 select-none">
      {/* Left section */}
      <div className="flex items-center gap-3">
        {/* Git branch placeholder */}
        <div className="flex items-center gap-1 text-[#a6e3a1]">
          <GitBranch className="h-3 w-3" />
          <span className="text-[10px]">main</span>
        </div>

        {/* Error/Warning indicators */}
        <div className="flex items-center gap-2">
          {errorCount > 0 ? (
            <div
              className="flex items-center gap-1 cursor-pointer hover:opacity-80"
              onClick={() => {
                // Navigate to first error
                const firstError = diagnostics.find(d => d.severity === 'error');
                if (firstError) {
                  const { toggleProblemsPanel } = useIDEStore.getState();
                  toggleProblemsPanel();
                }
              }}
            >
              <AlertCircle className="h-3 w-3 text-[#f38ba8]" />
              <span className="text-[10px] text-[#f38ba8]">{errorCount}</span>
            </div>
          ) : null}
          {warningCount > 0 ? (
            <div
              className="flex items-center gap-1 cursor-pointer hover:opacity-80"
              onClick={() => {
                const { toggleProblemsPanel } = useIDEStore.getState();
                toggleProblemsPanel();
              }}
            >
              <AlertTriangle className="h-3 w-3 text-[#f9e2af]" />
              <span className="text-[10px] text-[#f9e2af]">{warningCount}</span>
            </div>
          ) : null}
          {errorCount === 0 && warningCount === 0 && activeTab ? (
            <div className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3 text-[#a6e3a1]" />
              <span className="text-[10px] text-[#6c7086]">No issues</span>
            </div>
          ) : null}
        </div>

        {/* Execution status with pipeline info */}
        {isExecuting && currentPhase && (
          <div className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 text-[#f9e2af] animate-spin" />
            <span className="text-[10px] text-[#f9e2af]">
              {PHASE_ICONS[currentPhase] || '⚙️'} {currentPhase.replace(/_/g, ' ')}
            </span>
          </div>
        )}

        {/* Pipeline summary when not executing but has completed */}
        {!isExecuting && completedPhases.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#6c7086]">
              {failedPhases.length > 0 ? (
                <span className="text-[#f38ba8]">✗ Pipeline failed</span>
              ) : (
                <span className="text-[#a6e3a1]">✓ Pipeline: {completedPhases.length} phases</span>
              )}
            </span>
            {metrics && (
              <>
                {typeof metrics.totalTokens === 'number' && metrics.totalTokens > 0 && (
                  <span className="text-[10px] text-[#6c7086]">{String(metrics.totalTokens)} tokens</span>
                )}
                {typeof metrics.cyclomaticComplexity === 'number' && metrics.cyclomaticComplexity > 1 && (
                  <span className="text-[10px] text-[#6c7086]">complexity: {String(metrics.cyclomaticComplexity)}</span>
                )}
                {typeof metrics.optimizationReduction === 'number' && metrics.optimizationReduction > 0 && (
                  <span className="text-[10px] text-[#a6e3a1]">-{String(metrics.optimizationReduction)} instr</span>
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
            <span className="text-[10px] text-[#6c7086]">
              Ln 1, Col 1
            </span>
            <span className="text-[10px] text-[#6c7086]">
              UTF-8
            </span>
          </>
        )}

        {/* Language */}
        <span className="text-[10px] text-[#89b4fa]">
          {LANGUAGE_NAMES[language] || language}
        </span>

        {/* Connection status */}
        <div className="flex items-center gap-1">
          {isConnected ? (
            <>
              <Wifi className="h-3 w-3 text-[#a6e3a1]" />
              <span className="text-[10px] text-[#a6e3a1]">Connected</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3 text-[#f38ba8]" />
              <span className="text-[10px] text-[#f38ba8]">Disconnected</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
