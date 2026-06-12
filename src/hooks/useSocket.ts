'use client';

import { useEffect, useState } from 'react';
import { onConnectionChange } from '@/lib/executor-client';

/**
 * Hook that provides connection state for the terminal service.
 * v5.0: Uses WebSocket connection state from the executor-client.
 * The socket.io connection to the terminal service is managed by
 * executor-client.ts and shared across the application.
 */
export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const unsub = onConnectionChange((connected) => {
      setIsConnected(connected);
    });
    return unsub;
  }, []);

  return {
    isConnected,
  };
}
