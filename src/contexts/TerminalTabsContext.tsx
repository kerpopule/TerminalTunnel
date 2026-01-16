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
  SyncedTab,
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
  // PTY sessions DO survive on the server - load saved state to restore sessions
  try {
    const savedState = localStorage.getItem(STORAGE_KEYS.SPLIT_STATE);
    const savedSessions = localStorage.getItem(STORAGE_KEYS.TAB_SESSIONS);

    if (savedState) {
      const parsed = JSON.parse(savedState) as SplitState;

      // Restore session IDs from saved mappings
      if (savedSessions) {
        const sessionMappings = JSON.parse(savedSessions) as Record<string, string>;

        // Apply session IDs to tabs
        for (const pane of Object.values(parsed.panes)) {
          for (const tab of pane.tabs) {
            if (sessionMappings[tab.id]) {
              tab.sessionId = sessionMappings[tab.id];
            }
          }
        }
      }

      console.log('[Terminal] Restored split state with sessions');
      return parsed;
    }
  } catch (e) {
    console.error('Failed to load split state:', e);
  }

  // No saved state - start fresh
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

// Save session mappings from both split state and dashboard panes
function saveSessionMappings(
  state: SplitState,
  dashboardPanes?: Record<DashboardPaneId, DashboardTerminalPane>
): void {
  try {
    const mappings: Record<string, string> = {};

    // Get tabs from split state
    const splitTabs = [...state.panes.primary.tabs, ...state.panes.secondary.tabs];
    for (const tab of splitTabs) {
      if (tab.sessionId) {
        mappings[tab.id] = tab.sessionId;
      }
    }

    // Get tabs from dashboard panes if provided
    if (dashboardPanes) {
      for (const pane of Object.values(dashboardPanes)) {
        for (const tab of pane.tabs) {
          if (tab.sessionId) {
            mappings[tab.id] = tab.sessionId;
          }
        }
      }
    }

    localStorage.setItem(STORAGE_KEYS.TAB_SESSIONS, JSON.stringify(mappings));
  } catch (e) {
    console.error('Failed to save session mappings:', e);
  }
}

// Load dashboard panes from localStorage
function loadDashboardPanes(): Record<DashboardPaneId, DashboardTerminalPane> {
  // PTY sessions DO survive on the server - load saved state to restore sessions
  try {
    const savedPanes = localStorage.getItem(STORAGE_KEYS.DASHBOARD_PANES);
    const savedSessions = localStorage.getItem(STORAGE_KEYS.TAB_SESSIONS);

    if (savedPanes) {
      const parsed = JSON.parse(savedPanes) as Record<DashboardPaneId, DashboardTerminalPane>;

      // Restore session IDs from saved mappings
      if (savedSessions) {
        const sessionMappings = JSON.parse(savedSessions) as Record<string, string>;

        // Apply session IDs to dashboard tabs
        for (const pane of Object.values(parsed)) {
          for (const tab of pane.tabs) {
            if (sessionMappings[tab.id]) {
              tab.sessionId = sessionMappings[tab.id];
            }
          }
        }
      }

      console.log('[Terminal] Restored dashboard panes with sessions');
      return parsed;
    }
  } catch (e) {
    console.error('Failed to load dashboard panes:', e);
  }

  // No saved state - start fresh
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

  // Ref to prevent race conditions during split toggle operations
  // When true, tabs:sync will be skipped to prevent overwriting in-flight changes
  const isTogglingRef = useRef(false);

  // Ref to prevent race conditions during tab creation
  // When true, tabs:sync will be skipped to prevent overwriting newly created tabs
  const isCreatingTabRef = useRef(false);

  // Track which pane a tab is being created in, so tabs:sync handler knows where to place it
  // Key: tab ID, Value: pane ID where the tab was created
  const pendingTabPaneRef = useRef<Map<string, AnyPaneId>>(new Map());

  // Refs to track current state for socket sync (avoids stale closure issues)
  const splitStateRef = useRef(splitState);
  const dashboardPanesRef = useRef(dashboardPanes);
  splitStateRef.current = splitState;
  dashboardPanesRef.current = dashboardPanes;

  // Persist split state changes
  useEffect(() => {
    if (isInitialized.current) {
      saveSplitState(splitState);
      saveSessionMappings(splitState, dashboardPanes);
    } else {
      isInitialized.current = true;
    }
  }, [splitState, dashboardPanes]);

  // Persist dashboard panes changes
  useEffect(() => {
    if (isDashboardInitialized.current) {
      saveDashboardPanes(dashboardPanes);
      saveSessionMappings(splitState, dashboardPanes);
    } else {
      isDashboardInitialized.current = true;
    }
  }, [dashboardPanes, splitState]);

  // Socket sync for real-time tab synchronization
  // All clients share the same tab list, managed by the server
  useEffect(() => {
    if (!socket) return;

    // Request initial tab state on socket connect
    const handleConnect = () => {
      console.log('[TabSync] Socket connected, requesting tab state');
      socket.emit('tabs:request');
    };

    // Handle full tab sync from server
    const handleTabsSync = (data: { tabs: SyncedTab[]; lastModified: number }) => {
      // Skip sync during toggle or tab creation operations to prevent race conditions
      // These operations create tabs locally and emit to server, but
      // a stale tabs:sync could arrive before the server processes our tab:create
      if (isTogglingRef.current) {
        console.log('[TabSync] Skipping sync during toggle operation');
        return;
      }
      if (isCreatingTabRef.current) {
        console.log('[TabSync] Skipping sync during tab creation');
        return;
      }

      console.log('[TabSync] Received tabs sync:', data.tabs.length, 'tabs');

      // Use refs to get current state (avoids stale closure issues)
      const currentSplitState = splitStateRef.current;
      const currentDashboardPanes = dashboardPanesRef.current;

      // Build a map of all local tabs by ID
      const localTabsMap = new Map<string, { tab: TerminalTab; paneId: AnyPaneId }>();

      // Collect from split state
      for (const tab of currentSplitState.panes.primary.tabs) {
        localTabsMap.set(tab.id, { tab, paneId: 'primary' });
      }
      for (const tab of currentSplitState.panes.secondary.tabs) {
        localTabsMap.set(tab.id, { tab, paneId: 'secondary' });
      }
      // Collect from dashboard panes
      for (const paneId of Object.keys(currentDashboardPanes) as DashboardPaneId[]) {
        for (const tab of currentDashboardPanes[paneId].tabs) {
          localTabsMap.set(tab.id, { tab, paneId });
        }
      }

      // Build synced tabs map
      const syncedTabsMap = new Map<string, SyncedTab>();
      for (const tab of data.tabs) {
        syncedTabsMap.set(tab.id, tab);
      }

      // Find tabs to add (in sync but not local)
      const tabsToAdd: SyncedTab[] = [];
      for (const [id, syncedTab] of syncedTabsMap) {
        if (!localTabsMap.has(id)) {
          tabsToAdd.push(syncedTab);
        }
      }

      // Find tabs to remove (local but not in sync)
      const tabsToRemove: string[] = [];
      for (const [id] of localTabsMap) {
        if (!syncedTabsMap.has(id)) {
          tabsToRemove.push(id);
        }
      }

      // Find tabs to update (name or sessionId changed)
      const tabsToUpdate: SyncedTab[] = [];
      for (const [id, syncedTab] of syncedTabsMap) {
        const local = localTabsMap.get(id);
        if (local && (local.tab.name !== syncedTab.name || local.tab.sessionId !== syncedTab.sessionId)) {
          tabsToUpdate.push(syncedTab);
        }
      }

      // Apply updates to split state
      setSplitState(prev => {
        let updated = { ...prev };
        let primaryTabs = [...prev.panes.primary.tabs];
        let secondaryTabs = [...prev.panes.secondary.tabs];

        // Remove tabs
        for (const id of tabsToRemove) {
          primaryTabs = primaryTabs.filter(t => t.id !== id);
          secondaryTabs = secondaryTabs.filter(t => t.id !== id);
        }

        // Update tabs
        for (const syncedTab of tabsToUpdate) {
          primaryTabs = primaryTabs.map(t =>
            t.id === syncedTab.id ? { ...t, name: syncedTab.name, sessionId: syncedTab.sessionId } : t
          );
          secondaryTabs = secondaryTabs.map(t =>
            t.id === syncedTab.id ? { ...t, name: syncedTab.name, sessionId: syncedTab.sessionId } : t
          );
        }

        // Add new tabs to the correct pane (check pending pane assignments first)
        for (const syncedTab of tabsToAdd) {
          const newTabData = { id: syncedTab.id, name: syncedTab.name, sessionId: syncedTab.sessionId };
          const assignedPane = pendingTabPaneRef.current.get(syncedTab.id);

          if (assignedPane && !isDashboardPaneId(assignedPane)) {
            // Tab was created locally with a known pane - place it there
            if (assignedPane === 'secondary' && prev.enabled && secondaryTabs.length < MAX_TABS_PER_PANE) {
              secondaryTabs.push(newTabData);
            } else if (primaryTabs.length < MAX_TABS_PER_PANE) {
              primaryTabs.push(newTabData);
            }
            // Clean up the pending assignment
            pendingTabPaneRef.current.delete(syncedTab.id);
          } else if (!assignedPane) {
            // No pending assignment - external tab, add to primary by default
            if (primaryTabs.length < MAX_TABS_PER_PANE) {
              primaryTabs.push(newTabData);
            } else if (secondaryTabs.length < MAX_TABS_PER_PANE && prev.enabled) {
              secondaryTabs.push(newTabData);
            }
          }
          // If assignedPane is a dashboard pane, skip here (handled in dashboard sync below)
        }

        // Ensure at least one tab in primary
        if (primaryTabs.length === 0 && secondaryTabs.length === 0) {
          // This shouldn't happen as server auto-creates, but just in case
          const defaultTab = createTerminalTab('Shell 1');
          primaryTabs.push(defaultTab);
        }

        // Update active tab IDs if the active tab was removed
        let primaryActiveTabId = prev.panes.primary.activeTabId;
        if (primaryActiveTabId && !primaryTabs.find(t => t.id === primaryActiveTabId)) {
          primaryActiveTabId = primaryTabs[0]?.id || null;
        }

        let secondaryActiveTabId = prev.panes.secondary.activeTabId;
        if (secondaryActiveTabId && !secondaryTabs.find(t => t.id === secondaryActiveTabId)) {
          secondaryActiveTabId = secondaryTabs[0]?.id || null;
        }

        // IMPORTANT: Don't auto-disable split during sync operations
        // The split state should be preserved - only user action should toggle it
        // If secondary becomes empty during sync, the fallback effect will create a new tab
        updated = {
          ...prev,  // Preserve enabled state
          panes: {
            primary: { ...prev.panes.primary, tabs: primaryTabs, activeTabId: primaryActiveTabId },
            secondary: { ...prev.panes.secondary, tabs: secondaryTabs, activeTabId: secondaryActiveTabId },
          },
        };

        return updated;
      });

      // Apply updates to dashboard panes
      setDashboardPanes(prev => {
        const updated = { ...prev };

        // First, build a set of all existing tab IDs in dashboard panes
        const existingDashboardTabIds = new Set<string>();
        for (const paneId of Object.keys(prev) as DashboardPaneId[]) {
          for (const tab of prev[paneId].tabs) {
            existingDashboardTabIds.add(tab.id);
          }
        }

        for (const paneId of Object.keys(prev) as DashboardPaneId[]) {
          let paneTabs = [...prev[paneId].tabs];

          // Remove tabs
          for (const id of tabsToRemove) {
            paneTabs = paneTabs.filter(t => t.id !== id);
          }

          // Update tabs
          for (const syncedTab of tabsToUpdate) {
            paneTabs = paneTabs.map(t =>
              t.id === syncedTab.id ? { ...t, name: syncedTab.name, sessionId: syncedTab.sessionId } : t
            );
          }

          // Update active tab ID if removed
          let activeTabId = prev[paneId].activeTabId;
          if (activeTabId && !paneTabs.find(t => t.id === activeTabId)) {
            activeTabId = paneTabs[0]?.id || null;
          }

          updated[paneId] = { ...prev[paneId], tabs: paneTabs, activeTabId };
        }

        // Add new tabs to the correct dashboard pane (check pending pane assignments first)
        // Only add if tab doesn't already exist in any dashboard pane
        for (const syncedTab of tabsToAdd) {
          if (!existingDashboardTabIds.has(syncedTab.id)) {
            const newTabData = { id: syncedTab.id, name: syncedTab.name, sessionId: syncedTab.sessionId };
            const assignedPane = pendingTabPaneRef.current.get(syncedTab.id);

            if (assignedPane && isDashboardPaneId(assignedPane)) {
              // Tab was created locally with a known dashboard pane - place it there
              const targetPane = updated[assignedPane];
              if (targetPane.tabs.length < MAX_TABS_PER_PANE) {
                targetPane.tabs.push(newTabData);
                if (!targetPane.activeTabId) {
                  targetPane.activeTabId = syncedTab.id;
                }
              }
              // Clean up the pending assignment
              pendingTabPaneRef.current.delete(syncedTab.id);
            } else if (!assignedPane) {
              // No pending assignment - external tab, add to top-left by default
              const topLeftPane = updated['top-left'];
              if (topLeftPane.tabs.length < MAX_TABS_PER_PANE) {
                topLeftPane.tabs.push(newTabData);
                if (!topLeftPane.activeTabId) {
                  topLeftPane.activeTabId = syncedTab.id;
                }
              }
            }
            // If assignedPane is a split pane, skip here (handled in split sync above)
          }
        }

        return updated;
      });
    };

    // Handle session ID updates
    const handleSessionUpdated = (data: { tabId: string; sessionId: string | null }) => {
      console.log('[TabSync] Session updated:', data.tabId, data.sessionId);

      const updateTab = (tabs: TerminalTab[]): TerminalTab[] => {
        return tabs.map(tab =>
          tab.id === data.tabId ? { ...tab, sessionId: data.sessionId } : tab
        );
      };

      setSplitState(prev => ({
        ...prev,
        panes: {
          primary: { ...prev.panes.primary, tabs: updateTab(prev.panes.primary.tabs) },
          secondary: { ...prev.panes.secondary, tabs: updateTab(prev.panes.secondary.tabs) },
        },
      }));

      setDashboardPanes(prev => {
        const updated = { ...prev };
        for (const paneId of Object.keys(prev) as DashboardPaneId[]) {
          updated[paneId] = { ...prev[paneId], tabs: updateTab(prev[paneId].tabs) };
        }
        return updated;
      });
    };

    // Set up listeners
    socket.on('connect', handleConnect);
    socket.on('tabs:sync', handleTabsSync);
    socket.on('tab:session-updated', handleSessionUpdated);

    // If already connected, request state
    if (socket.connected) {
      socket.emit('tabs:request');
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('tabs:sync', handleTabsSync);
      socket.off('tab:session-updated', handleSessionUpdated);
    };
  }, [socket]); // Note: we intentionally don't include splitState/dashboardPanes to avoid infinite loops

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
  // REDESIGNED: Single source of truth for split tab management
  // - Uses isTogglingRef to prevent race conditions with tabs:sync
  // - Creates exactly ONE tab when enabling split
  // - No fallback effects should interfere (they are removed)
  const toggleSplit = useCallback(() => {
    // Prevent rapid clicking - debounce
    if (isTogglingRef.current) {
      console.log('[toggleSplit] Already toggling, ignoring click');
      return;
    }

    // Set toggle lock BEFORE any state changes
    isTogglingRef.current = true;
    console.log('[toggleSplit] Toggle operation started');

    setSplitState(prev => {
      if (prev.enabled) {
        // DISABLING SPLIT: Merge secondary tabs into primary
        console.log('[toggleSplit] Disabling split, merging tabs');
        const mergedTabs = [...prev.panes.primary.tabs, ...prev.panes.secondary.tabs];
        const activeTabId = prev.panes.primary.activeTabId || mergedTabs[0]?.id || null;

        // Also merge dashboard panes (bottom into top) - do this in same render cycle
        setDashboardPanes(dashPrev => {
          const topPane = dashPrev['top-left'];
          const bottomPane = dashPrev['bottom-left'];
          const mergedDashTabs = [...topPane.tabs, ...bottomPane.tabs];
          const dashActiveTabId = topPane.activeTabId || mergedDashTabs[0]?.id || null;

          return {
            ...dashPrev,
            'top-left': { ...topPane, tabs: mergedDashTabs, activeTabId: dashActiveTabId },
            'bottom-left': { ...bottomPane, tabs: [], activeTabId: null },
          };
        });

        return {
          enabled: false,
          panes: {
            primary: { id: 'primary', tabs: mergedTabs, activeTabId },
            secondary: { id: 'secondary', tabs: [], activeTabId: null },
          },
        };
      } else {
        // ENABLING SPLIT: Create exactly ONE tab in secondary pane
        console.log('[toggleSplit] Enabling split, creating one tab in secondary');
        const nextNum = getNextShellNumber(prev);
        const newTab = createTerminalTab(`Shell ${nextNum}`);

        // Emit to server IMMEDIATELY so tabs:sync doesn't remove this tab
        if (socket?.connected) {
          console.log('[toggleSplit] Emitting tab:create for:', newTab.id.slice(0, 8));
          socket.emit('tab:create', { id: newTab.id, name: newTab.name });
        }

        // Also create tab in bottom-left dashboard pane if empty
        setDashboardPanes(dashPrev => {
          const bottomPane = dashPrev['bottom-left'];
          if (bottomPane.tabs.length === 0) {
            const dashNextNum = nextNum + 1;
            const dashNewTab = createTerminalTab(`Shell ${dashNextNum}`);
            if (socket?.connected) {
              console.log('[toggleSplit] Emitting tab:create for dashboard:', dashNewTab.id.slice(0, 8));
              socket.emit('tab:create', { id: dashNewTab.id, name: dashNewTab.name });
            }
            return {
              ...dashPrev,
              'bottom-left': { ...bottomPane, tabs: [dashNewTab], activeTabId: dashNewTab.id },
            };
          }
          return dashPrev;
        });

        return {
          enabled: true,
          panes: {
            primary: prev.panes.primary,
            secondary: { id: 'secondary', tabs: [newTab], activeTabId: newTab.id },
          },
        };
      }
    });

    // Release toggle lock after state settles (give React time to flush updates)
    // This also allows time for the server to receive and process our tab:create
    setTimeout(() => {
      isTogglingRef.current = false;
      console.log('[toggleSplit] Toggle operation complete, lock released');
    }, 300);
  }, [socket]);

  // Create a new tab in a pane (supports both regular and dashboard panes)
  // Emits tab:create to server which broadcasts to all clients
  const createTab = useCallback((paneId: AnyPaneId): string | null => {
    // Set lock to prevent sync from interfering with tab creation
    isCreatingTabRef.current = true;
    console.log('[createTab] Creating tab in pane:', paneId);

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

        // Record which pane this tab belongs to, so sync handler places it correctly
        pendingTabPaneRef.current.set(newTab.id, paneId);

        // Emit to server with ID - server will use this ID for sync
        if (socket?.connected) {
          socket.emit('tab:create', { id: newTab.id, name: newTab.name });
        }

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

        // Record which pane this tab belongs to, so sync handler places it correctly
        pendingTabPaneRef.current.set(newTab.id, paneId);

        // Emit to server with ID - server will use this ID for sync
        if (socket?.connected) {
          socket.emit('tab:create', { id: newTab.id, name: newTab.name });
        }

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

    // Release lock after state settles (give React time to flush updates)
    // This also allows time for the server to receive and process our tab:create
    setTimeout(() => {
      isCreatingTabRef.current = false;
      console.log('[createTab] Tab creation complete, lock released');
    }, 300);

    return newTabId;
  }, [splitState, dashboardPanes, socket]);

  // Close a tab (supports both regular and dashboard panes)
  // Emits tab:close to server which broadcasts to all clients
  const closeTab = useCallback((paneId: AnyPaneId, tabId: string) => {
    // Emit to server - server will broadcast to all clients
    if (socket?.connected) {
      socket.emit('tab:close', { tabId });
    }

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
  }, [socket]);

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
  // Emits tab:set-session to server which broadcasts to all clients
  const setSessionId = useCallback((tabId: string, sessionId: string) => {
    console.log('[TerminalTabs] setSessionId called:', { tabId: tabId.slice(0, 8), sessionId: sessionId.slice(0, 8) });

    // Emit to server - server will broadcast to all clients
    if (socket?.connected) {
      socket.emit('tab:set-session', { tabId, sessionId });
    }

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
  }, [socket]);

  // Rename a tab (searches both split and dashboard panes)
  // Emits tab:rename to server which broadcasts to all clients
  const renameTab = useCallback((tabId: string, newName: string) => {
    const trimmedName = newName.trim();
    if (!trimmedName) return;

    // Emit to server - server will broadcast to all clients
    if (socket?.connected) {
      socket.emit('tab:rename', { tabId, newName: trimmedName });
    }

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
  }, [socket]);

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

  // CRITICAL FALLBACK: Ensure dashboard panes always have at least one tab
  // This runs when top-left pane becomes empty (including after socket sync)
  // Prevents the app from being unusable if socket fails or sync clears all tabs
  const topLeftTabsLength = dashboardPanes['top-left']?.tabs.length ?? 0;
  useEffect(() => {
    // Only run if top-left is actually empty
    if (topLeftTabsLength === 0) {
      console.log('[TabsContext] FALLBACK: Creating tab for empty top-left pane');
      setDashboardPanes(prev => {
        const topLeftPane = prev['top-left'];
        // Double-check in case state changed
        if (topLeftPane.tabs.length > 0) return prev;

        const currentShellNum = getNextShellNumberFromAll(splitState, prev);
        const newTab = createTerminalTab(`Shell ${currentShellNum}`);
        return {
          ...prev,
          'top-left': { ...topLeftPane, tabs: [newTab], activeTabId: newTab.id },
        };
      });
    }
  }, [topLeftTabsLength, splitState]); // Re-run when top-left tabs become empty

  // NOTE: Removed fallback effects that auto-created tabs when split was enabled.
  // These caused duplicate tab creation and race conditions with tabs:sync.
  // toggleSplit is now the SINGLE source of truth for creating split tabs.

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
