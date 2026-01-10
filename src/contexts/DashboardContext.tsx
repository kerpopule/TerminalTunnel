import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { DashboardRowState } from '../types/terminal';

const STORAGE_KEY = 'mobile_terminal_dashboard';

interface DashboardState {
  enabled: boolean;
  columnRatios: [number, number, number]; // [files, terminals, memory] as percentages
  terminalSplitRatio: number; // top terminal ratio (0-1)
  topRowState: DashboardRowState; // top row horizontal splits
  bottomRowState: DashboardRowState; // bottom row horizontal splits
  filesCollapsed: boolean; // whether files panel is collapsed
  memoryCollapsed: boolean; // whether memory panel is collapsed
}

interface DashboardContextType extends DashboardState {
  toggleDashboard: () => void;
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
}

const defaultState: DashboardState = {
  enabled: false,
  columnRatios: [20, 55, 25], // 20% files, 55% terminals, 25% memory
  terminalSplitRatio: 0.667, // 2/3 top, 1/3 bottom
  topRowState: { paneCount: 1, ratios: [100] },
  bottomRowState: { paneCount: 1, ratios: [100] },
  filesCollapsed: false,
  memoryCollapsed: false,
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
      };
    }
  } catch (e) {
    console.error('Failed to load dashboard state:', e);
  }
  return defaultState;
}

function saveState(state: DashboardState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save dashboard state:', e);
  }
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DashboardState>(loadState);

  // Save state changes to localStorage
  useEffect(() => {
    saveState(state);
  }, [state]);

  const toggleDashboard = useCallback(() => {
    setState((prev) => ({
      ...prev,
      enabled: !prev.enabled,
    }));
  }, []);

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

  const value: DashboardContextType = {
    ...state,
    toggleDashboard,
    setColumnRatios,
    setTerminalSplitRatio,
    setColumnRatio,
    splitRow,
    unsplitRow,
    setRowRatios,
    toggleFilesCollapsed,
    toggleMemoryCollapsed,
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
