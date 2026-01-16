import { useState, useCallback, useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useDesktopApp } from './useDesktopApp';

// Gumroad product ID
const GUMROAD_PRODUCT_ID = 'TerminalTunnel';

// Gumroad API endpoint
const GUMROAD_API_URL = 'https://api.gumroad.com/v2/licenses/verify';

// Re-validation interval (30 days in milliseconds)
const REVALIDATION_INTERVAL = 30 * 24 * 60 * 60 * 1000;

interface GumroadResponse {
  success: boolean;
  uses: number;
  purchase: {
    email: string;
    sale_id: string;
    product_id: string;
    created_at: string;
    refunded: boolean;
    chargebacked: boolean;
  };
  message?: string;
}

export interface LicenseState {
  isLicensed: boolean;
  isValidating: boolean;
  licenseEmail: string | null;
  error: string | null;
  needsRevalidation: boolean;
}

export function useLicense() {
  const { isDesktopApp } = useDesktopApp();
  const {
    licenseKey,
    licenseEmail,
    licenseValidated,
    licenseValidatedAt,
    setLicenseKey,
    setLicenseEmail,
    setLicenseValidated,
  } = useSettings();

  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if license needs re-validation (older than 30 days)
  const needsRevalidation = licenseValidated && licenseValidatedAt
    ? Date.now() - licenseValidatedAt > REVALIDATION_INTERVAL
    : false;

  // Computed license status
  const isLicensed = licenseValidated && !needsRevalidation;

  // Validate license key against Gumroad API
  const validateLicense = useCallback(async (key: string): Promise<boolean> => {
    setIsValidating(true);
    setError(null);

    try {
      const response = await fetch(GUMROAD_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          product_id: GUMROAD_PRODUCT_ID,
          license_key: key,
          increment_uses_count: 'true',
        }),
      });

      const data: GumroadResponse = await response.json();

      if (data.success) {
        // Check if purchase was refunded or chargebacked
        if (data.purchase.refunded || data.purchase.chargebacked) {
          setError('This license has been refunded or disputed.');
          return false;
        }

        // License is valid
        setLicenseKey(key);
        setLicenseEmail(data.purchase.email);
        setLicenseValidated(true, Date.now());
        return true;
      } else {
        setError(data.message || 'Invalid license key.');
        return false;
      }
    } catch (err) {
      console.error('License validation error:', err);
      setError('Failed to validate license. Please check your internet connection.');
      return false;
    } finally {
      setIsValidating(false);
    }
  }, [setLicenseKey, setLicenseEmail, setLicenseValidated]);

  // Activate a new license
  const activateLicense = useCallback(async (key: string): Promise<boolean> => {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      setError('Please enter a license key.');
      return false;
    }
    return validateLicense(trimmedKey);
  }, [validateLicense]);

  // Deactivate/remove license
  const deactivateLicense = useCallback(() => {
    setLicenseKey(null);
    setLicenseEmail(null);
    setLicenseValidated(false);
    setError(null);
  }, [setLicenseKey, setLicenseEmail, setLicenseValidated]);

  // Re-validate existing license (silent background check)
  const revalidateLicense = useCallback(async (): Promise<boolean> => {
    if (!licenseKey) return false;
    return validateLicense(licenseKey);
  }, [licenseKey, validateLicense]);

  // Auto-revalidate if needed on mount
  useEffect(() => {
    if (isDesktopApp && needsRevalidation && licenseKey) {
      // Silently revalidate in background
      revalidateLicense().catch(console.error);
    }
  }, [isDesktopApp, needsRevalidation, licenseKey, revalidateLicense]);

  // Clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timeout = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timeout);
    }
  }, [error]);

  return {
    // State
    isLicensed,
    isValidating,
    licenseEmail,
    error,
    needsRevalidation,
    licenseKey,
    // Actions
    activateLicense,
    deactivateLicense,
    revalidateLicense,
  };
}

// Gumroad purchase URL
export const GUMROAD_PURCHASE_URL = 'https://darlows.gumroad.com/l/TerminalTunnel';
