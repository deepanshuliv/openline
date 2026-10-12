import { voice } from "@livekit/agents";
import type { CallSession } from "../../core/CallSession.js";
import type { Vertical } from "../../core/Vertical.js";
import { CLINIC_KEYTERMS, FILLERS, GOODBYE, GREETING, TOOL_BRIDGES, buildInstructions, transferIntroduction, transferTimedOut } from "./instructions.js";
import { createClinicTools } from "./tools.js";

export const clinicVertical: Vertical = {
  name: "clinic",
  agentLabel: "RECEPTIONIST",
  keyterms: CLINIC_KEYTERMS,
  phrases: { greeting: GREETING, fillers: FILLERS, toolBridges: TOOL_BRIDGES, goodbye: GOODBYE },
  fillerSkipTools: ["transfer_to_staff", "end_call"],
  transferScripts: {
    introduction: (staffName, req, callerName) => transferIntroduction(staffName, req.summary, req.departmentLabel, callerName),
    timedOut: (req) => transferTimedOut(req.departmentLabel),
  },
  createAgent: ({ call, transfer, phrases, callerReady }) =>
    voice.Agent.create<CallSession>({
      instructions: buildInstructions(),
      tools: createClinicTools(call, transfer),
      onEnter: async (ctx) => {
        // Not awaited: session start must finish (so the caller sees Suzi is
        // ready) before the caller presses OK. Fixed, pre-synthesized greeting:
        // no LLM and no TTS round-trip.
        void callerReady.then(() => phrases.say(ctx.session, GREETING));
      },
    }),
};
