// Generic call lifecycle shared by every vertical. A vertical decides when to
// move between phases; the orchestrator only enforces that the move is legal.
export const CallPhase = {
  GREETING: "GREETING",
  IDENTIFYING: "IDENTIFYING",
  SERVING: "SERVING",
  TRANSFERRING: "TRANSFERRING",
  HANDED_OFF: "HANDED_OFF",
  COMPLETED: "COMPLETED",
} as const;

export type CallPhase = (typeof CallPhase)[keyof typeof CallPhase];

export const PHASE_TRANSITIONS: Record<CallPhase, CallPhase[]> = {
  GREETING: [CallPhase.IDENTIFYING, CallPhase.SERVING, CallPhase.TRANSFERRING, CallPhase.COMPLETED],
  IDENTIFYING: [CallPhase.SERVING, CallPhase.TRANSFERRING, CallPhase.COMPLETED],
  SERVING: [CallPhase.IDENTIFYING, CallPhase.TRANSFERRING, CallPhase.COMPLETED],
  // A transfer can time out or be declined, returning the caller to the agent.
  TRANSFERRING: [CallPhase.HANDED_OFF, CallPhase.SERVING, CallPhase.COMPLETED],
  HANDED_OFF: [CallPhase.COMPLETED],
  COMPLETED: [],
};

export function isTransitionAllowed(from: CallPhase, to: CallPhase): boolean {
  if (from === to) return true;
  return PHASE_TRANSITIONS[from]?.includes(to) ?? false;
}

export const TurnState = {
  LISTENING: "LISTENING",
  THINKING: "THINKING",
  SPEAKING: "SPEAKING",
  INTERRUPTED: "INTERRUPTED",
  ENDED: "ENDED",
} as const;

export type TurnState = (typeof TurnState)[keyof typeof TurnState];
