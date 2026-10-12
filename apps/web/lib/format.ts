import { CLINIC, DEPARTMENT_LABELS, VISIT_TYPE_INFO, type Department, type VisitType } from "@/lib/shared";

export const INTENT_LABELS: Record<string, string> = {
  BOOK: "Book",
  RESCHEDULE: "Reschedule",
  CANCEL: "Cancel",
  INSURANCE: "Insurance",
  REFILL: "Refill",
  ESCALATION: "Escalation",
  OTHER: "Other",
};

export const REFILL_OUTCOME_LABELS: Record<string, string> = {
  SENT_TO_PHARMACY: "Sent to pharmacy",
  PROVIDER_APPROVAL_REQUIRED: "Sent to prescriber for renewal",
  VISIT_REQUIRED: "Visit required first",
  CLINICIAN_REVIEW: "Needs clinician review",
};

export function departmentLabel(d: string | null | undefined): string {
  if (!d) return "staff";
  return DEPARTMENT_LABELS[d as Department] ?? d;
}

export function visitTypeLabel(v: string | null | undefined): string {
  if (!v) return "Visit";
  return VISIT_TYPE_INFO[v as VisitType]?.label ?? v;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Dates of birth are stored as date-only values (UTC midnight).
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

export function formatMs(ms: number | null | undefined): string {
  return ms == null ? "-" : `${Math.round(ms)} ms`;
}

export function latencyTone(ms: number | null | undefined, target: number): "good" | "warn" | "bad" | "none" {
  if (ms == null) return "none";
  if (ms <= target) return "good";
  if (ms <= target * 1.5) return "warn";
  return "bad";
}

export function formatElapsed(fromIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

// Call start times everywhere (history list, call record): clinic-local, to the minute.
export function formatCallTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC.timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Call length as m:ss, the same format as the live call timer.
export function formatDuration(fromIso: string | null | undefined, toIso: string | null | undefined): string {
  if (!fromIso || !toIso) return "-";
  const s = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// One name for a caller wherever they appear; unverified callers are never just "Caller".
export function callerName(patient: { firstName: string; lastName: string } | null | undefined): string {
  return patient ? `${patient.firstName} ${patient.lastName}` : "Unverified caller";
}
