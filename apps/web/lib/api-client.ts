import { getToken } from "@clerk/nextjs";
import type { CallEventPayload, LatencyStats } from "@/lib/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface Provider {
  id: string;
  name: string;
  title: string;
  specialty: string;
  acceptsNewPatients: boolean;
  // ISO weekdays, 1 = Monday.
  workDays: number[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Every /api route needs the signed-in user's Clerk session.
  const token = await getToken().catch(() => null);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(`Can't reach the API at ${API_URL}. Is it running?`, 0);
  }
  if (res.status === 401) {
    throw new ApiError("Your session has ended. Refresh the page to sign in again.", 401);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`, res.status);
  }
  return res.json() as Promise<T>;
}

export interface LiveKitSession {
  roomName: string;
  identity: string;
  token: string;
  url: string;
}

export interface CallSession extends LiveKitSession {
  callId: string;
}

export interface PatientRef {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ProviderRef {
  name: string;
  title: string;
}

export interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  visitType: string;
  reason: string | null;
  status: string;
  provider: ProviderRef;
}

export interface InsurancePlan {
  id: string;
  payer: string;
  planName: string;
  memberId: string;
  isPrimary: boolean;
  active: boolean;
  inNetwork: boolean;
  primaryCopayCents: number;
  deductibleCents: number;
  deductibleMetCents: number;
  coinsurancePct: number;
}

export interface Prescription {
  id: string;
  drugName: string;
  strength: string;
  directions: string;
  controlled: boolean;
  refillsRemaining: number;
  lastFilledAt: string | null;
  prescriber: { name: string };
}

export interface PatientDetail extends PatientRef {
  dateOfBirth: string;
  phone: string | null;
  preferredPharmacy: string | null;
  lastVisitAt: string | null;
  primaryProvider: ProviderRef | null;
  appointments: Appointment[];
  insurancePlans: InsurancePlan[];
  prescriptions: Prescription[];
}

export interface CallSummary {
  id: string;
  roomName: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  finalSummary: string | null;
  intents: string[];
  patient: PatientRef | null;
  latencyP50Ms: number | null;
}

export interface HandoffRecord {
  id: string;
  department: string;
  reason: string;
  summary: string;
  status: string;
  staffName: string | null;
  requestedAt: string;
  acceptedAt: string | null;
  endedAt: string | null;
}

export interface RefillRecord {
  id: string;
  outcome: string;
  status: string;
  pharmacy: string | null;
  notes: string | null;
  createdAt: string;
  prescription: { drugName: string; strength: string };
}

export interface CallDetail extends CallSummary {
  transcriptTurns: { id: string; speaker: string; text: string; timestamp: string }[];
  events: CallEventPayload[];
  handoffs: HandoffRecord[];
  appointments: Appointment[];
  refillRequests: RefillRecord[];
}

export interface QueuedHandoff extends Omit<HandoffRecord, "endedAt"> {
  callId: string;
  patient: (PatientRef & { dateOfBirth: string }) | null;
  call: { id: string; roomName: string; status: string };
}

export interface LatencyMetrics {
  targets: { e2e: number; stt: number; llm: number; tts: number };
  summary: { e2e: LatencyStats; stt: LatencyStats; llm: LatencyStats; tts: LatencyStats };
  turns: number;
  perCall: { callId: string; startedAt: string; p50: number | null }[];
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
  getPatient(id: string): Promise<{ patient: PatientDetail }> {
    return request(`/api/patients/${id}`);
  },
  listHandoffs(): Promise<{ handoffs: QueuedHandoff[] }> {
    return request(`/api/handoffs`);
  },
  handoffStreamUrl(): string {
    return `${API_URL}/api/handoffs/stream`;
  },
  acceptHandoff(id: string, staffName: string): Promise<{ handoff: QueuedHandoff; session: LiveKitSession }> {
    return request(`/api/handoffs/${id}/accept`, { method: "POST", body: JSON.stringify({ staffName }) });
  },
  completeHandoff(id: string): Promise<unknown> {
    return request(`/api/handoffs/${id}/complete`, { method: "POST", body: "{}" });
  },
  listProviders(): Promise<{ providers: Provider[] }> {
    return request(`/api/providers`);
  },
  getLatencyMetrics(calls = 20): Promise<LatencyMetrics> {
    return request(`/api/metrics/latency?calls=${calls}`);
  },
};
