import { z } from "zod";

/**
 * Structured intake fields (CLAUDE.md §10 Matter, §15 structured extraction).
 * The LLM only ever produces data shaped like this via a JSON-schema
 * constrained response; nothing free-form ever reaches Postgres.
 * All fields are optional/nullable because intake is collected incrementally
 * across many turns — a partial update should never fail validation.
 */
export const incidentTypeEnum = z.enum([
  "motor_vehicle_accident",
  "slip_and_fall",
  "workplace_injury",
  "medical_malpractice",
  "product_liability",
  "dog_bite",
  "other",
]);
export type IncidentType = z.infer<typeof incidentTypeEnum>;

export const SUPPORTED_INCIDENT_TYPES: IncidentType[] = [
  "motor_vehicle_accident",
  "slip_and_fall",
  "workplace_injury",
  "dog_bite",
];

export const intakeFieldsSchema = z.object({
  incidentType: incidentTypeEnum.nullable().optional(),
  incidentDate: z
    .string()
    .describe("ISO date (YYYY-MM-DD) if the caller gave or implied a specific date, else null")
    .nullable()
    .optional(),
  incidentLocation: z.string().nullable().optional(),
  incidentDescription: z.string().nullable().optional(),
  injuries: z.array(z.string()).optional(),
  treatmentReceived: z.string().nullable().optional(),
  emergencyServicesInvolved: z.boolean().nullable().optional(),
  policeReport: z.boolean().nullable().optional(),
  insuranceInformation: z.string().nullable().optional(),
  otherPartyInformation: z.string().nullable().optional(),
  witnesses: z.string().nullable().optional(),
  lostWages: z.boolean().nullable().optional(),
  representedByAttorney: z.boolean().nullable().optional(),
});

export type IntakeFields = z.infer<typeof intakeFieldsSchema>;

export const REQUIRED_INTAKE_FIELDS: (keyof IntakeFields)[] = [
  "incidentType",
  "incidentDate",
  "incidentLocation",
  "incidentDescription",
  "injuries",
];

export const callerContactSchema = z.object({
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});
export type CallerContact = z.infer<typeof callerContactSchema>;

/** Deterministic qualification rules (CLAUDE.md §7 QualificationAgent, §34). */
export const QualificationStatus = {
  PENDING: "PENDING",
  QUALIFIED: "QUALIFIED",
  INSUFFICIENT: "INSUFFICIENT",
  DISQUALIFIED: "DISQUALIFIED",
} as const;
export type QualificationStatus = (typeof QualificationStatus)[keyof typeof QualificationStatus];

export interface QualificationInput {
  incidentType: IncidentType | null | undefined;
  incidentDate: string | null | undefined;
  injuries: string[] | undefined;
  representedByAttorney: boolean | null | undefined;
}

export interface QualificationResult {
  status: QualificationStatus;
  reasons: string[];
}

/**
 * Pure, deterministic function — no LLM involved. Called by
 * QualificationAgent after IntakeAgent has extracted facts. Kept here so
 * both the agent runtime and unit tests import the exact same logic.
 */
export function evaluateQualification(input: QualificationInput): QualificationResult {
  const reasons: string[] = [];

  const hasInjury = (input.injuries?.length ?? 0) > 0;
  if (!hasInjury) reasons.push("no_injury_reported");

  const supportedType = input.incidentType != null && SUPPORTED_INCIDENT_TYPES.includes(input.incidentType);
  if (!supportedType) reasons.push("incident_type_not_supported");

  const dateKnown = Boolean(input.incidentDate);
  if (!dateKnown) reasons.push("incident_date_unknown");

  if (input.representedByAttorney === true) {
    return { status: QualificationStatus.DISQUALIFIED, reasons: ["already_represented_by_attorney"] };
  }

  if (hasInjury && supportedType && dateKnown) {
    return { status: QualificationStatus.QUALIFIED, reasons: [] };
  }

  return { status: QualificationStatus.INSUFFICIENT, reasons };
}
