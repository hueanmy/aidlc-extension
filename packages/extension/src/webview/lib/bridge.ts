import type { VsCodeApi } from './types';

let api: VsCodeApi | null = null;

function ensure(): VsCodeApi | null {
  if (api) { return api; }
  if (typeof window === 'undefined' || !window.acquireVsCodeApi) { return null; }
  api = window.acquireVsCodeApi();
  return api;
}

export function postMessage<T extends Record<string, unknown>>(message: T): void {
  ensure()?.postMessage(message);
}

export function getPersistedUi<T>(): T | undefined {
  return ensure()?.getState<T>();
}

export function setPersistedUi<T>(state: T): void {
  ensure()?.setState(state);
}

export function onHostMessage(
  handler: (msg: { type: string; [key: string]: unknown }) => void,
): () => void {
  if (typeof window === 'undefined') { return () => {}; }
  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: unknown };
    if (data && typeof data.type === 'string') {
      handler(data as { type: string; [key: string]: unknown });
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
