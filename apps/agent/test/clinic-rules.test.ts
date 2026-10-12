// Pure business rules from @repo/shared: no DB, no network.
import { describe, expect, test } from "bun:test";
import { clinicLocalParts, clinicLocalToUtc, evaluateEligibility, evaluateRefill, formatCents, formatClinicTime, type PlanBenefits } from "@repo/shared";

const DAY = 86_400_000;
const NOW = new Date("2026-10-05T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

const plan = (over: Partial<PlanBenefits> = {}): PlanBenefits => ({
  active: true,
  inNetwork: true,
  effectiveFrom: daysAgo(100),
  effectiveTo: null,
  primaryCopayCents: 2500,
  specialistCopayCents: 5000,
  preventiveCovered: true,
  deductibleCents: 100000,
  deductibleMetCents: 25000,
  coinsurancePct: 20,
  priorAuthVisitTypes: [],
  ...over,
});

describe("evaluateEligibility", () => {
  test("in-network primary care uses the primary copay", () => {
    const r = evaluateEligibility(plan(), "SICK_VISIT", NOW);
    expect(r).toMatchObject({ eligible: true, inNetwork: true, copayCents: 2500, deductibleRemainingCents: 75000 });
  });

  test("preventive visit is free in network", () => {
    expect(evaluateEligibility(plan(), "ANNUAL_PHYSICAL", NOW).copayCents).toBe(0);
  });

  test("preventive visit is not free out of network", () => {
    const r = evaluateEligibility(plan({ inNetwork: false }), "ANNUAL_PHYSICAL", NOW);
    expect(r.copayCents).toBe(2500);
    expect(r.reasons.join(" ")).toContain("out of network");
  });

  test("inactive plan is ineligible with no copay", () => {
    const r = evaluateEligibility(plan({ active: false }), "SICK_VISIT", NOW);
    expect(r).toMatchObject({ eligible: false, copayCents: null });
  });

  test("plan outside effective dates is ineligible", () => {
    expect(evaluateEligibility(plan({ effectiveTo: daysAgo(1) }), "SICK_VISIT", NOW).eligible).toBe(false);
    expect(evaluateEligibility(plan({ effectiveFrom: new Date(NOW.getTime() + DAY) }), "SICK_VISIT", NOW).eligible).toBe(false);
  });

  test("overpaid deductible never goes negative", () => {
    expect(evaluateEligibility(plan({ deductibleMetCents: 999999 }), "SICK_VISIT", NOW).deductibleRemainingCents).toBe(0);
  });

  test("prior auth flagged per visit type", () => {
    const p = plan({ priorAuthVisitTypes: ["NEW_PATIENT"] });
    expect(evaluateEligibility(p, "NEW_PATIENT", NOW).priorAuthRequired).toBe(true);
    expect(evaluateEligibility(p, "FOLLOW_UP", NOW).priorAuthRequired).toBe(false);
  });
});

describe("evaluateRefill", () => {
  const base = { controlled: false, refillsRemaining: 2, lastFilledAt: daysAgo(28), daysSupply: 30, lastVisitAt: daysAgo(60) };

  test("normal refill goes to pharmacy", () => {
    expect(evaluateRefill(base, NOW)).toMatchObject({ outcome: "SENT_TO_PHARMACY", escalate: false });
  });

  test("controlled substance always needs a clinician, even with refills", () => {
    expect(evaluateRefill({ ...base, controlled: true }, NOW)).toMatchObject({ outcome: "CLINICIAN_REVIEW", escalate: true });
  });

  test("too-early refill needs a clinician", () => {
    expect(evaluateRefill({ ...base, lastFilledAt: daysAgo(10) }, NOW).outcome).toBe("CLINICIAN_REVIEW");
  });

  test("exactly at the 75% mark is allowed", () => {
    expect(evaluateRefill({ ...base, lastFilledAt: daysAgo(22.5) }, NOW).outcome).toBe("SENT_TO_PHARMACY");
  });

  test("no visit in a year requires a visit", () => {
    expect(evaluateRefill({ ...base, lastVisitAt: daysAgo(400) }, NOW).outcome).toBe("VISIT_REQUIRED");
    expect(evaluateRefill({ ...base, lastVisitAt: null }, NOW).outcome).toBe("VISIT_REQUIRED");
  });

  test("no refills left goes to the prescriber", () => {
    expect(evaluateRefill({ ...base, refillsRemaining: 0 }, NOW).outcome).toBe("PROVIDER_APPROVAL_REQUIRED");
  });

  test("never-filled prescription is not treated as early", () => {
    expect(evaluateRefill({ ...base, lastFilledAt: null }, NOW).outcome).toBe("SENT_TO_PHARMACY");
  });

  test("singular wording for the last refill", () => {
    expect(evaluateRefill({ ...base, refillsRemaining: 2 }, NOW).reasons[0]).toBe("1 refill left after this one");
  });
});

describe("clinic time helpers", () => {
  test("local <-> UTC round trip in EDT and EST", () => {
    expect(clinicLocalToUtc(2026, 7, 1, 9, 0).toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(clinicLocalToUtc(2026, 12, 1, 9, 0).toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });

  test("DST change days resolve to the right wall clock", () => {
    // 2026 DST: starts March 8, ends November 1.
    for (const [m, d] of [[3, 8], [3, 9], [11, 1], [11, 2]] as const) {
      const p = clinicLocalParts(clinicLocalToUtc(2026, m, d, 8, 20));
      expect([p.month, p.day, p.hour, p.minute]).toEqual([m, d, 8, 20]);
    }
  });

  test("spoken time format", () => {
    expect(formatClinicTime(clinicLocalToUtc(2026, 10, 6, 9, 20))).toBe("Tuesday, October 6 at 9:20 AM");
  });

  test("formatCents", () => {
    expect(formatCents(2500)).toBe("$25");
    expect(formatCents(1999)).toBe("$19.99");
    expect(formatCents(0)).toBe("$0");
  });
});
