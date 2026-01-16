import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface CustomCommand {
  name?: string;
  command: string;
}

interface CommandsSettings {
  commands: CustomCommand[];
  lastModified: number;
}

const DEFAULT_SETTINGS: CommandsSettings = {
  commands: [],
  lastModified: Date.now(),
};

// Store in home directory for persistence across app updates
const SETTINGS_DIR = path.join(os.homedir(), '.terminal-tunnel');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'commands.json');

export async function getCommands(): Promise<CommandsSettings> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(data);

    // Validate commands array
    const commands: CustomCommand[] = Array.isArray(parsed.commands)
      ? parsed.commands.filter((c: unknown): c is CustomCommand =>
          typeof c === 'object' && c !== null && typeof (c as CustomCommand).command === 'string'
        )
      : [];

    return {
      commands,
      lastModified: typeof parsed.lastModified === 'number' ? parsed.lastModified : Date.now(),
    };
  } catch {
    // File doesn't exist or parse error - return defaults
    return { ...DEFAULT_SETTINGS, lastModified: Date.now() };
  }
}

export async function saveCommands(commands: CustomCommand[]): Promise<CommandsSettings> {
  // Ensure directory exists
  await fs.mkdir(SETTINGS_DIR, { recursive: true });

  // Filter to ensure valid commands
  const validCommands = commands.filter(
    (c): c is CustomCommand => typeof c === 'object' && c !== null && typeof c.command === 'string'
  );

  const settings: CommandsSettings = {
    commands: validCommands,
    lastModified: Date.now(),
  };

  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  return settings;
}
