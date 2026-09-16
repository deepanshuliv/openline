/**
 * Explicit call state machine (CLAUDE.md §28).
 *
 * The LLM may *propose* a phase change (e.g. "I have enough info to qualify
 * this caller"), but only CallOrchestrator may actually apply one, and only
 * along an edge listed in PHASE_TRANSITIONS. This keeps the phase machine
 * deterministic even though the reasoning that suggests transitions is not.
 */
export const CallPhase = {
  GREETING: "GREETING",
  TRIAGE: "TRIAGE",
  INTAKE: "INTAKE",
  QUALIFICATION: "QUALIFICATION",
  SCHEDULING: "SCHEDULING",
  CONFIRMATION: "CONFIRMATION",
  COMPLETED: "COMPLETED",
  HANDOFF_HUMAN: "HANDOFF_HUMAN",
  ERROR_RECOVERY: "ERROR_RECOVERY",
} as const;

export type CallPhase = (typeof CallPhase)[keyof typeof CallPhase];

/** Allowed phase -> phase edges. Anything not listed here is rejected. */
export const PHASE_TRANSITIONS: Record<CallPhase, CallPhase[]> = {
  GREETING: [CallPhase.TRIAGE, CallPhase.ERROR_RECOVERY],
  TRIAGE: [CallPhase.INTAKE, CallPhase.HANDOFF_HUMAN, CallPhase.COMPLETED, CallPhase.ERROR_RECOVERY],
  INTAKE: [CallPhase.QUALIFICATION, CallPhase.HANDOFF_HUMAN, CallPhase.COMPLETED, CallPhase.ERROR_RECOVERY],
  QUALIFICATION: [CallPhase.SCHEDULING, CallPhase.INTAKE, CallPhase.HANDOFF_HUMAN, CallPhase.COMPLETED, CallPhase.ERROR_RECOVERY],
  SCHEDULING: [CallPhase.CONFIRMATION, CallPhase.INTAKE, CallPhase.HANDOFF_HUMAN, CallPhase.ERROR_RECOVERY],
  CONFIRMATION: [CallPhase.COMPLETED, CallPhase.ERROR_RECOVERY],
  COMPLETED: [],
  HANDOFF_HUMAN: [],
  ERROR_RECOVERY: [CallPhase.TRIAGE, CallPhase.INTAKE, CallPhase.COMPLETED],
};

export function isTransitionAllowed(from: CallPhase, to: CallPhase): boolean {
  if (from === to) return true;
  return PHASE_TRANSITIONS[from]?.includes(to) ?? false;
}

export const AgentName = {
  TRIAGE: "TRIAGE",
  INTAKE: "INTAKE",
  QUALIFICATION: "QUALIFICATION",
  SCHEDULING: "SCHEDULING",
} as const;

export type AgentName = (typeof AgentName)[keyof typeof AgentName];

/** Voice-turn state (CLAUDE.md §17) — kept separate from the business CallPhase. */
export const TurnState = {
  LISTENING: "LISTENING",
  THINKING: "THINKING",
  SPEAKING: "SPEAKING",
  INTERRUPTED: "INTERRUPTED",
  TOOL_EXECUTING: "TOOL_EXECUTING",
  ENDED: "ENDED",
} as const;

export type TurnState = (typeof TurnState)[keyof typeof TurnState];
