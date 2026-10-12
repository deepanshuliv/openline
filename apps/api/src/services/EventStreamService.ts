import type { Response } from "express";
import { CALL_EVENTS_CHANNEL_PREFIX, createLogger } from "@repo/shared";
import { createSubscriberConnection } from "../redis.js";
import type { CallsQueryService } from "./CallsQueryService.js";

const logger = createLogger("api:sse");

export class EventStreamService {
  constructor(private readonly queryService: CallsQueryService) {}

  async streamForCall(callId: string, res: Response, onClose: (cb: () => void) => void): Promise<void> {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const backlog = await this.queryService.getCallEvents(callId);
    for (const event of backlog) {
      res.write(`event: call-event\ndata: ${JSON.stringify(event)}\n\n`);
    }

    const subscriber = createSubscriberConnection();
    const channel = CALL_EVENTS_CHANNEL_PREFIX + callId;
    await subscriber.subscribe(channel);
    logger.debug("sse.subscribed", { callId, channel });

    subscriber.on("message", (_channel: string, message: string) => {
      res.write(`event: call-event\ndata: ${message}\n\n`);
    });

    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);

    onClose(() => {
      clearInterval(heartbeat);
      subscriber.unsubscribe(channel).catch(() => undefined);
      subscriber.quit().catch(() => undefined);
      logger.debug("sse.closed", { callId });
    });
  }
}
