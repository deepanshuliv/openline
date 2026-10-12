import { describe, expect, test } from "bun:test";
import {
  RefillOutcome,
  VisitType,
  clinicLocalParts,
  clinicLocalToUtc,
  evaluateEligibility,
  evaluateRefill,
  latencyStats,
  type PlanBenefits,
} from "../src/index.ts";

const NOW = new Date("2026-10-04T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("evaluateRefill", () => {
  const base = { controlled: false, refillsRemaining: 2, lastFilledAt: daysAgo(28), daysSupply: 30, lastVisitAt: daysAgo(100) };

  test("routine refill goes to the pharmacy", () => {
    const d = evaluateRefill(base, NOW);
    expect(d.outcome).toBe(RefillOutcome.SENT_TO_PHARMACY);
    expect(d.escalate).toBe(false);
    expect(d.reasons).toEqual(["1 refill left after this one"]);
  });

  test("controlled substances always need a clinician, even with refills left", () => {
    const d = evaluateRefill({ ...base, controlled: true }, NOW);
    expect(d.outcome).toBe(RefillOutcome.CLINICIAN_REVIEW);
    expect(d.escalate).toBe(true);
  });

  test("refill before 75% of the supply is used needs a clinician", () => {
    expect(evaluateRefill({ ...base, lastFilledAt: daysAgo(10) }, NOW).outcome).toBe(RefillOutcome.CLINICIAN_REVIEW);
    // Exactly at the threshold (22.5 of 30 days) is allowed.
    expect(evaluateRefill({ ...base, lastFilledAt: daysAgo(22.5) }, NOW).outcome).toBe(RefillOutcome.SENT_TO_PHARMACY);
  });

  test("no visit in a year requires an appointment", () => {
    expect(evaluateRefill({ ...base, lastVisitAt: daysAgo(400) }, NOW).outcome).toBe(RefillOutcome.VISIT_REQUIRED);
    expect(evaluateRefill({ ...base, lastVisitAt: null }, NOW).outcome).toBe(RefillOutcome.VISIT_REQUIRED);
  });

  test("no refills left goes to the prescriber", () => {
    expect(evaluateRefill({ ...base, refillsRemaining: 0 }, NOW).outcome).toBe(RefillOutcome.PROVIDER_APPROVAL_REQUIRED);
  });

  test("never filled is not treated as early", () => {
    expect(evaluateRefill({ ...base, lastFilledAt: null }, NOW).outcome).toBe(RefillOutcome.SENT_TO_PHARMACY);
  });
});

describe("evaluateEligibility", () => {
  const plan: PlanBenefits = {
    active: true,
    inNetwork: true,
    effectiveFrom: daysAgo(90),
    effectiveTo: null,
    primaryCopayCents: 3500,
    specialistCopayCents: 7000,
    preventiveCovered: true,
    deductibleCents: 150000,
    deductibleMetCents: 40000,
    coinsurancePct: 20,
    priorAuthVisitTypes: ["NEW_PATIENT"],
  };

  test("primary care visit uses the primary copay", () => {
    const r = evaluateEligibility(plan, VisitType.SICK_VISIT, NOW);
    expect(r).toMatchObject({ eligible: true, copayCents: 3500, deductibleRemainingCents: 110000, priorAuthRequired: false });
  });

  test("in-network preventive visit is free", () => {
    expect(evaluateEligibility(plan, VisitType.ANNUAL_PHYSICAL, NOW).copayCents).toBe(0);
  });

  test("preventive is not free out of network", () => {
    expect(evaluateEligibility({ ...plan, inNetwork: false }, VisitType.ANNUAL_PHYSICAL, NOW).copayCents).toBe(3500);
  });

  test("prior auth is flagged per visit type", () => {
    expect(evaluateEligibility(plan, VisitType.NEW_PATIENT, NOW).priorAuthRequired).toBe(true);
  });

  test("inactive or expired coverage is not eligible", () => {
    expect(evaluateEligibility({ ...plan, active: false }, VisitType.SICK_VISIT, NOW)).toMatchObject({ eligible: false, copayCents: null });
    expect(evaluateEligibility({ ...plan, effectiveTo: daysAgo(1) }, VisitType.SICK_VISIT, NOW).eligible).toBe(false);
    expect(evaluateEligibility({ ...plan, effectiveFrom: daysAgo(-5) }, VisitType.SICK_VISIT, NOW).eligible).toBe(false);
  });

  test("deductible remaining never goes negative", () => {
    expect(evaluateEligibility({ ...plan, deductibleMetCents: 999999 }, VisitType.SICK_VISIT, NOW).deductibleRemainingCents).toBe(0);
  });
});

describe("clinic time zone (America/New_York)", () => {
  test("wall clock converts to the right UTC instant in summer and winter", () => {
    expect(clinicLocalToUtc(2026, 7, 15, 9, 0).toISOString()).toBe("2026-07-15T13:00:00.000Z"); // EDT
    expect(clinicLocalToUtc(2026, 12, 15, 9, 0).toISOString()).toBe("2026-12-15T14:00:00.000Z"); // EST
  });

  test("round-trips across the DST change", () => {
    for (const [m, d] of [[3, 9], [11, 2]] as const) {
      const parts = clinicLocalParts(clinicLocalToUtc(2026, m, d, 8, 20));
      expect([parts.month, parts.day, parts.hour, parts.minute]).toEqual([m, d, 8, 20]);
    }
  });
});

describe("latencyStats", () => {
  test("nearest-rank percentiles, ignoring missing values", () => {
    const s = latencyStats([500, null, 100, 300, undefined, 200, 400]);
    expect(s).toEqual({ count: 5, p50: 300, p90: 500, min: 100, max: 500 });
  });

  test("empty input", () => {
    expect(latencyStats([])).toEqual({ count: 0, p50: null, p90: null, min: null, max: null });
  });
});
