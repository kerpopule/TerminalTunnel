import React, { useCallback, useEffect } from 'react';
import MultiSplitContainer from './MultiSplitContainer';
import TerminalPane from './TerminalPane';
import { useTerminalTabs } from '../contexts/TerminalTabsContext';
import { getDashboardPaneId, type DashboardRowState } from '../types/terminal';

interface DashboardTerminalRowProps {
  rowId: 'top' | 'bottom';
  rowState: DashboardRowState;
  onSplit: () => void;
  onUnsplit: () => void;
  onRatioChange: (ratios: number[]) => void;
  onLink?: (url: string) => void;
}

const DashboardTerminalRow: React.FC<DashboardTerminalRowProps> = ({
  rowId,
  rowState,
  onSplit,
  onUnsplit,
  onRatioChange,
  onLink,
}) => {
  const { paneCount, ratios } = rowState;
  const canSplit = paneCount < 3;
  const canUnsplit = paneCount > 1;

  const { initializeMultipleDashboardPanes, mergeDashboardPane } = useTerminalTabs();

  // Initialize dashboard panes when they become visible (batch to avoid race conditions)
  useEffect(() => {
    const paneIds = Array.from({ length: paneCount }, (_, i) =>
      getDashboardPaneId(rowId, i)
    );
    initializeMultipleDashboardPanes(paneIds);
  }, [paneCount, rowId, initializeMultipleDashboardPanes]);

  // Handle ratio changes from the split container
  const handleRatioChange = useCallback(
    (index: number, newRatio: number, adjacentIndex: number) => {
      const newRatios = [...ratios];
      const diff = newRatio - newRatios[index];
      newRatios[index] = newRatio;
      newRatios[adjacentIndex] = Math.max(20, newRatios[adjacentIndex] - diff);
      onRatioChange(newRatios);
    },
    [ratios, onRatioChange]
  );

  // Handle unsplit with tab merging
  const handleUnsplit = useCallback(() => {
    if (paneCount > 1) {
      // Merge tabs from rightmost pane into the pane to its left
      const removedPaneId = getDashboardPaneId(rowId, paneCount - 1);
      const targetPaneId = getDashboardPaneId(rowId, paneCount - 2);
      mergeDashboardPane(removedPaneId, targetPaneId);
    }
    onUnsplit();
  }, [paneCount, rowId, mergeDashboardPane, onUnsplit]);

  // For single pane, just render the terminal pane directly
  if (paneCount === 1) {
    const dashboardPaneId = getDashboardPaneId(rowId, 0);
    return (
      <div className="dashboard-terminal-row">
        <TerminalPane
          paneId={dashboardPaneId}
          showSplitToggle={true}
          isVisible={true}
          onLink={onLink}
          showDashboardSplit={false}  // Disabled - multi-pane feature not working yet
          canSplitRow={false}
          canUnsplitRow={false}
          onSplitRow={undefined}
          onUnsplitRow={undefined}
        />
      </div>
    );
  }

  // For multiple panes, use MultiSplitContainer with independent terminals
  const panes: React.ReactNode[] = [];
  for (let i = 0; i < paneCount; i++) {
    const dashboardPaneId = getDashboardPaneId(rowId, i);
    // Only show split controls on the first pane
    const showControls = i === 0;

    panes.push(
      <TerminalPane
        key={dashboardPaneId}
        paneId={dashboardPaneId}
        showSplitToggle={false}
        isVisible={true}
        onLink={onLink}
        showDashboardSplit={showControls}
        canSplitRow={showControls ? canSplit : false}
        canUnsplitRow={showControls ? canUnsplit : false}
        onSplitRow={showControls ? onSplit : undefined}
        onUnsplitRow={showControls ? handleUnsplit : undefined}
      />
    );
  }

  return (
    <div className="dashboard-terminal-row">
      <MultiSplitContainer
        direction="horizontal"
        ratios={ratios}
        onRatioChange={handleRatioChange}
        minSizes={Array(paneCount).fill(100)}
        className="dashboard-row-split"
      >
        {panes}
      </MultiSplitContainer>
    </div>
  );
};

export default DashboardTerminalRow;
