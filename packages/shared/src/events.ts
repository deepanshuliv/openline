// Event types emitted by the agent worker. Core events are vertical-agnostic;
// domain events (appointment.*, insurance.*, refill.*) describe business
// outcomes the console renders as cards.
export const CallEventType = {
  CALL_STARTED: "call.started",
  AGENT_ENTERED: "agent.entered",
  USER_TRANSCRIPT_PARTIAL: "user.transcript.partial",
  USER_TRANSCRIPT_FINAL: "user.transcript.final",
  AGENT_SPEECH: "agent.speech",
  LLM_STARTED: "llm.started",
  TTS_STARTED: "tts.started",
  TOOL_STARTED: "tool.started",
  TOOL_COMPLETED: "tool.completed",
  TOOL_FAILED: "tool.failed",
  PHASE_CHANGED: "phase.changed",
  INTENT_DETECTED: "intent.detected",
  INTERRUPTION_DETECTED: "interruption.detected",
  SPEECH_CANCELLED: "speech.cancelled",
  LATENCY_TURN: "latency.turn",
  FILLER_PLAYED: "filler.played",
  CALL_NOTE: "call.note",

  PATIENT_VERIFIED: "patient.verified",
  APPOINTMENT_BOOKED: "appointment.booked",
  APPOINTMENT_RESCHEDULED: "appointment.rescheduled",
  APPOINTMENT_CANCELLED: "appointment.cancelled",
  INSURANCE_CHECKED: "insurance.checked",
  REFILL_REQUESTED: "refill.requested",

  TRANSFER_REQUESTED: "transfer.requested",
  TRANSFER_ACCEPTED: "transfer.accepted",
  TRANSFER_COMPLETED: "transfer.completed",
  TRANSFER_TIMED_OUT: "transfer.timed_out",

  CALL_ENDED: "call.ended",
  ERROR: "error",
} as const;

export type CallEventType = (typeof CallEventType)[keyof typeof CallEventType];

// A plain type, not a zod schema: nothing validates events at runtime, and a
// schema here would pull zod into every web page through lib/shared.ts.
export interface CallEventPayload {
  id?: string;
  callId: string;
  type: string;
  timestamp: string;
  phase?: string | null;
  agent?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown> | null;
}

export const CALL_EVENTS_CHANNEL_PREFIX = "call-events:";

// Global channel the staff console listens on for transfer requests.
export const HANDOFF_EVENTS_CHANNEL = "handoff-events";

// LiveKit participant identities are prefixed so the agent can tell staff from callers.
export const STAFF_IDENTITY_PREFIX = "staff-";
export const CALLER_IDENTITY_PREFIX = "caller-";
// Participant attribute the caller sets to "true" once they press OK on the
// connect dialog. The agent joins earlier but stays silent until then.
export const CALLER_READY_ATTRIBUTE = "caller.ready";
// Attribute the agent sets to "true" once its voice session is running, so the
// browser only tells the caller "Suzi is ready" when she really is.
export const AGENT_READY_ATTRIBUTE = "agent.ready";
