/**
 * Theme override manager.
 *
 * Owns the user's theme preference (`auto` | `light` | `dark`) and keeps
 * every open webview in sync. Webviews fall back to VS Code's body class
 * when the override is `auto`, so the manager only needs to push when the
 * user explicitly toggles.
 */

import * as vscode from 'vscode';

const THEME_PERSIST_KEY = 'aidlc.themeOverride';

export type ThemeMode = 'auto' | 'light' | 'dark';

/** Minimal interface for anything that can receive a `themeOverride` message. */
export interface ThemeBroadcastTarget {
  postMessage(message: unknown): Thenable<boolean>;
}

class ThemeManager {
  private context: vscode.ExtensionContext | null = null;
  private targets = new Set<ThemeBroadcastTarget>();

  init(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  /** Current override. Defaults to 'auto' when nothing is persisted. */
  get current(): ThemeMode {
    const raw = this.context?.globalState.get<string>(THEME_PERSIST_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'auto') { return raw; }
    return 'auto';
  }

  /** Persist + broadcast. No-op if mode is unchanged. */
  async set(mode: ThemeMode): Promise<void> {
    if (!this.context) { return; }
    if (this.current === mode) { return; }
    await this.context.globalState.update(THEME_PERSIST_KEY, mode);
    for (const t of this.targets) {
      try { void t.postMessage({ type: 'themeOverride', mode }); } catch { /* webview disposed */ }
    }
  }

  /**
   * Register a webview so future user toggles propagate to it. Caller is
   * responsible for unregistering when the webview is disposed.
   */
  register(target: ThemeBroadcastTarget): vscode.Disposable {
    this.targets.add(target);
    return new vscode.Disposable(() => { this.targets.delete(target); });
  }
}

/** Single shared instance — wired up in extension.ts activate(). */
export const themeManager = new ThemeManager();
