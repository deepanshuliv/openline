import { z } from "zod";
import { loadEnv } from "@repo/shared";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  LIVEKIT_URL: z.string().min(1, "LIVEKIT_URL is required"),
  LIVEKIT_API_KEY: z.string().min(1, "LIVEKIT_API_KEY is required"),
  LIVEKIT_API_SECRET: z.string().min(1, "LIVEKIT_API_SECRET is required"),
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z.string().default("openai/gpt-4o-mini"),
  OPENROUTER_EXTRACTION_MODEL: z.string().default("openai/gpt-4o-mini"),
  DEEPGRAM_API_KEY: z.string().min(1, "DEEPGRAM_API_KEY is required"),
});

export const env = loadEnv(schema);
