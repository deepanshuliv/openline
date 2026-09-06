import { Agent, handoff, tool } from "@livekit/agents";
import { z } from "zod";
import { AgentName } from "@repo/shared";
import type { CallOrchestrator } from "../orchestrator/CallOrchestrator.js";









export function createIntakeAgent(orchestrator: CallOrchestrator): Agent {
  const instructions = orchestrator.contextService.buildInstructions({
    roleInstructions: `You are the intake specialist for a plaintiff law firm. Collect the facts of the caller's potential case
conversationally — one question at a time, never a checklist. Ask about: what happened, when, where, injuries, medical
treatment received, whether police/emergency services were involved, whether they already have an attorney, and their
name and phone number. The moment they give a phone number, call get_caller: if it returns an existingMatter, call
get_matter with that matterId, tell the caller what you already have on file, and only ask for what is still missing —
do not re-ask questions their record already answers, and do not create a second matter for them. If no record is
found, call create_caller once you have name + phone, then create_matter as soon as you know the incident type. Call
update_matter_intake whenever you learn new facts — do not wait until the end. Confirm important facts back to the
caller instead of silently assuming them. Never tell the caller to hold or that someone else will take over — you are
the one gathering these details. Once you have the incident type, date, description, injuries, and whether
they're represented by another attorney (or the caller is clearly unwilling/unable to provide more), call
proceed_to_qualification.
You decide when the conversation is over: if the caller says goodbye, says they have nothing further, or wants to
stop, say a brief closing line and then call end_call.`,
    state: orchestrator.state,
    policyTopics: ["intake", "communication"],
  });

  return Agent.create({
    instructions,
    tools: [
      orchestrator.tools.getCaller(),
      orchestrator.tools.createCaller(),
      orchestrator.tools.createMatter(),
      orchestrator.tools.updateMatterIntake(),
      orchestrator.tools.getMatter(),
      orchestrator.tools.addCallNote(),
      tool({
        name: "proceed_to_qualification",
        description: "Move to qualification once enough case facts have been gathered (or the caller has no more to share).",
        parameters: z.object({}),
        execute: async () => {
          const result = orchestrator.prepareHandoff(AgentName.QUALIFICATION);
          if (!result) return "Not ready to move to qualification yet.";
          return handoff({ agent: result.agent, returns: "Let's go over qualification next." });
        },
      }),
      orchestrator.tools.endCall(),
    ],



    onEnter: async (ctx) => {



      const missing = orchestrator.state.missingRequiredFields;
      ctx.session.generateReply({
        instructions:
          "You have just taken over the conversation. Do not greet the caller again, do not " +
          "introduce yourself as a new person, and never tell them to hold or wait — you are the " +
          "one collecting these details, right now. Briefly acknowledge what they've already told " +
          "you, then ask the single most useful question you still need." +
          (missing.length > 0 ? ` Still missing: ${missing.join(", ")}.` : " Confirm the key facts you have so far."),
      });
    },
  });
}
