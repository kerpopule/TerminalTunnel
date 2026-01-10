import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from './hooks/useSocket';
import { useDesktopApp } from './hooks/useDesktopApp';
import { useWebDesktopMode } from './hooks/useWebDesktopMode';
import { useUpdater } from './hooks/useUpdater';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import { TerminalTabsProvider, useTerminalTabs } from './contexts/TerminalTabsContext';
import { DashboardProvider, useDashboard } from './contexts/DashboardContext';
import SplitContainer from './components/SplitContainer';
import DashboardLayout from './components/DashboardLayout';
import FileBrowser from './components/FileBrowser';
import MemoryViewer from './components/MemoryViewer';
import Preview from './components/Preview';
import Settings from './components/Settings';
import TabBar from './components/TabBar';
import PinLockScreen from './components/PinLockScreen';
import UpdateModal from './components/UpdateModal';

type Tab = 'files' | 'terminal' | 'memory' | 'preview' | 'settings';

const STORAGE_KEY_TAB = 'mobile_terminal_active_tab';

// Inner component that uses the terminal tabs context for command execution
interface AppInnerProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  previewUrl: string | null;
  previewPort: number | null;
  setPreviewUrl: (url: string | null) => void;
  setPreviewPort: (port: number | null) => void;
  memoryRefreshKey: number;
  setMemoryRefreshKey: (fn: (prev: number) => number) => void;
  status: string;
}

function AppInner({
  activeTab,
  setActiveTab,
  previewUrl,
  previewPort,
  setPreviewUrl,
  setPreviewPort,
  memoryRefreshKey,
  setMemoryRefreshKey,
  status,
}: AppInnerProps) {
  const { writeToActiveTerminal, toggleSplit, splitState } = useTerminalTabs();
  const { isDesktopApp } = useDesktopApp();
  const { isWebDesktopMode } = useWebDesktopMode();
  const { enabled: dashboardEnabled } = useDashboard();
  const { memoryEnabled } = useSettings();

  // Enable split mode only once when dashboard is first activated
  // Use a ref to track if we've already set up split for this dashboard activation
  const dashboardSplitSetupRef = useRef(false);

  useEffect(() => {
    if (dashboardEnabled && !splitState.enabled && !dashboardSplitSetupRef.current) {
      dashboardSplitSetupRef.current = true;
      toggleSplit();
    }
    // Reset the ref when dashboard is disabled so it can be set up again next time
    if (!dashboardEnabled) {
      dashboardSplitSetupRef.current = false;
    }
  }, [dashboardEnabled, splitState.enabled, toggleSplit]);

  // Handle tab change with memory refresh
  const handleTabChange = useCallback((tab: Tab) => {
    if (tab === 'memory') {
      setMemoryRefreshKey(prev => prev + 1);
    }
    setActiveTab(tab);
  }, [setActiveTab, setMemoryRefreshKey]);

  // Handle localhost links from terminal
  const handleLocalhostLink = useCallback((url: string) => {
    console.log('[App] handleLocalhostLink called with:', url);

    // Match various local URL patterns:
    // - localhost:PORT
    // - 127.0.0.1:PORT
    // - 0.0.0.0:PORT
    // - [::1]:PORT (IPv6 localhost)
    const match = url.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d+)/);
    if (match) {
      const port = parseInt(match[1], 10);
      console.log('[App] Opening preview for port:', port);
      setPreviewPort(port);
      setPreviewUrl(url);
      setActiveTab('preview');
    } else {
      // Try to extract port from any URL with a port number
      const portMatch = url.match(/:(\d{4,5})(?:\/|$)/);
      if (portMatch) {
        const port = parseInt(portMatch[1], 10);
        console.log('[App] Opening preview for port (fallback):', port);
        setPreviewPort(port);
        setPreviewUrl(url);
        setActiveTab('preview');
      } else {
        console.warn('[App] Could not extract port from URL:', url);
      }
    }
  }, [setActiveTab, setPreviewPort, setPreviewUrl]);

  // Run custom command in terminal - cd to path and run command
  // Targets the last active terminal pane
  const handleRunCustomCommand = useCallback((path: string, command: string) => {
    if (!dashboardEnabled) {
      setActiveTab('terminal');
    }

    // For TUI apps like claude, we need extra time for terminal to resize properly
    // and should clear the screen first to avoid rendering artifacts
    const isTuiApp = command && (
      command.includes('claude') ||
      command.includes('vim') ||
      command.includes('nvim') ||
      command.includes('nano') ||
      command.includes('htop') ||
      command.includes('top')
    );

    if (isTuiApp) {
      // Longer delay for TUI apps to ensure terminal is properly sized
      // First wait for tab switch and resize
      setTimeout(() => {
        // Clear screen and reset terminal state before running TUI
        writeToActiveTerminal('clear\r');
        // Then run the actual command after clear completes
        setTimeout(() => {
          writeToActiveTerminal(`cd "${path}" && ${command}\r`);
        }, 150);
      }, 200);
    } else {
      // Normal delay for regular commands
      setTimeout(() => {
        if (command) {
          writeToActiveTerminal(`cd "${path}" && ${command}\r`);
        } else {
          writeToActiveTerminal(`cd "${path}"\r`);
        }
      }, 100);
    }
  }, [setActiveTab, writeToActiveTerminal, dashboardEnabled]);

  // Open file in terminal (cd to directory or open file)
  const handleFileOpen = useCallback((path: string, isDirectory: boolean) => {
    if (isDirectory) {
      handleRunCustomCommand(path, '');
    }
  }, [handleRunCustomCommand]);

  return (
    <div className={`app ${dashboardEnabled ? 'dashboard-mode' : ''} ${isDesktopApp ? 'desktop-app' : ''}`}>
      {/* Desktop drag region for window dragging - data-tauri-drag-region is required for Tauri 2.x */}
      {isDesktopApp && <div className="desktop-drag-region" data-tauri-drag-region />}
      <main className="main-content">
        {dashboardEnabled ? (
          // Dashboard mode: 3-column layout
          <DashboardLayout
            onNavigate={handleFileOpen}
            onRunCustomCommand={handleRunCustomCommand}
            onLink={handleLocalhostLink}
            memoryRefreshKey={memoryRefreshKey}
          />
        ) : (
          // Normal tab mode
          <>
            {/* Terminal split container - always mounted to preserve xterm state */}
            <div className={`tab-panel ${activeTab === 'terminal' ? 'active' : ''}`}>
              <SplitContainer
                isVisible={activeTab === 'terminal'}
                onLink={handleLocalhostLink}
                status={status as 'connecting' | 'connected' | 'reconnecting' | 'disconnected'}
              />
            </div>

            {activeTab === 'files' && (
              <div className="tab-panel active">
                <FileBrowser
                  onNavigate={handleFileOpen}
                  onRunCustomCommand={handleRunCustomCommand}
                />
              </div>
            )}

            {/* Memory viewer - only mounted when enabled */}
            {memoryEnabled && (
              <div className={`tab-panel ${activeTab === 'memory' ? 'active' : ''}`} style={{ display: activeTab === 'memory' ? 'flex' : 'none' }}>
                <MemoryViewer refreshKey={memoryRefreshKey} />
              </div>
            )}

            {activeTab === 'preview' && (
              <div className="tab-panel active">
                <Preview port={previewPort} originalUrl={previewUrl} />
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="tab-panel active">
                <Settings />
              </div>
            )}
          </>
        )}

        {/* Settings overlay when in dashboard mode */}
        {dashboardEnabled && activeTab === 'settings' && (
          <div className="dashboard-settings-overlay">
            <div className="dashboard-settings-modal">
              <button
                className="dashboard-settings-close"
                onClick={() => setActiveTab('terminal')}
              >
                &times;
              </button>
              <Settings />
            </div>
          </div>
        )}
      </main>

      <TabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        connectionStatus={status as 'connecting' | 'connected' | 'disconnected'}
        hasPreview={previewPort !== null}
        memoryEnabled={memoryEnabled}
        showDashboardButton={isDesktopApp || isWebDesktopMode}
        dashboardEnabled={dashboardEnabled}
      />
    </div>
  );
}

// Outer component that provides the context
function AppContent() {
  const { socket, status } = useSocket();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    return (localStorage.getItem(STORAGE_KEY_TAB) as Tab) || 'terminal';
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPort, setPreviewPort] = useState<number | null>(null);
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0);

  // Update modal state
  const {
    showUpdateModal,
    updateInfo,
    isDownloading,
    downloadProgress,
    installUpdate,
    dismissUpdate,
  } = useUpdater();

  // Persist active tab
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TAB, activeTab);
  }, [activeTab]);

  return (
    <TerminalTabsProvider socket={socket}>
      <DashboardProvider>
        <AppInner
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          previewUrl={previewUrl}
          previewPort={previewPort}
          setPreviewUrl={setPreviewUrl}
          setPreviewPort={setPreviewPort}
          memoryRefreshKey={memoryRefreshKey}
          setMemoryRefreshKey={setMemoryRefreshKey}
          status={status}
        />
        {/* Update notification modal */}
        {showUpdateModal && updateInfo && (
          <UpdateModal
            updateInfo={updateInfo}
            isDownloading={isDownloading}
            downloadProgress={downloadProgress}
            onInstall={installUpdate}
            onDismiss={dismissUpdate}
          />
        )}
      </DashboardProvider>
    </TerminalTabsProvider>
  );
}

// PIN-protected wrapper component
function PinProtectedApp() {
  const { pinEnabled, pinHash } = useSettings();
  const { isTunnelAccess } = useWebDesktopMode();
  const [isUnlocked, setIsUnlocked] = useState(() => {
    // Check if already unlocked in this session
    return sessionStorage.getItem('terminal_tunnel_unlocked') === 'true';
  });

  // Debug logging
  useEffect(() => {
    console.log('[PIN Debug] isTunnelAccess:', isTunnelAccess);
    console.log('[PIN Debug] pinEnabled:', pinEnabled);
    console.log('[PIN Debug] pinHash:', pinHash ? 'SET' : 'NOT SET');
    console.log('[PIN Debug] isUnlocked:', isUnlocked);
    console.log('[PIN Debug] hostname:', window.location.hostname);
  }, [isTunnelAccess, pinEnabled, pinHash, isUnlocked]);

  // Clear unlock state if PIN was just enabled (prevents bypass)
  useEffect(() => {
    if (pinEnabled && pinHash && isTunnelAccess) {
      // Check if this is a fresh PIN setup - if unlocked but shouldn't be
      const wasUnlocked = sessionStorage.getItem('terminal_tunnel_unlocked') === 'true';
      const pinWasJustSet = sessionStorage.getItem('terminal_tunnel_pin_hash') !== pinHash;

      if (wasUnlocked && pinWasJustSet) {
        // PIN changed, require re-auth
        sessionStorage.removeItem('terminal_tunnel_unlocked');
        sessionStorage.setItem('terminal_tunnel_pin_hash', pinHash);
        setIsUnlocked(false);
      } else if (!sessionStorage.getItem('terminal_tunnel_pin_hash')) {
        // First time setting PIN hash tracking
        sessionStorage.setItem('terminal_tunnel_pin_hash', pinHash);
      }
    }
  }, [pinEnabled, pinHash, isTunnelAccess]);

  // Show PIN lock when accessing via tunnel with PIN enabled
  const showPinLock = isTunnelAccess && pinEnabled && pinHash && !isUnlocked;

  if (showPinLock) {
    return (
      <PinLockScreen
        pinHash={pinHash}
        onUnlock={() => setIsUnlocked(true)}
      />
    );
  }

  return <AppContent />;
}

function App() {
  return (
    <SettingsProvider>
      <PinProtectedApp />
    </SettingsProvider>
  );
}

export default App;
