// Clinic receptionist vertical: domain constants and deterministic business
// rules. The LLM gathers facts and calls tools; coverage and refill decisions
// are made here so they are predictable and testable.

export const CLINIC = {
  name: "Maple Grove Family Clinic",
  timezone: "America/New_York",
  // Local wall-clock hours, Monday-Friday.
  openHour: 8,
  closeHour: 17,
  lunchStartHour: 12,
  lunchEndHour: 13,
  slotMinutes: 20,
  bookingHorizonDays: 21,
} as const;

// The platform's name. Suzi is the receptionist persona it runs; Maple Grove
// Family Clinic is the (fictional) clinic in this demo.
export const PRODUCT_NAME = "Openline";
export const PRODUCT_TAGLINE = "The clinic line that's always open";

// The receptionist's name, shared by the agent's greeting and the web console.
export const AGENT_NAME = "Suzi";

export const VisitType = {
  NEW_PATIENT: "NEW_PATIENT",
  FOLLOW_UP: "FOLLOW_UP",
  ANNUAL_PHYSICAL: "ANNUAL_PHYSICAL",
  SICK_VISIT: "SICK_VISIT",
} as const;
export type VisitType = (typeof VisitType)[keyof typeof VisitType];

export const VISIT_TYPE_INFO: Record<VisitType, { label: string; minutes: number; coverage: CoverageClass }> = {
  NEW_PATIENT: { label: "New patient visit", minutes: 40, coverage: "PRIMARY_CARE" },
  FOLLOW_UP: { label: "Follow-up visit", minutes: 20, coverage: "PRIMARY_CARE" },
  ANNUAL_PHYSICAL: { label: "Annual physical", minutes: 40, coverage: "PREVENTIVE" },
  SICK_VISIT: { label: "Sick visit", minutes: 20, coverage: "PRIMARY_CARE" },
};

export type CoverageClass = "PREVENTIVE" | "PRIMARY_CARE" | "SPECIALIST";

export const Department = {
  NURSE: "NURSE",
  PHARMACY: "PHARMACY",
  FRONT_DESK: "FRONT_DESK",
  BILLING: "BILLING",
} as const;
export type Department = (typeof Department)[keyof typeof Department];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  NURSE: "Nurse line",
  PHARMACY: "Prescription desk",
  FRONT_DESK: "Front desk",
  BILLING: "Billing team",
};

export const CallIntent = {
  BOOK: "BOOK",
  RESCHEDULE: "RESCHEDULE",
  CANCEL: "CANCEL",
  INSURANCE: "INSURANCE",
  REFILL: "REFILL",
  ESCALATION: "ESCALATION",
  OTHER: "OTHER",
} as const;
export type CallIntent = (typeof CallIntent)[keyof typeof CallIntent];

// ---------------------------------------------------------------------------
// Insurance eligibility
// ---------------------------------------------------------------------------

export interface PlanBenefits {
  active: boolean;
  inNetwork: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  primaryCopayCents: number;
  specialistCopayCents: number;
  preventiveCovered: boolean;
  deductibleCents: number;
  deductibleMetCents: number;
  coinsurancePct: number;
  // Visit types that need prior authorization on this plan.
  priorAuthVisitTypes: string[];
}

export interface EligibilityResult {
  eligible: boolean;
  inNetwork: boolean;
  priorAuthRequired: boolean;
  copayCents: number | null;
  deductibleRemainingCents: number;
  coinsurancePct: number;
  reasons: string[];
}

export function evaluateEligibility(plan: PlanBenefits, visitType: VisitType, on: Date = new Date()): EligibilityResult {
  const reasons: string[] = [];
  const deductibleRemainingCents = Math.max(0, plan.deductibleCents - plan.deductibleMetCents);
  const inWindow = plan.effectiveFrom <= on && (plan.effectiveTo === null || on <= plan.effectiveTo);

  if (!plan.active || !inWindow) {
    reasons.push(plan.active ? "Coverage is outside its effective dates" : "Coverage is inactive");
    return { eligible: false, inNetwork: plan.inNetwork, priorAuthRequired: false, copayCents: null, deductibleRemainingCents, coinsurancePct: plan.coinsurancePct, reasons };
  }
  if (!plan.inNetwork) {
    reasons.push("Clinic is out of network for this plan; out-of-network rates apply");
  }

  const coverage = VISIT_TYPE_INFO[visitType].coverage;
  let copayCents: number;
  if (coverage === "PREVENTIVE" && plan.preventiveCovered && plan.inNetwork) {
    copayCents = 0;
    reasons.push("Preventive visit covered in full");
  } else if (coverage === "SPECIALIST") {
    copayCents = plan.specialistCopayCents;
  } else {
    copayCents = plan.primaryCopayCents;
  }

  const priorAuthRequired = plan.priorAuthVisitTypes.includes(visitType);
  if (priorAuthRequired) reasons.push("Prior authorization required before this visit");

  return { eligible: true, inNetwork: plan.inNetwork, priorAuthRequired, copayCents, deductibleRemainingCents, coinsurancePct: plan.coinsurancePct, reasons };
}

// ---------------------------------------------------------------------------
// Prescription refills
// ---------------------------------------------------------------------------

export const RefillOutcome = {
  // Refills remain and the patient is current: sent straight to the pharmacy.
  SENT_TO_PHARMACY: "SENT_TO_PHARMACY",
  // No refills left: the prescriber must renew.
  PROVIDER_APPROVAL_REQUIRED: "PROVIDER_APPROVAL_REQUIRED",
  // Patient hasn't been seen within a year: needs a visit before renewal.
  VISIT_REQUIRED: "VISIT_REQUIRED",
  // Controlled substance or too-early refill: a clinician must handle it live.
  CLINICIAN_REVIEW: "CLINICIAN_REVIEW",
} as const;
export type RefillOutcome = (typeof RefillOutcome)[keyof typeof RefillOutcome];

export interface RefillInput {
  controlled: boolean;
  refillsRemaining: number;
  lastFilledAt: Date | null;
  daysSupply: number;
  lastVisitAt: Date | null;
}

export interface RefillDecision {
  outcome: RefillOutcome;
  escalate: boolean;
  reasons: string[];
}

const DAY_MS = 86_400_000;
// A refill is "too early" before 75% of the previous supply has elapsed.
const EARLY_REFILL_FRACTION = 0.75;

export function evaluateRefill(input: RefillInput, now: Date = new Date()): RefillDecision {
  if (input.controlled) {
    return { outcome: RefillOutcome.CLINICIAN_REVIEW, escalate: true, reasons: ["Controlled substance refills must be reviewed by a clinician"] };
  }
  if (input.lastFilledAt) {
    const elapsedDays = (now.getTime() - input.lastFilledAt.getTime()) / DAY_MS;
    if (elapsedDays < input.daysSupply * EARLY_REFILL_FRACTION) {
      return {
        outcome: RefillOutcome.CLINICIAN_REVIEW,
        escalate: true,
        reasons: [`Requested early: last filled ${Math.floor(elapsedDays)} days ago for a ${input.daysSupply}-day supply`],
      };
    }
  }
  if (!input.lastVisitAt || now.getTime() - input.lastVisitAt.getTime() > 365 * DAY_MS) {
    return { outcome: RefillOutcome.VISIT_REQUIRED, escalate: false, reasons: ["No visit in the last 12 months; an appointment is required"] };
  }
  if (input.refillsRemaining <= 0) {
    return { outcome: RefillOutcome.PROVIDER_APPROVAL_REQUIRED, escalate: false, reasons: ["No refills remaining; sent to the prescriber for renewal"] };
  }
  const left = input.refillsRemaining - 1;
  return { outcome: RefillOutcome.SENT_TO_PHARMACY, escalate: false, reasons: [`${left} refill${left === 1 ? "" : "s"} left after this one`] };
}

// ---------------------------------------------------------------------------
// Time helpers (clinic-local wall clock <-> UTC instants)
// ---------------------------------------------------------------------------

function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - instant.getTime();
}

// Convert a clinic-local wall-clock time to the UTC instant it represents.
export function clinicLocalToUtc(year: number, month: number, day: number, hour: number, minute = 0): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = tzOffsetMs(guess, CLINIC.timezone);
  const result = new Date(guess.getTime() - offset);
  // Correct across a DST boundary between the guess and the result.
  const offset2 = tzOffsetMs(result, CLINIC.timezone);
  return offset2 === offset ? result : new Date(guess.getTime() - offset2);
}

export function clinicLocalParts(instant: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const local = new Date(instant.getTime() + tzOffsetMs(instant, CLINIC.timezone));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    weekday: local.getUTCDay(),
  };
}

// Spoken-friendly rendering, e.g. "Tuesday, October 7 at 9:20 AM".
export function formatClinicTime(instant: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC.timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

export function formatCents(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Demo scenarios (synthetic patients seeded by packages/db/prisma/seed.ts)
// ---------------------------------------------------------------------------

export interface DemoScenario {
  id: string;
  intent: CallIntent;
  title: string;
  summary: string;
  patient: { name: string; dateOfBirth: string };
  script: string[];
  expected: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "book",
    intent: CallIntent.BOOK,
    title: "Book an appointment",
    summary: "Existing patient books an annual physical with her doctor.",
    patient: { name: "Maria Gonzalez", dateOfBirth: "March 14, 1985" },
    script: [
      "Hi, I'd like to book my annual physical.",
      "Maria Gonzalez, March 14th, 1985.",
      "Sometime next week, mornings work best.",
    ],
    expected: "Agent verifies identity, offers open slots with Dr. Patel, and books one.",
  },
  {
    id: "reschedule",
    intent: CallIntent.RESCHEDULE,
    title: "Reschedule / cancel",
    summary: "Patient moves one appointment and cancels another.",
    patient: { name: "James Carter", dateOfBirth: "November 2, 1972" },
    script: [
      "I need to move my appointment with Dr. Lee.",
      "James Carter, November 2nd, 1972.",
      "Can we do Friday afternoon instead? And please cancel my physical.",
    ],
    expected: "Agent finds both appointments, reschedules the follow-up, and cancels the physical.",
  },
  {
    id: "insurance",
    intent: CallIntent.INSURANCE,
    title: "Check insurance / eligibility",
    summary: "Patient asks whether her new plan covers a visit and what she'll owe.",
    patient: { name: "Priya Shah", dateOfBirth: "July 21, 1990" },
    script: [
      "I switched insurance, are you guys in network with my new plan?",
      "Priya Shah, July 21st, 1990.",
      "What would I pay for a regular sick visit? And is my physical covered?",
    ],
    expected: "Agent finds the active BCBS plan (old Cigna plan inactive) and explains copay, deductible, and coverage.",
  },
  {
    id: "refill",
    intent: CallIntent.REFILL,
    title: "Prescription refill + human escalation",
    summary: "Routine refill goes through; a controlled-substance refill is warm-transferred to a nurse.",
    patient: { name: "Robert Chen", dateOfBirth: "May 9, 1958" },
    script: [
      "I need refills on my lisinopril and my lorazepam.",
      "Robert Chen, May 9th, 1958.",
      "CVS on Main Street is fine.",
    ],
    expected: "Lisinopril is sent to the pharmacy; lorazepam is controlled, so the agent warm-transfers to the nurse line (open /staff to accept).",
  },
];
