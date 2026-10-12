"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "@phosphor-icons/react";
import type { CallEventPayload } from "@/lib/shared";

const DOMAIN_PREFIXES = ["patient.", "appointment.", "insurance.", "refill.", "intent."];

function rowClass(type: string): string {
  if (type.startsWith("tool.")) return type === "tool.failed" ? "error" : "tool";
  if (type === "error") return "error";
  if (type === "phase.changed") return "phase";
  if (type.startsWith("transfer.")) return "transfer";
  if (type === "latency.turn") return "latency";
  if (DOMAIN_PREFIXES.some((p) => type.startsWith(p))) return "domain";
  return "";
}

// Partial transcripts are high-volume noise here; the transcript covers them.
const HIDDEN_TYPES = new Set(["user.transcript.partial"]);

function summarize(e: CallEventPayload): string {
  const m = e.metadata;
  if (!m) return "";
  if (typeof m.tool === "string") return String(m.tool);
  if (typeof m.e2eMs === "number") {
    const part = (label: string, v: unknown) => (typeof v === "number" ? `${label} ${Math.round(v)}` : null);
    return [part("stt", m.sttMs), part("eot", m.endOfTurnMs), part("llm", m.llmTtftMs), part("tts", m.ttsTtfbMs)].filter(Boolean).join(", ");
  }
  if (typeof m.intent === "string") return m.intent;
  if (typeof m.name === "string" && typeof m.patientId === "string") return m.name;
  if (typeof m.drugName === "string") return `${m.drugName} → ${String(m.outcome ?? "")}`;
  if (typeof m.department === "string") return `${m.department}: ${String(m.reason ?? "")}`;
  if (typeof m.staffName === "string") return m.staffName;
  if (typeof m.transcript === "string") return m.transcript.slice(0, 80);
  if (typeof m.text === "string") return m.text.slice(0, 80);
  if (typeof m.from === "string" && typeof m.to === "string") return `${m.from} → ${m.to}`;
  return Object.entries(m)
    .slice(0, 2)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
}

// The raw event stream, collapsed by default.
export function TimelinePanel({ events, streamConnected }: { events: CallEventPayload[]; streamConnected?: boolean }) {
  const visible = events.filter((e) => !HIDDEN_TYPES.has(e.type));
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length, open]);

  return (
    <details className="disclosure" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <Plus size={14} weight="bold" className="caret" aria-hidden="true" />
        {open ? "Hide event log" : "Show event log"}
        <span className="muted">{visible.length} events</span>
        {streamConnected !== undefined && <span className={`liveDot${streamConnected ? "" : " off"}`} aria-label={streamConnected ? "Live" : "Reconnecting"} />}
      </summary>
      <div className="disclosureBody inner">
        <div className="timeline" ref={listRef}>
          {visible.length === 0 && <p className="empty">Events appear here as the call happens.</p>}
          {visible.map((e, i) => (
            <div key={e.id ?? i} className={`timelineRow ${rowClass(e.type)}`}>
              <span className="t">{new Date(e.timestamp).toLocaleTimeString()}</span>
              <span className="type">{e.type}</span>
              <span className="meta">
                {summarize(e)}
                {e.durationMs != null ? ` (${e.durationMs} ms)` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
