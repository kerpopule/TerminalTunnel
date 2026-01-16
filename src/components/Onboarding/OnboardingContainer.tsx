import { useState, useCallback, useEffect } from 'react';
import { WelcomeScreen } from './WelcomeScreen';
import { ThemeSelection } from './ThemeSelection';
import { ProFeatures } from './ProFeatures';
import { FolderAccess } from './FolderAccess';
import { ClaudeCodeSetup } from './ClaudeCodeSetup';
import { MemoryProviderSetup } from './MemoryProviderSetup';
import { ReadyScreen } from './ReadyScreen';
import { ProgressDots } from './ProgressDots';
import { clearAppState } from '../../utils/clearAppState';
import './Onboarding.css';

const TOTAL_STEPS = 7;

interface OnboardingContainerProps {
  onComplete: () => void;
}

export interface OnboardingData {
  selectedTheme: string;
  licenseKey: string | null;
  licenseEmail: string | null;
  accessibleFolders: string[];
  claudeCodeEnabled: boolean;
  hooksEnabled: boolean;
  claudeMemEnabled: boolean;
}

export function OnboardingContainer({ onComplete }: OnboardingContainerProps) {
  // Clear all app state when onboarding starts
  // This ensures a completely fresh experience every time onboarding runs
  useEffect(() => {
    clearAppState();
  }, []);

  const [currentStep, setCurrentStep] = useState(1);
  const [data, setData] = useState<OnboardingData>({
    selectedTheme: 'ropic',
    licenseKey: null,
    licenseEmail: null,
    accessibleFolders: [],
    claudeCodeEnabled: false,
    hooksEnabled: false,
    claudeMemEnabled: false,
  });

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => Math.min(prev + 1, TOTAL_STEPS));
  }, []);

  const prevStep = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  }, []);

  const updateData = useCallback((updates: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleComplete = useCallback(() => {
    // Mark onboarding as complete
    localStorage.setItem('onboarding_complete', 'true');
    onComplete();
  }, [onComplete]);

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <WelcomeScreen onNext={nextStep} />;
      case 2:
        return (
          <ThemeSelection
            selectedTheme={data.selectedTheme}
            onThemeSelect={(theme) => updateData({ selectedTheme: theme })}
            onNext={nextStep}
            onBack={prevStep}
          />
        );
      case 3:
        return (
          <ProFeatures
            licenseKey={data.licenseKey}
            licenseEmail={data.licenseEmail}
            onLicenseUpdate={(key, email) => updateData({ licenseKey: key, licenseEmail: email })}
            onNext={nextStep}
            onBack={prevStep}
          />
        );
      case 4:
        return (
          <FolderAccess
            accessibleFolders={data.accessibleFolders}
            onFoldersUpdate={(folders) => updateData({ accessibleFolders: folders })}
            onNext={nextStep}
            onBack={prevStep}
          />
        );
      case 5:
        return (
          <ClaudeCodeSetup
            claudeCodeEnabled={data.claudeCodeEnabled}
            hooksEnabled={data.hooksEnabled}
            claudeMemEnabled={data.claudeMemEnabled}
            onUpdate={(claudeCode, hooks, claudeMem) =>
              updateData({
                claudeCodeEnabled: claudeCode,
                hooksEnabled: hooks,
                claudeMemEnabled: claudeMem,
              })
            }
            onNext={nextStep}
            onBack={prevStep}
          />
        );
      case 6:
        return (
          <MemoryProviderSetup
            claudeMemEnabled={data.claudeMemEnabled}
            onNext={nextStep}
            onBack={prevStep}
          />
        );
      case 7:
        return (
          <ReadyScreen
            data={data}
            onComplete={handleComplete}
            onBack={prevStep}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="onboarding-container">
      <div className="onboarding-content">
        {renderStep()}
      </div>
      <ProgressDots currentStep={currentStep} totalSteps={TOTAL_STEPS} />
    </div>
  );
}
