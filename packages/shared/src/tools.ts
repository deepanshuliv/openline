import { z } from "zod";
import { intakeFieldsSchema } from "./intake.js";

/**
 * Typed input/output contracts for every tool (CLAUDE.md §9). ToolRegistry
 * validates against these before touching the database, and the same
 * schemas are used to generate the JSON-schema the LLM sees — one
 * definition, no drift between "what the model is told" and "what we accept".
 */

export const getCallerInputSchema = z.object({
  phone: z.string().describe("Phone number in any format; will be normalized"),
});
export const getCallerOutputSchema = z.object({
  found: z.boolean(),
  callerId: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  /** Most recent still-open matter, so a returning caller resumes it instead of opening a duplicate. */
  existingMatter: z
    .object({ matterId: z.string(), incidentType: z.string().nullable(), status: z.string() })
    .nullable(),
});

export const createCallerInputSchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable().optional(),
});
export const createCallerOutputSchema = z.object({
  callerId: z.string(),
});

export const createMatterInputSchema = z.object({
  callerId: z.string(),
  matterType: z.string(),
});
export const createMatterOutputSchema = z.object({
  matterId: z.string(),
});

export const updateMatterIntakeInputSchema = z.object({
  matterId: z.string(),
  fields: intakeFieldsSchema,
});
export const updateMatterIntakeOutputSchema = z.object({
  matterId: z.string(),
  updatedFields: z.array(z.string()),
  missingRequiredFields: z.array(z.string()),
});

export const getMatterInputSchema = z.object({
  matterId: z.string(),
});
export const getMatterOutputSchema = z.object({
  matterId: z.string().nullable(),
  found: z.boolean(),
  status: z.string().nullable(),
  qualificationStatus: z.string().nullable(),
  fields: intakeFieldsSchema.nullable(),
});

export const checkAppointmentAvailabilityInputSchema = z.object({
  preferredWindowStart: z.string().describe("ISO datetime, start of the caller's preferred window"),
  preferredWindowEnd: z.string().describe("ISO datetime, end of the caller's preferred window").nullable().optional(),
});
export const availabilitySlotSchema = z.object({
  slotId: z.string(),
  startsAt: z.string(),
});
export const checkAppointmentAvailabilityOutputSchema = z.object({
  slots: z.array(availabilitySlotSchema),
});

export const scheduleFollowUpInputSchema = z.object({
  matterId: z.string(),
  slotId: z.string(),
  appointmentRequestId: z.string().describe("Idempotency key supplied by the caller/agent for this specific request"),
});
export const scheduleFollowUpOutputSchema = z.object({
  appointmentId: z.string(),
  scheduledAt: z.string(),
  status: z.string(),
  idempotent: z.boolean().describe("true if this returned an existing appointment instead of creating a new one"),
});

export const addCallNoteInputSchema = z.object({
  callId: z.string(),
  note: z.string(),
});
export const addCallNoteOutputSchema = z.object({
  saved: z.boolean(),
});

export const endCallInputSchema = z.object({
  reason: z.string(),
  summary: z.string().nullable().optional(),
});
export const endCallOutputSchema = z.object({
  ended: z.boolean(),
  reason: z.string(),
});

export const TOOL_NAMES = [
  "get_caller",
  "create_caller",
  "create_matter",
  "update_matter_intake",
  "get_matter",
  "check_appointment_availability",
  "schedule_follow_up",
  "add_call_note",
  "end_call",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
