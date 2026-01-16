import React from 'react';
import ReplicaTerminal from './ReplicaTerminal';
import Preview from './Preview';

// Close button icon
const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

interface PreviewModeOverlayProps {
  sourceSessionId: string;
  previewPort: number;
  previewUrl?: string | null;
  tunnelUrl?: string | null;
  isDesktopServerApp?: boolean;
  onClose: () => void;
  onLink?: (url: string) => void;
}

/**
 * PreviewModeOverlay - Full-screen overlay showing replica terminal + preview side by side.
 *
 * This is a completely separate view that sits on top of the dashboard.
 * The dashboard stays untouched underneath - no layout changes, no terminal destruction.
 *
 * Layout:
 * - Left 33%: Replica terminal (read-only, synced via room)
 * - Right 67%: Preview iframe (localhost content)
 */
const PreviewModeOverlay: React.FC<PreviewModeOverlayProps> = ({
  sourceSessionId,
  previewPort,
  previewUrl,
  tunnelUrl,
  isDesktopServerApp,
  onClose,
  onLink,
}) => {
  return (
    <div className="preview-mode-overlay">
      {/* Close button */}
      <button
        className="preview-overlay-close-btn"
        onClick={onClose}
        title="Close preview"
      >
        <CloseIcon />
      </button>

      {/* Left: Replica Terminal (33%) */}
      <div className="preview-overlay-terminal">
        <ReplicaTerminal sessionId={sourceSessionId} onLink={onLink} />
      </div>

      {/* Right: Preview iframe (67%) */}
      <div className="preview-overlay-content">
        <Preview
          port={previewPort}
          originalUrl={previewUrl || null}
          tunnelUrl={tunnelUrl}
          isDesktopServerApp={isDesktopServerApp}
        />
      </div>
    </div>
  );
};

export default PreviewModeOverlay;
