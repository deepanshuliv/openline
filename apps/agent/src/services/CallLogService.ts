import { prisma, type CallStatus, type Speaker } from "@repo/db";






export class CallLogService {
  async getOrAttachCall(callId: string) {
    return prisma.call.findUniqueOrThrow({ where: { id: callId } });
  }







  async findOrCreateByRoomName(roomName: string) {
    const existing = await prisma.call.findUnique({ where: { roomName } });
    if (existing) return existing;
    return prisma.call.create({ data: { roomName, status: "ACTIVE" } });
  }

  async attachCallerAndMatter(callId: string, input: { callerId?: string | null; matterId?: string | null }) {
    return prisma.call.update({
      where: { id: callId },
      data: {
        ...(input.callerId !== undefined ? { callerId: input.callerId } : {}),
        ...(input.matterId !== undefined ? { matterId: input.matterId } : {}),
      },
    });
  }

  async addTranscriptTurn(callId: string, speaker: Speaker, text: string) {
    if (!text.trim()) return null;
    return prisma.transcriptTurn.create({ data: { callId, speaker, text } });
  }


  async getRecentTranscript(callId: string, limit = 40): Promise<string> {
    const turns = await prisma.transcriptTurn.findMany({
      where: { callId },
      orderBy: { timestamp: "desc" },
      take: limit,
    });
    return turns
      .reverse()
      .map((t) => `${t.speaker}: ${t.text}`)
      .join("\n");
  }

  async endCall(callId: string, input: { status: CallStatus; finalSummary?: string | null }) {
    return prisma.call.update({
      where: { id: callId },
      data: { status: input.status, finalSummary: input.finalSummary ?? undefined, endedAt: new Date() },
    });
  }
}
