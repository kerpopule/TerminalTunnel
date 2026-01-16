import { OnboardingButton } from './OnboardingButton';
import { OnboardingData } from './OnboardingContainer';
import { themes } from '../../themes';

interface ReadyScreenProps {
  data: OnboardingData;
  onComplete: () => void;
  onBack: () => void;
}

export function ReadyScreen({ data, onComplete, onBack }: ReadyScreenProps) {
  const theme = themes[data.selectedTheme];

  return (
    <div className="onboarding-screen ready-screen">
      <div className="ready-icon">
        <svg viewBox="0 0 100 100" width="100" height="100">
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="4"
            className="ready-circle"
          />
          <path
            d="M30 50 L45 65 L70 35"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="ready-check"
          />
        </svg>
      </div>

      <h1 className="screen-title">You're All Set!</h1>
      <p className="screen-subtitle">Terminal Tunnel is ready to use</p>

      <div className="summary-list">
        <div className="summary-item">
          <span className="summary-icon">🎨</span>
          <div className="summary-content">
            <span className="summary-label">Theme</span>
            <span className="summary-value">{theme?.displayName || data.selectedTheme}</span>
          </div>
          <span className="summary-check">✓</span>
        </div>

        <div className="summary-item">
          <span className="summary-icon">⭐</span>
          <div className="summary-content">
            <span className="summary-label">Pro Status</span>
            <span className="summary-value">
              {data.licenseKey ? 'Activated' : 'Free Version'}
            </span>
          </div>
          <span className={`summary-check ${data.licenseKey ? '' : 'muted'}`}>
            {data.licenseKey ? '✓' : '−'}
          </span>
        </div>

        <div className="summary-item">
          <span className="summary-icon">📁</span>
          <div className="summary-content">
            <span className="summary-label">Favorite Folders</span>
            <span className="summary-value">
              {data.accessibleFolders.length > 0
                ? `${data.accessibleFolders.length} folders selected`
                : 'None selected'}
            </span>
          </div>
          <span className={`summary-check ${data.accessibleFolders.length > 0 ? '' : 'muted'}`}>
            {data.accessibleFolders.length > 0 ? '✓' : '−'}
          </span>
        </div>

        <div className="summary-item">
          <span className="summary-icon">💻</span>
          <div className="summary-content">
            <span className="summary-label">Claude Code</span>
            <span className="summary-value">
              {data.claudeCodeEnabled
                ? data.hooksEnabled
                  ? 'Configured with hooks'
                  : 'Detected'
                : 'Not installed'}
            </span>
          </div>
          <span className={`summary-check ${data.claudeCodeEnabled ? '' : 'muted'}`}>
            {data.claudeCodeEnabled ? '✓' : '−'}
          </span>
        </div>
      </div>

      <div className="button-row single">
        <OnboardingButton onClick={onComplete} variant="primary" className="launch-button">
          Open Terminal Tunnel
        </OnboardingButton>
      </div>

      <button className="back-link" onClick={onBack}>
        Go back and change settings
      </button>
    </div>
  );
}
