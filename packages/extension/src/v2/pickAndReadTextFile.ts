/**
 * Open a native file picker, read the chosen file as UTF-8 text, and return
 * the contents to the webview that asked. Used by StartEpicModal /
 * RunWithFeedbackModal so the user can drop a PRD / spec straight into a
 * text field instead of pasting hundreds of lines manually.
 *
 * Caps the file size at 512KB — large requirement docs are unusual and
 * we don't want to balloon `state.json` (the description is snapshotted
 * into epic state at submit time).
 */
import * as vscode from 'vscode';

const MAX_BYTES = 512 * 1024;

export interface PickAndReadReply {
  requestId: string;
  content?: string;
  fileName?: string;
  /** Bytes read — webview shows it next to the filename for confidence. */
  byteLength?: number;
  error?: string;
  /** True when the user dismissed the dialog — the webview suppresses the
   * error toast in that case. */
  cancelled?: boolean;
}

export async function pickAndReadTextFile(requestId: string): Promise<PickAndReadReply> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: false,
    canSelectFiles: true,
    canSelectMany: false,
    openLabel: 'Load',
    filters: {
      'Text / Markdown': ['md', 'markdown', 'txt', 'rst', 'adoc'],
      'All files': ['*'],
    },
  });
  if (!picked || picked.length === 0) {
    return { requestId, cancelled: true };
  }
  const uri = picked[0];
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_BYTES) {
      return {
        requestId,
        error: `File is ${formatBytes(stat.size)} — limit is ${formatBytes(MAX_BYTES)}.`,
      };
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const fileName = uri.path.split('/').pop() ?? uri.fsPath;
    return { requestId, content, fileName, byteLength: bytes.byteLength };
  } catch (err) {
    return { requestId, error: err instanceof Error ? err.message : String(err) };
  }
}

function formatBytes(n: number): string {
  if (n < 1024) { return `${n} B`; }
  if (n < 1024 * 1024) { return `${(n / 1024).toFixed(1)} KB`; }
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
