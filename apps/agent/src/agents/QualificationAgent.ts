import { Agent, handoff, tool } from "@livekit/agents";
import { z } from "zod";
import { AgentName, QualificationStatus } from "@repo/shared";
import type { CallOrchestrator } from "../orchestrator/CallOrchestrator.js";







export function createQualificationAgent(orchestrator: CallOrchestrator): Agent {
  const instructions = orchestrator.contextService.buildInstructions({
    roleInstructions: `You explain the result of an automatic case-qualification check to the caller in plain, non-legal
language. Never state or imply a legal conclusion about the case's validity or chances of winning. The qualification
result will be given to you as an instruction each time you enter this step — follow it exactly:
- QUALIFIED: tell them briefly this looks like something the firm can help with, then call proceed_to_scheduling.
- INSUFFICIENT: tell them you need a bit more information, then call return_to_intake.
- DISQUALIFIED: politely explain the firm can't take a case while the caller is already represented by another
  attorney on this matter, thank them for calling, and call end_call.`,
    state: orchestrator.state,
    policyTopics: ["communication"],
  });

  return Agent.create({
    instructions,
    tools: [
      tool({
        name: "proceed_to_scheduling",
        description: "Move to scheduling a follow-up after a QUALIFIED result.",
        parameters: z.object({}),
        execute: async () => {
          const result = orchestrator.prepareHandoff(AgentName.SCHEDULING);
          if (!result) return "Not ready to move to scheduling yet.";
          return handoff({ agent: result.agent, returns: "Let's get a follow-up scheduled." });
        },
      }),
      tool({
        name: "return_to_intake",
        description: "Go back to intake after an INSUFFICIENT result to gather the missing information.",
        parameters: z.object({}),
        execute: async () => {
          const result = orchestrator.prepareHandoff(AgentName.INTAKE);
          if (!result) return "Not able to return to intake right now.";
          return handoff({ agent: result.agent, returns: "Let's go over a few more details." });
        },
      }),
      orchestrator.tools.endCall(),
    ],
    onEnter: async (ctx) => {
      const result = await orchestrator.runQualification();
      const reasonText = result.reasons.length > 0 ? ` (${result.reasons.join(", ")})` : "";
      ctx.session.generateReply({
        instructions:
          `Qualification result: ${result.status}${reasonText}. Explain this briefly to the caller per your ` +
          (result.status === QualificationStatus.QUALIFIED
            ? "QUALIFIED instructions, then call proceed_to_scheduling."
            : result.status === QualificationStatus.DISQUALIFIED
              ? "DISQUALIFIED instructions, then call end_call."
              : "INSUFFICIENT instructions, then call return_to_intake."),
      });
    },
  });
}
