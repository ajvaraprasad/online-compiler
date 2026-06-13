'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useIDEStore } from '@/store/useIDEStore';
import { AIAssistant } from './AIAssistant';
import { filesAPI, LANGUAGE_EXTENSIONS, LANGUAGE_NAMES, DEFAULT_CODE } from '@/lib/api';
import {
  ChevronRight,
  ChevronDown,
  FileCode,
  Plus,
  Trash2,
  FolderOpen,
  Save,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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

// Language icons mapping
const LANGUAGE_COLORS: Record<string, string> = {
  python: '#89b4fa',
  c: '#a6e3a1',
  cpp: '#74c7ec',
  java: '#f9e2af',
  javascript: '#f9e2af',
};

function FileIcon({ language }: { language: string }) {
  const color = LANGUAGE_COLORS[language] || '#6c7086';
  return <FileCode className="h-4 w-4" style={{ color }} />;
}

export function Sidebar() {
  const {
    isSidebarOpen,
    sidebarView,
    tabs,
    activeTabId,
    addTab,
    setActiveTab,
    isAuthenticated,
    remoteFiles,
    setRemoteFiles,
    removeRemoteFile,
    updateRemoteFile,
    updateTabContent,
    markTabClean,
    openAuthModal,
  } = useIDEStore();

  const [isExpanded, setIsExpanded] = useState(true);
  const [isNewFileDialog, setIsNewFileDialog] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileLanguage, setNewFileLanguage] = useState('python');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Load remote files
  const loadRemoteFiles = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    try {
      const data = await filesAPI.list();
      setRemoteFiles(data.files);
    } catch (err) {
      console.error('Failed to load files:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, setRemoteFiles]);

  useEffect(() => {
    if (isAuthenticated) {
      loadRemoteFiles();
    }
  }, [isAuthenticated, loadRemoteFiles]);

  const handleOpenRemoteFile = (file: typeof remoteFiles[0]) => {
    const existing = tabs.find(t => t.name === file.name && t.isRemote);
    if (existing) {
      setActiveTab(existing.id);
    } else {
      addTab(file.name, file.language, file.content, file.id, true);
    }
  };

  const handleNewFile = () => {
    if (!isAuthenticated) {
      openAuthModal('signup');
      return;
    }
    setNewFileName('');
    setNewFileLanguage('python');
    setIsNewFileDialog(true);
  };

  const handleCreateFile = async () => {
    try {
      const ext = LANGUAGE_EXTENSIONS[newFileLanguage] || '.txt';
      const name = newFileName.includes('.') ? newFileName : newFileName + ext;
      const content = DEFAULT_CODE[newFileLanguage] || '';
      const data = await filesAPI.create(name, newFileLanguage, content);
      addTab(name, newFileLanguage, content, data.file.id, true);
      setRemoteFiles([...remoteFiles, data.file]);
      setIsNewFileDialog(false);
    } catch (err: any) {
      console.error('Failed to create file:', err.message);
    }
  };

  const handleDeleteFile = async (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await filesAPI.delete(fileId);
      removeRemoteFile(fileId);
    } catch (err) {
      console.error('Failed to delete file:', err);
    }
  };

  const handleSaveFile = async () => {
    const activeTab = tabs.find(t => t.id === activeTabId);
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
        // Create new remote file
        const data = await filesAPI.create(activeTab.name, activeTab.language, activeTab.content);
        // Update the tab to be remote
        updateTabContent(activeTab.id, activeTab.content);
        markTabClean(activeTab.id);
        setRemoteFiles([...remoteFiles, data.file]);
        setIsSaving(false);
        return;
      }
      markTabClean(activeTab.id);
    } catch (err) {
      console.error('Failed to save file:', err);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isSidebarOpen) return null;

  // When AI view is active, render the AIAssistant as the full sidebar content
  if (sidebarView === 'ai') {
    return (
      <div className="w-64 bg-[#181825] border-r border-[#313244] flex flex-col overflow-hidden">
        <AIAssistant />
      </div>
    );
  }

  return (
    <div className="w-64 bg-[#181825] border-r border-[#313244] flex flex-col overflow-hidden">
      {/* Sidebar Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#313244]">
        <span className="text-xs font-semibold text-[#a6adc8] uppercase tracking-wider">
          {sidebarView === 'search' ? 'Search' : sidebarView === 'settings' ? 'Settings' : 'Explorer'}
        </span>
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ide-icon-btn h-6 w-6 text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#313244]/50"
                  onClick={handleNewFile}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="bg-[#1e1e2e] border-[#313244] text-[#cdd6f4] text-xs">
                New File
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ide-icon-btn h-6 w-6 text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#313244]/50"
                  onClick={handleSaveFile}
                  disabled={isSaving}
                >
                  <Save className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="bg-[#1e1e2e] border-[#313244] text-[#cdd6f4] text-xs">
                Save File
              </TooltipContent>
            </Tooltip>
            {isAuthenticated && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ide-icon-btn h-6 w-6 text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#313244]/50"
                    onClick={loadRemoteFiles}
                    disabled={isLoading}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-[#1e1e2e] border-[#313244] text-[#cdd6f4] text-xs">
                  Refresh
                </TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {sidebarView === 'files' && (
          <>
            {/* Remote files section */}
            {isAuthenticated ? (
              <div>
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="ide-file-item w-full flex items-center gap-1 px-2 py-1.5 text-[#a6adc8] text-xs font-medium"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  <FolderOpen className="h-3.5 w-3.5 mr-1" />
                  MY FILES
                </button>
                {isExpanded && (
                  <div className="ml-2">
                    {remoteFiles.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-[#6c7086]">
                        No files yet. Create one!
                      </div>
                    ) : (
                      remoteFiles.map((file) => (
                        <div
                          key={file.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleOpenRemoteFile(file)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleOpenRemoteFile(file); }}
                          className={`
                            ide-file-item
                            w-full flex items-center gap-2 px-3 py-1.5 text-sm group
                            ${activeTabId === file.id ? 'bg-[#313244] text-[#cdd6f4]' : 'text-[#bac2de]'}
                          `}
                        >
                          <FileIcon language={file.language} />
                          <span className="truncate flex-1 text-left text-xs">{file.name}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ide-icon-btn h-5 w-5 opacity-0 group-hover:opacity-100 text-[#6c7086] hover:text-[#f38ba8]"
                            onClick={(e) => handleDeleteFile(file.id, e)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-[#6c7086] mb-3">
                  Sign in to save and manage files
                </p>
                <Button
                  size="sm"
                  className="ide-btn-hover bg-[#89b4fa] hover:bg-[#74c7ec] text-[#1e1e2e] text-xs"
                  onClick={() => openAuthModal('login')}
                >
                  Sign In
                </Button>
              </div>
            )}
          </>
        )}

        {sidebarView === 'search' && (
          <div className="p-3">
            <Input
              placeholder="Search files..."
              className="bg-[#11111b] border-[#313244] text-[#cdd6f4] placeholder:text-[#6c7086] text-xs"
            />
            <p className="text-xs text-[#6c7086] mt-3">Search functionality coming soon</p>
          </div>
        )}

        {sidebarView === 'settings' && (
          <div className="p-3 space-y-3">
            <p className="text-xs text-[#6c7086] font-medium">Settings</p>
            <div className="space-y-2">
              <p className="text-xs text-[#a6adc8]">Font Size: 14px</p>
              <p className="text-xs text-[#a6adc8]">Tab Size: 4</p>
              <p className="text-xs text-[#a6adc8]">Auto Save: On</p>
              <p className="text-xs text-[#a6adc8]">Theme: Dark</p>
            </div>
          </div>
        )}
      </div>

      {/* New File Dialog */}
      <Dialog open={isNewFileDialog} onOpenChange={setIsNewFileDialog}>
        <DialogContent className="sm:max-w-[400px] bg-[#1e1e2e] border-[#313244] text-[#cdd6f4]">
          <DialogHeader>
            <DialogTitle className="text-[#cdd6f4]">Create New File</DialogTitle>
            <DialogDescription className="text-[#a6adc8]">
              Choose a name and language for your new file
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <label className="text-xs text-[#bac2de]">File Name</label>
              <Input
                placeholder="main"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                className="bg-[#11111b] border-[#313244] text-[#cdd6f4] placeholder:text-[#6c7086]"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFile()}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#bac2de]">Language</label>
              <Select value={newFileLanguage} onValueChange={setNewFileLanguage}>
                <SelectTrigger className="bg-[#11111b] border-[#313244] text-[#cdd6f4]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1e1e2e] border-[#313244]">
                  {Object.entries(LANGUAGE_NAMES).map(([key, name]) => (
                    <SelectItem key={key} value={key} className="text-[#cdd6f4] focus:bg-[#313244] focus:text-[#cdd6f4]">
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleCreateFile}
              className="ide-btn-hover w-full bg-[#a6e3a1] hover:bg-[#94e2d5] text-[#1e1e2e] font-medium"
              disabled={!newFileName.trim()}
            >
              Create File
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
