import React, { useState, useCallback } from 'react';

interface MobileKeybarProps {
  onKey: (key: string) => void;
}

const MobileKeybar: React.FC<MobileKeybarProps> = ({ onKey }) => {
  const [ctrlActive, setCtrlActive] = useState(false);

  const sendKey = useCallback((key: string) => {
    if (ctrlActive) {
      // Convert to control character
      if (key.length === 1 && key >= 'a' && key <= 'z') {
        const ctrlCode = key.charCodeAt(0) - 96; // a=1, b=2, etc.
        onKey(String.fromCharCode(ctrlCode));
      } else if (key === 'c') {
        onKey('\x03'); // Ctrl+C
      } else if (key === 'd') {
        onKey('\x04'); // Ctrl+D
      } else if (key === 'z') {
        onKey('\x1a'); // Ctrl+Z
      } else if (key === 'l') {
        onKey('\x0c'); // Ctrl+L (clear)
      } else if (key === 'a') {
        onKey('\x01'); // Ctrl+A (beginning of line)
      } else if (key === 'e') {
        onKey('\x05'); // Ctrl+E (end of line)
      }
      setCtrlActive(false);
    } else {
      onKey(key);
    }
  }, [onKey, ctrlActive]);

  const toggleCtrl = useCallback(() => {
    setCtrlActive(prev => !prev);
  }, []);

  return (
    <div className="mobile-keybar">
      {/* Escape */}
      <button className="keybar-btn" onClick={() => sendKey('\x1b')}>
        Esc
      </button>

      {/* Tab */}
      <button className="keybar-btn" onClick={() => sendKey('\t')}>
        Tab
      </button>

      {/* Ctrl modifier */}
      <button
        className={`keybar-btn modifier ${ctrlActive ? 'active' : ''}`}
        onClick={toggleCtrl}
      >
        Ctrl
      </button>

      <div className="keybar-spacer" />

      {/* Common Ctrl combinations */}
      <button className="keybar-btn keybar-btn-cancel" onClick={() => onKey('\x03')}>
        <span className="keybar-cancel-icon">✕</span>^C
      </button>

      <button className="keybar-btn" onClick={() => onKey('\x04')}>
        ^D
      </button>

      <div className="keybar-spacer" />

      {/* Arrow keys */}
      <button className="keybar-btn" onClick={() => sendKey('\x1b[A')}>
        ↑
      </button>

      <button className="keybar-btn" onClick={() => sendKey('\x1b[B')}>
        ↓
      </button>

      <button className="keybar-btn" onClick={() => sendKey('\x1b[D')}>
        ←
      </button>

      <button className="keybar-btn" onClick={() => sendKey('\x1b[C')}>
        →
      </button>
    </div>
  );
};

export default MobileKeybar;
