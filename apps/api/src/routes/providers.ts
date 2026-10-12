import { Router } from "express";
import { prisma } from "@repo/db";

export const providersRouter = Router();

// The clinic's care team, for the landing page.
providersRouter.get("/providers", async (_req, res, next) => {
  try {
    const providers = await prisma.provider.findMany({
      select: { id: true, name: true, title: true, specialty: true, acceptsNewPatients: true, workDays: true },
      orderBy: { name: "asc" },
    });
    res.json({ providers });
  } catch (err) {
    next(err);
  }
});
