import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface PinSettings {
  pinEnabled: boolean;
  pinHash: string | null;
  themeName: string | null;
  updatedAt: number | null;
}

const DEFAULT_SETTINGS: PinSettings = {
  pinEnabled: false,
  pinHash: null,
  themeName: 'ropic',
  updatedAt: null,
};

// Store in home directory for persistence across app updates
const SETTINGS_DIR = path.join(os.homedir(), '.terminal-tunnel');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'pin-settings.json');

export async function getPinSettings(): Promise<PinSettings> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return {
      pinEnabled: typeof parsed.pinEnabled === 'boolean' ? parsed.pinEnabled : false,
      pinHash: typeof parsed.pinHash === 'string' ? parsed.pinHash : null,
      themeName: typeof parsed.themeName === 'string' ? parsed.themeName : 'ropic',
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : null,
    };
  } catch {
    // File doesn't exist or parse error - return defaults
    return DEFAULT_SETTINGS;
  }
}

export async function savePinSettings(settings: Partial<PinSettings>): Promise<PinSettings> {
  // Ensure directory exists
  await fs.mkdir(SETTINGS_DIR, { recursive: true });

  const current = await getPinSettings();
  const updated: PinSettings = {
    ...current,
    ...settings,
    updatedAt: Date.now(),
  };

  await fs.writeFile(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}
