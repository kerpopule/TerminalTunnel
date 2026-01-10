import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { themes, defaultTheme, defaultFont, defaultFontSize, terminalFonts, Theme } from '../themes';
import { checkIsTauri, setTauriWindowBackground } from '../hooks/useDesktopApp';

const STORAGE_KEY = 'mobile_terminal_settings';

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
}

// Platform-aware defaults: keyboard shortcuts OFF on desktop, ON on mobile
const defaultSettings: Settings = {
  themeName: defaultTheme.name,
  fontFamily: defaultFont.value,
  fontSize: defaultFontSize,
  showKeybar: !checkIsTauri(),  // OFF on desktop (Tauri), ON on mobile (web)
  memoryEnabled: false,  // Memory disabled by default
  pinEnabled: false,  // PIN lock disabled by default
  pinHash: null,
  // License defaults (unlicensed)
  licenseKey: null,
  licenseEmail: null,
  licenseValidated: false,
  licenseValidatedAt: null,
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

function applyThemeToDocument(theme: Theme): void {
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

  // Update meta theme-color for mobile status bar and PWA
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', theme.bgPrimary);
  }

  // Update Tauri window background color for desktop title bar
  setTauriWindowBackground(theme.bgPrimary);
}

interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const theme = themes[settings.themeName] || defaultTheme;

  // Apply theme to document on mount and when theme changes
  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // Save settings whenever they change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const setTheme = useCallback((themeName: string) => {
    if (themes[themeName]) {
      setSettings(prev => ({ ...prev, themeName }));
    }
  }, []);

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
