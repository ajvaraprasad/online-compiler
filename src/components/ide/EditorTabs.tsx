'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useIDEStore } from '@/store/useIDEStore';
import { X, FileCode } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const LANGUAGE_COLORS: Record<string, string> = {
  python: '#89b4fa',
  c: '#a6e3a1',
  cpp: '#74c7ec',
  java: '#f9e2af',
  javascript: '#f9e2af',
};

export function EditorTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab, closeOtherTabs, closeAllTabs, moveTab } = useIDEStore();
  const [confirmClose, setConfirmClose] = useState<{ tabId: string; tabName: string } | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const handleCloseTab = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab?.isDirty) {
      setConfirmClose({ tabId, tabName: tab.name });
    } else {
      closeTab(tabId);
    }
  }, [tabs, closeTab]);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
    // Set a transparent drag image
    const el = e.currentTarget as HTMLElement;
    e.dataTransfer.setDragImage(el, 0, 0);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndexRef.current !== null && dragIndexRef.current !== index) {
      moveTab(dragIndexRef.current, index);
    }
    dragIndexRef.current = null;
  }, [moveTab]);

  const handleDragEnd = useCallback(() => {
    dragIndexRef.current = null;
  }, []);

  if (tabs.length === 0) return null;

  return (
    <>
      <div
        className="flex border-b overflow-x-auto custom-scrollbar-x"
        style={{ backgroundColor: 'var(--ide-bg-tab-inactive)', borderColor: 'var(--ide-border)' }}
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const color = LANGUAGE_COLORS[tab.language] || '#6c7086';

          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  className={`
                    ide-tab
                    flex items-center gap-1.5 px-3 py-1.5 border-r border-t-2 select-none min-w-0 max-w-[180px] group cursor-pointer
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
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                >
                  <FileCode className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                  <span className="truncate text-xs">
                    {tab.isDirty && (
                      <span style={{ color: 'var(--ide-warning)' }}>&#9679; </span>
                    )}
                    {tab.name}
                  </span>
                  <button
                    className={`
                      ide-tab-close
                      shrink-0 ml-1 rounded-sm p-0.5
                      opacity-0 group-hover:opacity-100
                      ${isActive ? 'opacity-100' : ''}
                    `}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(tab.id);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent
                className="border shadow-lg"
                style={{ backgroundColor: 'var(--ide-bg-surface)', borderColor: 'var(--ide-border)' }}
              >
                <ContextMenuItem
                  className="text-xs cursor-pointer"
                  style={{ color: 'var(--ide-text-primary)' }}
                  onClick={() => closeTab(tab.id)}
                >
                  Close
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-xs cursor-pointer"
                  style={{ color: 'var(--ide-text-primary)' }}
                  onClick={() => closeOtherTabs(tab.id)}
                >
                  Close Others
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-xs cursor-pointer"
                  style={{ color: 'var(--ide-text-primary)' }}
                  onClick={closeAllTabs}
                >
                  Close All
                </ContextMenuItem>
                <ContextMenuSeparator style={{ backgroundColor: 'var(--ide-border)' }} />
                {tabs.some(t => t.isDirty && t.id !== tab.id) && (
                  <ContextMenuItem
                    className="text-xs cursor-pointer"
                    style={{ color: 'var(--ide-text-primary)' }}
                    onClick={() => {
                      tabs.filter(t => t.id !== tab.id && !t.isDirty).forEach(t => closeTab(t.id));
                    }}
                  >
                    Close Saved
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>

      {/* Unsaved Changes Confirmation Dialog */}
      <Dialog open={!!confirmClose} onOpenChange={(open) => { if (!open) setConfirmClose(null); }}>
        <DialogContent className="sm:max-w-[400px]" style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
          <DialogHeader>
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription style={{ color: 'var(--ide-text-muted)' }}>
              &quot;{confirmClose?.tabName}&quot; has unsaved changes. Do you want to close it anyway?
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmClose(null)}
              style={{ color: 'var(--ide-text-secondary)' }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (confirmClose) {
                  closeTab(confirmClose.tabId);
                  setConfirmClose(null);
                }
              }}
              style={{ backgroundColor: 'var(--ide-error)', color: 'white' }}
            >
              Don&apos;t Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
