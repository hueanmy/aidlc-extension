export {
  EpicScanner,
  type PhaseStatusValue,
  type PhaseReview,
  type PhaseStatus,
  type EpicStatus,
} from './epicScanner';

export {
  ensureEpicsBootstrap,
  getArtifactTemplate,
  type BootstrapResult,
} from './epicBootstrapper';

export { migrateEpics } from './epicMigrator';

export { PHASE_ORDER, PHASE_ID_SET, REJECT_TO, type PhaseId } from './phases';

export { atomicWrite } from './atomicWrite';

export {
  appendEvent,
  readEvents,
  readEventsSince,
  eventLogPath,
  type AidlcEvent,
  type EventActor,
} from './eventLog';

export {
  approvePhase,
  rejectPhase,
  setPhaseStatus,
  phaseStatusPath,
  readPhaseStatus,
  type ApproveOptions,
  type RejectOptions,
  type SetPhaseStatusOptions,
} from './reviewEngine';

export {
  ensureMcpConfig,
  createEpicFolder,
  type McpConfigInput,
  type McpConfigResult,
} from './mcpConfig';
