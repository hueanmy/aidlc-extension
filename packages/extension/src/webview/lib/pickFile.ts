/**
 * Webview-side wrapper for the host's `pickAndReadTextFile` helper.
 * Posts a `pickAndReadFile` request and awaits the matching reply by id.
 */
import { postMessage, onHostMessage } from './bridge';

export interface PickFileResult {
  content: string;
  fileName: string;
  byteLength: number;
}

let counter = 0;
function nextRequestId(): string {
  counter += 1;
  return `pf-${Date.now().toString(36)}-${counter}`;
}

export function pickAndReadFile(): Promise<PickFileResult | null> {
  // null = user cancelled the dialog. Errors throw.
  return new Promise((resolve, reject) => {
    const requestId = nextRequestId();
    const off = onHostMessage((msg) => {
      if (msg.type !== 'pickAndReadFile:reply' || msg.requestId !== requestId) { return; }
      off();
      if (msg.cancelled) { resolve(null); return; }
      if (typeof msg.error === 'string' && msg.error) {
        reject(new Error(msg.error));
        return;
      }
      if (typeof msg.content !== 'string') {
        reject(new Error('No file content returned'));
        return;
      }
      resolve({
        content: msg.content,
        fileName: typeof msg.fileName === 'string' ? msg.fileName : '',
        byteLength: typeof msg.byteLength === 'number' ? msg.byteLength : msg.content.length,
      });
    });
    postMessage({ type: 'pickAndReadFile', requestId });
  });
}
