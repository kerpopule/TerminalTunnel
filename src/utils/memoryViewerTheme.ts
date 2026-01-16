import { Theme } from '../themes';

/**
 * Convert hex color to RGB components
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Create rgba string from hex color and alpha
 */
function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(128, 128, 128, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * Lighten a hex color by a percentage (0-100)
 */
function lighten(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const factor = percent / 100;
  const r = Math.min(255, Math.round(rgb.r + (255 - rgb.r) * factor));
  const g = Math.min(255, Math.round(rgb.g + (255 - rgb.g) * factor));
  const b = Math.min(255, Math.round(rgb.b + (255 - rgb.b) * factor));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Darken a hex color by a percentage (0-100)
 */
function darken(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const factor = 1 - percent / 100;
  const r = Math.round(rgb.r * factor);
  const g = Math.round(rgb.g * factor);
  const b = Math.round(rgb.b * factor);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Maps an app Theme to the CSS variables used by memory-viewer.html
 * This creates a complete set of CSS custom properties that override
 * the memory viewer's default light/dark theme.
 */
export function mapThemeToMemoryViewer(theme: Theme): Record<string, string> {
  // Extract border color from rgba format if needed
  const borderHex = theme.border.startsWith('rgba')
    ? lighten(theme.bgPrimary, 15)
    : theme.border;

  const borderHoverHex = theme.borderHover.startsWith('rgba')
    ? lighten(theme.bgPrimary, 25)
    : theme.borderHover;

  return {
    // Background colors
    '--color-bg-primary': theme.bgPrimary,
    '--color-bg-secondary': theme.bgSecondary,
    '--color-bg-tertiary': theme.bgTertiary,
    '--color-bg-header': theme.bgSecondary,
    '--color-bg-card': theme.bgSecondary,
    '--color-bg-card-hover': lighten(theme.bgSecondary, 5),
    '--color-bg-input': theme.bgSecondary,
    '--color-bg-button': theme.accent,
    '--color-bg-button-hover': theme.accentHover,
    '--color-bg-button-active': darken(theme.accent, 10),
    '--color-bg-summary': lighten(theme.bgSecondary, 3),
    '--color-bg-prompt': lighten(theme.bgSecondary, 3),
    '--color-bg-observation': lighten(theme.bgSecondary, 3),
    '--color-bg-stat': theme.bgSecondary,
    '--color-bg-scrollbar-track': theme.bgPrimary,
    '--color-bg-scrollbar-thumb': borderHex,
    '--color-bg-scrollbar-thumb-hover': borderHoverHex,

    // Border colors
    '--color-border-primary': borderHex,
    '--color-border-secondary': borderHex,
    '--color-border-hover': borderHoverHex,
    '--color-border-focus': theme.accent,
    '--color-border-summary': theme.warning,
    '--color-border-summary-hover': lighten(theme.warning, 10),
    '--color-border-prompt': theme.accent,
    '--color-border-prompt-hover': theme.accentHover,
    '--color-border-observation': theme.accent,
    '--color-border-observation-hover': theme.accentHover,

    // Text colors
    '--color-text-primary': theme.textPrimary,
    '--color-text-secondary': theme.textSecondary,
    '--color-text-tertiary': theme.textMuted,
    '--color-text-muted': theme.textMuted,
    '--color-text-header': theme.textPrimary,
    '--color-text-title': theme.textPrimary,
    '--color-text-subtitle': theme.textSecondary,
    '--color-text-button': '#ffffff',
    '--color-text-summary': theme.warning,
    '--color-text-observation': theme.textPrimary,
    '--color-text-logo': theme.textPrimary,

    // Accent colors
    '--color-accent-primary': theme.accent,
    '--color-accent-focus': theme.accent,
    '--color-accent-success': theme.success,
    '--color-accent-error': theme.error,
    '--color-accent-summary': theme.warning,
    '--color-accent-prompt': theme.accent,
    '--color-accent-observation': theme.accent,

    // Badge colors (using accent with transparency)
    '--color-type-badge-bg': hexToRgba(theme.accent, 0.12),
    '--color-type-badge-text': theme.accent,
    '--color-summary-badge-bg': hexToRgba(theme.warning, 0.12),
    '--color-summary-badge-text': theme.warning,
    '--color-prompt-badge-bg': hexToRgba(theme.accent, 0.12),
    '--color-prompt-badge-text': theme.accent,
    '--color-observation-badge-bg': hexToRgba(theme.accent, 0.15),
    '--color-observation-badge-text': theme.accent,

    // Skeleton loading colors
    '--color-skeleton-base': borderHex,
    '--color-skeleton-highlight': borderHoverHex,

    // Focus shadow
    '--shadow-focus': `0 0 0 2px ${hexToRgba(theme.accent, 0.3)}`,
  };
}
