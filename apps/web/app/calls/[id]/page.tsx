"use client";

import { use, useEffect, useMemo, useState } from "react";
import { ArrowsLeftRight, CalendarCheck, CalendarX, Pill } from "@phosphor-icons/react";
import { LATENCY_TARGETS_MS } from "@/lib/shared";
import { apiClient, type CallDetail } from "@/lib/api-client";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { TimelinePanel } from "@/components/TimelinePanel";
import { TranscriptView, type Speaker } from "@/components/TranscriptPanel";
import { LatencyPanel } from "@/components/LatencyPanel";
import { PageHeader } from "@/components/PageHeader";
import { CallStatus } from "@/components/CallStatus";
import { OutcomeList, type Outcome } from "@/components/OutcomesPanel";
import { latencyTurns } from "@/lib/deriveCallState";
import { INTENT_LABELS, REFILL_OUTCOME_LABELS, callerName, departmentLabel, formatCallTime, formatDate, formatDateTime, formatDuration, formatMs, latencyTone, visitTypeLabel } from "@/lib/format";

const SPEAKER: Record<string, Speaker> = { CALLER: "caller", AGENT: "agent", STAFF: "staff", SYSTEM: "system" };

function recordOutcomes(call: CallDetail): Outcome[] {
  return [
    ...call.appointments.map<Outcome>((a) => ({
      key: a.id,
      icon: a.status === "CANCELLED" ? CalendarX : CalendarCheck,
      tone: a.status === "CANCELLED" ? "warn" : "ok",
      title: `${visitTypeLabel(a.visitType)}, ${a.status.toLowerCase()}`,
      detail: `${a.provider.name}, ${formatDateTime(a.startsAt)}`,
    })),
    ...call.refillRequests.map<Outcome>((r) => ({
      key: r.id,
      icon: Pill,
      tone: r.status === "ESCALATED" ? "danger" : "ok",
      title: `Refill: ${r.prescription.drugName} ${r.prescription.strength}`,
      detail: `${REFILL_OUTCOME_LABELS[r.outcome] ?? r.outcome}${r.pharmacy ? `, ${r.pharmacy}` : ""}`,
      notes: r.notes ? [r.notes] : undefined,
    })),
    ...call.handoffs.map<Outcome>((h) => ({
      key: h.id,
      icon: ArrowsLeftRight,
      tone: "info",
      title: `Transfer to ${departmentLabel(h.department).toLowerCase()}, ${h.status.toLowerCase().replace("_", " ")}`,
      detail: `${h.reason}${h.staffName ? `. Taken by ${h.staffName}` : ""}${h.acceptedAt ? ` on ${formatDate(h.acceptedAt)}` : ""}`,
      notes: [h.summary],
    })),
  ];
}

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

  const turns = useMemo(() => (call ? latencyTurns(call.events) : []), [call]);
  const outcomes = useMemo(() => (call ? recordOutcomes(call) : []), [call]);

  return (
    <>
      <SiteNav />
      <main className="container">
        {error && <div className="notice error pageNotice">Couldn&rsquo;t load this call: {error}</div>}
        {!call && !error && <p className="empty pageNotice">Loading call</p>}

        {call && (
          <>
            <PageHeader eyebrow="Call record" title={callerName(call.patient)} lede={call.finalSummary ?? undefined}>
              <dl className="detailMeta">
                <div>
                  <dt>Status</dt>
                  <dd>
                    <CallStatus status={call.status} />
                  </dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd className="num">{formatCallTime(call.startedAt)}</dd>
                </div>
                <div>
                  <dt>Length</dt>
                  <dd className="num">{formatDuration(call.startedAt, call.endedAt)}</dd>
                </div>
                <div>
                  <dt>Requests</dt>
                  <dd className="chips">
                    {call.intents.length === 0 && "None recorded"}
                    {call.intents.map((i) => (
                      <span key={i} className="chip">
                        {INTENT_LABELS[i] ?? i}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>
            </PageHeader>

            <div className="detailGrid">
              <div className="liveMain">
                <section className="inner">
                  <div className="innerHead">
                    Transcript
                    <span className="meta">{call.transcriptTurns.length} turns</span>
                  </div>
                  <TranscriptView
                    emptyText="No transcript recorded."
                    turns={call.transcriptTurns.map((t) => ({ key: t.id, speaker: SPEAKER[t.speaker] ?? "system", text: t.text }))}
                  />
                </section>
                <section className="inner">
                  <div className="innerHead">Outcomes</div>
                  {outcomes.length === 0 ? <p className="empty">No bookings, refills or transfers on this call.</p> : <OutcomeList outcomes={outcomes} />}
                </section>
              </div>

              <div className="liveSide">
                <LatencyPanel turns={turns} />
                <section className="inner">
                  <div className="innerHead">Every reply</div>
                  {turns.length === 0 ? (
                    <p className="empty">No latency samples recorded.</p>
                  ) : (
                    <div className="tableScroll">
                      <table className="turnTable">
                        <thead>
                          <tr>
                            <th>Turn</th>
                            <th>Total</th>
                            <th>Speech to text</th>
                            <th>End of turn</th>
                            <th>Model</th>
                            <th>Voice</th>
                          </tr>
                        </thead>
                        <tbody>
                          {turns.map((t, i) => (
                            <tr key={i}>
                              <td>{i + 1}</td>
                              <td className={`tone-${latencyTone(t.e2eMs, LATENCY_TARGETS_MS.e2e)}`}>{formatMs(t.e2eMs)}</td>
                              <td className={`tone-${latencyTone(t.sttMs, LATENCY_TARGETS_MS.stt)}`}>{formatMs(t.sttMs)}</td>
                              <td>{formatMs(t.endOfTurnMs)}</td>
                              <td className={`tone-${latencyTone(t.llmTtftMs, LATENCY_TARGETS_MS.llm)}`}>{formatMs(t.llmTtftMs)}</td>
                              <td className={`tone-${latencyTone(t.ttsTtfbMs, LATENCY_TARGETS_MS.tts)}`}>{formatMs(t.ttsTtfbMs)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            </div>

            <TimelinePanel events={call.events} />
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
