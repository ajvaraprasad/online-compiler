import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LANGUAGE_EXTENSIONS, setToken as apiSetToken, clearToken as apiClearToken } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  username: string;
  avatar?: string;
  createdAt: string;
}

export interface TabInfo {
  id: string;
  name: string;
  language: string;
  content: string;
  isDirty: boolean;
  isRemote: boolean; // true if saved to server
  cursorLine: number;
  cursorColumn: number;
}

export type SidebarView = 'files' | 'search' | 'settings' | 'none';

// Diagnostic from validation
export interface Diagnostic {
  id: string;          // unique ID for React keys
  message: string;
  line: number;        // 1-based
  column: number;      // 1-based
  endLine: number;
  endColumn: number;
  severity: 'error' | 'warning' | 'info';
  source: string;      // 'gcc', 'python', 'node', 'codeforge'
}

// Validation status
export type ValidationStatus = 'idle' | 'validating' | 'validated';

// AI Chat message
export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// Callback type for writing to the xterm.js terminal
export type TerminalWriter = (data: string) => void;

// Compiler phase info for UI visualization
export interface CompilerPhaseInfo {
  phase: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  durationMs?: number;
  data?: Record<string, unknown>;
}

export interface CompilerPipelineState {
  phases: CompilerPhaseInfo[];
  currentPhase: string | null;
  totalDurationMs: number;
  metrics: Record<string, unknown> | null;
}

// ─── File Tree Types ─────────────────────────────────────────────────────────

export interface FolderItem {
  id: string;
  name: string;
  parentId: string | null;
  isExpanded: boolean;
  createdAt: string;
  updatedAt: string;
}

// Extended remote file type with folderId
export interface FileItem {
  id: string;
  name: string;
  language: string;
  content: string;
  folderId: string | null;
  updatedAt: string;
}

// ─── Settings Types ──────────────────────────────────────────────────────────

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  wordWrap: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  minimap: boolean;
  autoSave: boolean;
  autoSaveDelay: number; // ms
  cursorBlinking: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
  renderWhitespace: 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
  bracketPairColorization: boolean;
  lineHeight: number;
}

export interface TerminalSettings {
  fontSize: number;
  cursorBlink: boolean;
  clearOnRun: boolean;
}

export interface AppearanceSettings {
  theme: 'dark' | 'light';
}

export type IDESettings = EditorSettings & TerminalSettings & AppearanceSettings;

// ─── Store State ─────────────────────────────────────────────────────────────

interface IDEState {
  // Auth
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isAuthModalOpen: boolean;
  authModalTab: 'login' | 'signup';

  // Editor
  tabs: TabInfo[];
  activeTabId: string | null;
  language: string;
  stdin: string;

  // Terminal
  isTerminalOpen: boolean;
  isExecuting: boolean;
  currentRequestId: string | null;
  terminalWriter: TerminalWriter | null;

  // Compiler Pipeline
  pipelineState: CompilerPipelineState;

  // UI
  sidebarView: SidebarView;
  isSidebarOpen: boolean;
  theme: 'dark' | 'light';

  // RHS Panel (AI Assistant)
  isAIPanelOpen: boolean;

  // File management
  remoteFiles: FileItem[];
  folders: FolderItem[];

  // AI Assistant
  aiMessages: AIMessage[];
  isAILoading: boolean;

  // Diagnostics
  diagnostics: Diagnostic[];
  validationStatus: ValidationStatus;
  isProblemsPanelOpen: boolean;

  // Settings
  settings: IDESettings;

  // ─── Actions ─────────────────────────────────────────────────────────────────

  // Auth
  setUser: (user: User | null, token?: string | null) => void;
  openAuthModal: (tab?: 'login' | 'signup') => void;
  closeAuthModal: () => void;
  logout: () => void;

  // Editor
  addTab: (name: string, language: string, content?: string, id?: string, isRemote?: boolean) => string;
  closeTab: (id: string) => void;
  closeOtherTabs: (keepId: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (id: string) => void;
  updateTabContent: (id: string, content: string) => void;
  markTabClean: (id: string) => void;
  updateTabCursor: (id: string, line: number, column: number) => void;
  setLanguage: (language: string) => void;
  setStdin: (stdin: string) => void;
  moveTab: (fromIndex: number, toIndex: number) => void;

  // Terminal
  setTerminalWriter: (writer: TerminalWriter | null) => void;
  writeToTerminal: (data: string) => void;
  clearTerminal: () => void;
  setTerminalOpen: (open: boolean) => void;
  setExecuting: (executing: boolean) => void;
  setCurrentRequestId: (id: string | null) => void;

  // Compiler Pipeline
  updatePipelinePhase: (phase: CompilerPhaseInfo) => void;
  resetPipeline: () => void;
  setPipelineMetrics: (metrics: Record<string, unknown>) => void;

  // UI
  setSidebarView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  toggleAIPanel: () => void;
  setAIPanelOpen: (open: boolean) => void;

  // File management
  setRemoteFiles: (files: FileItem[]) => void;
  updateRemoteFile: (id: string, data: Partial<{ name: string; language: string; content: string; folderId: string | null }>) => void;
  removeRemoteFile: (id: string) => void;

  // Folder management
  setFolders: (folders: FolderItem[]) => void;
  addFolder: (folder: FolderItem) => void;
  updateFolder: (id: string, data: Partial<{ name: string; parentId: string | null; isExpanded: boolean }>) => void;
  removeFolder: (id: string) => void;
  toggleFolderExpanded: (id: string) => void;

  // AI Assistant
  addAIMessage: (role: 'user' | 'assistant', content: string) => void;
  updateLastAIMessage: (content: string) => void;
  clearAIMessages: () => void;
  setAILoading: (loading: boolean) => void;

  // Diagnostics
  setDiagnostics: (diagnostics: Diagnostic[]) => void;
  setValidationStatus: (status: ValidationStatus) => void;
  setProblemsPanelOpen: (open: boolean) => void;
  toggleProblemsPanel: () => void;
  clearDiagnostics: () => void;

  // Settings
  updateSettings: (partial: Partial<IDESettings>) => void;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

let tabCounter = 0;
function generateTabId(): string {
  return `tab_${Date.now()}_${++tabCounter}`;
}

// ─── Default Settings ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: IDESettings = {
  // Editor
  fontSize: 14,
  tabSize: 4,
  wordWrap: 'on',
  minimap: true,
  autoSave: false,
  autoSaveDelay: 1000,
  cursorBlinking: 'smooth',
  renderWhitespace: 'selection',
  bracketPairColorization: true,
  lineHeight: 22,
  // Terminal
  terminalFontSize: 14,
  terminalCursorBlink: true,
  terminalClearOnRun: true,
  // Appearance
  theme: 'dark',
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useIDEStore = create<IDEState>()(
  persist(
    (set, get) => ({
      // Auth initial state
      user: null,
      token: null,
      isAuthenticated: false,
      isAuthModalOpen: false,
      authModalTab: 'login',

      // Editor initial state
      tabs: [],
      activeTabId: null,
      language: 'python',
      stdin: '',

      // Terminal initial state
      isTerminalOpen: true,
      isExecuting: false,
      currentRequestId: null,

      // Compiler Pipeline initial state
      pipelineState: {
        phases: [],
        currentPhase: null,
        totalDurationMs: 0,
        metrics: null,
      },
      terminalWriter: null,

      // UI initial state
      sidebarView: 'files',
      isSidebarOpen: true,
      theme: 'dark',
      isAIPanelOpen: false,

      // Remote files
      remoteFiles: [],
      folders: [],

      // AI Assistant initial state
      aiMessages: [],
      isAILoading: false,

      // Diagnostics initial state
      diagnostics: [],
      validationStatus: 'idle',
      isProblemsPanelOpen: true,

      // Settings
      settings: DEFAULT_SETTINGS,

      // ─── Auth Actions ────────────────────────────────────────────────────────────

      setUser: (user, token) => {
        if (token) {
          apiSetToken(token);
        }
        set({
          user,
          token: token !== undefined ? token : get().token,
          isAuthenticated: !!user,
        });
      },

      openAuthModal: (tab = 'login') => set({ isAuthModalOpen: true, authModalTab: tab }),
      closeAuthModal: () => set({ isAuthModalOpen: false }),

      logout: () => {
        apiClearToken();
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          remoteFiles: [],
          folders: [],
        });
      },

      // ─── Editor Actions ──────────────────────────────────────────────────────────

      addTab: (name, language, content, id, isRemote = false) => {
        const tabId = id || generateTabId();
        const state = get();

        // Check if tab already exists — include isRemote in dedup
        const existing = state.tabs.find(t => t.name === name && t.language === language && t.isRemote === isRemote);
        if (existing) {
          set({ activeTabId: existing.id });
          return existing.id;
        }

        // New files are EMPTY — no boilerplate auto-injection
        const newTab: TabInfo = {
          id: tabId,
          name,
          language,
          content: content ?? '',
          isDirty: false,
          isRemote,
          cursorLine: 1,
          cursorColumn: 1,
        };

        set({
          tabs: [...state.tabs, newTab],
          activeTabId: tabId,
          language,
        });

        return tabId;
      },

      closeTab: (id) => {
        const state = get();
        const tab = state.tabs.find(t => t.id === id);
        // Note: Unsaved changes warning is handled in EditorTabs component
        const newTabs = state.tabs.filter(t => t.id !== id);
        const newActiveId = state.activeTabId === id
          ? (newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null)
          : state.activeTabId;

        set({
          tabs: newTabs,
          activeTabId: newActiveId,
        });
      },

      closeOtherTabs: (keepId) => {
        const state = get();
        const keptTab = state.tabs.find(t => t.id === keepId);
        if (keptTab) {
          set({
            tabs: [keptTab],
            activeTabId: keepId,
          });
        }
      },

      closeAllTabs: () => {
        set({
          tabs: [],
          activeTabId: null,
        });
      },

      setActiveTab: (id) => {
        const state = get();
        const tab = state.tabs.find(t => t.id === id);
        if (tab) {
          set({ activeTabId: id, language: tab.language });
        }
      },

      updateTabContent: (id, content) => {
        set(state => ({
          tabs: state.tabs.map(t =>
            t.id === id ? { ...t, content, isDirty: true } : t
          ),
        }));
      },

      markTabClean: (id) => {
        set(state => ({
          tabs: state.tabs.map(t =>
            t.id === id ? { ...t, isDirty: false } : t
          ),
        }));
      },

      updateTabCursor: (id, line, column) => {
        set(state => ({
          tabs: state.tabs.map(t =>
            t.id === id ? { ...t, cursorLine: line, cursorColumn: column } : t
          ),
        }));
      },

      setLanguage: (language) => {
        const state = get();
        const activeTab = state.tabs.find(t => t.id === state.activeTabId);
        if (activeTab) {
          const ext = LANGUAGE_EXTENSIONS[language] || '.txt';
          const baseName = activeTab.name.replace(/\.[^.]+$/, '');
          set(state => ({
            language,
            tabs: state.tabs.map(t =>
              t.id === activeTab.id
                ? { ...t, language, name: baseName + ext }
                : t
            ),
          }));
        } else {
          set({ language });
        }
      },

      setStdin: (stdin) => set({ stdin }),

      moveTab: (fromIndex, toIndex) => {
        set(state => {
          const newTabs = [...state.tabs];
          const [moved] = newTabs.splice(fromIndex, 1);
          newTabs.splice(toIndex, 0, moved);
          return { tabs: newTabs };
        });
      },

      // ─── Terminal Actions ────────────────────────────────────────────────────────

      setTerminalWriter: (writer) => set({ terminalWriter: writer }),

      writeToTerminal: (data) => {
        const writer = get().terminalWriter;
        if (writer) {
          writer(data);
        }
      },

      clearTerminal: () => {
        const writer = get().terminalWriter;
        if (writer) {
          writer('\x1b[2J\x1b[H'); // ANSI clear screen + cursor home
        }
      },

      setTerminalOpen: (open) => set({ isTerminalOpen: open }),

      setExecuting: (executing) => set({ isExecuting: executing }),

      setCurrentRequestId: (id) => set({ currentRequestId: id }),

      // ─── Compiler Pipeline Actions ──────────────────────────────────────────────

      updatePipelinePhase: (phase) => set(state => {
        const phases = [...state.pipelineState.phases];
        const existingIdx = phases.findIndex(p => p.phase === phase.phase);
        if (existingIdx >= 0) {
          phases[existingIdx] = phase;
        } else {
          phases.push(phase);
        }
        return {
          pipelineState: {
            ...state.pipelineState,
            phases,
            currentPhase: phase.status === 'running' ? phase.phase : state.pipelineState.currentPhase,
          },
        };
      }),

      resetPipeline: () => set({
        pipelineState: {
          phases: [],
          currentPhase: null,
          totalDurationMs: 0,
          metrics: null,
        },
      }),

      setPipelineMetrics: (metrics) => set(state => ({
        pipelineState: {
          ...state.pipelineState,
          metrics,
        },
      })),

      // ─── UI Actions ──────────────────────────────────────────────────────────────

      setSidebarView: (view) => set({ sidebarView: view, isSidebarOpen: true }),

      toggleSidebar: () => set(state => ({ isSidebarOpen: !state.isSidebarOpen })),

      setTheme: (theme) => set(state => ({ theme, settings: { ...state.settings, theme } })),

      toggleAIPanel: () => set(state => ({ isAIPanelOpen: !state.isAIPanelOpen })),
      setAIPanelOpen: (open) => set({ isAIPanelOpen: open }),

      // ─── File Management Actions ─────────────────────────────────────────────────

      setRemoteFiles: (files) => set({ remoteFiles: files }),

      updateRemoteFile: (id, data) => set(state => ({
        remoteFiles: state.remoteFiles.map(f =>
          f.id === id ? { ...f, ...data } : f
        ),
      })),

      removeRemoteFile: (id) => set(state => ({
        remoteFiles: state.remoteFiles.filter(f => f.id !== id),
      })),

      // ─── Folder Management Actions ───────────────────────────────────────────────

      setFolders: (folders) => set({ folders }),

      addFolder: (folder) => set(state => ({
        folders: [...state.folders, folder],
      })),

      updateFolder: (id, data) => set(state => ({
        folders: state.folders.map(f =>
          f.id === id ? { ...f, ...data } : f
        ),
      })),

      removeFolder: (id) => set(state => ({
        folders: state.folders.filter(f => f.id !== id),
      })),

      toggleFolderExpanded: (id) => set(state => ({
        folders: state.folders.map(f =>
          f.id === id ? { ...f, isExpanded: !f.isExpanded } : f
        ),
      })),

      // ─── AI Assistant Actions ──────────────────────────────────────────────────

      addAIMessage: (role, content) => set(state => ({
        aiMessages: [...state.aiMessages, {
          id: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          role,
          content,
          timestamp: Date.now(),
        }],
      })),

      updateLastAIMessage: (content) => set(state => {
        const messages = [...state.aiMessages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          messages[messages.length - 1] = { ...lastMsg, content };
        }
        return { aiMessages: messages };
      }),

      clearAIMessages: () => set({ aiMessages: [] }),

      setAILoading: (loading) => set({ isAILoading: loading }),

      // ─── Diagnostics Actions ────────────────────────────────────────────────────

      setDiagnostics: (diagnostics) => set({ diagnostics, validationStatus: 'validated' }),
      setValidationStatus: (status) => set({ validationStatus: status }),
      setProblemsPanelOpen: (open) => set({ isProblemsPanelOpen: open }),
      toggleProblemsPanel: () => set(state => ({ isProblemsPanelOpen: !state.isProblemsPanelOpen })),
      clearDiagnostics: () => set({ diagnostics: [], validationStatus: 'idle' }),

      // ─── Settings Actions ────────────────────────────────────────────────────────

      updateSettings: (partial) => set(state => {
        const newSettings = { ...state.settings, ...partial };
        // Sync theme with settings
        const themeUpdate = partial.theme ? { theme: partial.theme } : {};
        return { settings: newSettings, ...themeUpdate };
      }),
    }),
    {
      name: 'codeforge-ide-storage',
      // Only persist these fields — exclude non-serializable and ephemeral state
      partialize: (state) => ({
        tabs: state.tabs.map(t => ({
          id: t.id,
          name: t.name,
          language: t.language,
          content: t.content,
          isDirty: t.isDirty,
          isRemote: t.isRemote,
          cursorLine: t.cursorLine,
          cursorColumn: t.cursorColumn,
        })),
        activeTabId: state.activeTabId,
        language: state.language,
        stdin: state.stdin,
        theme: state.theme,
        settings: state.settings,
        sidebarView: state.sidebarView,
        isSidebarOpen: state.isSidebarOpen,
        isTerminalOpen: state.isTerminalOpen,
        folders: state.folders,
        remoteFiles: state.remoteFiles,
        isAIPanelOpen: state.isAIPanelOpen,
        // Persist auth state
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
      // Rehydrate side effects
      onRehydrateStorage: () => {
        return (state) => {
          if (state?.token) {
            apiSetToken(state.token);
          }
          if (state?.settings?.theme) {
            state.theme = state.settings.theme;
          }
        };
      },
    }
  )
);
