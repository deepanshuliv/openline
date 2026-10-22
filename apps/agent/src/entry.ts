import { fileURLToPath } from "node:url";
import { ServerOptions, cli, defineAgent, voice, type JobContext, type JobProcess, type VAD } from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import { AGENT_READY_ATTRIBUTE, CallEventType, CallPhase, createLogger } from "@repo/shared";
import { env } from "./env.js";
import { CallLogService } from "./core/CallLogService.js";
import { CallSession } from "./core/CallSession.js";
import { WarmTransfer } from "./core/WarmTransfer.js";
import { PhraseCache } from "./core/PhraseCache.js";
import { installToolFiller } from "./core/toolFiller.js";
import { waitForCallerReady } from "./core/callerReady.js";
import { createVoiceSession } from "./core/voiceSession.js";
import { checkProviderKeys, createTTS } from "./core/providers.js";
import { clinicVertical } from "./verticals/clinic/index.js";

const logger = createLogger("agent:entry");

const vertical = clinicVertical;
const GOODBYE_MAX_WAIT_MS = 15_000;
const GREETING_PREWARM_MAX_MS = 3_000;
// How long the agent waits, silent, for the caller to press OK before giving up.
const CALLER_READY_TIMEOUT_MS = 3 * 60_000;
const TIME_LIMIT_REASON = "time_limit";

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    void checkProviderKeys();
    const phrases = new PhraseCache(createTTS());
    // Only the greeting gates readiness, and only briefly: the job process must
    // finish prewarm within LiveKit's init timeout or the call is never
    // answered. A slow TTS just means the greeting plays via live TTS.
    const greeting = phrases.add([vertical.phrases.greeting]);
    const [vad] = await Promise.all([
      silero.VAD.load({ minSilenceDuration: env.VAD_MIN_SILENCE_MS }),
      Promise.race([greeting, new Promise((r) => setTimeout(r, GREETING_PREWARM_MAX_MS))]),
    ]);
    void phrases.add([...(vertical.phrases.goodbye ? [vertical.phrases.goodbye] : []), ...(vertical.phrases.timeUp ? [vertical.phrases.timeUp] : []), ...vertical.phrases.fillers, ...Object.values(vertical.phrases.toolBridges ?? {}), ...(vertical.phrases.other ?? [])]);
    proc.userData.vad = vad;
    proc.userData.phrases = phrases;
    logger.info("prewarm.ready");
  },

  entry: async (ctx: JobContext) => {
    await ctx.connect();
    const roomName = ctx.room.name ?? "unknown-room";
    const record = await new CallLogService().findOrCreateByRoomName(roomName);
    const call = new CallSession({ callId: record.id, roomName, agentLabel: vertical.agentLabel });
    logger.info("job.connected", { roomName, callId: call.callId, vertical: vertical.name });

    // Bind the pipeline to the caller so staff who join later aren't treated as input.
    const caller = await ctx.waitForParticipant();
    // The caller joins while the connect dialog is still open; nothing is said
    // or heard until they press OK.
    const callerReadyResult = waitForCallerReady(ctx.room, caller.identity, CALLER_READY_TIMEOUT_MS);
    const callerReady = new Promise<void>((resolve) => {
      void callerReadyResult.then((ready) => ready && resolve());
    });
    const session = createVoiceSession(call, ctx.proc.userData.vad as VAD, vertical.keyterms);
    const phrases = ctx.proc.userData.phrases as PhraseCache;
    installToolFiller(call, session, phrases, { fillers: vertical.phrases.fillers, toolBridges: vertical.phrases.toolBridges, skipTools: vertical.fillerSkipTools });
    const transfer = new WarmTransfer(call, {
      room: ctx.room,
      session,
      timeoutMs: env.TRANSFER_TIMEOUT_SEC * 1000,
      scripts: vertical.transferScripts,
    });

    let leaving = false;
    call.onEnded = (reason) => {
      if (leaving) return;
      leaving = true;
      // Stop listening: anything said after the call ends (a trailing "bye")
      // must not start another turn while the goodbye plays.
      session.input.setAudioEnabled(false);
      void (async () => {
        const deadline = Date.now() + GOODBYE_MAX_WAIT_MS;
        // The goodbye is fixed audio played by code, so a call never ends in silence.
        const closing = reason === "agent_ended" ? vertical.phrases.goodbye : reason === TIME_LIMIT_REASON ? vertical.phrases.timeUp : undefined;
        if (reason === TIME_LIMIT_REASON) {
          // Cut off whatever Suzi was saying; the time-up line replaces it.
          try {
            await session.interrupt({ force: true }).await;
          } catch {
            // Nothing was playing, or the session is already closing.
          }
        }
        if (closing) {
          try {
            await Promise.race([phrases.say(session, closing, { allowInterruptions: false }).waitForPlayout(), new Promise((r) => setTimeout(r, GOODBYE_MAX_WAIT_MS))]);
          } catch (err) {
            logger.warn("goodbye.failed", { message: String(err) });
          }
        }
        // Let anything still playing (e.g. a transfer introduction) finish.
        while (session.agentState === "speaking" && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        await session.close();
        // Leave the room without ending it: after a handoff, caller and staff stay connected.
        ctx.shutdown(reason);
      })();
    };

    session.on(voice.AgentSessionEventTypes.Close, () => {
      void call.endCall("session_closed");
    });
    ctx.addShutdownCallback(async () => {
      await call.endCall("job_shutdown");
    });

    await call.emit(CallEventType.CALL_STARTED, { roomName, vertical: vertical.name, models: { stt: `assemblyai/${env.ASSEMBLYAI_MODEL}`, llm: `deepseek/${env.DEEPSEEK_MODEL}`, tts: `rime/${env.RIME_MODEL}:${env.RIME_SPEAKER}` } });
    await session.start({
      agent: vertical.createAgent({ call, transfer, phrases, callerReady }),
      room: ctx.room,
      inputOptions: { participantIdentity: caller.identity },
    });
    session.input.setAudioEnabled(false);
    await ctx.room.localParticipant?.setAttributes({ [AGENT_READY_ATTRIBUTE]: "true" });
    await call.emit(CallEventType.AGENT_ENTERED);
    logger.info("session.started", { callId: call.callId, caller: caller.identity });

    const ready = await callerReadyResult;
    if (!ready) {
      logger.info("caller.not_ready", { callId: call.callId });
      await call.endCall("caller_not_ready", "Caller didn't connect.");
      return;
    }
    session.input.setAudioEnabled(true);
    if (env.MAX_CALL_SEC > 0) {
      const limit = setTimeout(() => void call.endCall(TIME_LIMIT_REASON, "This one-minute demo call has ended."), env.MAX_CALL_SEC * 1000);
      ctx.addShutdownCallback(async () => clearTimeout(limit));
    }
    call.transitionPhase(CallPhase.IDENTIFYING, "greeting delivered");
    logger.info("caller.ready", { callId: call.callId });
  },
});

// No agentName: LiveKit auto-dispatches this worker to every new room.
// In dev, keep one job process prewarmed (LiveKit's dev default is none) and give
// a cold one longer than the 10s default: under tsx, importing the agent alone
// takes ~8s, so calls were dropped before Suzi joined. Production keeps its defaults.
const isDev = process.argv.includes("dev");
cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    ...(isDev && { numIdleProcesses: 1, initializeProcessTimeout: 30_000 }),
  }),
);
