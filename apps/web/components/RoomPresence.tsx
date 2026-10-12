"use client";

import { useIsSpeaking, useRemoteParticipants } from "@livekit/components-react";
import type { RemoteParticipant } from "livekit-client";
import { AGENT_NAME, CALLER_IDENTITY_PREFIX, STAFF_IDENTITY_PREFIX } from "@/lib/shared";
import { VoiceOrb } from "./VoiceOrb";

// Caller-side view once a human has taken over: the orb follows the staff
// member's voice instead of the agent's.
export function StaffOrb({ fallbackName, department }: { fallbackName: string | null; department: string }) {
  const staff = useRemoteParticipants().find((p) => p.identity.startsWith(STAFF_IDENTITY_PREFIX));
  return staff ? (
    <SpeakingOrb participant={staff} label={`Talking with ${staff.name || fallbackName || "staff"}, ${department.toLowerCase()}`} />
  ) : (
    <>
      <VoiceOrb state="connecting" />
      <p className="stageLabel">Waiting for {fallbackName ?? "staff"} to connect</p>
    </>
  );
}

function SpeakingOrb({ participant, label }: { participant: RemoteParticipant; label: string }) {
  const speaking = useIsSpeaking(participant);
  return (
    <>
      <VoiceOrb state="staff" volume={speaking ? 0.45 : 0} />
      <p className="stageLabel">{label}</p>
    </>
  );
}

// Staff-side line showing who else is in the room.
export function ParticipantsIndicator() {
  const remotes = useRemoteParticipants();
  const caller = remotes.find((p) => p.identity.startsWith(CALLER_IDENTITY_PREFIX));
  const agent = remotes.find((p) => p.isAgent);
  return (
    <div className="presence">
      {caller ? <CallerChip participant={caller} /> : (
        <span className="chip">
          <span className="liveDot off" aria-hidden="true" />
          Caller left
        </span>
      )}
      <span className="chip">
        <span className={`liveDot ${agent ? "pending pulse" : "off"}`} aria-hidden="true" />
        {agent ? `${AGENT_NAME} is briefing you` : `${AGENT_NAME} has left`}
      </span>
    </div>
  );
}

function CallerChip({ participant }: { participant: RemoteParticipant }) {
  const speaking = useIsSpeaking(participant);
  return (
    <span className="chip">
      <span className={`liveDot${speaking ? " pulse" : ""}`} aria-hidden="true" />
      {speaking ? "Caller speaking" : "Caller connected"}
    </span>
  );
}
