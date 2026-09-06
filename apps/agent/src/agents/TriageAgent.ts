import { Agent, handoff, tool } from "@livekit/agents";
import { z } from "zod";
import { AgentName, CallPhase } from "@repo/shared";
import type { CallOrchestrator } from "../orchestrator/CallOrchestrator.js";







export function createTriageAgent(orchestrator: CallOrchestrator): Agent {
  const instructions = orchestrator.contextService.buildInstructions({
    roleInstructions: `You are the triage/receptionist assistant for a plaintiff law firm's automated intake line.
Greet the caller, briefly identify yourself as an automated intake assistant, and figure out why they're calling.
- If they describe a potential personal-injury incident (accident, injury, fall, workplace injury, dog bite, etc.), call begin_intake immediately — do not collect case details yourself.
  When you do, say only a short bridging line like "Let's get some details about that." NEVER tell the caller to hold,
  to wait, or that a specialist/person will reach out or take over — the questions continue immediately in this same
  conversation, and promising a callback that isn't happening would be a lie to the caller.
- If they ask something general you can answer briefly from policy (e.g. office hours), answer it, then ask if there's anything else; call end_call once they're done.
- If they explicitly ask for a human, or the situation is an emergency, abusive, or clearly out of scope, call request_human_handoff.
- You decide when the conversation is over: once the caller says goodbye, says they have nothing further, or clearly
  wants to stop, say a brief closing line and then call end_call. Do not leave the call hanging open.`,
    state: orchestrator.state,
    policyTopics: ["communication", "escalation"],
  });

  return Agent.create({
    instructions,
    tools: [
      tool({
        name: "begin_intake",
        description: "Hand off to the intake specialist once the caller has described a potential personal-injury case.",
        parameters: z.object({}),
        execute: async () => {
          const result = orchestrator.prepareHandoff(AgentName.INTAKE);
          if (!result) return "I'm not able to move to intake right now.";
          return handoff({ agent: result.agent, returns: "Continuing to intake." });
        },
      }),
      tool({
        name: "request_human_handoff",
        description: "Escalate to a human instead of continuing automated intake (caller asked for a human, emergency, abuse, or clearly out of scope).",
        parameters: z.object({ reason: z.string() }),
        execute: async ({ reason }) => {
          orchestrator.transitionPhase(CallPhase.HANDOFF_HUMAN, reason);
          await orchestrator.endCall("handoff_human", reason);
          return { handedOff: true };
        },
      }),
      orchestrator.tools.endCall(),
    ],
    onEnter: async (ctx) => {
      ctx.session.generateReply({
        instructions:
          "Greet the caller, identify yourself as an automated intake assistant for the firm, and ask how you can help today.",
      });
    },
  });
}
