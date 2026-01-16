import React, { useState, useRef, useEffect, useCallback } from 'react';
import { verifyPin } from '../utils/pinUtils';

interface PinLockScreenProps {
  pinHash: string;
  onUnlock: () => void;
}

const PinLockScreen: React.FC<PinLockScreenProps> = ({ pinHash, onUnlock }) => {
  const [pin, setPin] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleVerify = useCallback(async (pinValue: string) => {
    setIsVerifying(true);
    setError(false);

    try {
      const isValid = await verifyPin(pinValue, pinHash);
      if (isValid) {
        // Store unlock state in session storage so refresh doesn't require re-entry
        sessionStorage.setItem('terminal_tunnel_unlocked', 'true');
        onUnlock();
      } else {
        setError(true);
        setPin(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch (err) {
      setError(true);
      setPin(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setIsVerifying(false);
    }
  }, [pinHash, onUnlock]);

  const handleChange = (index: number, value: string) => {
    // Only allow single digits
    if (!/^\d*$/.test(value)) return;

    const newPin = [...pin];

    // Handle paste of full PIN
    if (value.length > 1) {
      const digits = value.slice(0, 6).split('');
      digits.forEach((digit, i) => {
        if (i < 6) newPin[i] = digit;
      });
      setPin(newPin);

      // If we got all 6 digits, verify
      if (digits.length === 6 && digits.every(d => /^\d$/.test(d))) {
        handleVerify(digits.join(''));
      } else {
        // Focus next empty input
        const nextEmpty = newPin.findIndex(d => !d);
        if (nextEmpty !== -1) {
          inputRefs.current[nextEmpty]?.focus();
        }
      }
      return;
    }

    // Single digit input
    newPin[index] = value;
    setPin(newPin);
    setError(false);

    if (value && index < 5) {
      // Move to next input
      inputRefs.current[index + 1]?.focus();
    } else if (value && index === 5) {
      // All digits entered, verify
      const fullPin = newPin.join('');
      if (fullPin.length === 6) {
        handleVerify(fullPin);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      // Move to previous input on backspace if current is empty
      inputRefs.current[index - 1]?.focus();
    }
  };

  return (
    <div className="pin-lock-overlay">
      <div className="pin-lock-container">
        <div className="pin-lock-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h1 className="pin-lock-title">Terminal Tunnel</h1>
        <p className="pin-lock-subtitle">Enter your PIN to continue</p>

        <div className="pin-input-group">
          {pin.map((digit, index) => (
            <input
              key={index}
              ref={el => inputRefs.current[index] = el}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              className={`pin-input ${error ? 'pin-input-error' : ''} ${digit ? 'pin-input-filled' : ''}`}
              value={digit}
              onChange={e => handleChange(index, e.target.value)}
              onKeyDown={e => handleKeyDown(index, e)}
              disabled={isVerifying}
              autoComplete="off"
            />
          ))}
        </div>

        {error && (
          <p className="pin-error">Incorrect PIN. Please try again.</p>
        )}

        {isVerifying && (
          <p className="pin-verifying">Verifying...</p>
        )}
      </div>
    </div>
  );
};

export default PinLockScreen;
