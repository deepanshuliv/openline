import { Agent } from "@livekit/agents";
import type { CallOrchestrator } from "../orchestrator/CallOrchestrator.js";







export function createSchedulingAgent(orchestrator: CallOrchestrator): Agent {
  const instructions = orchestrator.contextService.buildInstructions({
    roleInstructions: `You schedule a follow-up call for a qualified caller. Ask for their preferred day/time window,
then call check_appointment_availability — never invent a time slot yourself. Read back the offered slots and let the
caller pick one, then call schedule_follow_up with that exact slot. Once booked, confirm the date/time back to the
caller, thank them, briefly summarize the case in one sentence (no legal conclusions), and call end_call with a short
summary. If the caller declines a follow-up, that's fine — thank them and call end_call.`,
    state: orchestrator.state,
    policyTopics: ["appointment", "communication"],
  });

  return Agent.create({
    instructions,
    tools: [
      orchestrator.tools.checkAppointmentAvailability(),
      orchestrator.tools.scheduleFollowUp(),
      orchestrator.tools.addCallNote(),
      orchestrator.tools.endCall(),
    ],


    onEnter: async (ctx) => {
      ctx.session.generateReply({
        instructions:
          "You have just taken over to book a follow-up call. Do not greet the caller again and " +
          "do not tell them to hold. Ask what day and rough time of day suits them best for a " +
          "follow-up call with the firm.",
      });
    },
  });
}
