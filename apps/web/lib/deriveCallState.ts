import { CallEventType, toTurnLatency, type CallEventPayload, type TurnLatency } from "@/lib/shared";

export type TransferStatus = "none" | "requested" | "accepted" | "completed" | "timed_out";

export interface TransferState {
  status: TransferStatus;
  handoffId: string | null;
  department: string | null;
  reason: string | null;
  staffName: string | null;
}

interface DerivedCallState {
  phase: string;
  patientId: string | null;
  patientName: string | null;
  intents: string[];
  transfer: TransferState;
  ended: boolean;
  endReason: string | null;
  finalSummary: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function deriveCallState(events: CallEventPayload[]): DerivedCallState {
  const state: DerivedCallState = {
    phase: "GREETING",
    patientId: null,
    patientName: null,
    intents: [],
    transfer: { status: "none", handoffId: null, department: null, reason: null, staffName: null },
    ended: false,
    endReason: null,
    finalSummary: null,
  };

  for (const e of events) {
    const m = e.metadata ?? {};
    if (e.phase) state.phase = e.phase;

    switch (e.type) {
      case CallEventType.PATIENT_VERIFIED:
        state.patientId = str(m.patientId) ?? state.patientId;
        state.patientName = str(m.name) ?? state.patientName;
        break;
      case CallEventType.INTENT_DETECTED: {
        const intent = str(m.intent);
        if (intent && !state.intents.includes(intent)) state.intents.push(intent);
        break;
      }
      case CallEventType.TRANSFER_REQUESTED:
        state.transfer = {
          status: "requested",
          handoffId: str(m.handoffId),
          department: str(m.department),
          reason: str(m.reason),
          staffName: null,
        };
        break;
      case CallEventType.TRANSFER_ACCEPTED:
        state.transfer = { ...state.transfer, status: "accepted", staffName: str(m.staffName) };
        break;
      case CallEventType.TRANSFER_COMPLETED:
        state.transfer = { ...state.transfer, status: "completed", staffName: str(m.staffName) ?? state.transfer.staffName };
        break;
      case CallEventType.TRANSFER_TIMED_OUT:
        state.transfer = { ...state.transfer, status: "timed_out" };
        break;
      case CallEventType.CALL_ENDED:
        state.ended = true;
        state.endReason = str(m.reason);
        state.finalSummary = str(m.summary);
        break;
    }
  }

  return state;
}

export function latencyTurns(events: CallEventPayload[]): TurnLatency[] {
  return events.filter((e) => e.type === CallEventType.LATENCY_TURN).map((e) => toTurnLatency(e.metadata, e.durationMs ?? null));
}

// Events that can change the verified patient's chart; the count works as a
// cheap refetch key for the patient panel.
const CHART_EVENT_PREFIXES = ["appointment.", "refill.", "insurance."];

export function chartRevision(events: CallEventPayload[]): number {
  return events.filter((e) => CHART_EVENT_PREFIXES.some((p) => e.type.startsWith(p))).length;
}
