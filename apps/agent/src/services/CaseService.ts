import { prisma, type Matter } from "@repo/db";
import type { IntakeFields, QualificationStatus } from "@repo/shared";






export class CaseService {






  async findCallerByPhone(phone: string) {
    return prisma.caller.findUnique({
      where: { phone },
      include: {
        matters: {
          where: { status: { notIn: ["CLOSED", "DISQUALIFIED"] } },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });
  }

  async createCaller(input: { name: string; phone: string; email?: string | null }) {
    return prisma.caller.upsert({
      where: { phone: input.phone },
      update: { name: input.name, email: input.email ?? undefined },
      create: { name: input.name, phone: input.phone, email: input.email ?? undefined },
    });
  }

  async createMatter(input: { callerId: string; matterType: string }) {
    return prisma.matter.create({
      data: { callerId: input.callerId, incidentType: input.matterType, status: "INTAKE" },
    });
  }

  async getMatter(matterId: string) {
    return prisma.matter.findUnique({ where: { id: matterId }, include: { caller: true } });
  }








  async updateIntake(matterId: string, fields: IntakeFields): Promise<Matter> {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      data[key] = key === "incidentDate" && typeof value === "string" ? new Date(value) : value;
    }
    return prisma.matter.update({ where: { id: matterId }, data });
  }

  async setQualificationStatus(matterId: string, status: QualificationStatus) {
    return prisma.matter.update({ where: { id: matterId }, data: { qualificationStatus: status } });
  }

  async appendNote(matterId: string, note: string) {
    const matter = await prisma.matter.findUnique({ where: { id: matterId }, select: { notes: true } });
    const stamped = `[${new Date().toISOString()}] ${note}`;
    const notes = matter?.notes ? `${matter.notes}\n${stamped}` : stamped;
    return prisma.matter.update({ where: { id: matterId }, data: { notes } });
  }
}
