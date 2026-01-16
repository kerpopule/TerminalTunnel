import { OnboardingButton } from './OnboardingButton';

interface WelcomeScreenProps {
  onNext: () => void;
}

export function WelcomeScreen({ onNext }: WelcomeScreenProps) {
  return (
    <div className="onboarding-screen welcome-screen">
      <div className="welcome-logo">
        <svg
          viewBox="0 0 100 100"
          width="120"
          height="120"
          className="logo-icon"
        >
          <rect
            x="10"
            y="10"
            width="80"
            height="80"
            rx="12"
            fill="var(--bg-secondary)"
            stroke="var(--accent)"
            strokeWidth="2"
          />
          <text
            x="50"
            y="58"
            textAnchor="middle"
            fill="var(--accent)"
            fontSize="32"
            fontFamily="monospace"
            fontWeight="bold"
          >
            &gt;_
          </text>
        </svg>
      </div>

      <h1 className="welcome-title">Welcome to Terminal Tunnel</h1>

      <p className="welcome-subtitle">
        Access your Mac terminal from anywhere.
        <br />
        Secure, fast, and beautifully simple.
      </p>

      <div className="welcome-features">
        <div className="feature-item">
          <span className="feature-icon">&#9889;</span>
          <span>Full terminal access with xterm.js</span>
        </div>
        <div className="feature-item">
          <span className="feature-icon">&#128274;</span>
          <span>Secure tunnel via Cloudflare</span>
        </div>
        <div className="feature-item">
          <span className="feature-icon">&#128241;</span>
          <span>Optimized for mobile & desktop</span>
        </div>
      </div>

      <OnboardingButton onClick={onNext} variant="primary">
        Get Started
      </OnboardingButton>
    </div>
  );
}
