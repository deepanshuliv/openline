import { prisma } from "@repo/db";

export class PatientsQueryService {
  async getPatient(patientId: string) {
    return prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        primaryProvider: true,
        appointments: {
          where: { status: "SCHEDULED", startsAt: { gte: new Date() } },
          include: { provider: true },
          orderBy: { startsAt: "asc" },
        },
        insurancePlans: { orderBy: [{ isPrimary: "desc" }, { effectiveFrom: "desc" }] },
        prescriptions: {
          where: { active: true },
          include: { prescriber: { select: { id: true, name: true, title: true } } },
          orderBy: { drugName: "asc" },
        },
      },
    });
  }
}
