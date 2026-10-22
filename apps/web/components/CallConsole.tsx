"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { LiveKitRoom, RoomAudioRenderer, useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { ConnectionError, ConnectionErrorReason, DisconnectReason, MediaDeviceFailure, Room, RoomEvent } from "livekit-client";
import { ArrowsOut, ChatCircleText, House, Microphone, MicrophoneSlash, Phone, PhoneDisconnect } from "@phosphor-icons/react";
import { apiClient, type CallSession } from "@/lib/api-client";
import { useCallEventStream } from "@/hooks/useCallEventStream";
import { deriveCallState, type TransferState } from "@/lib/deriveCallState";
import { departmentLabel } from "@/lib/format";
import { AGENT_NAME, AGENT_READY_ATTRIBUTE, CALLER_READY_ATTRIBUTE, CLINIC, DEMO_SCENARIOS } from "@/lib/shared";
import { AgentOrb } from "./AgentOrb";
import { AudioUnblocker } from "./AudioUnblocker";
import { VoiceOrb, type OrbState } from "./VoiceOrb";
import { TranscriptView, turnsFromEvents } from "./TranscriptPanel";
import { TransferBanner } from "./TransferBanner";
import { StaffOrb } from "./RoomPresence";
import { SiteNav, Wordmark } from "./SiteNav";
import { Ribbon } from "./Ribbon";
import { HomeFeatures, SCENARIO_LABELS } from "./HomeFeatures";
import { SiteFooter } from "./SiteFooter";

// How long the dialog waits for Suzi to join and be ready before giving up.
const AGENT_READY_TIMEOUT_MS = 30_000;

const MIC_OPTIONS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

type EndReason = "caller" | "dropped" | "microphone" | null;

// Steps of the "Connecting to Suzi" dialog:
// microphone: ask for permission. Nothing is created until it's allowed.
// connecting: create the call and join it with the microphone still off; Suzi
//   joins too but stays silent (see CALLER_READY_ATTRIBUTE).
// ready: Suzi has signalled AGENT_READY_ATTRIBUTE. OK turns the microphone on,
//   tells Suzi to greet, and opens the call screen.
type DialogStage = "closed" | "microphone" | "microphone-blocked" | "connecting" | "ready" | "error";

type MicResult = "granted" | "denied" | "missing" | "busy" | "unsupported" | "failed";

// The whole caller journey on one route:
// home (hero only) → dialog (microphone → connect → Suzi ready → OK) → call
// screen (orb, call controls, conversation) → ended → back home or call again.
export function CallConsole() {
  const [session, setSession] = useState<CallSession | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [stage, setStage] = useState<DialogStage>("closed");
  const [stageMessage, setStageMessage] = useState<string | null>(null);
  const [onCall, setOnCall] = useState(false);
  const [endReason, setEndReason] = useState<EndReason>(null);
  const [micProblem, setMicProblem] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Call screen view: conversation with a small orb (default), or only the orb and call buttons.
  const [fullScreen, setFullScreen] = useState(false);
  // Bumped on every start/cancel so a late response from an abandoned attempt is ignored.
  const attempt = useRef(0);
  const { isSignedIn } = useAuth();
  const router = useRouter();

  const { events } = useCallEventStream(onCall ? (session?.callId ?? null) : null);
  const derived = useMemo(() => deriveCallState(events), [events]);
  const isLive = onCall && !!session && endReason === null && !derived.ended;
  const joining = !onCall && !!session && (stage === "connecting" || stage === "ready");
  // Keep the "what to say" hints up until the caller first speaks.
  const callerHasSpoken = events.some((e) => e.type === "user.transcript.final");
  const turns = useMemo(() => turnsFromEvents(events), [events]);

  // Give up if Suzi doesn't get ready in time.
  const failRef = useRef<typeof fail | null>(null);
  useEffect(() => {
    if (stage !== "connecting" || !session) return;
    const t = setTimeout(() => failRef.current?.(`${AGENT_NAME} isn’t answering. Try again in a minute.`), AGENT_READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [stage, session]);

  useEffect(() => {
    failRef.current = fail;
  });

  function leaveRoom() {
    room?.disconnect().catch(() => undefined);
    setRoom(null);
    setSession(null);
  }

  // Back to the dialog with an explanation; whatever was half-connected is dropped.
  function fail(message: string, nextStage: DialogStage = "error") {
    attempt.current++;
    leaveRoom();
    setStageMessage(message);
    setStage(nextStage);
  }

  async function handleStart() {
    if (stage === "microphone" || stage === "connecting") return;
    // Home is public; calling Suzi is the one thing that needs an account.
    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }
    const id = ++attempt.current;
    leaveRoom();
    setOnCall(false);
    setEndReason(null);
    setMicProblem(null);
    setStageMessage(null);
    setStage("microphone");

    // 1. Microphone permission. Without it nothing is created and nobody joins.
    const mic = await requestMicrophone();
    if (id !== attempt.current) return;
    if (mic !== "granted") {
      setStageMessage(micMessage(mic));
      setStage("microphone-blocked");
      return;
    }

    // 2. Create the call and join it (microphone off). The dialog stays on
    //    "Connecting" until Suzi reports she's ready.
    setStage("connecting");
    try {
      const s = await apiClient.createCallSession("Demo Caller");
      if (id !== attempt.current) return;
      setRoom(new Room({ audioCaptureDefaults: MIC_OPTIONS }));
      setSession(s);
    } catch (err) {
      if (id !== attempt.current) return;
      setStageMessage(friendlyError(err));
      setStage("error");
    }
  }

  function handleAgentReady() {
    setStage((st) => (st === "connecting" ? "ready" : st));
  }

  // 3. OK: turn on the microphone, let Suzi speak, show the call screen.
  async function handleConfirm() {
    if (!room || stage !== "ready") return;
    const id = attempt.current;
    // Within the click, so the browser lets Suzi's voice play.
    void room.startAudio().catch(() => undefined);
    try {
      await room.localParticipant.setMicrophoneEnabled(true, MIC_OPTIONS);
    } catch (err) {
      if (id === attempt.current) fail(micMessage(micResultFromError(err)), "microphone-blocked");
      return;
    }
    try {
      await room.localParticipant.setAttributes({ [CALLER_READY_ATTRIBUTE]: "true" });
    } catch {
      if (id === attempt.current) fail("Please try again.");
      return;
    }
    if (id !== attempt.current) return;
    setStage("closed");
    setStartedAt(Date.now());
    setFullScreen(false);
    setOnCall(true);
  }

  function handleCancel() {
    attempt.current++;
    leaveRoom();
    setStage("closed");
    setStageMessage(null);
  }

  function handleRoomDisconnected(reason?: DisconnectReason) {
    // We started this one (hang up, cancel, or React re-running effects in dev).
    if (reason === DisconnectReason.CLIENT_INITIATED) return;
    if (onCall) setEndReason((r) => r ?? "dropped");
    else if (joining) fail("The line dropped. Please try again.");
  }

  // No microphone, no call: losing it mid-call hangs up instead of leaving Suzi talking to nobody.
  function handleMicLost(result: MicResult) {
    setMicProblem(micMessage(result));
    setEndReason((r) => r ?? "microphone");
    room?.disconnect().catch(() => undefined);
  }

  function handleHangUp() {
    setEndReason("caller");
    room?.disconnect().catch(() => undefined);
    // If a human had taken over, hanging up also closes out their session.
    if (derived.transfer.handoffId && derived.transfer.status !== "timed_out") {
      apiClient.completeHandoff(derived.transfer.handoffId).catch(() => undefined);
    }
  }

  function handleGoHome() {
    if (isLive) handleHangUp();
    leaveRoom();
    setOnCall(false);
    setEndReason(null);
    setMicProblem(null);
    setStartedAt(null);
  }

  const dialog = <ConnectDialog stage={stage} message={stageMessage} onConfirm={handleConfirm} onCancel={handleCancel} onRetry={handleStart} />;

  let content: React.ReactNode;
  if (!onCall || !session) {
    const callButton = (
      <button type="button" className="btn btn-primary" onClick={handleStart}>
        <Phone size={16} weight="regular" aria-hidden="true" />
        Call {AGENT_NAME}
      </button>
    );
    content = (
      <div>
        <div className="home">
          <SiteNav action={callButton} />
          <main className="hero">
          <div className="container heroInner">
            <h1 className="h1">A receptionist that never puts patients on hold</h1>
            <p className="lede">Meet {AGENT_NAME}, your clinic&rsquo;s AI receptionist. Just call and ask.</p>
            <div className="heroCtas">{callButton}</div>
            <ol className="steps" aria-label="How it works">
              <li>
                <span className="stepNum">1</span>Press Call {AGENT_NAME}
              </li>
              <li>
                <span className="stepNum">2</span>Allow the mic
              </li>
              <li>
                <span className="stepNum">3</span>Start talking
              </li>
            </ol>
            <a href="#preview" className="seeMore">
              Watch a call
            </a>
          </div>
          <Ribbon />
          </main>
        </div>
        <HomeFeatures callButton={callButton} />
        <SiteFooter />
        {dialog}
        {joining && <AgentReadyWatch onReady={handleAgentReady} />}
      </div>
    );
  } else {
    const handedOff = derived.transfer.status === "completed";
    let endedTitle = "Call ended";
    let endedBody = derived.finalSummary ?? `Thanks for calling ${CLINIC.name}.`;
    if (endReason === "microphone") {
      endedTitle = "Microphone needed";
      endedBody = micProblem ?? micMessage("denied");
    } else if (endReason === "dropped") {
      endedTitle = "The call dropped";
      endedBody = "Connection lost. Call again anytime.";
    }

    content = (
      <div className={`callScreen${fullScreen ? " fullScreen" : ""}`}>
        <header className="callTop">
          <span className="callTitle">
            <span className="wordmark">
              <Wordmark />
            </span>
            <span className="muted">On call with {AGENT_NAME} &middot; {CLINIC.name}</span>
          </span>
          {isLive && (
            <button type="button" className="btn btn-secondary" onClick={handleGoHome}>
              <House size={16} weight="regular" aria-hidden="true" />
              End call and go home
            </button>
          )}
        </header>

        {/* Chat view: the conversation fills the screen above the orb. */}
        {!fullScreen && (
          <div className="callChat">
            <TranscriptView
              turns={turns}
              emptyText={isLive ? <DemoHints /> : "Nothing was said on this call."}
              footer={
                isLive && turns.length > 0 && !callerHasSpoken ? (
                  <p className="empty">
                    <DemoHints />
                  </p>
                ) : undefined
              }
            />
          </div>
        )}

        {/* The orb sits just above the call buttons; tapping it switches views. */}
        <div className="callDock">
          <div
            role="button"
            tabIndex={0}
            className="orbButton"
            onClick={() => setFullScreen((f) => !f)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setFullScreen((f) => !f);
              }
            }}
            aria-label={fullScreen ? "Show the conversation" : `Show ${AGENT_NAME} full screen`}
            title={fullScreen ? "Show the conversation" : "Full screen"}
          >
            {isLive ? (
              handedOff ? (
                <StaffOrb fallbackName={derived.transfer.staffName} department={departmentLabel(derived.transfer.department)} />
              ) : (
                <AgentOrb />
              )
            ) : (
              <>
                <VoiceOrb state={endReason === "dropped" || endReason === "microphone" ? "error" : "idle"} />
                <p className="stageLabel">{endedTitle}</p>
              </>
            )}
          </div>
          {isLive && <TransferBanner transfer={derived.transfer} />}
          {!isLive && <p className="summaryText">{endedBody}</p>}
          <CallBar
            live={isLive}
            transfer={derived.transfer}
            startedAt={startedAt}
            fullScreen={fullScreen}
            onToggleView={() => setFullScreen((f) => !f)}
            onHangUp={handleHangUp}
            onCallAgain={handleStart}
            againLabel={endReason === "microphone" ? "Try again" : `Call ${AGENT_NAME} again`}
            onGoHome={handleGoHome}
          />
        </div>

        {isLive && <MicPermissionWatch onLost={handleMicLost} />}
        {dialog}
      </div>
    );
  }

  // Always mounted so the page doesn't re-render from scratch when the call
  // connects; it only connects while there's a call to be on.
  return (
    <LiveKitRoom
      room={room ?? undefined}
      serverUrl={session?.url}
      token={session?.token}
      connect={!!room && !!session && (joining || isLive)}
      audio={false}
      video={false}
      onDisconnected={handleRoomDisconnected}
      onMediaDeviceFailure={(failure) => isLive && handleMicLost(micResultFromFailure(failure))}
      onError={(err) => {
        if (err instanceof ConnectionError && err.reason === ConnectionErrorReason.Cancelled) return;
        handleRoomDisconnected();
      }}
    >
      <RoomAudioRenderer />
      {content}
    </LiveKitRoom>
  );
}

// Fires once the agent in this room has set AGENT_READY_ATTRIBUTE.
function AgentReadyWatch({ onReady }: { onReady: () => void }) {
  const room = useRoomContext();
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    const check = () => {
      for (const p of room.remoteParticipants.values()) {
        if (p.attributes[AGENT_READY_ATTRIBUTE] === "true") onReadyRef.current();
      }
    };
    check();
    room.on(RoomEvent.ParticipantAttributesChanged, check);
    room.on(RoomEvent.ParticipantConnected, check);
    room.on(RoomEvent.Connected, check);
    return () => {
      room.off(RoomEvent.ParticipantAttributesChanged, check);
      room.off(RoomEvent.ParticipantConnected, check);
      room.off(RoomEvent.Connected, check);
    };
  }, [room]);
  return null;
}

function ConnectDialog({
  stage,
  message,
  onConfirm,
  onCancel,
  onRetry,
}: {
  stage: DialogStage;
  message: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = stage !== "closed";
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // If the caller unblocks the microphone in browser settings, carry on by itself.
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;
  useEffect(() => {
    if (stage !== "microphone-blocked") return;
    return watchMicPermission((state) => state === "granted" && retryRef.current());
  }, [stage]);

  const copy: Record<Exclude<DialogStage, "closed">, { title: string; body: string; orb: OrbState }> = {
    microphone: {
      title: "Allow your microphone",
      body: `So ${AGENT_NAME} can hear you.`,
      orb: "connecting",
    },
    "microphone-blocked": { title: "Microphone needed", body: message ?? micMessage("denied"), orb: "error" },
    connecting: {
      title: `Connecting to ${AGENT_NAME}`,
      body: "Just a few seconds.",
      orb: "connecting",
    },
    ready: {
      title: `${AGENT_NAME} is ready`,
      body: "Press OK to start talking.",
      orb: "listening",
    },
    error: { title: `Couldn’t reach ${AGENT_NAME}`, body: message ?? "", orb: "error" },
  };
  const c = copy[stage === "closed" ? "microphone" : stage];
  const canRetry = stage === "microphone-blocked" || stage === "error";

  return (
    <dialog
      ref={ref}
      className="connectDialog"
      aria-labelledby="connect-title"
      aria-describedby="connect-body"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <VoiceOrb state={c.orb} small />
      <ol className="dialogSteps" aria-label="Progress">
        <li className={stage === "microphone" || stage === "microphone-blocked" ? "current" : "done"}>Microphone</li>
        <li className={stage === "connecting" || stage === "error" ? "current" : stage === "ready" ? "done" : ""}>Connect</li>
        <li className={stage === "ready" ? "current" : ""}>Talk</li>
      </ol>
      <h2 id="connect-title" className="h3">
        {c.title}
      </h2>
      <p id="connect-body" className="muted" aria-live="polite">
        {c.body}
      </p>
      <p className="caption">Demo only. Please don&rsquo;t share real health info.</p>
      <div className="dialogActions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        {canRetry ? (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={stage !== "ready"}>
            {stage === "ready" ? "OK" : "Please wait…"}
          </button>
        )}
      </div>
    </dialog>
  );
}

function CallBar({
  live,
  transfer,
  startedAt,
  fullScreen,
  onToggleView,
  onHangUp,
  onCallAgain,
  againLabel,
  onGoHome,
}: {
  live: boolean;
  transfer: TransferState;
  startedAt: number | null;
  fullScreen: boolean;
  onToggleView: () => void;
  onHangUp: () => void;
  onCallAgain: () => void;
  againLabel: string;
  onGoHome: () => void;
}) {
  const elapsed = useElapsed(live ? startedAt : null);
  const dept = departmentLabel(transfer.department).toLowerCase();

  let label: string;
  if (transfer.status === "completed") label = `Talking with ${transfer.staffName ?? "clinic staff"}`;
  else if (transfer.status === "requested" || transfer.status === "accepted") label = `Connecting you to the ${dept}`;
  else label = `On call with ${AGENT_NAME}`;

  if (!live) {
    return (
      <div className="callBar">
        <button type="button" className="btn btn-primary" onClick={onCallAgain}>
          <Phone size={16} weight="regular" aria-hidden="true" />
          {againLabel}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onGoHome}>
          <House size={16} weight="regular" aria-hidden="true" />
          Back home
        </button>
      </div>
    );
  }

  return (
    <div className="callBar" role="status">
      <span className="liveDot pulse" aria-hidden="true" />
      <span className="label">{label}</span>
      <span className="callTimer num">{elapsed}</span>
      <AudioUnblocker />
      <button type="button" className="btn btn-secondary" onClick={onToggleView} aria-label={fullScreen ? "Show chat" : "Full screen"}>
        {fullScreen ? <ChatCircleText size={16} weight="regular" aria-hidden="true" /> : <ArrowsOut size={16} weight="regular" aria-hidden="true" />}
        <span className="btnLabel">{fullScreen ? "Show chat" : "Full screen"}</span>
      </button>
      <MicToggle />
      <button type="button" className="btn btn-danger" onClick={onHangUp}>
        <PhoneDisconnect size={16} weight="regular" aria-hidden="true" />
        End call
      </button>
    </div>
  );
}

function MicToggle() {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  return (
    <button
      type="button"
      className={`btn ${isMicrophoneEnabled ? "btn-secondary" : "btn-muted"}`}
      onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled, MIC_OPTIONS).catch(() => undefined)}
      aria-pressed={!isMicrophoneEnabled}
      aria-label="Mute microphone"
    >
      {isMicrophoneEnabled ? <Microphone size={16} weight="regular" aria-hidden="true" /> : <MicrophoneSlash size={16} weight="regular" aria-hidden="true" />}
      <span className="btnLabel">{isMicrophoneEnabled ? "Mute" : "Unmute"}</span>
    </button>
  );
}

// Ends the call if the caller revokes microphone access while talking.
function MicPermissionWatch({ onLost }: { onLost: (result: MicResult) => void }) {
  const onLostRef = useRef(onLost);
  onLostRef.current = onLost;
  useEffect(() => watchMicPermission((state) => state === "denied" && onLostRef.current("denied")), []);
  return null;
}

// Shown in the conversation until the caller speaks: who to call as.
function DemoHints() {
  return (
    <span className="demoHints">
      <span>Try one of these:</span>
      {DEMO_SCENARIOS.map((s) => (
        <span key={s.id} className="demoHint">
          <strong>{SCENARIO_LABELS[s.id] ?? s.title}</strong>
          <span>
            &ldquo;I&rsquo;m {s.patient.name}, born {s.patient.dateOfBirth}.&rdquo;
            {s.id === "refill" && (
              <>
                {" "}
                <Link href="/staff" target="_blank" className="inlineLink">
                  Open staff console
                </Link>
              </>
            )}
          </span>
        </span>
      ))}
    </span>
  );
}

// Asks for the microphone (the browser shows its prompt) and releases it
// straight away; LiveKit opens it again when the call connects.
async function requestMicrophone(): Promise<MicResult> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return "unsupported";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const live = stream.getAudioTracks().some((t) => t.readyState === "live");
    stream.getTracks().forEach((t) => t.stop());
    return live ? "granted" : "missing";
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return "denied";
    if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
    if (name === "NotReadableError" || name === "AbortError") return "busy";
    return "failed";
  }
}

// Calls back on microphone permission changes where the browser reports them.
// Returns an unsubscribe function.
function watchMicPermission(onChange: (state: PermissionState) => void): () => void {
  let status: PermissionStatus | null = null;
  let cancelled = false;
  const handler = () => status && onChange(status.state);
  navigator.permissions
    ?.query({ name: "microphone" as PermissionName })
    .then((s) => {
      if (cancelled) return;
      status = s;
      s.addEventListener("change", handler);
    })
    .catch(() => undefined);
  return () => {
    cancelled = true;
    status?.removeEventListener("change", handler);
  };
}

function micResultFromError(err: unknown): MicResult {
  const failure = MediaDeviceFailure.getFailure(err);
  return failure ? micResultFromFailure(failure) : "failed";
}

function micResultFromFailure(failure?: MediaDeviceFailure): MicResult {
  switch (failure) {
    case MediaDeviceFailure.PermissionDenied:
      return "denied";
    case MediaDeviceFailure.NotFound:
      return "missing";
    case MediaDeviceFailure.DeviceInUse:
      return "busy";
    default:
      return "failed";
  }
}

function micMessage(result: MicResult): string {
  switch (result) {
    case "denied":
      return "Your mic is blocked. Allow it from the icon in the address bar, then try again.";
    case "missing":
      return "No microphone found. Connect one, then try again.";
    case "busy":
      return "Another app is using your mic. Close it, then try again.";
    case "unsupported":
      return "This browser can’t use a mic here. Try Chrome, Safari or Edge.";
    default:
      return "Your mic didn’t start. Check it, then try again.";
  }
}

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "No connection. Check your internet and try again.";
  }
  return "Something went wrong. Please try again.";
}

function useElapsed(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (since == null) return "0:00";
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
