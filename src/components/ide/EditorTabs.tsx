'use client';

import React from 'react';
import { useIDEStore } from '@/store/useIDEStore';
import { X, FileCode } from 'lucide-react';

const LANGUAGE_COLORS: Record<string, string> = {
  python: '#89b4fa',
  c: '#a6e3a1',
  cpp: '#74c7ec',
  java: '#f9e2af',
  javascript: '#f9e2af',
};

export function EditorTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useIDEStore();

  if (tabs.length === 0) return null;

  return (
    <div
      className="flex border-b overflow-x-auto custom-scrollbar-x"
      style={{ backgroundColor: 'var(--ide-bg-tab-inactive)', borderColor: 'var(--ide-border)' }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const color = LANGUAGE_COLORS[tab.language] || '#6c7086';

        return (
          <div
            key={tab.id}
            className={`
              ide-tab
              flex items-center gap-1.5 px-3 py-1.5 border-r border-t-2 select-none min-w-0 max-w-[180px] group
              ${isActive ? 'border-t-transparent' : 'border-t-transparent'}
            `}
            style={{
              backgroundColor: isActive ? 'var(--ide-bg-tab-active)' : 'var(--ide-bg-tab-inactive)',
              color: isActive ? 'var(--ide-text-primary)' : 'var(--ide-text-dim)',
              borderRightColor: 'var(--ide-border)',
              borderTopColor: isActive ? 'var(--ide-accent)' : 'transparent',
            }}
            onClick={() => setActiveTab(tab.id)}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = 'var(--ide-bg-tab-active)';
                e.currentTarget.style.color = 'var(--ide-text-secondary)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = 'var(--ide-bg-tab-inactive)';
                e.currentTarget.style.color = 'var(--ide-text-dim)';
              }
            }}
          >
            <FileCode className="h-3.5 w-3.5 shrink-0" style={{ color }} />
            <span className="truncate text-xs">{tab.name}</span>
            {tab.isDirty && (
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: 'var(--ide-warning)' }} />
            )}
            <button
              className={`
                ide-tab-close
                shrink-0 ml-1 rounded-sm p-0.5
                opacity-0 group-hover:opacity-100
                ${isActive ? 'opacity-100' : ''}
              `}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
