import { useEffect } from 'react';
import { OnboardingButton } from './OnboardingButton';
import { themes, themeList } from '../../themes';
import { applyThemeToDocument } from '../../contexts/SettingsContext';
import { useSettings } from '../../contexts/SettingsContext';

interface ThemeSelectionProps {
  selectedTheme: string;
  onThemeSelect: (theme: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export function ThemeSelection({
  selectedTheme,
  onThemeSelect,
  onNext,
  onBack,
}: ThemeSelectionProps) {
  const { setTheme } = useSettings();

  // Apply theme preview when selected
  useEffect(() => {
    if (themes[selectedTheme]) {
      applyThemeToDocument(themes[selectedTheme]);
    }
  }, [selectedTheme]);

  const handleThemeSelect = (themeName: string) => {
    onThemeSelect(themeName);
    // Also update the actual settings
    setTheme(themeName);
  };

  const handleNext = () => {
    // Ensure the theme is saved
    setTheme(selectedTheme);
    onNext();
  };

  return (
    <div className="onboarding-screen theme-selection-screen">
      <h1 className="screen-title">Choose Your Theme</h1>
      <p className="screen-subtitle">Select a color scheme that suits your style</p>

      <div className="theme-grid">
        {themeList.map((theme) => (
          <button
            key={theme.name}
            className={`theme-card ${selectedTheme === theme.name ? 'selected' : ''}`}
            onClick={() => handleThemeSelect(theme.name)}
          >
            <div className="theme-preview">
              <div
                className="preview-bg"
                style={{ backgroundColor: theme.preview[0] }}
              >
                <div
                  className="preview-accent"
                  style={{ backgroundColor: theme.preview[1] }}
                />
                <div
                  className="preview-text"
                  style={{ backgroundColor: theme.preview[2] }}
                />
              </div>
            </div>
            <span className="theme-name">{theme.displayName}</span>
            {selectedTheme === theme.name && (
              <span className="theme-check">&#10003;</span>
            )}
          </button>
        ))}
      </div>

      <div className="button-row">
        <OnboardingButton onClick={onBack} variant="ghost">
          Back
        </OnboardingButton>
        <OnboardingButton onClick={handleNext} variant="primary">
          Continue
        </OnboardingButton>
      </div>
    </div>
  );
}
