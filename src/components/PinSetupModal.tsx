import React, { useState, useRef, useEffect } from 'react';
import { hashPin, isValidPin } from '../utils/pinUtils';

interface PinSetupModalProps {
  onComplete: (hash: string) => void;
  onCancel: () => void;
}

type Step = 'enter' | 'confirm';

const PinSetupModal: React.FC<PinSetupModalProps> = ({ onComplete, onCancel }) => {
  const [step, setStep] = useState<Step>('enter');
  const [pin, setPin] = useState<string[]>(['', '', '', '', '', '']);
  const [firstPin, setFirstPin] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Focus first input on mount and step change
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, [step]);

  const resetInputs = () => {
    setPin(['', '', '', '', '', '']);
    inputRefs.current[0]?.focus();
  };

  const handleComplete = async (fullPin: string) => {
    if (!isValidPin(fullPin)) {
      setError('PIN must be exactly 6 digits');
      resetInputs();
      return;
    }

    if (step === 'enter') {
      // Store first PIN and move to confirm step
      setFirstPin(fullPin);
      setStep('confirm');
      setPin(['', '', '', '', '', '']);
      setError(null);
    } else {
      // Confirm step - check if PINs match
      if (fullPin !== firstPin) {
        setError('PINs do not match. Please try again.');
        setStep('enter');
        setFirstPin('');
        resetInputs();
        return;
      }

      // PINs match - hash and complete
      try {
        const hash = await hashPin(fullPin);
        onComplete(hash);
      } catch (err) {
        setError('Failed to set PIN. Please try again.');
        setStep('enter');
        setFirstPin('');
        resetInputs();
      }
    }
  };

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
      setError(null);

      // If we got all 6 digits, handle complete
      if (digits.length === 6 && digits.every(d => /^\d$/.test(d))) {
        handleComplete(digits.join(''));
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
    setError(null);

    if (value && index < 5) {
      // Move to next input
      inputRefs.current[index + 1]?.focus();
    } else if (value && index === 5) {
      // All digits entered
      const fullPin = newPin.join('');
      if (fullPin.length === 6) {
        handleComplete(fullPin);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      // Move to previous input on backspace if current is empty
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="pin-setup-modal" onClick={e => e.stopPropagation()}>
        <button className="pin-setup-close" onClick={onCancel}>
          &times;
        </button>

        <h2 className="pin-setup-title">
          {step === 'enter' ? 'Set Up PIN' : 'Confirm PIN'}
        </h2>
        <p className="pin-setup-subtitle">
          {step === 'enter'
            ? 'Enter a 6-digit PIN to secure tunnel access'
            : 'Re-enter your PIN to confirm'}
        </p>

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
              autoComplete="off"
            />
          ))}
        </div>

        {error && (
          <p className="pin-error">{error}</p>
        )}

        <div className="pin-setup-actions">
          <button className="modal-btn modal-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default PinSetupModal;
