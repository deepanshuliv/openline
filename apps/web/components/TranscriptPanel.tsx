"use client";

import { useEffect, useRef } from "react";
import type { CallEventPayload } from "@repo/shared";

interface Turn {
  speaker: "caller" | "agent";
  text: string;
  key: string;
}

function toTurns(events: CallEventPayload[]): Turn[] {
  const turns: Turn[] = [];
  for (const e of events) {
    if (e.type === "user.transcript.final" && typeof e.metadata?.transcript === "string" && e.metadata.transcript.trim()) {
      turns.push({ speaker: "caller", text: e.metadata.transcript, key: `${e.id}-c` });
    } else if (e.type === "agent.speech" && typeof e.metadata?.text === "string" && e.metadata.text.trim()) {
      turns.push({ speaker: "agent", text: e.metadata.text, key: `${e.id}-a` });
    }
  }
  return turns;
}

export function TranscriptPanel({ events }: { events: CallEventPayload[] }) {
  const turns = toTurns(events);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length]);

  return (
    <div className="panel">
      <h2>Conversation</h2>
      <div className="transcript">
        {turns.length === 0 && <p className="empty">Transcript will appear here once the call starts.</p>}
        {turns.map((t) => (
          <div key={t.key} className={`bubble ${t.speaker}`}>
            <span className="speaker">{t.speaker === "caller" ? "Caller" : "Agent"}</span>
            {t.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
