import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import type { DashboardRowState, AnyPaneId } from '../types/terminal';

const STORAGE_KEY = 'mobile_terminal_dashboard';
const DASHBOARD_AUTO_ENABLE_KEY = 'mobile_terminal_dashboard_user_disabled';
const DASHBOARD_BREAKPOINT = 768;

// Type for tracking multiple active previews
export interface ActivePreview {
  port: number;
  url: string;
  paneId: AnyPaneId;
  sessionId: string;
  timestamp: number;
}

interface DashboardState {
  enabled: boolean;
  columnRatios: [number, number, number]; // [files, terminals, memory] as percentages
  terminalSplitRatio: number; // top terminal ratio (0-1)
  topRowState: DashboardRowState; // top row horizontal splits
  bottomRowState: DashboardRowState; // bottom row horizontal splits
  filesCollapsed: boolean; // whether files panel is collapsed
  memoryCollapsed: boolean; // whether memory panel is collapsed
  // Preview mode state (when localhost link is clicked in dashboard)
  previewMode: boolean;
  previewPort: number | null;
  previewUrl: string | null;
  previewTerminalPaneId: AnyPaneId | null; // which pane triggered preview
  previewSessionId: string | null; // sessionId for replica terminal sync
  // Multiple active previews tracking
  activePreviews: ActivePreview[];
}

interface DashboardContextType extends DashboardState {
  toggleDashboard: () => void;
  setEnabled: (enabled: boolean) => void;
  setColumnRatios: (ratios: [number, number, number]) => void;
  setTerminalSplitRatio: (ratio: number) => void;
  setColumnRatio: (index: number, newRatio: number, adjacentIndex: number) => void;
  // Row split methods
  splitRow: (rowId: 'top' | 'bottom') => void;
  unsplitRow: (rowId: 'top' | 'bottom') => void;
  setRowRatios: (rowId: 'top' | 'bottom', ratios: number[]) => void;
  // Panel collapse methods
  toggleFilesCollapsed: () => void;
  toggleMemoryCollapsed: () => void;
  // Preview mode methods
  enterPreviewMode: (port: number, url: string, paneId: AnyPaneId, sessionId: string) => void;
  exitPreviewMode: () => void;
  // Multiple preview methods
  addPreview: (port: number, url: string, paneId: AnyPaneId, sessionId: string) => void;
  removePreview: (port: number) => void;
  setCurrentPreview: (port: number) => void;
}

const defaultState: DashboardState = {
  enabled: false,
  columnRatios: [20, 55, 25], // 20% files, 55% terminals, 25% memory
  terminalSplitRatio: 0.667, // 2/3 top, 1/3 bottom
  topRowState: { paneCount: 1, ratios: [100] },
  bottomRowState: { paneCount: 1, ratios: [100] },
  filesCollapsed: false,
  memoryCollapsed: false,
  previewMode: false,
  previewPort: null,
  previewUrl: null,
  previewTerminalPaneId: null,
  previewSessionId: null,
  activePreviews: [],
};

const DashboardContext = createContext<DashboardContextType | null>(null);

function loadState(): DashboardState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        ...defaultState,
        ...parsed,
        // Force single panes per row (multi-pane feature disabled for now)
        topRowState: { paneCount: 1, ratios: [100] },
        bottomRowState: { paneCount: 1, ratios: [100] },
        // ALWAYS reset preview state - never persist across restarts
        // Preview state is ephemeral and tied to socket sessions
        previewMode: false,
        previewPort: null,
        previewUrl: null,
        previewTerminalPaneId: null,
        previewSessionId: null,
        activePreviews: [],
      };
    }
  } catch (e) {
    console.error('Failed to load dashboard state:', e);
  }
  return defaultState;
}

function saveState(state: DashboardState) {
  try {
    // Don't persist preview state - it's ephemeral and tied to socket sessions
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {
      previewMode, previewPort, previewUrl, previewTerminalPaneId,
      previewSessionId, activePreviews,
      ...persistableState
    } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistableState));
  } catch (e) {
    console.error('Failed to save dashboard state:', e);
  }
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DashboardState>(loadState);

  // Track if we've already auto-enabled dashboard this session
  const hasAutoEnabled = useRef(false);

  // Define setEnabled first since it's used by the auto-enable effects
  const setEnabled = useCallback((enabled: boolean) => {
    setState((prev) => ({
      ...prev,
      enabled,
    }));
  }, []);

  const toggleDashboard = useCallback(() => {
    setState((prev) => {
      const newEnabled = !prev.enabled;
      // If user manually disables dashboard, remember that preference
      if (!newEnabled) {
        localStorage.setItem(DASHBOARD_AUTO_ENABLE_KEY, 'true');
      }
      return {
        ...prev,
        enabled: newEnabled,
      };
    });
  }, []);

  // Save state changes to localStorage
  useEffect(() => {
    saveState(state);
  }, [state]);

  // Auto-enable dashboard on wide screens (on mount)
  useEffect(() => {
    if (hasAutoEnabled.current) return;

    // Check if user previously manually disabled dashboard
    const userDisabled = localStorage.getItem(DASHBOARD_AUTO_ENABLE_KEY) === 'true';
    if (userDisabled) return;

    // If already enabled via localStorage, don't need to auto-enable
    if (state.enabled) {
      hasAutoEnabled.current = true;
      return;
    }

    // Auto-enable on wide screens
    const isWideScreen = window.innerWidth >= DASHBOARD_BREAKPOINT;
    if (isWideScreen) {
      setEnabled(true);
      hasAutoEnabled.current = true;
    }
  }, [setEnabled]); // Include setEnabled in deps

  // Also listen for resize to auto-enable when window becomes wide
  useEffect(() => {
    const handleResize = () => {
      // Don't auto-enable if user manually disabled
      const userDisabled = localStorage.getItem(DASHBOARD_AUTO_ENABLE_KEY) === 'true';
      if (userDisabled) return;

      const isWideScreen = window.innerWidth >= DASHBOARD_BREAKPOINT;
      if (isWideScreen && !state.enabled) {
        setEnabled(true);
      }
      // Don't auto-disable when shrinking - keep dashboard, adjust layout
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [state.enabled, setEnabled]);

  const setColumnRatios = useCallback((ratios: [number, number, number]) => {
    // Ensure ratios sum to 100
    const total = ratios.reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 0.1) {
      console.warn('Column ratios should sum to 100');
    }
    setState((prev) => ({
      ...prev,
      columnRatios: ratios,
    }));
  }, []);

  const setColumnRatio = useCallback((index: number, newRatio: number, adjacentIndex: number) => {
    setState((prev) => {
      const newRatios = [...prev.columnRatios] as [number, number, number];
      const diff = newRatio - newRatios[index];
      newRatios[index] = newRatio;
      newRatios[adjacentIndex] = Math.max(10, newRatios[adjacentIndex] - diff);

      // Ensure minimum sizes
      const minSizes = [10, 20, 10]; // min percentages
      for (let i = 0; i < 3; i++) {
        if (newRatios[i] < minSizes[i]) {
          newRatios[i] = minSizes[i];
        }
      }

      // Normalize to 100%
      const total = newRatios.reduce((a, b) => a + b, 0);
      if (total !== 100) {
        const scale = 100 / total;
        newRatios[0] *= scale;
        newRatios[1] *= scale;
        newRatios[2] *= scale;
      }

      return {
        ...prev,
        columnRatios: newRatios,
      };
    });
  }, []);

  const setTerminalSplitRatio = useCallback((ratio: number) => {
    // Clamp ratio between 0.2 and 0.8
    const clamped = Math.max(0.2, Math.min(0.8, ratio));
    setState((prev) => ({
      ...prev,
      terminalSplitRatio: clamped,
    }));
  }, []);

  // Split a row to add another pane (max 3)
  const splitRow = useCallback((rowId: 'top' | 'bottom') => {
    setState((prev) => {
      const stateKey = rowId === 'top' ? 'topRowState' : 'bottomRowState';
      const currentState = prev[stateKey];

      if (currentState.paneCount >= 3) return prev; // Max 3 panes per row

      const newPaneCount = (currentState.paneCount + 1) as 1 | 2 | 3;
      // Distribute ratios evenly
      const evenRatio = 100 / newPaneCount;
      const newRatios = Array(newPaneCount).fill(evenRatio);

      return {
        ...prev,
        [stateKey]: {
          paneCount: newPaneCount,
          ratios: newRatios,
        },
      };
    });
  }, []);

  // Remove the rightmost pane from a row (min 1)
  const unsplitRow = useCallback((rowId: 'top' | 'bottom') => {
    setState((prev) => {
      const stateKey = rowId === 'top' ? 'topRowState' : 'bottomRowState';
      const currentState = prev[stateKey];

      if (currentState.paneCount <= 1) return prev; // Min 1 pane per row

      const newPaneCount = (currentState.paneCount - 1) as 1 | 2 | 3;
      // Distribute ratios evenly
      const evenRatio = 100 / newPaneCount;
      const newRatios = Array(newPaneCount).fill(evenRatio);

      return {
        ...prev,
        [stateKey]: {
          paneCount: newPaneCount,
          ratios: newRatios,
        },
      };
    });
  }, []);

  // Set custom ratios for a row's panes
  const setRowRatios = useCallback((rowId: 'top' | 'bottom', ratios: number[]) => {
    setState((prev) => {
      const stateKey = rowId === 'top' ? 'topRowState' : 'bottomRowState';
      const currentState = prev[stateKey];

      // Ensure ratios match pane count
      if (ratios.length !== currentState.paneCount) return prev;

      // Normalize ratios to sum to 100
      const total = ratios.reduce((a, b) => a + b, 0);
      const normalizedRatios = ratios.map(r => (r / total) * 100);

      return {
        ...prev,
        [stateKey]: {
          ...currentState,
          ratios: normalizedRatios,
        },
      };
    });
  }, []);

  // Toggle files panel collapsed state
  const toggleFilesCollapsed = useCallback(() => {
    setState((prev) => ({
      ...prev,
      filesCollapsed: !prev.filesCollapsed,
    }));
  }, []);

  // Toggle memory panel collapsed state
  const toggleMemoryCollapsed = useCallback(() => {
    setState((prev) => ({
      ...prev,
      memoryCollapsed: !prev.memoryCollapsed,
    }));
  }, []);

  // Add a preview to the active previews list (without entering preview mode)
  const addPreview = useCallback((port: number, url: string, paneId: AnyPaneId, sessionId: string) => {
    console.log('[Dashboard] Adding preview:', { port, url, paneId, sessionId: sessionId.slice(0, 8) });
    setState((prev) => {
      // Check if this port is already tracked
      const existing = prev.activePreviews.find(p => p.port === port);
      if (existing) {
        // Update existing entry
        return {
          ...prev,
          activePreviews: prev.activePreviews.map(p =>
            p.port === port
              ? { ...p, url, paneId, sessionId, timestamp: Date.now() }
              : p
          ),
        };
      }
      // Add new entry
      return {
        ...prev,
        activePreviews: [
          ...prev.activePreviews,
          { port, url, paneId, sessionId, timestamp: Date.now() },
        ],
      };
    });
  }, []);

  // Remove a preview from the active previews list
  const removePreview = useCallback((port: number) => {
    console.log('[Dashboard] Removing preview:', { port });
    setState((prev) => ({
      ...prev,
      activePreviews: prev.activePreviews.filter(p => p.port !== port),
      // If current preview was removed, close preview mode
      ...(prev.previewPort === port ? {
        previewMode: false,
        previewPort: null,
        previewUrl: null,
        previewTerminalPaneId: null,
        previewSessionId: null,
      } : {}),
    }));
  }, []);

  // Set which preview is currently being shown
  const setCurrentPreview = useCallback((port: number) => {
    setState((prev) => {
      const preview = prev.activePreviews.find(p => p.port === port);
      if (!preview) {
        console.warn('[Dashboard] setCurrentPreview - preview not found:', port);
        return prev;
      }
      return {
        ...prev,
        previewMode: true,
        previewPort: preview.port,
        previewUrl: preview.url,
        previewTerminalPaneId: preview.paneId,
        previewSessionId: preview.sessionId,
      };
    });
  }, []);

  // Enter preview mode - shows replica terminal + preview overlay
  // Also adds to activePreviews if not already tracked
  const enterPreviewMode = useCallback((port: number, url: string, paneId: AnyPaneId, sessionId: string) => {
    console.log('[Dashboard] Entering preview mode:', { port, url, paneId, sessionId: sessionId.slice(0, 8) });
    setState((prev) => {
      // Check if this port is already tracked
      const existing = prev.activePreviews.find(p => p.port === port);
      const newActivePreviews = existing
        ? prev.activePreviews.map(p =>
            p.port === port
              ? { ...p, url, paneId, sessionId, timestamp: Date.now() }
              : p
          )
        : [...prev.activePreviews, { port, url, paneId, sessionId, timestamp: Date.now() }];

      return {
        ...prev,
        previewMode: true,
        previewPort: port,
        previewUrl: url,
        previewTerminalPaneId: paneId,
        previewSessionId: sessionId,
        activePreviews: newActivePreviews,
      };
    });
  }, []);

  // Exit preview mode - returns to normal dashboard layout
  // Does NOT remove from activePreviews - allows re-opening
  const exitPreviewMode = useCallback(() => {
    console.log('[Dashboard] Exiting preview mode');
    setState((prev) => ({
      ...prev,
      previewMode: false,
      previewPort: null,
      previewUrl: null,
      previewTerminalPaneId: null,
      previewSessionId: null,
    }));
    // Trigger resize event to refocus terminal after preview closes
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 100);
  }, []);

  const value: DashboardContextType = {
    ...state,
    toggleDashboard,
    setEnabled,
    setColumnRatios,
    setTerminalSplitRatio,
    setColumnRatio,
    splitRow,
    unsplitRow,
    setRowRatios,
    toggleFilesCollapsed,
    toggleMemoryCollapsed,
    enterPreviewMode,
    exitPreviewMode,
    addPreview,
    removePreview,
    setCurrentPreview,
  };

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
}
