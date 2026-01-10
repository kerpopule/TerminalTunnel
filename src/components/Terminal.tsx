import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Socket } from 'socket.io-client';
import { useTerminal } from '../hooks/useTerminal';
import { useTerminalSocket } from '../hooks/useSocket';
import { useSettings } from '../contexts/SettingsContext';
import MobileKeybar from './MobileKeybar';

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface TerminalProps {
  socket: Socket | null;
  status: ConnectionStatus;
  sessionId: string | null;
  isRestored: boolean;
  onLink?: (url: string) => void;
  isVisible?: boolean;
}

const CUSTOM_COMMANDS_KEY = 'mobile_terminal_custom_commands';

interface CustomCommand {
  name?: string;
  command: string;
}

const Terminal: React.FC<TerminalProps> = ({
  socket,
  status,
  sessionId,
  isRestored,
  onLink,
  isVisible = true
}) => {
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasRefreshedPrompt = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);
  const [customCommands, setCustomCommands] = useState<CustomCommand[]>(() => {
    const stored = localStorage.getItem(CUSTOM_COMMANDS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    // Migrate old string[] format to new CustomCommand[] format
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
      return parsed.map((cmd: string) => ({ command: cmd }));
    }
    return parsed;
  });
  const [showAddCommand, setShowAddCommand] = useState(false);
  const [newCommand, setNewCommand] = useState('');
  const [newCommandName, setNewCommandName] = useState('');

  // Get settings from context
  const { theme, fontFamily, fontSize } = useSettings();

  const { write: socketWrite, resize, resizeImmediate, onData } = useTerminalSocket(socket);

  // Handle localhost URL clicks
  const handleLink = useCallback((url: string) => {
    if (url.includes('localhost')) {
      onLink?.(url);
    } else {
      window.open(url, '_blank');
    }
  }, [onLink]);

  const { terminalRef, terminal, write, focus, fit } = useTerminal({
    onData: socketWrite,
    onResize: resize,
    onLink: handleLink,
    theme: theme.terminal,
    fontFamily,
    fontSize
  });

  // Receive data from server and write to terminal
  useEffect(() => {
    if (!socket) return;
    return onData(write);
  }, [socket, onData, write]);

  // Auto-focus and refresh prompt when terminal is ready
  useEffect(() => {
    if (status === 'connected' && terminal && hiddenInputRef.current) {
      const timer = setTimeout(() => {
        hiddenInputRef.current?.focus();
        // Send Enter to trigger a new prompt line if terminal appears empty
        // This handles initial load
        if (!hasRefreshedPrompt.current) {
          hasRefreshedPrompt.current = true;
          // Check if terminal has any content (cursor position > 0 means content exists)
          const buffer = terminal.buffer.active;
          const hasContent = buffer.cursorY > 0 || buffer.cursorX > 0;
          if (!hasContent) {
            socketWrite('\r');
          }
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [status, terminal, socketWrite]);

  // Refit terminal and focus when becoming visible
  useEffect(() => {
    if (isVisible && terminal) {
      // Use requestAnimationFrame to ensure CSS has been applied
      requestAnimationFrame(() => {
        fit();
        hiddenInputRef.current?.focus();
      });
    }
  }, [isVisible, terminal, fit]);


  // Focus hidden input when terminal container is tapped
  // Also handle link clicks that might not be caught by WebLinksAddon on mobile
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    // Check if click was on a link (WebLinksAddon creates anchor elements)
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');

    if (anchor) {
      // Prevent default navigation
      e.preventDefault();
      e.stopPropagation();

      const url = anchor.href || anchor.textContent || '';
      console.log('[Terminal] Container caught link click:', url);

      // Check if it's a localhost URL
      if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0') || url.match(/:\d{4,5}/)) {
        handleLink(url);
      } else if (url.startsWith('http')) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    hiddenInputRef.current?.focus();
  }, [handleLink]);

  // Handle hidden input changes (native keyboard input)
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value) {
      socketWrite(value);
      e.target.value = '';
    }
  }, [socketWrite]);

  // Handle special keys from hidden input
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle special keys that don't trigger onChange
    switch (e.key) {
      case 'Enter':
        socketWrite('\r');
        e.preventDefault();
        break;
      case 'Backspace':
        // Check if there's selected text in the terminal
        const selection = terminal?.getSelection();
        const selectionPosition = terminal?.getSelectionPosition();
        if (selection && selection.length > 0 && selectionPosition && terminal) {
          // Get cursor position and selection end position
          const cursorX = terminal.buffer.active.cursorX;
          const cursorY = terminal.buffer.active.cursorY;
          const selEndX = selectionPosition.end.x;
          const selEndY = selectionPosition.end.y;
          const selectionLength = selection.length;

          // Calculate how many positions to move left to reach end of selection
          // Only handle same-line selections for simplicity
          if (cursorY === selEndY && cursorX > selEndX) {
            const moveLeft = cursorX - selEndX;
            // Send left arrow keys to position cursor at end of selection
            const leftArrows = '\x1b[D'.repeat(moveLeft);
            socketWrite(leftArrows);

            // Delay before sending backspaces to let shell process cursor movement
            setTimeout(() => {
              const backspaces = '\x7f'.repeat(selectionLength);
              socketWrite(backspaces);
            }, 50);
          } else {
            // Cursor is already at or before selection, just delete
            const backspaces = '\x7f'.repeat(selectionLength);
            socketWrite(backspaces);
          }
          terminal.clearSelection();
        } else {
          socketWrite('\x7f');
        }
        e.preventDefault();
        break;
      case 'Tab':
        socketWrite('\t');
        e.preventDefault();
        break;
      case 'Escape':
        socketWrite('\x1b');
        e.preventDefault();
        break;
      case 'ArrowUp':
        socketWrite('\x1b[A');
        e.preventDefault();
        break;
      case 'ArrowDown':
        socketWrite('\x1b[B');
        e.preventDefault();
        break;
      case 'ArrowRight':
        socketWrite('\x1b[C');
        e.preventDefault();
        break;
      case 'ArrowLeft':
        socketWrite('\x1b[D');
        e.preventDefault();
        break;
    }
  }, [socketWrite, terminal]);

  // Send special key from MobileKeybar
  const handleSpecialKey = useCallback((key: string) => {
    socketWrite(key);
    hiddenInputRef.current?.focus();
  }, [socketWrite]);

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const selection = terminal?.getSelection();
    setContextMenu({ x: clientX, y: clientY, hasSelection: !!selection && selection.length > 0 });
  }, [terminal]);

  const handleCopy = useCallback(async () => {
    const selection = terminal?.getSelection();
    if (selection) {
      await navigator.clipboard.writeText(selection);
    }
    setContextMenu(null);
  }, [terminal]);

  const handleDelete = useCallback(() => {
    const selection = terminal?.getSelection();
    const selectionPosition = terminal?.getSelectionPosition();
    if (selection && selection.length > 0 && terminal) {
      // Get cursor position and selection end position
      const cursorX = terminal.buffer.active.cursorX;
      const cursorY = terminal.buffer.active.cursorY;
      const selectionLength = selection.length;

      if (selectionPosition) {
        const selEndX = selectionPosition.end.x;
        const selEndY = selectionPosition.end.y;

        // Calculate how many positions to move left to reach end of selection
        // Only handle same-line selections for simplicity
        if (cursorY === selEndY && cursorX > selEndX) {
          const moveLeft = cursorX - selEndX;
          // Send left arrow keys to position cursor at end of selection
          const leftArrows = '\x1b[D'.repeat(moveLeft);
          socketWrite(leftArrows);

          // Delay before sending backspaces to let shell process cursor movement
          setTimeout(() => {
            const backspaces = '\x7f'.repeat(selectionLength);
            socketWrite(backspaces);
          }, 50);
          terminal.clearSelection();
          setContextMenu(null);
          hiddenInputRef.current?.focus();
          return;
        }
      }

      // Cursor is already at or before selection, just delete
      const backspaces = '\x7f'.repeat(selectionLength);
      socketWrite(backspaces);
      terminal.clearSelection();
    }
    setContextMenu(null);
    hiddenInputRef.current?.focus();
  }, [terminal, socketWrite]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        socketWrite(text);
      }
    } catch (err) {
      console.error('Failed to paste:', err);
    }
    setContextMenu(null);
    hiddenInputRef.current?.focus();
  }, [socketWrite]);

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
    socketWrite(cmd.command);
    setContextMenu(null);
    hiddenInputRef.current?.focus();
  }, [socketWrite]);

  const handleRemoveCommand = useCallback((index: number) => {
    const updated = customCommands.filter((_, i) => i !== index);
    setCustomCommands(updated);
    localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(updated));
  }, [customCommands]);

  // Close context menu on click elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Fit terminal when container size changes (debounced)
  useEffect(() => {
    if (!containerRef.current) return;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const resizeObserver = new ResizeObserver(() => {
      // Debounce resize to prevent rapid-fire events
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = setTimeout(() => {
        fit();
        resizeTimeout = null;
      }, 100);
    });

    resizeObserver.observe(containerRef.current);
    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeObserver.disconnect();
    };
  }, [fit]);

  // Show connection status
  if (status === 'connecting') {
    return (
      <div className="tab-content">
        <div className="loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (status === 'reconnecting') {
    return (
      <div className="tab-content">
        <div className="loading">
          <div className="loading-spinner" />
          <div className="loading-text">Reconnecting...</div>
        </div>
      </div>
    );
  }

  if (status === 'disconnected') {
    return (
      <div className="tab-content">
        <div className="error-state">
          <div className="error-icon">⚠️</div>
          <div className="error-title">Connection Lost</div>
          <div className="error-message">
            Unable to connect to terminal server. Check that the server is running.
          </div>
          <button className="error-retry" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content">
      {/* Hidden input for keyboard capture */}
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

      {/* Terminal container */}
      <div
        ref={containerRef}
        className="terminal-container"
        onClick={handleContainerClick}
        onContextMenu={handleContextMenu}
        onTouchStart={(e) => {
          // Focus input on any touch
          hiddenInputRef.current?.focus();
          // Long press for context menu
          const timer = setTimeout(() => handleContextMenu(e), 500);
          const cleanup = () => clearTimeout(timer);
          e.currentTarget.addEventListener('touchend', cleanup, { once: true });
          e.currentTarget.addEventListener('touchmove', cleanup, { once: true });
        }}
      >
        <div ref={terminalRef} style={{ height: '100%' }} />
      </div>

      {/* Mobile keyboard helper bar */}
      <MobileKeybar onKey={handleSpecialKey} />

      {/* Context menu */}
      {contextMenu && (
        <div
          className="context-menu terminal-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-item" onClick={handleCopy}>
            📋 Copy
          </div>
          <div className="context-menu-item" onClick={handlePaste}>
            📥 Paste
          </div>
          {contextMenu.hasSelection && (
            <div className="context-menu-item" onClick={handleDelete}>
              🗑️ Delete
            </div>
          )}
          <div className="context-menu-divider" />
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
          <div
            className="context-menu-item add-command"
            onClick={() => {
              setContextMenu(null);
              setShowAddCommand(true);
            }}
          >
            ➕ Add Command
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
                className="modal-btn modal-btn-confirm"
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
  );
};

export default Terminal;
