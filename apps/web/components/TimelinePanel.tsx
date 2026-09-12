"use client";

import { useEffect, useRef } from "react";
import type { CallEventPayload } from "@repo/shared";
import { ActivityIcon } from "./icons";

function rowClass(type: string): string {
  if (type.startsWith("tool.")) return "tool";
  if (type === "error") return "error";
  if (type === "phase.changed" || type === "agent.handoff") return "phase";
  return "";
}

function summarize(e: CallEventPayload): string {
  const m = e.metadata;
  if (!m) return "";
  if (typeof m.tool === "string") return String(m.tool);
  if (typeof m.transcript === "string") return m.transcript.slice(0, 60);
  if (typeof m.text === "string") return m.text.slice(0, 60);
  if (typeof m.from === "string" && typeof m.to === "string") return `${m.from} -> ${m.to}`;
  return Object.entries(m)
    .slice(0, 2)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
}

export function TimelinePanel({
  events,
  streamConnected,
}: {
  events: CallEventPayload[];


  streamConnected?: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  return (
    <div className="panel">
      <h2>
        <span className="panelTitleIcon">
          <ActivityIcon />
          Activity Log
        </span>
        <span className="headerPills">
          {streamConnected !== undefined && (
            <span className={`pill ${streamConnected ? "connected" : "disconnected"}`}>
              <span className="dot" />
              {streamConnected ? "live" : "connecting…"}
            </span>
          )}
          <span className="pill">
            <span className="dot" />
            {events.length} events
          </span>
        </span>
      </h2>
      <div className="timeline">
        {events.length === 0 && <p className="empty">Events will appear here as the call happens.</p>}
        {events.map((e, i) => (
          <div key={e.id ?? i} className={`timelineRow ${rowClass(e.type)}`}>
            <span className="t">{new Date(e.timestamp).toLocaleTimeString()}</span>
            <span className="type">{e.type}</span>
            <span className="meta">
              {e.agent ? `[${e.agent}] ` : ""}
              {summarize(e)}
              {e.durationMs != null ? ` (${e.durationMs}ms)` : ""}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
