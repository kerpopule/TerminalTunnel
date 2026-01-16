import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { useSettings } from '../contexts/SettingsContext';
import { useDashboard } from '../contexts/DashboardContext';
import { mapThemeToMemoryViewer } from '../utils/memoryViewerTheme';

interface MemoryViewerProps {
  refreshKey: number;
}

interface SearchMatch {
  node: Text;
  index: number;
  originalText: string;
}

const CLAUDE_MEM_LOCAL = 'http://localhost:37777';
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 1000;
const INITIAL_DELAY_MS = 2000; // Wait for backend server to be ready
const GEMINI_CONSOLE_URL = 'https://aistudio.google.com/apikey';
const CLAUDE_MEM_URL = 'https://github.com/thedotmack/claude-mem';

type Provider = 'claude' | 'gemini';
type InstallStep = 'initial' | 'installing' | 'provider-select' | 'gemini-setup' | 'saving' | 'done';

// Hook to detect keyboard visibility on mobile
function useKeyboardVisibility() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    if (!window.visualViewport) return;

    const handleViewportResize = () => {
      const vv = window.visualViewport!;
      const kbHeight = window.innerHeight - vv.height;
      const visible = kbHeight > 100;

      setKeyboardHeight(visible ? kbHeight : 0);
      setIsKeyboardVisible(visible);
    };

    handleViewportResize();

    window.visualViewport.addEventListener('resize', handleViewportResize);
    window.visualViewport.addEventListener('scroll', handleViewportResize);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
      window.visualViewport?.removeEventListener('scroll', handleViewportResize);
    };
  }, []);

  return { keyboardHeight, isKeyboardVisible };
}

const MemoryViewer: React.FC<MemoryViewerProps> = ({ refreshKey }) => {
  const [isLocalAvailable, setIsLocalAvailable] = useState<boolean | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [iframeKey, setIframeKey] = useState(0); // Force iframe refresh
  const [iframeReady, setIframeReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const mountedRef = useRef(true);
  const hasInitializedRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevFieldRef = useRef<HTMLInputElement>(null);
  const nextFieldRef = useRef<HTMLInputElement>(null);
  const highlightStyleRef = useRef<HTMLStyleElement | null>(null);
  const { keyboardHeight, isKeyboardVisible } = useKeyboardVisibility();
  const { theme } = useSettings();
  const { enabled: dashboardEnabled } = useDashboard();

  // Installation states
  const [installStep, setInstallStep] = useState<InstallStep>('initial');
  const [installError, setInstallError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [claudeMemStars, setClaudeMemStars] = useState<number | null>(null);

  // Fetch GitHub stars on mount
  useEffect(() => {
    const fetchStars = async () => {
      try {
        const res = await fetch('https://api.github.com/repos/thedotmack/claude-mem');
        if (res.ok) {
          const data = await res.json();
          setClaudeMemStars(data.stargazers_count);
        }
      } catch {
        // Ignore errors
      }
    };
    fetchStars();
  }, []);

  // Format star count (e.g., 13200 -> "13.2k")
  const formatStarCount = useCallback((count: number): string => {
    if (count >= 1000) {
      return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return count.toString();
  }, []);

  // Handler to install claude-mem via API
  const handleInstallClaudeMem = useCallback(async () => {
    setInstallStep('installing');
    setInstallError(null);

    try {
      const response = await fetch('/api/claude-mem/install', { method: 'POST' });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Installation failed');
      }
      // Installation successful, move to provider selection
      setInstallStep('provider-select');
    } catch (error: any) {
      console.error('Failed to install claude-mem:', error);
      setInstallError(error.message || 'Installation failed');
      setInstallStep('initial');
    }
  }, []);

  // Handler to save provider settings (default to Claude)
  const saveProviderSettings = useCallback(async (provider: Provider, geminiKey?: string) => {
    setInstallStep('saving');
    setInstallError(null);

    try {
      const settings: Record<string, string> = {
        CLAUDE_MEM_PROVIDER: provider,
      };

      if (provider === 'gemini' && geminiKey) {
        settings.CLAUDE_MEM_GEMINI_API_KEY = geminiKey;
      }

      // Store settings locally first
      localStorage.setItem('claude_mem_provider', provider);
      if (geminiKey) {
        localStorage.setItem('claude_mem_gemini_key', geminiKey);
      }

      // Try to save to claude-mem API
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
        console.log('claude-mem not running yet, settings saved locally for later');
      }

      setInstallStep('done');
      // Reset after a moment and recheck availability
      setTimeout(() => {
        setInstallStep('initial');
        hasInitializedRef.current = false;
        setIsLocalAvailable(null);
      }, 1500);
    } catch (err: any) {
      console.error('Failed to save provider settings:', err);
      setInstallError(err.message || 'Failed to save settings');
      setInstallStep('provider-select');
    }
  }, []);

  const handleSelectClaude = useCallback(() => {
    setSelectedProvider('claude');
    saveProviderSettings('claude');
  }, [saveProviderSettings]);

  const handleSelectGemini = useCallback(() => {
    setSelectedProvider('gemini');
    setInstallStep('gemini-setup');
  }, []);

  const handleGeminiSave = useCallback(() => {
    if (!geminiApiKey.trim()) {
      setInstallError('Please enter an API key');
      return;
    }
    saveProviderSettings('gemini', geminiApiKey.trim());
  }, [geminiApiKey, saveProviderSettings]);

  const handleBackFromGemini = useCallback(() => {
    setSelectedProvider(null);
    setGeminiApiKey('');
    setInstallError(null);
    setInstallStep('provider-select');
  }, []);

  const openGeminiConsole = useCallback(async () => {
    try {
      await open(GEMINI_CONSOLE_URL);
    } catch (err) {
      console.error('Failed to open URL:', err);
      window.open(GEMINI_CONSOLE_URL, '_blank');
    }
  }, []);

  const openClaudeMemGithub = useCallback(async () => {
    try {
      await open(CLAUDE_MEM_URL);
    } catch (err) {
      console.error('Failed to open URL:', err);
      window.open(CLAUDE_MEM_URL, '_blank');
    }
  }, []);

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

  // Clear all search highlights from iframe
  const clearHighlights = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument) return;

    const doc = iframe.contentDocument;

    // Remove highlight spans and restore original text
    const highlights = doc.querySelectorAll('.memory-search-highlight');
    highlights.forEach((span) => {
      const parent = span.parentNode;
      if (parent) {
        const textNode = doc.createTextNode(span.textContent || '');
        parent.replaceChild(textNode, span);
        parent.normalize(); // Merge adjacent text nodes
      }
    });

    setMatches([]);
    setCurrentMatchIndex(0);
  }, []);

  // Perform search in iframe content
  const performSearch = useCallback((query: string) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument || !query.trim()) {
      clearHighlights();
      return;
    }

    const doc = iframe.contentDocument;
    const searchText = query.toLowerCase();

    // First clear existing highlights
    clearHighlights();

    // Inject highlight styles if not already present
    if (!highlightStyleRef.current) {
      const style = doc.createElement('style');
      style.textContent = `
        .memory-search-highlight {
          background-color: rgba(255, 235, 59, 0.4) !important;
          color: inherit !important;
          border-radius: 2px;
        }
        .memory-search-highlight.current {
          background-color: rgba(255, 152, 0, 0.6) !important;
        }
      `;
      doc.head.appendChild(style);
      highlightStyleRef.current = style;
    }

    // Find all text nodes in the document
    const walker = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip script, style, and other non-visible elements
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tagName = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'iframe'].includes(tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          // Skip already highlighted nodes
          if (parent.classList.contains('memory-search-highlight')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    // Find and highlight matches
    const newMatches: SearchMatch[] = [];

    textNodes.forEach((textNode) => {
      const text = textNode.textContent || '';
      const lowerText = text.toLowerCase();
      let lastIndex = 0;
      let matchIndex = lowerText.indexOf(searchText, lastIndex);

      if (matchIndex === -1) return;

      const fragments: (string | HTMLSpanElement)[] = [];

      while (matchIndex !== -1) {
        // Add text before match
        if (matchIndex > lastIndex) {
          fragments.push(text.substring(lastIndex, matchIndex));
        }

        // Create highlight span
        const span = doc.createElement('span');
        span.className = 'memory-search-highlight';
        span.textContent = text.substring(matchIndex, matchIndex + searchText.length);
        fragments.push(span);

        newMatches.push({
          node: textNode,
          index: newMatches.length,
          originalText: text
        });

        lastIndex = matchIndex + searchText.length;
        matchIndex = lowerText.indexOf(searchText, lastIndex);
      }

      // Add remaining text
      if (lastIndex < text.length) {
        fragments.push(text.substring(lastIndex));
      }

      // Replace text node with fragments
      if (fragments.length > 0) {
        const parent = textNode.parentNode;
        if (parent) {
          fragments.forEach((fragment) => {
            if (typeof fragment === 'string') {
              parent.insertBefore(doc.createTextNode(fragment), textNode);
            } else {
              parent.insertBefore(fragment, textNode);
            }
          });
          parent.removeChild(textNode);
        }
      }
    });

    setMatches(newMatches);
    setCurrentMatchIndex(0);

    // Highlight and scroll to first match
    if (newMatches.length > 0) {
      const highlights = doc.querySelectorAll('.memory-search-highlight');
      if (highlights[0]) {
        highlights[0].classList.add('current');
        highlights[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [clearHighlights]);

  // Navigate to specific match
  const navigateToMatch = useCallback((index: number) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument || matches.length === 0) return;

    const doc = iframe.contentDocument;
    const highlights = doc.querySelectorAll('.memory-search-highlight');

    // Remove current class from all
    highlights.forEach((el) => el.classList.remove('current'));

    // Add current class to target and scroll
    if (highlights[index]) {
      highlights[index].classList.add('current');
      highlights[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [matches.length]);

  // Handle search input change (live search)
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    performSearch(query);
  }, [performSearch]);

  // Navigate to previous match
  const handlePrevMatch = useCallback(() => {
    if (matches.length === 0) return;
    const newIndex = currentMatchIndex === 0 ? matches.length - 1 : currentMatchIndex - 1;
    setCurrentMatchIndex(newIndex);
    navigateToMatch(newIndex);
  }, [matches.length, currentMatchIndex, navigateToMatch]);

  // Navigate to next match
  const handleNextMatch = useCallback(() => {
    if (matches.length === 0) return;
    const newIndex = currentMatchIndex === matches.length - 1 ? 0 : currentMatchIndex + 1;
    setCurrentMatchIndex(newIndex);
    navigateToMatch(newIndex);
  }, [matches.length, currentMatchIndex, navigateToMatch]);

  // Close search and clear highlights
  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    clearHighlights();
    // Ensure tab bar is shown when closing search
    document.body.classList.remove('keyboard-visible');
  }, [clearHighlights]);

  // Open search and focus input
  const handleOpenSearch = useCallback(() => {
    setSearchOpen(true);
    // Focus input after render
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  }, []);

  // Handle keyboard shortcuts in search input
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCloseSearch();
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      // Enter or Down arrow goes to next match
      e.preventDefault();
      handleNextMatch();
    } else if (e.key === 'ArrowUp') {
      // Up arrow goes to previous match
      e.preventDefault();
      handlePrevMatch();
    }
  }, [handleCloseSearch, handlePrevMatch, handleNextMatch]);

  // iOS keyboard navigation: when "up" arrow is tapped, iOS focuses the previous field
  const handlePrevFieldFocus = useCallback(() => {
    handlePrevMatch();
    // Refocus the main search input
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [handlePrevMatch]);

  // iOS keyboard navigation: when "down" arrow is tapped, iOS focuses the next field
  const handleNextFieldFocus = useCallback(() => {
    handleNextMatch();
    // Refocus the main search input
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [handleNextMatch]);

  // Hide tab bar when search input is focused (more reliable than keyboard detection)
  const handleSearchFocus = useCallback(() => {
    document.body.classList.add('keyboard-visible');
  }, []);

  const handleSearchBlur = useCallback(() => {
    // Small delay to allow for iOS keyboard navigation between fields
    setTimeout(() => {
      // Only remove if no input in the search overlay is focused
      const activeElement = document.activeElement;
      const isSearchFieldFocused = activeElement?.closest('.memory-search-overlay');
      if (!isSearchFieldFocused) {
        document.body.classList.remove('keyboard-visible');
      }
    }, 100);
  }, []);

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
        // Only force iframe refresh if this is a new connection (not already available)
        if (!hasInitializedRef.current) {
          setIframeReady(false);
          setIframeKey(k => k + 1);
        }
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

    // Skip full reset if already initialized and service is available
    // This prevents reload loops when switching tabs
    if (hasInitializedRef.current && isLocalAvailable !== null) {
      return;
    }

    // Reset state and start checking after initial delay
    // This gives the backend server time to start up
    setIsLocalAvailable(null);
    setRetryCount(0);
    setIframeReady(false);
    currentRetry = 0;

    const initialTimeout = setTimeout(() => {
      if (mountedRef.current) {
        attemptConnection().then(() => {
          hasInitializedRef.current = true;
        });
      }
    }, INITIAL_DELAY_MS);

    // Re-check periodically in case claude-mem is started later
    // Only on localhost - tunnel access doesn't benefit from this and it causes
    // SSE reconnection issues that appear as page reloads
    const isLocalhost = window.location.hostname === 'localhost' ||
                        window.location.hostname === '127.0.0.1';

    let interval: ReturnType<typeof setInterval> | null = null;
    if (isLocalhost && !hasInitializedRef.current) {
      interval = setInterval(() => {
        if (mountedRef.current && !hasInitializedRef.current) {
          currentRetry = 0;
          attemptConnection();
        }
      }, 30000);
    }

    return () => {
      clearTimeout(initialTimeout);
      if (retryTimeout) clearTimeout(retryTimeout);
      if (interval) clearInterval(interval);
    };
  }, [refreshKey, isLocalAvailable]);

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

  // Fallback installation flow when local service is unavailable
  if (!isLocalAvailable) {
    // Installing state
    if (installStep === 'installing') {
      return (
        <div className="memory-viewer-container memory-install-screen">
          <div className="install-content">
            <div className="install-spinner">
              <div className="loading-spinner" />
            </div>
            <h2>Installing claude-mem...</h2>
            <p className="install-subtitle">This may take a moment</p>
          </div>
        </div>
      );
    }

    // Provider selection after installation
    if (installStep === 'provider-select') {
      return (
        <div className="memory-viewer-container memory-install-screen">
          <div className="install-content provider-select">
            <h2>Configure Memory Processing</h2>
            <p className="install-subtitle">
              Choose how claude-mem processes and summarizes your coding sessions.
            </p>

            <div className="provider-options">
              <div className="provider-card recommended" onClick={handleSelectClaude}>
                <div className="provider-header">
                  <span className="provider-name">Claude</span>
                  <span className="recommended-badge">Recommended</span>
                </div>
                <p className="provider-description">
                  Uses your Claude Code Max plan for memory processing. No API key required.
                </p>
                <button className="install-button primary" onClick={handleSelectClaude}>
                  Select Claude
                </button>
              </div>

              <div className="provider-card" onClick={handleSelectGemini}>
                <div className="provider-header">
                  <span className="provider-name">Gemini</span>
                  <span className="free-badge">Free</span>
                </div>
                <p className="provider-description">
                  Uses Google's free Gemini API. Requires a free API key from Google AI Studio.
                </p>
                <button className="install-button secondary" onClick={handleSelectGemini}>
                  Set Up Gemini
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Gemini API key setup
    if (installStep === 'gemini-setup') {
      return (
        <div className="memory-viewer-container memory-install-screen">
          <div className="install-content gemini-setup">
            <h2>Set Up Gemini API</h2>
            <p className="install-subtitle">
              Get a free API key from Google AI Studio to enable memory processing.
            </p>

            <div className="setup-instructions">
              <h3>Get your free Gemini API key:</h3>
              <ol className="instruction-steps">
                <li><span className="step-number">1</span><span>Click the button below to open Google AI Studio</span></li>
                <li><span className="step-number">2</span><span>Sign in with your Google account</span></li>
                <li><span className="step-number">3</span><span>Click "Create API Key" and copy it</span></li>
                <li><span className="step-number">4</span><span>Paste the key below and save</span></li>
              </ol>

              <button className="install-button secondary" onClick={openGeminiConsole}>
                Open Google AI Studio
              </button>
            </div>

            <div className="api-key-input-section">
              <label htmlFor="gemini-api-key">Gemini API Key</label>
              <input
                id="gemini-api-key"
                type="password"
                className="api-key-input"
                placeholder="AIza..."
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
              />

              {installError && (
                <div className="input-error">
                  <span className="error-icon">!</span>
                  <span>{installError}</span>
                </div>
              )}
            </div>

            <div className="button-row">
              <button className="install-button ghost" onClick={handleBackFromGemini}>
                Back
              </button>
              <button
                className="install-button primary"
                onClick={handleGeminiSave}
                disabled={!geminiApiKey.trim()}
              >
                Save & Continue
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Saving state
    if (installStep === 'saving' || installStep === 'done') {
      return (
        <div className="memory-viewer-container memory-install-screen">
          <div className="install-content">
            {installStep === 'saving' ? (
              <>
                <div className="install-spinner">
                  <div className="loading-spinner" />
                </div>
                <h2>Saving settings...</h2>
              </>
            ) : (
              <>
                <div className="success-icon-large">✓</div>
                <h2>Settings saved!</h2>
                <p className="install-subtitle">Starting claude-mem...</p>
              </>
            )}
          </div>
        </div>
      );
    }

    // Initial state - show install prompt
    return (
      <div className="memory-viewer-container memory-install-screen">
        <div className="install-content">
          <div className="install-icon">
            <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="10" strokeWidth="2" />
              <path d="M12 6v6l4 2" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>

          <h2>Claude Memory</h2>
          <p className="install-subtitle">
            Lightweight memory & context injection for Claude Code.
            <br />
            SQLite-based with automatic capture.
          </p>

          <button
            className="github-badge memory-github"
            onClick={openClaudeMemGithub}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
              <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/>
            </svg>
            <span>{claudeMemStars !== null ? formatStarCount(claudeMemStars) : '...'}</span>
          </button>

          <button
            className="install-button primary large"
            onClick={handleInstallClaudeMem}
          >
            Install claude-mem
          </button>

          {installError && (
            <div className="input-error">
              <span className="error-icon">!</span>
              <span>{installError}</span>
            </div>
          )}
        </div>
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

      {/* Search Button - floating in bottom right */}
      {iframeReady && !searchOpen && (
        <button
          className="memory-search-btn"
          onClick={handleOpenSearch}
          aria-label="Search memory"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </button>
      )}

      {/* Search Overlay - positioned above keyboard when visible */}
      {searchOpen && (
        <div
          className={`memory-search-overlay ${isKeyboardVisible ? 'keyboard-visible' : ''}`}
          style={isKeyboardVisible ? {
            position: 'fixed',
            bottom: keyboardHeight + 8,
            left: 16,
            right: 16,
          } : undefined}
        >
          {/* Hidden input for iOS keyboard "up" arrow navigation */}
          <input
            ref={prevFieldRef}
            type="text"
            className="ios-nav-field"
            onFocus={handlePrevFieldFocus}
            onBlur={handleSearchBlur}
            aria-hidden="true"
            readOnly
          />
          <input
            ref={searchInputRef}
            type="text"
            className="memory-search-input"
            placeholder="Search..."
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            autoFocus
          />
          {/* Hidden input for iOS keyboard "down" arrow navigation */}
          <input
            ref={nextFieldRef}
            type="text"
            className="ios-nav-field"
            onFocus={handleNextFieldFocus}
            onBlur={handleSearchBlur}
            aria-hidden="true"
            readOnly
          />
          <div className="memory-search-nav">
            <button
              className="memory-search-nav-btn"
              onClick={handlePrevMatch}
              disabled={matches.length === 0}
              aria-label="Previous match"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18,15 12,9 6,15" />
              </svg>
            </button>
            <button
              className="memory-search-nav-btn"
              onClick={handleNextMatch}
              disabled={matches.length === 0}
              aria-label="Next match"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6,9 12,15 18,9" />
              </svg>
            </button>
          </div>
          <span className="memory-search-count">
            {matches.length > 0 ? `${currentMatchIndex + 1}/${matches.length}` : '0/0'}
          </span>
          <button
            className="memory-search-close"
            onClick={handleCloseSearch}
            aria-label="Close search"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default MemoryViewer;
