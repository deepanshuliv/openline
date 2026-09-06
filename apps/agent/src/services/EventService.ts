import { prisma } from "@repo/db";
import {
  CALL_EVENTS_CHANNEL_PREFIX,
  REDIS_CALL_EVENTS_STREAM,
  createLogger,
  type CallEventType,
} from "@repo/shared";
import { redis } from "../redis.js";

const logger = createLogger("agent:event");

export interface EmitOptions {
  agent?: string | null;
  phase?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown> | null;
}







export class EventService {
  private readonly logger;

  constructor(private readonly callId: string) {
    this.logger = logger.child(callId.slice(0, 8));
  }

  async emit(type: CallEventType | (string & {}), options: EmitOptions = {}): Promise<void> {
    const timestamp = new Date();

    this.logger.event(type, {
      agent: options.agent ?? undefined,
      phase: options.phase ?? undefined,
      durationMs: options.durationMs ?? undefined,
      ...(options.metadata ? flattenForLog(options.metadata) : {}),
    });

    let id: string | undefined;
    try {
      const row = await prisma.callEvent.create({
        data: {
          callId: this.callId,
          type,
          agent: options.agent ?? null,
          phase: options.phase ?? null,
          durationMs: options.durationMs ?? null,
          metadata: (options.metadata ?? undefined) as never,
          timestamp,
        },
      });
      id = row.id;
    } catch (err) {
      this.logger.error("event.persist_failed", { type, message: String(err) });
    }

    const wire = JSON.stringify({
      id,
      callId: this.callId,
      type,
      agent: options.agent ?? null,
      phase: options.phase ?? null,
      durationMs: options.durationMs ?? null,
      metadata: options.metadata ?? null,
      timestamp: timestamp.toISOString(),
    });

    try {
      await redis.xadd(REDIS_CALL_EVENTS_STREAM, "*", "data", wire);
      await redis.publish(CALL_EVENTS_CHANNEL_PREFIX + this.callId, wire);
    } catch (err) {
      this.logger.error("event.publish_failed", { type, message: String(err) });
    }
  }
}


function flattenForLog(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    out[k] = typeof v === "object" && v !== null ? JSON.stringify(v) : v;
  }
  return out;
}
