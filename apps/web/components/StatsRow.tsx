"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AGENT_NAME, LATENCY_TARGETS_MS } from "@/lib/shared";
import { apiClient, type LatencyMetrics } from "@/lib/api-client";

// Measured numbers only: everything here comes from /api/metrics/latency.
export function StatsRow({ refreshKey = 0, linkToHistory = true }: { refreshKey?: number; linkToHistory?: boolean }) {
  const [metrics, setMetrics] = useState<LatencyMetrics | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getLatencyMetrics(20)
      .then((m) => {
        if (!cancelled) {
          setMetrics(m);
          setFailed(false);
        }
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const p50 = metrics?.summary.e2e.p50 ?? null;
  const hasData = !!metrics && metrics.turns > 0;

  return (
    <div className="container">
      <div className="statsRow">
        <div className="stat">
          <span className="statValue num">
            {hasData && p50 != null ? Math.round(p50) : "-"}
            <small>ms</small>
          </span>
          <span className="statLabel">median reply time, measured live</span>
        </div>
        <div className="stat">
          <span className="statValue num">{hasData ? metrics!.turns : "-"}</span>
          <span className="statLabel">turns measured across {hasData ? metrics!.perCall.length : 0} recent calls</span>
        </div>
        <div className="stat">
          <span className="statValue num">
            {LATENCY_TARGETS_MS.e2e}
            <small>ms</small>
          </span>
          <span className="statLabel">target from end of speech to first audio</span>
        </div>
        <p className="statNote">
          {failed
            ? "Latency stats are unavailable while the API is offline."
            : hasData
              ? (
                  <>
                    Every one of {AGENT_NAME}&rsquo;s replies is timed across speech recognition, the model and voice synthesis.
                    {linkToHistory && (
                      <>
                        {" "}
                        <Link href="/calls" className="inlineLink">
                          See call history
                        </Link>
                      </>
                    )}
                  </>
                )
              : "No calls measured yet. Place a call and the numbers fill in from real turns."}
        </p>
      </div>
    </div>
  );
}
