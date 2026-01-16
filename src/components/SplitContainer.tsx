import React, { useCallback, useState, useRef, useEffect } from 'react';
import { DragDropContext, DropResult } from 'react-beautiful-dnd';
import { useTerminalTabs } from '../contexts/TerminalTabsContext';
import TerminalPane from './TerminalPane';
import type { PaneId } from '../types/terminal';

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface SplitContainerProps {
  isVisible?: boolean;
  onLink?: (url: string) => void;
  status: ConnectionStatus;
}

const SPLIT_RATIO_KEY = 'mobile_terminal_split_ratio';
const MIN_PANE_PERCENT = 20; // Minimum 20% for each pane

const SplitContainer: React.FC<SplitContainerProps> = ({
  isVisible = true,
  onLink,
  status,
}) => {
  const { splitState, splitDirection, reorderTabs, moveTab } = useTerminalTabs();
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    const stored = localStorage.getItem(SPLIT_RATIO_KEY);
    return stored ? parseFloat(stored) : 50;
  });
  const [isDragging, setIsDragging] = useState(false);

  // Persist split ratio
  useEffect(() => {
    localStorage.setItem(SPLIT_RATIO_KEY, splitRatio.toString());
  }, [splitRatio]);

  // Handle drag start
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  // Handle drag move
  useEffect(() => {
    if (!isDragging || !containerRef.current) return;

    const handleMove = (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      let newRatio: number;

      if (splitDirection === 'vertical') {
        // Top/bottom split - use Y position
        const relativeY = clientY - rect.top;
        newRatio = (relativeY / rect.height) * 100;
      } else {
        // Left/right split - use X position
        const relativeX = clientX - rect.left;
        newRatio = (relativeX / rect.width) * 100;
      }

      // Clamp to min/max
      newRatio = Math.max(MIN_PANE_PERCENT, Math.min(100 - MIN_PANE_PERCENT, newRatio));
      setSplitRatio(newRatio);
    };

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, splitDirection]);

  // Handle drag end - reorder within pane or move between panes
  const handleDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) {
      return;
    }

    const sourceIndex = result.source.index;
    const destIndex = result.destination.index;
    const sourceDroppableId = result.source.droppableId as PaneId;
    const destDroppableId = result.destination.droppableId as PaneId;

    if (sourceDroppableId === destDroppableId) {
      // Reordering within the same pane
      if (sourceIndex !== destIndex) {
        reorderTabs(sourceDroppableId, sourceIndex, destIndex);
      }
    } else {
      // Moving between panes
      const tabId = result.draggableId;
      moveTab(sourceDroppableId, destDroppableId, tabId, destIndex);
    }
  }, [reorderTabs, moveTab]);

  // Show loading state
  if (status === 'connecting') {
    return (
      <div className="tab-content">
        <div className="loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  // Show reconnecting state
  if (status === 'reconnecting') {
    return (
      <div className="tab-content">
        <div className="loading">
          <div className="loading-spinner" />
          <div className="loading-text">Reconnecting...</div>
        </div>
      </div>
    );
  }

  // Show error state (only after all reconnection attempts fail)
  if (status === 'disconnected') {
    return (
      <div className="tab-content">
        <div className="error-state">
          <div className="error-icon">⚠️</div>
          <div className="error-title">Connection Lost</div>
          <div className="error-message">
            Unable to connect to terminal server. Check that the server is running.
          </div>
          <button className="error-retry" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Calculate pane styles based on split ratio
  const primaryStyle = splitState.enabled ? {
    flex: `0 0 ${splitRatio}%`,
  } : {};

  const secondaryStyle = splitState.enabled ? {
    flex: `0 0 ${100 - splitRatio}%`,
  } : {};

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div
        ref={containerRef}
        className={`split-container ${splitDirection} ${splitState.enabled ? 'split-enabled' : ''} ${isDragging ? 'is-resizing' : ''}`}
      >
        <TerminalPane
          paneId="primary"
          showSplitToggle={true}
          isVisible={isVisible}
          onLink={onLink}
          style={primaryStyle}
        />
        {splitState.enabled && (
          <>
            <div
              className={`split-divider ${isDragging ? 'dragging' : ''}`}
              onMouseDown={handleDragStart}
              onTouchStart={handleDragStart}
            />
            <TerminalPane
              paneId="secondary"
              showSplitToggle={false}
              isVisible={isVisible}
              onLink={onLink}
              style={secondaryStyle}
            />
          </>
        )}
      </div>
    </DragDropContext>
  );
};

export default SplitContainer;
