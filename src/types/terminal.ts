/**
 * Terminal Tab Types
 * Defines the structure for split terminal functionality
 */

export interface TerminalTab {
  id: string;                    // UUID
  name: string;                  // Display name ("Shell 1", "Shell 2", etc.)
  sessionId: string | null;      // PTY session ID (null until connected)
}

/**
 * SyncedTab - Tab data synced between server and all clients
 * This is the canonical tab format used for real-time sync
 */
export interface SyncedTab {
  id: string;
  name: string;
  sessionId: string | null;
}

// Standard split pane IDs (for normal split mode)
export type PaneId = 'primary' | 'secondary';

// Dashboard-specific 6-pane grid IDs
export type DashboardPaneId =
  | 'top-left' | 'top-center' | 'top-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

// All possible pane IDs
export type AnyPaneId = PaneId | DashboardPaneId;

// Dashboard row configuration
export type DashboardRowId = 'top' | 'bottom';

export interface DashboardRowState {
  paneCount: 1 | 2 | 3;
  ratios: number[];  // Percentages for each pane
}

export interface TerminalPane {
  id: AnyPaneId;
  tabs: TerminalTab[];
  activeTabId: string | null;
}

// Dashboard pane (uses dashboard-specific ID)
export interface DashboardTerminalPane extends Omit<TerminalPane, 'id'> {
  id: DashboardPaneId;
}

export type SplitDirection = 'horizontal' | 'vertical';

export interface SplitState {
  enabled: boolean;
  panes: {
    primary: TerminalPane;
    secondary: TerminalPane;
  };
}

export const MAX_TABS_PER_PANE = 5;

export const STORAGE_KEYS = {
  SPLIT_STATE: 'mobile_terminal_split_state',
  TAB_SESSIONS: 'mobile_terminal_tab_sessions',
  DASHBOARD_PANES: 'mobile_terminal_dashboard_tabs',
} as const;

// All dashboard pane IDs in order
export const DASHBOARD_PANE_IDS: DashboardPaneId[] = [
  'top-left', 'top-center', 'top-right',
  'bottom-left', 'bottom-center', 'bottom-right'
];

/**
 * Type guard to check if a pane ID is a dashboard pane ID
 */
export function isDashboardPaneId(id: AnyPaneId): id is DashboardPaneId {
  return DASHBOARD_PANE_IDS.includes(id as DashboardPaneId);
}

/**
 * Get dashboard pane ID from row and position index
 */
export function getDashboardPaneId(rowId: DashboardRowId, index: number): DashboardPaneId {
  const positions = ['left', 'center', 'right'] as const;
  if (index < 0 || index > 2) {
    throw new Error(`Invalid pane index: ${index}. Must be 0, 1, or 2.`);
  }
  return `${rowId}-${positions[index]}` as DashboardPaneId;
}

/**
 * Create initial empty dashboard panes state
 */
export function createInitialDashboardPanes(): Record<DashboardPaneId, DashboardTerminalPane> {
  return Object.fromEntries(
    DASHBOARD_PANE_IDS.map(id => [id, { id, tabs: [], activeTabId: null }])
  ) as unknown as Record<DashboardPaneId, DashboardTerminalPane>;
}

/**
 * Helper to create a new terminal tab
 */
export function createTerminalTab(name: string): TerminalTab {
  return {
    id: crypto.randomUUID(),
    name,
    sessionId: null,
  };
}

/**
 * Helper to create initial split state with one tab
 */
export function createInitialSplitState(): SplitState {
  const initialTab = createTerminalTab('Shell 1');
  return {
    enabled: false,
    panes: {
      primary: {
        id: 'primary',
        tabs: [initialTab],
        activeTabId: initialTab.id,
      },
      secondary: {
        id: 'secondary',
        tabs: [],
        activeTabId: null,
      },
    },
  };
}

/**
 * Get the next shell number for naming new tabs (standard split mode)
 */
export function getNextShellNumber(state: SplitState): number {
  const allTabs = [...state.panes.primary.tabs, ...state.panes.secondary.tabs];
  return getNextShellNumberFromTabs(allTabs);
}

/**
 * Get the next shell number from an array of tabs
 */
export function getNextShellNumberFromTabs(tabs: TerminalTab[]): number {
  const numbers = tabs
    .map(tab => {
      const match = tab.name.match(/^Shell (\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter(n => n > 0);

  if (numbers.length === 0) return 1;
  return Math.max(...numbers) + 1;
}

/**
 * Get the next shell number including both split state and dashboard panes
 */
export function getNextShellNumberFromAll(
  splitState: SplitState,
  dashboardPanes: Record<DashboardPaneId, DashboardTerminalPane>
): number {
  const splitTabs = [...splitState.panes.primary.tabs, ...splitState.panes.secondary.tabs];
  const dashboardTabs = Object.values(dashboardPanes).flatMap(p => p.tabs);
  return getNextShellNumberFromTabs([...splitTabs, ...dashboardTabs]);
}
