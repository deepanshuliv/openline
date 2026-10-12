import { prisma } from "@repo/db";
import { evaluateRefill } from "@repo/shared";

export class PrescriptionService {
  async activeFor(patientId: string) {
    return prisma.prescription.findMany({ where: { patientId, active: true }, orderBy: { drugName: "asc" } });
  }

  async requestRefill(input: { patientId: string; prescriptionId: string; pharmacy: string | null; callId: string }) {
    const rx = await prisma.prescription.findFirst({ where: { id: input.prescriptionId, patientId: input.patientId, active: true }, include: { patient: true } });
    if (!rx) return null;

    const decision = evaluateRefill({
      controlled: rx.controlled,
      refillsRemaining: rx.refillsRemaining,
      lastFilledAt: rx.lastFilledAt,
      daysSupply: rx.daysSupply,
      lastVisitAt: rx.patient.lastVisitAt,
    });
    const pharmacy = input.pharmacy ?? rx.patient.preferredPharmacy;

    const request = await prisma.$transaction(async (tx) => {
      if (decision.outcome === "SENT_TO_PHARMACY") {
        await tx.prescription.update({ where: { id: rx.id }, data: { refillsRemaining: { decrement: 1 }, lastFilledAt: new Date() } });
      }
      return tx.refillRequest.create({
        data: {
          prescriptionId: rx.id,
          patientId: input.patientId,
          callId: input.callId,
          outcome: decision.outcome,
          status: decision.escalate ? "ESCALATED" : "SUBMITTED",
          pharmacy,
          notes: decision.reasons.join("; "),
        },
      });
    });
    return { rx, decision, request, pharmacy };
  }
}
