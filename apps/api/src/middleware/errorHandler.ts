import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { createLogger } from "@repo/shared";

const logger = createLogger("api:error");

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "validation_error", issues: err.issues });
    return;
  }
  logger.error("unhandled_error", { message: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: "internal_error" });
};
