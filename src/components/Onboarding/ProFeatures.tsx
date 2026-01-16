import { useState, useCallback } from 'react';
import { OnboardingButton } from './OnboardingButton';
import { useSettings } from '../../contexts/SettingsContext';

interface ProFeaturesProps {
  licenseKey: string | null;
  licenseEmail: string | null;
  onLicenseUpdate: (key: string | null, email: string | null) => void;
  onNext: () => void;
  onBack: () => void;
}

const GUMROAD_URL = 'https://darlows.gumroad.com/l/TerminalTunnel';
const GUMROAD_API = 'https://api.gumroad.com/v2/licenses/verify';
const PRODUCT_ID = 'TerminalTunnel';

export function ProFeatures({
  licenseKey,
  licenseEmail,
  onLicenseUpdate,
  onNext,
  onBack,
}: ProFeaturesProps) {
  const [showLicenseInput, setShowLicenseInput] = useState(false);
  const [keyInput, setKeyInput] = useState(licenseKey || '');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);

  const { setLicenseKey, setLicenseEmail, setLicenseValidated } = useSettings();

  const validateLicense = useCallback(async () => {
    if (!keyInput.trim()) {
      setError('Please enter a license key');
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('product_id', PRODUCT_ID);
      formData.append('license_key', keyInput.trim());

      const response = await fetch(GUMROAD_API, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (data.success && !data.purchase?.refunded && !data.purchase?.chargebacked) {
        const email = data.purchase?.email || null;
        onLicenseUpdate(keyInput.trim(), email);
        setLicenseKey(keyInput.trim());
        setLicenseEmail(email);
        setLicenseValidated(true, Date.now());
        setValidated(true);
        setError(null);
      } else if (data.purchase?.refunded || data.purchase?.chargebacked) {
        setError('This license has been refunded or chargebacked');
      } else {
        setError('Invalid license key. Please check and try again.');
      }
    } catch (err) {
      setError('Failed to validate license. Please try again.');
    } finally {
      setIsValidating(false);
    }
  }, [keyInput, onLicenseUpdate, setLicenseKey, setLicenseEmail, setLicenseValidated]);

  return (
    <div className="onboarding-screen pro-features-screen">
      <h1 className="screen-title">Unlock Pro Features</h1>
      <p className="screen-subtitle">Get the most out of Terminal Tunnel</p>

      <div className="pro-benefits">
        <div className="benefit-item">
          <span className="benefit-icon">&#128640;</span>
          <div className="benefit-content">
            <strong>Auto-Updates</strong>
            <span>Always have the latest features and security fixes</span>
          </div>
        </div>
        <div className="benefit-item">
          <span className="benefit-icon">&#11088;</span>
          <div className="benefit-content">
            <strong>Early Access</strong>
            <span>Be the first to try new features</span>
          </div>
        </div>
        <div className="benefit-item">
          <span className="benefit-icon">&#128172;</span>
          <div className="benefit-content">
            <strong>Priority Support</strong>
            <span>Get help when you need it</span>
          </div>
        </div>
      </div>

      {!showLicenseInput && !validated ? (
        <div className="pro-actions">
          <a
            href={GUMROAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="onboarding-button primary"
          >
            Get Pro
          </a>
          <button
            className="text-link"
            onClick={() => setShowLicenseInput(true)}
          >
            I have a license key
          </button>
        </div>
      ) : validated ? (
        <div className="license-validated">
          <span className="validated-icon">&#10003;</span>
          <span>License activated successfully!</span>
          {licenseEmail && <span className="license-email">{licenseEmail}</span>}
        </div>
      ) : (
        <div className="license-input-section">
          <div className="input-group">
            <input
              type="text"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Enter your license key"
              className="license-input"
              disabled={isValidating}
            />
            <OnboardingButton
              onClick={validateLicense}
              variant="primary"
              disabled={isValidating}
            >
              {isValidating ? 'Validating...' : 'Activate'}
            </OnboardingButton>
          </div>
          {error && <p className="error-message">{error}</p>}
          <button
            className="text-link"
            onClick={() => setShowLicenseInput(false)}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="button-row">
        <OnboardingButton onClick={onBack} variant="ghost">
          Back
        </OnboardingButton>
        <OnboardingButton onClick={onNext} variant="secondary">
          {validated ? 'Continue' : 'Maybe Later'}
        </OnboardingButton>
      </div>
    </div>
  );
}
