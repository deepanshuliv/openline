import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { prisma, recordCallEvent, type HandoffStatus } from "@repo/db";
import { CallEventType, HANDOFF_EVENTS_CHANNEL, STAFF_IDENTITY_PREFIX, createLogger } from "@repo/shared";
import { createSubscriberConnection, redis } from "../redis.js";
import type { LiveKitTokenService, MintedSession } from "./LiveKitTokenService.js";

const logger = createLogger("api:handoffs");

export const ACTIVE_HANDOFF_STATUSES: HandoffStatus[] = ["WAITING", "ACCEPTED"];

export class HandoffConflictError extends Error {
  constructor() {
    super("handoff_not_waiting");
  }
}

export class HandoffService {

  constructor(private readonly tokenService: LiveKitTokenService) {}

  async list(statuses: HandoffStatus[] = ACTIVE_HANDOFF_STATUSES) {
    return prisma.handoff.findMany({
      where: { status: { in: statuses } },
      orderBy: { requestedAt: "asc" },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
        call: { select: { id: true, roomName: true, status: true } },
      },
    });
  }

  async accept(handoffId: string, staffName: string): Promise<{ handoff: Awaited<ReturnType<HandoffService["get"]>>; session: MintedSession } | null> {
    const existing = await prisma.handoff.findUnique({ where: { id: handoffId }, include: { call: true } });
    if (!existing) return null;

    const staffIdentity = STAFF_IDENTITY_PREFIX + randomUUID().replace(/-/g, "").slice(0, 8);
    // Conditional update so two staff members can't both accept the same transfer.
    const { count } = await prisma.handoff.updateMany({
      where: { id: handoffId, status: "WAITING" },
      data: { status: "ACCEPTED", acceptedAt: new Date(), staffIdentity, staffName },
    });
    if (count === 0) throw new HandoffConflictError();

    const session = await this.tokenService.createSession({
      roomName: existing.call.roomName,
      identity: staffIdentity,
      participantName: staffName,
    });
    await this.notifyUpdated(handoffId);
    logger.event("handoff.accepted", { handoffId, callId: existing.callId, staffIdentity });
    return { handoff: await this.get(handoffId), session };
  }

  async complete(handoffId: string) {
    const handoff = await prisma.handoff.findUnique({ where: { id: handoffId } });
    if (!handoff) return null;
    if (handoff.status === "COMPLETED") return this.get(handoffId);

    if (handoff.status === "ACCEPTED") {
      await prisma.handoff.update({ where: { id: handoffId }, data: { status: "COMPLETED", endedAt: new Date() } });
    }

    const { count } = await prisma.call.updateMany({
      where: { id: handoff.callId, status: { in: ["HANDED_OFF", "ACTIVE"] } },
      data: { status: "COMPLETED", endedAt: new Date() },
    });
    if (count > 0) {
      await recordCallEvent(redis, { callId: handoff.callId, type: CallEventType.CALL_ENDED, metadata: { reason: "staff_completed", handoffId } }, (stage, err) =>
        logger.error(`call_event.${stage}_failed`, { callId: handoff.callId, message: String(err) }),
      );
    }

    await this.notifyUpdated(handoffId);
    logger.event("handoff.completed", { handoffId, callId: handoff.callId });
    return this.get(handoffId);
  }

  async get(handoffId: string) {
    return prisma.handoff.findUnique({
      where: { id: handoffId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
        call: { select: { id: true, roomName: true, status: true } },
      },
    });
  }

  private async notifyUpdated(handoffId: string): Promise<void> {
    try {
      await redis.publish(HANDOFF_EVENTS_CHANNEL, JSON.stringify({ type: "handoff.updated", handoffId }));
    } catch (err) {
      logger.error("handoff.publish_failed", { handoffId, message: String(err) });
    }
  }

  // SSE: sends the active handoff list on connect and again after every change.
  async stream(res: Response, onClose: (cb: () => void) => void): Promise<void> {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    const send = async () => {
      try {
        const handoffs = await this.list();
        if (!closed) res.write(`event: handoffs\ndata: ${JSON.stringify(handoffs)}\n\n`);
      } catch (err) {
        logger.error("sse.query_failed", { message: String(err) });
      }
    };

    await send();

    const subscriber = createSubscriberConnection();
    await subscriber.subscribe(HANDOFF_EVENTS_CHANNEL);
    subscriber.on("message", () => void send());

    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);

    onClose(() => {
      closed = true;
      clearInterval(heartbeat);
      subscriber.unsubscribe(HANDOFF_EVENTS_CHANNEL).catch(() => undefined);
      subscriber.quit().catch(() => undefined);
    });
  }
}
