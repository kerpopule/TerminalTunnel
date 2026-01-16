import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useSocket } from '../hooks/useSocket';
import { core } from '@tauri-apps/api';

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

// Map of ~ paths to display names
const FAVORITE_DISPLAY_NAMES: Record<string, string> = {
  '~': 'Home',
  '~/Desktop': 'Desktop',
  '~/Downloads': 'Downloads',
  '~/Documents': 'Documents',
  '~/Projects': 'Projects',
};

interface FileBrowserProps {
  onNavigate?: (path: string, isDirectory: boolean) => void;
  onRunCustomCommand?: (path: string, command: string) => void;
}

const FAVORITES_KEY = 'mobile_terminal_favorites';
const VIEW_MODE_KEY = 'mobile_terminal_view_mode';
const CUSTOM_BUTTON_KEY = 'mobile_terminal_custom_button';
const LAST_PATH_KEY = 'mobile_terminal_last_path'; // sessionStorage - persists during session only

const API_BASE = '';

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
  const { socket } = useSocket();
  const [currentPath, setCurrentPath] = useState<string>('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [homePath, setHomePath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionRequestPath, setPermissionRequestPath] = useState<string | null>(null);
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
  const [renameModal, setRenameModal] = useState<{ entry: FileEntry; name: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<FileEntry | null>(null);
  const [emptyAreaMenu, setEmptyAreaMenu] = useState<{ x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const isTauri = !!window.__TAURI__;

  // Persist view mode
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  // Sync favorites via socket - server is source of truth for desktop/mobile sync
  useEffect(() => {
    if (!socket) return;

    // Request favorites from server on connect
    const handleConnect = () => {
      console.log('[FavoritesSync] Socket connected, requesting favorites');
      socket.emit('favorites:request');
    };

    // Listen for favorites sync from server (including from other clients)
    // Server is source of truth - always update local from server
    const handleFavoritesSync = (data: { favorites: string[]; lastModified: number }) => {
      console.log('[FavoritesSync] Received favorites:', data.favorites);
      setFavorites(data.favorites);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(data.favorites));
    };

    socket.on('connect', handleConnect);
    socket.on('favorites:sync', handleFavoritesSync);

    // If already connected, request state immediately
    if (socket.connected) {
      socket.emit('favorites:request');
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('favorites:sync', handleFavoritesSync);
    };
  }, [socket]);

  // Load home path from shortcuts API
  useEffect(() => {
    fetch(`${API_BASE}/api/files/shortcuts`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        // Find the Home shortcut to get the actual home path
        const homeShortcut = data.shortcuts?.find((s: Shortcut) => s.name === 'Home');
        if (homeShortcut) {
          setHomePath(homeShortcut.path);
        }
      })
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
        const errorMessage = data.error || 'Failed to load directory';
        // Check for specific permission error to show grant access dialog
        if (isTauri && (errorMessage.includes('EACCES') || errorMessage.includes('Permission denied'))) {
          setPermissionRequestPath(path);
          setError(errorMessage);
          setLoading(false);
          return;
        }
        throw new Error(errorMessage);
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
  }, [isTauri]);

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

  const handleGrantAccess = async () => {
    if (!permissionRequestPath) return;

    try {
      const grantedPath = await core.invoke('request_folder_access', { path: permissionRequestPath });
      if (grantedPath) {
        // Access was granted, retry loading the directory
        setPermissionRequestPath(null);
        setError(null);
        loadDirectory(permissionRequestPath);
      } else {
        // User cancelled, do nothing, leave modal open
      }
    } catch (err) {
      console.error('Error during folder access request:', err);
      setError('An error occurred while requesting folder access.');
    }
  };


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

  // Close all popups/menus - ensures only one is open at a time
  const closeAllMenus = () => {
    setContextMenu(null);
    setFavoriteContextMenu(null);
    setEmptyAreaMenu(null);
    setPlusMenuOpen(false);
  };

  // Long press for context menu
  const handleLongPress = (e: React.TouchEvent | React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    closeAllMenus();
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
    // Sync to server for other clients
    console.log('[FavoritesSync] Emitting update:', newFavorites);
    socket?.emit('favorites:update', newFavorites);
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

  // Rename file or folder
  const handleRename = async () => {
    if (!renameModal || !renameModal.name.trim()) return;

    try {
      const res = await fetch(`${API_BASE}/api/files/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldPath: renameModal.entry.path,
          newName: renameModal.name
        }),
        credentials: 'include'
      });

      if (res.ok) {
        loadDirectory(currentPath);
        setRenameModal(null);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to rename');
      }
    } catch (err) {
      console.error('Failed to rename:', err);
    }
  };

  // Delete file or folder
  const handleDelete = async (entry: FileEntry) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/files/delete?path=${encodeURIComponent(entry.path)}`,
        { method: 'DELETE', credentials: 'include' }
      );

      if (res.ok) {
        loadDirectory(currentPath);
        setDeleteConfirm(null);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete');
      }
    } catch (err) {
      console.error('Failed to delete:', err);
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
    // Sync to server for other clients
    socket?.emit('favorites:update', newFavorites);
    setFavoriteContextMenu(null);
  };

  // Get favorite display name from path
  const getFavoriteName = (path: string): string => {
    // Check for known ~ paths first
    if (FAVORITE_DISPLAY_NAMES[path]) {
      return FAVORITE_DISPLAY_NAMES[path];
    }
    // For other ~ paths, extract the folder name
    if (path.startsWith('~/')) {
      return path.slice(2).split('/').pop() || path;
    }
    // For absolute paths, return the last segment
    return path.split('/').pop() || path;
  };

  // Expand ~ path to actual path for navigation
  const expandPath = (path: string): string => {
    if (!homePath) return path;
    if (path === '~') return homePath;
    if (path.startsWith('~/')) {
      return homePath + path.slice(1);
    }
    return path;
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

  // Get file icon - returns JSX element for the file type
  const getFileIcon = (entry: FileEntry): React.ReactNode => {
    if (entry.isDirectory) return renderFolderIcon();

    const ext = entry.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
      case 'ts':
      case 'jsx':
      case 'tsx':
      case 'py':
      case 'rb':
      case 'go':
      case 'rs':
      case 'java':
      case 'c':
      case 'cpp':
      case 'h':
      case 'hpp':
      case 'swift':
      case 'kt':
      case 'sh':
        return <FileCodeIcon />;
      case 'json':
      case 'md':
      case 'txt':
      case 'yml':
      case 'yaml':
      case 'xml':
      case 'csv':
      case 'log':
        return <FileTextIcon />;
      case 'html':
      case 'css':
      case 'scss':
      case 'sass':
      case 'less':
        return <GlobeFileIcon />;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'webp':
      case 'svg':
      case 'bmp':
      case 'ico':
        return <ImageFileIcon />;
      case 'pdf':
        return <FileTextIcon />;
      case 'mp4':
      case 'mov':
      case 'avi':
      case 'mkv':
      case 'webm':
        return <VideoFileIcon />;
      case 'mp3':
      case 'wav':
      case 'aac':
      case 'm4a':
      case 'flac':
      case 'ogg':
        return <MusicFileIcon />;
      case 'zip':
      case 'tar':
      case 'gz':
      case 'rar':
      case '7z':
      case 'bz2':
        return <ArchiveFileIcon />;
      default:
        return <FileGenericIcon />;
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
      setEmptyAreaMenu(null);
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
          <div className="error-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M15 9l-6 6M9 9l6 6"/>
            </svg>
          </div>
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

  // File type icons (theme-aware using currentColor)
  const FileCodeIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <path d="M14 2v6h6M10 12l-2 2 2 2M14 12l2 2-2 2"/>
    </svg>
  );

  const FileTextIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
    </svg>
  );

  const FileGenericIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <path d="M14 2v6h6"/>
    </svg>
  );

  const ImageFileIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <path d="M21 15l-5-5L5 21"/>
    </svg>
  );

  const VideoFileIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="M10 9l5 3-5 3V9z"/>
    </svg>
  );

  const MusicFileIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13"/>
      <circle cx="6" cy="18" r="3"/>
      <circle cx="18" cy="16" r="3"/>
    </svg>
  );

  const ArchiveFileIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>
    </svg>
  );

  const GlobeFileIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>
    </svg>
  );

  // Back arrow icon for ".." entry
  const BackArrowIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  );

  // Action icons for context menus
  const StarIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
  );

  const ClipboardCopyIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1"/>
    </svg>
  );

  const TerminalMenuIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17l6-6-6-6M12 19h8"/>
    </svg>
  );

  const DownloadMenuIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
    </svg>
  );

  const UploadMenuIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
    </svg>
  );

  const FolderPlusMenuIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z"/>
      <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
    </svg>
  );

  const TrashMenuIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
  );

  const PencilMenuIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
    </svg>
  );

  const XCircleErrorIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M15 9l-6 6M9 9l6 6"/>
    </svg>
  );

  return (
    <div className="file-browser">
      {/* Header */}
      <div className="file-header">
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
                if (!plusMenuOpen) {
                  closeAllMenus();
                }
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
                  <span className="context-menu-icon"><FolderPlusMenuIcon /></span>
                  New Folder
                </div>
                <div
                  className="context-menu-item"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setPlusMenuOpen(false);
                  }}
                >
                  <span className="context-menu-icon"><UploadMenuIcon /></span>
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

      {/* Favorites bar */}
      <div className="shortcuts-bar">
        {favorites.map(favPath => (
          <button
            key={favPath}
            className="shortcut-btn"
            onClick={() => loadDirectory(expandPath(favPath))}
            onContextMenu={(e) => {
              e.preventDefault();
              closeAllMenus();
              const { x, y } = adjustMenuPosition(e.clientX, e.clientY, 180, 100);
              setFavoriteContextMenu({ x, y, path: favPath });
            }}
            onTouchStart={(e) => {
              const timer = setTimeout(() => {
                closeAllMenus();
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
        <button
          className="shortcut-btn add-favorite-btn"
          onClick={() => {
            if (currentPath && !favorites.includes(currentPath)) {
              const newFavorites = [...favorites, currentPath];
              setFavorites(newFavorites);
              localStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));
            }
          }}
          title="Add current folder to favorites"
        >
          +
        </button>
      </div>

      {/* File list */}
      <div
        className={`file-list ${viewMode === 'icon' ? 'file-list-icons' : ''}`}
        style={{ fontFamily }}
        onTouchStart={(e) => {
          // Only trigger if touching the container itself, not children
          if (e.target === e.currentTarget) {
            const timer = setTimeout(() => {
              closeAllMenus();
              const touch = e.touches[0];
              const { x, y } = adjustMenuPosition(touch.clientX, touch.clientY, 180, 120);
              setEmptyAreaMenu({ x, y });
            }, 500);
            const cleanup = () => clearTimeout(timer);
            e.currentTarget.addEventListener('touchend', cleanup, { once: true });
            e.currentTarget.addEventListener('touchmove', cleanup, { once: true });
          }
        }}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            closeAllMenus();
            const { x, y } = adjustMenuPosition(e.clientX, e.clientY, 180, 120);
            setEmptyAreaMenu({ x, y });
          }
        }}
      >
        {/* Parent directory (..) entry */}
        {currentPath && currentPath !== '/' && (
          <div
            className={`file-item file-item-parent ${viewMode === 'icon' ? 'file-item-icon' : ''}`}
            onClick={handleGoUp}
          >
            <div className={`file-icon file-icon-back ${viewMode === 'icon' ? 'file-icon-large' : ''}`}>
              <BackArrowIcon />
            </div>
            <div className="file-info">
              <div className="file-name">..</div>
              {viewMode === 'list' && (
                <div className="file-meta">Parent folder</div>
              )}
            </div>
          </div>
        )}
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
              {getFileIcon(entry)}
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
            closeAllMenus();
            setEditButtonName(customButton.name);
            setEditButtonCommand(customButton.command);
            setEditButtonModal(true);
          }}
          onTouchStart={(e) => {
            const timer = setTimeout(() => {
              closeAllMenus();
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
            <span className="context-menu-icon"><StarIcon /></span>
            {favorites.includes(contextMenu.entry.path) ? 'Remove Favorite' : 'Add Favorite'}
          </div>
          <div
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              const pathToCopy = contextMenu.entry.path;
              copyPath(pathToCopy);
            }}
          >
            <span className="context-menu-icon"><ClipboardCopyIcon /></span>
            Copy Path
          </div>
          {contextMenu.entry.isDirectory && (
            <div
              className="context-menu-item"
              onClick={() => {
                onRunCustomCommand?.(contextMenu.entry.path, '');
                setContextMenu(null);
              }}
            >
              <span className="context-menu-icon"><TerminalMenuIcon /></span>
              Open in Terminal
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
              <span className="context-menu-icon"><DownloadMenuIcon /></span>
              Download
            </div>
          )}
          <div
            className="context-menu-item"
            onClick={() => {
              setRenameModal({ entry: contextMenu.entry, name: contextMenu.entry.name });
              setContextMenu(null);
            }}
          >
            <span className="context-menu-icon"><PencilMenuIcon /></span>
            Rename
          </div>
          <div
            className="context-menu-item danger"
            onClick={() => {
              setDeleteConfirm(contextMenu.entry);
              setContextMenu(null);
            }}
          >
            <span className="context-menu-icon"><TrashMenuIcon /></span>
            Delete
          </div>
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
            <span className="context-menu-icon"><ClipboardCopyIcon /></span>
            Copy Path
          </div>
          <div
            className="context-menu-item danger"
            onClick={() => removeFromFavorites(favoriteContextMenu.path)}
          >
            <span className="context-menu-icon"><StarIcon /></span>
            Remove Favorite
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

      {/* Rename modal */}
      {renameModal && (
        <div className="modal-overlay" onClick={() => setRenameModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Rename</div>
            <input
              type="text"
              className="modal-input"
              value={renameModal.name}
              onChange={(e) => setRenameModal({ ...renameModal, name: e.target.value })}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            />
            <div className="modal-actions">
              <button className="modal-btn modal-btn-cancel" onClick={() => setRenameModal(null)}>
                Cancel
              </button>
              <button className="modal-btn modal-btn-confirm" onClick={handleRename}>
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Delete {deleteConfirm.isDirectory ? 'Folder' : 'File'}</div>
            <div className="modal-message">
              Are you sure you want to delete "{deleteConfirm.name}"?
              {deleteConfirm.isDirectory && ' This will delete all contents.'}
            </div>
            <div className="modal-actions">
              <button className="modal-btn modal-btn-cancel" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button className="modal-btn modal-btn-danger" onClick={() => handleDelete(deleteConfirm)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty area context menu */}
      {emptyAreaMenu && (
        <div
          className="context-menu"
          style={{ top: emptyAreaMenu.y, left: emptyAreaMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="context-menu-item"
            onClick={() => {
              setNewFolderModal(true);
              setEmptyAreaMenu(null);
            }}
          >
            <span className="context-menu-icon"><FolderPlusMenuIcon /></span>
            New Folder
          </div>
          <div
            className="context-menu-item"
            onClick={() => {
              fileInputRef.current?.click();
                          setEmptyAreaMenu(null);
                        }}
                      >
                        <span className="context-menu-icon"><UploadMenuIcon /></span>
                        Upload Files
                      </div>
                    </div>
                  )}
              
                  {/* Permission request modal */}
                  {permissionRequestPath && (
                    <div className="modal-overlay" onClick={() => setPermissionRequestPath(null)}>
                      <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-title">Folder Access Required</div>
                        <div className="modal-message">
                          This app needs your permission to access the folder:
                          <br />
                          <strong>{permissionRequestPath}</strong>
                          <br />
                          <br />
                          Please grant access to continue.
                        </div>
                        <div className="modal-actions">
                          <button
                            className="modal-btn modal-btn-cancel"
                            onClick={() => {
                              setPermissionRequestPath(null);
                              setError(null); // Clear error when cancelling
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            className="modal-btn modal-btn-confirm"
                            onClick={handleGrantAccess}
                          >
                            Grant Access
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );};

export default FileBrowser;
