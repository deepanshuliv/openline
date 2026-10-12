"use client";

import { useEffect, useMemo, useState } from "react";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { Headset, PhoneDisconnect } from "@phosphor-icons/react";
import { ApiError, apiClient, type LiveKitSession, type QueuedHandoff } from "@/lib/api-client";
import { useHandoffQueue } from "@/hooks/useHandoffQueue";
import { useCallEventStream } from "@/hooks/useCallEventStream";
import { chartRevision, deriveCallState } from "@/lib/deriveCallState";
import { callerName, departmentLabel, formatDate, formatElapsed } from "@/lib/format";
import { AGENT_NAME } from "@/lib/shared";
import { AudioUnblocker } from "./AudioUnblocker";
import { PatientPanel } from "./PatientPanel";
import { TranscriptPanel } from "./TranscriptPanel";
import { OutcomesPanel } from "./OutcomesPanel";
import { ParticipantsIndicator } from "./RoomPresence";
import { VoiceOrb } from "./VoiceOrb";
import { PageHeader } from "./PageHeader";

const NAME_KEY = "maple-grove.staffName";
const DEFAULT_NAME = "Nurse Jordan";

function readStoredName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) || DEFAULT_NAME;
  } catch {
    return DEFAULT_NAME;
  }
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

interface ActiveTransfer {
  handoff: QueuedHandoff;
  session: LiveKitSession;
}

export function StaffConsole() {
  const [staffName, setStaffName] = useState(DEFAULT_NAME);
  const [active, setActive] = useState<ActiveTransfer | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setStaffName(readStoredName()), []);

  function updateName(v: string) {
    setStaffName(v);
    try {
      window.localStorage.setItem(NAME_KEY, v);
    } catch {
      // Storage unavailable (private mode); the name just won't persist.
    }
  }

  async function accept(h: QueuedHandoff) {
    setBusyId(h.id);
    setNotice(null);
    try {
      const res = await apiClient.acceptHandoff(h.id, staffName.trim() || DEFAULT_NAME);
      setActive({ handoff: { ...h, ...res.handoff }, session: res.session });
    } catch (err) {
      setNotice(err instanceof ApiError && err.status === 409 ? "Someone else already picked up that transfer." : err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function finish() {
    if (!active) return;
    const id = active.handoff.id;
    setActive(null);
    await apiClient.completeHandoff(id).catch(() => undefined);
  }

  if (active) {
    return <ActiveCall active={active} staffName={staffName} onEnd={finish} />;
  }

  return (
    <>
      <PageHeader
        eyebrow="For clinic staff"
        title="Staff console"
        lede={`When ${AGENT_NAME} needs a person, the call waits here. Accept it to join live; she introduces you, then leaves.`}
      />
      {notice && <div className="notice error pageNotice">{notice}</div>}
      <div className="staffGrid">
        <div className="dutyCard">
          <h2 className="cardTitle">On duty</h2>
          <label className="field">
            <span>Your name</span>
            <input value={staffName} onChange={(e) => updateName(e.target.value)} maxLength={60} autoComplete="off" />
            <span className="help">{AGENT_NAME} uses this name when she introduces you.</span>
          </label>
        </div>
        <Queue onAccept={accept} busyId={busyId} />
      </div>
    </>
  );
}

function Queue({ onAccept, busyId }: { onAccept: (h: QueuedHandoff) => void; busyId: string | null }) {
  const { handoffs, mode, error } = useHandoffQueue();
  const now = useNow();
  const waiting = (handoffs ?? []).filter((h) => h.status === "WAITING");
  const inProgress = (handoffs ?? []).filter((h) => h.status === "ACCEPTED");

  return (
    <div className="queue">
      <div className="queueMeta" role="status">
        <span className={`liveDot ${mode === "live" ? "" : mode === "polling" ? "pending" : "off"}`} aria-hidden="true" />
        {mode === "live" ? "Live queue" : mode === "polling" ? "Refreshing every few seconds" : "Connecting to the queue"}
        <span>{waiting.length} waiting</span>
      </div>
      {error && <div className="notice error">Can&rsquo;t load the queue: {error}</div>}
      {handoffs && waiting.length === 0 && inProgress.length === 0 && (
        <div className="queueEmpty grain drift palette-meadow">
          <h2 className="h3">No one is waiting</h2>
          <p className="small">
            Run the refill scenario on the live call page and ask for a lorazepam refill. The transfer lands here.
          </p>
        </div>
      )}
      {waiting.map((h) => (
        <article key={h.id} className="queueCard">
          <div className="queueMain">
            <span className="chip onSurface">{departmentLabel(h.department)}</span>
            <h2 className="h3">{callerName(h.patient)}</h2>
            {h.patient && <span className="small muted">Born {formatDate(h.patient.dateOfBirth)}</span>}
            <span className="small">{h.reason}</span>
            <p className="queueSummary muted">{h.summary}</p>
          </div>
          <div className="queueSide">
            <span className="queueWait">Waiting {formatElapsed(h.requestedAt, now)}</span>
            <button type="button" className="btn btn-primary" onClick={() => onAccept(h)} disabled={busyId !== null}>
              <Headset size={16} weight="regular" aria-hidden="true" />
              {busyId === h.id ? "Joining" : "Accept"}
            </button>
          </div>
        </article>
      ))}
      {inProgress.map((h) => (
        <article key={h.id} className="queueCard taken">
          <div className="queueMain">
            <span className="chip onSurface">{departmentLabel(h.department)}</span>
            <h2 className="h3">{callerName(h.patient)}</h2>
            <span className="small">{h.reason}</span>
          </div>
          <div className="queueSide">
            <span className="queueWait">With {h.staffName ?? "staff"}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function ActiveCall({ active, staffName, onEnd }: { active: ActiveTransfer; staffName: string; onEnd: () => void }) {
  const { handoff, session } = active;
  const { events } = useCallEventStream(handoff.callId);
  const derived = useMemo(() => deriveCallState(events), [events]);
  const patientId = derived.patientId ?? handoff.patient?.id ?? null;
  const [error, setError] = useState<string | null>(null);

  return (
    <LiveKitRoom
      serverUrl={session.url}
      token={session.token}
      audio={{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }}
      connect
      onDisconnected={onEnd}
      onError={(err) => setError(err.message)}
    >
      <RoomAudioRenderer />
      <div className="pageHead">
        <div className="callHeader">
          <div className="callHeaderInfo">
            <span className="eyebrow">Live transfer · {departmentLabel(handoff.department)}</span>
            <h1 className="h1">{callerName(handoff.patient)}</h1>
            <span className="muted small">You&rsquo;re on the line as {staffName}.</span>
          </div>
          <div className="stageActions">
            <AudioUnblocker />
            <button type="button" className="btn btn-danger" onClick={onEnd}>
              <PhoneDisconnect size={16} weight="regular" aria-hidden="true" />
              End call
            </button>
          </div>
        </div>
        <ParticipantsIndicator />
      </div>
      {error && <div className="notice error pageNotice">{error}</div>}
      {derived.ended && <div className="notice onPage pageNotice">The caller hung up. End the call when you&rsquo;ve finished your notes.</div>}
      <div className="staffCallCard">
        <div className="liveMain">
          <section className="inner">
            <div className="stage">
              <VoiceOrb state="staff" small />
              <p className="stageLabel">{handoff.reason}</p>
              <p className="summaryText">{handoff.summary}</p>
            </div>
          </section>
          <PatientPanel patientId={patientId} refreshKey={chartRevision(events)} />
        </div>
        <div className="liveSide">
          <TranscriptPanel events={events} title="Conversation so far" />
          <OutcomesPanel events={events} />
        </div>
      </div>
    </LiveKitRoom>
  );
}
