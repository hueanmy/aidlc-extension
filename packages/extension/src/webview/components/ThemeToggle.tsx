import { Monitor, Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemeBridge } from '@/hooks/useThemeBridge';
import type { ThemeMode } from '@/lib/types';

const options: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { mode: 'auto', label: 'Match VS Code', icon: <Monitor className="h-3 w-3" /> },
  { mode: 'light', label: 'Light', icon: <Sun className="h-3 w-3" /> },
  { mode: 'dark', label: 'Dark', icon: <Moon className="h-3 w-3" /> },
];

export function ThemeToggle() {
  const { mode, setMode } = useThemeBridge();
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-secondary/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.mode}
          type="button"
          onClick={() => setMode(o.mode)}
          title={o.label}
          aria-label={o.label}
          aria-pressed={mode === o.mode}
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded transition-colors',
            mode === o.mode
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
