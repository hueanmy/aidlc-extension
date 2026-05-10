import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceShell } from '../components/WorkspaceShell';
import { useHostState } from '../hooks/useHostState';
import { useThemeBridge } from '../hooks/useThemeBridge';
import type { WorkspaceState } from '../lib/types';
import '../styles.css';

function App() {
  useThemeBridge();
  const state = useHostState<WorkspaceState>();
  return <WorkspaceShell state={state} />;
}

const root = document.getElementById('app');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
