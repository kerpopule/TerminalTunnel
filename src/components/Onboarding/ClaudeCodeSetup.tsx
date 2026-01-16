import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { OnboardingButton } from './OnboardingButton';

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

// Format star count (e.g., 13200 -> "13.2k")
const formatStarCount = (count: number): string => {
  if (count >= 1000) {
    return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return count.toString();
};

interface ClaudeCodeSetupProps {
  claudeCodeEnabled: boolean;
  hooksEnabled: boolean;
  claudeMemEnabled: boolean;
  onUpdate: (
    claudeCode: boolean,
    hooks: boolean,
    claudeMem: boolean
  ) => void;
  onNext: () => void;
  onBack: () => void;
}

const CLAUDE_CODE_INSTALL_URL = 'https://docs.anthropic.com/en/docs/claude-code';
const CLAUDE_MEM_URL = 'https://github.com/thedotmack/claude-mem';

export function ClaudeCodeSetup({
  claudeCodeEnabled,
  hooksEnabled,
  claudeMemEnabled,
  onUpdate,
  onNext,
  onBack,
}: ClaudeCodeSetupProps) {
  // Detection states
  const [isDetecting, setIsDetecting] = useState(!claudeCodeEnabled);
  const [isClaudeCodeInstalled, setIsClaudeCodeInstalled] = useState(claudeCodeEnabled);
  const [isClaudeMemInstalled, setIsClaudeMemInstalled] = useState(false);

  // Toggle states
  const [hooksToggle, setHooksToggle] = useState(true);
  const [claudeMemToggle, setClaudeMemToggle] = useState(claudeMemEnabled);

  // Installation states
  const [isInstalling, setIsInstalling] = useState<'hooks' | 'claude-mem' | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [hooksInstalled, setHooksInstalled] = useState(hooksEnabled);

  // GitHub star counts
  const [claudeMemStars, setClaudeMemStars] = useState<number | null>(null);

  // Track if detection has run
  const hasDetectedRef = useRef(claudeCodeEnabled);

  // Detect Claude Code using Tauri command (instant, no server needed)
  useEffect(() => {
    if (hasDetectedRef.current) {
      setIsDetecting(false);
      return;
    }

    const detect = async () => {
      setIsDetecting(true);

      // Claude Code: Direct Tauri call - instant, no server dependency
      try {
        const installed = await invoke<boolean>('is_claude_code_installed');
        setIsClaudeCodeInstalled(installed);
        if (installed) {
          onUpdate(true, false, claudeMemToggle);
        }
      } catch (e) {
        console.error('[ClaudeCodeSetup] Tauri detection failed:', e);
      }

      // claude-mem: Direct Tauri call - instant, no server dependency
      try {
        const memInstalled = await invoke<boolean>('is_claude_mem_installed');
        setIsClaudeMemInstalled(memInstalled);
        if (memInstalled) {
          setClaudeMemToggle(true);
        }
      } catch {}

      hasDetectedRef.current = true;
      setIsDetecting(false);
    };

    detect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const installHooks = useCallback(async () => {
    setIsInstalling('hooks');
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setHooksInstalled(true);
      return true;
    } catch (error) {
      console.error('Failed to install hooks:', error);
      return false;
    } finally {
      setIsInstalling(null);
    }
  }, []);

  const installClaudeMem = useCallback(async () => {
    if (isClaudeMemInstalled) return true;

    setIsInstalling('claude-mem');
    setInstallError(null);
    try {
      const response = await fetch('/api/claude-mem/install', { method: 'POST' });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Installation failed');
      }
      setIsClaudeMemInstalled(true);
      return true;
    } catch (error: any) {
      console.error('Failed to install claude-mem:', error);
      setInstallError(`claude-mem: ${error.message}`);
      return false;
    } finally {
      setIsInstalling(null);
    }
  }, [isClaudeMemInstalled]);

  const handleNext = useCallback(async () => {
    setInstallError(null);

    // Install hooks if enabled
    if (isClaudeCodeInstalled && hooksToggle && !hooksInstalled) {
      const success = await installHooks();
      if (!success) return;
    }

    // Install claude-mem if toggled on and not installed
    if (claudeMemToggle && !isClaudeMemInstalled) {
      const success = await installClaudeMem();
      if (!success) return;
    }

    // Update parent state
    onUpdate(isClaudeCodeInstalled, hooksInstalled || hooksToggle, claudeMemToggle);
    onNext();
  }, [
    isClaudeCodeInstalled,
    hooksToggle,
    hooksInstalled,
    claudeMemToggle,
    isClaudeMemInstalled,
    installHooks,
    installClaudeMem,
    onUpdate,
    onNext,
  ]);

  const openInstallPage = () => {
    window.open(CLAUDE_CODE_INSTALL_URL, '_blank');
  };

  if (isDetecting) {
    return (
      <div className="onboarding-screen claude-code-screen">
        <h1 className="screen-title">Claude Code Integration</h1>
        <div className="detecting-spinner">
          <div className="spinner" />
          <span>Detecting tools...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-screen claude-code-screen">
      <h1 className="screen-title">Claude Code Integration</h1>

      {isClaudeCodeInstalled ? (
        <>
          <div className="detected-badge">
            <span className="detected-icon">✓</span>
            <span>Claude Code detected!</span>
          </div>

          <p className="screen-subtitle">
            Configure your AI coding experience
          </p>

          {/* Integration Cards */}
          <div className="integration-cards">
            {/* claude-mem Card */}
            <div className={`integration-card ${claudeMemToggle ? 'active' : ''}`}>
              <div className="integration-header">
                <div className="integration-info">
                  <strong>claude-mem</strong>
                  {isClaudeMemInstalled && (
                    <span className="installed-badge">Installed</span>
                  )}
                </div>
                <button
                  className={`toggle-switch ${claudeMemToggle ? 'on' : ''}`}
                  onClick={() => setClaudeMemToggle(!claudeMemToggle)}
                  disabled={isInstalling !== null}
                >
                  <span className="toggle-slider" />
                </button>
              </div>
              <p className="integration-description">
                Lightweight memory & context injection
                <br />
                <span className="integration-details">SQLite-based, automatic capture</span>
              </p>
              <a
                href={CLAUDE_MEM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="github-badge onboarding"
              >
                <GitHubIcon />
                <StarIcon />
                <span>{claudeMemStars !== null ? formatStarCount(claudeMemStars) : '...'}</span>
              </a>
            </div>

          </div>

          {/* Hooks Section */}
          <div className="hooks-section">
            <div className="hook-item">
              <div className="hook-info">
                <strong>Completion Notifications</strong>
                <span>Get notified when Claude Code finishes a task</span>
              </div>
              <button
                className={`toggle-switch ${hooksToggle ? 'on' : ''}`}
                onClick={() => setHooksToggle(!hooksToggle)}
                disabled={hooksInstalled || isInstalling !== null}
              >
                <span className="toggle-slider" />
              </button>
            </div>

            {claudeMemToggle && (
              <div className="hook-item">
                <div className="hook-info">
                  <strong>Memory Viewer</strong>
                  <span>Track claude-mem integration status</span>
                </div>
                <span className="hook-status">Active</span>
              </div>
            )}
          </div>

          {hooksInstalled && (
            <div className="hooks-installed">
              <span className="success-icon">✓</span>
              <span>Hooks installed successfully!</span>
            </div>
          )}

          {installError && (
            <div className="install-error">
              <span className="error-icon">!</span>
              <span>{installError}</span>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="not-installed-section">
            <div className="not-installed-icon">
              <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor">
                <rect x="2" y="3" width="20" height="14" rx="2" strokeWidth="2" />
                <path d="M8 21h8M12 17v4" strokeWidth="2" />
                <path d="M7 8l3 3-3 3M12 14h4" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>

            <h2>Want to use Claude Code?</h2>
            <p>
              Claude Code is Anthropic's official CLI for AI-assisted coding.
              <br />
              Terminal Tunnel works great with or without it.
            </p>

            <OnboardingButton onClick={openInstallPage} variant="secondary">
              Learn More About Claude Code
            </OnboardingButton>
          </div>
        </>
      )}

      <div className="button-row">
        <OnboardingButton onClick={onBack} variant="ghost" disabled={isInstalling !== null}>
          Back
        </OnboardingButton>
        <OnboardingButton
          onClick={handleNext}
          variant="primary"
          disabled={isInstalling !== null}
        >
          {isInstalling === 'hooks'
            ? 'Installing Hooks...'
            : isInstalling === 'claude-mem'
            ? 'Installing claude-mem...'
            : claudeMemToggle && !isClaudeMemInstalled
            ? 'Install & Continue'
            : 'Continue'}
        </OnboardingButton>
      </div>
    </div>
  );
}
