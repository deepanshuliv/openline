import { prisma } from "@repo/db";
import { CallEventType, latencyStats, toTurnLatency } from "@repo/shared";

export class CallsQueryService {
  async createCall(roomName: string) {
    return prisma.call.create({
      data: { roomName, status: "ACTIVE" },
    });
  }

  async listCalls(limit = 50) {
    const calls = await prisma.call.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const latencyEvents = await prisma.callEvent.findMany({
      where: { callId: { in: calls.map((c) => c.id) }, type: CallEventType.LATENCY_TURN },
      select: { callId: true, metadata: true },
    });
    const e2eByCall = new Map<string, number[]>();
    for (const e of latencyEvents) {
      const e2e = toTurnLatency(e.metadata).e2eMs;
      if (e2e === null) continue;
      const list = e2eByCall.get(e.callId) ?? [];
      list.push(e2e);
      e2eByCall.set(e.callId, list);
    }

    return calls.map((c) => ({ ...c, latencyP50Ms: latencyStats(e2eByCall.get(c.id) ?? []).p50 }));
  }

  async getCallDetail(callId: string) {
    return prisma.call.findUnique({
      where: { id: callId },
      include: {
        patient: true,
        transcriptTurns: { orderBy: { timestamp: "asc" } },
        events: { orderBy: { timestamp: "asc" } },
        handoffs: { orderBy: { requestedAt: "asc" } },
        appointments: { include: { provider: true }, orderBy: { startsAt: "asc" } },
        refillRequests: { include: { prescription: true }, orderBy: { createdAt: "asc" } },
      },
    });
  }

  async getCallEvents(callId: string) {
    return prisma.callEvent.findMany({
      where: { callId },
      orderBy: { timestamp: "asc" },
    });
  }
}
