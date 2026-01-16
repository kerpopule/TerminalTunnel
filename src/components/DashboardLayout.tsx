import React, { useCallback, useEffect, useRef } from 'react';
import { DragDropContext, DropResult } from 'react-beautiful-dnd';
import { useDashboard } from '../contexts/DashboardContext';
import { useTerminalTabs } from '../contexts/TerminalTabsContext';
import { useSettings } from '../contexts/SettingsContext';
import MultiSplitContainer from './MultiSplitContainer';
import DashboardTerminalRow from './DashboardTerminalRow';
import FileBrowser from './FileBrowser';
import MemoryViewer from './MemoryViewer';
import Preview from './Preview';
import type { AnyPaneId } from '../types/terminal';

// Close button icon for preview mode
const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// Collapse/Expand icons
const CollapseLeftIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="11 17 6 12 11 7" />
    <polyline points="18 17 13 12 18 7" />
  </svg>
);

const ExpandRightIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="13 17 18 12 13 7" />
    <polyline points="6 17 11 12 6 7" />
  </svg>
);

const CollapseRightIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="13 17 18 12 13 7" />
    <polyline points="6 17 11 12 6 7" />
  </svg>
);

const ExpandLeftIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="11 17 6 12 11 7" />
    <polyline points="18 17 13 12 18 7" />
  </svg>
);

// Horizontal split icon
const HorizontalSplitIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </svg>
);

interface DashboardLayoutProps {
  onNavigate?: (path: string, isDirectory: boolean) => void;
  onRunCustomCommand?: (path: string, command: string) => void;
  onLink?: (url: string) => void;
  memoryRefreshKey?: number;
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  onNavigate,
  onRunCustomCommand,
  onLink,
  memoryRefreshKey = 0,
}) => {
  const {
    columnRatios,
    terminalSplitRatio,
    topRowState,
    bottomRowState,
    setColumnRatio,
    setTerminalSplitRatio,
    splitRow,
    unsplitRow,
    setRowRatios,
    filesCollapsed,
    memoryCollapsed,
    toggleFilesCollapsed,
    toggleMemoryCollapsed,
    // Preview mode
    previewMode,
    previewPort,
    previewUrl,
    exitPreviewMode,
  } = useDashboard();

  const { reorderTabs, moveTab, splitState, toggleSplit } = useTerminalTabs();
  const { memoryEnabled } = useSettings();

  // Compute column ratios based on collapsed state and memory enabled
  // Collapsed panels get a minimal width, rest goes to terminals
  const computeEffectiveRatios = () => {
    const collapsedWidth = 2; // Percentage width for collapsed panels (just shows button)

    if (filesCollapsed && (!memoryEnabled || memoryCollapsed)) {
      // Both side panels collapsed - terminal gets almost everything
      return [collapsedWidth, 100 - collapsedWidth * 2, collapsedWidth] as [number, number, number];
    } else if (filesCollapsed) {
      // Only files collapsed
      const memoryRatio = columnRatios[2];
      return [collapsedWidth, 100 - collapsedWidth - memoryRatio, memoryRatio] as [number, number, number];
    } else if (!memoryEnabled || memoryCollapsed) {
      // Memory disabled or collapsed
      const filesRatio = columnRatios[0];
      return [filesRatio, 100 - filesRatio - collapsedWidth, collapsedWidth] as [number, number, number];
    }
    // Both expanded
    return columnRatios;
  };

  const effectiveColumnRatios = computeEffectiveRatios();

  // Determine min sizes based on collapsed state
  const effectiveMinSizes = filesCollapsed
    ? (memoryEnabled && !memoryCollapsed ? [32, 300, 180] : [32, 300, 32])
    : (memoryEnabled && !memoryCollapsed ? [150, 300, 180] : [150, 300, 32]);

  // Disable dividers when adjacent panels are collapsed
  // Divider 0 is between files (index 0) and terminals (index 1)
  // Divider 1 is between terminals (index 1) and memory (index 2)
  const disabledColumnDividers = [
    filesCollapsed, // Disable left divider when files collapsed
    !memoryEnabled || memoryCollapsed, // Disable right divider when memory collapsed/disabled
  ];

  // Handle drag end for terminal tabs
  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const sourceIndex = result.source.index;
    const destIndex = result.destination.index;
    const sourceDroppableId = result.source.droppableId as AnyPaneId;
    const destDroppableId = result.destination.droppableId as AnyPaneId;

    if (sourceDroppableId === destDroppableId) {
      if (sourceIndex !== destIndex) {
        reorderTabs(sourceDroppableId, sourceIndex, destIndex);
      }
    } else {
      const tabId = result.draggableId;
      moveTab(sourceDroppableId, destDroppableId, tabId, destIndex);
    }
  };

  // Handle column ratio changes
  const handleColumnRatioChange = (index: number, newRatio: number, adjacentIndex: number) => {
    setColumnRatio(index, newRatio, adjacentIndex);
  };

  // Handle terminal split ratio changes
  const handleTerminalSplitChange = (_index: number, newRatio: number) => {
    // For vertical split, the ratio is the top terminal's portion
    setTerminalSplitRatio(newRatio / 100);
  };

  // Calculate terminal ratios as percentages
  const terminalTopRatio = terminalSplitRatio * 100;
  const terminalBottomRatio = 100 - terminalTopRatio;

  // Row split/unsplit handlers
  const handleSplitTopRow = useCallback(() => splitRow('top'), [splitRow]);
  const handleUnsplitTopRow = useCallback(() => unsplitRow('top'), [unsplitRow]);
  const handleSplitBottomRow = useCallback(() => splitRow('bottom'), [splitRow]);
  const handleUnsplitBottomRow = useCallback(() => unsplitRow('bottom'), [unsplitRow]);

  // Row ratio handlers
  const handleTopRowRatioChange = useCallback(
    (ratios: number[]) => setRowRatios('top', ratios),
    [setRowRatios]
  );
  const handleBottomRowRatioChange = useCallback(
    (ratios: number[]) => setRowRatios('bottom', ratios),
    [setRowRatios]
  );

  // Check if we should show single terminal row (split disabled)
  const showSingleRow = !splitState.enabled;

  // Check if preview mode is active
  const isPreviewActive = previewMode && previewPort;

  // Track previous preview state to detect transitions
  const prevPreviewActiveRef = useRef(isPreviewActive);

  // Trigger terminal resize when entering/exiting preview mode
  useEffect(() => {
    const wasPreviewActive = prevPreviewActiveRef.current;
    prevPreviewActiveRef.current = isPreviewActive;

    // Only trigger on state change
    if (wasPreviewActive !== isPreviewActive) {
      // Delay to allow layout to settle, then trigger resize for terminal to re-fit
      const timeouts = [
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
        }, 100),
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
        }, 300),
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
        }, 500),
      ];

      return () => {
        timeouts.forEach(clearTimeout);
      };
    }
  }, [isPreviewActive]);

  // CRITICAL: Single render path - component tree NEVER changes based on preview mode
  // This prevents terminals from being unmounted/remounted (which destroys PTY sessions)
  // CSS handles all visual changes for preview mode
  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className={`dashboard-layout ${isPreviewActive ? 'dashboard-preview-mode' : ''}`}>
        {/* Preview close button - only shown when preview active */}
        {isPreviewActive && (
          <button
            className="preview-mode-close-btn"
            onClick={exitPreviewMode}
            title="Close preview"
          >
            <CloseIcon />
          </button>
        )}

        {/* Main 3-column layout - ALWAYS RENDERED regardless of preview mode */}
        <MultiSplitContainer
          direction="horizontal"
          ratios={effectiveColumnRatios}
          onRatioChange={handleColumnRatioChange}
          minSizes={effectiveMinSizes}
          disabledDividers={disabledColumnDividers}
          className="dashboard-columns"
        >
          {/* Left Panel: Files (collapsible) */}
          <div className={`dashboard-panel dashboard-files ${filesCollapsed ? 'collapsed' : ''}`}>
            {filesCollapsed ? (
              <button
                className="panel-expand-btn files-expand"
                onClick={toggleFilesCollapsed}
                title="Expand files panel"
              >
                <ExpandRightIcon />
              </button>
            ) : (
              <>
                <button
                  className="panel-collapse-btn files-collapse"
                  onClick={toggleFilesCollapsed}
                  title="Collapse files panel"
                >
                  <CollapseLeftIcon />
                </button>
                <FileBrowser
                  onNavigate={onNavigate}
                  onRunCustomCommand={onRunCustomCommand}
                />
              </>
            )}
          </div>

          {/* Center Panel: Terminal Row(s) - ALWAYS render both rows, CSS hides in preview */}
          <div className="dashboard-panel dashboard-terminals">
            {showSingleRow ? (
              // Single terminal row (split disabled)
              <div className="dashboard-single-terminal">
                <DashboardTerminalRow
                  rowId="top"
                  rowState={topRowState}
                  onSplit={handleSplitTopRow}
                  onUnsplit={handleUnsplitTopRow}
                  onRatioChange={handleTopRowRatioChange}
                  onLink={onLink}
                />
                <button
                  className="restore-split-btn"
                  onClick={toggleSplit}
                  title="Split terminal rows"
                >
                  <HorizontalSplitIcon />
                </button>
              </div>
            ) : (
              // Two terminal rows (split enabled) - ALWAYS render both, CSS hides bottom in preview
              <MultiSplitContainer
                direction="vertical"
                ratios={[terminalTopRatio, terminalBottomRatio]}
                onRatioChange={handleTerminalSplitChange}
                minSizes={[100, 100]}
                className="dashboard-terminal-stack"
              >
                <DashboardTerminalRow
                  rowId="top"
                  rowState={topRowState}
                  onSplit={handleSplitTopRow}
                  onUnsplit={handleUnsplitTopRow}
                  onRatioChange={handleTopRowRatioChange}
                  onLink={onLink}
                />
                <DashboardTerminalRow
                  rowId="bottom"
                  rowState={bottomRowState}
                  onSplit={handleSplitBottomRow}
                  onUnsplit={handleUnsplitBottomRow}
                  onRatioChange={handleBottomRowRatioChange}
                  onLink={onLink}
                />
              </MultiSplitContainer>
            )}
          </div>

          {/* Right Panel: Memory (collapsible, only when enabled) */}
          {memoryEnabled && (
            <div className={`dashboard-panel dashboard-memory ${memoryCollapsed ? 'collapsed' : ''}`}>
              {memoryCollapsed ? (
                <button
                  className="panel-expand-btn memory-expand"
                  onClick={toggleMemoryCollapsed}
                  title="Expand memory panel"
                >
                  <ExpandLeftIcon />
                </button>
              ) : (
                <>
                  <button
                    className="panel-collapse-btn memory-collapse"
                    onClick={toggleMemoryCollapsed}
                    title="Collapse memory panel"
                  >
                    <CollapseRightIcon />
                  </button>
                  <MemoryViewer refreshKey={memoryRefreshKey} />
                </>
              )}
            </div>
          )}

          {/* Placeholder for memory column when disabled but we need 3 columns */}
          {!memoryEnabled && (
            <div className="dashboard-panel dashboard-memory-placeholder" />
          )}
        </MultiSplitContainer>

        {/* Preview overlay - positioned absolutely over right side, doesn't affect terminal mounting */}
        {isPreviewActive && (
          <div className="dashboard-preview-overlay">
            <Preview port={previewPort} originalUrl={previewUrl} />
          </div>
        )}
      </div>
    </DragDropContext>
  );
};

export default DashboardLayout;
