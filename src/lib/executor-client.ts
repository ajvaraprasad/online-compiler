'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge Executor Client — Robust WebSocket with Auto-Reconnect (v6.0)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Fixes:
 *   ✓ Pre-connection — WebSocket connects on first page load, not just on Run
 *   ✓ Auto-reconnect — Exponential backoff reconnection when connection drops
 *   ✓ Heartbeat — Periodic ping to detect stale connections
 *   ✓ WebSocket close handling — If WS dies during execution, cleanly end it
 *   ✓ Listener cleanup — Properly remove message listeners between executions
 *   ✓ Meaningful error messages — User sees exactly why connection failed
 *
 * Connection Strategy:
 *   Browser → ws://host:81/?XTransformPort=3002 → Caddy → ws://localhost:3002
 *
 * Protocol: JSON messages over WebSocket
 *   Client → Server:
 *     { type: "execute", code, language, requestId, rows, cols }
 *     { type: "stdin", requestId, data }
 *     { type: "resize", requestId, rows, cols }
 *     { type: "kill", requestId }
 *     { type: "ping" }
 *
 *   Server → Client:
 *     { type: "started", requestId, ... }
 *     { type: "phase", requestId, phase, status, ... }
 *     { type: "output", requestId, data }
 *     { type: "stderr", requestId, data }
 *     { type: "exit", requestId, exitCode, executionTime, ... }
 *     { type: "error", requestId, message }
 *     { type: "pong" }
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type WSEventType = 'start' | 'stdout' | 'stderr' | 'end' | 'heartbeat' | 'killed' | 'error' | 'phase' | 'output';

export interface WSEvent {
  type: WSEventType;
  data?: string;
  sessionId?: string;
  exitCode?: number;
  executionTime?: number;
}

export type EventHandler = (event: WSEvent) => void;

// ─── Connection State ────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let connectionListeners: Array<(connected: boolean) => void> = [];
let intentionalClose = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let currentMessageListener: ((event: MessageEvent) => void) | null = null;
let currentRequestId: string | null = null;

// Reconnection settings
const RECONNECT_BASE_DELAY = 1000;    // 1 second
const RECONNECT_MAX_DELAY = 10000;    // 10 seconds
const RECONNECT_MAX_ATTEMPTS = 20;
const HEARTBEAT_INTERVAL = 30000;     // 30 seconds
const HEARTBEAT_TIMEOUT = 10000;      // 10 seconds to wait for pong

function notifyConnectionListeners(connected: boolean) {
  connectionListeners.forEach(fn => fn(connected));
}

export function onConnectionChange(fn: (connected: boolean) => void): () => void {
  connectionListeners.push(fn);
  // Immediately report current state
  if (ws?.readyState === WebSocket.OPEN) {
    fn(true);
  }
  return () => {
    connectionListeners = connectionListeners.filter(l => l !== fn);
  };
}

// ─── Build WebSocket URL ────────────────────────────────────────────────────

function buildWSUrl(): string {
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let host = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
  // Fix: 0.0.0.0 is not a valid WebSocket host — replace with 127.0.0.1
  if (host.startsWith('0.0.0.0')) {
    host = host.replace('0.0.0.0', '127.0.0.1');
  }
  // Connect via /ws/terminal path on the main server (port 3000).
  // The custom server.ts intercepts WebSocket upgrades on this path.
  return `${protocol}//${host}/ws/terminal`;
}

// ─── Create WebSocket Connection ────────────────────────────────────────────

function createWS(): WebSocket {
  const wsUrl = buildWSUrl();
  console.log(`[ExecutorClient] Connecting to: ${wsUrl}`);

  const socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('[ExecutorClient] WebSocket connected');
    reconnectAttempts = 0;
    notifyConnectionListeners(true);
    startHeartbeat();
  };

  socket.onclose = (event) => {
    console.log(`[ExecutorClient] WebSocket closed: code=${event.code}, reason=${event.reason}, intentional=${intentionalClose}`);
    stopHeartbeat();
    notifyConnectionListeners(false);

    // If we have an active execution, the WebSocket died mid-execution
    // This is critical — we need to notify the handler
    handleWSDuringExecution('close');

    // Auto-reconnect unless intentionally closed
    if (!intentionalClose) {
      scheduleReconnect();
    }
  };

  socket.onerror = (event) => {
    console.warn(`[ExecutorClient] WebSocket error (attempt ${reconnectAttempts + 1})`);
    notifyConnectionListeners(false);
  };

  return socket;
}

// ─── Get or Create WebSocket ─────────────────────────────────────────────────

function getWS(): WebSocket {
  // If we have a healthy connection, return it
  if (ws && ws.readyState === WebSocket.OPEN) {
    return ws;
  }

  // If connection is in CONNECTING state, wait for it
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    return ws;
  }

  // Clean up dead connection
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }

  // Create new connection
  intentionalClose = false;
  ws = createWS();
  return ws;
}

// ─── Pre-connect (call on page load) ────────────────────────────────────────

export function connectWS(): void {
  if (typeof window === 'undefined') return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  getWS();
}

// ─── Reconnection Logic ─────────────────────────────────────────────────────

function scheduleReconnect(): void {
  if (intentionalClose) return;
  if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
    console.warn(`[ExecutorClient] Max reconnection attempts (${RECONNECT_MAX_ATTEMPTS}) reached`);
    return;
  }

  // Exponential backoff with jitter
  const delay = Math.min(
    RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts) + Math.random() * 500,
    RECONNECT_MAX_DELAY
  );
  reconnectAttempts++;

  console.log(`[ExecutorClient] Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempts})`);

  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!intentionalClose) {
      ws = createWS();
    }
  }, delay);
}

// ─── Heartbeat ──────────────────────────────────────────────────────────────

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        // Connection might have closed between check and send
      }
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ─── Handle WebSocket Death During Execution ────────────────────────────────
//
// When the WebSocket closes while a program is running, we need to:
// 1. Clean up the current message listener
// 2. Mark the execution as ended
// 3. Show an error in the terminal
// This is critical because without it, isExecuting stays true forever.

function handleWSDuringExecution(reason: 'close' | 'error'): void {
  if (!currentRequestId || !currentMessageListener) return;

  const lostRequestId = currentRequestId;
  const lostListener = currentMessageListener;

  console.warn(`[ExecutorClient] WebSocket ${reason} during active execution: ${lostRequestId}`);

  // Clean up listener first
  if (ws && lostListener) {
    try { ws.removeEventListener('message', lostListener); } catch {}
  }
  currentMessageListener = null;
  currentRequestId = null;

  // Update store state asynchronously (can't use await in synchronous handler)
  import('@/store/useIDEStore').then(({ useIDEStore }) => {
    const state = useIDEStore.getState();

    if (state.isExecuting && state.currentRequestId === lostRequestId) {
      const ANSI_RED = '\x1b[31m';
      const ANSI_YELLOW = '\x1b[33m';
      const ANSI_RESET = '\x1b[0m';

      state.writeToTerminal(
        '\r\n' + ANSI_RED + 'Connection to terminal service lost.' + ANSI_RESET + '\r\n' +
        ANSI_YELLOW + 'The program may still be running on the server.' + ANSI_RESET + '\r\n'
      );

      // Reset execution state
      state.setExecuting(false);
      state.setCurrentRequestId(null);
    }
  }).catch((e) => {
    console.error('[ExecutorClient] Failed to handle WS death during execution:', e);
  });
}

// ─── Send JSON message ──────────────────────────────────────────────────────

function sendMsg(msg: Record<string, unknown>): boolean {
  const socket = getWS();
  if (socket.readyState !== WebSocket.OPEN) {
    console.warn('[ExecutorClient] Cannot send: WebSocket not open (state:', socket.readyState, ')');
    return false;
  }
  socket.send(JSON.stringify(msg));
  return true;
}

// ─── Execute Code ────────────────────────────────────────────────────────────

export async function executeCode(
  code: string,
  language: string,
  sessionId: string,
  _stdin?: string,
  _interactive: boolean = true,
  onEvent?: EventHandler
): Promise<void> {
  const socket = getWS();

  // Clean up any previous message listener for this execution
  if (currentMessageListener && ws) {
    try { ws.removeEventListener('message', currentMessageListener); } catch {}
    currentMessageListener = null;
  }

  // Ensure connected
  if (socket.readyState !== WebSocket.OPEN) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout — terminal service may be offline'));
      }, 10000); // Reduced from 15s to 10s

      const onOpen = () => {
        clearTimeout(timeout);
        resolve();
      };

      if (socket.readyState === WebSocket.OPEN) {
        clearTimeout(timeout);
        resolve();
      } else {
        socket.addEventListener('open', onOpen, { once: true });

        // Also listen for close to reject immediately
        const onClose = () => {
          clearTimeout(timeout);
          socket.removeEventListener('open', onOpen);
          reject(new Error('Connection refused — terminal service not reachable'));
        };
        socket.addEventListener('close', onClose, { once: true });
      }
    }).catch((err) => {
      onEvent?.({
        type: 'stderr',
        data: `\x1b[31mConnection failed: ${err.message}\x1b[0m\r\n`,
      });
      onEvent?.({
        type: 'stderr',
        data: '\x1b[33mCheck that the terminal service is running on port 3002.\x1b[0m\r\n',
      });
      onEvent?.({ type: 'end', exitCode: 1, executionTime: 0 });
      return;
    });
  }

  // Get terminal dimensions from xterm.js if available
  let rows = 24;
  let cols = 80;
  if (typeof document !== 'undefined') {
    const termEl = document.querySelector('.xterm');
    if (termEl) {
      const termData = (termEl as any).__xterm;
      if (termData) {
        rows = termData.rows || 24;
        cols = termData.cols || 80;
      }
    }
  }

  // ── Set up message handler for this execution ──────────────────────

  currentRequestId = sessionId;

  const onMessage = (event: MessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    // Filter by requestId
    if (msg.requestId && msg.requestId !== sessionId) return;

    switch (msg.type) {
      case 'started':
        onEvent?.({ type: 'start', sessionId });
        break;

      case 'phase':
        onEvent?.({
          type: 'phase',
          data: JSON.stringify(msg),
        });
        break;

      case 'output':
        onEvent?.({
          type: 'stdout',
          data: msg.data,
        });
        break;

      case 'stderr':
        onEvent?.({
          type: 'stderr',
          data: msg.data,
        });
        break;

      case 'exit':
        onEvent?.({
          type: 'end',
          exitCode: msg.exitCode,
          executionTime: msg.executionTime,
          sessionId,
          data: JSON.stringify(msg),
        });
        // Clean up listener
        cleanupListener();
        break;

      case 'error':
        onEvent?.({
          type: 'stderr',
          data: `Error: ${msg.message}`,
        });
        onEvent?.({ type: 'end', exitCode: 1, executionTime: 0, sessionId });
        cleanupListener();
        break;

      case 'pong':
        // Heartbeat response, connection is alive
        break;
    }
  };

  currentMessageListener = onMessage;
  socket.addEventListener('message', onMessage);

  // ── Send execute command ──────────────────────────────────────────
  const sent = sendMsg({
    type: 'execute',
    code,
    language,
    requestId: sessionId,
    rows,
    cols,
  });

  if (!sent) {
    onEvent?.({
      type: 'stderr',
      data: '\x1b[31mFailed to send execute command — WebSocket not connected.\x1b[0m\r\n',
    });
    onEvent?.({ type: 'end', exitCode: 1, executionTime: 0 });
    cleanupListener();
  }
}

// ─── Clean up current message listener ──────────────────────────────────────

function cleanupListener(): void {
  if (ws && currentMessageListener) {
    try { ws.removeEventListener('message', currentMessageListener); } catch {}
  }
  currentMessageListener = null;
  currentRequestId = null;
}

// ─── Send Stdin (raw keystrokes via WebSocket) ──────────────────────────────

export async function sendStdin(sessionId: string, data: string): Promise<boolean> {
  const dataPreview = data.length <= 20
    ? JSON.stringify(data)
    : JSON.stringify(data.slice(0, 20)) + `... (${data.length} chars)`;
  console.log(`[ExecutorClient] sendStdin: requestId=${sessionId}, data=${dataPreview}`);

  const result = sendMsg({ type: 'stdin', requestId: sessionId, data });
  if (!result) {
    console.warn('[ExecutorClient] sendStdin FAILED: WebSocket not open');
  }
  return result;
}

// ─── Kill Execution ──────────────────────────────────────────────────────────

export async function killExecution(sessionId: string): Promise<boolean> {
  cleanupListener();
  return sendMsg({ type: 'kill', requestId: sessionId });
}

// ─── Resize Terminal ────────────────────────────────────────────────────────

export async function resizeTerminal(
  sessionId: string,
  rows: number,
  cols: number
): Promise<boolean> {
  return sendMsg({ type: 'resize', requestId: sessionId, rows, cols });
}

// ─── Disconnect ─────────────────────────────────────────────────────────────

export function disconnectWS(): void {
  intentionalClose = true;
  stopHeartbeat();
  cleanupListener();

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  notifyConnectionListeners(false);
}

// ─── Check if connected ─────────────────────────────────────────────────────

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}
