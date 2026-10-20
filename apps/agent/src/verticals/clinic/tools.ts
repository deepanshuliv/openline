import { z } from "zod";
import {
  CallEventType,
  CallIntent,
  CallPhase,
  DEPARTMENT_LABELS,
  Department,
  RefillOutcome,
  VISIT_TYPE_INFO,
  VisitType,
  clinicLocalToUtc,
  formatCents,
  formatClinicTime,
} from "@repo/shared";
import type { CallSession } from "../../core/CallSession.js";
import { ToolUserError, instrumentedTool } from "../../core/instrumentedTool.js";
import type { WarmTransfer } from "../../core/WarmTransfer.js";
import { CoverageService } from "./services/CoverageService.js";
import { PatientDirectory } from "./services/PatientDirectory.js";
import { PrescriptionService } from "./services/PrescriptionService.js";
import { SchedulingService, SlotUnavailableError, VisitTypeMismatchError, WEEKDAY_NAMES, type Slot } from "./services/SchedulingService.js";

const MAX_VERIFY_ATTEMPTS = 3;

const visitTypeSchema = z.enum(Object.values(VisitType) as [VisitType, ...VisitType[]]);
const departmentSchema = z.enum(Object.values(Department) as [Department, ...Department[]]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

// Short handles (S1, A1, M1) are what the model sees and passes back. They map
// to real rows per call, so the model can't invent a time or an ID.
class HandleMap<T> {
  private map = new Map<string, T>();
  constructor(private readonly prefix: string) {}
  reset(items: T[]): string[] {
    this.map.clear();
    return items.map((item, i) => {
      const handle = `${this.prefix}${i + 1}`;
      this.map.set(handle, item);
      return handle;
    });
  }
  // Accepts "S1", " s1 ", or a bare "1".
  get(handle: string): T | undefined {
    const h = handle.trim().toUpperCase();
    return this.map.get(/^\d+$/.test(h) ? `${this.prefix}${h}` : h);
  }
}

// A YYYY-MM-DD date as the clinic-local start or end of that day.
function clinicDay(iso: string, end: boolean): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return end ? clinicLocalToUtc(y, m, d, 23, 59) : clinicLocalToUtc(y, m, d, 0, 0);
}

export function createClinicTools(call: CallSession, transfer: WarmTransfer) {
  const patients = new PatientDirectory();
  const scheduling = new SchedulingService();
  const coverage = new CoverageService();
  const prescriptions = new PrescriptionService();

  const slots = new HandleMap<Slot>("S");
  const appointments = new HandleMap<{ id: string; startsAt: Date; providerName: string; visitType: string }>("A");
  let verifyAttempts = 0;
  // Details of a caller with no record. They become a patient only when they
  // book, so a caller who then says "I already have a booking" (and spells their
  // name to be found) leaves no stray record behind.
  let newPatient: { firstName: string; lastName: string; dateOfBirth: string } | null = null;
  let notFoundCount = 0;

  const requirePatient = (): string => {
    if (!call.patientId) throw new ToolUserError("The caller is not verified yet. Ask for their full name and date of birth, then call verify_patient.");
    return call.patientId;
  };

  // The patient a booking is for: registers a pending new patient on first use.
  const bookingPatient = async (): Promise<string> => {
    if (!newPatient) return requirePatient();
    const created = await patients.register(newPatient);
    if (!created) throw new ToolUserError("The caller's details aren't usable. Ask once for their full first and last name and birth date, then call verify_patient.");
    await call.attachPatient(created.id, `${created.firstName} ${created.lastName}`);
    newPatient = null;
    return created.id;
  };

  const serving = () => {
    if (call.phase === CallPhase.GREETING || call.phase === CallPhase.IDENTIFYING) call.transitionPhase(CallPhase.SERVING, "request in progress");
  };

  return [
    instrumentedTool(call, {
      name: "verify_patient",
      description:
        "Look up the caller by full name and date of birth. Required before booking or before discussing or changing any appointment, insurance, or prescription. With no record on file, the caller can still book as a new patient.",
      parameters: z.object({
        first_name: z.string().min(1),
        last_name: z.string().min(1),
        date_of_birth: isoDate.describe("Caller's date of birth as YYYY-MM-DD"),
      }),
      execute: async ({ first_name, last_name, date_of_birth }) => {
        if (verifyAttempts >= MAX_VERIFY_ATTEMPTS) {
          return {
            verified: false,
            message: newPatient
              ? "Too many lookups. Don't ask for their details again; book a new patient visit."
              : "Too many attempts. Offer to transfer the caller to the front desk.",
          };
        }
        verifyAttempts += 1;
        call.transitionPhase(CallPhase.IDENTIFYING, "verifying caller");
        const input = { firstName: first_name, lastName: last_name, dateOfBirth: date_of_birth };
        const patient = await patients.verify(input);
        if (!patient) {
          if (!patients.canRegister(input)) {
            return { verified: false, message: "That name or birth date isn't usable. Ask once for their full first and last name and birth date." };
          }
          // No record (or the transcript garbled the name): don't loop on
          // read-backs. They book as a new patient unless they say they already
          // have a booking, in which case one spelled retry is allowed.
          newPatient = input;
          notFoundCount += 1;
          call.transitionPhase(CallPhase.SERVING, "no record, new patient");
          appointments.reset([]);
          return {
            verified: false,
            new_patient: true,
            message:
              notFoundCount === 1
                ? "No entry found. Say: \"There's no entry under that name, so I'll create a new one for you with your new appointment.\" Then book a NEW_PATIENT visit. If the caller says they already have a booking or appointment, ask them once to spell their first and last name, join the letters, and call verify_patient again with the spelled name and the same birth date."
                : "Still no entry. Say in one short sentence you couldn't find a booking under that name either, so you'll book a new appointment. Don't ask for their details again; book a NEW_PATIENT visit.",
          };
        }
        newPatient = null;
        await call.attachPatient(patient.id, `${patient.firstName} ${patient.lastName}`);
        call.transitionPhase(CallPhase.SERVING, "caller verified");
        // Include upcoming visits and medications so the next turn needs no extra lookup.
        const [upcoming, meds] = await Promise.all([scheduling.upcomingFor(patient.id), prescriptions.activeFor(patient.id)]);
        const handles = appointments.reset(upcoming.map((a) => ({ id: a.id, startsAt: a.startsAt, providerName: a.provider.name, visitType: a.visitType })));
        return {
          verified: true,
          firstName: patient.firstName,
          primaryProvider: patient.primaryProvider?.name ?? null,
          preferredPharmacy: patient.preferredPharmacy,
          upcoming_appointments: upcoming.map((a, i) => ({
            appointment_id: handles[i],
            when: formatClinicTime(a.startsAt),
            provider: a.provider.name,
            visit: VISIT_TYPE_INFO[a.visitType as VisitType]?.label ?? a.visitType,
          })),
          medications: meds.map((m) => `${m.drugName} ${m.strength}`),
          next_step:
            upcoming.length > 0
              ? "Only if the caller explicitly said they already have an appointment, help with the matching one from upcoming_appointments. Otherwise book a new visit."
              : "No upcoming appointments on file. If they mentioned one, say in one short sentence you couldn't find it. Book a new visit.",
        };
      },
    }),

    instrumentedTool(call, {
      name: "find_appointment_slots",
      description: "Find open appointment times. Call before offering any time. Returns up to 3 slots with handles like S1 to pass to book_appointment or reschedule_appointment.",
      parameters: z.object({
        visit_type: visitTypeSchema.describe("ANNUAL_PHYSICAL, FOLLOW_UP, SICK_VISIT, or NEW_PATIENT"),
        provider_name: z.string().nullish().describe("Provider the caller asked for; omit for any provider"),
        earliest_date: isoDate.nullish(),
        latest_date: isoDate.nullish(),
        part_of_day: z.enum(["morning", "afternoon", "any"]).nullish(),
      }),
      execute: async ({ visit_type, provider_name, earliest_date, latest_date, part_of_day }) => {
        serving();
        call.recordIntent(CallIntent.BOOK);
        const match = provider_name ? await scheduling.findProviderByName(provider_name) : "any";
        if (!match) throw new ToolUserError(`No provider named ${provider_name}. Our providers are Dr. Anita Patel, Dr. Marcus Lee, and Sarah Kim, NP.`);
        const provider = match === "any" ? null : match;
        // Models sometimes swap the bounds; treat the pair as a range either way.
        const [early, late] = earliest_date && latest_date && earliest_date > latest_date ? [latest_date, earliest_date] : [earliest_date, latest_date];
        const found = await scheduling.findSlots({
          visitType: visit_type,
          providerId: provider?.id,
          from: early ? clinicDay(early, false) : undefined,
          to: late ? clinicDay(late, true) : undefined,
          partOfDay: part_of_day ?? "any",
          patientId: call.patientId,
        });
        if (found.length === 0) {
          const days = provider ? ` ${provider.name} works ${provider.workDays.map((d) => WEEKDAY_NAMES[d]).join(", ")}.` : "";
          return { slots: [], message: `Nothing open in that range.${days} Offer a wider date range or another provider.` };
        }
        const handles = slots.reset(found);
        return { slots: found.map((s, i) => ({ slot_id: handles[i], provider: s.providerName, when: formatClinicTime(s.startsAt) })) };
      },
    }),

    instrumentedTool(call, {
      name: "book_appointment",
      description: "Book one of the slots returned by find_appointment_slots after the caller picks it. Also books for a new caller after verify_patient found no entry.",
      parameters: z.object({ slot_id: z.string(), reason: z.string().describe("Short reason for the visit in the caller's words") }),
      execute: async ({ slot_id, reason }) => {
        if (!newPatient) requirePatient();
        const slot = slots.get(slot_id);
        if (!slot) throw new ToolUserError("Unknown slot. Call find_appointment_slots again and offer fresh times.");
        // Registers a caller with no entry only now, once the booking is real.
        const patientId = await bookingPatient();
        try {
          const appt = await scheduling.book({ patientId, slot, reason, callId: call.callId });
          const spoken = formatClinicTime(appt.startsAt);
          void call.emit(CallEventType.APPOINTMENT_BOOKED, { appointmentId: appt.id, provider: appt.provider.name, startsAt: appt.startsAt.toISOString(), visitType: appt.visitType, spoken });
          return { booked: true, when: spoken, provider: appt.provider.name, visit: VISIT_TYPE_INFO[slot.visitType].label, arrive: "10 minutes early with photo ID and insurance card" };
        } catch (err) {
          if (err instanceof SlotUnavailableError) throw new ToolUserError(`${err.message} Find new slots and offer them.`);
          throw err;
        }
      },
    }),

    instrumentedTool(call, {
      name: "list_my_appointments",
      description: "List the verified caller's upcoming appointments, with handles like A1 for rescheduling or cancelling.",
      parameters: z.object({}),
      execute: async () => {
        const patientId = requirePatient();
        serving();
        call.recordIntent(CallIntent.RESCHEDULE);
        const upcoming = await scheduling.upcomingFor(patientId);
        const handles = appointments.reset(upcoming.map((a) => ({ id: a.id, startsAt: a.startsAt, providerName: a.provider.name, visitType: a.visitType })));
        return {
          appointments: upcoming.map((a, i) => ({
            appointment_id: handles[i],
            when: formatClinicTime(a.startsAt),
            provider: a.provider.name,
            visit: VISIT_TYPE_INFO[a.visitType as VisitType]?.label ?? a.visitType,
          })),
        };
      },
    }),

    instrumentedTool(call, {
      name: "reschedule_appointment",
      description: "Move an appointment (handle from list_my_appointments) to a new slot (handle from find_appointment_slots). Confirm with the caller first.",
      parameters: z.object({ appointment_id: z.string(), slot_id: z.string() }),
      execute: async ({ appointment_id, slot_id }) => {
        const patientId = requirePatient();
        const appt = appointments.get(appointment_id);
        const slot = slots.get(slot_id);
        if (!appt) throw new ToolUserError("Unknown appointment. Call list_my_appointments first.");
        if (!slot) throw new ToolUserError("Unknown slot. Call find_appointment_slots first.");
        if (slot.visitType !== appt.visitType) throw new ToolUserError(`That slot is for a different visit length. Call find_appointment_slots with visit_type ${appt.visitType}, then offer those times.`);
        call.recordIntent(CallIntent.RESCHEDULE);
        try {
          const { previous, next } = await scheduling.reschedule({ appointmentId: appt.id, patientId, slot, callId: call.callId });
          const spoken = formatClinicTime(next.startsAt);
          void call.emit(CallEventType.APPOINTMENT_RESCHEDULED, {
            appointmentId: next.id,
            previousStartsAt: previous.startsAt.toISOString(),
            startsAt: next.startsAt.toISOString(),
            provider: next.provider.name,
            spoken,
          });
          return { rescheduled: true, from: formatClinicTime(previous.startsAt), to: spoken, provider: next.provider.name };
        } catch (err) {
          if (err instanceof SlotUnavailableError) throw new ToolUserError(`${err.message} Nothing was changed. Find new slots and offer them.`);
          if (err instanceof VisitTypeMismatchError) throw new ToolUserError(`${err.message} Nothing was changed.`);
          throw err;
        }
      },
    }),

    instrumentedTool(call, {
      name: "cancel_appointment",
      description: "Cancel an appointment (handle from list_my_appointments). Confirm with the caller first.",
      parameters: z.object({ appointment_id: z.string(), reason: z.string().nullish() }),
      execute: async ({ appointment_id, reason }) => {
        const patientId = requirePatient();
        const appt = appointments.get(appointment_id);
        if (!appt) throw new ToolUserError("Unknown appointment. Call list_my_appointments first.");
        call.recordIntent(CallIntent.CANCEL);
        const cancelled = await scheduling.cancel({ appointmentId: appt.id, patientId, reason: reason ?? null });
        if (!cancelled) throw new ToolUserError("That appointment is already cancelled or has changed.");
        void call.emit(CallEventType.APPOINTMENT_CANCELLED, { appointmentId: cancelled.id, startsAt: cancelled.startsAt.toISOString(), provider: cancelled.provider.name });
        return { cancelled: true, when: formatClinicTime(cancelled.startsAt), provider: cancelled.provider.name };
      },
    }),

    instrumentedTool(call, {
      name: "check_insurance",
      description: "Check the verified caller's insurance on file: whether the clinic is in network, coverage status, and estimated cost for a visit type.",
      parameters: z.object({ visit_type: visitTypeSchema.nullish().describe("Visit they are asking about; defaults to SICK_VISIT") }),
      execute: async ({ visit_type }) => {
        const patientId = requirePatient();
        serving();
        call.recordIntent(CallIntent.INSURANCE);
        const visitType = visit_type ?? VisitType.SICK_VISIT;
        const { evaluated, billable } = await coverage.check(patientId, visitType);
        if (evaluated.length === 0) return { plans: [], message: "No insurance on file. Offer to transfer to billing to add it." };

        for (const { plan, result } of evaluated) {
          if (plan !== billable?.plan && plan.active) continue;
          void call.emit(CallEventType.INSURANCE_CHECKED, {
            payer: plan.payer,
            planName: plan.planName,
            eligible: result.eligible,
            inNetwork: result.inNetwork,
            copayCents: result.copayCents,
            deductibleRemainingCents: result.deductibleRemainingCents,
            coinsurancePct: result.coinsurancePct,
            priorAuthRequired: result.priorAuthRequired,
            visitType,
            reasons: result.reasons,
          });
        }
        return {
          visit: VISIT_TYPE_INFO[visitType].label,
          plans: evaluated.map(({ plan, result }) => ({
            plan: `${plan.payer} ${plan.planName}`,
            member_id_last4: plan.memberId.slice(-4),
            eligible: result.eligible,
            in_network: result.inNetwork,
            copay: result.copayCents === null ? null : formatCents(result.copayCents),
            deductible_remaining: formatCents(result.deductibleRemainingCents),
            coinsurance: `${result.coinsurancePct}%`,
            prior_auth_required: result.priorAuthRequired,
            notes: result.reasons,
          })),
          disclaimer: "Estimates only; final cost depends on services provided.",
        };
      },
    }),

    instrumentedTool(call, {
      name: "list_medications",
      description: "List the verified caller's active prescriptions.",
      parameters: z.object({}),
      execute: async () => {
        const patientId = requirePatient();
        serving();
        call.recordIntent(CallIntent.REFILL);
        const meds = await prescriptions.activeFor(patientId);
        return { medications: meds.map((m) => ({ name: m.drugName, strength: m.strength, refills_left: m.refillsRemaining })) };
      },
    }),

    instrumentedTool(call, {
      name: "request_refill",
      description: "Request a refill for ONE of the caller's medications, by drug name. Call once per medication. Clinic rules decide the outcome.",
      parameters: z.object({
        medication_name: z.string().min(3).describe("Drug name as on file, e.g. 'Lisinopril'"),
        pharmacy: z.string().nullish().describe("Only if the caller names a different pharmacy"),
      }),
      execute: async ({ medication_name, pharmacy }) => {
        const patientId = requirePatient();
        const words = medication_name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
        // Exact drug-name word match only ("my lisinopril 10 mg."); never guess between drugs.
        const med = (await prescriptions.activeFor(patientId)).find((m) => words.includes(m.drugName.toLowerCase()));
        if (!med) throw new ToolUserError(`${medication_name} is not on the caller's active medication list. Ask them to confirm the name.`);
        call.recordIntent(CallIntent.REFILL);
        const result = await prescriptions.requestRefill({ patientId, prescriptionId: med.id, pharmacy: pharmacy ?? null, callId: call.callId });
        if (!result) throw new ToolUserError("That prescription is no longer active. Offer the nurse line.");
        const { decision, pharmacy: usedPharmacy } = result;
        void call.emit(CallEventType.REFILL_REQUESTED, { drugName: med.drugName, outcome: decision.outcome, escalate: decision.escalate, reasons: decision.reasons });
        return {
          medication: med.drugName,
          outcome: decision.outcome,
          pharmacy: usedPharmacy,
          next_step: REFILL_GUIDANCE[decision.outcome],
        };
      },
    }),

    instrumentedTool(call, {
      name: "transfer_to_staff",
      description:
        "Warm-transfer the caller to a live staff member. Use when a refill needs clinician review, for medical questions or symptoms, billing disputes, or when the caller asks for a person.",
      parameters: z.object({
        department: departmentSchema.describe("NURSE for clinical/medication questions, PHARMACY for prescription desk, BILLING, or FRONT_DESK"),
        reason: z.string().describe("One short phrase, e.g. 'controlled substance refill'"),
        summary: z.string().describe("Two sentences for the staff member: who the caller is and exactly what they need"),
      }),
      execute: async ({ department, reason, summary }) => {
        call.recordIntent(CallIntent.ESCALATION);
        const { alreadyPending } = await transfer.request({ department, departmentLabel: DEPARTMENT_LABELS[department], reason, summary });
        return {
          status: alreadyPending ? "already_waiting" : "queued",
          next_step: `Tell the caller you're connecting them to the ${DEPARTMENT_LABELS[department].toLowerCase()} and to stay on the line. Nobody has picked up yet; if they speak while waiting, just say you're still connecting them.`,
        };
      },
    }),

    instrumentedTool(call, {
      name: "end_call",
      description: "End the call when the caller says goodbye or has nothing else. Plays the goodbye automatically; say nothing else.",
      parameters: z.object({ summary: z.string().describe("One sentence summary of what was done on this call") }),
      execute: async ({ summary }) => {
        if (transfer.isPending) return { ended: false, message: "A transfer is in progress; stay on the line." };
        await call.endCall("agent_ended", summary);
        return { ended: true };
      },
    }),
  ];
}

const REFILL_GUIDANCE: Record<RefillOutcome, string> = {
  SENT_TO_PHARMACY: "Tell them it was sent to their pharmacy and is usually ready within 24 hours.",
  PROVIDER_APPROVAL_REQUIRED: "Tell them there are no refills left, so it was sent to their doctor to renew; expect a decision within 2 business days.",
  VISIT_REQUIRED: "Tell them the doctor needs to see them before renewing, and offer to book a follow-up visit.",
  CLINICIAN_REVIEW: "This needs a clinician. Explain briefly why, then call transfer_to_staff with department NURSE.",
};
