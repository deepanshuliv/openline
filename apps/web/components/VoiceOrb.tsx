import type { CSSProperties } from "react";

export type OrbState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "staff" | "error";

// Grainy gradient sphere. Palette follows the conversation state; size
// follows the speaker's volume (0..1).
export function VoiceOrb({ state, volume = 0, small = false }: { state: OrbState; volume?: number; small?: boolean }) {
  return (
    <div
      className={`orb state-${state}${small ? " small" : ""}`}
      style={{ "--volume": Math.min(1, Math.max(0, volume)) } as CSSProperties}
      role="img"
      aria-label={`Voice state: ${state}`}
    />
  );
}
