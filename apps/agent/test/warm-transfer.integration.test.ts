// WarmTransfer against local Postgres + Redis, with a fake LiveKit room and
// agent session: queueing, staff joining, timeout, and caller hang-up.
import { EventEmitter } from "node:events";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { voice } from "@livekit/agents";
import { RoomEvent, type Room } from "@livekit/rtc-node";
import { prisma } from "@repo/db";
import { CallPhase } from "@repo/shared";
import { CallLogService } from "../src/core/CallLogService.ts";
import { CallSession } from "../src/core/CallSession.ts";
import { WarmTransfer } from "../src/core/WarmTransfer.ts";

const TAG = `wt-${Date.now().toString(36)}`;
let seq = 0;

class FakeSession {
  replies: string[] = [];
  async waitForIdle(): Promise<void> {}
  generateReply(opts: { instructions: string }) {
    this.replies.push(opts.instructions);
    return { waitForPlayout: async () => {} };
  }
}

async function setup(timeoutMs = 60_000) {
  const record = await new CallLogService().findOrCreateByRoomName(`${TAG}-${++seq}`);
  const call = new CallSession({ callId: record.id, roomName: record.roomName, agentLabel: "RECEPTIONIST" });
  const room = new EventEmitter();
  const session = new FakeSession();
  const transfer = new WarmTransfer(call, {
    room: room as unknown as Room,
    session: session as unknown as voice.AgentSession<CallSession>,
    timeoutMs,
    scripts: {
      introduction: (staff, req, callerName) => `INTRO ${staff} ${req.department} ${callerName ?? "unverified"}`,
      timedOut: (req) => `TIMEOUT ${req.department}`,
    },
  });
  const join = (identity: string, name: string) => room.emit(RoomEvent.ParticipantConnected, { identity, name });
  return { call, room, session, transfer, join };
}

const request = { department: "NURSE", departmentLabel: "Nurse line", reason: "side effects", summary: "Caller has questions." };
const handoffFor = (callId: string) => prisma.handoff.findFirstOrThrow({ where: { callId } });
const until = async (check: () => boolean | Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await check()) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  const calls = await prisma.call.findMany({ where: { roomName: { startsWith: TAG } }, select: { id: true } });
  const callIds = calls.map((c) => c.id);
  await prisma.handoff.deleteMany({ where: { callId: { in: callIds } } });
  await prisma.callEvent.deleteMany({ where: { callId: { in: callIds } } });
  await prisma.call.deleteMany({ where: { id: { in: callIds } } });
  await prisma.$disconnect();
});

describe("WarmTransfer", () => {
  test("request queues a WAITING handoff and moves the call to TRANSFERRING", async () => {
    const { call, transfer } = await setup();
    const first = await transfer.request(request);
    expect(first.alreadyPending).toBe(false);
    expect((await handoffFor(call.callId)).status).toBe("WAITING");
    expect(call.phase).toBe(CallPhase.TRANSFERRING);
    expect((await transfer.request(request)).alreadyPending).toBe(true);
    await transfer.cancel();
  });

  test("staff joining briefs them with the verified caller's name, then hands off", async () => {
    const { call, session, transfer, join } = await setup();
    call.patientName = "James Carter"; // as set by verify_patient
    let ended = "";
    call.onEnded = (reason) => (ended = reason);
    await transfer.request(request);
    join("staff-abc123", "Jordan");
    await until(() => ended !== "");
    expect(session.replies).toEqual(["INTRO Jordan NURSE James Carter"]);
    expect(ended).toBe("handed_off");
    expect(transfer.isPending).toBe(false);
    expect((await prisma.call.findUniqueOrThrow({ where: { id: call.callId } })).status).toBe("HANDED_OFF");
  });

  test("an unverified caller is introduced without a name", async () => {
    const { call, session, transfer, join } = await setup();
    let ended = "";
    call.onEnded = (reason) => (ended = reason);
    await transfer.request(request);
    join("staff-def456", "Sam");
    await until(() => ended !== "");
    expect(session.replies).toEqual(["INTRO Sam NURSE unverified"]);
  });

  test("non-staff participants joining are ignored", async () => {
    const { session, transfer, join } = await setup();
    await transfer.request(request);
    join("caller-xyz", "Someone");
    await new Promise((r) => setTimeout(r, 100));
    expect(session.replies).toEqual([]);
    expect(transfer.isPending).toBe(true);
    await transfer.cancel();
  });

  test("nobody answering times out and returns the caller to the agent", async () => {
    const { call, session, transfer } = await setup(100);
    await transfer.request(request);
    await until(async () => (await handoffFor(call.callId)).status === "TIMED_OUT");
    expect((await handoffFor(call.callId)).status).toBe("TIMED_OUT");
    await until(() => session.replies.length > 0);
    expect(session.replies).toEqual(["TIMEOUT NURSE"]);
    expect(call.phase).toBe(CallPhase.SERVING);
    expect(transfer.isPending).toBe(false);
  });

  test("caller hanging up while queued cancels the handoff", async () => {
    const { call, transfer } = await setup();
    await transfer.request(request);
    await call.endCall("caller_hung_up");
    expect((await handoffFor(call.callId)).status).toBe("CANCELLED");
    expect(transfer.isPending).toBe(false);
  });
});
