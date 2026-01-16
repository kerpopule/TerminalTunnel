import { Terminal } from '@xterm/xterm';

/**
 * Convert touch coordinates to terminal cell position
 * Uses xterm's internal render service for accurate cell dimensions
 */
export function getTouchCellPosition(
  touch: Touch,
  terminalElement: HTMLElement,
  terminal: Terminal
): { col: number; row: number } | null {
  try {
    // Access xterm's internal render service for cell dimensions
    const core = (terminal as any)._core;
    if (!core?._renderService) return null;

    const { css: { cell } } = core._renderService.dimensions;
    const { cols, rows } = terminal;

    // Get element bounds and padding
    const rect = terminalElement.getBoundingClientRect();
    const style = window.getComputedStyle(terminalElement);
    const paddingLeft = parseInt(style.paddingLeft) || 0;
    const paddingTop = parseInt(style.paddingTop) || 0;

    // Calculate cell position (1-indexed, clamped to bounds)
    const col = Math.max(1, Math.min(cols,
      Math.ceil((touch.clientX - rect.left - paddingLeft) / cell.width)));
    const row = Math.max(1, Math.min(rows,
      Math.ceil((touch.clientY - rect.top - paddingTop) / cell.height)));

    return { col, row };
  } catch {
    return null;
  }
}

/**
 * Calculate character length between two cell positions
 * Used for extending selection from start to end position
 */
export function calculateSelectionLength(
  start: { col: number; row: number },
  end: { col: number; row: number },
  cols: number
): number {
  // Convert to 0-indexed for calculation
  const startIdx = (start.row - 1) * cols + (start.col - 1);
  const endIdx = (end.row - 1) * cols + (end.col - 1);

  // Return absolute difference + 1 (inclusive)
  return Math.abs(endIdx - startIdx) + 1;
}
