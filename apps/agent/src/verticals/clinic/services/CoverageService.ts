import { prisma } from "@repo/db";
import { evaluateEligibility, type VisitType } from "@repo/shared";

export class CoverageService {
  async check(patientId: string, visitType: VisitType) {
    const plans = await prisma.insurancePlan.findMany({ where: { patientId }, orderBy: [{ isPrimary: "desc" }, { effectiveFrom: "desc" }] });
    const evaluated = plans.map((plan) => ({ plan, result: evaluateEligibility(plan, visitType) }));
    // The plan we bill: first eligible one, preferring primary.
    const billable = evaluated.find((e) => e.result.eligible) ?? null;
    return { evaluated, billable };
  }
}
