import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTerminalTabs } from '../contexts/TerminalTabsContext';
import { useTerminalInstance, openExternalUrl } from '../hooks/useTerminalInstance';
import { useSettings } from '../contexts/SettingsContext';
import TerminalTabBar from './TerminalTabBar';
import MobileKeybar from './MobileKeybar';
import { getTouchCellPosition, calculateSelectionLength } from '../utils/terminalCoordinates';
import type { AnyPaneId, TerminalTab } from '../types/terminal';

// Custom hook for keyboard visibility detection
function useKeyboardVisibility() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    if (!window.visualViewport) return;

    const handleViewportResize = () => {
      const vv = window.visualViewport!;
      // Keyboard height = window inner height - visual viewport height
      const kbHeight = window.innerHeight - vv.height;
      // Consider keyboard visible if more than 100px difference (to filter out address bar changes)
      const visible = kbHeight > 100;

      setKeyboardHeight(visible ? kbHeight : 0);
      setIsKeyboardVisible(visible);
    };

    // Check initial state
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

interface ContextMenuState {
  x: number;
  y: number;
  hasSelection: boolean;
}

interface CustomCommand {
  name?: string;
  command: string;
}

const CUSTOM_COMMANDS_KEY = 'mobile_terminal_custom_commands';

function loadCustomCommands(): CustomCommand[] {
  try {
    const stored = localStorage.getItem(CUSTOM_COMMANDS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    // Migrate old string[] format to new CustomCommand[] format
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
      return parsed.map((cmd: string) => ({ command: cmd }));
    }
    return parsed;
  } catch {
    return [];
  }
}

interface TerminalPaneProps {
  paneId: AnyPaneId;
  showSplitToggle?: boolean;
  isVisible?: boolean;
  onLink?: (url: string) => void;
  style?: React.CSSProperties;
  // Dashboard row split controls
  showDashboardSplit?: boolean;
  canSplitRow?: boolean;
  canUnsplitRow?: boolean;
  onSplitRow?: () => void;
  onUnsplitRow?: () => void;
}

interface TerminalInstanceWrapperProps {
  tab: TerminalTab;
  isActive: boolean;
  isVisible: boolean;
  isPaneFocused: boolean;  // True if this pane is the last active pane (for keybar visibility in split view)
  onLink?: (url: string) => void;
  onSessionCreated: (sessionId: string) => void;
  onContextMenuRequest?: (menu: ContextMenuState, tabId: string, terminal: any | null, socket: any | null) => void;
  onCloseContextMenu?: () => void;
  onShowAddCommand?: () => void;
  customCommands: CustomCommand[];
}

// Wrapper component for each terminal instance
const TerminalInstanceWrapper: React.FC<TerminalInstanceWrapperProps> = ({
  tab,
  isActive,
  isVisible,
  isPaneFocused,
  onLink,
  onSessionCreated,
  onContextMenuRequest,
  onCloseContextMenu,
  onShowAddCommand,
  customCommands,
}) => {
  const { socket } = useTerminalTabs();
  const { theme, fontFamily, fontSize, showKeybar } = useSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  // Context menu and modal states removed - now managed at TerminalPane level
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // Custom commands are now managed at TerminalPane level and passed as props

  // Debug: Log component mount/unmount
  useEffect(() => {
    console.log('[TerminalInstanceWrapper] Mounted for tab:', tab.id, {
      socket: !!socket,
      socketConnected: socket?.connected,
      socketId: socket?.id,
      isActive,
      isVisible
    });
    return () => {
      console.log('[TerminalInstanceWrapper] Unmounting for tab:', tab.id);
    };
  }, [tab.id, socket, isActive, isVisible]);

  // Keyboard visibility detection
  const { keyboardHeight, isKeyboardVisible } = useKeyboardVisibility();

  // Touch gesture detection refs - differentiate tap from scroll from selection
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isTouchMoveRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selection mode tracking - horizontal swipe = select, vertical = scroll
  const isSelectingRef = useRef(false);
  const selectionStartRef = useRef<{ col: number; row: number } | null>(null);
  const gestureDecidedRef = useRef(false); // Once we decide scroll vs select, stick with it

  const {
    containerRef: terminalContainerRef,
    terminal,
    fit,
    isScrolledUp,
    scrollToBottom,
  } = useTerminalInstance({
    terminalId: tab.id,
    socket,
    sessionId: tab.sessionId,
    onLink,
    onSessionCreated,
    theme: theme.terminal,
    fontFamily,
    fontSize,
    isVisible: isVisible && isActive,
  });

  // Handle input
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!socket) return;
    const value = e.target.value;
    if (value) {
      socket.emit('terminal:input', { terminalId: tab.id, data: value });
      e.target.value = '';
    }
  }, [socket, tab.id]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!socket) return;

    const emit = (data: string) => {
      socket.emit('terminal:input', { terminalId: tab.id, data });
    };

    switch (e.key) {
      case 'Enter':
        emit('\r');
        e.preventDefault();
        break;
      case 'Backspace':
        const selection = terminal?.getSelection();
        if (selection && selection.length > 0) {
          const backspaces = '\x7f'.repeat(selection.length);
          emit(backspaces);
          terminal?.clearSelection();
        } else {
          emit('\x7f');
        }
        e.preventDefault();
        break;
      case 'Tab':
        emit('\t');
        e.preventDefault();
        break;
      case 'Escape':
        emit('\x1b');
        e.preventDefault();
        break;
      case 'ArrowUp':
        emit('\x1b[A');
        e.preventDefault();
        break;
      case 'ArrowDown':
        emit('\x1b[B');
        e.preventDefault();
        break;
      case 'ArrowRight':
        emit('\x1b[C');
        e.preventDefault();
        break;
      case 'ArrowLeft':
        emit('\x1b[D');
        e.preventDefault();
        break;
    }
  }, [socket, tab.id, terminal]);

  const handleSpecialKey = useCallback((key: string) => {
    if (!socket) return;
    socket.emit('terminal:input', { terminalId: tab.id, data: key });
    hiddenInputRef.current?.focus();
  }, [socket, tab.id]);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    onCloseContextMenu?.();

    // Position-based URL detection since xterm doesn't create actual <a> tags
    if (terminal) {
      const termElement = terminal.element;
      if (termElement) {
        const screenElement = termElement.querySelector('.xterm-screen') as HTMLElement;
        const rect = screenElement?.getBoundingClientRect() || termElement.getBoundingClientRect();

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const cellWidth = rect.width / terminal.cols;
        const cellHeight = rect.height / terminal.rows;

        if (cellWidth > 0 && cellHeight > 0) {
          const col = Math.floor(x / cellWidth);
          const row = Math.floor(y / cellHeight);

          const buffer = terminal.buffer.active;
          const lineIndex = buffer.viewportY + row;
          const line = buffer.getLine(lineIndex);

          if (line) {
            const lineText = line.translateToString();

            // Regex for localhost/private network URLs AND external URLs
            const localhostRegex = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d+(?:\/[^\s]*)?/gi;
            const externalUrlRegex = /https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d|10\.\d|172\.(?:1[6-9]|2\d|3[01])\.)[\w\-\.]+(?::\d+)?(?:\/[^\s]*)?/gi;

            // Check for localhost URLs first
            let match;
            while ((match = localhostRegex.exec(lineText)) !== null) {
              if (col >= match.index && col < match.index + match[0].length) {
                e.preventDefault();
                e.stopPropagation();
                let url = match[0];
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                  url = 'http://' + url;
                }
                console.log('[TerminalPane] Localhost link clicked:', url);
                // Use flushSync to force immediate React state update for instant preview
                if (onLink) {
                  flushSync(() => {
                    onLink(url);
                  });
                }
                return;
              }
            }

            // Check for external URLs
            while ((match = externalUrlRegex.exec(lineText)) !== null) {
              if (col >= match.index && col < match.index + match[0].length) {
                e.preventDefault();
                e.stopPropagation();
                const externalUrl = match[0];
                console.log('[TerminalPane] External link clicked:', externalUrl);
                // Open external URL immediately
                openExternalUrl(externalUrl);
                return;
              }
            }
          }
        }
      }
    }

    hiddenInputRef.current?.focus();
  }, [terminal, onLink]);

  // Adjust context menu position to stay within viewport
  const adjustMenuPosition = useCallback((x: number, y: number, menuWidth = 180, menuHeight = 200) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    if (x + menuWidth > viewportWidth) {
      adjustedX = viewportWidth - menuWidth - 8;
    }
    if (y + menuHeight > viewportHeight) {
      adjustedY = viewportHeight - menuHeight - 8;
    }

    adjustedX = Math.max(8, adjustedX);
    adjustedY = Math.max(8, adjustedY);

    return { x: adjustedX, y: adjustedY };
  }, []);

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const selection = terminal?.getSelection();
    const { x, y } = adjustMenuPosition(clientX, clientY, 180, 250 + customCommands.length * 40);

    // Call parent callback instead of local setState
    if (onContextMenuRequest) {
      onContextMenuRequest({ x, y, hasSelection: !!selection && selection.length > 0 }, tab.id, terminal, socket);
    }
  }, [terminal, adjustMenuPosition, customCommands.length, onContextMenuRequest, tab.id, socket]);

  // Touch gesture handlers - horizontal swipe = select, vertical swipe = scroll
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    isTouchMoveRef.current = false;
    isSelectingRef.current = false;
    selectionStartRef.current = null;
    gestureDecidedRef.current = false;

    // Clear any existing long press timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    // Store the initial cell position for potential selection
    if (terminal && terminalContainerRef.current) {
      const cellPos = getTouchCellPosition(touch, terminalContainerRef.current, terminal);
      if (cellPos) {
        selectionStartRef.current = cellPos;
      }
    }
  }, [terminal, terminalContainerRef]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touchStartRef.current) return;

    const dx = Math.abs(touch.clientX - touchStartRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);

    // If already in selection mode, extend selection
    if (isSelectingRef.current && selectionStartRef.current && terminal && terminalContainerRef.current) {
      const currentPos = getTouchCellPosition(touch, terminalContainerRef.current, terminal);

      if (currentPos) {
        const start = selectionStartRef.current;
        const length = calculateSelectionLength(start, currentPos, terminal.cols);

        // Determine selection direction (forward or backward)
        const startIdx = (start.row - 1) * terminal.cols + (start.col - 1);
        const endIdx = (currentPos.row - 1) * terminal.cols + (currentPos.col - 1);

        if (endIdx >= startIdx) {
          // Forward selection
          terminal.select(start.col - 1, start.row - 1, length);
        } else {
          // Backward selection
          terminal.select(currentPos.col - 1, currentPos.row - 1, length);
        }
      }
      isTouchMoveRef.current = true;
      return;
    }

    // Decide gesture type if not yet decided and moved enough
    if (!gestureDecidedRef.current && (dx > 10 || dy > 10)) {
      gestureDecidedRef.current = true;
      isTouchMoveRef.current = true;

      // Horizontal movement = selection mode (dx > dy * 1.2)
      // Vertical movement = scroll (let it pass through)
      if (dx > dy * 1.2 && selectionStartRef.current && terminal) {
        isSelectingRef.current = true;
        // Start with initial character selected
        terminal.select(selectionStartRef.current.col - 1, selectionStartRef.current.row - 1, 1);
      }
    }
  }, [terminal, terminalContainerRef]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Cancel any pending long press
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    // If we were in selection mode, show context menu with selection options
    if (isSelectingRef.current) {
      const selection = terminal?.getSelection();
      if (selection && selection.length > 0) {
        // Show context menu at touch release position
        const touch = e.changedTouches[0];
        const { x, y } = adjustMenuPosition(touch.clientX, touch.clientY, 180, 200);
        if (onContextMenuRequest) {
          onContextMenuRequest({ x, y, hasSelection: true }, tab.id, terminal, socket);
        }
      }
      isSelectingRef.current = false;
      selectionStartRef.current = null;
      gestureDecidedRef.current = false;
      touchStartRef.current = null;
      return;
    }

    // Only focus (show keyboard) if it was a tap, not a scroll/selection gesture
    if (!isTouchMoveRef.current && touchStartRef.current) {
      const touch = e.changedTouches[0];
      const dx = Math.abs(touch.clientX - touchStartRef.current.x);
      const dy = Math.abs(touch.clientY - touchStartRef.current.y);
      const dt = Date.now() - touchStartRef.current.time;

      // Long press (>500ms, minimal movement) - show context menu
      if (dx < 15 && dy < 15 && dt > 500) {
        e.preventDefault();
        const selection = terminal?.getSelection();
        const { x, y } = adjustMenuPosition(touch.clientX, touch.clientY, 180, 200);
        if (onContextMenuRequest) {
          onContextMenuRequest({ x, y, hasSelection: !!selection && selection.length > 0 }, tab.id, terminal, socket);
        }
        gestureDecidedRef.current = false;
        touchStartRef.current = null;
        return;
      }

      // If minimal movement (<10px) and quick tap (<300ms), focus the input and scroll to bottom
      if (dx < 10 && dy < 10 && dt < 300) {
        hiddenInputRef.current?.focus();
        // Scroll to bottom when tapping to type - ensures typing area is visible above keyboard
        scrollToBottom?.();
        // Scroll this pane into view so it's visible above the keyboard in split view
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    // Reset gesture state
    gestureDecidedRef.current = false;
    touchStartRef.current = null;
  }, [terminal, scrollToBottom, adjustMenuPosition]);

  // Paste modal submit handler (paste modal still in this component)
  const handlePasteSubmit = useCallback(() => {
    if (pasteText && socket) {
      socket.emit('terminal:input', { terminalId: tab.id, data: pasteText });
    }
    setPasteText('');
    setShowPasteModal(false);
    hiddenInputRef.current?.focus();
  }, [socket, tab.id, pasteText]);

  // Context menu handlers and effects moved to TerminalPane level

  // Focus when becoming active
  useEffect(() => {
    if (isActive && isVisible) {
      requestAnimationFrame(() => {
        fit();
        hiddenInputRef.current?.focus();
      });
    }
  }, [isActive, isVisible, fit]);

  // Refit on container resize with adaptive debounce
  // Longer delay for significant size changes (like entering preview mode) to prevent render glitches
  useEffect(() => {
    if (!containerRef.current) return;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastWidth = containerRef.current.offsetWidth;
    let lastHeight = containerRef.current.offsetHeight;

    const resizeObserver = new ResizeObserver((entries) => {
      if (resizeTimeout) clearTimeout(resizeTimeout);

      const entry = entries[0];
      if (!entry) return;

      const newWidth = entry.contentRect.width;
      const newHeight = entry.contentRect.height;

      // Calculate how much the size changed
      const widthChange = Math.abs(newWidth - lastWidth) / (lastWidth || 1);
      const heightChange = Math.abs(newHeight - lastHeight) / (lastHeight || 1);

      // Use longer delay for significant size changes (>20% change = layout transition)
      const isSignificantChange = widthChange > 0.2 || heightChange > 0.2;
      const delay = isSignificantChange ? 300 : 100;

      resizeTimeout = setTimeout(() => {
        fit();
        lastWidth = newWidth;
        lastHeight = newHeight;
        resizeTimeout = null;
      }, delay);
    });

    resizeObserver.observe(containerRef.current);
    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
    };
  }, [fit]);

  // Add/remove keyboard-visible class on document body for global styling
  useEffect(() => {
    if (isActive && isKeyboardVisible) {
      document.body.classList.add('keyboard-visible');
      document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
    } else if (isActive) {
      document.body.classList.remove('keyboard-visible');
      document.documentElement.style.setProperty('--keyboard-height', '0px');
    }
    return () => {
      document.body.classList.remove('keyboard-visible');
    };
  }, [isActive, isKeyboardVisible, keyboardHeight]);

  // Calculate bottom padding for keyboard - account for keybar if shown
  const keyboardBottomPadding = isKeyboardVisible
    ? (showKeybar ? keyboardHeight + 48 : keyboardHeight) // 48px for keybar height
    : 0;

  return (
    <div
      ref={containerRef}
      className={`terminal-instance ${isActive ? 'active' : ''} ${isKeyboardVisible ? 'keyboard-active' : ''}`}
      style={{
        display: isActive ? 'flex' : 'none',
        paddingBottom: keyboardBottomPadding,
        transition: 'padding-bottom 0.1s ease-out',
      }}
    >
      <input
        ref={hiddenInputRef}
        type="text"
        className="hidden-input"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
      />
      <div
        ref={terminalContainerRef}
        className="terminal-container"
        onClick={handleContainerClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
      {/* Scroll to bottom button - shown when user scrolls up */}
      {isScrolledUp && (
        <button
          className="scroll-to-bottom-btn"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 12L3 7h10L8 12z"/>
          </svg>
        </button>
      )}
      {/* MobileKeybar: Position fixed above keyboard when visible, or inline when not */}
      {/* Show keybar on all active terminals, not just focused pane */}
      {isActive && showKeybar && (
        <div
          className={`mobile-keybar-wrapper ${isKeyboardVisible ? 'keyboard-visible' : ''}`}
          style={isKeyboardVisible ? {
            position: 'fixed',
            bottom: keyboardHeight,
            left: 0,
            right: 0,
            zIndex: 1000,
          } : undefined}
        >
          <MobileKeybar onKey={handleSpecialKey} />
        </div>
      )}

      {/* Paste modal (fallback when clipboard API fails) */}
      {showPasteModal && (
        <div className="modal-overlay" onClick={() => { setShowPasteModal(false); setPasteText(''); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Paste Text</div>
            <textarea
              className="modal-input"
              placeholder="Paste your text here (Ctrl+V / Cmd+V)"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              autoFocus
              rows={4}
              style={{ resize: 'vertical', minHeight: '80px' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && pasteText.trim()) {
                  e.preventDefault();
                  handlePasteSubmit();
                }
              }}
            />
            <div className="modal-actions">
              <button
                className="modal-btn modal-btn-cancel"
                onClick={() => { setShowPasteModal(false); setPasteText(''); }}
              >
                Cancel
              </button>
              <button
                className="modal-btn modal-btn-add"
                onClick={handlePasteSubmit}
                disabled={!pasteText}
              >
                Paste
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const TerminalPane: React.FC<TerminalPaneProps> = ({
  paneId,
  showSplitToggle = false,
  isVisible = true,
  onLink,
  style,
  showDashboardSplit = false,
  canSplitRow = false,
  canUnsplitRow = false,
  onSplitRow,
  onUnsplitRow,
}) => {
  const { setSessionId, setLastActivePane, getPaneState, lastActivePaneId, socket, createTab } = useTerminalTabs();

  // Context menu and modal state - lifted from TerminalInstanceWrapper
  const [contextMenuState, setContextMenuState] = useState<{
    menu: ContextMenuState;
    tabId: string;
    terminal: any | null; // Terminal type from xterm
    socket: any | null;
  } | null>(null);
  const [showAddCommand, setShowAddCommand] = useState(false);
  const [newCommand, setNewCommand] = useState('');
  const [newCommandName, setNewCommandName] = useState('');
  const [customCommands, setCustomCommands] = useState<CustomCommand[]>(loadCustomCommands);

  // Write to terminal function for upload feature
  const writeTerminal = useCallback((terminalId: string, data: string) => {
    if (!socket) return;
    socket.emit('terminal:input', { terminalId, data });
  }, [socket]);
  const pane = getPaneState(paneId);
  const tabs = pane?.tabs ?? [];
  const activeTabId = pane?.activeTabId ?? null;

  // Track when this pane becomes active
  const handlePaneInteraction = useCallback(() => {
    setLastActivePane(paneId);
  }, [setLastActivePane, paneId]);

  // Context menu request handler - called from child components
  const handleContextMenuRequest = useCallback((
    menu: ContextMenuState,
    tabId: string,
    terminal: any | null,
    socket: any | null
  ) => {
    setContextMenuState({ menu, tabId, terminal, socket });
  }, []);

  // Show add command modal - called from child components
  const handleShowAddCommand = useCallback(() => {
    setShowAddCommand(true);
  }, []);

  // Close context menu - called from child components
  const handleCloseContextMenu = useCallback(() => {
    setContextMenuState(null);
  }, []);

  // Context menu action handlers - use contextMenuState for terminal/socket access
  const handleCopy = useCallback(async () => {
    const selection = contextMenuState?.terminal?.getSelection();
    if (selection) {
      await navigator.clipboard.writeText(selection);
    }
    handleCloseContextMenu();
  }, [contextMenuState, handleCloseContextMenu]);

  const handlePaste = useCallback(async () => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && contextMenuState?.socket) {
          contextMenuState.socket.emit('terminal:input', {
            terminalId: contextMenuState.tabId,
            data: text
          });
        }
      }
    } catch (err) {
      console.log('Clipboard paste failed:', err);
    }

    handleCloseContextMenu();
  }, [contextMenuState, handleCloseContextMenu]);

  const handleDelete = useCallback(() => {
    const selection = contextMenuState?.terminal?.getSelection();
    if (selection && selection.length > 0 && contextMenuState?.socket) {
      const backspaces = '\x7f'.repeat(selection.length);
      contextMenuState.socket.emit('terminal:input', {
        terminalId: contextMenuState.tabId,
        data: backspaces
      });
      contextMenuState.terminal?.clearSelection();
    }
    handleCloseContextMenu();
  }, [contextMenuState, handleCloseContextMenu]);

  const handleRunCommand = useCallback((cmd: CustomCommand) => {
    if (contextMenuState?.socket) {
      contextMenuState.socket.emit('terminal:input', {
        terminalId: contextMenuState.tabId,
        data: cmd.command
      });
    }
    handleCloseContextMenu();
  }, [contextMenuState, handleCloseContextMenu]);

  const handleAddCommand = useCallback(() => {
    if (newCommand.trim()) {
      const newCmd: CustomCommand = {
        command: newCommand.trim(),
        ...(newCommandName.trim() && { name: newCommandName.trim() })
      };
      const updated = [...customCommands, newCmd];
      setCustomCommands(updated);
      localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(updated));
      // Sync to server for desktop/mobile sync
      socket?.emit('commands:update', updated);
      setNewCommand('');
      setNewCommandName('');
    }
    setShowAddCommand(false);
    handleCloseContextMenu();
  }, [newCommand, newCommandName, customCommands, socket, handleCloseContextMenu]);

  const handleRemoveCommand = useCallback((index: number) => {
    const updated = customCommands.filter((_, i) => i !== index);
    setCustomCommands(updated);
    localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(updated));
    // Sync to server for desktop/mobile sync
    socket?.emit('commands:update', updated);
  }, [customCommands, socket]);

  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenuState) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // CRITICAL: Don't close if clicking inside the context menu itself!
      if (target.closest('.context-menu')) {
        return;  // Let the menu item onClick handlers fire first
      }

      // Don't interfere with link clicks or xterm interactions
      if (target.closest('.xterm-link') || target.closest('a') || target.closest('.xterm-rows')) {
        handleCloseContextMenu();
        return;
      }
      handleCloseContextMenu();
    };
    document.addEventListener('click', handleClickOutside, true);
    return () => document.removeEventListener('click', handleClickOutside, true);
  }, [contextMenuState, handleCloseContextMenu]);

  // Create stable callback refs per tab to prevent re-renders causing terminal recreation
  const sessionCallbacksRef = useRef<Record<string, (sessionId: string) => void>>({});

  // Update callbacks when tabs change - callbacks are stable references stored in ref
  useMemo(() => {
    const currentTabIds = new Set(tabs.map(t => t.id));

    // Add callbacks for new tabs
    tabs.forEach(tab => {
      if (!sessionCallbacksRef.current[tab.id]) {
        sessionCallbacksRef.current[tab.id] = (sessionId: string) => {
          setSessionId(tab.id, sessionId);
        };
      }
    });

    // Clean up removed tabs
    Object.keys(sessionCallbacksRef.current).forEach(id => {
      if (!currentTabIds.has(id)) {
        delete sessionCallbacksRef.current[id];
      }
    });
  }, [tabs, setSessionId]);

  // Handle empty tab state with a helpful UI instead of disappearing
  if (tabs.length === 0) {
    return (
      <div className="terminal-pane terminal-pane-empty" style={style} onClick={handlePaneInteraction} onTouchStart={handlePaneInteraction}>
        <div className="terminal-pane-empty-content">
          <div className="terminal-pane-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M7 8l3 3-3 3" />
              <line x1="12" y1="14" x2="17" y2="14" />
            </svg>
          </div>
          <p className="terminal-pane-empty-text">No terminal in this pane</p>
          <button
            className="terminal-pane-new-btn"
            onClick={(e) => {
              e.stopPropagation();
              createTab(paneId);
            }}
          >
            + New Terminal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-pane" style={style} onClick={handlePaneInteraction} onTouchStart={handlePaneInteraction}>
      <TerminalTabBar
        paneId={paneId}
        showSplitToggle={showSplitToggle}
        showDashboardSplit={showDashboardSplit}
        canSplitRow={canSplitRow}
        canUnsplitRow={canUnsplitRow}
        onSplitRow={onSplitRow}
        onUnsplitRow={onUnsplitRow}
        writeTerminal={writeTerminal}
      />
      <div className="terminal-pane-content">
        {tabs.map((tab) => (
          <TerminalInstanceWrapper
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            isVisible={isVisible}
            isPaneFocused={paneId === lastActivePaneId}
            onLink={onLink}
            onSessionCreated={sessionCallbacksRef.current[tab.id]}
            onContextMenuRequest={handleContextMenuRequest}
            onCloseContextMenu={handleCloseContextMenu}
            onShowAddCommand={handleShowAddCommand}
            customCommands={customCommands}
          />
        ))}

        {/* Context menu - rendered at pane level to avoid display:none hiding */}
        {contextMenuState && (
          <div
            className="context-menu terminal-context-menu"
            style={{ top: contextMenuState.menu.y, left: contextMenuState.menu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="context-menu-item" onClick={handleCopy}>
              Copy
            </div>
            <div className="context-menu-item" onClick={handlePaste}>
              Paste
            </div>
            {contextMenuState.menu.hasSelection && (
              <div className="context-menu-item" onClick={handleDelete}>
                Delete
              </div>
            )}
            {customCommands.length > 0 && <div className="context-menu-divider" />}
            {customCommands.map((cmd, index) => (
              <div key={index} className="context-menu-item command-item">
                <span
                  onClick={() => handleRunCommand(cmd)}
                  title={cmd.name ? cmd.command : undefined}
                >
                  {cmd.name || cmd.command}
                </span>
                <button
                  className="remove-command-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveCommand(index);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="context-menu-divider" />
            <div
              className="context-menu-item add-command"
              onClick={() => {
                handleCloseContextMenu();
                setShowAddCommand(true);
              }}
            >
              + Add Command
            </div>
          </div>
        )}

        {/* Add command modal - rendered at pane level to avoid display:none hiding */}
        {showAddCommand && (
          <div className="modal-overlay" onClick={() => { setShowAddCommand(false); setNewCommand(''); setNewCommandName(''); }}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">Add Custom Command</div>
              <input
                type="text"
                className="modal-input"
                placeholder="Command (required)"
                value={newCommand}
                onChange={(e) => setNewCommand(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && newCommand.trim() && handleAddCommand()}
              />
              <input
                type="text"
                className="modal-input"
                placeholder="Display name (optional)"
                value={newCommandName}
                onChange={(e) => setNewCommandName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newCommand.trim() && handleAddCommand()}
              />
              <div className="modal-actions">
                <button
                  className="modal-btn modal-btn-cancel"
                  onClick={() => { setShowAddCommand(false); setNewCommand(''); setNewCommandName(''); }}
                >
                  Cancel
                </button>
                <button
                  className="modal-btn modal-btn-add"
                  onClick={handleAddCommand}
                  disabled={!newCommand.trim()}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TerminalPane;
