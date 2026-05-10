import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppSidebar } from '../components/AppSidebar';
import { useHostState } from '../hooks/useHostState';
import { useThemeBridge } from '../hooks/useThemeBridge';
import type { SidebarState } from '../lib/types';
import '../styles.css';

function App() {
  // useThemeBridge has a side effect (applying .dark) — call before reading state.
  useThemeBridge();
  const state = useHostState<SidebarState>();
  return <AppSidebar state={state} />;
}

const root = document.getElementById('app');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
