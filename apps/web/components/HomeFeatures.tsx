"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowsClockwise, CalendarPlus, Clock, FirstAid, Headset, IdentificationCard, Pill, ShieldCheck } from "@phosphor-icons/react";
import { apiClient, type Provider } from "@/lib/api-client";
import { CallPreview } from "./CallPreview";
import { AGENT_NAME, DEMO_SCENARIOS } from "@/lib/shared";

// One short line each: scannable, no jargon.
const FEATURES: { icon: ReactNode; title: string; body: string }[] = [
  { icon: <CalendarPlus size={22} weight="regular" />, title: "Book a visit", body: "Real open times, booked in seconds." },
  { icon: <ArrowsClockwise size={22} weight="regular" />, title: "Move or cancel", body: "Change plans with one call." },
  { icon: <ShieldCheck size={22} weight="regular" />, title: "Insurance questions", body: "Coverage and costs, in plain words." },
  { icon: <Pill size={22} weight="regular" />, title: "Prescription refills", body: "Sent straight to your pharmacy." },
  { icon: <Headset size={22} weight="regular" />, title: "A real person", body: "Staff join the call, already briefed." },
  { icon: <IdentificationCard size={22} weight="regular" />, title: "Private", body: "Checks it’s you before anything personal." },
  { icon: <FirstAid size={22} weight="regular" />, title: "Safe", body: "No medical advice. Emergencies: call 911." },
  { icon: <Clock size={22} weight="regular" />, title: "Never on hold", body: "Answers right away, every time." },
];

// Plain-language names for the demo scenarios.
export const SCENARIO_LABELS: Record<string, string> = {
  book: "Book a visit",
  reschedule: "Move or cancel",
  insurance: "Check insurance",
  refill: "Refill + talk to a nurse",
};

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Below the one-screen hero: what Suzi can do, who she books with, and how to try it.
export function HomeFeatures({ callButton }: { callButton: ReactNode }) {
  const [providers, setProviders] = useState<Provider[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listProviders()
      .then((r) => !cancelled && setProviders(r.providers))
      .catch(() => !cancelled && setProviders([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <section id="preview" className="section" aria-labelledby="preview-title">
        <div className="container previewGrid">
          <div className="previewCopy reveal">
            <h2 id="preview-title" className="h2">
              Say it once.
              <br />
              <em>{AGENT_NAME} handles the rest.</em>
            </h2>
            <p className="lede muted">No menus. No hold music. Just a conversation.</p>
            <div>{callButton}</div>
          </div>
          <div className="reveal" style={{ "--stagger": "10%" } as React.CSSProperties}>
            <CallPreview />
          </div>
        </div>
      </section>

      <section id="features" className="section" aria-labelledby="features-title">
        <div className="container">
          <h2 id="features-title" className="h2 reveal">
            What {AGENT_NAME} can do
          </h2>
          <ol className="featureList">
            {FEATURES.map((f, i) => (
              <li key={f.title} className="featureRow reveal" style={{ "--stagger": `${(i % 2) * 8}%` } as React.CSSProperties}>
                <span className="featureNum num">{String(i + 1).padStart(2, "0")}</span>
                <span className="featureIcon" aria-hidden="true">
                  {f.icon}
                </span>
                <span className="featureText">
                  <span className="featureTitle">{f.title}</span>
                  <span className="featureBody">{f.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {providers && providers.length > 0 && (
        <section className="section tight" aria-labelledby="team-title">
          <div className="container">
            <h2 id="team-title" className="h2 reveal">
              Your care team
            </h2>
            <div className="teamGrid">
              {providers.map((p, i) => (
                <div key={p.id} className="teamCard reveal" style={{ "--stagger": `${i * 8}%` } as React.CSSProperties}>
                  <span className={`avatar tone-${i % 3}`} aria-hidden="true">
                    {initials(p.name)}
                  </span>
                  <span className="teamText">
                    <span className="teamName">
                      {p.name}
                      {p.title === "NP" ? ", NP" : ""}
                    </span>
                    <span className="muted">{p.specialty}</span>
                    <DayDots days={p.workDays} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section tight" aria-labelledby="try-title">
        <div className="container">
          <div className="ctaBand reveal">
            <h2 id="try-title" className="h2">
              Try it now
            </h2>
            <p className="lede">Call as a demo patient:</p>
            <div className="teamGrid">
              {DEMO_SCENARIOS.map((s) => (
                <div key={s.id} className="teamCard">
                  <span className="teamText">
                    <span className="teamName">{SCENARIO_LABELS[s.id] ?? s.title}</span>
                    <span className="muted">
                      {s.patient.name}, born {s.patient.dateOfBirth}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <div className="heroCtas">{callButton}</div>
          </div>
        </div>
      </section>
    </>
  );
}

function initials(name: string): string {
  return name
    .replace(/^Dr\.\s*/, "")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2);
}

// Mon to Fri as five dots, filled on the days the provider sees patients.
function DayDots({ days }: { days: number[] }) {
  return (
    <span className="dayDots" aria-label={`Sees patients ${workDays(days)}`}>
      {[1, 2, 3, 4, 5].map((d) => (
        <span key={d} className={`dayDot${days.includes(d) ? " on" : ""}`} aria-hidden="true">
          {DAY_NAMES[d]![0]}
        </span>
      ))}
    </span>
  );
}

function workDays(days: number[]): string {
  const sorted = [...days].sort();
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  if (sorted.length >= 3 && consecutive) return `${DAY_NAMES[sorted[0]!]} to ${DAY_NAMES[sorted[sorted.length - 1]!]}`;
  return sorted.map((d) => DAY_NAMES[d]).join(", ");
}
