import type { CSSProperties } from "react";

export type OrbState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";











export function VoiceOrb({ state, volume = 0 }: { state: OrbState; volume?: number }) {
  return (
    <div className={`orbWrap orb-${state}`} style={{ "--volume": volume } as CSSProperties}>
      <div className="orbGlow" />
      <div className="orbSphere">
        <div className="orbLayer l1" />
        <div className="orbLayer l2" />
        <div className="orbLayer l3" />
        <div className="orbShine" />
      </div>
    </div>
  );
}
