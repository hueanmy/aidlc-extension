import { useEffect, useState } from 'react';
import { onHostMessage, postMessage } from '../lib/bridge';

/**
 * Subscribe to `{ type: 'state', state }` messages from the host.
 * Returns the latest state, seeded from `window.__AIDLC_INITIAL_STATE__`
 * if the host injected it before the React bundle loaded.
 */
export function useHostState<T>(): T | null {
  const seed = (typeof window !== 'undefined' && (window.__AIDLC_INITIAL_STATE__ as T)) || null;
  const [state, setState] = useState<T | null>(seed);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.type === 'state' && msg.state !== undefined) {
        setState(msg.state as T);
      }
    });
    // Tell the host we're ready in case it didn't push initial state via window.
    postMessage({ type: 'ready' });
    return off;
  }, []);

  return state;
}
