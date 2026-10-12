"use client";

import { useEffect, useRef } from "react";
import { AGENT_NAME, type CallEventPayload } from "@/lib/shared";

export type Speaker = "caller" | "agent" | "staff" | "system";

interface Turn {
  speaker: Speaker;
  text: string;
  key: string;
}

export function turnsFromEvents(events: CallEventPayload[]): Turn[] {
  const turns: Turn[] = [];
  for (const e of events) {
    const m = e.metadata;
    if (e.type === "user.transcript.final" && typeof m?.transcript === "string" && m.transcript.trim()) {
      turns.push({ speaker: "caller", text: m.transcript, key: `${e.id ?? e.timestamp}-c` });
    } else if (e.type === "agent.speech" && typeof m?.text === "string" && m.text.trim()) {
      turns.push({ speaker: "agent", text: m.text, key: `${e.id ?? e.timestamp}-a` });
    }
  }
  return turns;
}

const LABELS: Record<Speaker, string> = { caller: "Caller", agent: AGENT_NAME, staff: "Staff", system: "System" };

export function TranscriptView({ turns, emptyText, footer }: { turns: Turn[]; emptyText?: React.ReactNode; footer?: React.ReactNode }) {
  const listRef = useRef<HTMLDivElement>(null);
  const hasFooter = !!footer;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, hasFooter]);

  return (
    <div className="transcript" ref={listRef} aria-live="polite">
      {turns.length === 0 && <p className="empty">{emptyText ?? "The conversation shows up here once the call starts."}</p>}
      {turns.map((t) => (
        <div key={t.key} className={`bubble ${t.speaker}`}>
          <span className="speaker">{LABELS[t.speaker]}</span>
          {t.text}
        </div>
      ))}
      {footer}
    </div>
  );
}

export function TranscriptPanel({
  events,
  footer,
  emptyText,
  title = "Conversation",
}: {
  events: CallEventPayload[];
  footer?: React.ReactNode;
  emptyText?: React.ReactNode;
  title?: string;
}) {
  const turns = turnsFromEvents(events);
  return (
    <section className="inner">
      <div className="innerHead">
        {title}
        {turns.length > 0 && <span className="meta">{turns.length === 1 ? "1 turn" : `${turns.length} turns`}</span>}
      </div>
      <TranscriptView turns={turns} emptyText={emptyText} footer={footer} />
    </section>
  );
}
