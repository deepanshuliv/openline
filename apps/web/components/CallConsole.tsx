"use client";

import { useState } from "react";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { apiClient, type CallSession } from "@/lib/api-client";
import { useCallEventStream } from "@/hooks/useCallEventStream";
import { deriveCallState } from "@/lib/deriveCallState";
import { AgentOrb } from "./AgentOrb";
import { AudioUnblocker } from "./AudioUnblocker";
import { VoiceOrb } from "./VoiceOrb";
import { PhoneCallIcon, PhoneOffIcon } from "./icons";
import { TranscriptPanel } from "./TranscriptPanel";
import { IntakeStatePanel } from "./IntakeStatePanel";
import { TimelinePanel } from "./TimelinePanel";

export function CallConsole() {
  const [session, setSession] = useState<CallSession | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);



  const [ended, setEnded] = useState(false);

  const { events, connected: streamConnected } = useCallEventStream(session?.callId ?? null);



  const agentEndedCall = deriveCallState(events).ended;
  const isLive = !!session && !ended && !agentEndedCall;

  async function handleStart() {
    setConnecting(true);
    setError(null);
    try {
      const s = await apiClient.createCallSession("Prospective Caller");
      setEnded(false);
      setSession(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  const panels = (
    <>
      <div className="callGrid">
        <TranscriptPanel events={events} />

        <div className="orbColumn">
          {isLive ? (
            <>
              <AgentOrb />
              <AudioUnblocker />
              <button className="callBtn end" onClick={() => setEnded(true)}>
                <PhoneOffIcon />
                End Call
              </button>
            </>
          ) : (
            <>
              <VoiceOrb state="idle" />
              <p className="orbLabel">Call ended</p>
              <button className="callBtn start" onClick={handleStart} disabled={connecting}>
                <PhoneCallIcon />
                {connecting ? "Connecting…" : "New Call"}
              </button>
            </>
          )}
        </div>

        <IntakeStatePanel events={events} />
      </div>

      <div className="activityLog">
        <TimelinePanel events={events} streamConnected={isLive ? streamConnected : undefined} />
      </div>
    </>
  );

  return (
    <div className="callStage">
      {error && <div className="summaryBox errorBox">{error}</div>}

      {!session ? (
        <div className="preCall">
          <VoiceOrb state="idle" />
          <p className="orbLabel">Ready when you are</p>
          <button className="callBtn start" onClick={handleStart} disabled={connecting}>
            <PhoneCallIcon />
            {connecting ? "Connecting…" : "Start Call"}
          </button>
          <p className="empty">
            You&rsquo;ll be asked for microphone access — the assistant greets you first, so just start talking once
            you hear it.
          </p>
        </div>
      ) : isLive ? (
        <LiveKitRoom
          serverUrl={session.url}
          token={session.token}




          audio={{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }}
          connect
          onDisconnected={() => setEnded(true)}
          onError={(err) => setError(err.message)}
        >
          <RoomAudioRenderer />
          {panels}
        </LiveKitRoom>
      ) : (


        panels
      )}
    </div>
  );
}
