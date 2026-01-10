export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface Theme {
  name: string;
  displayName: string;
  preview: [string, string, string]; // 3 colors for preview cards

  // App UI Colors
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  success: string;
  error: string;
  warning: string;
  border: string;
  borderHover: string;

  // Terminal Theme
  terminal: TerminalTheme;
}

export const themes: Record<string, Theme> = {
  midnight: {
    name: 'midnight',
    displayName: 'Midnight',
    preview: ['#1a1a2e', '#4f46e5', '#e4e4e7'],

    bgPrimary: '#1a1a2e',
    bgSecondary: '#16213e',
    bgTertiary: '#0f0f1a',
    textPrimary: '#e4e4e7',
    textSecondary: '#a1a1aa',
    textMuted: '#71717a',
    accent: '#4f46e5',
    accentHover: '#6366f1',
    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
    border: 'rgba(255, 255, 255, 0.1)',
    borderHover: 'rgba(255, 255, 255, 0.2)',

    terminal: {
      background: '#0f0f1a',
      foreground: '#e4e4e7',
      cursor: '#4f46e5',
      cursorAccent: '#0f0f1a',
      selectionBackground: 'rgba(79, 70, 229, 0.3)',
      black: '#27272a',
      red: '#ef4444',
      green: '#22c55e',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#a855f7',
      cyan: '#06b6d4',
      white: '#e4e4e7',
      brightBlack: '#52525b',
      brightRed: '#f87171',
      brightGreen: '#4ade80',
      brightYellow: '#fbbf24',
      brightBlue: '#60a5fa',
      brightMagenta: '#c084fc',
      brightCyan: '#22d3ee',
      brightWhite: '#fafafa',
    },
  },

  dracula: {
    name: 'dracula',
    displayName: 'Dracula',
    preview: ['#282a36', '#bd93f9', '#ff79c6'],

    bgPrimary: '#282a36',
    bgSecondary: '#21222c',
    bgTertiary: '#191a21',
    textPrimary: '#f8f8f2',
    textSecondary: '#bfbfbf',
    textMuted: '#6272a4',
    accent: '#bd93f9',
    accentHover: '#caa8ff',
    success: '#50fa7b',
    error: '#ff5555',
    warning: '#ffb86c',
    border: 'rgba(255, 255, 255, 0.1)',
    borderHover: 'rgba(255, 255, 255, 0.2)',

    terminal: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#282a36',
      selectionBackground: 'rgba(68, 71, 90, 0.5)',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff',
    },
  },

  nord: {
    name: 'nord',
    displayName: 'Nord',
    preview: ['#2e3440', '#88c0d0', '#d8dee9'],

    bgPrimary: '#2e3440',
    bgSecondary: '#3b4252',
    bgTertiary: '#2e3440',
    textPrimary: '#eceff4',
    textSecondary: '#d8dee9',
    textMuted: '#4c566a',
    accent: '#88c0d0',
    accentHover: '#8fbcbb',
    success: '#a3be8c',
    error: '#bf616a',
    warning: '#ebcb8b',
    border: 'rgba(255, 255, 255, 0.08)',
    borderHover: 'rgba(255, 255, 255, 0.15)',

    terminal: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      cursorAccent: '#2e3440',
      selectionBackground: 'rgba(136, 192, 208, 0.3)',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4',
    },
  },

  monokai: {
    name: 'monokai',
    displayName: 'Monokai',
    preview: ['#272822', '#a6e22e', '#f92672'],

    bgPrimary: '#272822',
    bgSecondary: '#1e1f1c',
    bgTertiary: '#1a1a17',
    textPrimary: '#f8f8f2',
    textSecondary: '#cfcfc2',
    textMuted: '#75715e',
    accent: '#a6e22e',
    accentHover: '#b8f32f',
    success: '#a6e22e',
    error: '#f92672',
    warning: '#fd971f',
    border: 'rgba(255, 255, 255, 0.1)',
    borderHover: 'rgba(255, 255, 255, 0.2)',

    terminal: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      cursorAccent: '#272822',
      selectionBackground: 'rgba(73, 72, 62, 0.5)',
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#f4bf75',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
      brightBlack: '#75715e',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#f4bf75',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f9f8f5',
    },
  },

  tokyoNight: {
    name: 'tokyoNight',
    displayName: 'Tokyo Night',
    preview: ['#1a1b26', '#7aa2f7', '#bb9af7'],

    bgPrimary: '#1a1b26',
    bgSecondary: '#16161e',
    bgTertiary: '#13131a',
    textPrimary: '#c0caf5',
    textSecondary: '#a9b1d6',
    textMuted: '#565f89',
    accent: '#7aa2f7',
    accentHover: '#89b4fa',
    success: '#9ece6a',
    error: '#f7768e',
    warning: '#e0af68',
    border: 'rgba(255, 255, 255, 0.08)',
    borderHover: 'rgba(255, 255, 255, 0.15)',

    terminal: {
      background: '#1a1b26',
      foreground: '#a9b1d6',
      cursor: '#c0caf5',
      cursorAccent: '#1a1b26',
      selectionBackground: 'rgba(122, 162, 247, 0.3)',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5',
    },
  },

  ropic: {
    name: 'ropic',
    displayName: 'Ropic',
    preview: ['#1c1917', '#c2703a', '#e8e0d4'],

    bgPrimary: '#1c1917',
    bgSecondary: '#262220',
    bgTertiary: '#161412',
    textPrimary: '#e8e0d4',
    textSecondary: '#a8a29e',
    textMuted: '#78716c',
    accent: '#c2703a',
    accentHover: '#d4824a',
    success: '#5fa77d',
    error: '#e57373',
    warning: '#d4a54a',
    border: 'rgba(232, 224, 212, 0.1)',
    borderHover: 'rgba(232, 224, 212, 0.2)',

    terminal: {
      background: '#161412',
      foreground: '#e8e0d4',
      cursor: '#c2703a',
      cursorAccent: '#161412',
      selectionBackground: 'rgba(194, 112, 58, 0.3)',
      black: '#262220',
      red: '#e57373',
      green: '#5fa77d',
      yellow: '#d4a54a',
      blue: '#7aa2c9',
      magenta: '#b48ead',
      cyan: '#6fa3a3',
      white: '#e8e0d4',
      brightBlack: '#78716c',
      brightRed: '#ef9a9a',
      brightGreen: '#81c995',
      brightYellow: '#e0b584',
      brightBlue: '#90b4d9',
      brightMagenta: '#c9a8c1',
      brightCyan: '#8fbdbd',
      brightWhite: '#f5f0e8',
    },
  },
};

export const themeList = Object.values(themes);

export const defaultTheme = themes.ropic;

// Terminal fonts that work well in terminals
// Mix of Google Fonts (JetBrains Mono, Fira Code, Source Code Pro, Ubuntu Mono, Inconsolata)
// and system fonts (SF Mono, Menlo, Monaco, Consolas)
export const terminalFonts = [
  { name: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
  { name: 'Fira Code', value: '"Fira Code", monospace' },
  { name: 'Source Code Pro', value: '"Source Code Pro", monospace' },
  { name: 'Ubuntu Mono', value: '"Ubuntu Mono", monospace' },
  { name: 'Inconsolata', value: '"Inconsolata", monospace' },
  { name: 'SF Mono', value: '"SF Mono", "Menlo", monospace' },
  { name: 'Menlo', value: '"Menlo", monospace' },
  { name: 'Monaco', value: '"Monaco", monospace' },
  { name: 'Consolas', value: '"Consolas", monospace' },
];

export const defaultFont = terminalFonts[7];  // Monaco
export const defaultFontSize = 16;
export const minFontSize = 10;
export const maxFontSize = 24;
