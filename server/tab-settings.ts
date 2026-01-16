import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

export interface SyncedTab {
  id: string;
  name: string;
  sessionId: string | null;
}

interface TabSettings {
  tabs: SyncedTab[];
  lastModified: number;
}

const DEFAULT_TAB: SyncedTab = {
  id: uuidv4(),
  name: 'Shell 1',
  sessionId: null,
};

const DEFAULT_SETTINGS: TabSettings = {
  tabs: [DEFAULT_TAB],
  lastModified: Date.now(),
};

// Store in home directory for persistence across app updates
const SETTINGS_DIR = path.join(os.homedir(), '.terminal-tunnel');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'tabs.json');

// Maximum number of tabs allowed
const MAX_TABS = 10;

export async function getTabSettings(): Promise<TabSettings> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(data);

    // Validate and sanitize tabs array
    const tabs: SyncedTab[] = Array.isArray(parsed.tabs)
      ? parsed.tabs
          .filter((tab: unknown): tab is SyncedTab =>
            typeof tab === 'object' &&
            tab !== null &&
            typeof (tab as SyncedTab).id === 'string' &&
            typeof (tab as SyncedTab).name === 'string'
          )
          .map((tab: SyncedTab) => ({
            id: tab.id,
            name: tab.name,
            sessionId: typeof tab.sessionId === 'string' ? tab.sessionId : null,
          }))
      : [];

    // Ensure at least one tab exists
    if (tabs.length === 0) {
      tabs.push({ ...DEFAULT_TAB, id: uuidv4() });
    }

    return {
      tabs,
      lastModified: typeof parsed.lastModified === 'number' ? parsed.lastModified : Date.now(),
    };
  } catch {
    // File doesn't exist or parse error - return defaults with fresh UUID
    return {
      tabs: [{ ...DEFAULT_TAB, id: uuidv4() }],
      lastModified: Date.now(),
    };
  }
}

export async function saveTabSettings(settings: TabSettings): Promise<TabSettings> {
  // Ensure directory exists
  await fs.mkdir(SETTINGS_DIR, { recursive: true });

  const updated: TabSettings = {
    ...settings,
    lastModified: Date.now(),
  };

  await fs.writeFile(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

export async function addTab(name?: string, id?: string): Promise<{ tabs: SyncedTab[]; newTab: SyncedTab }> {
  const current = await getTabSettings();

  // Enforce max tabs
  if (current.tabs.length >= MAX_TABS) {
    throw new Error(`Maximum of ${MAX_TABS} tabs allowed`);
  }

  // Check if tab with this ID already exists (idempotency check)
  if (id && current.tabs.some(t => t.id === id)) {
    const existingTab = current.tabs.find(t => t.id === id)!;
    return { tabs: current.tabs, newTab: existingTab };
  }

  // Generate name if not provided
  const tabNumber = current.tabs.length + 1;
  const newTab: SyncedTab = {
    id: id || uuidv4(),  // Use client-provided ID if available
    name: name || `Shell ${tabNumber}`,
    sessionId: null,
  };

  current.tabs.push(newTab);
  await saveTabSettings(current);

  return { tabs: current.tabs, newTab };
}

export async function removeTab(tabId: string): Promise<{ tabs: SyncedTab[]; removedId: string; autoCreated?: SyncedTab }> {
  const current = await getTabSettings();
  const index = current.tabs.findIndex(t => t.id === tabId);

  if (index === -1) {
    throw new Error(`Tab ${tabId} not found`);
  }

  current.tabs.splice(index, 1);

  // Auto-create a tab if this was the last one
  let autoCreated: SyncedTab | undefined;
  if (current.tabs.length === 0) {
    autoCreated = {
      id: uuidv4(),
      name: 'Shell 1',
      sessionId: null,
    };
    current.tabs.push(autoCreated);
  }

  await saveTabSettings(current);

  return { tabs: current.tabs, removedId: tabId, autoCreated };
}

export async function renameTab(tabId: string, newName: string): Promise<{ tabs: SyncedTab[]; tab: SyncedTab }> {
  const current = await getTabSettings();
  const tab = current.tabs.find(t => t.id === tabId);

  if (!tab) {
    throw new Error(`Tab ${tabId} not found`);
  }

  const trimmedName = newName.trim();
  if (!trimmedName) {
    throw new Error('Tab name cannot be empty');
  }

  tab.name = trimmedName;
  await saveTabSettings(current);

  return { tabs: current.tabs, tab };
}

export async function setTabSessionId(tabId: string, sessionId: string | null): Promise<SyncedTab | null> {
  const current = await getTabSettings();
  const tab = current.tabs.find(t => t.id === tabId);

  if (!tab) {
    return null;
  }

  tab.sessionId = sessionId;
  await saveTabSettings(current);

  return tab;
}

export async function getTabBySessionId(sessionId: string): Promise<SyncedTab | null> {
  const current = await getTabSettings();
  return current.tabs.find(t => t.sessionId === sessionId) || null;
}

/**
 * Reset tabs to default state (single Shell 1 tab)
 * Called during onboarding to clear stale server state
 */
export async function resetTabs(): Promise<TabSettings> {
  const freshTab: SyncedTab = {
    id: uuidv4(),
    name: 'Shell 1',
    sessionId: null,
  };

  const settings: TabSettings = {
    tabs: [freshTab],
    lastModified: Date.now(),
  };

  await saveTabSettings(settings);
  return settings;
}
