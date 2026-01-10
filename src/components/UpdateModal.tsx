import React from 'react';
import { UpdateInfo } from '../hooks/useUpdater';

interface UpdateModalProps {
  updateInfo: UpdateInfo;
  isDownloading: boolean;
  downloadProgress: number;
  onInstall: () => void;
  onDismiss: () => void;
}

const UpdateModal: React.FC<UpdateModalProps> = ({
  updateInfo,
  isDownloading,
  downloadProgress,
  onInstall,
  onDismiss,
}) => {
  return (
    <div className="update-modal-overlay">
      <div className="update-modal">
        <div className="update-modal-header">
          <div className="update-modal-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <h2>Update Available</h2>
        </div>

        <div className="update-modal-content">
          <div className="update-version-info">
            <div className="update-version-row">
              <span className="update-version-label">Current version:</span>
              <span className="update-version-value">{updateInfo.current_version}</span>
            </div>
            <div className="update-version-row">
              <span className="update-version-label">New version:</span>
              <span className="update-version-value update-version-new">{updateInfo.version}</span>
            </div>
          </div>

          {updateInfo.body && (
            <div className="update-release-notes">
              <h3>Release Notes</h3>
              <div className="update-release-notes-content">
                {updateInfo.body}
              </div>
            </div>
          )}

          {isDownloading && (
            <div className="update-progress">
              <div className="update-progress-bar">
                <div
                  className="update-progress-fill"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
              <span className="update-progress-text">
                {downloadProgress < 100 ? `Downloading... ${downloadProgress}%` : 'Installing...'}
              </span>
            </div>
          )}
        </div>

        <div className="update-modal-actions">
          {!isDownloading ? (
            <>
              <button
                className="update-btn update-btn-secondary"
                onClick={onDismiss}
              >
                Later
              </button>
              <button
                className="update-btn update-btn-primary"
                onClick={onInstall}
              >
                Update Now
              </button>
            </>
          ) : (
            <button
              className="update-btn update-btn-secondary"
              disabled
            >
              Please wait...
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdateModal;
