import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTunnel } from '../hooks/useTunnel';

// Icon components
const QRCodeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="3" height="3" />
    <rect x="18" y="14" width="3" height="3" />
    <rect x="14" y="18" width="3" height="3" />
    <rect x="18" y="18" width="3" height="3" />
  </svg>
);

const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
  </svg>
);

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <rect x="6" y="6" width="12" height="12" />
  </svg>
);

interface TunnelStatusProps {
  isTunnelAccess?: boolean;
}

const TunnelStatus: React.FC<TunnelStatusProps> = ({ isTunnelAccess = false }) => {
  const { url, isConnected, isLoading, startTunnel, stopTunnel, refreshTunnel, copyUrl } = useTunnel();
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleCopy = async () => {
    const success = await copyUrl();
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshTunnel();
    // Keep spinning for a bit to show action completed
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const handleToggleTunnel = async () => {
    if (isConnected) {
      // Show warning modal if in tunneled mode
      if (isTunnelAccess) {
        setShowStopModal(true);
      } else {
        await stopTunnel();
      }
    } else {
      await startTunnel();
    }
  };

  const handleConfirmStop = async () => {
    setShowStopModal(false);
    await stopTunnel();
  };

  if (isLoading) {
    return (
      <div className="tunnel-status loading">
        <div className="tunnel-status-indicator connecting" />
        <span className="tunnel-status-text">Connecting tunnel...</span>
      </div>
    );
  }

  if (!isConnected || !url) {
    return (
      <div className="tunnel-status disconnected">
        <div className="tunnel-status-indicator disconnected" />
        <span className="tunnel-status-text">Tunnel not connected</span>
        <button
          className="tunnel-control-btn"
          onClick={handleToggleTunnel}
          title="Start Tunnel"
        >
          <PlayIcon />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="tunnel-status connected">
        {/* QR Code Button */}
        <button
          className="tunnel-qr-btn"
          onClick={() => setShowQR(true)}
          title="Show QR Code"
        >
          <QRCodeIcon />
        </button>

        {/* Copy Button */}
        <button
          className={`tunnel-copy ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          title="Copy URL"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>

        {/* Status Indicator */}
        <div className="tunnel-status-indicator connected" />

        {/* Tunnel URL */}
        <span className="tunnel-url" title={url}>
          {url.replace('https://', '')}
        </span>

        {/* Refresh Button - Hidden in tunnel access mode */}
        {!isTunnelAccess && (
          <button
            className={`tunnel-control-btn tunnel-refresh-btn ${isRefreshing ? 'refreshing' : ''}`}
            onClick={handleRefresh}
            title="Refresh Tunnel (New URL)"
            disabled={isRefreshing}
          >
            <RefreshIcon />
          </button>
        )}

        {/* Play/Stop Button */}
        <button
          className={`tunnel-control-btn tunnel-play-stop-btn ${isConnected ? 'playing' : 'stopped'}`}
          onClick={handleToggleTunnel}
          title={isConnected ? "Stop Tunnel" : "Start Tunnel"}
        >
          {isConnected ? <StopIcon /> : <PlayIcon />}
        </button>
      </div>

      {/* QR Code Modal */}
      {showQR && (
        <div className="qr-modal-overlay" onClick={() => setShowQR(false)}>
          <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
            <button className="qr-modal-close" onClick={() => setShowQR(false)}>
              &times;
            </button>
            <div className="qr-modal-content">
              <QRCodeSVG
                value={url}
                size={200}
                bgColor="#ffffff"
                fgColor="#000000"
                level="M"
              />
              <div className="qr-modal-url">{url}</div>
            </div>
          </div>
        </div>
      )}

      {/* Stop Confirmation Modal - Only shows in tunnel access mode */}
      {showStopModal && (
        <div className="tunnel-stop-modal-overlay" onClick={() => setShowStopModal(false)}>
          <div className="tunnel-stop-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tunnel-stop-modal-title">Stop Tunnel?</div>
            <div className="tunnel-stop-modal-message">
              Stopping the tunnel will end your current session. You'll need to restart it from the host server to access the dashboard again.
            </div>
            <div className="tunnel-stop-modal-actions">
              <button
                className="tunnel-stop-modal-btn tunnel-stop-modal-btn-cancel"
                onClick={() => setShowStopModal(false)}
              >
                Cancel
              </button>
              <button
                className="tunnel-stop-modal-btn tunnel-stop-modal-btn-confirm"
                onClick={handleConfirmStop}
              >
                Stop Tunnel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default TunnelStatus;
