import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { WorkspaceState, WorkspaceView } from '@/lib/types';
import { BuilderView } from './BuilderView';
import { EpicsView } from './EpicsView';
import { ThemeToggle } from './ThemeToggle';
import { onHostMessage, postMessage } from '@/lib/bridge';

export function WorkspaceShell({ state }: { state: WorkspaceState | null }) {
  const initial = state?.initialView ?? 'builder';
  const [view, setView] = useState<WorkspaceView>(initial);

  // Host can switch the view at runtime via openBuilder/openEpicsList.
  useEffect(() => {
    return onHostMessage((msg) => {
      if (msg.type !== 'setView') { return; }
      const next = msg.view;
      if (next === 'builder' || next === 'epics') { setView(next); }
    });
  }, []);

  // Keep view in sync if the initialView changes between state pushes.
  useEffect(() => {
    if (state?.initialView && state.initialView !== view) {
      setView(state.initialView);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.initialView]);

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!state.hasFolder || !state.configExists) {
    return (
      <div className="flex h-full flex-col">
        <TopBar view={view} onView={setView} workspaceName={state.workspaceName} />
        <div className="p-6">
          <div className="rounded-md border border-dashed border-border bg-surface/50 p-6 text-center">
            <h2 className="text-sm font-bold text-foreground">
              {state.hasFolder ? 'No workspace.yaml' : 'No project open'}
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              {state.hasFolder
                ? 'Initialize a workspace or load the demo project to start building.'
                : 'Open a folder in VS Code to get started.'}
            </p>
            <div className="mt-4 inline-flex flex-wrap justify-center gap-2">
              {!state.hasFolder && (
                <button
                  type="button"
                  onClick={() => postMessage({ type: 'openProject' })}
                  className="rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Open Project
                </button>
              )}
              {state.hasFolder && (
                <>
                  <button
                    type="button"
                    onClick={() => postMessage({ type: 'init' })}
                    className="rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Init Workspace
                  </button>
                  <button
                    type="button"
                    onClick={() => postMessage({ type: 'loadDemoProject' })}
                    className="rounded-md border border-border bg-card px-3.5 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    Load Demo Project
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar view={view} onView={setView} workspaceName={state.workspaceName} />
      <main className="flex-1 overflow-y-auto">
        <div className="p-6">
          {view === 'builder' ? <BuilderView state={state} /> : <EpicsView state={state} />}
        </div>
      </main>
    </div>
  );
}

function TopBar({
  view,
  onView,
  workspaceName,
}: {
  view: WorkspaceView;
  onView: (v: WorkspaceView) => void;
  workspaceName: string;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/80 px-6 py-2.5 backdrop-blur-sm">
      <PillButton active={view === 'builder'} onClick={() => onView('builder')}>
        Builder
      </PillButton>
      <PillButton active={view === 'epics'} onClick={() => onView('epics')}>
        Epics
      </PillButton>
      <div className="ml-auto flex items-center gap-2">
        {workspaceName && (
          <span className="rounded-md bg-secondary px-2.5 py-1 font-mono text-[10px] font-medium text-muted-foreground">
            PROJECT {workspaceName}
          </span>
        )}
        <ThemeToggle />
      </div>
    </div>
  );
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
