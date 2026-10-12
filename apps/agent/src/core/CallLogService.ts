import { prisma, type Speaker } from "@repo/db";

export class CallLogService {
  async findOrCreateByRoomName(roomName: string) {
    const existing = await prisma.call.findUnique({ where: { roomName } });
    if (existing) return existing;
    return prisma.call.create({ data: { roomName, status: "ACTIVE" } });
  }

  async attachPatient(callId: string, patientId: string) {
    return prisma.call.update({ where: { id: callId }, data: { patientId } });
  }

  async setIntents(callId: string, intents: string[]) {
    return prisma.call.update({ where: { id: callId }, data: { intents } });
  }

  async addTranscriptTurn(callId: string, speaker: Speaker, text: string) {
    if (!text.trim()) return null;
    return prisma.transcriptTurn.create({ data: { callId, speaker, text } });
  }

  async markHandedOff(callId: string) {
    return prisma.call.update({ where: { id: callId }, data: { status: "HANDED_OFF" } });
  }

  async endCall(callId: string, finalSummary: string | null) {
    return prisma.call.update({
      where: { id: callId },
      data: { status: "COMPLETED", finalSummary: finalSummary ?? undefined, endedAt: new Date() },
    });
  }
}
