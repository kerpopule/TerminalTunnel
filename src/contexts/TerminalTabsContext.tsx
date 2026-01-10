import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { useResponsiveSplit } from '../hooks/useResponsiveSplit';
import {
  TerminalTab,
  TerminalPane,
  SplitState,
  SplitDirection,
  PaneId,
  AnyPaneId,
  DashboardPaneId,
  DashboardTerminalPane,
  MAX_TABS_PER_PANE,
  STORAGE_KEYS,
  createTerminalTab,
  createInitialSplitState,
  createInitialDashboardPanes,
  getNextShellNumber,
  getNextShellNumberFromAll,
  isDashboardPaneId,
} from '../types/terminal';

interface TerminalTabsContextType {
  // State
  splitState: SplitState;
  splitDirection: SplitDirection;
  socket: Socket | null;
  lastActivePaneId: AnyPaneId;
  dashboardPanes: Record<DashboardPaneId, DashboardTerminalPane>;

  // Actions
  toggleSplit: () => void;
  createTab: (paneId: AnyPaneId) => string | null;
  closeTab: (paneId: AnyPaneId, tabId: string) => void;
  switchTab: (paneId: AnyPaneId, tabId: string) => void;
  moveTab: (fromPane: AnyPaneId, toPane: AnyPaneId, tabId: string, targetIndex?: number) => void;
  setSessionId: (tabId: string, sessionId: string) => void;
  reorderTabs: (paneId: AnyPaneId, sourceIndex: number, destinationIndex: number) => void;
  setLastActivePane: (paneId: AnyPaneId) => void;
  writeToActiveTerminal: (data: string) => void;
  renameTab: (tabId: string, newName: string) => void;

  // Dashboard-specific actions
  initializeDashboardPane: (paneId: DashboardPaneId) => void;
  initializeMultipleDashboardPanes: (paneIds: DashboardPaneId[]) => void;
  mergeDashboardPane: (removedPaneId: DashboardPaneId, targetPaneId: DashboardPaneId) => void;

  // Helpers
  getActiveTab: (paneId: AnyPaneId) => TerminalTab | null;
  getLastActiveTerminalId: () => string | null;
  canCreateTab: (paneId: AnyPaneId) => boolean;
  getAllTabs: () => TerminalTab[];
  getPaneState: (paneId: AnyPaneId) => TerminalPane | DashboardTerminalPane | null;
}

const TerminalTabsContext = createContext<TerminalTabsContextType | null>(null);

interface TerminalTabsProviderProps {
  children: React.ReactNode;
  socket: Socket | null;
}

// Load state from localStorage
function loadSplitState(): SplitState {
  // Clear stale session mappings - PTY sessions don't survive page refresh
  try {
    localStorage.removeItem(STORAGE_KEYS.TAB_SESSIONS);
    // Also clear any corrupted split state - start fresh
    localStorage.removeItem(STORAGE_KEYS.SPLIT_STATE);
  } catch (e) {
    // Ignore
  }

  // Always start fresh with a clean state
  return createInitialSplitState();
}

// Save state to localStorage
function saveSplitState(state: SplitState): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SPLIT_STATE, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save split state:', e);
  }
}

// Save session mappings
function saveSessionMappings(state: SplitState): void {
  try {
    const mappings: Record<string, string> = {};
    const allTabs = [...state.panes.primary.tabs, ...state.panes.secondary.tabs];
    for (const tab of allTabs) {
      if (tab.sessionId) {
        mappings[tab.id] = tab.sessionId;
      }
    }
    localStorage.setItem(STORAGE_KEYS.TAB_SESSIONS, JSON.stringify(mappings));
  } catch (e) {
    console.error('Failed to save session mappings:', e);
  }
}

// Load dashboard panes from localStorage
function loadDashboardPanes(): Record<DashboardPaneId, DashboardTerminalPane> {
  // Clear any corrupted state - start fresh
  try {
    localStorage.removeItem(STORAGE_KEYS.DASHBOARD_PANES);
  } catch (e) {
    // Ignore
  }
  return createInitialDashboardPanes();
}

// Save dashboard panes to localStorage
function saveDashboardPanes(panes: Record<DashboardPaneId, DashboardTerminalPane>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DASHBOARD_PANES, JSON.stringify(panes));
  } catch (e) {
    console.error('Failed to save dashboard panes:', e);
  }
}

export function TerminalTabsProvider({ children, socket }: TerminalTabsProviderProps) {
  const [splitState, setSplitState] = useState<SplitState>(loadSplitState);
  const [dashboardPanes, setDashboardPanes] = useState<Record<DashboardPaneId, DashboardTerminalPane>>(loadDashboardPanes);
  const [lastActivePaneId, setLastActivePaneId] = useState<AnyPaneId>('primary');
  const splitDirection = useResponsiveSplit();
  const isInitialized = useRef(false);
  const isDashboardInitialized = useRef(false);

  // Persist split state changes
  useEffect(() => {
    if (isInitialized.current) {
      saveSplitState(splitState);
      saveSessionMappings(splitState);
    } else {
      isInitialized.current = true;
    }
  }, [splitState]);

  // Persist dashboard panes changes
  useEffect(() => {
    if (isDashboardInitialized.current) {
      saveDashboardPanes(dashboardPanes);
    } else {
      isDashboardInitialized.current = true;
    }
  }, [dashboardPanes]);

  // Ensure there's always at least one tab in the primary pane
  useEffect(() => {
    if (splitState.panes.primary.tabs.length === 0) {
      const nextNum = getNextShellNumber(splitState);
      const newTab = createTerminalTab(`Shell ${nextNum}`);
      setSplitState(prev => ({
        ...prev,
        panes: {
          ...prev.panes,
          primary: {
            ...prev.panes.primary,
            tabs: [newTab],
            activeTabId: newTab.id,
          },
        },
      }));
    }
  }, [splitState.panes.primary.tabs.length]);

  // Toggle split mode
  const toggleSplit = useCallback(() => {
    setSplitState(prev => {
      if (prev.enabled) {
        // Disabling split - merge tabs from secondary into primary
        const primaryTabs = [...prev.panes.primary.tabs];
        const secondaryTabs = prev.panes.secondary.tabs;

        // Merge: primary tabs first, then secondary tabs
        const mergedTabs = [...primaryTabs, ...secondaryTabs];

        // Determine active tab (prefer primary's active, fallback to first tab)
        const activeTabId = prev.panes.primary.activeTabId || mergedTabs[0]?.id || null;

        // Also merge dashboard panes (bottom into top)
        setDashboardPanes(dashPrev => {
          const topPane = dashPrev['top-left'];
          const bottomPane = dashPrev['bottom-left'];
          const mergedDashTabs = [...topPane.tabs, ...bottomPane.tabs];
          const dashActiveTabId = topPane.activeTabId || mergedDashTabs[0]?.id || null;

          return {
            ...dashPrev,
            'top-left': {
              ...topPane,
              tabs: mergedDashTabs,
              activeTabId: dashActiveTabId,
            },
            'bottom-left': {
              ...bottomPane,
              tabs: [],
              activeTabId: null,
            },
          };
        });

        return {
          enabled: false,
          panes: {
            primary: {
              id: 'primary',
              tabs: mergedTabs,
              activeTabId,
            },
            secondary: {
              id: 'secondary',
              tabs: [],
              activeTabId: null,
            },
          },
        };
      } else {
        // Enabling split - create a new tab in secondary pane
        const nextNum = getNextShellNumber(prev);
        const newTab = createTerminalTab(`Shell ${nextNum}`);

        // Also create a new tab in bottom-left dashboard pane
        setDashboardPanes(dashPrev => {
          const bottomPane = dashPrev['bottom-left'];
          // Only add if bottom pane is empty
          if (bottomPane.tabs.length === 0) {
            const dashNewTab = createTerminalTab(`Shell ${nextNum + 1}`);
            return {
              ...dashPrev,
              'bottom-left': {
                ...bottomPane,
                tabs: [dashNewTab],
                activeTabId: dashNewTab.id,
              },
            };
          }
          return dashPrev;
        });

        return {
          enabled: true,
          panes: {
            primary: prev.panes.primary,
            secondary: {
              id: 'secondary',
              tabs: [newTab],
              activeTabId: newTab.id,
            },
          },
        };
      }
    });
  }, []);

  // Create a new tab in a pane (supports both regular and dashboard panes)
  const createTab = useCallback((paneId: AnyPaneId): string | null => {
    let newTabId: string | null = null;

    if (isDashboardPaneId(paneId)) {
      // Dashboard pane
      setDashboardPanes(prev => {
        const pane = prev[paneId];
        if (pane.tabs.length >= MAX_TABS_PER_PANE) {
          return prev;
        }

        const nextNum = getNextShellNumberFromAll(splitState, prev);
        const newTab = createTerminalTab(`Shell ${nextNum}`);
        newTabId = newTab.id;

        return {
          ...prev,
          [paneId]: {
            ...pane,
            tabs: [...pane.tabs, newTab],
            activeTabId: newTab.id,
          },
        };
      });
    } else {
      // Regular split pane
      setSplitState(prev => {
        const pane = prev.panes[paneId];
        if (pane.tabs.length >= MAX_TABS_PER_PANE) {
          return prev;
        }

        const nextNum = getNextShellNumberFromAll(prev, dashboardPanes);
        const newTab = createTerminalTab(`Shell ${nextNum}`);
        newTabId = newTab.id;

        return {
          ...prev,
          panes: {
            ...prev.panes,
            [paneId]: {
              ...pane,
              tabs: [...pane.tabs, newTab],
              activeTabId: newTab.id,
            },
          },
        };
      });
    }

    return newTabId;
  }, [splitState, dashboardPanes]);

  // Close a tab (supports both regular and dashboard panes)
  const closeTab = useCallback((paneId: AnyPaneId, tabId: string) => {
    if (isDashboardPaneId(paneId)) {
      // Dashboard pane
      setDashboardPanes(prev => {
        const pane = prev[paneId];
        const tabIndex = pane.tabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) return prev;

        const newTabs = pane.tabs.filter(t => t.id !== tabId);

        // Determine new active tab
        let newActiveTabId = pane.activeTabId;
        if (pane.activeTabId === tabId) {
          if (newTabs.length > 0) {
            const newIndex = Math.min(tabIndex, newTabs.length - 1);
            newActiveTabId = newTabs[newIndex].id;
          } else {
            newActiveTabId = null;
          }
        }

        // If closing the last tab in a row's main pane, auto-disable split
        // top-left is the main pane for top row, bottom-left for bottom row
        if (newTabs.length === 0 && (paneId === 'top-left' || paneId === 'bottom-left')) {
          const bottomPane = prev['bottom-left'];
          const topPane = prev['top-left'];

          // If closing top row and bottom has tabs, move bottom tabs to top
          if (paneId === 'top-left' && bottomPane.tabs.length > 0) {
            // Move bottom tabs to top, clear bottom
            setTimeout(() => {
              setSplitState(splitPrev => {
                if (!splitPrev.enabled) return splitPrev;
                return { ...splitPrev, enabled: false };
              });
            }, 0);

            return {
              ...prev,
              'top-left': {
                ...topPane,
                tabs: bottomPane.tabs,
                activeTabId: bottomPane.activeTabId,
              },
              'bottom-left': {
                ...bottomPane,
                tabs: [],
                activeTabId: null,
              },
            };
          }

          // If closing bottom row (or top row with no bottom tabs), just disable split
          setTimeout(() => {
            setSplitState(splitPrev => {
              if (!splitPrev.enabled) return splitPrev;
              return { ...splitPrev, enabled: false };
            });
          }, 0);
        }

        return {
          ...prev,
          [paneId]: {
            ...pane,
            tabs: newTabs,
            activeTabId: newActiveTabId,
          },
        };
      });
    } else {
      // Regular split pane
      setSplitState(prev => {
        const pane = prev.panes[paneId];
        const tabIndex = pane.tabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) return prev;

        const newTabs = pane.tabs.filter(t => t.id !== tabId);

        // If closing the last tab in secondary pane, auto-disable split
        if (paneId === 'secondary' && newTabs.length === 0) {
          return {
            enabled: false,
            panes: {
              primary: prev.panes.primary,
              secondary: {
                id: 'secondary',
                tabs: [],
                activeTabId: null,
              },
            },
          };
        }

        // If closing the last tab in primary pane while secondary has tabs,
        // move secondary tabs to primary and disable split
        if (paneId === 'primary' && newTabs.length === 0 && prev.panes.secondary.tabs.length > 0) {
          return {
            enabled: false,
            panes: {
              primary: {
                id: 'primary',
                tabs: prev.panes.secondary.tabs,
                activeTabId: prev.panes.secondary.activeTabId,
              },
              secondary: {
                id: 'secondary',
                tabs: [],
                activeTabId: null,
              },
            },
          };
        }

        // Determine new active tab
        let newActiveTabId = pane.activeTabId;
        if (pane.activeTabId === tabId) {
          if (newTabs.length > 0) {
            const newIndex = Math.min(tabIndex, newTabs.length - 1);
            newActiveTabId = newTabs[newIndex].id;
          } else {
            newActiveTabId = null;
          }
        }

        return {
          ...prev,
          panes: {
            ...prev.panes,
            [paneId]: {
              ...pane,
              tabs: newTabs,
              activeTabId: newActiveTabId,
            },
          },
        };
      });
    }
  }, []);

  // Switch to a tab (supports both regular and dashboard panes)
  const switchTab = useCallback((paneId: AnyPaneId, tabId: string) => {
    if (isDashboardPaneId(paneId)) {
      setDashboardPanes(prev => {
        const pane = prev[paneId];
        if (!pane.tabs.find(t => t.id === tabId)) return prev;

        return {
          ...prev,
          [paneId]: {
            ...pane,
            activeTabId: tabId,
          },
        };
      });
    } else {
      setSplitState(prev => {
        const pane = prev.panes[paneId];
        if (!pane.tabs.find(t => t.id === tabId)) return prev;

        return {
          ...prev,
          panes: {
            ...prev.panes,
            [paneId]: {
              ...pane,
              activeTabId: tabId,
            },
          },
        };
      });
    }
  }, []);

  // Move a tab between panes (supports both regular and dashboard panes)
  // Note: Cross-type moves (regular <-> dashboard) are not currently supported
  const moveTab = useCallback((fromPane: AnyPaneId, toPane: AnyPaneId, tabId: string, targetIndex?: number) => {
    const fromIsDashboard = isDashboardPaneId(fromPane);
    const toIsDashboard = isDashboardPaneId(toPane);

    // Dashboard pane moves
    if (fromIsDashboard && toIsDashboard) {
      setDashboardPanes(prev => {
        const sourcePane = prev[fromPane as DashboardPaneId];
        const targetPane = prev[toPane as DashboardPaneId];

        const tab = sourcePane.tabs.find(t => t.id === tabId);
        if (!tab) return prev;

        if (targetPane.tabs.length >= MAX_TABS_PER_PANE) return prev;

        const newSourceTabs = sourcePane.tabs.filter(t => t.id !== tabId);
        const insertIndex = targetIndex ?? targetPane.tabs.length;
        const newTargetTabs = [...targetPane.tabs];
        newTargetTabs.splice(insertIndex, 0, tab);

        let newSourceActiveTabId = sourcePane.activeTabId;
        if (sourcePane.activeTabId === tabId) {
          const tabIdx = sourcePane.tabs.findIndex(t => t.id === tabId);
          newSourceActiveTabId = newSourceTabs.length > 0
            ? newSourceTabs[Math.min(tabIdx, newSourceTabs.length - 1)].id
            : null;
        }

        return {
          ...prev,
          [fromPane]: { ...sourcePane, tabs: newSourceTabs, activeTabId: newSourceActiveTabId },
          [toPane]: { ...targetPane, tabs: newTargetTabs, activeTabId: tab.id },
        };
      });
      return;
    }

    // Regular split pane moves
    if (!fromIsDashboard && !toIsDashboard) {
      setSplitState(prev => {
        const sourcePaneState = prev.panes[fromPane as PaneId];
        const targetPaneState = prev.panes[toPane as PaneId];

        const tab = sourcePaneState.tabs.find(t => t.id === tabId);
        if (!tab) return prev;

        if (targetPaneState.tabs.length >= MAX_TABS_PER_PANE) return prev;

        const newSourceTabs = sourcePaneState.tabs.filter(t => t.id !== tabId);

        // If source pane becomes empty (secondary), disable split
        if (fromPane === 'secondary' && newSourceTabs.length === 0) {
          const insertIndex = targetIndex ?? targetPaneState.tabs.length;
          const newTargetTabs = [...targetPaneState.tabs];
          newTargetTabs.splice(insertIndex, 0, tab);

          return {
            enabled: false,
            panes: {
              primary: { ...targetPaneState, tabs: newTargetTabs, activeTabId: tab.id },
              secondary: { id: 'secondary', tabs: [], activeTabId: null },
            },
          };
        }

        const insertIndex = targetIndex ?? targetPaneState.tabs.length;
        const newTargetTabs = [...targetPaneState.tabs];
        newTargetTabs.splice(insertIndex, 0, tab);

        let newSourceActiveTabId = sourcePaneState.activeTabId;
        if (sourcePaneState.activeTabId === tabId) {
          const tabIdx = sourcePaneState.tabs.findIndex(t => t.id === tabId);
          newSourceActiveTabId = newSourceTabs.length > 0
            ? newSourceTabs[Math.min(tabIdx, newSourceTabs.length - 1)].id
            : null;
        }

        return {
          ...prev,
          panes: {
            ...prev.panes,
            [fromPane]: { ...sourcePaneState, tabs: newSourceTabs, activeTabId: newSourceActiveTabId },
            [toPane]: { ...targetPaneState, tabs: newTargetTabs, activeTabId: tab.id },
          } as SplitState['panes'],
        };
      });
    }
    // Cross-type moves (regular <-> dashboard) are not supported
  }, []);

  // Reorder tabs within a pane (supports both regular and dashboard panes)
  const reorderTabs = useCallback((paneId: AnyPaneId, sourceIndex: number, destinationIndex: number) => {
    if (isDashboardPaneId(paneId)) {
      setDashboardPanes(prev => {
        const pane = prev[paneId];
        const newTabs = [...pane.tabs];
        const [removed] = newTabs.splice(sourceIndex, 1);
        newTabs.splice(destinationIndex, 0, removed);

        return {
          ...prev,
          [paneId]: { ...pane, tabs: newTabs },
        };
      });
    } else {
      setSplitState(prev => {
        const pane = prev.panes[paneId];
        const newTabs = [...pane.tabs];
        const [removed] = newTabs.splice(sourceIndex, 1);
        newTabs.splice(destinationIndex, 0, removed);

        return {
          ...prev,
          panes: {
            ...prev.panes,
            [paneId]: { ...pane, tabs: newTabs },
          },
        };
      });
    }
  }, []);

  // Set session ID for a tab (searches both split and dashboard panes)
  const setSessionId = useCallback((tabId: string, sessionId: string) => {
    const updateTab = (tabs: TerminalTab[]): TerminalTab[] => {
      return tabs.map(tab =>
        tab.id === tabId ? { ...tab, sessionId } : tab
      );
    };

    // Try to update in split state
    setSplitState(prev => ({
      ...prev,
      panes: {
        primary: { ...prev.panes.primary, tabs: updateTab(prev.panes.primary.tabs) },
        secondary: { ...prev.panes.secondary, tabs: updateTab(prev.panes.secondary.tabs) },
      },
    }));

    // Also try to update in dashboard panes
    setDashboardPanes(prev => {
      const updated = { ...prev };
      for (const paneId of Object.keys(prev) as DashboardPaneId[]) {
        updated[paneId] = { ...prev[paneId], tabs: updateTab(prev[paneId].tabs) };
      }
      return updated;
    });
  }, []);

  // Rename a tab (searches both split and dashboard panes)
  const renameTab = useCallback((tabId: string, newName: string) => {
    const trimmedName = newName.trim();
    if (!trimmedName) return;

    const updateTab = (tabs: TerminalTab[]): TerminalTab[] => {
      return tabs.map(tab =>
        tab.id === tabId ? { ...tab, name: trimmedName } : tab
      );
    };

    // Try to update in split state
    setSplitState(prev => ({
      ...prev,
      panes: {
        primary: { ...prev.panes.primary, tabs: updateTab(prev.panes.primary.tabs) },
        secondary: { ...prev.panes.secondary, tabs: updateTab(prev.panes.secondary.tabs) },
      },
    }));

    // Also try to update in dashboard panes
    setDashboardPanes(prev => {
      const updated = { ...prev };
      for (const paneId of Object.keys(prev) as DashboardPaneId[]) {
        updated[paneId] = { ...prev[paneId], tabs: updateTab(prev[paneId].tabs) };
      }
      return updated;
    });
  }, []);

  // Get active tab for a pane (supports both regular and dashboard panes)
  const getActiveTab = useCallback((paneId: AnyPaneId): TerminalTab | null => {
    if (isDashboardPaneId(paneId)) {
      const pane = dashboardPanes[paneId];
      if (!pane.activeTabId) return null;
      return pane.tabs.find(t => t.id === pane.activeTabId) || null;
    } else {
      const pane = splitState.panes[paneId];
      if (!pane.activeTabId) return null;
      return pane.tabs.find(t => t.id === pane.activeTabId) || null;
    }
  }, [splitState, dashboardPanes]);

  // Check if can create more tabs (supports both regular and dashboard panes)
  const canCreateTab = useCallback((paneId: AnyPaneId): boolean => {
    if (isDashboardPaneId(paneId)) {
      return dashboardPanes[paneId].tabs.length < MAX_TABS_PER_PANE;
    }
    return splitState.panes[paneId].tabs.length < MAX_TABS_PER_PANE;
  }, [splitState, dashboardPanes]);

  // Get all tabs across all panes (split + dashboard)
  const getAllTabs = useCallback((): TerminalTab[] => {
    const splitTabs = [...splitState.panes.primary.tabs, ...splitState.panes.secondary.tabs];
    const dashTabs = Object.values(dashboardPanes).flatMap(p => p.tabs);
    return [...splitTabs, ...dashTabs];
  }, [splitState, dashboardPanes]);

  // Get pane state for any pane ID
  const getPaneState = useCallback((paneId: AnyPaneId): TerminalPane | DashboardTerminalPane | null => {
    if (isDashboardPaneId(paneId)) {
      return dashboardPanes[paneId];
    }
    return splitState.panes[paneId] || null;
  }, [splitState, dashboardPanes]);

  // Set the last active pane (called when user interacts with a pane)
  const setLastActivePane = useCallback((paneId: AnyPaneId) => {
    setLastActivePaneId(paneId);
  }, []);

  // Get the terminal ID of the last active pane's active tab
  const getLastActiveTerminalId = useCallback((): string | null => {
    if (isDashboardPaneId(lastActivePaneId)) {
      const pane = dashboardPanes[lastActivePaneId];
      if (pane.activeTabId) return pane.activeTabId;
      // Fall back to primary split pane
      return splitState.panes.primary.activeTabId;
    } else {
      const pane = splitState.panes[lastActivePaneId as PaneId];
      if (!pane.activeTabId && lastActivePaneId === 'secondary') {
        return splitState.panes.primary.activeTabId;
      }
      return pane.activeTabId;
    }
  }, [splitState, dashboardPanes, lastActivePaneId]);

  // Write data to the active terminal in the last active pane
  const writeToActiveTerminal = useCallback((data: string) => {
    const terminalId = getLastActiveTerminalId();
    if (!terminalId || !socket) return;
    socket.emit('terminal:input', { terminalId, data });
  }, [socket, getLastActiveTerminalId]);

  // Initialize a dashboard pane with one tab (called when pane becomes visible)
  const initializeDashboardPane = useCallback((paneId: DashboardPaneId) => {
    setDashboardPanes(prev => {
      if (prev[paneId].tabs.length > 0) return prev; // Already initialized
      const nextNum = getNextShellNumberFromAll(splitState, prev);
      const newTab = createTerminalTab(`Shell ${nextNum}`);
      return {
        ...prev,
        [paneId]: { ...prev[paneId], tabs: [newTab], activeTabId: newTab.id },
      };
    });
  }, [splitState]);

  // Initialize multiple dashboard panes at once (batch operation to avoid race conditions)
  const initializeMultipleDashboardPanes = useCallback((paneIds: DashboardPaneId[]) => {
    setDashboardPanes(prev => {
      let updated = false;
      const newState = { ...prev };
      let currentShellNum = getNextShellNumberFromAll(splitState, prev);

      for (const paneId of paneIds) {
        if (newState[paneId].tabs.length === 0) {
          const newTab = createTerminalTab(`Shell ${currentShellNum}`);
          newState[paneId] = { ...newState[paneId], tabs: [newTab], activeTabId: newTab.id };
          currentShellNum++;
          updated = true;
        }
      }

      return updated ? newState : prev;
    });
  }, [splitState]);

  // Merge tabs from removed pane into target pane
  const mergeDashboardPane = useCallback((removedPaneId: DashboardPaneId, targetPaneId: DashboardPaneId) => {
    setDashboardPanes(prev => {
      const removedTabs = prev[removedPaneId].tabs;
      if (removedTabs.length === 0) return prev;

      const targetTabs = [...prev[targetPaneId].tabs, ...removedTabs];
      // Keep existing active tab or use first merged tab
      const targetActiveTabId = prev[targetPaneId].activeTabId || targetTabs[0]?.id || null;

      return {
        ...prev,
        [removedPaneId]: { ...prev[removedPaneId], tabs: [], activeTabId: null },
        [targetPaneId]: { ...prev[targetPaneId], tabs: targetTabs, activeTabId: targetActiveTabId },
      };
    });
  }, []);

  const value: TerminalTabsContextType = {
    splitState,
    splitDirection,
    socket,
    lastActivePaneId,
    dashboardPanes,
    toggleSplit,
    createTab,
    closeTab,
    switchTab,
    moveTab,
    setSessionId,
    reorderTabs,
    setLastActivePane,
    writeToActiveTerminal,
    renameTab,
    initializeDashboardPane,
    initializeMultipleDashboardPanes,
    mergeDashboardPane,
    getActiveTab,
    getLastActiveTerminalId,
    canCreateTab,
    getAllTabs,
    getPaneState,
  };

  return (
    <TerminalTabsContext.Provider value={value}>
      {children}
    </TerminalTabsContext.Provider>
  );
}

export function useTerminalTabs(): TerminalTabsContextType {
  const context = useContext(TerminalTabsContext);
  if (!context) {
    throw new Error('useTerminalTabs must be used within a TerminalTabsProvider');
  }
  return context;
}
