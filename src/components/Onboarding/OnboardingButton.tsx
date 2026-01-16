import React from 'react';

interface OnboardingButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  className?: string;
}

export function OnboardingButton({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  className = '',
}: OnboardingButtonProps) {
  return (
    <button
      className={`onboarding-button ${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
