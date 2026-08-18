import { z } from "zod";







export const CallEventType = {
  CALL_STARTED: "call.started",
  AGENT_ENTERED: "agent.entered",
  USER_SPEECH_STARTED: "user.speech.started",
  USER_TRANSCRIPT_PARTIAL: "user.transcript.partial",
  USER_TRANSCRIPT_FINAL: "user.transcript.final",
  AGENT_SPEECH: "agent.speech",
  CONTEXT_RETRIEVED: "context.retrieved",
  LLM_STARTED: "llm.started",
  LLM_FIRST_TOKEN: "llm.first_token",
  LLM_COMPLETED: "llm.completed",
  TOOL_STARTED: "tool.started",
  TOOL_COMPLETED: "tool.completed",
  TOOL_FAILED: "tool.failed",
  AGENT_HANDOFF: "agent.handoff",
  PHASE_CHANGED: "phase.changed",
  INTAKE_FIELDS_EXTRACTED: "intake.fields_extracted",
  CALL_NOTE: "call.note",
  INTERRUPTION_DETECTED: "interruption.detected",
  SPEECH_CANCELLED: "speech.cancelled",
  TTS_STARTED: "tts.started",
  FIRST_AUDIO: "first_audio",
  CALL_ENDED: "call.ended",
  ERROR: "error",
} as const;

export type CallEventType = (typeof CallEventType)[keyof typeof CallEventType];







export const callEventPayloadSchema = z.object({
  id: z.string().optional(),
  callId: z.string(),
  type: z.enum(Object.values(CallEventType) as [string, ...string[]]),
  timestamp: z.string(),
  phase: z.string().nullable().optional(),
  agent: z.string().nullable().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type CallEventPayload = z.infer<typeof callEventPayloadSchema>;

export const REDIS_CALL_EVENTS_STREAM = "call-events";

export const CALL_EVENTS_CHANNEL_PREFIX = "call-events:";
