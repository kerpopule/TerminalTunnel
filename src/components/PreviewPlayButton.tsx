import React, { useState, useRef, useEffect } from 'react';
import type { ActivePreview } from '../contexts/DashboardContext';

interface PreviewPlayButtonProps {
  previews: ActivePreview[];
  currentPort: number | null;
  onSelect: (port: number) => void;
}

// Play icon
const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const PreviewPlayButton: React.FC<PreviewPlayButtonProps> = ({
  previews,
  currentPort,
  onSelect,
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
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
      // Single preview - just open it
      onSelect(previews[0].port);
    } else if (previews.length > 1) {
      // Multiple previews - show dropdown
      setShowDropdown(!showDropdown);
    }
  };

  const handleSelectPreview = (port: number) => {
    onSelect(port);
    setShowDropdown(false);
  };

  if (previews.length === 0) {
    return null;
  }

  return (
    <div className="preview-play-button-container">
      <button
        ref={buttonRef}
        className={`preview-play-button ${currentPort ? 'active' : ''}`}
        onClick={handleClick}
        title={previews.length === 1 ? `Open preview (port ${previews[0].port})` : 'Select preview to open'}
      >
        <PlayIcon />
        {previews.length > 1 && (
          <span className="preview-count">{previews.length}</span>
        )}
      </button>

      {showDropdown && previews.length > 1 && (
        <div ref={dropdownRef} className="preview-dropdown">
          <div className="preview-dropdown-header">Select Preview</div>
          {previews.map((preview) => (
            <button
              key={preview.port}
              className={`preview-dropdown-item ${preview.port === currentPort ? 'current' : ''}`}
              onClick={() => handleSelectPreview(preview.port)}
            >
              <span className="preview-port">:{preview.port}</span>
              {preview.port === currentPort && <span className="current-badge">Current</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default PreviewPlayButton;
