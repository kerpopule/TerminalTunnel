import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { mapThemeToMemoryViewer } from '../utils/memoryViewerTheme';

interface MemoryViewerProps {
  refreshKey: number;
}

const CLAUDE_MEM_LOCAL = 'http://localhost:37777';
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 1000;
const INITIAL_DELAY_MS = 2000; // Wait for backend server to be ready

const MemoryViewer: React.FC<MemoryViewerProps> = ({ refreshKey }) => {
  const [isLocalAvailable, setIsLocalAvailable] = useState<boolean | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [iframeKey, setIframeKey] = useState(0); // Force iframe refresh
  const [iframeReady, setIframeReady] = useState(false);
  const mountedRef = useRef(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { theme } = useSettings();

  // Send theme to iframe via postMessage
  const sendThemeToIframe = useCallback(() => {
    const iframe = iframeRef.current;
    if (iframe && iframe.contentWindow) {
      const themeData = mapThemeToMemoryViewer(theme);
      iframe.contentWindow.postMessage(
        { type: 'theme-update', theme: themeData, themeName: theme.name },
        '*'
      );
    }
  }, [theme]);

  // Send theme when theme changes and iframe is ready
  useEffect(() => {
    if (iframeReady && isLocalAvailable) {
      sendThemeToIframe();
    }
  }, [theme, iframeReady, isLocalAvailable, sendThemeToIframe]);

  // Handle iframe load event
  const handleIframeLoad = useCallback(() => {
    setIframeReady(true);
    // Small delay to ensure iframe content is fully loaded
    setTimeout(() => {
      sendThemeToIframe();
    }, 100);
  }, [sendThemeToIframe]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let currentRetry = 0;

    const checkAvailability = async (): Promise<boolean> => {
      // Try localhost:37777 directly first (works when running on same machine)
      try {
        const response = await fetch(`${CLAUDE_MEM_LOCAL}/api/projects`, {
          method: 'GET',
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          return true;
        }
      } catch {
        // localhost not directly accessible, try through proxy
      }

      // Try through our server's proxy
      try {
        const response = await fetch('/api/projects', {
          method: 'GET',
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          return true;
        }
      } catch {
        // Proxy also failed
      }

      return false;
    };

    const attemptConnection = async () => {
      if (!mountedRef.current) return;

      const available = await checkAvailability();

      if (!mountedRef.current) return;

      if (available) {
        setIsLocalAvailable(true);
        setRetryCount(0);
        // Increment iframe key to force a fresh load
        setIframeReady(false);
        setIframeKey(k => k + 1);
      } else if (currentRetry < MAX_RETRIES) {
        // Retry after delay
        currentRetry++;
        setRetryCount(currentRetry);
        retryTimeout = setTimeout(attemptConnection, RETRY_DELAY_MS);
      } else {
        // Max retries reached, fall back to website
        setIsLocalAvailable(false);
        setRetryCount(0);
      }
    };

    // Reset state and start checking after initial delay
    // This gives the backend server time to start up
    setIsLocalAvailable(null);
    setRetryCount(0);
    setIframeReady(false);
    currentRetry = 0;

    const initialTimeout = setTimeout(() => {
      if (mountedRef.current) {
        attemptConnection();
      }
    }, INITIAL_DELAY_MS);

    // Re-check periodically in case claude-mem is started later
    const interval = setInterval(() => {
      if (mountedRef.current) {
        currentRetry = 0;
        attemptConnection();
      }
    }, 30000);

    return () => {
      clearTimeout(initialTimeout);
      if (retryTimeout) clearTimeout(retryTimeout);
      clearInterval(interval);
    };
  }, [refreshKey]);

  // Loading state while checking availability
  if (isLocalAvailable === null) {
    return (
      <div className="memory-viewer-container">
        <div className="memory-viewer-loading">
          <div className="loading-spinner" />
          <span className="loading-text">
            {retryCount === 0
              ? 'Connecting to memory service...'
              : `Retrying... (${retryCount}/${MAX_RETRIES})`}
          </span>
        </div>
      </div>
    );
  }

  // Fallback to claude-mem.ai website when local service is unavailable
  if (!isLocalAvailable) {
    return (
      <div className="memory-viewer-container">
        <iframe
          key={`fallback-${refreshKey}`}
          src="https://claude-mem.ai/"
          className="memory-viewer-iframe"
          title="Claude Memory - Setup"
        />
      </div>
    );
  }

  // Use our custom memory viewer (with proxied API calls to localhost:37777)
  return (
    <div className="memory-viewer-container">
      <iframe
        ref={iframeRef}
        key={`${refreshKey}-${iframeKey}`}
        src="/memory-viewer.html"
        className="memory-viewer-iframe"
        title="Claude Memory"
        onLoad={handleIframeLoad}
      />
    </div>
  );
};

export default MemoryViewer;
