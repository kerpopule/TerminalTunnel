import React from 'react';
import { useDashboard } from '../contexts/DashboardContext';

const DashboardButton: React.FC = () => {
  const { enabled, toggleDashboard } = useDashboard();

  return (
    <button
      className={`dashboard-button ${enabled ? 'active' : ''}`}
      onClick={toggleDashboard}
      title={enabled ? 'Exit Dashboard' : 'Enter Dashboard'}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Dashboard grid icon */}
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
      <span className="dashboard-button-label">Dashboard</span>
    </button>
  );
};

export default DashboardButton;
