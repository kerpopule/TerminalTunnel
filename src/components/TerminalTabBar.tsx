import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  Droppable,
  Draggable,
  DraggableProvided,
  DroppableProvided,
} from 'react-beautiful-dnd';
import { useTerminalTabs } from '../contexts/TerminalTabsContext';
import { useSettings } from '../contexts/SettingsContext';
import type { AnyPaneId } from '../types/terminal';
import { isDashboardPaneId } from '../types/terminal';

// API base for file uploads
const API_BASE = '';

// Upload Icon (arrow up into tray)
const UploadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

// Split Pane Icon (vertical split)
const SplitPaneIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="12" y1="3" x2="12" y2="21" />
  </svg>
);

// Merge Pane Icon (single pane)
const MergePaneIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </svg>
);

interface TerminalTabBarProps {
  paneId: AnyPaneId;
  showSplitToggle?: boolean;
  // Dashboard row split controls
  showDashboardSplit?: boolean;
  canSplitRow?: boolean;
  canUnsplitRow?: boolean;
  onSplitRow?: () => void;
  onUnsplitRow?: () => void;
  // Terminal upload support
  writeTerminal?: (terminalId: string, data: string) => void;
}

const TerminalTabBar: React.FC<TerminalTabBarProps> = ({
  paneId,
  showSplitToggle = false,
  showDashboardSplit = false,
  canSplitRow = false,
  canUnsplitRow = false,
  onSplitRow,
  onUnsplitRow,
  writeTerminal,
}) => {
  const {
    createTab,
    closeTab,
    switchTab,
    canCreateTab,
    toggleSplit,
    renameTab,
    getPaneState,
    splitState,
  } = useTerminalTabs();

  const { terminalUploadPath } = useSettings();

  // Check if this is a dashboard pane
  const isDashboard = isDashboardPaneId(paneId);

  const pane = getPaneState(paneId);
  const tabs = pane?.tabs ?? [];
  const activeTabId = pane?.activeTabId ?? null;

  // Long press state for mobile drag initiation
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDragReady, setIsDragReady] = useState(false);

  // Rename state
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Focus the rename input when it appears - use multiple attempts for iOS
  useEffect(() => {
    if (renamingTabId && renameInputRef.current) {
      const input = renameInputRef.current;
      // Immediate focus
      input.focus();
      input.select();
      // iOS sometimes needs a slight delay
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
      // Extra attempt for stubborn iOS keyboards
      setTimeout(() => {
        input.focus();
        input.select();
      }, 50);
    }
  }, [renamingTabId]);

  const handleCreateTab = useCallback(() => {
    createTab(paneId);
  }, [createTab, paneId]);

  const handleCloseTab = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(paneId, tabId);
  }, [closeTab, paneId]);

  const handleSwitchTab = useCallback((tabId: string) => {
    if (renamingTabId) return; // Don't switch while renaming
    switchTab(paneId, tabId);
  }, [switchTab, paneId, renamingTabId]);

  // Start rename mode
  const startRename = useCallback((tabId: string, currentName: string) => {
    setRenamingTabId(tabId);
    setRenameValue(currentName);
  }, []);

  // Commit rename
  const commitRename = useCallback(() => {
    if (renamingTabId && renameValue.trim()) {
      renameTab(renamingTabId, renameValue.trim());
    }
    setRenamingTabId(null);
    setRenameValue('');
  }, [renamingTabId, renameValue, renameTab]);

  // Cancel rename
  const cancelRename = useCallback(() => {
    setRenamingTabId(null);
    setRenameValue('');
  }, []);

  // Handle rename input key events
  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }, [commitRename, cancelRename]);

  // Handle right-click to start rename
  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string, tabName: string) => {
    e.preventDefault();
    e.stopPropagation();
    startRename(tabId, tabName);
  }, [startRename]);

  // Long press handlers for mobile - now triggers rename
  const handleTouchStart = useCallback((tabId: string, tabName: string) => {
    longPressTimer.current = setTimeout(() => {
      setIsDragReady(true);
      // Start rename on long press
      startRename(tabId, tabName);
    }, 500);
  }, [startRename]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setIsDragReady(false);
  }, []);

  // Handle file upload to terminal
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus('idle');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('uploadPath', terminalUploadPath);

    try {
      const response = await fetch(`${API_BASE}/api/terminal-upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();

      if (result.success && result.filePath) {
        // Get the active terminal for THIS pane and paste the path
        if (activeTabId && writeTerminal) {
          // Paste the file path with quotes (for paths with spaces) and trailing space
          writeTerminal(activeTabId, `"${result.filePath}" `);
        }
        setUploadStatus('success');
      }
    } catch (error) {
      console.error('File upload error:', error);
      setUploadStatus('error');
    } finally {
      setIsUploading(false);
      // Reset status after brief display
      setTimeout(() => setUploadStatus('idle'), 1500);
    }

    // Reset input to allow re-uploading same file
    e.target.value = '';
  }, [activeTabId, writeTerminal, terminalUploadPath]);

  // Determine if we should show close buttons
  // Only hide close button if it's the last tab in the only active pane
  // For dashboard panes, always allow closing since multiple panes exist
  const canCloseTabs = tabs.length > 1 || isDashboard || splitState.enabled;

  // Prevent keyboard from popping up when tapping tab bar (except rename input)
  const preventFocus = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    // Allow focus on rename input
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();
  }, []);

  return (
    <div
      className="terminal-tab-bar"
      onMouseDown={preventFocus}
      onTouchStart={preventFocus}
    >
      <Droppable droppableId={paneId} direction="horizontal">
        {(provided: DroppableProvided) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="terminal-tabs-scroll"
          >
            {tabs.map((tab, index) => (
              <Draggable
                key={tab.id}
                draggableId={tab.id}
                index={index}
                isDragDisabled={renamingTabId === tab.id || (!isDragReady && !isDashboard && !splitState.enabled)}
              >
                {(provided: DraggableProvided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={`terminal-tab ${tab.id === activeTabId ? 'active' : ''} ${snapshot.isDragging ? 'dragging' : ''}`}
                    onClick={() => handleSwitchTab(tab.id)}
                    onContextMenu={(e) => handleContextMenu(e, tab.id, tab.name)}
                    onTouchStart={() => handleTouchStart(tab.id, tab.name)}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchEnd}
                  >
                    {renamingTabId === tab.id ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        inputMode="text"
                        autoFocus
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        className="terminal-tab-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        onBlur={commitRename}
                        onClick={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="terminal-tab-name">{tab.name}</span>
                    )}
                    {canCloseTabs && renamingTabId !== tab.id && (
                      <button
                        className="terminal-tab-close"
                        onClick={(e) => handleCloseTab(e, tab.id)}
                        aria-label={`Close ${tab.name}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
      <div className="terminal-tab-actions">
        <button
          className="terminal-tab-action-btn"
          onClick={handleCreateTab}
          disabled={!canCreateTab(paneId)}
          aria-label="New terminal tab"
          title="New tab"
        >
          +
        </button>
        <button
          className={`terminal-tab-action-btn upload-btn ${
            uploadStatus === 'success' ? 'upload-success' :
            uploadStatus === 'error' ? 'upload-error' : ''
          }`}
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          aria-label="Upload file to terminal"
          title="Upload file"
        >
          <UploadIcon />
        </button>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleFileUpload}
          accept="image/*,*/*"
        />
        {showSplitToggle && (
          <button
            className={`terminal-tab-action-btn split-toggle ${splitState.enabled ? 'active' : ''}`}
            onClick={toggleSplit}
            aria-label={splitState.enabled ? 'Disable split view' : 'Enable split view'}
            title={splitState.enabled ? 'Merge panes' : 'Split view'}
          >
            {splitState.enabled ? '⊟' : '⊞'}
          </button>
        )}
        {showDashboardSplit && (
          <button
            className={`terminal-tab-action-btn dashboard-split-btn ${canUnsplitRow ? 'active' : ''}`}
            onClick={canUnsplitRow ? onUnsplitRow : onSplitRow}
            disabled={!canSplitRow && !canUnsplitRow}
            aria-label={canUnsplitRow ? 'Merge row panes' : 'Split row'}
            title={canUnsplitRow ? 'Merge panes' : 'Split pane'}
          >
            {canUnsplitRow ? <MergePaneIcon /> : <SplitPaneIcon />}
          </button>
        )}
      </div>
    </div>
  );
};

export default TerminalTabBar;
