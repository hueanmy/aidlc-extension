import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StepperStep {
  name: string;
  status: 'done' | 'active' | 'pending';
}

export function PipelineStepper({ steps }: { steps: StepperStep[] }) {
  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => (
        <div key={`${step.name}-${i}`} className="flex items-center">
          {i > 0 && (
            <div
              className={cn(
                'h-0.5 w-10',
                step.status === 'done' || steps[i - 1].status === 'done'
                  ? 'bg-primary'
                  : 'bg-border',
              )}
            />
          )}
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-all',
                step.status === 'done' && 'bg-primary text-primary-foreground',
                step.status === 'active' &&
                  'bg-primary text-primary-foreground ring-4 ring-primary/20',
                step.status === 'pending' &&
                  'border-2 border-border bg-card text-muted-foreground',
              )}
            >
              {step.status === 'done' ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span
              className={cn(
                'max-w-[80px] truncate text-center text-[9px] font-medium uppercase tracking-wider',
                step.status === 'active' ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {step.name}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
