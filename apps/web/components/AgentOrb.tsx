"use client";

import { useTrackVolume, useVoiceAssistant } from "@livekit/components-react";
import { VoiceOrb, type OrbState } from "./VoiceOrb";

const STATE_LABELS: Record<OrbState, string> = {
  idle: "Ready when you are",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  error: "Connection issue",
};




export function AgentOrb() {
  const { state: agentState, audioTrack } = useVoiceAssistant();
  const volume = useTrackVolume(audioTrack);

  const orbState = mapAgentState(agentState);

  return (
    <div className="orbColumn">
      <VoiceOrb state={orbState} volume={orbState === "speaking" ? volume : 0} />
      <p className="orbLabel">{STATE_LABELS[orbState]}</p>
    </div>
  );
}

function mapAgentState(state: string): OrbState {
  switch (state) {



    case "listening":
    case "idle":
    case "initializing":
      return "listening";
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking";
    case "failed":
      return "error";
    case "connecting":
    case "pre-connect-buffering":
    default:
      return "connecting";
  }
}
