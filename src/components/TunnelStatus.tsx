import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTunnel } from '../hooks/useTunnel';

// QR Code icon
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

const TunnelStatus: React.FC = () => {
  const { url, isConnected, isLoading, copyUrl, restartTunnel } = useTunnel();
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const handleCopy = async () => {
    const success = await copyUrl();
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
        <button className="tunnel-retry" onClick={restartTunnel}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="tunnel-status connected">
        <button
          className="tunnel-qr-btn"
          onClick={() => setShowQR(true)}
          title="Show QR Code"
        >
          <QRCodeIcon />
        </button>
        <div className="tunnel-status-indicator connected" />
        <span className="tunnel-url" title={url}>
          {url.replace('https://', '')}
        </span>
        <button
          className={`tunnel-copy ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          title="Copy URL"
        >
          {copied ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
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
    </>
  );
};

export default TunnelStatus;
