import type { CallEventPayload } from "@repo/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export interface CallSession {
  callId: string;
  roomName: string;
  identity: string;
  token: string;
  url: string;
}

export interface CallSummary {
  id: string;
  roomName: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  finalSummary: string | null;
  caller: { id: string; name: string | null; phone: string | null } | null;
  matter: { id: string; incidentType: string | null; status: string; qualificationStatus: string } | null;
}

export interface CallDetail extends CallSummary {
  callerId: string | null;
  matterId: string | null;
  caller: (CallSummary["caller"] & { email?: string | null }) | null;
  matter:
    | (CallSummary["matter"] & {
        incidentDate: string | null;
        incidentLocation: string | null;
        incidentDescription: string | null;
        injuries: string[];
        treatmentReceived: string | null;
        emergencyServicesInvolved: boolean | null;
        policeReport: boolean | null;
        insuranceInformation: string | null;
        representedByAttorney: boolean | null;
        notes: string | null;
        appointments: { id: string; scheduledAt: string; type: string; status: string }[];
      })
    | null;
  transcriptTurns: { id: string; speaker: string; text: string; timestamp: string }[];
  events: CallEventPayload[];
}


export const apiClient = {
  createCallSession(callerName?: string): Promise<CallSession> {
    return request<CallSession>("/api/calls/session", {
      method: "POST",
      body: JSON.stringify({ callerName }),
    });
  },
  listCalls(): Promise<{ calls: CallSummary[] }> {
    return request(`/api/calls`);
  },
  getCallDetail(id: string): Promise<{ call: CallDetail }> {
    return request(`/api/calls/${id}`);
  },
  eventStreamUrl(callId: string): string {
    return `${API_URL}/api/calls/${callId}/events/stream`;
  },
};
