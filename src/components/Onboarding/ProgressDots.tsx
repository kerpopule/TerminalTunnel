interface ProgressDotsProps {
  currentStep: number;
  totalSteps: number;
}

export function ProgressDots({ currentStep, totalSteps }: ProgressDotsProps) {
  return (
    <div className="progress-dots">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div
          key={i}
          className={`progress-dot ${i + 1 <= currentStep ? 'active' : ''}`}
        />
      ))}
    </div>
  );
}
