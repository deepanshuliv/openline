import type { voice } from "@livekit/agents";
import { RoomEvent, type RemoteParticipant, type Room } from "@livekit/rtc-node";
import { prisma } from "@repo/db";
import { CallEventType, CallPhase, HANDOFF_EVENTS_CHANNEL, STAFF_IDENTITY_PREFIX, createLogger } from "@repo/shared";
import { redis } from "../redis.js";
import type { CallSession } from "./CallSession.js";

const logger = createLogger("agent:transfer");

// After the queue timeout, an accepted-but-not-yet-joined staff member gets
// this much longer to connect before the transfer is abandoned.
const JOIN_GRACE_MS = 30_000;

export interface TransferRequest {
  department: string;
  departmentLabel: string;
  reason: string;
  summary: string;
}

export interface WarmTransferScripts {
  // Spoken by the agent once staff joins: introduce caller and context, then sign off.
  // callerName is the verified patient's name, or null if they never verified.
  introduction: (staffName: string, req: TransferRequest, callerName: string | null) => string;
  // Spoken when nobody picks up in time.
  timedOut: (req: TransferRequest) => string;
}

type Pending = { handoffId: string; request: TransferRequest; timer: NodeJS.Timeout | null; joined: boolean; graced: boolean };

// Live warm transfer: queue the call for a human, keep the caller company while
// waiting, brief the human on the open line when they join, then leave the
// room so caller and staff continue directly.
export class WarmTransfer {
  private pending: Pending | null = null;

  constructor(
    private readonly call: CallSession,
    private readonly deps: {
      room: Room;
      session: voice.AgentSession<CallSession>;
      timeoutMs: number;
      scripts: WarmTransferScripts;
    },
  ) {
    deps.room.on(RoomEvent.ParticipantConnected, (p) => void this.onParticipantConnected(p));
    call.onBeforeEnd = () => this.cancel();
  }

  get isPending(): boolean {
    return this.pending !== null;
  }

  async request(req: TransferRequest): Promise<{ handoffId: string; alreadyPending: boolean }> {
    if (this.pending) return { handoffId: this.pending.handoffId, alreadyPending: true };

    const handoff = await prisma.handoff.create({
      data: {
        callId: this.call.callId,
        patientId: this.call.patientId,
        department: req.department,
        reason: req.reason,
        summary: req.summary,
      },
    });
    this.pending = { handoffId: handoff.id, request: req, timer: null, joined: false, graced: false };
    this.pending.timer = setTimeout(() => void this.onTimeout(), this.deps.timeoutMs);

    this.call.transitionPhase(CallPhase.TRANSFERRING, `transfer to ${req.department}`);
    await this.call.emit(CallEventType.TRANSFER_REQUESTED, { handoffId: handoff.id, department: req.department, reason: req.reason, summary: req.summary });
    await this.notifyQueue("handoff.created", handoff.id);
    return { handoffId: handoff.id, alreadyPending: false };
  }

  private async onParticipantConnected(participant: RemoteParticipant): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.joined || !participant.identity.startsWith(STAFF_IDENTITY_PREFIX)) return;
    pending.joined = true;
    if (pending.timer) clearTimeout(pending.timer);

    const staffName = participant.name || "our staff member";
    logger.info("transfer.staff_joined", { handoffId: pending.handoffId, staff: participant.identity });
    await this.call.emit(CallEventType.TRANSFER_ACCEPTED, { handoffId: pending.handoffId, staffName });

    try {
      // Let any in-flight hold message finish, then brief the human on the open line.
      await this.deps.session.waitForIdle();
      const intro = this.deps.session.generateReply({
        instructions: this.deps.scripts.introduction(staffName, pending.request, this.call.patientName),
        toolChoice: "none",
        allowInterruptions: false,
      });
      await intro.waitForPlayout();
    } catch (err) {
      logger.error("transfer.intro_failed", { message: String(err) });
    }

    await this.call.emit(CallEventType.TRANSFER_COMPLETED, { handoffId: pending.handoffId, staffName });
    this.pending = null;
    await this.call.completeHandoff();
  }

  private async onTimeout(): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.joined) return;

    // Staff may have accepted in the console but not connected yet.
    const timedOut = await prisma.handoff.updateMany({
      where: { id: pending.handoffId, status: "WAITING" },
      data: { status: "TIMED_OUT", endedAt: new Date() },
    });
    if (timedOut.count === 0) {
      const current = await prisma.handoff.findUnique({ where: { id: pending.handoffId } });
      if (current?.status === "ACCEPTED" && !pending.graced) {
        pending.graced = true;
        pending.timer = setTimeout(() => void this.abandonAccepted(), JOIN_GRACE_MS);
        return;
      }
    }
    await this.returnToAgent(pending);
  }

  private async abandonAccepted(): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.joined) return;
    await prisma.handoff.update({ where: { id: pending.handoffId }, data: { status: "TIMED_OUT", endedAt: new Date() } });
    await this.returnToAgent(pending);
  }

  private async returnToAgent(pending: Pending): Promise<void> {
    this.pending = null;
    await this.call.emit(CallEventType.TRANSFER_TIMED_OUT, { handoffId: pending.handoffId, department: pending.request.department });
    await this.notifyQueue("handoff.updated", pending.handoffId);
    this.call.transitionPhase(CallPhase.SERVING, "transfer timed out");
    if (!this.call.isEnded) {
      this.deps.session.generateReply({ instructions: this.deps.scripts.timedOut(pending.request) });
    }
  }

  // Caller hung up (or the agent ended the call) while still in the queue.
  async cancel(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    if (pending.timer) clearTimeout(pending.timer);
    await prisma.handoff.updateMany({
      where: { id: pending.handoffId, status: { in: ["WAITING", "ACCEPTED"] } },
      data: { status: "CANCELLED", endedAt: new Date() },
    });
    await this.notifyQueue("handoff.updated", pending.handoffId);
  }

  private async notifyQueue(type: string, handoffId: string): Promise<void> {
    await redis.publish(HANDOFF_EVENTS_CHANNEL, JSON.stringify({ type, handoffId })).catch((err) => logger.error("transfer.publish_failed", { message: String(err) }));
  }
}
