import React, { useState, useEffect } from 'react';
import { usePushNotifications, needsPWAInstallation } from '../hooks/usePushNotifications';

interface NotificationOnboardingProps {
  onClose: () => void;
  onComplete?: () => void;
}

/**
 * Notification onboarding modal that guides users through:
 * 1. Installing PWA (required for iOS)
 * 2. Enabling push notifications
 */
export function NotificationOnboarding({ onClose, onComplete }: NotificationOnboardingProps) {
  const {
    isSupported,
    isPWA,
    isIOS,
    isAndroid,
    permission,
    isSubscribed,
    isLoading,
    error,
    subscribe,
  } = usePushNotifications();

  const [step, setStep] = useState<'pwa' | 'enable' | 'done'>('pwa');
  const { needsInstall } = needsPWAInstallation();

  // Determine initial step
  useEffect(() => {
    if (isSubscribed) {
      setStep('done');
    } else if (!needsInstall && isPWA) {
      setStep('enable');
    } else if (!needsInstall && !isIOS) {
      // Android or desktop - skip PWA step
      setStep('enable');
    }
  }, [needsInstall, isPWA, isIOS, isSubscribed]);

  const handleEnableNotifications = async () => {
    const success = await subscribe();
    if (success) {
      setStep('done');
      onComplete?.();
    }
  };

  const handleDone = () => {
    onClose();
    onComplete?.();
  };

  // Not supported at all
  if (!isSupported) {
    return (
      <div className="notification-onboarding-modal">
        <div className="notification-onboarding-content">
          <h2>Notifications Not Supported</h2>
          <p>
            Your browser doesn't support push notifications.
            Try using a modern browser like Chrome, Safari, or Firefox.
          </p>
          <button onClick={onClose} className="btn-primary">
            Got it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="notification-onboarding-modal">
      <div className="notification-onboarding-content">
        <button className="close-btn" onClick={onClose} aria-label="Close">
          &times;
        </button>

        {step === 'pwa' && needsInstall && (
          <>
            <div className="onboarding-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </div>
            <h2>Add to Home Screen</h2>
            <p>
              To receive notifications when Claude needs your input,
              first add Terminal Tunnel to your home screen.
            </p>

            {isIOS ? (
              <div className="pwa-instructions">
                <div className="instruction-step">
                  <span className="step-number">1</span>
                  <span>Tap the <strong>Share</strong> button</span>
                  <span className="icon-share">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                      <polyline points="16 6 12 2 8 6" />
                      <line x1="12" y1="2" x2="12" y2="15" />
                    </svg>
                  </span>
                </div>
                <div className="instruction-step">
                  <span className="step-number">2</span>
                  <span>Scroll down and tap <strong>Add to Home Screen</strong></span>
                </div>
                <div className="instruction-step">
                  <span className="step-number">3</span>
                  <span>Tap <strong>Add</strong> in the top right</span>
                </div>
                <div className="instruction-step">
                  <span className="step-number">4</span>
                  <span>Open Terminal Tunnel from your home screen</span>
                </div>
              </div>
            ) : (
              <div className="pwa-instructions">
                <div className="instruction-step">
                  <span className="step-number">1</span>
                  <span>Tap the menu icon (three dots)</span>
                </div>
                <div className="instruction-step">
                  <span className="step-number">2</span>
                  <span>Select <strong>Add to Home Screen</strong> or <strong>Install App</strong></span>
                </div>
                <div className="instruction-step">
                  <span className="step-number">3</span>
                  <span>Open Terminal Tunnel from your home screen</span>
                </div>
              </div>
            )}

            <p className="note">
              After installing, open the app from your home screen and enable notifications.
            </p>

            <button onClick={onClose} className="btn-secondary">
              I'll do this later
            </button>
          </>
        )}

        {step === 'enable' && (
          <>
            <div className="onboarding-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <h2>Enable Notifications</h2>
            <p>
              Get notified when Claude stops and is awaiting your input.
              You'll never miss a prompt again.
            </p>

            {error && (
              <p className="error-message">{error}</p>
            )}

            {permission === 'denied' ? (
              <>
                <p className="note warning">
                  Notifications are blocked. Please enable them in your browser/device settings.
                </p>
                <button onClick={onClose} className="btn-secondary">
                  Close
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleEnableNotifications}
                  className="btn-primary"
                  disabled={isLoading}
                >
                  {isLoading ? 'Enabling...' : 'Enable Notifications'}
                </button>
                <button onClick={onClose} className="btn-secondary">
                  Maybe later
                </button>
              </>
            )}
          </>
        )}

        {step === 'done' && (
          <>
            <div className="onboarding-icon success">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2>You're All Set!</h2>
            <p>
              You'll receive notifications whenever Claude stops and awaits your input.
            </p>
            <p className="note">
              Make sure the Claude Code stop hook is configured on your Mac.
              Check Settings for setup instructions.
            </p>
            <button onClick={handleDone} className="btn-primary">
              Got it
            </button>
          </>
        )}
      </div>

      <style>{`
        .notification-onboarding-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 20px;
        }

        .notification-onboarding-content {
          background: var(--bg-secondary, #1a1a1a);
          border-radius: 16px;
          padding: 32px;
          max-width: 400px;
          width: 100%;
          position: relative;
          text-align: center;
        }

        .close-btn {
          position: absolute;
          top: 12px;
          right: 12px;
          background: none;
          border: none;
          color: var(--text-secondary, #888);
          font-size: 24px;
          cursor: pointer;
          padding: 4px 8px;
          line-height: 1;
        }

        .close-btn:hover {
          color: var(--text-primary, #fff);
        }

        .onboarding-icon {
          margin-bottom: 20px;
          color: var(--accent-color, #3b82f6);
        }

        .onboarding-icon.success {
          color: #22c55e;
        }

        h2 {
          margin: 0 0 12px;
          font-size: 20px;
          font-weight: 600;
          color: var(--text-primary, #fff);
        }

        p {
          margin: 0 0 20px;
          color: var(--text-secondary, #a0a0a0);
          font-size: 14px;
          line-height: 1.5;
        }

        .pwa-instructions {
          text-align: left;
          margin: 20px 0;
          background: var(--bg-primary, #0d0d0d);
          border-radius: 12px;
          padding: 16px;
        }

        .instruction-step {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 0;
          border-bottom: 1px solid var(--border-color, #333);
          color: var(--text-primary, #fff);
          font-size: 14px;
        }

        .instruction-step:last-child {
          border-bottom: none;
        }

        .step-number {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          background: var(--accent-color, #3b82f6);
          color: #fff;
          border-radius: 50%;
          font-size: 12px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .icon-share {
          margin-left: auto;
          color: var(--accent-color, #3b82f6);
        }

        .note {
          font-size: 13px;
          color: var(--text-secondary, #888);
          margin-top: 16px;
        }

        .note.warning {
          color: #f59e0b;
        }

        .error-message {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
          padding: 12px;
          border-radius: 8px;
          font-size: 13px;
        }

        .btn-primary {
          display: block;
          width: 100%;
          padding: 14px 24px;
          background: var(--accent-color, #3b82f6);
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          margin-bottom: 12px;
          transition: opacity 0.2s;
        }

        .btn-primary:hover:not(:disabled) {
          opacity: 0.9;
        }

        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-secondary {
          display: block;
          width: 100%;
          padding: 14px 24px;
          background: transparent;
          color: var(--text-secondary, #888);
          border: 1px solid var(--border-color, #333);
          border-radius: 10px;
          font-size: 16px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-secondary:hover {
          background: var(--bg-primary, #0d0d0d);
          color: var(--text-primary, #fff);
        }
      `}</style>
    </div>
  );
}

/**
 * Hook to manage showing the notification onboarding modal
 */
export function useNotificationOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(() => {
    return localStorage.getItem('terminal-tunnel-notification-onboarding-seen') === 'true';
  });

  const show = () => setShowOnboarding(true);
  const hide = () => setShowOnboarding(false);

  const markSeen = () => {
    localStorage.setItem('terminal-tunnel-notification-onboarding-seen', 'true');
    setHasSeenOnboarding(true);
  };

  const reset = () => {
    localStorage.removeItem('terminal-tunnel-notification-onboarding-seen');
    setHasSeenOnboarding(false);
  };

  return {
    showOnboarding,
    hasSeenOnboarding,
    show,
    hide,
    markSeen,
    reset,
  };
}
