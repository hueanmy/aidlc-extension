import type { StepStatus, RunStatus, UiStatus } from './types';

/** Map a core StepStatus to the StatusBadge UiStatus. */
export function mapStepStatus(status: StepStatus | string): UiStatus {
  switch (status) {
    case 'awaiting_work':
      return 'awaiting_work';
    case 'awaiting_auto_review':
    case 'awaiting_review':
      return 'awaiting_review';
    case 'approved':
      return 'done';
    case 'rejected':
      return 'rejected';
    case 'pending':
    default:
      return 'pending';
  }
}

/** Map a core RunStatus to the StatusBadge UiStatus. */
export function mapRunStatus(status: RunStatus | string): UiStatus {
  switch (status) {
    case 'running':
      return 'in_progress';
    case 'completed':
      return 'done';
    case 'failed':
      return 'rejected';
    default:
      return 'pending';
  }
}
