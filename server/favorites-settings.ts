import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface FavoritesSettings {
  favorites: string[];
  lastModified: number;
}

const DEFAULT_SETTINGS: FavoritesSettings = {
  favorites: [],
  lastModified: Date.now(),
};

// Store in home directory for persistence across app updates
const SETTINGS_DIR = path.join(os.homedir(), '.terminal-tunnel');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'favorites.json');

export async function getFavorites(): Promise<FavoritesSettings> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(data);

    // Validate favorites array - must be strings
    const favorites: string[] = Array.isArray(parsed.favorites)
      ? parsed.favorites.filter((f: unknown): f is string => typeof f === 'string')
      : [];

    return {
      favorites,
      lastModified: typeof parsed.lastModified === 'number' ? parsed.lastModified : Date.now(),
    };
  } catch {
    // File doesn't exist or parse error - return defaults
    return { ...DEFAULT_SETTINGS, lastModified: Date.now() };
  }
}

export async function saveFavorites(favorites: string[]): Promise<FavoritesSettings> {
  // Ensure directory exists
  await fs.mkdir(SETTINGS_DIR, { recursive: true });

  // Filter to ensure only valid strings
  const validFavorites = favorites.filter((f): f is string => typeof f === 'string');

  const settings: FavoritesSettings = {
    favorites: validFavorites,
    lastModified: Date.now(),
  };

  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  return settings;
}

export async function addFavorite(path: string): Promise<FavoritesSettings> {
  const current = await getFavorites();

  // Don't add duplicates
  if (current.favorites.includes(path)) {
    return current;
  }

  current.favorites.push(path);
  return saveFavorites(current.favorites);
}

export async function removeFavorite(pathToRemove: string): Promise<FavoritesSettings> {
  const current = await getFavorites();
  const newFavorites = current.favorites.filter(f => f !== pathToRemove);
  return saveFavorites(newFavorites);
}
