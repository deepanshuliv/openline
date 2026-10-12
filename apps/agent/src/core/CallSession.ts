import type { Speaker } from "@repo/db";
import { CallEventType, CallPhase, TurnState, createLogger, isTransitionAllowed } from "@repo/shared";
import { CallLogService } from "./CallLogService.js";
import { EventService, type EmitOptions } from "./EventService.js";

const logger = createLogger("agent:call");

// Vertical-agnostic state and lifecycle for one call. Verticals read and write
// domain facts (patient, intents) through it; the core owns phase legality,
// persistence of transcript turns, and the single end-of-call path.
export class CallSession {
  readonly callId: string;
  readonly roomName: string;
  readonly agentLabel: string;
  readonly events: EventService;
  readonly callLog = new CallLogService();

  phase: CallPhase = CallPhase.GREETING;
  turnState: TurnState = TurnState.LISTENING;
  interruptionCount = 0;

  patientId: string | null = null;
  patientName: string | null = null;
  readonly intents = new Set<string>();

  private ended = false;
  private handedOff = false;

  // Set by the session wiring; invoked once when the agent should leave the call.
  onEnded: ((reason: string) => void) | null = null;
  // Set by the filler module; told about every tool invocation as it starts.
  onToolStart: ((tool: string) => void) | null = null;
  // Set by the warm-transfer module so an ending call can cancel a pending transfer.
  onBeforeEnd: (() => Promise<void>) | null = null;

  constructor(params: { callId: string; roomName: string; agentLabel: string }) {
    this.callId = params.callId;
    this.roomName = params.roomName;
    this.agentLabel = params.agentLabel;
    this.events = new EventService(params.callId);
  }

  get isEnded(): boolean {
    return this.ended || this.handedOff;
  }

  emit(type: CallEventType, metadata?: Record<string, unknown> | null, extra: Omit<EmitOptions, "metadata"> = {}): Promise<void> {
    return this.events.emit(type, { agent: this.agentLabel, phase: this.phase, metadata, ...extra });
  }

  transitionPhase(next: CallPhase, reason: string): boolean {
    if (!isTransitionAllowed(this.phase, next)) {
      logger.warn("phase.transition_rejected", { from: this.phase, to: next, reason });
      return false;
    }
    if (this.phase === next) return true;
    const from = this.phase;
    this.phase = next;
    void this.emit(CallEventType.PHASE_CHANGED, { from, to: next, reason });
    return true;
  }

  recordIntent(intent: string): void {
    if (this.intents.has(intent)) return;
    this.intents.add(intent);
    void this.emit(CallEventType.INTENT_DETECTED, { intent });
    void this.callLog.setIntents(this.callId, [...this.intents]).catch((err) => logger.error("intents.persist_failed", { message: String(err) }));
  }

  async attachPatient(patientId: string, name: string): Promise<void> {
    this.patientId = patientId;
    this.patientName = name;
    await this.callLog.attachPatient(this.callId, patientId);
    await this.emit(CallEventType.PATIENT_VERIFIED, { patientId, name });
  }

  recordTurn(speaker: Speaker, text: string): void {
    void this.callLog.addTranscriptTurn(this.callId, speaker, text).catch((err) => logger.error("turn.persist_failed", { message: String(err) }));
  }

  // The agent has left; a human now owns the call. call.ended is emitted later
  // by whoever finishes the call (staff console or caller hang-up).
  async completeHandoff(): Promise<void> {
    if (this.isEnded) return;
    this.handedOff = true;
    this.transitionPhase(CallPhase.HANDED_OFF, "staff took over");
    await this.callLog.markHandedOff(this.callId);
    this.onEnded?.("handed_off");
  }

  async endCall(reason: string, summary?: string | null): Promise<void> {
    if (this.isEnded) return;
    this.ended = true;
    await this.onBeforeEnd?.().catch((err) => logger.error("call.before_end_failed", { message: String(err) }));
    this.transitionPhase(CallPhase.COMPLETED, reason);
    this.turnState = TurnState.ENDED;
    await this.callLog.endCall(this.callId, summary ?? null);
    await this.emit(CallEventType.CALL_ENDED, { reason, summary: summary ?? null, intents: [...this.intents] });
    this.onEnded?.(reason);
  }
}
