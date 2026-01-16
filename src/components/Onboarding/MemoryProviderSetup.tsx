import { useState, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-shell';
import { OnboardingButton } from './OnboardingButton';

interface MemoryProviderSetupProps {
  claudeMemEnabled: boolean;
  onNext: () => void;
  onBack: () => void;
}

type Provider = 'claude' | 'gemini';

const GEMINI_CONSOLE_URL = 'https://aistudio.google.com/apikey';

export function MemoryProviderSetup({
  claudeMemEnabled,
  onNext,
  onBack,
}: MemoryProviderSetupProps) {
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveProviderSettings = useCallback(async (provider: Provider, geminiKey?: string) => {
    setIsSaving(true);
    setError(null);

    try {
      const settings: Record<string, string> = {
        CLAUDE_MEM_PROVIDER: provider,
      };

      if (provider === 'gemini' && geminiKey) {
        settings.CLAUDE_MEM_GEMINI_API_KEY = geminiKey;
      }

      // Store settings locally first (claude-mem might not be running yet during onboarding)
      localStorage.setItem('claude_mem_provider', provider);
      if (geminiKey) {
        localStorage.setItem('claude_mem_gemini_key', geminiKey);
      }

      // Try to save to claude-mem API if it's running, but don't fail if it's not
      try {
        const settingsResponse = await fetch('http://localhost:37777/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        });

        if (!settingsResponse.ok) {
          console.warn('claude-mem API returned error, settings saved locally');
        }
      } catch (apiErr) {
        // claude-mem not running yet, that's fine - settings are saved locally
        console.log('claude-mem not running yet, settings saved locally for later');
      }

      setSaved(true);
      setTimeout(() => onNext(), 800);
    } catch (err: any) {
      console.error('Failed to save provider settings:', err);
      setError(err.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }, [onNext]);

  const handleClaudeSelect = useCallback(() => {
    setSelectedProvider('claude');
    saveProviderSettings('claude');
  }, [saveProviderSettings]);

  const handleGeminiSelect = useCallback(() => {
    setSelectedProvider('gemini');
  }, []);

  const handleGeminiSave = useCallback(() => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }
    saveProviderSettings('gemini', apiKey.trim());
  }, [apiKey, saveProviderSettings]);

  const openGeminiConsole = useCallback(async () => {
    try {
      await open(GEMINI_CONSOLE_URL);
    } catch (err) {
      console.error('Failed to open URL:', err);
      // Fallback to window.open for web context
      window.open(GEMINI_CONSOLE_URL, '_blank');
    }
  }, []);

  const handleBackFromGemini = useCallback(() => {
    setSelectedProvider(null);
    setApiKey('');
    setError(null);
  }, []);

  // Skip this step if claude-mem wasn't enabled
  if (!claudeMemEnabled) {
    return (
      <div className="onboarding-screen memory-provider-screen">
        <h1 className="screen-title">Memory Configuration</h1>
        <p className="screen-subtitle">
          claude-mem was not enabled. You can configure this later in Settings.
        </p>
        <div className="button-row">
          <OnboardingButton onClick={onBack} variant="ghost">
            Back
          </OnboardingButton>
          <OnboardingButton onClick={onNext} variant="primary">
            Continue
          </OnboardingButton>
        </div>
      </div>
    );
  }

  // Show saving/saved state
  if (isSaving || saved) {
    return (
      <div className="onboarding-screen memory-provider-screen">
        <h1 className="screen-title">Configure Memory Processing</h1>
        <div className="saving-state">
          {isSaving ? (
            <p className="saving-message">Saving settings...</p>
          ) : (
            <div className="input-success">
              <span className="success-icon">✓</span>
              <span>Settings saved successfully!</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Gemini API key input flow
  if (selectedProvider === 'gemini') {
    return (
      <div className="onboarding-screen memory-provider-screen">
        <h1 className="screen-title">Set Up Gemini API</h1>

        <p className="screen-subtitle">
          Get a free API key from Google AI Studio to enable memory processing.
        </p>

        <div className="setup-instructions">
          <h3>Get your free Gemini API key:</h3>
          <ol className="instruction-steps">
            <li>
              <span className="step-number">1</span>
              <span>Click the button below to open Google AI Studio</span>
            </li>
            <li>
              <span className="step-number">2</span>
              <span>Sign in with your Google account</span>
            </li>
            <li>
              <span className="step-number">3</span>
              <span>Click "Create API Key" and copy it</span>
            </li>
            <li>
              <span className="step-number">4</span>
              <span>Paste the key below and save</span>
            </li>
          </ol>

          <OnboardingButton onClick={openGeminiConsole} variant="secondary">
            Open Google AI Studio
          </OnboardingButton>
        </div>

        <div className="api-key-input-section">
          <label htmlFor="gemini-api-key">Gemini API Key</label>
          <input
            id="gemini-api-key"
            type="password"
            className="api-key-input"
            placeholder="AIza..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={isSaving}
          />

          {error && (
            <div className="input-error">
              <span className="error-icon">!</span>
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="button-row">
          <OnboardingButton onClick={handleBackFromGemini} variant="ghost" disabled={isSaving}>
            Back
          </OnboardingButton>
          <OnboardingButton
            onClick={handleGeminiSave}
            variant="primary"
            disabled={isSaving || !apiKey.trim()}
          >
            Save & Continue
          </OnboardingButton>
        </div>
      </div>
    );
  }

  // Provider selection view (initial)
  return (
    <div className="onboarding-screen memory-provider-screen">
      <h1 className="screen-title">Configure Memory Processing</h1>

      <p className="screen-subtitle">
        Choose how claude-mem processes and summarizes your coding sessions.
      </p>

      <div className="provider-options">
        <div className="provider-card recommended" onClick={handleClaudeSelect}>
          <div className="provider-header">
            <span className="provider-name">Claude</span>
            <span className="recommended-badge">Recommended</span>
          </div>
          <p className="provider-description">
            Uses your Claude Code Max plan for memory processing. No API key required.
          </p>
          <OnboardingButton variant="primary" onClick={handleClaudeSelect}>
            Select Claude
          </OnboardingButton>
        </div>

        <div className="provider-card" onClick={handleGeminiSelect}>
          <div className="provider-header">
            <span className="provider-name">Gemini</span>
            <span className="free-badge">Free</span>
          </div>
          <p className="provider-description">
            Uses Google's free Gemini API. Requires a free API key from Google AI Studio.
          </p>
          <OnboardingButton variant="secondary" onClick={handleGeminiSelect}>
            Set Up Gemini
          </OnboardingButton>
        </div>
      </div>

      <div className="button-row">
        <OnboardingButton onClick={onBack} variant="ghost">
          Back
        </OnboardingButton>
        <OnboardingButton onClick={onNext} variant="ghost">
          Skip for now
        </OnboardingButton>
      </div>
    </div>
  );
}
