'use client';

import React, { useEffect, useCallback, useRef } from 'react';
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
import { filesAPI, LANGUAGE_EXTENSIONS } from '@/lib/api';
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
    settings,
  } = useIDEStore();

  const { isConnected } = useSocket();
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-connect WebSocket on mount so terminal service is ready when Run is clicked
  useEffect(() => {
    connectWS();
    return () => {
      disconnectWS();
    };
  }, []);

  // Do NOT auto-create a default tab with boilerplate.
  // The workspace state is persisted via localStorage, so on refresh,
  // tabs are restored. Only if there are no tabs, show the empty state.
  // (No auto-creation of main.py with DEFAULT_CODE)

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

  // Auto-save functionality
  useEffect(() => {
    if (!settings.autoSave || !isAuthenticated) return;

    // Clear previous timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Check if there are dirty tabs
    const dirtyTabs = tabs.filter(t => t.isDirty);
    if (dirtyTabs.length > 0) {
      autoSaveTimerRef.current = setTimeout(async () => {
        const state = useIDEStore.getState();
        for (const tab of state.tabs.filter(t => t.isDirty)) {
          try {
            if (tab.isRemote) {
              await filesAPI.update(tab.id, {
                content: tab.content,
                name: tab.name,
                language: tab.language,
              });
            } else {
              const data = await filesAPI.create(tab.name, tab.language, tab.content);
              state.setRemoteFiles([...state.remoteFiles, data.file]);
            }
            state.markTabClean(tab.id);
          } catch (err) {
            console.error('Auto-save failed:', err);
          }
        }
      }, settings.autoSaveDelay);
    }

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [tabs, settings.autoSave, settings.autoSaveDelay, isAuthenticated]);

  // beforeunload — warn about unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const state = useIDEStore.getState();
      const hasDirtyTabs = state.tabs.some(t => t.isDirty);
      if (hasDirtyTabs) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
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
        // Create empty file
        addTab(`untitled${ext}`, language);
      }

      if (isCtrlOrCmd && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) {
          const { closeTab, tabs: currentTabs } = useIDEStore.getState();
          const tab = currentTabs.find(t => t.id === activeTabId);
          if (tab?.isDirty) {
            // The unsaved changes warning is handled in EditorTabs
            // For Ctrl+W, we'll just close it since EditorTabs has the confirm dialog
            closeTab(activeTabId);
          } else {
            closeTab(activeTabId);
          }
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
  }, [isTerminalOpen, activeTabId, isExecuting, handleSave, setTerminalOpen]);

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
