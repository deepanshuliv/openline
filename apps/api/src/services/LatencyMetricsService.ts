import { prisma } from "@repo/db";
import { CallEventType, LATENCY_TARGETS_MS, latencyStats, summarizeTurns, toTurnLatency, type TurnLatency } from "@repo/shared";

export class LatencyMetricsService {
  // Aggregates latency.turn events across the most recent calls that have any.
  async summary(callLimit = 20) {
    const calls = await prisma.call.findMany({
      where: { events: { some: { type: CallEventType.LATENCY_TURN } } },
      orderBy: { startedAt: "desc" },
      take: callLimit,
      select: { id: true, startedAt: true },
    });

    const events = await prisma.callEvent.findMany({
      where: { callId: { in: calls.map((c) => c.id) }, type: CallEventType.LATENCY_TURN },
      orderBy: { timestamp: "asc" },
      select: { callId: true, metadata: true },
    });

    const allTurns: TurnLatency[] = [];
    const byCall = new Map<string, TurnLatency[]>();
    for (const e of events) {
      const turn = toTurnLatency(e.metadata);
      allTurns.push(turn);
      const list = byCall.get(e.callId) ?? [];
      list.push(turn);
      byCall.set(e.callId, list);
    }

    return {
      targets: LATENCY_TARGETS_MS,
      summary: summarizeTurns(allTurns),
      turns: allTurns.length,
      perCall: calls.map((c) => ({
        callId: c.id,
        startedAt: c.startedAt,
        p50: latencyStats((byCall.get(c.id) ?? []).map((t) => t.e2eMs)).p50,
      })),
    };
  }
}
