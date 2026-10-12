"use client";

import { useEffect, useState } from "react";
import { AGENT_NAME, formatCents } from "@/lib/shared";
import { apiClient, type PatientDetail } from "@/lib/api-client";
import { formatDate, formatDateTime, visitTypeLabel } from "@/lib/format";

// The verified patient's chart. `refreshKey` changes whenever the call
// produces an event that may have modified it (booking, refill, ...).
export function PatientPanel({ patientId, refreshKey = 0 }: { patientId: string | null; refreshKey?: number }) {
  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId) {
      setPatient(null);
      return;
    }
    let cancelled = false;
    apiClient
      .getPatient(patientId)
      .then((res) => {
        if (!cancelled) {
          setPatient(res.patient);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [patientId, refreshKey]);

  if (!patientId) {
    return (
      <section className="inner">
        <div className="innerHead">Patient</div>
        <p className="empty">Not verified yet. {AGENT_NAME} confirms name and date of birth before opening the chart.</p>
      </section>
    );
  }

  const upcoming = (patient?.appointments ?? []).filter((a) => a.status === "SCHEDULED" && new Date(a.endsAt).getTime() > Date.now());

  return (
    <section className="inner">
      <div className="innerHead">
        Patient
        <span className="chip good">Verified</span>
      </div>
      {error && <p className="empty">Couldn&rsquo;t load the chart: {error}</p>}
      {!patient && !error && <p className="empty">Loading chart</p>}
      {patient && (
        <>
          <div className="patientName">
            {patient.firstName} {patient.lastName}
          </div>
          <div className="patientMeta">
            Born {formatDate(patient.dateOfBirth)}
            {patient.primaryProvider && `, sees ${patient.primaryProvider.name}`}
          </div>

          <div className="chartGroup">
            <h4>Upcoming visits</h4>
            {upcoming.length === 0 && <p className="empty">None scheduled.</p>}
            {upcoming.map((a) => (
              <div key={a.id} className="chartRow">
                <span className="chartMain">{formatDateTime(a.startsAt)}</span>
                <span className="chartSub">
                  {visitTypeLabel(a.visitType)} with {a.provider.name}
                </span>
              </div>
            ))}
          </div>

          <div className="chartGroup">
            <h4>Insurance</h4>
            {patient.insurancePlans.length === 0 && <p className="empty">No plan on file.</p>}
            {patient.insurancePlans.map((p) => (
              <div key={p.id} className="chartRow">
                <span className="chartMain">
                  {p.planName}
                  <span className={`chip ${p.active ? "good" : "faint"}`}>{p.active ? "Active" : "Inactive"}</span>
                  {p.active && !p.inNetwork && <span className="chip warn">Out of network</span>}
                </span>
                <span className="chartSub">
                  {formatCents(p.primaryCopayCents)} copay, {formatCents(p.deductibleMetCents)} of {formatCents(p.deductibleCents)} deductible met
                </span>
              </div>
            ))}
          </div>

          <div className="chartGroup">
            <h4>Medications</h4>
            {patient.prescriptions.length === 0 && <p className="empty">No active prescriptions.</p>}
            {patient.prescriptions.map((rx) => (
              <div key={rx.id} className="chartRow">
                <span className="chartMain">
                  {rx.drugName} {rx.strength}
                  {rx.controlled && <span className="chip bad">Controlled</span>}
                </span>
                <span className="chartSub">
                  {rx.refillsRemaining} refill{rx.refillsRemaining === 1 ? "" : "s"} left, last filled {formatDate(rx.lastFilledAt)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
