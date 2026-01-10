import { useState, useEffect, useCallback } from 'react';
import { useDesktopApp } from './useDesktopApp';
import { useSettings } from '../contexts/SettingsContext';

export interface UpdateInfo {
  version: string;
  current_version: string;
  body: string | null;
}

interface UpdaterState {
  isChecking: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  updateAvailable: boolean;
  updateInfo: UpdateInfo | null;
  error: string | null;
  dismissed: boolean;
}

// Re-validation interval (30 days in milliseconds)
const REVALIDATION_INTERVAL = 30 * 24 * 60 * 60 * 1000;

export function useUpdater() {
  const { isDesktopApp } = useDesktopApp();
  const { licenseValidated, licenseValidatedAt } = useSettings();

  // Check if license is valid and not expired
  const isLicensed = licenseValidated && licenseValidatedAt
    ? Date.now() - licenseValidatedAt < REVALIDATION_INTERVAL
    : false;

  const [state, setState] = useState<UpdaterState>({
    isChecking: false,
    isDownloading: false,
    downloadProgress: 0,
    updateAvailable: false,
    updateInfo: null,
    error: null,
    dismissed: false,
  });

  // Check for updates (requires valid license)
  const checkForUpdates = useCallback(async (silent = false) => {
    if (!isDesktopApp) return null;

    // Only check for updates if licensed
    if (!isLicensed) {
      if (!silent) {
        setState(prev => ({
          ...prev,
          error: 'A Pro license is required for automatic updates.',
        }));
      }
      return null;
    }

    setState(prev => ({ ...prev, isChecking: true, error: null }));

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<UpdateInfo | null>('check_for_updates');

      if (result) {
        setState(prev => ({
          ...prev,
          isChecking: false,
          updateAvailable: true,
          updateInfo: result,
          dismissed: false,
        }));
        return result;
      } else {
        setState(prev => ({
          ...prev,
          isChecking: false,
          updateAvailable: false,
          updateInfo: null,
        }));
        return null;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (!silent) {
        setState(prev => ({
          ...prev,
          isChecking: false,
          error: errorMessage,
        }));
      } else {
        setState(prev => ({ ...prev, isChecking: false }));
      }
      console.error('Failed to check for updates:', err);
      return null;
    }
  }, [isDesktopApp, isLicensed]);

  // Install update
  const installUpdate = useCallback(async () => {
    if (!isDesktopApp || !state.updateAvailable) return;

    setState(prev => ({ ...prev, isDownloading: true, downloadProgress: 0 }));

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('install_update');
      // App will restart after install
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setState(prev => ({
        ...prev,
        isDownloading: false,
        error: errorMessage,
      }));
      console.error('Failed to install update:', err);
    }
  }, [isDesktopApp, state.updateAvailable]);

  // Dismiss update notification
  const dismissUpdate = useCallback(() => {
    setState(prev => ({ ...prev, dismissed: true }));
  }, []);

  // Get current app version
  const getAppVersion = useCallback(async () => {
    if (!isDesktopApp) return null;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string>('get_app_version');
    } catch (err) {
      console.error('Failed to get app version:', err);
      return null;
    }
  }, [isDesktopApp]);

  // Listen for download progress events
  useEffect(() => {
    if (!isDesktopApp) return;

    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');

        unlisten = await listen<number>('update-download-progress', (event) => {
          setState(prev => ({ ...prev, downloadProgress: event.payload }));
        });
      } catch (err) {
        console.error('Failed to set up update progress listener:', err);
      }
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [isDesktopApp]);

  // Auto-check for updates on mount (silent, in background, only if licensed)
  useEffect(() => {
    if (!isDesktopApp || !isLicensed) return;

    // Check after a short delay to let the app fully initialize
    const timeout = setTimeout(() => {
      checkForUpdates(true);
    }, 3000);

    return () => clearTimeout(timeout);
  }, [isDesktopApp, isLicensed, checkForUpdates]);

  return {
    ...state,
    isLicensed,
    checkForUpdates,
    installUpdate,
    dismissUpdate,
    getAppVersion,
    showUpdateModal: isLicensed && state.updateAvailable && !state.dismissed,
  };
}
