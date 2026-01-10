import React, { useCallback, useState, useRef, useEffect, ReactNode, CSSProperties } from 'react';

interface MultiSplitContainerProps {
  direction: 'horizontal' | 'vertical';
  children: ReactNode[];
  ratios: number[]; // Percentages that should sum to 100
  onRatioChange?: (index: number, newRatio: number, adjacentIndex: number) => void;
  minSizes?: number[]; // Minimum sizes in pixels for each panel
  disabledDividers?: boolean[]; // Which dividers should be disabled (not draggable)
  className?: string;
  style?: CSSProperties;
}

const DEFAULT_MIN_SIZE = 100; // pixels

const MultiSplitContainer: React.FC<MultiSplitContainerProps> = ({
  direction,
  children,
  ratios,
  onRatioChange,
  minSizes,
  disabledDividers,
  className = '',
  style,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Validate children and ratios match
  const childArray = React.Children.toArray(children);
  if (childArray.length !== ratios.length) {
    console.warn('MultiSplitContainer: children count must match ratios length');
  }

  // Handle drag start for a specific divider
  const handleDragStart = useCallback((index: number) => (e: React.MouseEvent | React.TouchEvent) => {
    // Don't start drag if this divider is disabled
    if (disabledDividers?.[index]) return;
    e.preventDefault();
    setDraggingIndex(index);
  }, [disabledDividers]);

  // Handle drag move
  useEffect(() => {
    if (draggingIndex === null || !containerRef.current) return;

    const handleMove = (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container || !onRatioChange) return;

      const rect = container.getBoundingClientRect();
      let position: number;
      let totalSize: number;

      if (direction === 'vertical') {
        position = clientY - rect.top;
        totalSize = rect.height;
      } else {
        position = clientX - rect.left;
        totalSize = rect.width;
      }

      // Calculate the position as a percentage
      const positionPercent = (position / totalSize) * 100;

      // Calculate cumulative ratios up to the divider
      let cumulativeRatio = 0;
      for (let i = 0; i < draggingIndex; i++) {
        cumulativeRatio += ratios[i];
      }

      // The new ratio for the panel before the divider
      let newRatio = positionPercent - cumulativeRatio;

      // Apply minimum sizes
      const minSizePercent = minSizes
        ? (minSizes[draggingIndex] / totalSize) * 100
        : (DEFAULT_MIN_SIZE / totalSize) * 100;
      const nextMinSizePercent = minSizes
        ? (minSizes[draggingIndex + 1] / totalSize) * 100
        : (DEFAULT_MIN_SIZE / totalSize) * 100;

      // Clamp to respect minimum sizes
      const maxRatio = ratios[draggingIndex] + ratios[draggingIndex + 1] - nextMinSizePercent;
      newRatio = Math.max(minSizePercent, Math.min(maxRatio, newRatio));

      onRatioChange(draggingIndex, newRatio, draggingIndex + 1);
    };

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        e.preventDefault();
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleEnd = () => {
      setDraggingIndex(null);
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
  }, [draggingIndex, direction, ratios, minSizes, onRatioChange]);

  // Render children with dividers between them
  const elements: ReactNode[] = [];

  childArray.forEach((child, index) => {
    // Add panel
    // Use percentage basis with shrink enabled to account for dividers
    const panelStyle: CSSProperties = {
      flex: `0 1 ${ratios[index]}%`,
      overflow: 'hidden',
      position: 'relative',
      minWidth: 0,
      minHeight: 0,
    };

    elements.push(
      <div
        key={`panel-${index}`}
        className="multi-split-panel"
        style={panelStyle}
        data-panel-index={index}
        data-panel-ratio={ratios[index]}
      >
        {child}
      </div>
    );

    // Add divider after each panel except the last
    if (index < childArray.length - 1) {
      const isDisabled = disabledDividers?.[index] ?? false;
      elements.push(
        <div
          key={`divider-${index}`}
          className={`multi-split-divider ${draggingIndex === index ? 'dragging' : ''} ${isDisabled ? 'disabled' : ''}`}
          onMouseDown={handleDragStart(index)}
          onTouchStart={handleDragStart(index)}
        />
      );
    }
  });

  return (
    <div
      ref={containerRef}
      className={`multi-split-container ${direction} ${draggingIndex !== null ? 'is-resizing' : ''} ${className}`}
      style={style}
    >
      {elements}
    </div>
  );
};

export default MultiSplitContainer;
