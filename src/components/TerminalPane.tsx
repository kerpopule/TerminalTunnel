import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useTerminalTabs } from '../contexts/TerminalTabsContext';
import { useTerminalInstance } from '../hooks/useTerminalInstance';
import { useSettings } from '../contexts/SettingsContext';
import TerminalTabBar from './TerminalTabBar';
import MobileKeybar from './MobileKeybar';
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
  onLink?: (url: string) => void;
  onSessionCreated: (sessionId: string) => void;
}

// Wrapper component for each terminal instance
const TerminalInstanceWrapper: React.FC<TerminalInstanceWrapperProps> = ({
  tab,
  isActive,
  isVisible,
  onLink,
  onSessionCreated,
}) => {
  const { socket } = useTerminalTabs();
  const { theme, fontFamily, fontSize, showKeybar } = useSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [customCommands, setCustomCommands] = useState<CustomCommand[]>(loadCustomCommands);
  const [showAddCommand, setShowAddCommand] = useState(false);
  const [newCommand, setNewCommand] = useState('');
  const [newCommandName, setNewCommandName] = useState('');
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // Keyboard visibility detection
  const { keyboardHeight, isKeyboardVisible } = useKeyboardVisibility();

  // Touch gesture detection refs - differentiate tap from scroll
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isTouchMoveRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    containerRef: terminalContainerRef,
    terminal,
    fit,
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
    setContextMenu(null);

    // Check if click was on a link - handle localhost links specially
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (anchor) {
      e.preventDefault();
      e.stopPropagation();
      const url = anchor.href || anchor.textContent || '';
      // Check if it's a localhost URL that should go to preview
      if (url.includes('localhost') || url.includes('127.0.0.1') ||
          url.includes('0.0.0.0') || url.match(/:\d{4,5}/)) {
        if (onLink) {
          onLink(url);
          return;
        }
      }
    }

    hiddenInputRef.current?.focus();
  }, [onLink]);

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
    setContextMenu({ x, y, hasSelection: !!selection && selection.length > 0 });
  }, [terminal, adjustMenuPosition, customCommands.length]);

  // Touch gesture handlers - differentiate tap from scroll
  // Must be defined AFTER handleContextMenu since it depends on it
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    isTouchMoveRef.current = false;

    // Clear any existing long press timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    // Set up long press for context menu (500ms)
    longPressTimerRef.current = setTimeout(() => {
      handleContextMenu(e);
    }, 500);
  }, [handleContextMenu]);

  const handleTouchMove = useCallback(() => {
    isTouchMoveRef.current = true;
    // Cancel long press on any movement
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Cancel any pending long press
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    // Only focus (show keyboard) if it was a tap, not a scroll
    if (!isTouchMoveRef.current && touchStartRef.current) {
      const touch = e.changedTouches[0];
      const dx = Math.abs(touch.clientX - touchStartRef.current.x);
      const dy = Math.abs(touch.clientY - touchStartRef.current.y);
      const dt = Date.now() - touchStartRef.current.time;

      // If minimal movement (<10px) and quick tap (<300ms), focus the input
      if (dx < 10 && dy < 10 && dt < 300) {
        hiddenInputRef.current?.focus();
      }
    }
    touchStartRef.current = null;
  }, []);

  const handleCopy = useCallback(async () => {
    const selection = terminal?.getSelection();
    if (selection) {
      await navigator.clipboard.writeText(selection);
    }
    setContextMenu(null);
    hiddenInputRef.current?.focus();
  }, [terminal]);

  const handlePaste = useCallback(async () => {
    setContextMenu(null);

    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && socket) {
          socket.emit('terminal:input', { terminalId: tab.id, data: text });
          hiddenInputRef.current?.focus();
          return;
        }
      }
    } catch (err) {
      console.log('Clipboard API failed, showing paste modal:', err);
    }

    // Fallback: show paste modal for manual paste
    setShowPasteModal(true);
  }, [socket, tab.id]);

  const handlePasteSubmit = useCallback(() => {
    if (pasteText && socket) {
      socket.emit('terminal:input', { terminalId: tab.id, data: pasteText });
    }
    setPasteText('');
    setShowPasteModal(false);
    hiddenInputRef.current?.focus();
  }, [socket, tab.id, pasteText]);

  const handleDelete = useCallback(() => {
    const selection = terminal?.getSelection();
    if (selection && selection.length > 0 && socket) {
      const backspaces = '\x7f'.repeat(selection.length);
      socket.emit('terminal:input', { terminalId: tab.id, data: backspaces });
      terminal?.clearSelection();
    }
    setContextMenu(null);
    hiddenInputRef.current?.focus();
  }, [terminal, socket, tab.id]);

  const handleAddCommand = useCallback(() => {
    if (newCommand.trim()) {
      const newCmd: CustomCommand = {
        command: newCommand.trim(),
        ...(newCommandName.trim() && { name: newCommandName.trim() })
      };
      const updated = [...customCommands, newCmd];
      setCustomCommands(updated);
      localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(updated));
      setNewCommand('');
      setNewCommandName('');
    }
    setShowAddCommand(false);
    setContextMenu(null);
  }, [newCommand, newCommandName, customCommands]);

  const handleRunCommand = useCallback((cmd: CustomCommand) => {
    if (socket) {
      socket.emit('terminal:input', { terminalId: tab.id, data: cmd.command });
    }
    setContextMenu(null);
    hiddenInputRef.current?.focus();
  }, [socket, tab.id]);

  const handleRemoveCommand = useCallback((index: number) => {
    const updated = customCommands.filter((_, i) => i !== index);
    setCustomCommands(updated);
    localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(updated));
  }, [customCommands]);

  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = () => setContextMenu(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contextMenu]);

  // Focus when becoming active
  useEffect(() => {
    if (isActive && isVisible) {
      requestAnimationFrame(() => {
        fit();
        hiddenInputRef.current?.focus();
      });
    }
  }, [isActive, isVisible, fit]);

  // Refit on container resize
  useEffect(() => {
    if (!containerRef.current) return;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        fit();
        resizeTimeout = null;
      }, 100);
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
      {/* MobileKeybar: Position fixed above keyboard when visible, or inline when not */}
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

      {/* Context menu */}
      {contextMenu && (
        <div
          className="context-menu terminal-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-item" onClick={handleCopy}>
            Copy
          </div>
          <div className="context-menu-item" onClick={handlePaste}>
            Paste
          </div>
          {contextMenu.hasSelection && (
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
              setContextMenu(null);
              setShowAddCommand(true);
            }}
          >
            + Add Command
          </div>
        </div>
      )}

      {/* Add command modal */}
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
  const { setSessionId, setLastActivePane, getPaneState } = useTerminalTabs();
  const pane = getPaneState(paneId);
  const tabs = pane?.tabs ?? [];
  const activeTabId = pane?.activeTabId ?? null;

  // Track when this pane becomes active
  const handlePaneInteraction = useCallback(() => {
    setLastActivePane(paneId);
  }, [setLastActivePane, paneId]);

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

  if (tabs.length === 0) {
    return null;
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
      />
      <div className="terminal-pane-content">
        {tabs.map((tab) => (
          <TerminalInstanceWrapper
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            isVisible={isVisible}
            onLink={onLink}
            onSessionCreated={sessionCallbacksRef.current[tab.id]}
          />
        ))}
      </div>
    </div>
  );
};

export default TerminalPane;
