import { inference, llm, stt, tokenize, tts, type VAD } from "@livekit/agents";
import * as assemblyai from "@livekit/agents-plugin-assemblyai";
import * as openai from "@livekit/agents-plugin-openai";
import * as rime from "@livekit/agents-plugin-rime";
import { createLogger } from "@repo/shared";
import { env } from "../env.js";

const logger = createLogger("agent:providers");

// Voice pipeline providers: AssemblyAI (STT), DeepSeek (LLM), Rime (TTS), each
// called directly with its own API key. Unless PROVIDER_FALLBACK=off, each is
// wrapped in a fallback adapter that switches to LiveKit Inference (billed to
// the LiveKit project) when the primary errors or times out, so a provider
// outage or bad key degrades the voice instead of dropping the call.
const fallbackOn = () => env.PROVIDER_FALLBACK === "on";

export function createSTT(vad?: VAD): stt.STT {
  const primary = new assemblyai.STT({ apiKey: env.ASSEMBLYAI_API_KEY, speechModel: env.ASSEMBLYAI_MODEL as assemblyai.STTModels });
  if (!fallbackOn()) return primary;
  return new stt.FallbackAdapter({
    sttInstances: [primary, new inference.STT({ model: env.FALLBACK_STT_MODEL as never, language: "en" })],
    vad,
    maxRetryPerSTT: 0,
  });
}

export function createLLM(): llm.LLM {
  const primary = openai.LLM.withDeepSeek({ apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL });
  if (!fallbackOn()) return primary;
  return new llm.FallbackAdapter({
    llms: [primary, new inference.LLM({ model: env.FALLBACK_LLM_MODEL as never })],
    attemptTimeout: 6,
  });
}

export function createTTS(): tts.TTS {
  const primary = new rime.TTS({ apiKey: env.RIME_API_KEY, modelId: env.RIME_MODEL, speaker: env.RIME_SPEAKER });
  if (!fallbackOn()) return primary;
  // Rime over HTTP isn't streaming. Wrap it once here; otherwise the adapter
  // builds a fresh StreamAdapter per use whose errors nobody listens to.
  const rimeStream = new tts.StreamAdapter(primary, new tokenize.basic.SentenceTokenizer());
  primary.on("error", () => {});
  const instances = [rimeStream, new inference.TTS({ model: env.FALLBACK_TTS_MODEL as never, voice: env.FALLBACK_TTS_VOICE })];
  const adapter = new tts.FallbackAdapter({ ttsInstances: instances, maxRetryPerTTS: 0 });
  // The adapter re-emits every child error to the session as unrecoverable, and
  // the session closes after three, even while the fallback is speaking fine.
  // Keep child errors local; the adapter still raises its own error when every
  // instance has failed.
  for (const instance of instances) {
    instance.removeAllListeners("error");
    instance.on("error", () => {});
  }
  adapter.on("tts_availability_changed" as never, ((ev: { tts: tts.TTS; available: boolean }) => {
    logger.warn("tts.availability_changed", { tts: ev.tts.label, available: ev.available });
  }) as never);
  return adapter;
}

// Free, read-only key checks at worker start. With fallbacks on, a revoked key
// would otherwise only show up as quietly worse latency and a different voice.
// (Rime has no free auth check; its failures log tts.availability_changed.)
export async function checkProviderKeys(): Promise<void> {
  const checks: [string, () => Promise<Response>][] = [
    ["DEEPSEEK_API_KEY", () => fetch("https://api.deepseek.com/user/balance", { headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` } })],
    ["ASSEMBLYAI_API_KEY", () => fetch("https://api.assemblyai.com/v2/transcript?limit=1", { headers: { Authorization: env.ASSEMBLYAI_API_KEY } })],
  ];
  await Promise.all(
    checks.map(async ([name, check]) => {
      try {
        const res = await check();
        if (res.status === 401 || res.status === 403) {
          logger.error("provider.key_invalid", { envVar: name, status: res.status, impact: fallbackOn() ? "using LiveKit Inference fallback" : "calls will fail" });
        }
      } catch (err) {
        logger.warn("provider.key_check_failed", { envVar: name, message: String(err) });
      }
    }),
  );
}
