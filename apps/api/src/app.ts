import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { env } from "./env.js";
import { healthRouter } from "./routes/health.js";
import { callsRouter } from "./routes/calls.js";
import { patientsRouter } from "./routes/patients.js";
import { handoffsRouter } from "./routes/handoffs.js";
import { metricsRouter } from "./routes/metrics.js";
import { providersRouter } from "./routes/providers.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireUser } from "./middleware/requireUser.js";

export function createApp() {
  const app = express();
  // credentials: the browser sends the Clerk session cookie with event streams.
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json());

  app.use(healthRouter);
  // The care team list is shown on the public landing page.
  app.use("/api", providersRouter);
  app.use(
    "/api",
    clerkMiddleware({
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      // Only accept session tokens minted for this site's own origin.
      authorizedParties: [env.CORS_ORIGIN],
    }),
    requireUser,
  );
  app.use("/api", callsRouter);
  app.use("/api", patientsRouter);
  app.use("/api", handoffsRouter);
  app.use("/api", metricsRouter);

  app.use(errorHandler);
  return app;
}
