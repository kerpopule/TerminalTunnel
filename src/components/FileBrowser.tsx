import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSettings } from '../contexts/SettingsContext';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
  isHidden: boolean;
}

interface Shortcut {
  name: string;
  path: string;
  icon: string;
}

interface FileBrowserProps {
  onNavigate?: (path: string, isDirectory: boolean) => void;
  onRunCustomCommand?: (path: string, command: string) => void;
}

const FAVORITES_KEY = 'mobile_terminal_favorites';
const VIEW_MODE_KEY = 'mobile_terminal_view_mode';
const CUSTOM_BUTTON_KEY = 'mobile_terminal_custom_button';
const LAST_PATH_KEY = 'mobile_terminal_last_path'; // sessionStorage - persists during session only

// Use localhost only when actually on localhost - allows tunnel access to work
const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const API_BASE = import.meta.env.DEV && isLocalhost ? 'http://localhost:3456' : '';

interface CustomButtonConfig {
  name: string;
  command: string;
}

interface FilePreview {
  entry: FileEntry;
  type: 'image' | 'text' | 'pdf';
  content?: string;
}

const FileBrowser: React.FC<FileBrowserProps> = ({ onNavigate, onRunCustomCommand }) => {
  const { fontFamily } = useSettings();
  const [currentPath, setCurrentPath] = useState<string>('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sortMode, setSortMode] = useState<'alpha' | 'recent'>('alpha');
  const [viewMode, setViewMode] = useState<'list' | 'icon'>(() => {
    return (localStorage.getItem(VIEW_MODE_KEY) as 'list' | 'icon') || 'list';
  });
  const [favorites, setFavorites] = useState<string[]>(() => {
    const stored = localStorage.getItem(FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
  });
  const [customButton, setCustomButton] = useState<CustomButtonConfig>(() => {
    const stored = localStorage.getItem(CUSTOM_BUTTON_KEY);
    return stored ? JSON.parse(stored) : { name: 'Open in Claude Code', command: 'claude --dangerously-skip-permissions' };
  });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const [favoriteContextMenu, setFavoriteContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [shortcutContextMenu, setShortcutContextMenu] = useState<{ x: number; y: number; shortcut: Shortcut } | null>(null);
  const [newFolderModal, setNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editButtonModal, setEditButtonModal] = useState(false);
  const [editButtonName, setEditButtonName] = useState('');
  const [editButtonCommand, setEditButtonCommand] = useState('');
  const [previewCopyFeedback, setPreviewCopyFeedback] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);

  // Persist view mode
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  // Load shortcuts
  useEffect(() => {
    fetch(`${API_BASE}/api/files/shortcuts`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setShortcuts(data.shortcuts))
      .catch(() => {});
  }, []);

  // Load directory with optional retry
  const loadDirectory = useCallback(async (path: string = '', retries: number = 0) => {
    setLoading(true);
    setError(null);

    try {
      const url = path ? `${API_BASE}/api/files/list?path=${encodeURIComponent(path)}` : `${API_BASE}/api/files/list`;
      const res = await fetch(url, { credentials: 'include' });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to load directory');
      }

      const data = await res.json();
      setCurrentPath(data.path);
      setEntries(data.entries);
      setLoading(false);
      // Remember last path in session storage
      try {
        sessionStorage.setItem(LAST_PATH_KEY, data.path);
      } catch {
        // Ignore storage errors
      }
    } catch (err) {
      // On initial load, retry a few times if server isn't ready
      if (retries < 5) {
        setTimeout(() => loadDirectory(path, retries + 1), 500);
        return;
      }
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  }, []);

  // Initial load with auto-retry - restore last path from session if available
  useEffect(() => {
    let lastPath = '';
    try {
      lastPath = sessionStorage.getItem(LAST_PATH_KEY) || '';
    } catch {
      // Ignore storage errors
    }
    loadDirectory(lastPath, 0);
  }, [loadDirectory]);

  // Sort and filter entries
  const displayedEntries = entries
    .filter(entry => showHidden || !entry.isHidden)
    .sort((a, b) => {
      // Directories first
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }

      if (sortMode === 'recent') {
        return b.mtime - a.mtime;
      }

      return a.name.localeCompare(b.name);
    });

  // Navigate to directory or preview file
  const handleEntryClick = (entry: FileEntry) => {
    if (entry.isDirectory) {
      loadDirectory(entry.path);
    } else if (isPreviewable(entry.name)) {
      openPreview(entry);
    } else {
      onNavigate?.(entry.path, false);
    }
  };

  // Go up one directory
  const handleGoUp = () => {
    const parent = currentPath.split('/').slice(0, -1).join('/');
    if (parent) {
      loadDirectory(parent);
    }
  };

  // Adjust context menu position to stay within viewport
  const adjustMenuPosition = (x: number, y: number, menuWidth = 180, menuHeight = 150) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    // Check right edge
    if (x + menuWidth > viewportWidth) {
      adjustedX = viewportWidth - menuWidth - 8;
    }

    // Check bottom edge
    if (y + menuHeight > viewportHeight) {
      adjustedY = viewportHeight - menuHeight - 8;
    }

    // Ensure not negative
    adjustedX = Math.max(8, adjustedX);
    adjustedY = Math.max(8, adjustedY);

    return { x: adjustedX, y: adjustedY };
  };

  // Long press for context menu
  const handleLongPress = (e: React.TouchEvent | React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const { x, y } = adjustMenuPosition(clientX, clientY, 180, 180);
    setContextMenu({ x, y, entry });
  };

  // Toggle favorite
  const toggleFavorite = (path: string) => {
    const newFavorites = favorites.includes(path)
      ? favorites.filter(f => f !== path)
      : [...favorites, path];
    setFavorites(newFavorites);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));
  };

  // Create new folder
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    try {
      const res = await fetch(`${API_BASE}/api/files/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `${currentPath}/${newFolderName}` }),
        credentials: 'include'
      });

      if (res.ok) {
        loadDirectory(currentPath);
        setNewFolderModal(false);
        setNewFolderName('');
      }
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    formData.append('path', currentPath);

    Array.from(files).forEach(file => {
      formData.append('files', file);
    });

    setUploadProgress(0);

    try {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(progress);
        }
      });

      xhr.onload = () => {
        setUploadProgress(null);
        if (xhr.status === 200) {
          loadDirectory(currentPath);
        } else {
          console.error('Upload failed:', xhr.statusText);
        }
      };

      xhr.onerror = () => {
        setUploadProgress(null);
        console.error('Upload failed');
      };

      xhr.open('POST', `${API_BASE}/api/files/upload`);
      xhr.withCredentials = true;
      xhr.send(formData);
    } catch (err) {
      setUploadProgress(null);
      console.error('Upload error:', err);
    }

    // Reset the input so the same file can be selected again
    e.target.value = '';
  };

  // Copy path to clipboard with feedback
  const copyPath = async (path: string) => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(path);
      } else {
        // Fallback for older browsers or insecure contexts
        const textArea = document.createElement('textarea');
        textArea.value = path;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    } catch (err) {
      console.error('Failed to copy path:', err);
    } finally {
      setContextMenu(null);
      setFavoriteContextMenu(null);
      setShortcutContextMenu(null);
    }
  };

  // Copy current path when header is clicked
  const copyCurrentPath = async () => {
    await navigator.clipboard.writeText(currentPath);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1500);
  };

  // Remove from favorites
  const removeFromFavorites = (path: string) => {
    const newFavorites = favorites.filter(f => f !== path);
    setFavorites(newFavorites);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));
    setFavoriteContextMenu(null);
  };

  // Remove shortcut from shortcuts list
  const removeShortcut = (path: string) => {
    setShortcuts(shortcuts.filter(s => s.path !== path));
    setShortcutContextMenu(null);
  };

  // Get favorite name from path
  const getFavoriteName = (path: string): string => {
    return path.split('/').pop() || path;
  };

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  // Check if file is an image
  const isImageFile = (name: string): boolean => {
    const ext = name.split('.').pop()?.toLowerCase();
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext || '');
  };

  // Check if file is a text file
  const isTextFile = (name: string): boolean => {
    const ext = name.split('.').pop()?.toLowerCase();
    return ['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'xml', 'yml', 'yaml', 'sh', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'swift', 'kt', 'env', 'gitignore', 'log', 'csv'].includes(ext || '');
  };

  // Check if file is a PDF
  const isPdfFile = (name: string): boolean => {
    const ext = name.split('.').pop()?.toLowerCase();
    return ext === 'pdf';
  };

  // Check if file is previewable
  const isPreviewable = (name: string): boolean => {
    return isImageFile(name) || isTextFile(name) || isPdfFile(name);
  };

  // Get preview type
  const getPreviewType = (name: string): 'image' | 'text' | 'pdf' | null => {
    if (isImageFile(name)) return 'image';
    if (isTextFile(name)) return 'text';
    if (isPdfFile(name)) return 'pdf';
    return null;
  };

  // Open file preview
  const openPreview = async (entry: FileEntry) => {
    const type = getPreviewType(entry.name);
    if (!type) return;

    if (type === 'text') {
      setPreviewLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/files/download?path=${encodeURIComponent(entry.path)}`, {
          credentials: 'include'
        });
        const content = await res.text();
        setFilePreview({ entry, type, content });
      } catch (err) {
        console.error('Failed to load file:', err);
      } finally {
        setPreviewLoading(false);
      }
    } else {
      setFilePreview({ entry, type });
    }
  };

  // Get file icon - returns 'folder' for directories or emoji for files
  const getFileIcon = (entry: FileEntry): string | 'folder' => {
    if (entry.isDirectory) return 'folder';

    const ext = entry.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
      case 'ts':
      case 'jsx':
      case 'tsx':
        return '📜';
      case 'json':
        return '📋';
      case 'md':
        return '📝';
      case 'html':
      case 'css':
        return '🌐';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'webp':
      case 'svg':
      case 'bmp':
      case 'ico':
        return '🖼️';
      case 'pdf':
        return '📄';
      case 'mp4':
      case 'mov':
      case 'avi':
      case 'mkv':
        return '🎬';
      case 'mp3':
      case 'wav':
      case 'aac':
      case 'm4a':
        return '🎵';
      case 'zip':
      case 'tar':
      case 'gz':
      case 'rar':
        return '📦';
      default:
        return '📄';
    }
  };

  // Render folder icon as styled SVG
  const renderFolderIcon = () => (
    <svg className="folder-icon-svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
    </svg>
  );

  // Close context menus when clicking elsewhere
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      setContextMenu(null);
      setFavoriteContextMenu(null);
      setShortcutContextMenu(null);
      // Close plus menu if clicking outside
      if (plusButtonRef.current && !plusButtonRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  if (loading && !entries.length) {
    return (
      <div className="file-browser">
        <div className="loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="file-browser">
        <div className="error-state">
          <div className="error-icon">❌</div>
          <div className="error-title">Error</div>
          <div className="error-message">{error}</div>
          <button className="error-retry" onClick={() => loadDirectory(currentPath)}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // SVG Icons for header buttons
  const UpArrowIcon = () => (
    <svg className="file-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7"/>
    </svg>
  );

  const EyeIcon = () => (
    <svg className="file-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );

  const SortAlphaIcon = () => (
    <svg className="file-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h7M3 12h5M3 18h3M16 6l3 6h-6l3-6zM13 18h6l-3-4.5L13 18z"/>
    </svg>
  );

  const SortTimeIcon = () => (
    <svg className="file-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 6v6l4 2"/>
    </svg>
  );

  const GridIcon = () => (
    <svg className="file-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
    </svg>
  );

  const ListIcon = () => (
    <svg className="file-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  );

  const PlusIcon = () => (
    <svg className="file-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );

  return (
    <div className="file-browser">
      {/* Header */}
      <div className="file-header">
        <button className="file-action-btn" onClick={handleGoUp} title="Go up">
          <UpArrowIcon />
        </button>
        <div className="file-path" onClick={copyCurrentPath} style={{ cursor: 'pointer' }}>
          {copyFeedback ? '✓ Copied!' : currentPath}
        </div>
        <div className="file-actions">
          <button
            className="file-action-btn"
            onClick={() => setViewMode(viewMode === 'list' ? 'icon' : 'list')}
            title={viewMode === 'list' ? 'Icon view' : 'List view'}
          >
            {viewMode === 'list' ? <GridIcon /> : <ListIcon />}
          </button>
          <button
            className="file-action-btn"
            onClick={() => setShowHidden(!showHidden)}
            style={{ opacity: showHidden ? 1 : 0.5 }}
            title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
          >
            <EyeIcon />
          </button>
          <button
            className="file-action-btn"
            onClick={() => setSortMode(sortMode === 'alpha' ? 'recent' : 'alpha')}
            title={sortMode === 'alpha' ? 'Sort by date' : 'Sort alphabetically'}
          >
            {sortMode === 'alpha' ? <SortAlphaIcon /> : <SortTimeIcon />}
          </button>
          <div className="plus-menu-container">
            <button
              ref={plusButtonRef}
              className="file-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                setPlusMenuOpen(!plusMenuOpen);
              }}
              title="Add"
            >
              <PlusIcon />
            </button>
            {plusMenuOpen && (
              <div className="plus-menu">
                <div
                  className="context-menu-item"
                  onClick={() => {
                    setNewFolderModal(true);
                    setPlusMenuOpen(false);
                  }}
                >
                  <span className="context-menu-icon">📁</span>
                  New Folder
                </div>
                <div
                  className="context-menu-item"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setPlusMenuOpen(false);
                  }}
                >
                  <span className="context-menu-icon">📤</span>
                  Upload Files
                </div>
              </div>
            )}
          </div>
          <input
            type="file"
            ref={fileInputRef}
            multiple
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
        </div>
      </div>

      {/* Shortcuts + Favorites */}
      <div className="shortcuts-bar">
        {shortcuts.map(shortcut => (
          <button
            key={shortcut.path}
            className="shortcut-btn"
            onClick={() => loadDirectory(shortcut.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              const { x, y } = adjustMenuPosition(e.clientX, e.clientY, 180, 100);
              setShortcutContextMenu({ x, y, shortcut });
            }}
            onTouchStart={(e) => {
              const timer = setTimeout(() => {
                const touch = e.touches[0];
                const { x, y } = adjustMenuPosition(touch.clientX, touch.clientY, 180, 100);
                setShortcutContextMenu({ x, y, shortcut });
              }, 500);
              const cleanup = () => clearTimeout(timer);
              e.currentTarget.addEventListener('touchend', cleanup, { once: true });
              e.currentTarget.addEventListener('touchmove', cleanup, { once: true });
            }}
          >
            {shortcut.name}
          </button>
        ))}
        {favorites.map(favPath => (
          <button
            key={favPath}
            className="shortcut-btn"
            onClick={() => loadDirectory(favPath)}
            onContextMenu={(e) => {
              e.preventDefault();
              const { x, y } = adjustMenuPosition(e.clientX, e.clientY, 180, 100);
              setFavoriteContextMenu({ x, y, path: favPath });
            }}
            onTouchStart={(e) => {
              const timer = setTimeout(() => {
                const touch = e.touches[0];
                const { x, y } = adjustMenuPosition(touch.clientX, touch.clientY, 180, 100);
                setFavoriteContextMenu({ x: x, y: y, path: favPath });
              }, 500);
              const cleanup = () => clearTimeout(timer);
              e.currentTarget.addEventListener('touchend', cleanup, { once: true });
              e.currentTarget.addEventListener('touchmove', cleanup, { once: true });
            }}
          >
            {getFavoriteName(favPath)}
          </button>
        ))}
      </div>

      {/* File list */}
      <div
        className={`file-list ${viewMode === 'icon' ? 'file-list-icons' : ''}`}
        style={{ fontFamily }}
      >
        {displayedEntries.map(entry => (
          <div
            key={entry.path}
            className={`file-item ${viewMode === 'icon' ? 'file-item-icon' : ''}`}
            onClick={() => handleEntryClick(entry)}
            onContextMenu={(e) => handleLongPress(e, entry)}
            onTouchStart={(e) => {
              const timer = setTimeout(() => handleLongPress(e, entry), 500);
              const cleanup = () => clearTimeout(timer);
              e.currentTarget.addEventListener('touchend', cleanup, { once: true });
              e.currentTarget.addEventListener('touchmove', cleanup, { once: true });
            }}
          >
            {viewMode === 'icon' && isImageFile(entry.name) ? (
              <img
                src={`${API_BASE}/api/files/download?path=${encodeURIComponent(entry.path)}`}
                alt={entry.name}
                className="file-thumbnail"
                loading="lazy"
                onError={(e) => {
                  // Fall back to icon on error
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <div className={`file-icon ${viewMode === 'icon' ? 'file-icon-large' : ''} ${viewMode === 'icon' && isImageFile(entry.name) ? 'hidden' : ''} ${entry.isDirectory ? 'file-icon-folder' : ''}`}>
              {getFileIcon(entry) === 'folder' ? renderFolderIcon() : getFileIcon(entry)}
            </div>
            <div className="file-info">
              <div className="file-name">
                {entry.name}
              </div>
              {viewMode === 'list' && (
                <div className="file-meta">
                  {entry.isDirectory ? 'Folder' : formatSize(entry.size)}
                  {' · '}
                  {new Date(entry.mtime).toLocaleDateString()}
                </div>
              )}
            </div>
            {viewMode === 'list' && entry.isDirectory && <div className="file-chevron">›</div>}
          </div>
        ))}
      </div>

      {/* Bottom action button */}
      <div className="file-browser-actions">
        <button
          className="file-browser-action-btn claude-code-btn"
          onClick={() => onRunCustomCommand?.(currentPath, customButton.command)}
          onContextMenu={(e) => {
            e.preventDefault();
            setEditButtonName(customButton.name);
            setEditButtonCommand(customButton.command);
            setEditButtonModal(true);
          }}
          onTouchStart={(e) => {
            const timer = setTimeout(() => {
              setEditButtonName(customButton.name);
              setEditButtonCommand(customButton.command);
              setEditButtonModal(true);
            }, 500);
            const cleanup = () => clearTimeout(timer);
            e.currentTarget.addEventListener('touchend', cleanup, { once: true });
            e.currentTarget.addEventListener('touchmove', cleanup, { once: true });
          }}
        >
          {customButton.name}
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="context-menu-item"
            onClick={() => {
              toggleFavorite(contextMenu.entry.path);
              setContextMenu(null);
            }}
          >
            {favorites.includes(contextMenu.entry.path) ? '⭐ Remove Favorite' : '⭐ Add Favorite'}
          </div>
          <div
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              const pathToCopy = contextMenu.entry.path;
              copyPath(pathToCopy);
            }}
          >
            📋 Copy Path
          </div>
          {contextMenu.entry.isDirectory && (
            <div
              className="context-menu-item"
              onClick={() => {
                onRunCustomCommand?.(contextMenu.entry.path, '');
                setContextMenu(null);
              }}
            >
              💻 Open in Terminal
            </div>
          )}
          {!contextMenu.entry.isDirectory && (
            <div
              className="context-menu-item"
              onClick={() => {
                window.open(`${API_BASE}/api/files/download?path=${encodeURIComponent(contextMenu.entry.path)}`);
                setContextMenu(null);
              }}
            >
              ⬇️ Download
            </div>
          )}
        </div>
      )}

      {/* Favorite context menu */}
      {favoriteContextMenu && (
        <div
          className="context-menu"
          style={{ top: favoriteContextMenu.y, left: favoriteContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              const pathToCopy = favoriteContextMenu.path;
              copyPath(pathToCopy);
            }}
          >
            📋 Copy Path
          </div>
          <div
            className="context-menu-item danger"
            onClick={() => removeFromFavorites(favoriteContextMenu.path)}
          >
            ⭐ Remove Favorite
          </div>
        </div>
      )}

      {/* Shortcut context menu */}
      {shortcutContextMenu && (
        <div
          className="context-menu"
          style={{ top: shortcutContextMenu.y, left: shortcutContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              const pathToCopy = shortcutContextMenu.shortcut.path;
              copyPath(pathToCopy);
            }}
          >
            📋 Copy Path
          </div>
          <div
            className="context-menu-item danger"
            onClick={() => removeShortcut(shortcutContextMenu.shortcut.path)}
          >
            🗑️ Remove
          </div>
        </div>
      )}

      {/* Upload progress overlay */}
      {uploadProgress !== null && (
        <div className="upload-progress-overlay">
          <div className="upload-progress-container">
            <div className="upload-progress-title">Uploading...</div>
            <div className="upload-progress-bar-container">
              <div
                className="upload-progress-bar"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <div className="upload-progress-text">{uploadProgress}%</div>
          </div>
        </div>
      )}

      {/* New folder modal */}
      {newFolderModal && (
        <div className="modal-overlay" onClick={() => setNewFolderModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">New Folder</div>
            <input
              type="text"
              className="modal-input"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            />
            <div className="modal-actions">
              <button
                className="modal-btn modal-btn-cancel"
                onClick={() => setNewFolderModal(false)}
              >
                Cancel
              </button>
              <button
                className="modal-btn modal-btn-confirm"
                onClick={handleCreateFolder}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File preview modal */}
      {(filePreview || previewLoading) && (
        <div className="file-preview-overlay" onClick={() => setFilePreview(null)}>
          <div className="file-preview-header" onClick={(e) => e.stopPropagation()}>
            <div className="file-preview-title">
              {previewLoading ? 'Loading...' : filePreview?.entry.name}
            </div>
            <div className="file-preview-actions">
              {filePreview?.type === 'text' && filePreview.content && (
                <button
                  className="file-preview-btn"
                  onClick={async () => {
                    await navigator.clipboard.writeText(filePreview.content || '');
                    setPreviewCopyFeedback(true);
                    setTimeout(() => setPreviewCopyFeedback(false), 1500);
                  }}
                >
                  {previewCopyFeedback ? '✓' : (
                    <svg className="file-preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  )}
                </button>
              )}
              <button className="file-preview-btn file-preview-close" onClick={() => setFilePreview(null)}>
                ✕
              </button>
            </div>
          </div>
          <div className="file-preview-content" onClick={(e) => e.stopPropagation()}>
            {previewLoading && (
              <div className="loading">
                <div className="loading-spinner" />
              </div>
            )}
            {filePreview?.type === 'image' && (
              <img
                src={`${API_BASE}/api/files/download?path=${encodeURIComponent(filePreview.entry.path)}`}
                alt={filePreview.entry.name}
                className="file-preview-image"
              />
            )}
            {filePreview?.type === 'text' && (
              <pre className="file-preview-text">{filePreview.content}</pre>
            )}
            {filePreview?.type === 'pdf' && (
              <iframe
                src={`${API_BASE}/api/files/download?path=${encodeURIComponent(filePreview.entry.path)}`}
                className="file-preview-pdf"
                title={filePreview.entry.name}
              />
            )}
          </div>
        </div>
      )}

      {/* Edit button modal */}
      {editButtonModal && (
        <div className="modal-overlay" onClick={() => setEditButtonModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Edit Quick Action</div>
            <div className="modal-field">
              <label className="modal-label">Button Name</label>
              <input
                type="text"
                className="modal-input"
                placeholder="Button name"
                value={editButtonName}
                onChange={(e) => setEditButtonName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="modal-field">
              <label className="modal-label">Command</label>
              <input
                type="text"
                className="modal-input"
                placeholder="Command to run"
                value={editButtonCommand}
                onChange={(e) => setEditButtonCommand(e.target.value)}
              />
              <div className="modal-hint">Runs after cd to current folder</div>
            </div>
            <div className="modal-actions">
              <button
                className="modal-btn modal-btn-cancel"
                onClick={() => setEditButtonModal(false)}
              >
                Cancel
              </button>
              <button
                className="modal-btn modal-btn-confirm"
                onClick={() => {
                  const newConfig = { name: editButtonName || 'Quick Action', command: editButtonCommand };
                  setCustomButton(newConfig);
                  localStorage.setItem(CUSTOM_BUTTON_KEY, JSON.stringify(newConfig));
                  setEditButtonModal(false);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileBrowser;
