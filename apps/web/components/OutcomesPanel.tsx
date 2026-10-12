"use client";

import { ArrowsLeftRight, CalendarCheck, CalendarX, Pill, ShieldCheck, type Icon } from "@phosphor-icons/react";
import { AGENT_NAME, CallEventType, formatCents, type CallEventPayload } from "@/lib/shared";
import { REFILL_OUTCOME_LABELS, departmentLabel, formatDateTime, visitTypeLabel } from "@/lib/format";

export interface Outcome {
  key: string;
  icon: Icon;
  tone: "ok" | "warn" | "danger" | "info";
  title: string;
  detail: string;
  notes?: string[];
}

const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" ? v : null);
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function outcomesFromEvents(events: CallEventPayload[]): Outcome[] {
  const out: Outcome[] = [];
  for (const e of events) {
    const m = e.metadata ?? {};
    const key = e.id ?? `${e.type}-${e.timestamp}`;
    switch (e.type) {
      case CallEventType.APPOINTMENT_BOOKED:
        out.push({
          key,
          icon: CalendarCheck,
          tone: "ok",
          title: "Appointment booked",
          detail: `${visitTypeLabel(s(m.visitType))} with ${s(m.provider)}, ${formatDateTime(s(m.startsAt))}`,
        });
        break;
      case CallEventType.APPOINTMENT_RESCHEDULED:
        out.push({
          key,
          icon: CalendarCheck,
          tone: "ok",
          title: "Appointment rescheduled",
          detail: `${s(m.provider)}: ${formatDateTime(s(m.previousStartsAt))} → ${formatDateTime(s(m.startsAt))}`,
        });
        break;
      case CallEventType.APPOINTMENT_CANCELLED:
        out.push({ key, icon: CalendarX, tone: "warn", title: "Appointment cancelled", detail: `${s(m.provider)}, ${formatDateTime(s(m.startsAt))}` });
        break;
      case CallEventType.INSURANCE_CHECKED: {
        const eligible = m.eligible === true;
        const copay = n(m.copayCents);
        const deductible = n(m.deductibleRemainingCents);
        const parts = [
          eligible ? (m.inNetwork === false ? "Eligible, out of network" : "Eligible, in network") : "Not eligible",
          copay != null ? `copay ${formatCents(copay)}` : null,
          deductible != null ? `${formatCents(deductible)} deductible left` : null,
          n(m.coinsurancePct) ? `${n(m.coinsurancePct)}% coinsurance` : null,
        ].filter(Boolean);
        out.push({
          key,
          icon: ShieldCheck,
          tone: eligible ? (m.priorAuthRequired === true ? "warn" : "ok") : "danger",
          title: `${s(m.planName) || s(m.payer)}${m.visitType ? `, ${visitTypeLabel(s(m.visitType)).toLowerCase()}` : ""}`,
          detail: parts.join(", "),
          notes: list(m.reasons),
        });
        break;
      }
      case CallEventType.REFILL_REQUESTED: {
        const outcome = s(m.outcome);
        out.push({
          key,
          icon: Pill,
          tone: m.escalate === true ? "danger" : outcome === "SENT_TO_PHARMACY" ? "ok" : "warn",
          title: `Refill: ${s(m.drugName)}`,
          detail: REFILL_OUTCOME_LABELS[outcome] ?? outcome,
          notes: list(m.reasons),
        });
        break;
      }
      case CallEventType.TRANSFER_REQUESTED:
        out.push({ key, icon: ArrowsLeftRight, tone: "info", title: `Transfer to ${departmentLabel(s(m.department)).toLowerCase()}`, detail: s(m.reason) || s(m.summary) });
        break;
      case CallEventType.TRANSFER_ACCEPTED:
        out.push({ key, icon: ArrowsLeftRight, tone: "info", title: "Staff accepted", detail: `${s(m.staffName)} is joining the call` });
        break;
      case CallEventType.TRANSFER_COMPLETED:
        out.push({ key, icon: ArrowsLeftRight, tone: "ok", title: "Warm transfer complete", detail: `Caller is now with ${s(m.staffName)}` });
        break;
      case CallEventType.TRANSFER_TIMED_OUT:
        out.push({ key, icon: ArrowsLeftRight, tone: "warn", title: "Transfer timed out", detail: `No one answered, so ${AGENT_NAME} took the call back.` });
        break;
    }
  }
  return out;
}

export function OutcomesPanel({ events }: { events: CallEventPayload[] }) {
  const outcomes = outcomesFromEvents(events);
  return (
    <section className="inner">
      <div className="innerHead">
        Outcomes
        {outcomes.length > 0 && <span className="meta">{outcomes.length}</span>}
      </div>
      {outcomes.length === 0 && <p className="empty">Bookings, coverage checks, refills and transfers show up here as they happen.</p>}
      <OutcomeList outcomes={outcomes} />
    </section>
  );
}

export function OutcomeList({ outcomes }: { outcomes: Outcome[] }) {
  return (
    <div className="outcomeList">
      {outcomes.map((o) => (
        <div key={o.key} className={`outcome ${o.tone}`}>
          <o.icon size={18} weight="regular" className="outcomeIcon" aria-hidden="true" />
          <span>{o.title}</span>
          {o.detail && <span className="outcomeDetail">{o.detail}</span>}
          {o.notes && o.notes.length > 0 && (
            <ul className="outcomeNotes">
              {o.notes.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
