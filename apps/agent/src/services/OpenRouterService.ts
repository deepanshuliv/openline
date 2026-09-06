import { OpenRouter } from "@openrouter/sdk";
import { z } from "zod";
import { createLogger, intakeFieldsSchema, type IntakeFields } from "@repo/shared";
import { env } from "../env.js";

const logger = createLogger("agent:openrouter");

const intakeJsonSchema = toStrictJsonSchema(z.toJSONSchema(intakeFieldsSchema) as JsonSchemaObject);

type JsonSchemaObject = Record<string, unknown>;


function toStrictJsonSchema(schema: JsonSchemaObject): JsonSchemaObject {
  if (schema.type !== "object" || typeof schema.properties !== "object" || schema.properties === null) {
    return schema;
  }
  const properties = schema.properties as Record<string, JsonSchemaObject>;
  const strictProperties: Record<string, JsonSchemaObject> = {};
  for (const [key, value] of Object.entries(properties)) {
    strictProperties[key] = toStrictJsonSchema(value);
  }
  return {
    ...schema,
    properties: strictProperties,
    required: Object.keys(strictProperties),
    additionalProperties: false,
  };
}

export interface ExtractIntakeInput {

  conversationExcerpt: string;
  alreadyKnown: IntakeFields;
}

export interface ExtractIntakeResult {
  fields: IntakeFields;
  durationMs: number;
}


export class OpenRouterService {
  private readonly client: OpenRouter;

  constructor() {
    this.client = new OpenRouter({ apiKey: env.OPENROUTER_API_KEY });
  }

  async extractIntakeFields(input: ExtractIntakeInput): Promise<ExtractIntakeResult> {
    const start = Date.now();
    let text = "";
    try {
      const result = await this.client.chat.send({
        chatRequest: {
          model: env.OPENROUTER_EXTRACTION_MODEL,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "You extract structured intake facts for a plaintiff law firm's intake system. " +
                "Report ONLY facts the caller explicitly stated in the conversation excerpt. " +
                "Never invent, assume, or infer a value that was not said. " +
                "Omit (leave null) any field that is still unknown. " +
                "Preserve previously-known field values unless the caller corrected them.",
            },
            {
              role: "user",
              content: `Already known fields:\n${JSON.stringify(input.alreadyKnown)}\n\nConversation excerpt:\n${input.conversationExcerpt}`,
            },
          ],
          responseFormat: {
            type: "json_schema",
            jsonSchema: { name: "intake_fields", strict: true, schema: intakeJsonSchema },
          },
        },
      });

      if (!("choices" in result)) throw new Error("unexpected streaming response");
      text = extractText(result.choices[0]?.message?.content);
    } catch (err) {
      throw new Error(`extraction request failed: ${describeError(err)}`);
    }

    const durationMs = Date.now() - start;
    if (!text.trim()) throw new Error("extraction returned an empty response");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`extraction returned invalid JSON: ${describeError(err)}`);
    }

    const validated = intakeFieldsSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(`extraction failed schema validation: ${validated.error.issues.length} issue(s)`);
    }
    return { fields: validated.data, durationMs };
  }


  async summarizeCall(input: { transcriptExcerpt: string; fields: IntakeFields }): Promise<string> {
    try {
      const result = await this.client.chat.send({
        chatRequest: {
          model: env.OPENROUTER_EXTRACTION_MODEL,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "Write a concise (2-4 sentence) internal case summary for a law firm intake record. " +
                "Factual only, no legal conclusions or advice, no promises of representation.",
            },
            {
              role: "user",
              content: `Known fields:\n${JSON.stringify(input.fields)}\n\nTranscript excerpt:\n${input.transcriptExcerpt}`,
            },
          ],
        },
      });
      if (!("choices" in result)) return "";
      return extractText(result.choices[0]?.message?.content).trim();
    } catch (err) {
      logger.error("summarize.request_failed", { message: String(err) });
      return "";
    }
  }
}



function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const detail = (err as Error & { body?: unknown; responseBody?: unknown }).body ?? (err as Error & { responseBody?: unknown }).responseBody;
  return detail ? `${err.message} — ${JSON.stringify(detail).slice(0, 400)}` : err.message;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : ""))
      .join("");
  }
  return "";
}
