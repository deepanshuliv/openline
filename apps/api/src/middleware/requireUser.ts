import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";

// Runs after clerkMiddleware(). The session comes from the Clerk cookie (same
// origin, and EventSource streams) or an `Authorization: Bearer` token (fetch).
export const requireUser: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  next();
};
