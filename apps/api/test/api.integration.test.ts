// API services against local Postgres + Redis: the handoff accept race and the
// stale-call sweeper. Needs migrations; creates and removes its own rows.
import { afterAll, describe, expect, test } from "bun:test";
import { prisma } from "@repo/db";
import { HandoffConflictError, HandoffService } from "../src/services/HandoffService.ts";
import { LiveKitTokenService } from "../src/services/LiveKitTokenService.ts";
import { sweepStaleCalls } from "../src/services/StaleCallSweeper.ts";

const TAG = `apitest-${Date.now().toString(36)}`;
let seq = 0;
const MIN = 60_000;

const newCall = (startedAt = new Date()) => prisma.call.create({ data: { roomName: `${TAG}-${++seq}`, status: "ACTIVE", startedAt } });

afterAll(async () => {
  const calls = await prisma.call.findMany({ where: { roomName: { startsWith: TAG } }, select: { id: true } });
  const callIds = calls.map((c) => c.id);
  await prisma.handoff.deleteMany({ where: { callId: { in: callIds } } });
  await prisma.callEvent.deleteMany({ where: { callId: { in: callIds } } });
  await prisma.call.deleteMany({ where: { id: { in: callIds } } });
  await prisma.$disconnect();
});

describe("HandoffService", () => {
  const service = new HandoffService(new LiveKitTokenService());
  const newHandoff = async () => {
    const call = await newCall();
    return prisma.handoff.create({ data: { callId: call.id, department: "NURSE", reason: "r", summary: "s" } });
  };

  test("two staff accepting at once: exactly one wins, the other gets a conflict", async () => {
    const h = await newHandoff();
    const results = await Promise.allSettled([service.accept(h.id, "Jordan"), service.accept(h.id, "Sam")]);
    const won = results.filter((r) => r.status === "fulfilled");
    expect(won.length).toBe(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(HandoffConflictError);
    const winner = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<HandoffService["accept"]>>>).value!;
    expect(winner.session.token).toBeTruthy();
    expect(winner.session.identity).toStartWith("staff-");
    const row = await prisma.handoff.findUniqueOrThrow({ where: { id: h.id } });
    expect(row.status).toBe("ACCEPTED");
  });

  test("accepting an unknown handoff returns null", async () => {
    expect(await service.accept("does-not-exist", "Jordan")).toBeNull();
  });

  test("completing marks handoff and call COMPLETED and emits call.ended once", async () => {
    const h = await newHandoff();
    await service.accept(h.id, "Jordan");
    await service.complete(h.id);
    await service.complete(h.id); // idempotent
    const call = await prisma.call.findUniqueOrThrow({ where: { id: h.callId } });
    expect(call.status).toBe("COMPLETED");
    expect((await prisma.handoff.findUniqueOrThrow({ where: { id: h.id } })).status).toBe("COMPLETED");
    expect(await prisma.callEvent.count({ where: { callId: h.callId, type: "call.ended" } })).toBe(1);
  });
});

describe("sweepStaleCalls", () => {
  test("closes never-joined and silent calls, leaves live and recent ones", async () => {
    const now = new Date();
    const neverJoined = await newCall(new Date(now.getTime() - 11 * MIN));
    const silent = await newCall(new Date(now.getTime() - 40 * MIN));
    await prisma.callEvent.create({ data: { callId: silent.id, type: "call.started", timestamp: new Date(now.getTime() - 20 * MIN) } });
    const live = await newCall(new Date(now.getTime() - 40 * MIN));
    await prisma.callEvent.create({ data: { callId: live.id, type: "agent.speech", timestamp: new Date(now.getTime() - 1 * MIN) } });
    const recent = await newCall(new Date(now.getTime() - 2 * MIN));

    await sweepStaleCalls(now);

    const status = async (id: string) => (await prisma.call.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(neverJoined.id)).toBe("COMPLETED");
    expect(await status(silent.id)).toBe("ERROR");
    expect(await status(live.id)).toBe("ACTIVE");
    expect(await status(recent.id)).toBe("ACTIVE");
  });
});
