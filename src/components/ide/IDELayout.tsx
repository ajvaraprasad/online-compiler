'use client';

import React, { useEffect, useCallback } from 'react';
import { useIDEStore } from '@/store/useIDEStore';
import { ActivityBar } from './ActivityBar';
import { Sidebar } from './Sidebar';
import { Toolbar } from './Toolbar';
import { EditorTabs } from './EditorTabs';
import { CodeEditor } from './CodeEditor';
import { Terminal } from './Terminal';
import { ProblemsPanel } from './ProblemsPanel';
import { StatusBar } from './StatusBar';
import { AuthModal } from './AuthModal';
import { AIAssistant } from './AIAssistant';
import { filesAPI, LANGUAGE_EXTENSIONS, DEFAULT_CODE } from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { connectWS, disconnectWS } from '@/lib/executor-client';

export function IDELayout() {
  const {
    isTerminalOpen,
    activeTabId,
    isExecuting,
    setTerminalOpen,
    isAuthenticated,
    markTabClean,
    remoteFiles,
    setRemoteFiles,
    tabs,
    addTab,
    theme,
    isAIPanelOpen,
  } = useIDEStore();

  const { isConnected } = useSocket();

  // Pre-connect WebSocket on mount so terminal service is ready when Run is clicked
  useEffect(() => {
    connectWS();
    return () => {
      disconnectWS();
    };
  }, []);

  // Auto-create a default Python tab on first load so workspace isn't blank
  useEffect(() => {
    if (tabs.length === 0) {
      addTab('main.py', 'python', DEFAULT_CODE.python);
    }
  }, []);

  // Apply theme class to root element
  useEffect(() => {
    const root = document.querySelector('.ide-root');
    if (root) {
      if (theme === 'light') {
        root.classList.add('ide-light');
      } else {
        root.classList.remove('ide-light');
      }
    }
  }, [theme]);

  const handleSave = useCallback(async () => {
    const state = useIDEStore.getState();
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (!activeTab || !state.isAuthenticated) return;

    try {
      if (activeTab.isRemote) {
        await filesAPI.update(activeTab.id, {
          content: activeTab.content,
          name: activeTab.name,
          language: activeTab.language,
        });
      } else {
        const data = await filesAPI.create(activeTab.name, activeTab.language, activeTab.content);
        state.setRemoteFiles([...state.remoteFiles, data.file]);
      }
      state.markTabClean(activeTab.id);
    } catch (err) {
      console.error('Save failed:', err);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      if (isCtrlOrCmd && e.key === 's') {
        e.preventDefault();
        handleSave();
      }

      if (isCtrlOrCmd && e.key === '`') {
        e.preventDefault();
        setTerminalOpen(!isTerminalOpen);
      }

      if (isCtrlOrCmd && e.key === 'n') {
        e.preventDefault();
        const { addTab, language } = useIDEStore.getState();
        const ext = LANGUAGE_EXTENSIONS[language] || '.txt';
        addTab(`untitled${ext}`, language);
      }

      if (isCtrlOrCmd && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) {
          const { closeTab } = useIDEStore.getState();
          closeTab(activeTabId);
        }
      }

      if (isCtrlOrCmd && e.key === 'b') {
        e.preventDefault();
        const { toggleSidebar } = useIDEStore.getState();
        toggleSidebar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTerminalOpen, activeTabId, isExecuting, handleSave]);

  return (
    <div className="ide-root h-screen w-screen flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--ide-bg-base)' }}>
      <Toolbar />

      <div className="flex-1 flex overflow-hidden">
        <ActivityBar />
        <Sidebar />

        <div className="flex-1 flex flex-col overflow-hidden">
          <EditorTabs />

          <div className="flex-1 flex flex-col overflow-hidden">
            <CodeEditor />
            <ProblemsPanel />
            <Terminal />
          </div>
        </div>

        {/* RHS AI Assistant Panel — like VS Code Copilot */}
        {isAIPanelOpen && (
          <div
            className="w-80 border-l flex flex-col overflow-hidden shrink-0"
            style={{
              backgroundColor: 'var(--ide-bg-surface)',
              borderColor: 'var(--ide-border)',
            }}
          >
            <AIAssistant />
          </div>
        )}
      </div>

      <StatusBar isConnected={isConnected} />

      <AuthModal />
    </div>
  );
}
