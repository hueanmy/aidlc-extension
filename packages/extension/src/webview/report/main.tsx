import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TokenReportView } from '../components/TokenReportView';
import { useHostState } from '../hooks/useHostState';
import { useThemeBridge } from '../hooks/useThemeBridge';
import type { TokenReportPanelState } from '../lib/types';
import '../styles.css';

function App() {
  useThemeBridge();
  const state = useHostState<TokenReportPanelState>();
  return <TokenReportView state={state} />;
}

const root = document.getElementById('app');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
