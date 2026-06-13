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
    <div className="flex bg-[#11111b] border-b border-[#313244] overflow-x-auto custom-scrollbar-x">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const color = LANGUAGE_COLORS[tab.language] || '#6c7086';

        return (
          <div
            key={tab.id}
            className={`
              ide-tab
              flex items-center gap-1.5 px-3 py-1.5 border-r border-[#313244]
              select-none min-w-0 max-w-[180px] group
              ${isActive
                ? 'bg-[#1e1e2e] text-[#cdd6f4] border-t-2 border-t-[#89b4fa]'
                : 'bg-[#181825] text-[#6c7086] hover:bg-[#1e1e2e] hover:text-[#bac2de] border-t-2 border-t-transparent'
              }
            `}
            onClick={() => setActiveTab(tab.id)}
          >
            <FileCode className="h-3.5 w-3.5 shrink-0" style={{ color }} />
            <span className="truncate text-xs">{tab.name}</span>
            {tab.isDirty && (
              <div className="w-2 h-2 rounded-full bg-[#f9e2af] shrink-0" />
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
