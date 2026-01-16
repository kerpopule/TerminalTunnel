import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

const API_BASE = '';
const MAX_RETRIES = 30; // Max retry attempts (30 * 2s = 60 seconds max wait)
const RETRY_INTERVAL = 2000; // Retry every 2 seconds

interface PreviewProps {
  port: number | null;
  originalUrl: string | null;
  tunnelUrl?: string | null;
  isDesktopServerApp?: boolean;
}

type ConnectionStatus = 'checking' | 'connected' | 'error' | 'retrying';

const Preview: React.FC<PreviewProps> = ({ port, originalUrl: _originalUrl, tunnelUrl, isDesktopServerApp }) => {
  const [cacheKey, setCacheKey] = useState(() => Date.now());
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [retryCount, setRetryCount] = useState(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Determine correct proxy URL based on access mode
  // Desktop app uses localhost, tunnel access uses tunnelUrl
  const proxyUrl = useMemo(() => {
    if (isDesktopServerApp) {
      // Desktop app: can access localhost via server proxy
      return 'http://127.0.0.1:3456';
    } else if (tunnelUrl) {
      // Tunnel access: use tunnel URL (proxied through cloudflare)
      return tunnelUrl;
    } else {
      // Fallback: use API_BASE (for local web development)
      return API_BASE;
    }
  }, [isDesktopServerApp, tunnelUrl]);

  // Navigation handlers for iframe history
  const handleBack = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.history.back();
    } catch {
      // Cross-origin restriction - can't access iframe history
    }
  }, []);

  const handleForward = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.history.forward();
    } catch {
      // Cross-origin restriction - can't access iframe history
    }
  }, []);

  // Popout handler with tunnel/localhost awareness
  const handlePopout = useCallback(() => {
    if (!port) return;

    if (isDesktopServerApp) {
      // Desktop app: open localhost directly in browser
      window.open(`http://localhost:${port}`, '_blank');
    } else if (tunnelUrl) {
      // Tunnel access: open tunneled preview URL
      window.open(`${tunnelUrl}/preview/${port}/`, '_blank');
    } else {
      // Fallback: use API_BASE proxy
      window.open(`${API_BASE}/preview/${port}/`, '_blank');
    }
  }, [port, isDesktopServerApp, tunnelUrl]);

  // Check if server is ready
  const checkServer = useCallback(async (portToCheck: number): Promise<boolean> => {
    try {
      const response = await fetch(`${proxyUrl}/preview/${portToCheck}/`, {
        method: 'HEAD',
        cache: 'no-store',
      });
      return response.ok;
    } catch {
      return false;
    }
  }, [proxyUrl]);

  // Start checking for server availability
  const startChecking = useCallback(async () => {
    if (!port || !isMountedRef.current) return;

    console.log(`[Preview] Checking if server is ready on port ${port}...`);
    const isReady = await checkServer(port);

    if (!isMountedRef.current) return;

    if (isReady) {
      console.log(`[Preview] Server is ready on port ${port}`);
      setStatus('connected');
      setRetryCount(0);
      setCacheKey(Date.now()); // Generate new cache key to bust cache
    } else {
      setRetryCount(prev => {
        const newCount = prev + 1;
        console.log(`[Preview] Server not ready, retry ${newCount}/${MAX_RETRIES}`);

        if (newCount >= MAX_RETRIES) {
          console.log('[Preview] Max retries reached, giving up');
          setStatus('error');
          return newCount;
        }

        setStatus('retrying');
        // Schedule next retry
        retryTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            startChecking();
          }
        }, RETRY_INTERVAL);

        return newCount;
      });
    }
  }, [port, checkServer]);

  // Reset and start checking when port changes
  useEffect(() => {
    isMountedRef.current = true;

    // Clear any pending retry
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (port) {
      console.log('[Preview] Port changed to:', port, '- starting server check');
      setStatus('checking');
      setRetryCount(0);
      setCacheKey(Date.now()); // Always bust cache when loading new link
      startChecking();
    }

    return () => {
      isMountedRef.current = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [port, startChecking]);

  const handleRefresh = () => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    setRetryCount(0);
    setCacheKey(Date.now()); // Generate new cache key
    setStatus('checking');
    startChecking();
  };

  const handleIframeError = () => {
    console.error('[Preview] Iframe load error, will retry...');
    // If iframe fails to load, start retrying
    if (status === 'connected') {
      setStatus('retrying');
      setRetryCount(0);
      startChecking();
    }
  };

  const handleIframeLoad = () => {
    console.log('[Preview] Iframe loaded successfully for port:', port);
  };

  if (!port) {
    return (
      <div className="tab-content">
        <div className="error-state">
          <div className="error-icon">👁️</div>
          <div className="error-title">No Preview Active</div>
          <div className="error-message">
            Click on a localhost URL in the terminal to preview it here.
            <br /><br />
            Example: Run <code>npm run dev</code> and click the localhost link.
          </div>
        </div>
      </div>
    );
  }

  if (status === 'checking' || status === 'retrying') {
    return (
      <div className="tab-content">
        <div className="loading">
          <div className="loading-spinner" />
          <div className="loading-text">
            {status === 'checking' ? 'Connecting' : 'Waiting for server'}...
            {retryCount > 0 && ` (attempt ${retryCount}/${MAX_RETRIES})`}
          </div>
          <div className="loading-subtext">localhost:{port}</div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="tab-content">
        <div className="error-state">
          <div className="error-icon">⚠️</div>
          <div className="error-title">Preview Unavailable</div>
          <div className="error-message">
            Could not connect to localhost:{port} after {MAX_RETRIES} attempts.
            <br /><br />
            Make sure the dev server is running.
          </div>
          <button className="error-retry" onClick={handleRefresh}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="preview-container">
      <div className="preview-header">
        <span className="preview-url">localhost:{port}</span>
        <div className="preview-nav-buttons">
          <button className="file-action-btn" onClick={handleBack} title="Back">
            ←
          </button>
          <button className="file-action-btn" onClick={handleForward} title="Forward">
            →
          </button>
          <button className="file-action-btn" onClick={handleRefresh} title="Refresh">
            🔄
          </button>
          <button className="file-action-btn" onClick={handlePopout} title="Open in browser">
            ↗️
          </button>
        </div>
      </div>
      <iframe
        ref={iframeRef}
        key={cacheKey}
        src={`${proxyUrl}/preview/${port}/?_t=${cacheKey}`}
        className="preview-iframe"
        title={`Preview localhost:${port}`}
        onError={handleIframeError}
        onLoad={handleIframeLoad}
      />
    </div>
  );
};

export default Preview;
