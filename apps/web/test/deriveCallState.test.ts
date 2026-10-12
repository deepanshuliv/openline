// Pure event folding used by the call console; no DOM or network.
import { describe, expect, test } from "bun:test";
import type { CallEventPayload } from "@/lib/shared";
import { chartRevision, deriveCallState, latencyTurns } from "@/lib/deriveCallState";

let t = 0;
const ev = (type: string, metadata: Record<string, unknown> | null = null, extra: Partial<CallEventPayload> = {}): CallEventPayload => ({
  callId: "c1",
  type,
  timestamp: new Date(Date.UTC(2026, 9, 6, 12, 0, t++)).toISOString(),
  metadata,
  ...extra,
});

describe("deriveCallState", () => {
  test("starts in GREETING with nothing known", () => {
    expect(deriveCallState([])).toMatchObject({ phase: "GREETING", patientId: null, intents: [], ended: false, transfer: { status: "none" } });
  });

  test("tracks phase, verified patient and de-duplicated intents", () => {
    const s = deriveCallState([
      ev("phase.changed", null, { phase: "IDENTIFYING" }),
      ev("patient.verified", { patientId: "p1", name: "James Carter" }, { phase: "SERVING" }),
      ev("intent.detected", { intent: "BOOK" }),
      ev("intent.detected", { intent: "BOOK" }),
      ev("intent.detected", { intent: "REFILL" }),
    ]);
    expect(s).toMatchObject({ phase: "SERVING", patientId: "p1", patientName: "James Carter", intents: ["BOOK", "REFILL"] });
  });

  test("follows a transfer from request to completion, keeping the staff name", () => {
    const requested = [ev("transfer.requested", { handoffId: "h1", department: "NURSE", reason: "side effects" })];
    expect(deriveCallState(requested).transfer).toMatchObject({ status: "requested", handoffId: "h1", department: "NURSE", staffName: null });
    const accepted = [...requested, ev("transfer.accepted", { staffName: "Jordan" })];
    expect(deriveCallState(accepted).transfer).toMatchObject({ status: "accepted", staffName: "Jordan" });
    const completed = [...accepted, ev("transfer.completed", {})];
    expect(deriveCallState(completed).transfer).toMatchObject({ status: "completed", staffName: "Jordan", department: "NURSE" });
  });

  test("a timed-out transfer keeps its department", () => {
    const s = deriveCallState([ev("transfer.requested", { handoffId: "h1", department: "BILLING" }), ev("transfer.timed_out", {})]);
    expect(s.transfer).toMatchObject({ status: "timed_out", department: "BILLING" });
  });

  test("call.ended records reason and summary; empty strings count as missing", () => {
    expect(deriveCallState([ev("call.ended", { reason: "agent_ended", summary: "Booked a visit" })])).toMatchObject({
      ended: true,
      endReason: "agent_ended",
      finalSummary: "Booked a visit",
    });
    expect(deriveCallState([ev("call.ended", { reason: "", summary: null })])).toMatchObject({ ended: true, endReason: null, finalSummary: null });
  });

  test("malformed metadata never throws", () => {
    expect(() => deriveCallState([ev("patient.verified", null), ev("intent.detected", { intent: 42 }), ev("transfer.accepted", null)])).not.toThrow();
  });
});

describe("latencyTurns", () => {
  test("reads latency.turn metadata, falling back to durationMs for e2e", () => {
    const turns = latencyTurns([
      ev("latency.turn", { e2eMs: 900, sttMs: 300, llmTtftMs: 400, ttsTtfbMs: 200, endOfTurnMs: 500 }),
      ev("latency.turn", { sttMs: "bad" }, { durationMs: 1200 }),
      ev("agent.speech", { text: "hi" }),
    ]);
    expect(turns).toEqual([
      { e2eMs: 900, sttMs: 300, endOfTurnMs: 500, llmTtftMs: 400, ttsTtfbMs: 200 },
      { e2eMs: 1200, sttMs: null, endOfTurnMs: null, llmTtftMs: null, ttsTtfbMs: null },
    ]);
  });
});

describe("chartRevision", () => {
  test("counts only events that change the patient chart", () => {
    expect(chartRevision([ev("appointment.booked"), ev("refill.requested"), ev("insurance.checked"), ev("agent.speech"), ev("tool.started")])).toBe(3);
  });
});
