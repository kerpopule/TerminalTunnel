import { useEffect, useState, useCallback, useRef } from 'react';
import { useDesktopApp } from './useDesktopApp';
import { useWebDesktopMode } from './useWebDesktopMode';

interface TunnelState {
  url: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useTunnel() {
  const { isDesktopApp } = useDesktopApp();
  const { isTunnelAccess } = useWebDesktopMode();
  const [state, setState] = useState<TunnelState>({
    url: null,
    isConnected: false,
    isLoading: true,
    error: null,
  });
  const cleanupRef = useRef<(() => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingRef = useRef(false);

  useEffect(() => {
    // Desktop app mode: Use Tauri commands
    if (isDesktopApp) {
      // Listen for tunnel URL events from Tauri
      const setupListeners = async () => {
        try {
          const { listen } = await import('@tauri-apps/api/event');
          const { invoke } = await import('@tauri-apps/api/core');

          console.log('[useTunnel] Setting up Tauri event listeners');

          // Get initial URL if available
          try {
            const url = await invoke<string | null>('get_tunnel_url');
            console.log('[useTunnel] Initial tunnel URL:', url);
            if (url) {
              setState({ url, isConnected: true, isLoading: false, error: null });
            }
          } catch (e) {
            console.error('[useTunnel] Failed to get initial tunnel URL:', e);
          }

        // Listen for URL updates
        const unlisten = await listen<string>('tunnel-url', (event) => {
          console.log('[useTunnel] Received tunnel-url event:', event.payload);
          setState({
            url: event.payload,
            isConnected: true,
            isLoading: false,
            error: null,
          });
        });

        // Listen for tunnel status updates
        const unlistenStatus = await listen<string>('tunnel-status', (event) => {
          console.log('[useTunnel] Received tunnel-status event:', event.payload);
          if (event.payload === 'starting') {
            setState((prev) => ({ ...prev, isLoading: true, error: null }));
          } else if (event.payload === 'connected') {
            setState((prev) => ({ ...prev, isLoading: false, error: null }));
          } else if (event.payload.startsWith('error:')) {
            setState((prev) => ({
              ...prev,
              isLoading: false,
              error: event.payload.replace('error: ', ''),
            }));
          }
        });

        // Note: Update progress is handled by useUpdater hook
        // to avoid duplicate listeners, we don't set it up here

        cleanupRef.current = () => {
          console.log('[useTunnel] Cleaning up listeners');
          unlisten();
          unlistenStatus();
        };

        // Poll for tunnel URL to avoid missing early events during reloads.
        if (!pollRef.current) {
          pollRef.current = setInterval(async () => {
            if (pollingRef.current) return;
            pollingRef.current = true;
            try {
              const url = await invoke<string | null>('get_tunnel_url');
              if (url) {
                setState((prev) => {
                  if (prev.url === url && prev.isConnected) return prev;
                  return { url, isConnected: true, isLoading: false, error: null };
                });
              }
            } catch (e) {
              // Keep polling quietly; UI will show retry if needed.
            } finally {
              pollingRef.current = false;
            }
          }, 3000);
        }
      } catch (e) {
        console.error('[useTunnel] Failed to setup tunnel listeners:', e);
        setState({ url: null, isConnected: false, isLoading: false, error: String(e) });
      }
    };

      setupListeners();

      // Set a timeout to stop showing loading if no connection after 30s
      const loadingTimeout = setTimeout(() => {
        setState((prev) => {
          if (prev.isLoading && !prev.isConnected) {
            return { ...prev, isLoading: false };
          }
          return prev;
        });
      }, 30000);

      return () => {
        clearTimeout(loadingTimeout);
        if (cleanupRef.current) {
          cleanupRef.current();
          cleanupRef.current = null;
        }
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      };
    } else if (isTunnelAccess) {
      // Web tunnel mode: Use window.location as the tunnel URL
      console.log('[useTunnel] Web tunnel mode detected');
      const currentUrl = window.location.origin + window.location.pathname;
      const tunnelUrl = currentUrl.replace(/\/$/, ''); // Remove trailing slash

      setState({
        url: tunnelUrl,
        isConnected: true,
        isLoading: false,
        error: null,
      });

      console.log('[useTunnel] Tunnel URL from window.location:', tunnelUrl);
    } else {
      // Localhost web access - no tunnel
      console.log('[useTunnel] Localhost web mode - no tunnel');
      setState({
        url: null,
        isConnected: false,
        isLoading: false,
        error: null,
      });
    }
  }, [isDesktopApp, isTunnelAccess]);

  const copyUrl = useCallback(async () => {
    if (state.url) {
      try {
        await navigator.clipboard.writeText(state.url);
        return true;
      } catch (e) {
        console.error('Failed to copy URL:', e);
        return false;
      }
    }
    return false;
  }, [state.url]);

  const startTunnel = useCallback(async () => {
    if (!isDesktopApp) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      setState((prev) => ({ ...prev, isLoading: true }));
      await invoke('start_tunnel');
    } catch (e) {
      console.error('Failed to start tunnel:', e);
      setState((prev) => ({ ...prev, isLoading: false, error: String(e) }));
    }
  }, [isDesktopApp]);

  const stopTunnel = useCallback(async () => {
    if (!isDesktopApp) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('stop_tunnel');
      setState({ url: null, isConnected: false, isLoading: false, error: null });
    } catch (e) {
      console.error('Failed to stop tunnel:', e);
    }
  }, [isDesktopApp]);

  const restartTunnel = useCallback(async () => {
    if (!isDesktopApp) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      setState((prev) => ({ ...prev, isLoading: true }));
      await invoke('restart_tunnel');
    } catch (e) {
      console.error('Failed to restart tunnel:', e);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [isDesktopApp]);

  const refreshTunnel = useCallback(async () => {
    if (!isDesktopApp) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      setState((prev) => ({ ...prev, isLoading: true }));
      // Stop old tunnel and start new one
      await invoke('stop_tunnel');
      // Small delay to ensure clean shutdown
      await new Promise((resolve) => setTimeout(resolve, 500));
      await invoke('start_tunnel');
    } catch (e) {
      console.error('Failed to refresh tunnel:', e);
      setState((prev) => ({ ...prev, isLoading: false, error: String(e) }));
    }
  }, [isDesktopApp]);

  return {
    url: state.url,
    isConnected: state.isConnected,
    isLoading: state.isLoading,
    error: state.error,
    copyUrl,
    startTunnel,
    stopTunnel,
    restartTunnel,
    refreshTunnel,
  };
}
