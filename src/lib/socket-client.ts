'use client';

import { io, Socket } from 'socket.io-client';

const EXECUTOR_PORT = 3003;

// ─── Singleton Socket Manager ───────────────────────────────────────────────
// Ensures only ONE socket connection exists across the entire app.
// Multiple useSocket() calls share the same connection.

let socketInstance: Socket | null = null;
let connectionListeners: Array<(connected: boolean) => void> = [];

function getSocket(): Socket {
  if (!socketInstance) {
    // Connect using the same pattern as the websocket example:
    // - Path is '/' (matches the server's path config)
    // - XTransformPort is in the URL path, not a separate query param
    // - Caddy uses XTransformPort to route to the correct backend
    socketInstance = io(`/?XTransformPort=${EXECUTOR_PORT}`, {
      transports: ['websocket', 'polling'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: 30,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 20000,
    });

    socketInstance.on('connect', () => {
      console.log('[Socket] Connected to executor service, id:', socketInstance!.id, 'transport:', socketInstance!.io.engine.transport.name);
      connectionListeners.forEach(fn => fn(true));
    });

    socketInstance.on('disconnect', (reason) => {
      connectionListeners.forEach(fn => fn(false));
    });

    socketInstance.on('connect_error', (err) => {
      // Silently handle connection errors — these are normal during reconnection
      // or when the executor service hasn't started yet. The status bar shows
      // connection state visually; no need to spam the console.
      connectionListeners.forEach(fn => fn(false));
    });
  }
  return socketInstance;
}

function onConnectionChange(fn: (connected: boolean) => void): () => void {
  connectionListeners.push(fn);
  return () => {
    connectionListeners = connectionListeners.filter(l => l !== fn);
  };
}

export { getSocket, onConnectionChange };
