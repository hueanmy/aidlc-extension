import { useEffect, useState, useCallback } from 'react';
import type { ThemeMode } from '../lib/types';
import { onHostMessage, postMessage } from '../lib/bridge';

function detectVsCodeTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') { return 'light'; }
  const cls = document.body.className;
  if (cls.includes('vscode-dark') || cls.includes('vscode-high-contrast')) { return 'dark'; }
  return 'light';
}

function applyTheme(resolved: 'light' | 'dark'): void {
  if (typeof document === 'undefined') { return; }
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/**
 * Sync the host theme override + VS Code body class with our `.dark` toggle.
 *
 * - mode = 'auto' → follow VS Code body class via MutationObserver
 * - mode = 'light' | 'dark' → force apply, ignore VS Code
 * - host can broadcast a `themeOverride` message to update the mode at runtime
 */
export function useThemeBridge(): {
  mode: ThemeMode;
  setMode: (next: ThemeMode) => void;
} {
  const initial = (typeof window !== 'undefined' && window.__AIDLC_INITIAL_THEME__) || 'auto';
  const [mode, setModeState] = useState<ThemeMode>(initial);

  // Apply theme whenever mode changes, plus reapply on VS Code theme switch when mode === 'auto'.
  useEffect(() => {
    const resolve = (): 'light' | 'dark' => {
      if (mode === 'light') { return 'light'; }
      if (mode === 'dark') { return 'dark'; }
      return detectVsCodeTheme();
    };
    applyTheme(resolve());

    if (mode !== 'auto' || typeof document === 'undefined') { return; }
    const observer = new MutationObserver(() => applyTheme(resolve()));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [mode]);

  // Subscribe to host-broadcast theme overrides.
  useEffect(() => {
    return onHostMessage((msg) => {
      if (msg.type !== 'themeOverride') { return; }
      const next = msg.mode;
      if (next === 'auto' || next === 'light' || next === 'dark') {
        setModeState(next);
      }
    });
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    postMessage({ type: 'setTheme', mode: next });
  }, []);

  return { mode, setMode };
}
