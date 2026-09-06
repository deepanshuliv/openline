import { tool, type FunctionTool } from "@livekit/agents";
import {
  CallEventType,
  addCallNoteInputSchema,
  checkAppointmentAvailabilityInputSchema,
  createCallerInputSchema,
  createMatterInputSchema,
  endCallInputSchema,
  getCallerInputSchema,
  getMatterInputSchema,
  scheduleFollowUpInputSchema,
  updateMatterIntakeInputSchema,
} from "@repo/shared";
import type { AppointmentService } from "../services/AppointmentService.js";
import type { CallLogService } from "../services/CallLogService.js";
import type { CaseService } from "../services/CaseService.js";
import type { EventService } from "../services/EventService.js";
import type { CallState } from "../orchestrator/CallState.js";

export interface ToolRegistryDeps {
  state: CallState;
  eventService: EventService;
  caseService: CaseService;
  appointmentService: AppointmentService;
  callLogService: CallLogService;
  onEndCall: (reason: string, summary?: string | null) => Promise<void>;
}

const TOOL_DESCRIPTIONS = {
  get_caller:
    "Look up an existing caller by phone number. Also returns their most recent open matter if they've called before — pass that matterId to get_matter to load what was already collected, instead of asking again.",
  create_caller: "Create a new caller record. Only call after you have the caller's name and phone number.",
  create_matter: "Create a new matter (case) for a caller once you know the incident type.",
  update_matter_intake: "Persist newly-learned structured intake fields onto the current matter. Call this whenever the caller gives new facts — do not wait until the end of the call.",
  get_matter: "Retrieve the current structured state of a matter, including anything already collected in a previous call.",
  check_appointment_availability: "Get mock available follow-up call slots near the caller's preferred time. Always call this before offering a specific time.",
  schedule_follow_up: "Book a follow-up call appointment on a specific slot returned by check_appointment_availability.",
  add_call_note: "Record a free-text note on the call for a human reviewer (does not replace structured fields).",
  end_call: "End the call. Call this once you have said your goodbye to the caller.",
} as const;









export class ToolRegistry {
  constructor(private readonly deps: ToolRegistryDeps) {}





  private wrap<Args extends Record<string, any>, Result>(
    name: keyof typeof TOOL_DESCRIPTIONS,
    parameters: Parameters<typeof tool>[0]["parameters"],
    handler: (args: Args) => Promise<Result>,
  ): FunctionTool<Args, unknown, Result | { error: string }> {
    const { state, eventService } = this.deps;
    return tool({
      name,
      description: TOOL_DESCRIPTIONS[name],
      parameters,
      execute: async (args) => {
        const start = Date.now();
        await eventService.emit(CallEventType.TOOL_STARTED, {
          agent: state.activeAgent,
          phase: state.currentPhase,
          metadata: { tool: name, input: args },
        });
        try {
          const result = await handler(args as Args);
          await eventService.emit(CallEventType.TOOL_COMPLETED, {
            agent: state.activeAgent,
            phase: state.currentPhase,
            durationMs: Date.now() - start,
            metadata: { tool: name, output: result as Record<string, unknown> },
          });
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await eventService.emit(CallEventType.TOOL_FAILED, {
            agent: state.activeAgent,
            phase: state.currentPhase,
            durationMs: Date.now() - start,
            metadata: { tool: name, error: message },
          });
          return { error: message };
        }
      },
    }) as FunctionTool<Args, unknown, Result | { error: string }>;
  }

  getCaller() {
    return this.wrap("get_caller", getCallerInputSchema, async (args: { phone: string }) => {
      const caller = await this.deps.caseService.findCallerByPhone(args.phone.trim());
      if (!caller) return { found: false, callerId: null, name: null, email: null, existingMatter: null };
      this.deps.state.callerId = caller.id;
      this.deps.state.callerContact = { name: caller.name, phone: caller.phone, email: caller.email };




      const existing = caller.matters[0];
      if (existing) {
        this.deps.state.matterId = existing.id;
        await this.deps.callLogService.attachCallerAndMatter(this.deps.state.callId, {
          callerId: caller.id,
          matterId: existing.id,
        });
      } else {
        await this.deps.callLogService.attachCallerAndMatter(this.deps.state.callId, { callerId: caller.id });
      }

      return {
        found: true,
        callerId: caller.id,
        name: caller.name,
        email: caller.email,
        existingMatter: existing
          ? { matterId: existing.id, incidentType: existing.incidentType, status: existing.status }
          : null,
      };
    });
  }

  createCaller() {
    return this.wrap("create_caller", createCallerInputSchema, async (args: { name: string; phone: string; email?: string | null }) => {
      const caller = await this.deps.caseService.createCaller(args);
      this.deps.state.callerId = caller.id;
      this.deps.state.callerContact = { name: caller.name, phone: caller.phone, email: caller.email };
      await this.deps.callLogService.attachCallerAndMatter(this.deps.state.callId, { callerId: caller.id });
      return { callerId: caller.id };
    });
  }

  createMatter() {
    return this.wrap("create_matter", createMatterInputSchema, async (args: { callerId: string; matterType: string }) => {
      const matter = await this.deps.caseService.createMatter(args);
      this.deps.state.matterId = matter.id;
      this.deps.state.mergeIntakeFields({ incidentType: matter.incidentType as never });
      await this.deps.callLogService.attachCallerAndMatter(this.deps.state.callId, { matterId: matter.id });


      if (Object.keys(this.deps.state.collectedFields).length > 0) {
        await this.deps.caseService.updateIntake(matter.id, this.deps.state.collectedFields);
      }
      return { matterId: matter.id };
    });
  }

  updateMatterIntake() {
    return this.wrap(
      "update_matter_intake",
      updateMatterIntakeInputSchema,
      async (args: { matterId: string; fields: Record<string, unknown> }) => {
        const updatedFields = this.deps.state.mergeIntakeFields(args.fields as never);
        await this.deps.caseService.updateIntake(args.matterId, args.fields as never);
        return { matterId: args.matterId, updatedFields, missingRequiredFields: this.deps.state.missingRequiredFields };
      },
    );
  }

  getMatter() {
    return this.wrap("get_matter", getMatterInputSchema, async (args: { matterId: string }) => {
      const matter = await this.deps.caseService.getMatter(args.matterId);
      if (!matter) return { matterId: null, found: false, status: null, qualificationStatus: null, fields: null };

      this.deps.state.mergeIntakeFields({
        incidentType: matter.incidentType as never,
        incidentDate: matter.incidentDate?.toISOString().slice(0, 10) ?? null,
        incidentLocation: matter.incidentLocation,
        incidentDescription: matter.incidentDescription,
        injuries: matter.injuries,
        treatmentReceived: matter.treatmentReceived,
        emergencyServicesInvolved: matter.emergencyServicesInvolved,
        policeReport: matter.policeReport,
        insuranceInformation: matter.insuranceInformation,
        otherPartyInformation: matter.otherPartyInformation,
        witnesses: matter.witnesses,
        lostWages: matter.lostWages,
        representedByAttorney: matter.representedByAttorney,
      });
      return {
        matterId: matter.id,
        found: true,
        status: matter.status,
        qualificationStatus: matter.qualificationStatus,
        fields: this.deps.state.collectedFields,
      };
    });
  }

  checkAppointmentAvailability() {
    return this.wrap(
      "check_appointment_availability",
      checkAppointmentAvailabilityInputSchema,
      async (args: { preferredWindowStart: string }) => ({
        slots: this.deps.appointmentService.checkAvailability(args.preferredWindowStart),
      }),
    );
  }

  scheduleFollowUp() {
    return this.wrap(
      "schedule_follow_up",
      scheduleFollowUpInputSchema,
      async (args: { matterId: string; slotId: string; appointmentRequestId: string }) =>
        this.deps.appointmentService.scheduleFollowUp({ ...args, callId: this.deps.state.callId }),
    );
  }

  addCallNote() {
    return this.wrap("add_call_note", addCallNoteInputSchema, async (args: { callId: string; note: string }) => {
      if (this.deps.state.matterId) {
        await this.deps.caseService.appendNote(this.deps.state.matterId, args.note);
      }
      await this.deps.eventService.emit(CallEventType.CALL_NOTE, {
        agent: this.deps.state.activeAgent,
        phase: this.deps.state.currentPhase,
        metadata: { note: args.note },
      });
      return { saved: true };
    });
  }

  endCall() {
    return this.wrap("end_call", endCallInputSchema, async (args: { reason: string; summary?: string | null }) => {
      await this.deps.onEndCall(args.reason, args.summary ?? null);
      return { ended: true, reason: args.reason };
    });
  }
}
