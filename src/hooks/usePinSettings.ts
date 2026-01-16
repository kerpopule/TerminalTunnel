import { useState, useEffect, useCallback } from 'react';

interface ServerPinSettings {
  pinEnabled: boolean;
  pinHash: string | null;
  themeName: string | null;
}

interface UsePinSettingsResult {
  serverPinEnabled: boolean | null;
  serverPinHash: string | null;
  serverThemeName: string | null;
  isLoading: boolean;
  error: string | null;
  refreshSettings: () => Promise<void>;
  updateServerSettings: (pinEnabled: boolean, pinHash: string | null) => Promise<boolean>;
  updateServerTheme: (themeName: string) => Promise<boolean>;
}

export function usePinSettings(): UsePinSettingsResult {
  const [settings, setSettings] = useState<ServerPinSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/pin-settings');
      if (!response.ok) {
        throw new Error('Failed to fetch PIN settings');
      }

      const data = await response.json();
      setSettings(data);
    } catch (err) {
      console.error('Failed to fetch PIN settings:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      // Default to disabled if we can't reach server
      setSettings({ pinEnabled: false, pinHash: null, themeName: null });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateServerSettings = useCallback(async (
    pinEnabled: boolean,
    pinHash: string | null
  ): Promise<boolean> => {
    try {
      const response = await fetch('/api/pin-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pinEnabled, pinHash }),
      });

      if (!response.ok) {
        throw new Error('Failed to update PIN settings');
      }

      const data = await response.json();
      setSettings(data);
      return true;
    } catch (err) {
      console.error('Failed to update PIN settings:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  const updateServerTheme = useCallback(async (themeName: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/pin-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ themeName }),
      });

      if (!response.ok) {
        throw new Error('Failed to update theme');
      }

      const data = await response.json();
      setSettings(data);
      return true;
    } catch (err) {
      console.error('Failed to update server theme:', err);
      return false;
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return {
    serverPinEnabled: settings?.pinEnabled ?? null,
    serverPinHash: settings?.pinHash ?? null,
    serverThemeName: settings?.themeName ?? null,
    isLoading,
    error,
    refreshSettings: fetchSettings,
    updateServerSettings,
    updateServerTheme,
  };
}
