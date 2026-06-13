'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useIDEStore, type FileItem, type FolderItem } from '@/store/useIDEStore';
import { filesAPI, foldersAPI, LANGUAGE_EXTENSIONS, LANGUAGE_NAMES, CODE_TEMPLATES } from '@/lib/api';
import {
  ChevronRight,
  ChevronDown,
  FileCode,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  Trash2,
  Pencil,
  RefreshCw,
  FilePlus,
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

// Language icons mapping
const LANGUAGE_COLORS: Record<string, string> = {
  python: '#89b4fa',
  c: '#a6e3a1',
  cpp: '#74c7ec',
  java: '#f9e2af',
  javascript: '#f9e2af',
};

function FileIcon({ language }: { language: string }) {
  const color = LANGUAGE_COLORS[language] || 'var(--ide-text-dim)';
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
    openAuthModal,
    folders,
    setFolders,
    addFolder,
    removeFolder,
    updateFolder,
    toggleFolderExpanded,
    closeTab,
    updateTabContent,
    settings,
    updateSettings,
    theme,
  } = useIDEStore();

  const [isExpanded, setIsExpanded] = useState(true);
  const [isNewFileDialog, setIsNewFileDialog] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileLanguage, setNewFileLanguage] = useState('python');
  const [newFileFolderId, setNewFileFolderId] = useState<string | null>(null);
  const [isNewFolderDialog, setIsNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [isRenameDialog, setIsRenameDialog] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string; type: 'file' | 'folder' } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<{ id: string; name: string; type: 'file' | 'folder' } | null>(null);

  // Load remote files and folders
  const loadData = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    try {
      const [filesData, foldersData] = await Promise.all([
        filesAPI.list(),
        foldersAPI.list(),
      ]);
      setRemoteFiles(filesData.files);
      setFolders(foldersData.folders.map((f: any) => ({
        ...f,
        isExpanded: folders.find(existing => existing.id === f.id)?.isExpanded ?? true,
      })));
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, setRemoteFiles, setFolders]);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated, loadData]);

  const handleOpenRemoteFile = (file: FileItem) => {
    const existing = tabs.find(t => t.name === file.name && t.isRemote);
    if (existing) {
      setActiveTab(existing.id);
    } else {
      addTab(file.name, file.language, file.content, file.id, true);
    }
  };

  const handleNewFile = (folderId: string | null = null) => {
    setNewFileName('');
    setNewFileLanguage('python');
    setNewFileFolderId(folderId);
    setIsNewFileDialog(true);
  };

  const handleCreateFile = async () => {
    try {
      const ext = LANGUAGE_EXTENSIONS[newFileLanguage] || '.txt';
      const name = newFileName.includes('.') ? newFileName : newFileName + ext;
      // New files are EMPTY — VS Code behavior
      const content = '';

      if (isAuthenticated) {
        // Create as remote file (saved to server)
        const data = await filesAPI.create(name, newFileLanguage, content, newFileFolderId);
        addTab(name, newFileLanguage, content, data.file.id, true);
        setRemoteFiles([...remoteFiles, data.file]);
      } else {
        // Create as local-only tab (not persisted)
        addTab(name, newFileLanguage, content);
      }
      setIsNewFileDialog(false);
    } catch (err: any) {
      console.error('Failed to create file:', err.message);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    try {
      if (isAuthenticated) {
        await filesAPI.delete(fileId);
      }
      removeRemoteFile(fileId);
      // Also close the tab if it's open
      const tab = tabs.find(t => t.id === fileId);
      if (tab) {
        closeTab(fileId);
      }
    } catch (err) {
      console.error('Failed to delete file:', err);
    }
  };

  const handleRenameFile = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      if (renameTarget.type === 'file') {
        if (isAuthenticated) {
          const data = await filesAPI.update(renameTarget.id, { name: renameValue.trim() });
          updateRemoteFile(renameTarget.id, { name: data.file.name });
        } else {
          updateRemoteFile(renameTarget.id, { name: renameValue.trim() });
        }
        // Also update the tab name
        const tab = tabs.find(t => t.id === renameTarget.id);
        if (tab) {
          const { setLanguage: _sl } = useIDEStore.getState();
          // Update tab name directly via store
          useIDEStore.setState(state => ({
            tabs: state.tabs.map(t =>
              t.id === renameTarget.id ? { ...t, name: renameValue.trim() } : t
            ),
          }));
        }
      } else {
        if (isAuthenticated) {
          const data = await foldersAPI.update(renameTarget.id, { name: renameValue.trim() });
          updateFolder(renameTarget.id, { name: data.folder.name });
        } else {
          updateFolder(renameTarget.id, { name: renameValue.trim() });
        }
      }
      setIsRenameDialog(false);
      setRenameTarget(null);
    } catch (err) {
      console.error('Failed to rename:', err);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    if (!isAuthenticated) {
      const localFolder: FolderItem = {
        id: `local_folder_${Date.now()}`,
        name: newFolderName.trim(),
        parentId: newFolderParentId,
        isExpanded: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      addFolder(localFolder);
      setIsNewFolderDialog(false);
      setNewFolderName('');
      return;
    }
    try {
      const data = await foldersAPI.create(newFolderName.trim(), newFolderParentId);
      addFolder({ ...data.folder, isExpanded: true });
      setIsNewFolderDialog(false);
      setNewFolderName('');
    } catch (err: any) {
      console.error('Failed to create folder:', err.message);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    try {
      if (isAuthenticated) {
        await foldersAPI.delete(folderId);
      }
      removeFolder(folderId);
      // Also remove files that were in this folder and close their tabs
      const filesInFolder = remoteFiles.filter(f => f.folderId === folderId);
      for (const file of filesInFolder) {
        removeRemoteFile(file.id);
        const tab = tabs.find(t => t.id === file.id);
        if (tab) closeTab(file.id);
      }
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  };

  const handleInsertTemplate = (tabId: string, language: string) => {
    const template = CODE_TEMPLATES[language];
    if (template) {
      updateTabContent(tabId, template);
    }
  };

  // Build the folder tree recursively
  const renderFolderTree = (parentId: string | null, depth: number = 0) => {
    const childFolders = folders
      .filter(f => f.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));

    const filesInFolder = remoteFiles
      .filter(f => f.folderId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));

    return (
      <>
        {childFolders.map(folder => (
          <div key={folder.id}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  role="button"
                  tabIndex={0}
                  className={`
                    ide-file-item
                    w-full flex items-center gap-1 text-sm group
                  `}
                  style={{ paddingLeft: `${12 + depth * 16}px`, paddingTop: '4px', paddingBottom: '4px' }}
                  onClick={() => toggleFolderExpanded(folder.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleFolderExpanded(folder.id); }}
                >
                  {folder.isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--ide-text-muted)' }} />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--ide-text-muted)' }} />
                  )}
                  {folder.isExpanded ? (
                    <FolderOpen className="h-4 w-4 shrink-0" style={{ color: 'var(--ide-accent)' }} />
                  ) : (
                    <Folder className="h-4 w-4 shrink-0" style={{ color: 'var(--ide-accent)' }} />
                  )}
                  <span className="truncate flex-1 text-left text-xs" style={{ color: 'var(--ide-text-secondary)' }}>
                    {folder.name}
                  </span>
                  {/* Folder action buttons — visible on hover */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ide-icon-btn h-5 w-5"
                      style={{ color: 'var(--ide-text-dim)' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNewFile(folder.id);
                      }}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ide-icon-btn h-5 w-5"
                      style={{ color: 'var(--ide-text-dim)' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setNewFolderParentId(folder.id);
                        setNewFolderName('');
                        setIsNewFolderDialog(true);
                      }}
                    >
                      <FolderPlus className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ide-icon-btn h-5 w-5"
                      style={{ color: 'var(--ide-text-dim)' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenameTarget({ id: folder.id, name: folder.name, type: 'folder' });
                        setRenameValue(folder.name);
                        setIsRenameDialog(true);
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ide-icon-btn h-5 w-5"
                      style={{ color: 'var(--ide-text-dim)' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteTarget({ id: folder.id, name: folder.name, type: 'folder' });
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--ide-error)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--ide-text-dim)'}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent
                className="border shadow-lg"
                style={{ backgroundColor: 'var(--ide-bg-surface)', borderColor: 'var(--ide-border)' }}
              >
                <ContextMenuItem
                  className="text-xs cursor-pointer"
                  style={{ color: 'var(--ide-text-primary)' }}
                  onClick={() => handleNewFile(folder.id)}
                >
                  <FilePlus className="h-3.5 w-3.5 mr-2" />
                  New File
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-xs cursor-pointer"
                  style={{ color: 'var(--ide-text-primary)' }}
                  onClick={() => {
                    setNewFolderParentId(folder.id);
                    setNewFolderName('');
                    setIsNewFolderDialog(true);
                  }}
                >
                  <FolderPlus className="h-3.5 w-3.5 mr-2" />
                  New Folder
                </ContextMenuItem>
                <ContextMenuSeparator style={{ backgroundColor: 'var(--ide-border)' }} />
                <ContextMenuItem
                  className="text-xs cursor-pointer"
                  style={{ color: 'var(--ide-text-primary)' }}
                  onClick={() => {
                    setRenameTarget({ id: folder.id, name: folder.name, type: 'folder' });
                    setRenameValue(folder.name);
                    setIsRenameDialog(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-2" />
                  Rename
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-xs cursor-pointer"
                  style={{ color: 'var(--ide-error)' }}
                  onClick={() => setConfirmDeleteTarget({ id: folder.id, name: folder.name, type: 'folder' })}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            {/* Render children if expanded */}
            {folder.isExpanded && renderFolderTree(folder.id, depth + 1)}
          </div>
        ))}
        {/* Files in this folder */}
        {filesInFolder.map(file => (
          <ContextMenu key={file.id}>
            <ContextMenuTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleOpenRemoteFile(file)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleOpenRemoteFile(file); }}
                className={`
                  ide-file-item
                  w-full flex items-center gap-2 text-sm group
                  ${activeTabId === file.id ? 'bg-[var(--ide-bg-hover)] text-[var(--ide-text-primary)]' : 'text-[var(--ide-text-secondary)]'}
                `}
                style={{ paddingLeft: `${28 + depth * 16}px`, paddingTop: '4px', paddingBottom: '4px' }}
              >
                <FileIcon language={file.language} />
                <span className="truncate flex-1 text-left text-xs">{file.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ide-icon-btn h-5 w-5 opacity-0 group-hover:opacity-100"
                  style={{ color: 'var(--ide-text-dim)' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteTarget({ id: file.id, name: file.name, type: 'file' });
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--ide-error)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--ide-text-dim)'}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent
              className="border shadow-lg"
              style={{ backgroundColor: 'var(--ide-bg-surface)', borderColor: 'var(--ide-border)' }}
            >
              <ContextMenuItem
                className="text-xs cursor-pointer"
                style={{ color: 'var(--ide-text-primary)' }}
                onClick={() => {
                  setRenameTarget({ id: file.id, name: file.name, type: 'file' });
                  setRenameValue(file.name);
                  setIsRenameDialog(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Rename
              </ContextMenuItem>
              <ContextMenuSeparator style={{ backgroundColor: 'var(--ide-border)' }} />
              <ContextMenuItem
                className="text-xs cursor-pointer"
                style={{ color: 'var(--ide-error)' }}
                onClick={() => setConfirmDeleteTarget({ id: file.id, name: file.name, type: 'file' })}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </>
    );
  };

  if (!isSidebarOpen) return null;

  return (
    <div
      className="w-64 border-r flex flex-col overflow-hidden"
      style={{
        backgroundColor: 'var(--ide-bg-surface)',
        borderColor: 'var(--ide-border)',
      }}
    >
      {/* Sidebar Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--ide-border)' }}>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ide-text-muted)' }}>
          {sidebarView === 'search' ? 'Search' : sidebarView === 'settings' ? 'Settings' : 'Explorer'}
        </span>
        <div className="flex items-center gap-1">
          <TooltipProvider>
            {sidebarView === 'files' && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ide-icon-btn h-6 w-6"
                      style={{ color: 'var(--ide-text-dim)' }}
                      onClick={() => handleNewFile(null)}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--ide-text-primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--ide-text-dim)'}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                    New File
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ide-icon-btn h-6 w-6"
                      style={{ color: 'var(--ide-text-dim)' }}
                      onClick={() => {
                        setNewFolderParentId(null);
                        setNewFolderName('');
                        setIsNewFolderDialog(true);
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--ide-text-primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--ide-text-dim)'}
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                    New Folder
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ide-icon-btn h-6 w-6"
                      style={{ color: 'var(--ide-text-dim)' }}
                      onClick={loadData}
                      disabled={isLoading}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                    Refresh
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </TooltipProvider>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {sidebarView === 'files' && (
          <>
            <div>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="ide-file-item w-full flex items-center gap-1 px-2 py-1.5 text-xs font-medium"
                style={{ color: 'var(--ide-text-muted)' }}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <FolderOpen className="h-3.5 w-3.5 mr-1" style={{ color: 'var(--ide-accent)' }} />
                MY PROJECT
              </button>
              {isExpanded && (
                <div>
                  {isAuthenticated ? (
                    // Authenticated: show server-side file tree with folders
                    folders.length === 0 && remoteFiles.length === 0 ? (
                      <div className="px-4 py-3 text-xs" style={{ color: 'var(--ide-text-faint)' }}>
                        No files yet. Use + to create one!
                      </div>
                    ) : (
                      renderFolderTree(null)
                    )
                  ) : (
                    // Not authenticated: show local folders + local tabs in tree
                    <>
                      {/* Show local folders */}
                      {folders.length > 0 && renderFolderTree(null)}
                      {/* Show local files not in any folder */}
                      {tabs.filter(t => !t.isRemote).map(tab => (
                        <ContextMenu key={tab.id}>
                          <ContextMenuTrigger asChild>
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => setActiveTab(tab.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter') setActiveTab(tab.id); }}
                              className={`
                                ide-file-item
                                w-full flex items-center gap-2 text-sm group
                                ${activeTabId === tab.id ? 'bg-[var(--ide-bg-hover)] text-[var(--ide-text-primary)]' : 'text-[var(--ide-text-secondary)]'}
                              `}
                              style={{ paddingLeft: '28px', paddingTop: '4px', paddingBottom: '4px' }}
                            >
                              <FileIcon language={tab.language} />
                              <span className="truncate flex-1 text-left text-xs">{tab.name}</span>
                              {tab.isDirty && (
                                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: 'var(--ide-warning)' }} />
                              )}
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent
                            className="border shadow-lg"
                            style={{ backgroundColor: 'var(--ide-bg-surface)', borderColor: 'var(--ide-border)' }}
                          >
                            {tab.content === '' && CODE_TEMPLATES[tab.language] && (
                              <ContextMenuItem
                                className="text-xs cursor-pointer"
                                style={{ color: 'var(--ide-text-primary)' }}
                                onClick={() => handleInsertTemplate(tab.id, tab.language)}
                              >
                                <FilePlus className="h-3.5 w-3.5 mr-2" />
                                Insert Template
                              </ContextMenuItem>
                            )}
                            <ContextMenuItem
                              className="text-xs cursor-pointer"
                              style={{ color: 'var(--ide-text-primary)' }}
                              onClick={() => {
                                setRenameTarget({ id: tab.id, name: tab.name, type: 'file' });
                                setRenameValue(tab.name);
                                setIsRenameDialog(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5 mr-2" />
                              Rename
                            </ContextMenuItem>
                            <ContextMenuSeparator style={{ backgroundColor: 'var(--ide-border)' }} />
                            <ContextMenuItem
                              className="text-xs cursor-pointer"
                              style={{ color: 'var(--ide-error)' }}
                              onClick={() => closeTab(tab.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              Delete
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ))}
                      {tabs.filter(t => !t.isRemote).length === 0 && folders.length === 0 && (
                        <div className="px-4 py-3 text-xs" style={{ color: 'var(--ide-text-faint)' }}>
                          No files open. Use + to create one!
                        </div>
                      )}
                      <div className="px-4 py-3 text-center">
                        <p className="text-[10px] mb-2" style={{ color: 'var(--ide-text-faint)' }}>
                          Sign in to save files & use folders
                        </p>
                        <Button
                          size="sm"
                          className="ide-btn-hover text-[10px] h-6"
                          style={{ backgroundColor: 'var(--ide-accent)', color: 'var(--ide-bg-base)' }}
                          onClick={() => openAuthModal('login')}
                        >
                          Sign In
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {sidebarView === 'search' && (
          <div className="p-3">
            <Input
              placeholder="Search files..."
              style={{
                backgroundColor: 'var(--ide-bg-overlay)',
                borderColor: 'var(--ide-border)',
                color: 'var(--ide-text-primary)',
              }}
              className="text-xs placeholder:text-[var(--ide-text-faint)]"
            />
            <p className="text-xs mt-3" style={{ color: 'var(--ide-text-faint)' }}>Search functionality coming soon</p>
          </div>
        )}

        {sidebarView === 'settings' && (
          <div className="p-3 space-y-4 overflow-y-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 100px)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ide-text-muted)' }}>Editor</p>
            
            {/* Font Size */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Font Size</label>
                <span className="text-xs font-mono" style={{ color: 'var(--ide-accent)' }}>{settings.fontSize}px</span>
              </div>
              <Slider
                value={[settings.fontSize]}
                onValueChange={([v]) => updateSettings({ fontSize: v })}
                min={10}
                max={24}
                step={1}
                className="w-full"
              />
            </div>

            {/* Tab Size */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Tab Size</label>
                <span className="text-xs font-mono" style={{ color: 'var(--ide-accent)' }}>{settings.tabSize}</span>
              </div>
              <Slider
                value={[settings.tabSize]}
                onValueChange={([v]) => updateSettings({ tabSize: v })}
                min={2}
                max={8}
                step={2}
                className="w-full"
              />
            </div>

            {/* Line Height */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Line Height</label>
                <span className="text-xs font-mono" style={{ color: 'var(--ide-accent)' }}>{settings.lineHeight}px</span>
              </div>
              <Slider
                value={[settings.lineHeight]}
                onValueChange={([v]) => updateSettings({ lineHeight: v })}
                min={16}
                max={32}
                step={1}
                className="w-full"
              />
            </div>

            {/* Word Wrap */}
            <div className="flex items-center justify-between">
              <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Word Wrap</label>
              <Select value={settings.wordWrap} onValueChange={(v: any) => updateSettings({ wordWrap: v })}>
                <SelectTrigger className="w-24 h-6 text-xs" style={{ backgroundColor: 'var(--ide-bg-overlay)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)' }}>
                  <SelectItem value="on" style={{ color: 'var(--ide-text-primary)' }}>On</SelectItem>
                  <SelectItem value="off" style={{ color: 'var(--ide-text-primary)' }}>Off</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Minimap */}
            <div className="flex items-center justify-between">
              <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Minimap</label>
              <Switch
                checked={settings.minimap}
                onCheckedChange={(v) => updateSettings({ minimap: v })}
              />
            </div>

            {/* Auto Save */}
            <div className="flex items-center justify-between">
              <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Auto Save</label>
              <Switch
                checked={settings.autoSave}
                onCheckedChange={(v) => updateSettings({ autoSave: v })}
              />
            </div>

            {/* Render Whitespace */}
            <div className="flex items-center justify-between">
              <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Render Whitespace</label>
              <Select value={settings.renderWhitespace} onValueChange={(v: any) => updateSettings({ renderWhitespace: v })}>
                <SelectTrigger className="w-24 h-6 text-xs" style={{ backgroundColor: 'var(--ide-bg-overlay)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)' }}>
                  <SelectItem value="none" style={{ color: 'var(--ide-text-primary)' }}>None</SelectItem>
                  <SelectItem value="selection" style={{ color: 'var(--ide-text-primary)' }}>Selection</SelectItem>
                  <SelectItem value="trailing" style={{ color: 'var(--ide-text-primary)' }}>Trailing</SelectItem>
                  <SelectItem value="all" style={{ color: 'var(--ide-text-primary)' }}>All</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Bracket Pair Colorization */}
            <div className="flex items-center justify-between">
              <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Bracket Colorization</label>
              <Switch
                checked={settings.bracketPairColorization}
                onCheckedChange={(v) => updateSettings({ bracketPairColorization: v })}
              />
            </div>

            {/* Cursor Blinking */}
            <div className="flex items-center justify-between">
              <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Cursor Blinking</label>
              <Select value={settings.cursorBlinking} onValueChange={(v: any) => updateSettings({ cursorBlinking: v })}>
                <SelectTrigger className="w-24 h-6 text-xs" style={{ backgroundColor: 'var(--ide-bg-overlay)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)' }}>
                  <SelectItem value="blink" style={{ color: 'var(--ide-text-primary)' }}>Blink</SelectItem>
                  <SelectItem value="smooth" style={{ color: 'var(--ide-text-primary)' }}>Smooth</SelectItem>
                  <SelectItem value="phase" style={{ color: 'var(--ide-text-primary)' }}>Phase</SelectItem>
                  <SelectItem value="expand" style={{ color: 'var(--ide-text-primary)' }}>Expand</SelectItem>
                  <SelectItem value="solid" style={{ color: 'var(--ide-text-primary)' }}>Solid</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* ─── Terminal Section ─── */}
            <div className="pt-2">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--ide-text-muted)' }}>Terminal</p>

              {/* Terminal Font Size */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Font Size</label>
                  <span className="text-xs font-mono" style={{ color: 'var(--ide-accent)' }}>{settings.terminalFontSize}px</span>
                </div>
                <Slider
                  value={[settings.terminalFontSize]}
                  onValueChange={([v]) => updateSettings({ terminalFontSize: v })}
                  min={10}
                  max={24}
                  step={1}
                  className="w-full"
                />
              </div>

              {/* Terminal Cursor Blink */}
              <div className="flex items-center justify-between mt-3">
                <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Cursor Blink</label>
                <Switch
                  checked={settings.terminalCursorBlink}
                  onCheckedChange={(v) => updateSettings({ terminalCursorBlink: v })}
                />
              </div>

              {/* Clear on Run */}
              <div className="flex items-center justify-between mt-3">
                <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Clear on Run</label>
                <Switch
                  checked={settings.terminalClearOnRun}
                  onCheckedChange={(v) => updateSettings({ terminalClearOnRun: v })}
                />
              </div>
            </div>

            {/* ─── Appearance Section ─── */}
            <div className="pt-2">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--ide-text-muted)' }}>Appearance</p>

              {/* Theme */}
              <div className="flex items-center justify-between">
                <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Theme</label>
                <Select value={settings.theme} onValueChange={(v: 'dark' | 'light') => updateSettings({ theme: v })}>
                  <SelectTrigger className="w-24 h-6 text-xs" style={{ backgroundColor: 'var(--ide-bg-overlay)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)' }}>
                    <SelectItem value="dark" style={{ color: 'var(--ide-text-primary)' }}>Dark</SelectItem>
                    <SelectItem value="light" style={{ color: 'var(--ide-text-primary)' }}>Light</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* New File Dialog */}
      <Dialog open={isNewFileDialog} onOpenChange={setIsNewFileDialog}>
        <DialogContent className="sm:max-w-[400px]" style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
          <DialogHeader>
            <DialogTitle>Create New File</DialogTitle>
            <DialogDescription style={{ color: 'var(--ide-text-muted)' }}>
              Choose a name and language for your new file
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>File Name</label>
              <Input
                placeholder="main"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                style={{
                  backgroundColor: 'var(--ide-bg-overlay)',
                  borderColor: 'var(--ide-border)',
                  color: 'var(--ide-text-primary)',
                }}
                className="placeholder:text-[var(--ide-text-faint)]"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFile()}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Language</label>
              <Select value={newFileLanguage} onValueChange={setNewFileLanguage}>
                <SelectTrigger style={{ backgroundColor: 'var(--ide-bg-overlay)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)' }}>
                  {Object.entries(LANGUAGE_NAMES).map(([key, name]) => (
                    <SelectItem key={key} value={key} style={{ color: 'var(--ide-text-primary)' }}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Folder selector */}
            {folders.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Folder (optional)</label>
                <Select value={newFileFolderId || '__root__'} onValueChange={(v) => setNewFileFolderId(v === '__root__' ? null : v)}>
                  <SelectTrigger style={{ backgroundColor: 'var(--ide-bg-overlay)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)' }}>
                    <SelectItem value="__root__" style={{ color: 'var(--ide-text-primary)' }}>Root</SelectItem>
                    {folders.map(f => (
                      <SelectItem key={f.id} value={f.id} style={{ color: 'var(--ide-text-primary)' }}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              onClick={handleCreateFile}
              className="ide-btn-hover w-full font-medium"
              style={{ backgroundColor: 'var(--ide-success)', color: 'var(--ide-bg-base)' }}
              disabled={!newFileName.trim()}
            >
              Create File
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Folder Dialog */}
      <Dialog open={isNewFolderDialog} onOpenChange={setIsNewFolderDialog}>
        <DialogContent className="sm:max-w-[400px]" style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription style={{ color: 'var(--ide-text-muted)' }}>
              Enter a name for the new folder
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <label className="text-xs" style={{ color: 'var(--ide-text-secondary)' }}>Folder Name</label>
              <Input
                placeholder="src"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                style={{
                  backgroundColor: 'var(--ide-bg-overlay)',
                  borderColor: 'var(--ide-border)',
                  color: 'var(--ide-text-primary)',
                }}
                className="placeholder:text-[var(--ide-text-faint)]"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                autoFocus
              />
            </div>
            <Button
              onClick={handleCreateFolder}
              className="ide-btn-hover w-full font-medium"
              style={{ backgroundColor: 'var(--ide-accent)', color: 'var(--ide-bg-base)' }}
              disabled={!newFolderName.trim()}
            >
              Create Folder
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={isRenameDialog} onOpenChange={setIsRenameDialog}>
        <DialogContent className="sm:max-w-[400px]" style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
          <DialogHeader>
            <DialogTitle>Rename {renameTarget?.type === 'folder' ? 'Folder' : 'File'}</DialogTitle>
            <DialogDescription style={{ color: 'var(--ide-text-muted)' }}>
              Enter the new name
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              style={{
                backgroundColor: 'var(--ide-bg-overlay)',
                borderColor: 'var(--ide-border)',
                color: 'var(--ide-text-primary)',
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleRenameFile()}
              autoFocus
            />
            <Button
              onClick={handleRenameFile}
              className="ide-btn-hover w-full font-medium"
              style={{ backgroundColor: 'var(--ide-accent)', color: 'var(--ide-bg-base)' }}
              disabled={!renameValue.trim()}
            >
              Rename
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Dialog */}
      <Dialog open={!!confirmDeleteTarget} onOpenChange={(open) => { if (!open) setConfirmDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-[400px]" style={{ backgroundColor: 'var(--ide-bg-base)', borderColor: 'var(--ide-border)', color: 'var(--ide-text-primary)' }}>
          <DialogHeader>
            <DialogTitle>Delete {confirmDeleteTarget?.type === 'folder' ? 'Folder' : 'File'}</DialogTitle>
            <DialogDescription style={{ color: 'var(--ide-text-muted)' }}>
              Are you sure you want to delete &quot;{confirmDeleteTarget?.name}&quot;?
              {confirmDeleteTarget?.type === 'folder' && ' This will also delete all files inside this folder.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmDeleteTarget(null)}
              style={{ color: 'var(--ide-text-secondary)' }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (confirmDeleteTarget) {
                  if (confirmDeleteTarget.type === 'file') {
                    handleDeleteFile(confirmDeleteTarget.id);
                  } else {
                    handleDeleteFolder(confirmDeleteTarget.id);
                  }
                  setConfirmDeleteTarget(null);
                }
              }}
              style={{ backgroundColor: 'var(--ide-error)', color: 'white' }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
