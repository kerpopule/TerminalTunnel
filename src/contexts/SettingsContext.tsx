import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useMemo } from 'react';
import { themes, defaultTheme, defaultFont, defaultFontSize, terminalFonts, Theme } from '../themes';
import { checkIsTauri, setTauriWindowBackground } from '../hooks/useDesktopApp';
import { getDefaultShowKeybar } from '../utils/deviceDetection';

const STORAGE_KEY = 'mobile_terminal_settings';
const HAS_LOCAL_THEME_KEY = 'mobile_terminal_has_local_theme';

// Check if accessing via tunnel (not localhost)
function checkIsTunnelAccess(): boolean {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return hostname !== 'localhost' && hostname !== '127.0.0.1';
}

interface Settings {
  themeName: string;
  fontFamily: string;
  fontSize: number;
  showKeybar: boolean;
  memoryEnabled: boolean;
  pinEnabled: boolean;
  pinHash: string | null;
  // License fields
  licenseKey: string | null;
  licenseEmail: string | null;
  licenseValidated: boolean;
  licenseValidatedAt: number | null;
  // Terminal upload
  terminalUploadPath: string;
  // Claude integrations
  claudeMemInjectionEnabled: boolean;
}

interface SettingsContextType {
  theme: Theme;
  fontFamily: string;
  fontSize: number;
  showKeybar: boolean;
  memoryEnabled: boolean;
  pinEnabled: boolean;
  pinHash: string | null;
  // License fields
  licenseKey: string | null;
  licenseEmail: string | null;
  licenseValidated: boolean;
  licenseValidatedAt: number | null;
  // Setters
  setTheme: (themeName: string) => void;
  setFontFamily: (fontFamily: string) => void;
  setFontSize: (fontSize: number) => void;
  setShowKeybar: (show: boolean) => void;
  setMemoryEnabled: (enabled: boolean) => void;
  setPinEnabled: (enabled: boolean) => void;
  setPinHash: (hash: string | null) => void;
  // License setters
  setLicenseKey: (key: string | null) => void;
  setLicenseEmail: (email: string | null) => void;
  setLicenseValidated: (validated: boolean, timestamp?: number) => void;
  // Terminal upload
  terminalUploadPath: string;
  setTerminalUploadPath: (path: string) => void;
  // Claude integrations
  claudeMemInjectionEnabled: boolean;
  setClaudeMemInjectionEnabled: (enabled: boolean) => void;
}

// Platform-aware defaults: keyboard shortcuts OFF on desktop, ON on mobile
const defaultSettings: Settings = {
  themeName: defaultTheme.name,
  fontFamily: defaultFont.value,
  fontSize: defaultFontSize,
  showKeybar: getDefaultShowKeybar(),  // OFF for physical keyboard (desktop), ON for touch devices (iPad/mobile)
  memoryEnabled: true,  // Memory enabled by default
  pinEnabled: false,  // PIN lock disabled by default
  pinHash: null,
  // License defaults (unlicensed)
  licenseKey: null,
  licenseEmail: null,
  licenseValidated: false,
  licenseValidatedAt: null,
  // Terminal upload
  terminalUploadPath: 'Desktop/TerminalTunnel',
  // Claude integrations - defaults
  claudeMemInjectionEnabled: true,
};

const SettingsContext = createContext<SettingsContextType | null>(null);

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        themeName: parsed.themeName && themes[parsed.themeName] ? parsed.themeName : defaultSettings.themeName,
        fontFamily: parsed.fontFamily && terminalFonts.some(f => f.value === parsed.fontFamily)
          ? parsed.fontFamily
          : defaultSettings.fontFamily,
        fontSize: typeof parsed.fontSize === 'number' && parsed.fontSize >= 10 && parsed.fontSize <= 24
          ? parsed.fontSize
          : defaultSettings.fontSize,
        showKeybar: typeof parsed.showKeybar === 'boolean' ? parsed.showKeybar : defaultSettings.showKeybar,
        memoryEnabled: typeof parsed.memoryEnabled === 'boolean' ? parsed.memoryEnabled : defaultSettings.memoryEnabled,
        pinEnabled: typeof parsed.pinEnabled === 'boolean' ? parsed.pinEnabled : defaultSettings.pinEnabled,
        pinHash: typeof parsed.pinHash === 'string' ? parsed.pinHash : defaultSettings.pinHash,
        // License fields
        licenseKey: typeof parsed.licenseKey === 'string' ? parsed.licenseKey : defaultSettings.licenseKey,
        licenseEmail: typeof parsed.licenseEmail === 'string' ? parsed.licenseEmail : defaultSettings.licenseEmail,
        licenseValidated: typeof parsed.licenseValidated === 'boolean' ? parsed.licenseValidated : defaultSettings.licenseValidated,
        licenseValidatedAt: typeof parsed.licenseValidatedAt === 'number' ? parsed.licenseValidatedAt : defaultSettings.licenseValidatedAt,
        // Terminal upload
        terminalUploadPath: typeof parsed.terminalUploadPath === 'string' && parsed.terminalUploadPath.trim()
          ? parsed.terminalUploadPath
          : defaultSettings.terminalUploadPath,
        // Claude integrations
        claudeMemInjectionEnabled: typeof parsed.claudeMemInjectionEnabled === 'boolean' ? parsed.claudeMemInjectionEnabled : defaultSettings.claudeMemInjectionEnabled,
      };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return defaultSettings;
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// Convert hex color to rgba with alpha
function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(79, 70, 229, ${alpha})`; // fallback to purple
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function applyThemeToDocument(theme: Theme): void {
  const root = document.documentElement;
  root.style.setProperty('--bg-primary', theme.bgPrimary);
  root.style.setProperty('--bg-secondary', theme.bgSecondary);
  root.style.setProperty('--bg-tertiary', theme.bgTertiary);
  root.style.setProperty('--text-primary', theme.textPrimary);
  root.style.setProperty('--text-secondary', theme.textSecondary);
  root.style.setProperty('--text-muted', theme.textMuted);
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-hover', theme.accentHover);
  root.style.setProperty('--accent-10', hexToRgba(theme.accent, 0.1));
  root.style.setProperty('--accent-15', hexToRgba(theme.accent, 0.15));
  root.style.setProperty('--accent-20', hexToRgba(theme.accent, 0.2));
  root.style.setProperty('--accent-30', hexToRgba(theme.accent, 0.3));
  root.style.setProperty('--success', theme.success);
  root.style.setProperty('--error', theme.error);
  root.style.setProperty('--warning', theme.warning);
  root.style.setProperty('--border', theme.border);
  root.style.setProperty('--border-hover', theme.borderHover);

  // Note: meta theme-color tags are intentionally kept black for consistent browser chrome
  // This provides a clean, neutral appearance regardless of the app theme

  // Set background on html element for safe area coloring
  root.style.backgroundColor = theme.bgPrimary;
  // Set body background too for complete coverage
  document.body.style.backgroundColor = theme.bgPrimary;

  // Update Tauri window background color for desktop title bar
  setTauriWindowBackground(theme.bgPrimary);
}

interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [serverThemeApplied, setServerThemeApplied] = useState(false);

  const theme = themes[settings.themeName] || defaultTheme;
  const isTauri = useMemo(() => checkIsTauri(), []);
  const isTunnelAccess = useMemo(() => checkIsTunnelAccess(), []);

  // Apply theme to document on mount and when theme changes
  useEffect(() => {
    console.log('[Theme] Applying theme:', theme.name, 'bgPrimary:', theme.bgPrimary);
    applyThemeToDocument(theme);
  }, [theme]);

  // Save settings whenever they change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Fetch server theme for tunnel access (mobile)
  // Apply it only if user hasn't set a local preference
  useEffect(() => {
    if (!isTunnelAccess || serverThemeApplied) return;

    const hasLocalTheme = localStorage.getItem(HAS_LOCAL_THEME_KEY) === 'true';
    if (hasLocalTheme) {
      // User has already set a theme preference on this device, keep it
      setServerThemeApplied(true);
      return;
    }

    // Fetch server theme (desktop's theme)
    fetch('/api/pin-settings')
      .then(res => res.json())
      .then(data => {
        if (data.themeName && themes[data.themeName]) {
          // Apply server theme as the initial theme
          setSettings(prev => ({ ...prev, themeName: data.themeName }));
        }
        setServerThemeApplied(true);
      })
      .catch(err => {
        console.error('Failed to fetch server theme:', err);
        setServerThemeApplied(true);
      });
  }, [isTunnelAccess, serverThemeApplied]);

  // Sync theme to server when desktop (Tauri) changes theme
  const syncThemeToServer = useCallback((themeName: string) => {
    if (!isTauri) return;

    fetch('/api/pin-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeName }),
    }).catch(err => {
      console.error('Failed to sync theme to server:', err);
    });
  }, [isTauri]);

  const setTheme = useCallback((themeName: string) => {
    console.log('[Theme] setTheme called with:', themeName);
    if (themes[themeName]) {
      setSettings(prev => ({ ...prev, themeName }));

      // If on tunnel access (mobile), mark that user has a local preference
      // and force a page reload to update browser chrome colors
      if (isTunnelAccess) {
        localStorage.setItem(HAS_LOCAL_THEME_KEY, 'true');
        // Delay reload to ensure settings are saved to localStorage first
        setTimeout(() => window.location.reload(), 100);
      }

      // If on desktop (Tauri), sync theme to server for tunnel clients
      if (isTauri) {
        syncThemeToServer(themeName);
      }
    }
  }, [isTunnelAccess, isTauri, syncThemeToServer]);

  const setFontFamily = useCallback((fontFamily: string) => {
    if (terminalFonts.some(f => f.value === fontFamily)) {
      setSettings(prev => ({ ...prev, fontFamily }));
    }
  }, []);

  const setFontSize = useCallback((fontSize: number) => {
    if (fontSize >= 10 && fontSize <= 24) {
      setSettings(prev => ({ ...prev, fontSize }));
    }
  }, []);

  const setShowKeybar = useCallback((showKeybar: boolean) => {
    setSettings(prev => ({ ...prev, showKeybar }));
  }, []);

  const setMemoryEnabled = useCallback((memoryEnabled: boolean) => {
    setSettings(prev => ({ ...prev, memoryEnabled }));
  }, []);

  const setPinEnabled = useCallback((pinEnabled: boolean) => {
    setSettings(prev => ({ ...prev, pinEnabled }));
  }, []);

  const setPinHash = useCallback((pinHash: string | null) => {
    setSettings(prev => ({ ...prev, pinHash }));
  }, []);

  const setLicenseKey = useCallback((licenseKey: string | null) => {
    setSettings(prev => ({ ...prev, licenseKey }));
  }, []);

  const setLicenseEmail = useCallback((licenseEmail: string | null) => {
    setSettings(prev => ({ ...prev, licenseEmail }));
  }, []);

  const setLicenseValidated = useCallback((licenseValidated: boolean, timestamp?: number) => {
    setSettings(prev => ({
      ...prev,
      licenseValidated,
      licenseValidatedAt: timestamp ?? (licenseValidated ? Date.now() : null),
    }));
  }, []);

  const setTerminalUploadPath = useCallback((terminalUploadPath: string) => {
    setSettings(prev => ({ ...prev, terminalUploadPath: terminalUploadPath.trim() || defaultSettings.terminalUploadPath }));
  }, []);

  const setClaudeMemInjectionEnabled = useCallback((claudeMemInjectionEnabled: boolean) => {
    setSettings(prev => ({ ...prev, claudeMemInjectionEnabled }));
  }, []);

  const value: SettingsContextType = {
    theme,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    showKeybar: settings.showKeybar,
    memoryEnabled: settings.memoryEnabled,
    pinEnabled: settings.pinEnabled,
    pinHash: settings.pinHash,
    // License fields
    licenseKey: settings.licenseKey,
    licenseEmail: settings.licenseEmail,
    licenseValidated: settings.licenseValidated,
    licenseValidatedAt: settings.licenseValidatedAt,
    // Setters
    setTheme,
    setFontFamily,
    setFontSize,
    setShowKeybar,
    setMemoryEnabled,
    setPinEnabled,
    setPinHash,
    setLicenseKey,
    setLicenseEmail,
    setLicenseValidated,
    // Terminal upload
    terminalUploadPath: settings.terminalUploadPath,
    setTerminalUploadPath,
    // Claude integrations
    claudeMemInjectionEnabled: settings.claudeMemInjectionEnabled,
    setClaudeMemInjectionEnabled,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextType {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
