import type { voice } from "@livekit/agents";
import type { CallSession } from "./CallSession.js";
import type { PhraseCache } from "./PhraseCache.js";
import type { WarmTransfer, WarmTransferScripts } from "./WarmTransfer.js";

// A vertical is everything domain-specific about a voice agent: persona,
// tools, and transfer scripts. The core supplies the call lifecycle, voice
// pipeline, telemetry, and warm transfer.
export interface Vertical {
  name: string;
  agentLabel: string;
  // Domain vocabulary that biases speech-to-text (names, drugs, payers).
  keyterms: string[];
  transferScripts: WarmTransferScripts;
  // Fixed phrases pre-synthesized at worker start (greeting, fillers, ...).
  // `goodbye` is played by code when the agent ends the call. `toolBridges`
  // are short lines played while a given tool runs ("Let me check your
  // coverage."); tools without one fall back to a generic filler.
  phrases: { greeting: string; fillers: string[]; toolBridges?: Record<string, string>; goodbye?: string; other?: string[] };
  // Tools that speak for themselves and must not trigger a filler.
  fillerSkipTools: string[];
  // `callerReady` resolves once the caller has pressed OK in the browser; the
  // agent must not speak before it.
  createAgent(ctx: { call: CallSession; transfer: WarmTransfer; phrases: PhraseCache; callerReady: Promise<void> }): voice.Agent<CallSession>;
}
