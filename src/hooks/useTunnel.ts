import { useEffect, useState, useCallback, useRef } from 'react';
import { useDesktopApp } from './useDesktopApp';

interface TunnelState {
  url: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useTunnel() {
  const { isDesktopApp } = useDesktopApp();
  const [state, setState] = useState<TunnelState>({
    url: null,
    isConnected: false,
    isLoading: true,
    error: null,
  });
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isDesktopApp) {
      setState({ url: null, isConnected: false, isLoading: false, error: null });
      return;
    }

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

        // Listen for copy to clipboard requests
        const unlistenCopy = await listen<string>('copy-to-clipboard', async (event) => {
          try {
            await navigator.clipboard.writeText(event.payload);
          } catch (e) {
            console.error('[useTunnel] Failed to copy to clipboard:', e);
          }
        });

        cleanupRef.current = () => {
          console.log('[useTunnel] Cleaning up listeners');
          unlisten();
          unlistenStatus();
          unlistenCopy();
        };
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
    };
  }, [isDesktopApp]);

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

  return {
    url: state.url,
    isConnected: state.isConnected,
    isLoading: state.isLoading,
    error: state.error,
    copyUrl,
    restartTunnel,
  };
}
