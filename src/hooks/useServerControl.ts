import { useCallback } from 'react';

const API_BASE = '';

export function useServerControl() {
  const stopServer = useCallback(async (port: number): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/api/kill-port/${port}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // 200 = killed successfully
      // 404 = no process found (already stopped) - this is also success!
      // The goal is to stop the server, if it's already dead, mission accomplished
      if (response.ok || response.status === 404) {
        console.log(`[useServerControl] Server on port ${port} stopped (or was already stopped)`);
        return true;
      } else {
        const error = await response.json();
        console.error(`[useServerControl] Failed to stop server on port ${port}:`, error);
        return false;
      }
    } catch (error) {
      console.error(`[useServerControl] Error stopping server on port ${port}:`, error);
      return false;
    }
  }, []);

  return { stopServer };
}
