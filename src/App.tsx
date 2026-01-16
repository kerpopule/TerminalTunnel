import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from './hooks/useSocket';
import { useDesktopApp } from './hooks/useDesktopApp';
import { useWebDesktopMode } from './hooks/useWebDesktopMode';
import { useUpdater } from './hooks/useUpdater';
import { usePinSettings } from './hooks/usePinSettings';
import { useTunnel } from './hooks/useTunnel';
import { useServerControl } from './hooks/useServerControl';
import { SettingsProvider, useSettings, applyThemeToDocument } from './contexts/SettingsContext';
import { themes } from './themes';
import { TerminalTabsProvider, useTerminalTabs } from './contexts/TerminalTabsContext';
import { DASHBOARD_PANE_IDS } from './types/terminal';
import { DashboardProvider, useDashboard } from './contexts/DashboardContext';
import SplitContainer from './components/SplitContainer';
import DashboardLayout from './components/DashboardLayout';
import FileBrowser from './components/FileBrowser';
import MemoryViewer from './components/MemoryViewer';
import Preview from './components/Preview';
import PreviewModeOverlay from './components/PreviewModeOverlay';
import Settings from './components/Settings';
import TabBar from './components/TabBar';
import PinLockScreen from './components/PinLockScreen';
import UpdateModal from './components/UpdateModal';
import { usePushNotifications } from './hooks/usePushNotifications';
import { NotificationOnboarding, useNotificationOnboarding } from './components/NotificationOnboarding';
import { OnboardingContainer } from './components/Onboarding';
import { clearAppStateExceptPersistent } from './utils/clearAppState';

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
  isTunnelAccess: boolean;
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
  isTunnelAccess,
}: AppInnerProps) {
  const { writeToActiveTerminal, toggleSplit, splitState, lastActivePaneId, getActiveTab, createTab, socket } = useTerminalTabs();
  const { isDesktopApp } = useDesktopApp();
  const { isWebDesktopMode } = useWebDesktopMode();
  const { url: tunnelUrl } = useTunnel();
  const { stopServer } = useServerControl();
  const {
    enabled: dashboardEnabled,
    enterPreviewMode,
    exitPreviewMode,
    previewMode,
    previewPort: dashboardPreviewPort,
    previewUrl: dashboardPreviewUrl,
    previewSessionId,
    previewTerminalPaneId,
    activePreviews,
    setCurrentPreview,
    removePreview,
  } = useDashboard();

  // Get the current sessionId from the tabs context using the pane ID
  // This ensures we always use the latest sessionId even if the session was recreated
  const liveTab = previewTerminalPaneId ? getActiveTab(previewTerminalPaneId) : null;
  const currentPreviewSessionId = liveTab?.sessionId || previewSessionId;

  // Debug logging for sessionId resolution
  if (previewMode) {
    console.log('[App] Preview sessionId resolution:', {
      previewTerminalPaneId,
      storedSessionId: previewSessionId?.slice(0, 8),
      liveTabSessionId: liveTab?.sessionId?.slice(0, 8),
      currentPreviewSessionId: currentPreviewSessionId?.slice(0, 8),
      tabId: liveTab?.id,
    });
  }
  const { memoryEnabled } = useSettings();

  // Handler for opening a preview from the play button
  const handleOpenPreview = useCallback((port: number) => {
    setCurrentPreview(port);
  }, [setCurrentPreview]);

  // Handler for stopping a server from the stop button
  // Always removes preview from UI - user's intent is to dismiss it
  // Whether server is already dead or kill fails, we remove the preview
  const handleStopServer = useCallback(async (port: number) => {
    // Attempt to kill the server (best effort)
    await stopServer(port);
    // Always remove from UI - even if server was already dead or kill failed
    removePreview(port);
    return true;
  }, [stopServer, removePreview]);

  // Global keyboard visibility detection - hides tab bar when any keyboard is visible
  useEffect(() => {
    if (!window.visualViewport) return;

    const handleViewportChange = () => {
      const vv = window.visualViewport!;
      const keyboardHeight = window.innerHeight - vv.height;
      const isKeyboardVisible = keyboardHeight > 100;

      if (isKeyboardVisible) {
        document.body.classList.add('keyboard-visible');
        document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
      } else {
        document.body.classList.remove('keyboard-visible');
        document.documentElement.style.setProperty('--keyboard-height', '0px');
      }
    };

    // Check initial state
    handleViewportChange();

    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', handleViewportChange);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      document.body.classList.remove('keyboard-visible');
    };
  }, []);

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
    console.log('[App] handleLocalhostLink called with:', url, 'dashboardEnabled:', dashboardEnabled);

    // Extract port from URL
    let port: number | null = null;

    // Match various local URL patterns:
    // - localhost:PORT
    // - 127.0.0.1:PORT
    // - 0.0.0.0:PORT
    // - [::1]:PORT (IPv6 localhost)
    const match = url.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d+)/);
    if (match) {
      port = parseInt(match[1], 10);
    } else {
      // Try to extract port from any URL with a port number
      const portMatch = url.match(/:(\d{4,5})(?:\/|$)/);
      if (portMatch) {
        port = parseInt(portMatch[1], 10);
      }
    }

    if (!port) {
      console.warn('[App] Could not extract port from URL:', url);
      return;
    }

    console.log('[App] Opening preview for port:', port);

    // In dashboard mode, use the preview overlay with replica terminal
    if (dashboardEnabled) {
      // Use the last active pane ID, fallback to 'primary'
      let paneId = lastActivePaneId || 'primary';
      // Get the sessionId from the active tab in this pane
      let activeTab = getActiveTab(paneId);
      let sessionId = activeTab?.sessionId;

      // If no sessionId found (e.g., lastActivePaneId is 'primary' but we're in dashboard mode),
      // search dashboard panes for one with a valid sessionId
      if (!sessionId) {
        // Use correct dashboard pane IDs: 'top-left', 'top-center', etc.
        for (const dpId of DASHBOARD_PANE_IDS) {
          const tab = getActiveTab(dpId);
          if (tab?.sessionId) {
            paneId = dpId;
            sessionId = tab.sessionId;
            console.log('[App] Found sessionId in dashboard pane:', dpId);
            break;
          }
        }
      }

      if (!sessionId) {
        console.warn('[App] Cannot enter preview mode - no sessionId found in any pane');
        // Fallback to tab mode preview
        setPreviewPort(port);
        setPreviewUrl(url);
        setActiveTab('preview');
        return;
      }

      console.log('[App] Dashboard mode - entering preview mode with pane:', paneId, 'sessionId:', sessionId.slice(0, 8));
      enterPreviewMode(port, url, paneId, sessionId);
    } else {
      // In tab mode, switch to the preview tab
      setPreviewPort(port);
      setPreviewUrl(url);
      setActiveTab('preview');
    }
  }, [setActiveTab, setPreviewPort, setPreviewUrl, dashboardEnabled, enterPreviewMode, lastActivePaneId, getActiveTab]);

  // Run custom command in terminal - cd to path and run command
  // For TUI apps like Claude Code, creates a NEW terminal tab
  const handleRunCustomCommand = useCallback((path: string, command: string) => {
    if (!dashboardEnabled) {
      setActiveTab('terminal');
    }

    // For TUI apps like claude, we create a NEW terminal tab and run there
    const isTuiApp = command && (
      command.includes('claude') ||
      command.includes('vim') ||
      command.includes('nvim') ||
      command.includes('nano') ||
      command.includes('htop') ||
      command.includes('top')
    );

    if (isTuiApp) {
      // Create a NEW terminal tab for TUI apps
      // Use top-left pane in dashboard mode, primary in regular mode
      const paneId = dashboardEnabled ? 'top-left' : 'primary';
      const newTabId = createTab(paneId);

      if (newTabId && socket) {
        // Wait for terminal to fully initialize and bash prompt to appear
        // Replica terminals take ~1.5s to render, so we wait longer
        // Write directly to the new terminal by ID (not via writeToActiveTerminal)
        // because state updates are async and active terminal might not be updated yet
        setTimeout(() => {
          socket.emit('terminal:input', { terminalId: newTabId, data: `cd "${path}" && ${command}\r` });
        }, 1800);
      }
    } else if (!command) {
      // Empty command (Open in Terminal from folder right-click)
      // Create a new tab and cd to the folder
      const paneId = dashboardEnabled ? 'top-left' : 'primary';
      const newTabId = createTab(paneId);

      if (newTabId && socket) {
        setTimeout(() => {
          socket.emit('terminal:input', { terminalId: newTabId, data: `cd "${path}"\r` });
        }, 1800);
      }
    } else {
      // Normal commands with text: use current terminal and execute
      setTimeout(() => {
        writeToActiveTerminal(`cd "${path}" && ${command}\r`);
      }, 100);
    }
  }, [setActiveTab, writeToActiveTerminal, dashboardEnabled, createTab, socket]);

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
          <>
            <DashboardLayout
              onNavigate={handleFileOpen}
              onRunCustomCommand={handleRunCustomCommand}
              onLink={handleLocalhostLink}
              memoryRefreshKey={memoryRefreshKey}
            />
            {/* Preview mode overlay - full-screen on top of dashboard */}
            {previewMode && currentPreviewSessionId && dashboardPreviewPort && (
              <PreviewModeOverlay
                sourceSessionId={currentPreviewSessionId}
                previewPort={dashboardPreviewPort}
                previewUrl={dashboardPreviewUrl}
                tunnelUrl={tunnelUrl}
                isDesktopServerApp={isDesktopApp}
                onClose={exitPreviewMode}
                onLink={handleLocalhostLink}
              />
            )}
          </>
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
                <Preview
                  port={previewPort}
                  originalUrl={previewUrl}
                  tunnelUrl={tunnelUrl}
                  isDesktopServerApp={isDesktopApp}
                />
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
        activePreviews={activePreviews}
        currentPreviewPort={dashboardPreviewPort}
        onOpenPreview={handleOpenPreview}
        onStopServer={handleStopServer}
        isTunnelAccess={isTunnelAccess}
      />
    </div>
  );
}

// Outer component that provides the context
function AppContent() {
  const { socket, status } = useSocket();
  const { isTunnelAccess } = useWebDesktopMode();
  const { isDesktopApp } = useDesktopApp();
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

  // Push notification state for auto-prompting
  const { isSupported: notificationsSupported, isSubscribed: notificationsSubscribed } = usePushNotifications();
  const { showOnboarding, hasSeenOnboarding, show: showNotificationOnboarding, hide: hideNotificationOnboarding, markSeen: markNotificationSeen } = useNotificationOnboarding();

  // Auto-show notification onboarding on first connect (desktop app or tunnel access)
  useEffect(() => {
    if (
      status === 'connected' &&
      (isTunnelAccess || isDesktopApp) &&
      !hasSeenOnboarding &&
      notificationsSupported &&
      !notificationsSubscribed
    ) {
      // Small delay to let UI settle after connection
      const timer = setTimeout(() => showNotificationOnboarding(), 1500);
      return () => clearTimeout(timer);
    }
  }, [status, isTunnelAccess, isDesktopApp, hasSeenOnboarding, notificationsSupported, notificationsSubscribed, showNotificationOnboarding]);

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
          isTunnelAccess={isTunnelAccess}
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
        {/* Push notification onboarding modal */}
        {showOnboarding && (
          <NotificationOnboarding
            onClose={() => { hideNotificationOnboarding(); markNotificationSeen(); }}
            onComplete={() => { hideNotificationOnboarding(); markNotificationSeen(); }}
          />
        )}
      </DashboardProvider>
    </TerminalTabsProvider>
  );
}

// PIN-protected wrapper component
function PinProtectedApp() {
  const { pinEnabled: localPinEnabled, pinHash: localPinHash, setTheme } = useSettings();
  const { isTunnelAccess } = useWebDesktopMode();
  const { serverPinEnabled, serverPinHash, serverThemeName, isLoading: isPinLoading } = usePinSettings();
  const [isUnlocked, setIsUnlocked] = useState(() => {
    // Check if already unlocked in this session
    return sessionStorage.getItem('terminal_tunnel_unlocked') === 'true';
  });

  // Use server settings for tunnel access, local settings for localhost
  const pinEnabled = isTunnelAccess ? serverPinEnabled : localPinEnabled;
  const pinHash = isTunnelAccess ? serverPinHash : localPinHash;

  // Apply server theme on tunnel access ONLY on initial load (no local preference set)
  // Once user changes theme locally, that preference is cached and used on subsequent loads
  useEffect(() => {
    if (isTunnelAccess && serverThemeName && !isPinLoading) {
      const hasLocalTheme = localStorage.getItem('mobile_terminal_has_local_theme') === 'true';
      if (hasLocalTheme) {
        console.log('[Theme] Using cached local theme preference, skipping server theme');
        return;
      }
      console.log('[Theme] Initial load - applying server theme on tunnel access:', serverThemeName);
      setTheme(serverThemeName);
      // Force immediate DOM update for CSS variables and backgrounds
      if (themes[serverThemeName]) {
        applyThemeToDocument(themes[serverThemeName]);
      }
    }
  }, [isTunnelAccess, serverThemeName, isPinLoading, setTheme]);

  // Debug logging
  useEffect(() => {
    console.log('[PIN Debug] isTunnelAccess:', isTunnelAccess);
    console.log('[PIN Debug] pinEnabled (effective):', pinEnabled);
    console.log('[PIN Debug] pinHash (effective):', pinHash ? 'SET' : 'NOT SET');
    console.log('[PIN Debug] isUnlocked:', isUnlocked);
    console.log('[PIN Debug] isPinLoading:', isPinLoading);
    console.log('[PIN Debug] serverThemeName:', serverThemeName);
    console.log('[PIN Debug] hostname:', window.location.hostname);
  }, [isTunnelAccess, pinEnabled, pinHash, isUnlocked, isPinLoading, serverThemeName]);

  // Clear unlock state if PIN hash changed (prevents bypass)
  useEffect(() => {
    if (pinEnabled && pinHash && isTunnelAccess) {
      const storedHash = sessionStorage.getItem('terminal_tunnel_pin_hash');
      if (storedHash && storedHash !== pinHash) {
        // PIN changed, require re-auth
        sessionStorage.removeItem('terminal_tunnel_unlocked');
        sessionStorage.setItem('terminal_tunnel_pin_hash', pinHash);
        setIsUnlocked(false);
      } else if (!storedHash) {
        // First time setting PIN hash tracking
        sessionStorage.setItem('terminal_tunnel_pin_hash', pinHash);
      }
    }
  }, [pinEnabled, pinHash, isTunnelAccess]);

  // Show loading while fetching server PIN settings (only for tunnel access)
  if (isTunnelAccess && isPinLoading) {
    return (
      <div className="pin-lock-overlay">
        <div className="pin-lock-container">
          <div className="pin-lock-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="pin-lock-title">Terminal Tunnel</h1>
          <p className="pin-lock-subtitle">Loading security settings...</p>
          <div className="pin-loading-spinner"></div>
        </div>
      </div>
    );
  }

  // Show PIN lock when accessing via tunnel with PIN enabled
  const showPinLock = isTunnelAccess && pinEnabled && pinHash && !isUnlocked;

  if (showPinLock) {
    return (
      <PinLockScreen
        pinHash={pinHash}
        onUnlock={() => {
          sessionStorage.setItem('terminal_tunnel_unlocked', 'true');
          setIsUnlocked(true);
        }}
      />
    );
  }

  return <AppContent />;
}

// Root app with onboarding check
function AppWithOnboarding() {
  const { isTunnelAccess } = useWebDesktopMode();

  useEffect(() => {
    if (import.meta.env.DEV && !isTunnelAccess) {
      const resetKey = 'mt_onboarding_reset_done';
      if (!localStorage.getItem(resetKey)) {
        localStorage.removeItem('onboarding_complete');
        localStorage.setItem(resetKey, 'true');
      }
    }
  }, [isTunnelAccess]);

  const [showOnboarding, setShowOnboarding] = useState(() => {
    // Check if onboarding has been completed
    return localStorage.getItem('onboarding_complete') !== 'true';
  });

  useEffect(() => {
    if (!isTunnelAccess) {
      void clearAppStateExceptPersistent();
    }
  }, [isTunnelAccess]);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
  }, []);

  // Show onboarding flow if not completed AND not accessing via tunnel
  // Onboarding only shows on the main desktop app, not tunneled sessions
  if (showOnboarding && !isTunnelAccess) {
    return <OnboardingContainer onComplete={handleOnboardingComplete} />;
  }

  return <PinProtectedApp />;
}

function App() {
  return (
    <SettingsProvider>
      <AppWithOnboarding />
    </SettingsProvider>
  );
}

export default App;
