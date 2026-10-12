import { Router } from "express";
import { z } from "zod";
import { LatencyMetricsService } from "../services/LatencyMetricsService.js";

const metricsService = new LatencyMetricsService();

export const metricsRouter = Router();

const latencyQuerySchema = z.object({
  calls: z.coerce.number().int().min(1).max(200).default(20),
});

metricsRouter.get("/metrics/latency", async (req, res, next) => {
  try {
    const { calls } = latencyQuerySchema.parse(req.query);
    res.json(await metricsService.summary(calls));
  } catch (err) {
    next(err);
  }
});
