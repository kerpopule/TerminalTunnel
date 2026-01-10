import React, { useState, useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { themeList, terminalFonts, minFontSize, maxFontSize } from '../themes';
import PinSetupModal from './PinSetupModal';
import { useUpdater } from '../hooks/useUpdater';
import { useDesktopApp } from '../hooks/useDesktopApp';
import { useLicense, GUMROAD_PURCHASE_URL } from '../hooks/useLicense';

const Settings: React.FC = () => {
  const {
    theme,
    fontFamily,
    fontSize,
    showKeybar,
    memoryEnabled,
    pinEnabled,
    setTheme,
    setFontFamily,
    setFontSize,
    setShowKeybar,
    setMemoryEnabled,
    setPinEnabled,
    setPinHash,
  } = useSettings();
  const [showPinSetup, setShowPinSetup] = useState(false);
  const { isDesktopApp } = useDesktopApp();
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
              onClick={() => {
                if (!pinEnabled) {
                  // Show PIN setup modal to enable
                  setShowPinSetup(true);
                } else {
                  // Disable PIN
                  setPinEnabled(false);
                  setPinHash(null);
                }
              }}
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
      </div>

      {/* PIN Setup Modal */}
      {showPinSetup && (
        <PinSetupModal
          onComplete={(hash) => {
            setPinHash(hash);
            setPinEnabled(true);
            setShowPinSetup(false);
          }}
          onCancel={() => setShowPinSetup(false)}
        />
      )}
    </div>
  );
};

export default Settings;
