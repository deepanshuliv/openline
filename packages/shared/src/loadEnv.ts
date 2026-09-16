import type { z } from "zod";

/**
 * Validates process.env against a zod schema and fails fast with a readable
 * error instead of letting `undefined` secrets silently propagate into
 * LiveKit/OpenRouter/Deepgram clients. Each app defines its own schema
 * (they need different variables) and calls this once at startup.
 */
export function loadEnv<T extends z.ZodTypeAny>(schema: T, source: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    console.error("\n[env] Invalid or missing environment variables:\n");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("\nCheck your .env against .env.example.\n");
    process.exit(1);
  }
  return result.data;
}
