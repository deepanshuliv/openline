"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react";
import { AGENT_NAME, LATENCY_TARGETS_MS } from "@/lib/shared";
import { apiClient, type CallSummary } from "@/lib/api-client";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { StatsRow } from "@/components/StatsRow";
import { PageHeader } from "@/components/PageHeader";
import { CallStatus } from "@/components/CallStatus";
import { INTENT_LABELS, callerName, formatCallTime, formatMs, latencyTone } from "@/lib/format";

export default function CallsPage() {
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .listCalls()
      .then((res) => setCalls(res.calls))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <>
      <SiteNav />
      <main>
        <div className="container">
          <PageHeader eyebrow="Records" title="Call history" lede={`Every call ${AGENT_NAME} answered: who it was, what they needed and how fast she replied.`} />
        </div>

        <StatsRow linkToHistory={false} />

        <section className="section tight">
          <div className="container">
            {error && <div className="notice error">Couldn&rsquo;t load calls: {error}</div>}
            {!calls && !error && <p className="empty">Loading calls</p>}
            {calls && calls.length === 0 && (
              <p className="empty">
                No calls yet.{" "}
                <Link href="/" className="inlineLink">
                  Place the first one
                </Link>
                .
              </p>
            )}
            {calls && calls.length > 0 && (
              <div className="callList">
                <div className="callRow head" aria-hidden="true">
                  <span>Started</span>
                  <span>Patient</span>
                  <span>Requests</span>
                  <span>Status</span>
                  <span>Median reply</span>
                  <span />
                </div>
                {calls.map((c) => (
                  <Link key={c.id} href={`/calls/${c.id}`} className="callRow">
                    <span className="when num">{formatCallTime(c.startedAt)}</span>
                    <span className={`patient${c.patient ? "" : " muted"}`}>{callerName(c.patient)}</span>
                    <span className="intents chips">
                      {c.intents.length === 0 && <span className="muted">None recorded</span>}
                      {c.intents.map((i) => (
                        <span key={i} className="chip">
                          {INTENT_LABELS[i] ?? i}
                        </span>
                      ))}
                    </span>
                    <CallStatus status={c.status} />
                    <span className={`latency num tone-${latencyTone(c.latencyP50Ms, LATENCY_TARGETS_MS.e2e)}`}>{formatMs(c.latencyP50Ms)}</span>
                    <CaretRight size={16} weight="regular" className="chev muted" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
