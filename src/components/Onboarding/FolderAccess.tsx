import { useState, useCallback } from 'react';
import { OnboardingButton } from './OnboardingButton';
import { core } from '@tauri-apps/api';

const API_BASE = '';

interface FolderAccessProps {
  accessibleFolders: string[];
  onFoldersUpdate: (folders: string[]) => void;
  onNext: () => void;
  onBack: () => void;
}

interface FolderItem {
  name: string;
  path: string;
  description: string;
}

const FOLDERS: FolderItem[] = [
  { name: 'Home', path: '~', description: 'Your home directory' },
  { name: 'Desktop', path: '~/Desktop', description: 'Quick access to desktop files' },
  { name: 'Downloads', path: '~/Downloads', description: 'Downloaded files' },
  { name: 'Documents', path: '~/Documents', description: 'Your documents' },
  { name: 'Projects', path: '~/Projects', description: 'Development projects' },
];

export function FolderAccess({
  accessibleFolders,
  onFoldersUpdate,
  onNext,
  onBack,
}: FolderAccessProps) {
  const [selectedFolders, setSelectedFolders] = useState<string[]>(
    accessibleFolders.length > 0 ? accessibleFolders : FOLDERS.map((f) => f.path)
  );
  const [isGranting, setIsGranting] = useState(false);
  const [grantedFolders, setGrantedFolders] = useState<string[]>([]);
  const [homeAccessGranted, setHomeAccessGranted] = useState(false);
  const isTauri = !!window.__TAURI__;

  const toggleFolder = useCallback((path: string) => {
    if (homeAccessGranted) return;
    setSelectedFolders((prev) =>
      prev.includes(path)
        ? prev.filter((p) => p !== path)
        : [...prev, path]
    );
  }, [homeAccessGranted]);

  const handleGrantHomeAccess = useCallback(async () => {
    setIsGranting(true);
    try {
      console.log('Requesting home directory access');
      const grantedPath = await core.invoke('request_folder_access', { path: '~' });
      
      if (grantedPath) {
        console.log('Home access granted:', grantedPath);
        setHomeAccessGranted(true);
        const homeFavs = ['~'];
        onFoldersUpdate(homeFavs);
        setGrantedFolders(FOLDERS.map(f => f.path));
        localStorage.setItem('mobile_terminal_favorites', JSON.stringify(homeFavs));
      } else {
        console.warn('Home access denied or cancelled');
      }
    } catch (err) {
      console.error('Error requesting home access:', err);
    } finally {
      setIsGranting(false);
    }
  }, [onFoldersUpdate]);

  const grantAccess = useCallback(async () => {
    setIsGranting(true);
    const granted: string[] = [];

    for (const folderPath of selectedFolders) {
      if (isTauri) {
        try {
          console.log(`Requesting access for: ${folderPath}`);
          const grantedPath = await core.invoke('request_folder_access', { path: folderPath });
          
          if (grantedPath) {
            console.log(`Access granted for: ${grantedPath}`);
            granted.push(folderPath);
            setGrantedFolders([...granted]);
          } else {
            console.warn(`Access denied or cancelled for: ${folderPath}`);
          }
        } catch (err) {
          console.error(`Error requesting folder access for ${folderPath}:`, err);
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 300));
        granted.push(folderPath);
        setGrantedFolders([...granted]);
      }
    }

    localStorage.setItem('mobile_terminal_favorites', JSON.stringify(granted));

    try {
      await fetch(`${API_BASE}/api/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ favorites: granted }),
      });
    } catch (err) {
      console.error('Failed to sync favorites to server:', err);
    }

    onFoldersUpdate(granted);
    setIsGranting(false);
  }, [selectedFolders, onFoldersUpdate, isTauri, homeAccessGranted]);

  const allGranted = homeAccessGranted || (grantedFolders.length === selectedFolders.length && selectedFolders.length > 0);


  return (
    <div className="onboarding-screen folder-access-screen">
      <h1 className="screen-title">Set Up Your Folders</h1>
      <p className="screen-subtitle">
        Choose which folders appear in your file browser favorites.
        <br />
        These will be your quick-access shortcuts.
      </p>

      {!homeAccessGranted && (
        <button
          className="grant-home-btn"
          onClick={handleGrantHomeAccess}
          disabled={isGranting}
        >
          {isGranting ? 'Granting Access...' : '📂 Grant Full Access to Home Directory'}
        </button>
      )}

      {homeAccessGranted && (
        <div className="home-granted-message">
          ✓ Full access to home directory granted
        </div>
      )}

      <div className={`folder-list ${homeAccessGranted ? 'disabled' : ''}`}>
        {FOLDERS.map((folder) => {
          const isSelected = selectedFolders.includes(folder.path);
          const isGranted = grantedFolders.includes(folder.path);

          return (
            <button
              key={folder.path}
              className={`folder-item ${isSelected ? 'selected' : ''} ${isGranted ? 'granted' : ''}`}
              onClick={() => !isGranting && toggleFolder(folder.path)}
              disabled={isGranting}
            >
              <div className="folder-checkbox">
                {isGranted ? (
                  <span className="check-icon">✓</span>
                ) : isSelected ? (
                  <span className="check-box checked" />
                ) : (
                  <span className="check-box" />
                )}
              </div>
              <div className="folder-info">
                <span className="folder-name">{folder.name}</span>
                <span className="folder-path">{folder.path}</span>
              </div>
              {isGranted && <span className="granted-badge">Added</span>}
            </button>
          );
        })}
      </div>

      {!allGranted && (
        <OnboardingButton
          onClick={grantAccess}
          variant="primary"
          disabled={isGranting || selectedFolders.length === 0}
        >
          {isGranting ? 'Adding Folders...' : 'Add to Favorites'}
        </OnboardingButton>
      )}

      <p className="folder-note">
        You can change these later in Settings or file browser.
      </p>

      <div className="button-row">
        <OnboardingButton onClick={onBack} variant="ghost" disabled={isGranting}>
          Back
        </OnboardingButton>
        <OnboardingButton
          onClick={onNext}
          variant={allGranted ? 'primary' : 'secondary'}
          disabled={isGranting}
        >
          {allGranted ? 'Continue' : 'Skip'}
        </OnboardingButton>
      </div>
    </div>
  );
}
