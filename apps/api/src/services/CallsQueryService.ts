import { prisma } from "@repo/db";







export class CallsQueryService {
  async createCall(roomName: string) {
    return prisma.call.create({
      data: { roomName, status: "ACTIVE" },
    });
  }

  async listCalls(limit = 50) {
    return prisma.call.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
      include: {
        caller: { select: { id: true, name: true, phone: true } },
        matter: { select: { id: true, incidentType: true, status: true, qualificationStatus: true } },
      },
    });
  }

  async getCallDetail(callId: string) {
    return prisma.call.findUnique({
      where: { id: callId },
      include: {
        caller: true,
        matter: { include: { appointments: true } },
        transcriptTurns: { orderBy: { timestamp: "asc" } },
        events: { orderBy: { timestamp: "asc" } },
      },
    });
  }

  async getCallEvents(callId: string) {
    return prisma.callEvent.findMany({
      where: { callId },
      orderBy: { timestamp: "asc" },
    });
  }

  async getMatter(matterId: string) {
    return prisma.matter.findUnique({
      where: { id: matterId },
      include: { caller: true, appointments: true },
    });
  }
}
