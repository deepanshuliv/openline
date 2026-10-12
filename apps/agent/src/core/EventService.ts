import { recordCallEvent } from "@repo/db";
import { createLogger, type CallEventType } from "@repo/shared";
import { redis } from "../redis.js";

const logger = createLogger("agent:event");

export interface EmitOptions {
  agent?: string | null;
  phase?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown> | null;
}

// Persists every call event to Postgres and fans it out over Redis so the API
// can stream it to the console in real time.
export class EventService {
  private readonly logger;

  constructor(private readonly callId: string) {
    this.logger = logger.child(callId.slice(0, 8));
  }

  async emit(type: CallEventType, options: EmitOptions = {}): Promise<void> {
    const durationMs = options.durationMs == null ? null : Math.max(0, Math.round(options.durationMs));

    this.logger.event(type, {
      phase: options.phase ?? undefined,
      durationMs: durationMs ?? undefined,
      ...(options.metadata ? flattenForLog(options.metadata) : {}),
    });

    await recordCallEvent(
      redis,
      { callId: this.callId, type, agent: options.agent, phase: options.phase, durationMs, metadata: options.metadata },
      (stage, err) => this.logger.error(`event.${stage}_failed`, { type, message: String(err) }),
    );
  }
}

function flattenForLog(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    out[k] = typeof v === "object" && v !== null ? JSON.stringify(v) : v;
  }
  return out;
}
