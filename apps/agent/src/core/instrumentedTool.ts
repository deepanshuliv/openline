import { tool, type FunctionTool } from "@livekit/agents";
import type { z } from "zod";
import { CallEventType, createLogger } from "@repo/shared";
import type { CallSession } from "./CallSession.js";

const logger = createLogger("agent:tool");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous tool list; args are typed per tool via zod.
type AnyFunctionTool = FunctionTool<any, any, any>;

// Thrown by tool handlers for expected, caller-facing failures (e.g. "no such
// appointment"). The message is returned to the LLM so it can recover.
export class ToolUserError extends Error {}

// Wraps a tool so every invocation is timed and visible in the call timeline,
// and unexpected failures are returned to the LLM instead of crashing the turn.
export function instrumentedTool<Schema extends z.ZodObject<z.ZodRawShape>, Result>(
  call: CallSession,
  def: {
    name: string;
    description: string;
    parameters: Schema;
    execute: (args: z.infer<Schema>) => Promise<Result>;
  },
): AnyFunctionTool {
  return tool({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    execute: async (rawArgs) => {
      // The SDK validates rawArgs against the zod schema before calling us.
      const args = rawArgs as z.infer<Schema>;
      const start = Date.now();
      call.onToolStart?.(def.name);
      void call.emit(CallEventType.TOOL_STARTED, { tool: def.name, input: args });
      try {
        const result = await def.execute(args);
        void call.emit(CallEventType.TOOL_COMPLETED, { tool: def.name, output: result as unknown as Record<string, unknown> }, { durationMs: Date.now() - start });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const expected = err instanceof ToolUserError;
        if (!expected) logger.error("tool.failed", { tool: def.name, message });
        void call.emit(CallEventType.TOOL_FAILED, { tool: def.name, message, expected }, { durationMs: Date.now() - start });
        return { error: expected ? message : "Something went wrong on our side. Apologize briefly and offer another way to help." };
      }
    },
  });
}
