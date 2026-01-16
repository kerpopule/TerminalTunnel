import React from 'react';
import DashboardButton from './DashboardButton';
import TunnelStatus from './TunnelStatus';
import PreviewPlayButton from './PreviewPlayButton';
import PreviewStopButton from './PreviewStopButton';
import type { ActivePreview } from '../contexts/DashboardContext';

type Tab = 'files' | 'terminal' | 'memory' | 'preview' | 'settings';
type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface TabBarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  connectionStatus: ConnectionStatus;
  hasPreview: boolean;
  memoryEnabled: boolean;
  showDashboardButton?: boolean;
  dashboardEnabled?: boolean;
  activePreviews?: ActivePreview[];
  currentPreviewPort?: number | null;
  onOpenPreview?: (port: number) => void;
  onStopServer?: (port: number) => void;
  isTunnelAccess?: boolean;
}

// SVG Icons for tab bar
const FolderIcon = () => (
  <svg className="tab-bar-svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
  </svg>
);

const TerminalIcon = () => (
  <svg className="tab-bar-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5"/>
    <line x1="12" y1="19" x2="20" y2="19"/>
  </svg>
);

const MemoryIcon = () => (
  <svg className="tab-bar-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
    <rect x="9" y="9" width="6" height="6"/>
    <line x1="9" y1="2" x2="9" y2="4"/>
    <line x1="15" y1="2" x2="15" y2="4"/>
    <line x1="9" y1="20" x2="9" y2="22"/>
    <line x1="15" y1="20" x2="15" y2="22"/>
    <line x1="2" y1="9" x2="4" y2="9"/>
    <line x1="2" y1="15" x2="4" y2="15"/>
    <line x1="20" y1="9" x2="22" y2="9"/>
    <line x1="20" y1="15" x2="22" y2="15"/>
  </svg>
);

const PreviewIcon = () => (
  <svg className="tab-bar-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const SettingsIcon = () => (
  <svg className="tab-bar-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

const TabBar: React.FC<TabBarProps> = ({
  activeTab,
  onTabChange,
  connectionStatus,
  hasPreview,
  memoryEnabled,
  showDashboardButton = false,
  dashboardEnabled = false,
  activePreviews = [],
  currentPreviewPort = null,
  onOpenPreview,
  onStopServer,
  isTunnelAccess = false,
}) => {
  return (
    <nav className={`tab-bar ${showDashboardButton ? 'with-dashboard' : ''} ${dashboardEnabled ? 'dashboard-mode' : ''}`}>
      {/* Left side: Dashboard button and preview controls (desktop only) */}
      {showDashboardButton && (
        <div className="tab-bar-left">
          <DashboardButton />
          {/* Preview play/stop buttons - only show in dashboard mode with active previews */}
          {dashboardEnabled && activePreviews.length > 0 && onOpenPreview && (
            <PreviewPlayButton
              previews={activePreviews}
              currentPort={currentPreviewPort}
              onSelect={onOpenPreview}
            />
          )}
          {dashboardEnabled && activePreviews.length > 0 && onStopServer && (
            <PreviewStopButton
              previews={activePreviews}
              onStop={onStopServer}
            />
          )}
        </div>
      )}

      {/* Center: Tab items OR Tunnel URL when dashboard is enabled */}
      {dashboardEnabled ? (
        <div className="tab-bar-center">
          <TunnelStatus isTunnelAccess={isTunnelAccess} />
        </div>
      ) : (
        <div className="tab-bar-tabs">
          <button
            className={`tab-bar-item ${activeTab === 'files' ? 'active' : ''}`}
            onClick={() => onTabChange('files')}
          >
            <span className="tab-bar-icon">
              <FolderIcon />
            </span>
            <span>Files</span>
          </button>

          <button
            className={`tab-bar-item ${activeTab === 'terminal' ? 'active' : ''}`}
            onClick={() => onTabChange('terminal')}
          >
            <span className="tab-bar-icon" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <TerminalIcon />
              <span
                className={`status-dot ${connectionStatus === 'connected' ? '' : connectionStatus === 'connecting' ? 'connecting' : 'disconnected'}`}
              />
            </span>
            <span>Terminal</span>
          </button>

          {memoryEnabled && (
            <button
              className={`tab-bar-item ${activeTab === 'memory' ? 'active' : ''}`}
              onClick={() => onTabChange('memory')}
            >
              <span className="tab-bar-icon">
                <MemoryIcon />
              </span>
              <span>Memory</span>
            </button>
          )}

          {hasPreview && (
            <button
              className={`tab-bar-item ${activeTab === 'preview' ? 'active' : ''}`}
              onClick={() => onTabChange('preview')}
            >
              <span className="tab-bar-icon">
                <PreviewIcon />
              </span>
              <span>Preview</span>
            </button>
          )}

          <button
            className={`tab-bar-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => onTabChange('settings')}
          >
            <span className="tab-bar-icon">
              <SettingsIcon />
            </span>
            <span>Settings</span>
          </button>
        </div>
      )}

      {/* Right side: Settings button when in dashboard mode */}
      {showDashboardButton && dashboardEnabled && (
        <div className="tab-bar-right">
          <button
            className="tab-bar-item settings-btn"
            onClick={() => onTabChange('settings')}
            title="Settings"
          >
            <span className="tab-bar-icon">
              <SettingsIcon />
            </span>
          </button>
        </div>
      )}
    </nav>
  );
};

export default TabBar;
