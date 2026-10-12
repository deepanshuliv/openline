"use client";

import { useEffect, useState } from "react";
import { apiClient, type QueuedHandoff } from "@/lib/api-client";

const POLL_MS = 5000;

// Live transfer queue: SSE snapshot stream, falling back to polling if the
// stream errors (e.g. a proxy that buffers event streams).
export function useHandoffQueue() {
  const [handoffs, setHandoffs] = useState<QueuedHandoff[] | null>(null);
  const [mode, setMode] = useState<"connecting" | "live" | "polling">("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const poll = () =>
      apiClient
        .listHandoffs()
        .then((res) => {
          if (disposed) return;
          setHandoffs(res.handoffs);
          setError(null);
        })
        .catch((err) => !disposed && setError(err instanceof Error ? err.message : String(err)));

    const startPolling = () => {
      if (timer || disposed) return;
      setMode("polling");
      void poll();
      timer = setInterval(poll, POLL_MS);
    };

    try {
      source = new EventSource(apiClient.handoffStreamUrl());
      source.onopen = () => {
        setMode("live");
        setError(null);
      };
      source.addEventListener("handoffs", (raw) => {
        try {
          setHandoffs(JSON.parse((raw as MessageEvent).data) as QueuedHandoff[]);
        } catch {
          // Ignore malformed frames; the next snapshot replaces state.
        }
      });
      source.onerror = () => {
        source?.close();
        startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      disposed = true;
      source?.close();
      if (timer) clearInterval(timer);
    };
  }, []);

  return { handoffs, mode, error };
}
