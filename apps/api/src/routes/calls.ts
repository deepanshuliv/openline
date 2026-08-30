import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { createLogger } from "@repo/shared";
import { CallsQueryService } from "../services/CallsQueryService.js";
import { EventStreamService } from "../services/EventStreamService.js";
import { LiveKitTokenService } from "../services/LiveKitTokenService.js";

const logger = createLogger("api:calls");
const queryService = new CallsQueryService();
const eventStream = new EventStreamService(queryService);
const tokenService = new LiveKitTokenService();

export const callsRouter = Router();

const createSessionSchema = z.object({
  callerName: z.string().min(1).max(120).optional(),
});


callsRouter.post("/calls/session", async (req, res, next) => {
  try {
    const body = createSessionSchema.parse(req.body ?? {});
    const roomName = `call-${randomUUID()}`;
    const identity = `caller-${randomUUID().slice(0, 8)}`;

    const call = await queryService.createCall(roomName);
    const session = await tokenService.createSession({
      roomName,
      identity,
      participantName: body.callerName ?? "Prospective Caller",
    });

    logger.event("call.session.created", { callId: call.id, roomName, identity });
    res.status(201).json({ callId: call.id, ...session });
  } catch (err) {
    next(err);
  }
});

callsRouter.get("/calls", async (_req, res, next) => {
  try {
    const calls = await queryService.listCalls();
    res.json({ calls });
  } catch (err) {
    next(err);
  }
});

callsRouter.get("/calls/:id", async (req, res, next) => {
  try {
    const call = await queryService.getCallDetail(req.params.id);
    if (!call) {
      res.status(404).json({ error: "call_not_found" });
      return;
    }
    res.json({ call });
  } catch (err) {
    next(err);
  }
});

callsRouter.get("/calls/:id/events", async (req, res, next) => {
  try {
    const events = await queryService.getCallEvents(req.params.id);
    res.json({ events });
  } catch (err) {
    next(err);
  }
});


callsRouter.get("/calls/:id/events/stream", async (req, res, next) => {
  try {
    await eventStream.streamForCall(req.params.id, res, (cleanup) => {
      req.on("close", cleanup);
    });
  } catch (err) {
    next(err);
  }
});
