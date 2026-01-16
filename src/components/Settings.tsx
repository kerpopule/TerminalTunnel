import React, { useState, useEffect, useCallback } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { themeList, terminalFonts, minFontSize, maxFontSize } from '../themes';
import PinSetupModal from './PinSetupModal';
import { useUpdater } from '../hooks/useUpdater';
import { useDesktopApp } from '../hooks/useDesktopApp';
import { useLicense, GUMROAD_PURCHASE_URL } from '../hooks/useLicense';
import { usePinSettings } from '../hooks/usePinSettings';
import { usePushNotifications, needsPWAInstallation } from '../hooks/usePushNotifications';
import { useWebDesktopMode } from '../hooks/useWebDesktopMode';
import { NotificationOnboarding } from './NotificationOnboarding';

// GitHub icon as SVG (silhouette, theme-aware)
const GitHubIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className={className}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);

// Star icon as SVG
const StarIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" className={className}>
    <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/>
  </svg>
);

// Refresh/Update icon
const RefreshIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M23 4v6h-6M1 20v-6h6"/>
    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
  </svg>
);

// Download/Install icon
const DownloadIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
  </svg>
);

// Format star count (e.g., 13200 -> "13.2k")
const formatStarCount = (count: number): string => {
  if (count >= 1000) {
    return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return count.toString();
};

const Settings: React.FC = () => {
  const {
    theme,
    fontFamily,
    fontSize,
    showKeybar,
    memoryEnabled,
    pinEnabled,
    terminalUploadPath,
    setTheme,
    setFontFamily,
    setFontSize,
    setShowKeybar,
    setMemoryEnabled,
    setPinEnabled,
    setPinHash,
    setTerminalUploadPath,
    claudeMemInjectionEnabled,
    setClaudeMemInjectionEnabled,
  } = useSettings();
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [isSavingPin, setIsSavingPin] = useState(false);
  const [showNotificationOnboarding, setShowNotificationOnboarding] = useState(false);
  const [isUpdatingIntegration, setIsUpdatingIntegration] = useState(false);

  // Integration states
  const [claudeMemInstalled, setClaudeMemInstalled] = useState(false);
  const [claudeMemStars, setClaudeMemStars] = useState<number | null>(null);
  const [isReinstallingClaudeMem, setIsReinstallingClaudeMem] = useState(false);
  const [isCheckingClaudeMemUpdates, setIsCheckingClaudeMemUpdates] = useState(false);
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const { isDesktopApp } = useDesktopApp();
  const { isTunnelAccess } = useWebDesktopMode();
  const {
    isSupported: notificationsSupported,
    isPWA,
    isIOS,
    permission: notificationPermission,
    isSubscribed: notificationsEnabled,
    isLoading: notificationsLoading,
    error: notificationError,
    subscribe: enableNotifications,
    unsubscribe: disableNotifications,
    testNotification,
  } = usePushNotifications();
  const { needsInstall: needsPWAInstall } = needsPWAInstallation();
  const { updateServerSettings } = usePinSettings();
  const {
    isLicensed,
    isValidating,
    licenseEmail,
    error: licenseError,
    activateLicense,
    deactivateLicense,
  } = useLicense();
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const {
    isChecking,
    updateAvailable,
    updateInfo,
    error: updateError,
    checkForUpdates,
    getAppVersion,
  } = useUpdater();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateCheckStatus, setUpdateCheckStatus] = useState<'idle' | 'checking' | 'upToDate' | 'available' | 'error'>('idle');

  // Get app version on mount
  useEffect(() => {
    if (isDesktopApp) {
      getAppVersion().then(setAppVersion);
    }
  }, [isDesktopApp, getAppVersion]);

  // Update check status based on updater state
  useEffect(() => {
    if (isChecking) {
      setUpdateCheckStatus('checking');
    } else if (updateError) {
      setUpdateCheckStatus('error');
    } else if (updateAvailable) {
      setUpdateCheckStatus('available');
    }
  }, [isChecking, updateError, updateAvailable]);

  const handleCheckForUpdates = async () => {
    setUpdateCheckStatus('checking');
    const result = await checkForUpdates(false);
    if (result) {
      setUpdateCheckStatus('available');
    } else {
      setUpdateCheckStatus('upToDate');
    }
  };

  // Fetch GitHub stars on mount
  useEffect(() => {
    const fetchStars = async () => {
      try {
        // claude-mem stars
        const claudeMemRes = await fetch('https://api.github.com/repos/thedotmack/claude-mem');
        if (claudeMemRes.ok) {
          const data = await claudeMemRes.json();
          setClaudeMemStars(data.stargazers_count);
        }
      } catch {
        // Ignore errors
      }
    };
    fetchStars();
  }, []);

  // Detect installed integrations on mount
  useEffect(() => {
    const detectInstallations = async () => {
      try {
        const claudeMemRes = await fetch('/api/claude-mem/detect');
        if (claudeMemRes.ok) {
          const data = await claudeMemRes.json();
          setClaudeMemInstalled(data.installed === true);
        }
      } catch {
        // Ignore
      }
    };
    detectInstallations();
  }, []);

  // Reinstall claude-mem
  const handleReinstallClaudeMem = useCallback(async () => {
    setIsReinstallingClaudeMem(true);
    setIntegrationError(null);
    try {
      const res = await fetch('/api/claude-mem/install', { method: 'POST' });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Installation failed');
      }
      setClaudeMemInstalled(true);
    } catch (error: any) {
      setIntegrationError(`claude-mem: ${error.message}`);
    } finally {
      setIsReinstallingClaudeMem(false);
    }
  }, []);

  // Check for claude-mem updates (git pull)
  const handleCheckClaudeMemUpdates = useCallback(async () => {
    setIsCheckingClaudeMemUpdates(true);
    setIntegrationError(null);
    try {
      const res = await fetch('/api/claude-mem/update', { method: 'POST' });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Update check failed');
      }
      const data = await res.json();
      if (data.updated) {
        setIntegrationError('claude-mem updated successfully!');
      } else {
        setIntegrationError('claude-mem is already up to date');
      }
    } catch (error: any) {
      setIntegrationError(`claude-mem update: ${error.message}`);
    } finally {
      setIsCheckingClaudeMemUpdates(false);
    }
  }, []);

  const handleActivateLicense = async () => {
    const success = await activateLicense(licenseKeyInput);
    if (success) {
      setLicenseKeyInput('');
    }
  };

  const handleDeactivateLicense = () => {
    deactivateLicense();
    setLicenseKeyInput('');
  };

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1 className="settings-title">Settings</h1>
      </div>

      <div className="settings-content">
        {/* Appearance Section */}
        <section className="settings-section">
          <h2 className="settings-section-title">APPEARANCE</h2>

          <div className="settings-group">
            <label className="settings-label">Theme</label>
            <div className="theme-grid">
              {themeList.map((t) => (
                <button
                  key={t.name}
                  className={`theme-card ${theme.name === t.name ? 'active' : ''}`}
                  onClick={() => setTheme(t.name)}
                  style={{
                    '--theme-bg': t.preview[0],
                    '--theme-accent': t.preview[1],
                    '--theme-fg': t.preview[2],
                  } as React.CSSProperties}
                >
                  <div className="theme-preview">
                    <div className="theme-preview-bg" />
                    <div className="theme-preview-accent" />
                    <div className="theme-preview-fg" />
                  </div>
                  <span className="theme-name">{t.displayName}</span>
                  {theme.name === t.name && (
                    <span className="theme-check">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Terminal Section */}
        <section className="settings-section">
          <h2 className="settings-section-title">TERMINAL</h2>

          {/* Font Size */}
          <div className="settings-group">
            <label className="settings-label">
              Font Size
              <span className="settings-value">{fontSize}px</span>
            </label>
            <div className="slider-container">
              <span className="slider-label">{minFontSize}</span>
              <input
                type="range"
                className="slider"
                min={minFontSize}
                max={maxFontSize}
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
              />
              <span className="slider-label">{maxFontSize}</span>
            </div>
          </div>

          {/* Preview */}
          <div className="settings-group">
            <label className="settings-label">Preview</label>
            <div
              className="terminal-preview"
              style={{
                fontFamily: fontFamily,
                fontSize: `${fontSize}px`,
                background: theme.terminal.background,
                color: theme.terminal.foreground,
              }}
            >
              <div style={{ color: theme.terminal.green }}>user@mobile</div>
              <div>
                <span style={{ color: theme.terminal.blue }}>~</span>
                <span style={{ color: theme.terminal.foreground }}> $ </span>
                <span style={{ color: theme.terminal.yellow }}>ls -la</span>
              </div>
              <div style={{ color: theme.terminal.cyan }}>drwxr-xr-x</div>
              <div style={{ color: theme.terminal.magenta }}>package.json</div>
              <div style={{ color: theme.terminal.red }}>error.log</div>
            </div>
          </div>

          {/* Font Selection */}
          <div className="settings-group">
            <label className="settings-label">Font</label>
            <div className="font-grid">
              {terminalFonts.map((font) => (
                <button
                  key={font.value}
                  className={`font-card ${fontFamily === font.value ? 'active' : ''}`}
                  onClick={() => setFontFamily(font.value)}
                  style={{ fontFamily: font.value }}
                >
                  <span className="font-sample">Aa</span>
                  <span className="font-name">{font.name}</span>
                  {fontFamily === font.value && (
                    <span className="font-check">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Keybar Toggle */}
          <div className="settings-group">
            <label className="settings-label">
              Show Keyboard Shortcuts Bar
              <span className="settings-hint">Esc, Tab, Ctrl, arrow keys, etc.</span>
            </label>
            <button
              className={`toggle-btn ${showKeybar ? 'active' : ''}`}
              onClick={() => setShowKeybar(!showKeybar)}
              role="switch"
              aria-checked={showKeybar}
            >
              <span className="toggle-slider" />
            </button>
          </div>

          {/* Upload Folder */}
          <div className="settings-group">
            <label className="settings-label">
              Upload Folder
              <span className="settings-hint">Relative to home directory</span>
            </label>
            <input
              type="text"
              className="settings-input"
              placeholder="Desktop/TerminalTunnel"
              value={terminalUploadPath}
              onChange={(e) => setTerminalUploadPath(e.target.value)}
            />
          </div>
        </section>

        {/* Memory Section */}
        <section className="settings-section">
          <h2 className="settings-section-title">MEMORY</h2>

          <div className="settings-group">
            <label className="settings-label">
              Enable Memory Feature
              <span className="settings-hint">Connect to claude-mem for persistent context</span>
            </label>
            <button
              className={`toggle-btn ${memoryEnabled ? 'active' : ''}`}
              onClick={() => setMemoryEnabled(!memoryEnabled)}
              role="switch"
              aria-checked={memoryEnabled}
            >
              <span className="toggle-slider" />
            </button>
          </div>

          <div className="settings-group">
            <p className="settings-info">
              Memory allows Claude to remember context across sessions.{' '}
              <a
                href="https://claude-mem.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="settings-link"
              >
                Learn how to set up claude-mem
              </a>
            </p>
          </div>
        </section>

        {/* Integrations Section */}
        <section className="settings-section">
          <h2 className="settings-section-title">INTEGRATIONS</h2>

          {/* claude-mem Integration Card */}
          <div className="integration-card-settings">
            <div className="integration-card-header">
              <div className="integration-card-title">
                <span className="integration-name">claude-mem</span>
                {claudeMemInstalled && <span className="integration-badge installed">Installed</span>}
              </div>
              <button
                className={`toggle-btn ${claudeMemInjectionEnabled ? 'active' : ''}`}
                onClick={async () => {
                  setIsUpdatingIntegration(true);
                  try {
                    await fetch('/api/claude-mem/injection-settings', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ enabled: !claudeMemInjectionEnabled }),
                    });
                    setClaudeMemInjectionEnabled(!claudeMemInjectionEnabled);
                  } catch (error) {
                    console.error('Failed to update claude-mem settings:', error);
                  } finally {
                    setIsUpdatingIntegration(false);
                  }
                }}
                disabled={isUpdatingIntegration}
                role="switch"
                aria-checked={claudeMemInjectionEnabled}
              >
                <span className="toggle-slider" />
              </button>
            </div>
            <p className="integration-card-desc">
              Lightweight memory & context injection
            </p>
            <div className="integration-card-actions">
              <a
                href="https://github.com/thedotmack/claude-mem"
                target="_blank"
                rel="noopener noreferrer"
                className="github-badge"
              >
                <GitHubIcon />
                <StarIcon />
                <span>{claudeMemStars !== null ? formatStarCount(claudeMemStars) : '...'}</span>
              </a>
              {claudeMemInstalled && (
                <>
                  <button
                    className="integration-action-btn"
                    onClick={handleCheckClaudeMemUpdates}
                    disabled={isCheckingClaudeMemUpdates}
                    title="Check for updates"
                  >
                    <RefreshIcon className={isCheckingClaudeMemUpdates ? 'spinning' : ''} />
                    {isCheckingClaudeMemUpdates ? 'Updating...' : 'Update'}
                  </button>
                  <button
                    className="integration-action-btn"
                    onClick={handleReinstallClaudeMem}
                    disabled={isReinstallingClaudeMem}
                    title="Reinstall"
                  >
                    <DownloadIcon />
                    {isReinstallingClaudeMem ? 'Installing...' : 'Reinstall'}
                  </button>
                </>
              )}
              {!claudeMemInstalled && (
                <button
                  className="integration-action-btn primary"
                  onClick={handleReinstallClaudeMem}
                  disabled={isReinstallingClaudeMem}
                >
                  <DownloadIcon />
                  {isReinstallingClaudeMem ? 'Installing...' : 'Install'}
                </button>
              )}
            </div>
          </div>

          {integrationError && (
            <div className="settings-group">
              <p className={`settings-info ${integrationError.includes('successfully') || integrationError.includes('up to date') ? 'settings-success' : 'settings-error'}`}>
                {integrationError}
              </p>
            </div>
          )}
        </section>

        {/* Security Section */}
        <section className="settings-section">
          <h2 className="settings-section-title">SECURITY</h2>

          <div className="settings-group">
            <label className="settings-label">
              PIN Lock
              <span className="settings-hint">Require PIN when accessing via tunnel</span>
            </label>
            <button
              className={`toggle-btn ${pinEnabled ? 'active' : ''}`}
              onClick={async () => {
                if (!pinEnabled) {
                  // Show PIN setup modal to enable
                  setShowPinSetup(true);
                } else {
                  // Disable PIN - sync to server first
                  setIsSavingPin(true);
                  const success = await updateServerSettings(false, null);
                  setIsSavingPin(false);
                  if (success) {
                    setPinEnabled(false);
                    setPinHash(null);
                  }
                }
              }}
              disabled={isSavingPin}
              role="switch"
              aria-checked={pinEnabled}
            >
              <span className="toggle-slider" />
            </button>
          </div>

          {pinEnabled && (
            <div className="settings-group">
              <button
                className="settings-btn"
                onClick={() => setShowPinSetup(true)}
              >
                Change PIN
              </button>
            </div>
          )}

          <div className="settings-group">
            <p className="settings-info">
              When enabled, you'll need to enter a 6-digit PIN each time you access Terminal Tunnel via the Cloudflare tunnel.
            </p>
          </div>
        </section>

        {/* Notifications Section */}
        <section className="settings-section">
          <h2 className="settings-section-title">NOTIFICATIONS</h2>

          {!notificationsSupported ? (
            <div className="settings-group">
              <p className="settings-info settings-muted">
                Push notifications are not supported in this browser.
              </p>
            </div>
          ) : needsPWAInstall ? (
            <>
              <div className="settings-group">
                <label className="settings-label">
                  Status
                  <span className="settings-value settings-muted">Requires Installation</span>
                </label>
              </div>
              <div className="settings-group">
                <button
                  className="settings-btn"
                  onClick={() => setShowNotificationOnboarding(true)}
                >
                  Set Up Notifications
                </button>
              </div>
              <div className="settings-group">
                <p className="settings-info">
                  {isIOS
                    ? 'Add Terminal Tunnel to your home screen to enable notifications.'
                    : 'Install Terminal Tunnel as an app to enable notifications.'}
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Show setup button for desktop/tunnel users who haven't enabled notifications yet */}
              {!notificationsEnabled && (isDesktopApp || isTunnelAccess) ? (
                <>
                  <div className="settings-group">
                    <label className="settings-label">
                      Status
                      <span className="settings-value settings-muted">Not Enabled</span>
                    </label>
                  </div>
                  <div className="settings-group">
                    <button
                      className="settings-btn"
                      onClick={() => setShowNotificationOnboarding(true)}
                      disabled={notificationsLoading}
                    >
                      Set Up Notifications
                    </button>
                  </div>
                  <div className="settings-group">
                    <p className="settings-info">
                      Enable push notifications to get alerted when Claude is awaiting your input.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="settings-group">
                    <label className="settings-label">
                      Push Notifications
                      <span className="settings-hint">Get notified when Claude awaits input</span>
                    </label>
                    <button
                      className={`toggle-btn ${notificationsEnabled ? 'active' : ''}`}
                      onClick={async () => {
                        if (notificationsEnabled) {
                          await disableNotifications();
                        } else {
                          if (notificationPermission === 'denied') {
                            alert('Notifications are blocked. Please enable them in your device settings.');
                          } else {
                            await enableNotifications();
                          }
                        }
                      }}
                      disabled={notificationsLoading}
                      role="switch"
                      aria-checked={notificationsEnabled}
                    >
                      <span className="toggle-slider" />
                    </button>
                  </div>
                </>
              )}

              {notificationPermission === 'denied' && (
                <div className="settings-group">
                  <p className="settings-info settings-error">
                    Notifications are blocked. Please enable them in your browser/device settings.
                  </p>
                </div>
              )}

              {notificationError && (
                <div className="settings-group">
                  <p className="settings-info settings-error">{notificationError}</p>
                </div>
              )}

              {notificationsEnabled && (
                <div className="settings-group">
                  <button
                    className="settings-btn settings-btn-secondary"
                    onClick={testNotification}
                  >
                    Send Test Notification
                  </button>
                </div>
              )}

              {/* Claude Code Hook Setup - only show on desktop */}
              {isDesktopApp && (
                <div className="settings-group">
                  <label className="settings-label">Claude Code Hook</label>
                  <p className="settings-info">
                    To receive notifications when Claude stops, add this to your Claude Code settings:
                  </p>
                  <pre className="settings-code">
{`~/.config/claude/settings.json:
{
  "hooks": {
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST http://127.0.0.1:3456/api/notify -H 'Content-Type: application/json' -d '{\"type\":\"stop\"}' &"
      }]
    }]
  }
}`}
                  </pre>
                </div>
              )}
            </>
          )}
        </section>

        {/* License Section - only show on desktop app */}
        {isDesktopApp && (
          <section className="settings-section">
            <h2 className="settings-section-title">LICENSE</h2>

            {isLicensed ? (
              <>
                <div className="settings-group">
                  <label className="settings-label">
                    Status
                    <span className="settings-value settings-success">Active</span>
                  </label>
                </div>

                {licenseEmail && (
                  <div className="settings-group">
                    <label className="settings-label">
                      Licensed to
                      <span className="settings-value">{licenseEmail}</span>
                    </label>
                  </div>
                )}

                <div className="settings-group">
                  <button
                    className="settings-btn settings-btn-secondary"
                    onClick={handleDeactivateLicense}
                  >
                    Deactivate License
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="settings-group">
                  <label className="settings-label">
                    Status
                    <span className="settings-value settings-muted">Not Activated</span>
                  </label>
                </div>

                <div className="settings-group">
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="Enter license key"
                    value={licenseKeyInput}
                    onChange={(e) => setLicenseKeyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && licenseKeyInput.trim()) {
                        handleActivateLicense();
                      }
                    }}
                  />
                </div>

                <div className="settings-group">
                  <button
                    className="settings-btn"
                    onClick={handleActivateLicense}
                    disabled={isValidating || !licenseKeyInput.trim()}
                  >
                    {isValidating ? 'Activating...' : 'Activate License'}
                  </button>
                </div>

                {licenseError && (
                  <div className="settings-group">
                    <p className="settings-info settings-error">{licenseError}</p>
                  </div>
                )}

                <div className="settings-group">
                  <p className="settings-info">
                    Don't have a license?{' '}
                    <a
                      href={GUMROAD_PURCHASE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="settings-link"
                    >
                      Get Terminal Tunnel Pro - $20
                    </a>
                  </p>
                </div>
              </>
            )}
          </section>
        )}

        {/* System Section - only show on desktop app */}
        {isDesktopApp && (
          <section className="settings-section">
            <h2 className="settings-section-title">SYSTEM</h2>

            <div className="settings-group">
              <label className="settings-label">
                Version
                <span className="settings-value">{appVersion || '...'}</span>
              </label>
            </div>

            {isLicensed ? (
              <div className="settings-group">
                <button
                  className="settings-btn"
                  onClick={handleCheckForUpdates}
                  disabled={isChecking}
                >
                  {isChecking ? 'Checking...' : 'Check for Updates'}
                </button>

                {updateCheckStatus === 'upToDate' && (
                  <p className="settings-info settings-success">
                    You're running the latest version.
                  </p>
                )}

                {updateCheckStatus === 'available' && updateInfo && (
                  <p className="settings-info settings-update-available">
                    Update available: v{updateInfo.version}
                  </p>
                )}

                {updateCheckStatus === 'error' && (
                  <p className="settings-info settings-error">
                    Failed to check for updates. Please try again later.
                  </p>
                )}
              </div>
            ) : (
              <div className="settings-group">
                <p className="settings-info settings-muted">
                  Auto-updates require a Pro license.
                </p>
                <a
                  href={GUMROAD_PURCHASE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="settings-btn settings-btn-accent"
                  style={{ display: 'inline-block', textAlign: 'center', textDecoration: 'none', marginTop: '8px' }}
                >
                  Get Terminal Tunnel Pro - $20
                </a>
              </div>
            )}
          </section>
        )}

        {/* Reset Section - show on desktop app or when not tunnel access */}
        {!isTunnelAccess && (
          <section className="settings-section">
            <h2 className="settings-section-title">RESET</h2>

            <div className="settings-group">
              <label className="settings-label">
                Redo Onboarding
                <span className="settings-hint">Start fresh with the setup wizard</span>
              </label>
            </div>

            <div className="settings-group">
              <button
                className="settings-btn settings-btn-danger"
                onClick={() => {
                  localStorage.removeItem('onboarding_complete');
                  window.location.reload();
                }}
              >
                Reset & Redo Onboarding
              </button>
            </div>

            <div className="settings-group">
              <p className="settings-info">
                This will clear your settings and tabs, then show the onboarding wizard again. Favorites and permissions stay.
              </p>
            </div>
          </section>
        )}
      </div>

      {/* PIN Setup Modal */}
      {showPinSetup && (
        <PinSetupModal
          onComplete={async (hash) => {
            // Sync to server first
            setIsSavingPin(true);
            const success = await updateServerSettings(true, hash);
            setIsSavingPin(false);
            if (success) {
              // Also save locally
              setPinHash(hash);
              setPinEnabled(true);
            }
            setShowPinSetup(false);
          }}
          onCancel={() => setShowPinSetup(false)}
        />
      )}

      {/* Notification Onboarding Modal */}
      {showNotificationOnboarding && (
        <NotificationOnboarding
          onClose={() => setShowNotificationOnboarding(false)}
          onComplete={() => setShowNotificationOnboarding(false)}
        />
      )}

    </div>
  );
};

export default Settings;
