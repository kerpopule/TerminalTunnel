import React, { useState, useRef, useEffect } from 'react';
import type { ActivePreview } from '../contexts/DashboardContext';

interface PreviewStopButtonProps {
  previews: ActivePreview[];
  onStop: (port: number) => void;
}

// Stop icon (square)
const StopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

const PreviewStopButton: React.FC<PreviewStopButtonProps> = ({
  previews,
  onStop,
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [stoppingPort, setStoppingPort] = useState<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown]);

  const handleClick = () => {
    if (previews.length === 1) {
      // Single preview - confirm and stop
      handleStop(previews[0].port);
    } else if (previews.length > 1) {
      // Multiple previews - show dropdown
      setShowDropdown(!showDropdown);
    }
  };

  const handleStop = async (port: number) => {
    setStoppingPort(port);
    try {
      await onStop(port);
    } finally {
      setStoppingPort(null);
      setShowDropdown(false);
    }
  };

  if (previews.length === 0) {
    return null;
  }

  return (
    <div className="preview-stop-button-container">
      <button
        ref={buttonRef}
        className="preview-stop-button"
        onClick={handleClick}
        title={previews.length === 1 ? `Stop server (port ${previews[0].port})` : 'Select server to stop'}
        disabled={stoppingPort !== null}
      >
        <StopIcon />
        {previews.length > 1 && (
          <span className="preview-count">{previews.length}</span>
        )}
      </button>

      {showDropdown && previews.length > 1 && (
        <div ref={dropdownRef} className="preview-dropdown stop-dropdown">
          <div className="preview-dropdown-header">Stop Server</div>
          {previews.map((preview) => (
            <button
              key={preview.port}
              className="preview-dropdown-item stop-item"
              onClick={() => handleStop(preview.port)}
              disabled={stoppingPort === preview.port}
            >
              <span className="preview-port">:{preview.port}</span>
              {stoppingPort === preview.port && <span className="stopping-badge">Stopping...</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default PreviewStopButton;
