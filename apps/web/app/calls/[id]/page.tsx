"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { apiClient, type CallDetail } from "@/lib/api-client";
import { TimelinePanel } from "@/components/TimelinePanel";
import { deriveCallState } from "@/lib/deriveCallState";

export default function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [call, setCall] = useState<CallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getCallDetail(id)
      .then((res) => setCall(res.call))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  const derived = call ? deriveCallState(call.events) : null;




  const latencyEvents = call?.events.filter((e) => e.durationMs != null) ?? [];

  return (
    <main className="page">
      <div className="topbar">
        <div className="brand">
          <h1>Call Detail</h1>
          <span className="tag">{id.slice(0, 12)}</span>
        </div>
        <nav className="nav">
          <Link href="/">Live Call</Link>
          <Link href="/calls">Call History</Link>
        </nav>
      </div>

      {error && (
        <div className="summaryBox errorBox">{error}</div>
      )}

      {!call && !error && <p className="empty">Loading…</p>}

      {call && (
        <div className="stack">
          <div className="summaryBox">
            <dl className="kv">
              <dt>Status</dt>
              <dd>{call.status}</dd>
              <dt>Started</dt>
              <dd>{new Date(call.startedAt).toLocaleString()}</dd>
              <dt>Ended</dt>
              <dd>{call.endedAt ? new Date(call.endedAt).toLocaleString() : "—"}</dd>
              <dt>Caller</dt>
              <dd>
                {call.caller?.name ?? "—"} {call.caller?.phone ? `(${call.caller.phone})` : ""}
              </dd>
              <dt>Matter</dt>
              <dd>
                {call.matter?.incidentType ?? "—"} — {call.matter?.status ?? "—"} / {call.matter?.qualificationStatus ?? "—"}
              </dd>
              {call.matter?.appointments && call.matter.appointments.length > 0 && (
                <>
                  <dt>Appointment</dt>
                  <dd>
                    {call.matter.appointments.map((a) => `${new Date(a.scheduledAt).toLocaleString()} (${a.status})`).join(", ")}
                  </dd>
                </>
              )}
              {call.finalSummary && (
                <>
                  <dt>Summary</dt>
                  <dd>{call.finalSummary}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="grid">
            <div className="panel">
              <h2>Transcript</h2>
              <div className="transcript" style={{ maxHeight: "unset" }}>
                {call.transcriptTurns.length === 0 && <p className="empty">No transcript recorded.</p>}
                {call.transcriptTurns.map((t) => (
                  <div key={t.id} className={`bubble ${t.speaker === "CALLER" ? "caller" : "agent"}`}>
                    <span className="speaker">{t.speaker}</span>
                    {t.text}
                  </div>
                ))}
              </div>
            </div>

            <div className="stack">
              {derived && (
                <div className="panel">
                  <h2>Intake Fields</h2>
                  <table className="fieldsTable">
                    <tbody>
                      {Object.entries(derived.intakeFields).map(([k, v]) => (
                        <tr key={k}>
                          <td>{k}</td>
                          <td>{Array.isArray(v) ? v.join(", ") : String(v)}</td>
                        </tr>
                      ))}
                      {Object.keys(derived.intakeFields).length === 0 && (
                        <tr>
                          <td colSpan={2} className="missing">
                            no fields extracted
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="panel">
                <h2>Latency (measured)</h2>
                <table className="fieldsTable">
                  <tbody>
                    {latencyEvents.length === 0 && (
                      <tr>
                        <td colSpan={2} className="missing">
                          no timed events recorded
                        </td>
                      </tr>
                    )}
                    {latencyEvents.map((e, i) => (
                      <tr key={e.id ?? i}>
                        <td>{e.type}</td>
                        <td>{e.durationMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <TimelinePanel events={call.events} />
        </div>
      )}
    </main>
  );
}
