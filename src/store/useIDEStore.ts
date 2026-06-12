import { create } from 'zustand';
import { LANGUAGE_EXTENSIONS, DEFAULT_CODE, setToken as apiSetToken, clearToken as apiClearToken } from '@/lib/api';

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
}

export type SidebarView = 'files' | 'search' | 'ai' | 'settings' | 'none';

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

  // File management
  remoteFiles: Array<{ id: string; name: string; language: string; content: string; updatedAt: string }>;

  // AI Assistant
  aiMessages: AIMessage[];
  isAILoading: boolean;

  // Diagnostics
  diagnostics: Diagnostic[];
  validationStatus: ValidationStatus;
  isProblemsPanelOpen: boolean;

  // ─── Actions ─────────────────────────────────────────────────────────────────

  // Auth
  setUser: (user: User | null, token?: string | null) => void;
  openAuthModal: (tab?: 'login' | 'signup') => void;
  closeAuthModal: () => void;
  logout: () => void;

  // Editor
  addTab: (name: string, language: string, content?: string, id?: string, isRemote?: boolean) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabContent: (id: string, content: string) => void;
  markTabClean: (id: string) => void;
  setLanguage: (language: string) => void;
  setStdin: (stdin: string) => void;

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

  // File management
  setRemoteFiles: (files: IDEState['remoteFiles']) => void;
  updateRemoteFile: (id: string, data: Partial<{ name: string; language: string; content: string }>) => void;
  removeRemoteFile: (id: string) => void;

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
}

// ─── Helper ──────────────────────────────────────────────────────────────────

let tabCounter = 0;
function generateTabId(): string {
  return `tab_${Date.now()}_${++tabCounter}`;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useIDEStore = create<IDEState>((set, get) => ({
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

  // Remote files
  remoteFiles: [],

  // AI Assistant initial state
  aiMessages: [],
  isAILoading: false,

  // Diagnostics initial state
  diagnostics: [],
  validationStatus: 'idle',
  isProblemsPanelOpen: true,

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
    });
  },

  // ─── Editor Actions ──────────────────────────────────────────────────────────

  addTab: (name, language, content, id, isRemote = false) => {
    const tabId = id || generateTabId();
    const state = get();

    // Check if tab already exists
    const existing = state.tabs.find(t => t.name === name && t.language === language);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }

    const newTab: TabInfo = {
      id: tabId,
      name,
      language,
      content: content ?? DEFAULT_CODE[language] ?? '',
      isDirty: false,
      isRemote,
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
    const newTabs = state.tabs.filter(t => t.id !== id);
    const newActiveId = state.activeTabId === id
      ? (newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null)
      : state.activeTabId;

    set({
      tabs: newTabs,
      activeTabId: newActiveId,
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

  // ─── Terminal Actions ────────────────────────────────────────────────────────

  setTerminalWriter: (writer) => set({ terminalWriter: writer }),

  writeToTerminal: (data) => {
    const writer = get().terminalWriter;
    if (writer) {
      writer(data);
    }
  },

  clearTerminal: () => {
    // xterm.js clear is handled by the Terminal component
    // We signal it by writing a special clear sequence
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

  setSidebarView: (view) => set({ sidebarView: view }),

  toggleSidebar: () => set(state => ({ isSidebarOpen: !state.isSidebarOpen })),

  setTheme: (theme) => set({ theme }),

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
}));
