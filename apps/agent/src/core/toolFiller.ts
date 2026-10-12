import { voice } from "@livekit/agents";
import { CallEventType } from "@repo/shared";
import type { CallSession } from "./CallSession.js";
import type { PhraseCache } from "./PhraseCache.js";

// A tool call means silence for the tool plus a second LLM pass. Bridge that
// gap with a short pre-synthesized line played by code: the tool's own bridge
// ("Let me check your coverage.") or a generic filler. One per caller turn, so
// a turn with several lookups doesn't stack them. If the agent is mid-sentence
// the bridge queues right after it. It is kept out of the chat context so the
// model never sees or repeats it.
export function installToolFiller(
  call: CallSession,
  session: voice.AgentSession<CallSession>,
  phrases: PhraseCache,
  opts: { fillers: string[]; toolBridges?: Record<string, string>; skipTools: string[] },
): void {
  const bridges = opts.toolBridges ?? {};
  if (opts.fillers.length === 0 && Object.keys(bridges).length === 0) return;
  const skip = new Set(opts.skipTools);
  let fillerThisTurn = false;
  let next = 0;

  session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
    if (ev.newState === "speaking") fillerThisTurn = false;
  });

  call.onToolStart = (tool) => {
    if (fillerThisTurn || skip.has(tool)) return;
    const text = bridges[tool] ?? (opts.fillers.length > 0 ? opts.fillers[next++ % opts.fillers.length]! : null);
    if (!text) return;
    fillerThisTurn = true;
    phrases.say(session, text, { addToChatCtx: false, allowInterruptions: true });
    void call.emit(CallEventType.FILLER_PLAYED, { text, tool, cached: phrases.has(text) });
  };
}
