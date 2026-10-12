import { prisma } from "@repo/db";
import { createLogger } from "@repo/shared";

const logger = createLogger("api:sweeper");

// A session row is created before anyone joins, and the agent marks the call
// ended. If the caller never connects or the worker dies mid-call, the row
// would stay ACTIVE forever; close those out.
const NEVER_JOINED_MS = 10 * 60_000;
const SILENT_MS = 15 * 60_000;

export async function sweepStaleCalls(now = new Date()): Promise<{ neverJoined: number; silent: number }> {
  const candidates = await prisma.call.findMany({
    where: { status: "ACTIVE", startedAt: { lt: new Date(now.getTime() - NEVER_JOINED_MS) } },
    select: { id: true, events: { orderBy: { timestamp: "desc" }, take: 1, select: { timestamp: true } } },
  });
  let neverJoined = 0;
  let silent = 0;
  for (const call of candidates) {
    const last = call.events[0]?.timestamp;
    if (!last) {
      const r = await prisma.call.updateMany({
        where: { id: call.id, status: "ACTIVE" },
        data: { status: "COMPLETED", endedAt: now, finalSummary: "Caller never connected." },
      });
      neverJoined += r.count;
    } else if (now.getTime() - last.getTime() > SILENT_MS) {
      const r = await prisma.call.updateMany({
        where: { id: call.id, status: "ACTIVE" },
        data: { status: "ERROR", endedAt: last, finalSummary: "Call stopped without ending (agent disconnected)." },
      });
      silent += r.count;
    }
  }
  if (neverJoined || silent) logger.info("stale_calls.closed", { neverJoined, silent });
  return { neverJoined, silent };
}

export function startStaleCallSweeper(intervalMs = 60_000): () => void {
  const run = () => void sweepStaleCalls().catch((err) => logger.error("stale_calls.sweep_failed", { message: String(err) }));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
