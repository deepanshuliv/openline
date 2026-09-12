"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiClient, type CallSummary } from "@/lib/api-client";

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
    <main className="page">
      <div className="topbar">
        <div className="brand">
          <h1>Call History</h1>
          <span className="tag">{calls ? `${calls.length} calls` : "loading…"}</span>
        </div>
        <nav className="nav">
          <Link href="/">Live Call</Link>
          <Link href="/calls">Call History</Link>
        </nav>
      </div>

      {error && (
        <div className="summaryBox errorBox">{error}</div>
      )}

      {calls && calls.length === 0 && (
        <p className="empty">
          No calls yet — <Link href="/" className="inlineLink">start one</Link> to see it here.
        </p>
      )}

      {calls && calls.length > 0 && (
        <table className="callsTable">
          <thead>
            <tr>
              <th>Started</th>
              <th>Caller</th>
              <th>Incident</th>
              <th>Status</th>
              <th>Qualification</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/calls/${c.id}`}>{new Date(c.startedAt).toLocaleString()}</Link>
                </td>
                <td>{c.caller?.name ?? "—"}</td>
                <td>{c.matter?.incidentType ?? "—"}</td>
                <td>{c.status}</td>
                <td>{c.matter?.qualificationStatus ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
