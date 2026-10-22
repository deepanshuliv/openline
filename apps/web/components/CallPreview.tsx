"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, Waveform } from "@phosphor-icons/react";
import { AGENT_NAME } from "@/lib/shared";

// A looping, illustrative call: the landing page shows what Suzi does instead
// of describing it. Lines appear one by one, including the bridging line she
// says while she looks things up, and end on a booking confirmation.
type Step =
  | { kind: "caller" | "agent"; text: string }
  | { kind: "bridge"; text: string }
  | { kind: "receipt"; title: string; detail: string };

const SCRIPT: Step[] = [
  { kind: "caller", text: "Hi, I’d like to book my annual physical." },
  { kind: "agent", text: "Happy to help. What’s your name and date of birth?" },
  { kind: "caller", text: "Maria Gonzalez, March 14th, 1985." },
  { kind: "bridge", text: "Thanks, let me pull up your chart." },
  { kind: "agent", text: "Dr. Patel has Monday at 9 AM. Does that work?" },
  { kind: "caller", text: "Perfect." },
  { kind: "receipt", title: "Booked", detail: "Annual physical · Mon 9:00 AM · Dr. Anita Patel" },
];

const STEP_MS = 1100;
const HOLD_MS = 3000;

export function CallPreview() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(SCRIPT.length);
      return;
    }
    let visible = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let count = 1;
    const tick = () => {
      if (!visible) return;
      count = count >= SCRIPT.length ? 1 : count + 1;
      setShown(count);
      timer = setTimeout(tick, count >= SCRIPT.length ? HOLD_MS : STEP_MS);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      clearTimeout(timer);
      if (visible) timer = setTimeout(tick, STEP_MS);
    });
    if (ref.current) io.observe(ref.current);
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, []);

  return (
    <div ref={ref} className="callPreview" aria-label={`Example call with ${AGENT_NAME}`}>
      <div className="previewHead">
        <span className="previewOrb" aria-hidden="true" />
        <span>
          <strong>{AGENT_NAME}</strong>
          <span className="muted"> · on the line</span>
        </span>
        <span className="previewTime num">0:42</span>
      </div>
      <ol className="previewLines">
        {SCRIPT.slice(0, shown).map((step, i) => (
          <li key={i} className={`previewLine ${step.kind}`}>
            {step.kind === "receipt" ? (
              <>
                <CheckCircle size={20} weight="fill" aria-hidden="true" />
                <span>
                  <strong>{step.title}</strong>
                  <span className="muted">{step.detail}</span>
                </span>
              </>
            ) : step.kind === "bridge" ? (
              <>
                <Waveform size={14} aria-hidden="true" />
                {step.text}
              </>
            ) : (
              step.text
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
