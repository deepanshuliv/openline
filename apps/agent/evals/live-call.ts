// End-to-end call through the running stack: creates a session via the API,
// joins the LiveKit room as the caller, speaks scripted lines (macOS `say`),
// and reports what the agent heard, did and said, plus measured latency.
// Needs `bun run dev` (api + agent) running. Costs a few cents of STT/LLM/TTS.
//   bun run live-call
//   LIVE_STAFF=1 bun run live-call   # also accepts the transfer as staff and joins
//   LIVE_SCRIPT="line one|line two"  # custom caller lines
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALLER_READY_ATTRIBUTE } from "@repo/shared";
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource, type RemoteTrack } from "@livekit/rtc-node";

const API = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
const RATE = 16000;
const SCRIPT = (process.env.LIVE_SCRIPT ?? "Hi, I'd like to book my annual physical.|Maria Gonzalez, March 14th, 1985.|Thanks, that's all. Goodbye.").split("|");

interface CallEvent {
  type: string;
  timestamp: string;
  metadata: Record<string, unknown> | null;
}

function speech(text: string): Int16Array {
  const dir = mkdtempSync(join(tmpdir(), "call-"));
  execFileSync("say", ["-o", join(dir, "s.aiff"), text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", `LEI16@${RATE}`, "-c", "1", join(dir, "s.aiff"), join(dir, "s.wav")]);
  const buf = readFileSync(join(dir, "s.wav"));
  const at = buf.indexOf("data") + 8;
  const len = (buf.length - at) & ~1;
  return new Int16Array(buf.buffer.slice(buf.byteOffset + at, buf.byteOffset + at + len));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function events(callId: string): Promise<CallEvent[]> {
  const res = await fetch(`${API}/api/calls/${callId}/events`);
  return ((await res.json()) as { events: CallEvent[] }).events;
}

const session = (await (await fetch(`${API}/api/calls/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callerName: "Live test" }) })).json()) as {
  callId: string;
  token: string;
  url: string;
};
console.log(`call ${session.callId}`);

const STAFF = process.env.LIVE_STAFF === "1";
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

const room = new Room();
let agentIdentity = "";
room.on(RoomEvent.ParticipantConnected, (p) => console.log(`  [${at()}] joined: ${p.identity}`));
room.on(RoomEvent.ParticipantDisconnected, (p) => console.log(`  [${at()}] left: ${p.identity}`));
// Agent audio energy, to know when the agent is actually audible.
let agentAudioMs = 0;
let lastAgentAudio = 0;
room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant) => {
  if (track.kind !== TrackKind.KIND_AUDIO) return;
  if (participant.identity.startsWith("staff-")) return;
  agentIdentity = participant.identity;
  void (async () => {
    for await (const frame of new AudioStream(track, { sampleRate: RATE, numChannels: 1 })) {
      let peak = 0;
      for (const s of frame.data) peak = Math.max(peak, Math.abs(s));
      if (peak > 500) {
        agentAudioMs += (frame.samplesPerChannel / frame.sampleRate) * 1000;
        lastAgentAudio = Date.now();
      }
    }
  })();
});
await room.connect(session.url, session.token, { autoSubscribe: true, dynacast: false });
const source = new AudioSource(RATE, 1);
const track = LocalAudioTrack.createAudioTrack("mic", source);
const opts = new TrackPublishOptions();
opts.source = TrackSource.SOURCE_MICROPHONE;
await room.localParticipant!.publishTrack(track, opts);
// Same as pressing OK in the browser: the agent stays silent until this is set.
await room.localParticipant!.setAttributes({ [CALLER_READY_ATTRIBUTE]: "true" });

async function say(text: string) {
  const pcm = speech(text);
  for (let i = 0; i < pcm.length; i += RATE / 100) {
    const chunk = pcm.slice(i, i + RATE / 100);
    const frame = quiet();
    for (let j = 0; j < chunk.length; j++) frame[j] = chunk[j]!;
    await source.captureFrame(new AudioFrame(frame, RATE, 1, RATE / 100));
  }
}
// Room-tone level noise rather than digital zeros, like a real microphone.
function quiet(): Int16Array {
  const f = new Int16Array(RATE / 100);
  for (let i = 0; i < f.length; i++) f[i] = Math.round((Math.random() - 0.5) * 60);
  return f;
}
async function silence(ms: number) {
  for (let t = 0; t < ms; t += 10) await source.captureFrame(new AudioFrame(quiet(), RATE, 1, RATE / 100));
}

// Wait until the agent has spoken and gone quiet (or the timeout passes).
async function waitForAgent(timeoutMs: number) {
  const start = Date.now();
  const before = agentAudioMs;
  while (Date.now() - start < timeoutMs) {
    await silence(200);
    if (agentAudioMs > before && Date.now() - lastAgentAudio > 2000) return { heard: true, firstAudioMs: null };
  }
  return { heard: agentAudioMs > before };
}

// Staff side: accept the queued transfer through the API (as the staff console
// does), join the room, and measure whether the agent's briefing is audible.
let staffRoom: Room | null = null;
let staffHeardAgentMs = 0;
let handoffId: string | null = null;
async function acceptHandoffIfQueued(): Promise<void> {
  if (!STAFF || staffRoom) return;
  const { handoffs } = (await (await fetch(`${API}/api/handoffs`)).json()) as { handoffs: { id: string; callId: string; status: string; department: string }[] };
  const h = handoffs.find((x) => x.callId === session.callId && x.status === "WAITING");
  if (!h) return;
  handoffId = h.id;
  const res = await fetch(`${API}/api/handoffs/${h.id}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ staffName: "Jordan" }) });
  const accepted = (await res.json()) as { session: { token: string; url: string } };
  console.log(`  [${at()}] staff accepted handoff ${h.id} (${h.department}), joining`);
  staffRoom = new Room();
  staffRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant) => {
    if (track.kind !== TrackKind.KIND_AUDIO || participant.identity !== agentIdentity) return;
    void (async () => {
      for await (const frame of new AudioStream(track, { sampleRate: RATE, numChannels: 1 })) {
        let peak = 0;
        for (const v of frame.data) peak = Math.max(peak, Math.abs(v));
        if (peak > 500) staffHeardAgentMs += (frame.samplesPerChannel / frame.sampleRate) * 1000;
      }
    })();
  });
  await staffRoom.connect(accepted.session.url, accepted.session.token, { autoSubscribe: true, dynacast: false });
}

const greet = await waitForAgent(15_000);
console.log(`greeting audible: ${greet.heard}`);
for (const line of SCRIPT) {
  console.log(`caller: ${line}`);
  const spokenAt = Date.now();
  const beforeAudio = lastAgentAudio;
  await say(line);
  const endOfSpeech = Date.now();
  const r = await waitForAgent(25_000);
  const firstReply = lastAgentAudio > beforeAudio ? lastAgentAudio : null;
  await acceptHandoffIfQueued();
  console.log(`  agent audible: ${r.heard}${firstReply ? `` : ""} (turn took ${((Date.now() - spokenAt) / 1000).toFixed(1)}s, ${((Date.now() - endOfSpeech) / 1000).toFixed(1)}s after caller stopped)`);
}
if (staffRoom) {
  // The agent briefs staff, then leaves; caller and staff stay connected.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && room.remoteParticipants.has(agentIdentity)) await silence(250);
  console.log(`  agent still in room: ${room.remoteParticipants.has(agentIdentity)}; staff heard agent: ${(staffHeardAgentMs / 1000).toFixed(1)}s`);
  const callBefore = (await (await fetch(`${API}/api/calls/${session.callId}`)).json()) as { call: { status: string } };
  console.log(`  call status after agent left: ${callBefore.call.status}`);
  await fetch(`${API}/api/handoffs/${handoffId}/complete`, { method: "POST" });
  await staffRoom.disconnect();
}
await silence(3000);
await room.disconnect();
await sleep(3000);

// What the agent recorded.
const evs = await events(session.callId);
for (const e of evs) {
  const m = e.metadata ?? {};
  const detail =
    e.type === "user.transcript.final" ? `"${m.transcript}"` :
    e.type === "agent.speech" ? `"${m.text}"` :
    e.type.startsWith("tool.") ? `${m.tool} ${JSON.stringify(m.output ?? m.input ?? m.message ?? "").slice(0, 140)}` :
    e.type === "latency.turn" ? JSON.stringify(m) :
    e.type === "error" ? JSON.stringify(m).slice(0, 300) :
    e.type === "call.ended" ? JSON.stringify(m).slice(0, 200) : "";
  console.log(`  ${e.timestamp.slice(11, 23)} ${e.type} ${detail}`);
}
const call = (await (await fetch(`${API}/api/calls/${session.callId}`)).json()) as { call: { status: string; endedAt: string | null } };
console.log(`final status: ${call.call.status}, endedAt: ${call.call.endedAt}`);
if (handoffId) {
  const { handoffs } = (await (await fetch(`${API}/api/handoffs?status=WAITING,ACCEPTED,COMPLETED,TIMED_OUT,CANCELLED`)).json()) as { handoffs: { id: string; status: string }[] };
  console.log(`handoff status: ${handoffs.find((h) => h.id === handoffId)?.status}`);
}
process.exit(0);
