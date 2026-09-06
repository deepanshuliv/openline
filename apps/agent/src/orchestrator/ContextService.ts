import type { PolicyTopic } from "../services/PolicyService.js";
import type { PolicyService } from "../services/PolicyService.js";
import type { CallState } from "./CallState.js";

const GLOBAL_RULES = `RULES
- Never invent facts the caller did not state.
- Never give legal advice, and never state or imply that a case is legally valid.
- Never claim attorney-client privilege or guarantee the firm will take the case.
- Confirm critical extracted information back to the caller before treating it as settled.
- Ask one question at a time. Keep turns short and conversational — this is a live voice call.
- Minimize collection of sensitive information beyond what intake actually requires.
- If uncertain what the caller means, ask a clarifying question instead of guessing.`;







export class ContextService {
  constructor(private readonly policyService: PolicyService) {}

  buildInstructions(params: {
    roleInstructions: string;
    state: CallState;
    policyTopics?: PolicyTopic[];
    recentTurnsExcerpt?: string;
  }): string {
    const { roleInstructions, state, policyTopics = [], recentTurnsExcerpt } = params;

    const sections: string[] = [
      roleInstructions.trim(),
      `CURRENT PHASE\n${state.currentPhase}`,
      `KNOWN CALLER\n${formatCaller(state)}`,
      `KNOWN MATTER FIELDS\n${formatFields(state)}`,
      `REQUIRED MISSING FIELDS\n${state.missingRequiredFields.join(", ") || "none"}`,
    ];

    if (policyTopics.length > 0) {
      sections.push(`RELEVANT POLICY\n${this.policyService.getDocs(policyTopics)}`);
    }
    if (recentTurnsExcerpt) {
      sections.push(`RECENT CONVERSATION\n${recentTurnsExcerpt}`);
    }
    sections.push(GLOBAL_RULES);

    return sections.join("\n\n");
  }
}

function formatCaller(state: CallState): string {
  const { name, phone, email } = state.callerContact;
  if (!name && !phone && !email) return "unknown (not yet collected)";
  return [name && `name=${name}`, phone && `phone=${phone}`, email && `email=${email}`].filter(Boolean).join(", ");
}

function formatFields(state: CallState): string {
  const entries = Object.entries(state.collectedFields).filter(
    ([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0),
  );
  if (entries.length === 0) return "none collected yet";
  return entries.map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("; ") : v}`).join("\n");
}
