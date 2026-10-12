"use client";

import { useTrackVolume, useVoiceAssistant } from "@livekit/components-react";
import { VoiceOrb, type OrbState } from "./VoiceOrb";

const AGENT_STATE_LABELS: Record<OrbState, string> = {
  idle: "Ready when you are",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  staff: "Talking with staff",
  error: "Connection issue",
};

export function AgentOrb() {
  const { state: agentState, audioTrack } = useVoiceAssistant();
  const volume = useTrackVolume(audioTrack);
  const orbState = mapAgentState(agentState);

  return (
    <>
      <VoiceOrb state={orbState} volume={orbState === "speaking" ? volume : 0} />
      <p className="stageLabel" aria-live="polite">
        {AGENT_STATE_LABELS[orbState]}
      </p>
    </>
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
