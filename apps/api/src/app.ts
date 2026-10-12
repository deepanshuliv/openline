import express from "express";
import cors from "cors";
import { env } from "./env.js";
import { healthRouter } from "./routes/health.js";
import { callsRouter } from "./routes/calls.js";
import { patientsRouter } from "./routes/patients.js";
import { handoffsRouter } from "./routes/handoffs.js";
import { metricsRouter } from "./routes/metrics.js";
import { providersRouter } from "./routes/providers.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());

  app.use(healthRouter);
  app.use("/api", callsRouter);
  app.use("/api", patientsRouter);
  app.use("/api", handoffsRouter);
  app.use("/api", metricsRouter);
  app.use("/api", providersRouter);

  app.use(errorHandler);
  return app;
}
