'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useIDEStore, type FileItem, type FolderItem } from '@/store/useIDEStore';
import { filesAPI, foldersAPI, LANGUAGE_EXTENSIONS, LANGUAGE_NAMES, DEFAULT_CODE } from '@/lib/api';
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
    openAuthModal,
    folders,
    setFolders,
    addFolder,
    removeFolder,
    updateFolder,
    toggleFolderExpanded,
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
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string; type: 'folder' } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
      const content = DEFAULT_CODE[newFileLanguage] || '';

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

  const handleDeleteFile = async (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await filesAPI.delete(fileId);
      removeRemoteFile(fileId);
    } catch (err) {
      console.error('Failed to delete file:', err);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    if (!isAuthenticated) {
      // Create a local-only folder (not persisted to server)
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

  const handleDeleteFolder = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await foldersAPI.delete(folderId);
      removeFolder(folderId);
      // Also remove files that were in this folder
      const filesInFolder = remoteFiles.filter(f => f.folderId === folderId);
      for (const file of filesInFolder) {
        removeRemoteFile(file.id);
      }
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  };

  const handleRenameFolder = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      const data = await foldersAPI.update(renameTarget.id, { name: renameValue.trim() });
      updateFolder(renameTarget.id, { name: data.folder.name });
      setIsRenameDialog(false);
      setRenameTarget(null);
    } catch (err) {
      console.error('Failed to rename folder:', err);
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
                  onClick={(e) => handleDeleteFolder(folder.id, e)}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--ide-error)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--ide-text-dim)'}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            {/* Render children if expanded */}
            {folder.isExpanded && renderFolderTree(folder.id, depth + 1)}
          </div>
        ))}
        {/* Files in this folder */}
        {filesInFolder.map(file => (
          <div
            key={file.id}
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
              onClick={(e) => handleDeleteFile(file.id, e)}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--ide-error)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--ide-text-dim)'}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
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
                        <div
                          key={tab.id}
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
          <div className="p-3 space-y-3">
            <p className="text-xs font-medium" style={{ color: 'var(--ide-text-faint)' }}>Settings</p>
            <div className="space-y-2">
              <p className="text-xs" style={{ color: 'var(--ide-text-muted)' }}>Font Size: 14px</p>
              <p className="text-xs" style={{ color: 'var(--ide-text-muted)' }}>Tab Size: 4</p>
              <p className="text-xs" style={{ color: 'var(--ide-text-muted)' }}>Auto Save: On</p>
              <p className="text-xs" style={{ color: 'var(--ide-text-muted)' }}>Theme: {useIDEStore.getState().theme === 'dark' ? 'Dark' : 'Light'}</p>
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
                        📁 {f.name}
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
              onKeyDown={(e) => e.key === 'Enter' && handleRenameFolder()}
              autoFocus
            />
            <Button
              onClick={handleRenameFolder}
              className="ide-btn-hover w-full font-medium"
              style={{ backgroundColor: 'var(--ide-accent)', color: 'var(--ide-bg-base)' }}
              disabled={!renameValue.trim()}
            >
              Rename
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
