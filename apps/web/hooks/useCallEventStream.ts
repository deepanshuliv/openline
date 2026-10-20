"use client";

import { useEffect, useRef, useState } from "react";
import type { CallEventPayload } from "@/lib/shared";
import { apiClient } from "@/lib/api-client";






export function useCallEventStream(callId: string | null) {
  const [events, setEvents] = useState<CallEventPayload[]>([]);
  const [connected, setConnected] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!callId) {
      setEvents([]);
      return;
    }
    setEvents([]);
    seenIds.current = new Set();

    // withCredentials: EventSource cannot set headers, so the Clerk session cookie authenticates the stream.
    const source = new EventSource(apiClient.eventStreamUrl(callId), { withCredentials: true });

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("call-event", (raw) => {
      try {
        const event = JSON.parse((raw as MessageEvent).data) as CallEventPayload;
        const key = event.id ?? `${event.type}-${event.timestamp}-${Math.random()}`;
        if (seenIds.current.has(key)) return;
        seenIds.current.add(key);
        setEvents((prev) => [...prev, event]);
      } catch {
        // Ignore malformed frames.
      }
    });

    return () => {
      source.close();
      setConnected(false);
    };
  }, [callId]);

  return { events, connected };
}
