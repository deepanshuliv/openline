import { PrismaClient } from "@prisma/client";
import { CALL_EVENTS_CHANNEL_PREFIX } from "@repo/shared";

export * from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

export interface CallEventInput {
  callId: string;
  type: string;
  agent?: string | null;
  phase?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown> | null;
}

// Persists a call event, then publishes it on the call's Redis channel so the
// API can stream it to the console. Shared by the agent and the API. Failures
// are reported to onError, never thrown: telemetry must not break a call.
export async function recordCallEvent(
  redis: { publish(channel: string, message: string): Promise<unknown> },
  event: CallEventInput,
  onError: (stage: "persist" | "publish", err: unknown) => void,
): Promise<void> {
  const timestamp = new Date();
  const row = {
    callId: event.callId,
    type: event.type,
    agent: event.agent ?? null,
    phase: event.phase ?? null,
    durationMs: event.durationMs ?? null,
  };
  let id: string | undefined;
  try {
    id = (await prisma.callEvent.create({ data: { ...row, metadata: (event.metadata ?? undefined) as never, timestamp } })).id;
  } catch (err) {
    onError("persist", err);
  }
  const wire = JSON.stringify({ id, ...row, metadata: event.metadata ?? null, timestamp: timestamp.toISOString() });
  try {
    await redis.publish(CALL_EVENTS_CHANNEL_PREFIX + event.callId, wire);
  } catch (err) {
    onError("publish", err);
  }
}
