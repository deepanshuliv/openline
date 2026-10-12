import { Router } from "express";
import { z } from "zod";
import type { HandoffStatus } from "@repo/db";
import { LiveKitTokenService } from "../services/LiveKitTokenService.js";
import { ACTIVE_HANDOFF_STATUSES, HandoffConflictError, HandoffService } from "../services/HandoffService.js";

const handoffService = new HandoffService(new LiveKitTokenService());

export const handoffsRouter = Router();

const HANDOFF_STATUSES = ["WAITING", "ACCEPTED", "COMPLETED", "TIMED_OUT", "CANCELLED"] as const;

const listQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim().toUpperCase()) : ACTIVE_HANDOFF_STATUSES))
    .pipe(z.array(z.enum(HANDOFF_STATUSES)).min(1)),
});

const acceptSchema = z.object({
  staffName: z.string().trim().min(1).max(60),
});

handoffsRouter.get("/handoffs", async (req, res, next) => {
  try {
    const { status } = listQuerySchema.parse(req.query);
    const handoffs = await handoffService.list(status as HandoffStatus[]);
    res.json({ handoffs });
  } catch (err) {
    next(err);
  }
});

handoffsRouter.get("/handoffs/stream", async (req, res, next) => {
  try {
    await handoffService.stream(res, (cleanup) => {
      req.on("close", cleanup);
    });
  } catch (err) {
    next(err);
  }
});

handoffsRouter.post("/handoffs/:id/accept", async (req, res, next) => {
  try {
    const { staffName } = acceptSchema.parse(req.body ?? {});
    const result = await handoffService.accept(req.params.id, staffName);
    if (!result) {
      res.status(404).json({ error: "handoff_not_found" });
      return;
    }
    res.json(result);
  } catch (err) {
    if (err instanceof HandoffConflictError) {
      res.status(409).json({ error: "handoff_not_waiting" });
      return;
    }
    next(err);
  }
});

handoffsRouter.post("/handoffs/:id/complete", async (req, res, next) => {
  try {
    const handoff = await handoffService.complete(req.params.id);
    if (!handoff) {
      res.status(404).json({ error: "handoff_not_found" });
      return;
    }
    res.json({ handoff });
  } catch (err) {
    next(err);
  }
});
