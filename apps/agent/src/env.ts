import { z } from "zod";
import { loadEnv } from "@repo/shared";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  LIVEKIT_URL: z.string().min(1, "LIVEKIT_URL is required"),
  LIVEKIT_API_KEY: z.string().min(1, "LIVEKIT_API_KEY is required"),
  LIVEKIT_API_SECRET: z.string().min(1, "LIVEKIT_API_SECRET is required"),
  // Voice pipeline providers.
  ASSEMBLYAI_API_KEY: z.string().min(1, "ASSEMBLYAI_API_KEY is required"),
  ASSEMBLYAI_MODEL: z.string().default("universal-streaming-english"),
  DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY is required"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  RIME_API_KEY: z.string().min(1, "RIME_API_KEY is required"),
  // mistv3 measured ~365 ms to first audio vs 0.5-2.8 s for arcana (from India).
  RIME_MODEL: z.string().default("mistv3"),
  RIME_SPEAKER: z.string().default("cove"),
  // LiveKit Inference fallbacks, used only when a primary provider fails.
  PROVIDER_FALLBACK: z.enum(["on", "off"]).default("on"),
  FALLBACK_STT_MODEL: z.string().default("deepgram/nova-3"),
  FALLBACK_LLM_MODEL: z.string().default("openai/gpt-4.1-mini"),
  FALLBACK_TTS_MODEL: z.string().default("cartesia/sonic-3"),
  FALLBACK_TTS_VOICE: z.string().default("9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"),
  // Silence before VAD declares end of speech. The turn detector guards against
  // cutting callers off mid-thought, so this can sit well below Silero's 550 ms.
  VAD_MIN_SILENCE_MS: z.coerce.number().int().min(100).max(2000).default(250),
  // Upper bound on waiting for the turn detector to decide the caller is done.
  // The cloud detector is conservative on a call's first utterance; this caps it.
  // "dynamic" adapts the end-of-turn wait to each caller's pause pattern.
  ENDPOINTING_MODE: z.enum(["fixed", "dynamic"]).default("dynamic"),
  // Lower bound on the same wait. AssemblyAI's final transcript lands ~0.5-1 s
  // after speech ends; below ~600 ms a turn can commit before it arrives and
  // the caller's sentence gets answered in two halves.
  ENDPOINTING_MIN_DELAY_MS: z.coerce.number().int().min(0).max(3000).default(600),
  ENDPOINTING_MAX_DELAY_MS: z.coerce.number().int().min(500).max(6000).default(1200),
  // "on" uses LiveKit's streaming turn detector; "off" falls back to VAD silence.
  TURN_DETECTOR: z.enum(["on", "off"]).default("on"),
  // Start generating a reply from the interim transcript before the turn ends.
  PREEMPTIVE_GENERATION: z.enum(["on", "off"]).default("on"),
  TRANSFER_TIMEOUT_SEC: z.coerce.number().int().positive().default(90),
});

export const env = loadEnv(schema);
