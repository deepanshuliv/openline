import { inference, voice, type VAD } from "@livekit/agents";
import { CallEventType, TurnState, createLogger, type TurnLatency } from "@repo/shared";
import { env } from "../env.js";
import { createLLM, createSTT, createTTS } from "./providers.js";
import type { CallSession } from "./CallSession.js";

const logger = createLogger("agent:session");

const toMs = (seconds: number | undefined): number | null => (seconds === undefined || !Number.isFinite(seconds) ? null : Math.round(seconds * 1000));

// Builds the realtime voice pipeline: AssemblyAI STT -> DeepSeek LLM -> Rime TTS,
// each with a LiveKit Inference fallback (see providers.ts).
export function createVoiceSession(call: CallSession, vad: VAD, keyterms: string[] = []): voice.AgentSession<CallSession> {
  const session = new voice.AgentSession<CallSession>({
    vad,
    stt: createSTT(vad),
    llm: createLLM(),
    tts: createTTS(),
    userData: call,
    keytermsOptions: { keyterms },
    turnHandling: {
      // The streaming turn detector judges "is the caller done?" from audio +
      // words, which allows a much shorter silence window than VAD alone.
      turnDetection: env.TURN_DETECTOR === "on" ? new inference.TurnDetector() : "vad",
      endpointing: { mode: env.ENDPOINTING_MODE, minDelay: env.ENDPOINTING_MIN_DELAY_MS, maxDelay: env.ENDPOINTING_MAX_DELAY_MS },
      preemptiveGeneration: { enabled: env.PREEMPTIVE_GENERATION === "on" },
      interruption: { minWords: 2 },
    },
  });

  wireCallEvents(session, call);
  return session;
}

function wireCallEvents(session: voice.AgentSession<CallSession>, call: CallSession): void {
  // User-side latency (STT, end-of-turn) is reported on the caller's message;
  // agent-side (LLM, TTS, end-to-end) on the reply. Pair them per turn.
  let lastUserMetrics: { sttMs: number | null; endOfTurnMs: number | null } | null = null;

  session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
    if (!ev.isFinal) return;
    void call.emit(CallEventType.USER_TRANSCRIPT_FINAL, { transcript: ev.transcript });
  });

  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
    const item = ev.item;
    if (item.type !== "message") return;
    const text = item.textContent ?? "";

    if (item.role === "user") {
      call.recordTurn("CALLER", text);
      lastUserMetrics = { sttMs: toMs(item.metrics.transcriptionDelay), endOfTurnMs: toMs(item.metrics.endOfTurnDelay) };
      return;
    }
    if (item.role !== "assistant") return;

    call.recordTurn("AGENT", text);
    void call.emit(CallEventType.AGENT_SPEECH, { text, interrupted: item.interrupted });

    const e2eMs = toMs(item.metrics.e2eLatency);
    // Only replies to caller speech have an end-to-end latency (not greetings).
    if (e2eMs === null || !lastUserMetrics) return;
    const turn: TurnLatency = {
      e2eMs,
      sttMs: lastUserMetrics.sttMs,
      endOfTurnMs: lastUserMetrics.endOfTurnMs,
      llmTtftMs: toMs(item.metrics.llmNodeTtft),
      ttsTtfbMs: toMs(item.metrics.ttsNodeTtfb),
    };
    lastUserMetrics = null;
    void call.emit(CallEventType.LATENCY_TURN, turn as unknown as Record<string, unknown>, { durationMs: e2eMs });
  });

  session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
    if (ev.newState === "thinking") {
      call.turnState = TurnState.THINKING;
      void call.emit(CallEventType.LLM_STARTED);
    } else if (ev.newState === "speaking") {
      call.turnState = TurnState.SPEAKING;
      void call.emit(CallEventType.TTS_STARTED);
    } else if (ev.newState === "listening") {
      call.turnState = TurnState.LISTENING;
    }
  });

  session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
    if (ev.newState === "speaking" && session.agentState === "speaking") {
      call.turnState = TurnState.INTERRUPTED;
      call.interruptionCount += 1;
      void call.emit(CallEventType.INTERRUPTION_DETECTED, { interruptionCount: call.interruptionCount });
    }
  });

  session.on(voice.AgentSessionEventTypes.AgentFalseInterruption, (ev) => {
    void call.emit(CallEventType.SPEECH_CANCELLED, { falseInterruption: true, resumed: ev.resumed });
  });

  session.on(voice.AgentSessionEventTypes.Error, (ev) => {
    const wrapped = ev.error;
    const message = wrapped instanceof Error ? wrapped.message : wrapped.error.message;
    logger.error("session.error", { message, source: wrapped.type, recoverable: wrapped.recoverable });
    void call.emit(CallEventType.ERROR, { message, source: wrapped.type, recoverable: wrapped.recoverable });
  });
}
