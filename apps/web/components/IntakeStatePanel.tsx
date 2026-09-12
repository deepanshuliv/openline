"use client";

import type { CallEventPayload } from "@repo/shared";
import { deriveCallState } from "@/lib/deriveCallState";

const FIELD_LABELS: Record<string, string> = {
  incidentType: "Incident type",
  incidentDate: "Incident date",
  incidentLocation: "Location",
  incidentDescription: "What happened",
  injuries: "Injuries",
  treatmentReceived: "Treatment received",
  emergencyServicesInvolved: "Emergency services involved",
  policeReport: "Police report",
  insuranceInformation: "Insurance info",
  otherPartyInformation: "Other party info",
  witnesses: "Witnesses",
  lostWages: "Lost wages",
  representedByAttorney: "Represented by attorney",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

export function IntakeStatePanel({ events }: { events: CallEventPayload[] }) {
  const state = deriveCallState(events);

  return (
    <div className="panel">
      <h2>
        Case Details
        <span className={`pill ${state.qualificationStatus?.toLowerCase() ?? "pending"}`}>
          <span className="dot" />
          {state.qualificationStatus ?? "not qualified yet"}
        </span>
      </h2>
      <table className="fieldsTable">
        <tbody>
          <tr>
            <td>Call stage</td>
            <td>{state.phase}</td>
          </tr>
          <tr>
            <td>Current agent</td>
            <td>{state.activeAgent ?? "—"}</td>
          </tr>
          {Object.entries(FIELD_LABELS).map(([key, label]) => {
            const value = state.intakeFields[key];
            const has = value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0) && value !== "";
            return (
              <tr key={key}>
                <td>{label}</td>
                <td className={has ? "" : "missing"}>{has ? formatValue(value) : "not yet collected"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {state.ended && state.finalSummary && (
        <div className="summaryBox" style={{ marginTop: 12 }}>
          <strong>Summary:</strong> {state.finalSummary}
        </div>
      )}
    </div>
  );
}
