import { fileURLToPath } from "node:url";
import { AgentSession, AgentSessionEventTypes, ServerOptions, cli, defineAgent, type JobContext } from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as openai from "@livekit/agents-plugin-openai";
import * as silero from "@livekit/agents-plugin-silero";
import { CallEventType, TurnState, createLogger } from "@repo/shared";
import { env } from "./env.js";
import { CallLogService } from "./services/CallLogService.js";
import { CallOrchestrator } from "./orchestrator/CallOrchestrator.js";

const logger = createLogger("agent:entry");


const GOODBYE_MAX_WAIT_MS = 15_000;

export default defineAgent({
  prewarm: async () => {

    await silero.VAD.load();
    logger.info("prewarm.vad_loaded");
  },

  entry: async (ctx: JobContext) => {
    await ctx.connect();
    const roomName = ctx.room.name ?? "unknown-room";
    logger.info("job.connected", { roomName });

    const call = await new CallLogService().findOrCreateByRoomName(roomName);
    const orchestrator = new CallOrchestrator({ callId: call.id, roomName });

    const vad = await silero.VAD.load();
    const stt = new deepgram.STT({ apiKey: env.DEEPGRAM_API_KEY, model: "nova-3" });
    const tts = new deepgram.TTS({ apiKey: env.DEEPGRAM_API_KEY, model: "aura-asteria-en" });
    const llm = new openai.LLM({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      model: env.OPENROUTER_MODEL,
    });

    const session = new AgentSession<CallOrchestrator>({
      vad,
      stt,
      tts,
      llm,
      userData: orchestrator,
      turnHandling: {




        interruption: { minWords: 2 },
      },
    });



    session.on(AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      void orchestrator.eventService.emit(ev.isFinal ? CallEventType.USER_TRANSCRIPT_FINAL : CallEventType.USER_TRANSCRIPT_PARTIAL, {
        agent: orchestrator.state.activeAgent,
        phase: orchestrator.state.currentPhase,
        metadata: { transcript: ev.transcript },
      });
    });

    session.on(AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const item = ev.item;
      if (item.type !== "message") return;
      const text = item.textContent ?? "";
      if (item.role === "user") {
        void orchestrator.recordUserTurn(text);
      } else if (item.role === "assistant") {
        void orchestrator.recordAgentTurn(text);
        void orchestrator.eventService.emit(CallEventType.AGENT_SPEECH, {
          agent: orchestrator.state.activeAgent,
          phase: orchestrator.state.currentPhase,
          metadata: { text },
        });
      }
    });

    session.on(AgentSessionEventTypes.AgentStateChanged, (ev) => {
      if (ev.newState === "thinking") {
        orchestrator.state.turnState = TurnState.THINKING;
        void orchestrator.eventService.emit(CallEventType.LLM_STARTED, { agent: orchestrator.state.activeAgent, phase: orchestrator.state.currentPhase });
      } else if (ev.newState === "speaking") {
        orchestrator.state.turnState = TurnState.SPEAKING;
        void orchestrator.eventService.emit(CallEventType.TTS_STARTED, { agent: orchestrator.state.activeAgent, phase: orchestrator.state.currentPhase });
      } else if (ev.newState === "listening") {
        orchestrator.state.turnState = TurnState.LISTENING;
      }
    });

    session.on(AgentSessionEventTypes.UserStateChanged, (ev) => {


      if (ev.newState === "speaking" && session.agentState === "speaking") {
        orchestrator.state.turnState = TurnState.INTERRUPTED;
        orchestrator.state.interruptionCount += 1;
        void orchestrator.eventService.emit(CallEventType.INTERRUPTION_DETECTED, {
          agent: orchestrator.state.activeAgent,
          phase: orchestrator.state.currentPhase,
          metadata: { interruptionCount: orchestrator.state.interruptionCount },
        });
      }
    });

    session.on(AgentSessionEventTypes.AgentFalseInterruption, (ev) => {
      void orchestrator.eventService.emit(CallEventType.SPEECH_CANCELLED, {
        agent: orchestrator.state.activeAgent,
        phase: orchestrator.state.currentPhase,
        metadata: { falseInterruption: true, resumed: ev.resumed },
      });
    });

    session.on(AgentSessionEventTypes.MetricsCollected, (ev) => {
      const m = ev.metrics;
      if (m.type === "llm_metrics") {
        void orchestrator.eventService.emit(CallEventType.LLM_COMPLETED, {
          agent: orchestrator.state.activeAgent,
          phase: orchestrator.state.currentPhase,
          durationMs: Math.round(m.durationMs),
          metadata: { ttftMs: m.ttftMs, promptTokens: m.promptTokens, completionTokens: m.completionTokens },
        });
      } else if (m.type === "tts_metrics") {
        void orchestrator.eventService.emit(CallEventType.FIRST_AUDIO, {
          agent: orchestrator.state.activeAgent,
          phase: orchestrator.state.currentPhase,
          durationMs: Math.round(m.ttfbMs),
          metadata: { charactersCount: m.charactersCount },
        });
      } else if (m.type === "eou_metrics") {
        void orchestrator.eventService.emit("latency.end_of_utterance", {
          agent: orchestrator.state.activeAgent,
          phase: orchestrator.state.currentPhase,
          durationMs: Math.round(m.endOfUtteranceDelayMs),
          metadata: { transcriptionDelayMs: m.transcriptionDelayMs },
        });
      }
    });

    session.on(AgentSessionEventTypes.Error, (ev) => {




      const wrapped = ev.error;
      const message = wrapped instanceof Error ? wrapped.message : wrapped.error.message;
      void orchestrator.eventService.emit(CallEventType.ERROR, {
        agent: orchestrator.state.activeAgent,
        phase: orchestrator.state.currentPhase,
        metadata: { message, source: wrapped.type, recoverable: wrapped.recoverable },
      });
    });



    let teardownStarted = false;

    orchestrator.onEnded = () => {
      if (teardownStarted) return;
      teardownStarted = true;
      void (async () => {


        const deadline = Date.now() + GOODBYE_MAX_WAIT_MS;
        while (session.agentState === "speaking" && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        await session.close();
      })();
    };

    session.on(AgentSessionEventTypes.Close, () => {


      teardownStarted = true;
      void orchestrator.endCall("session_closed");
    });

    ctx.addShutdownCallback(async () => {
      await orchestrator.endCall("job_shutdown");
    });

    await orchestrator.start();

    await session.start({
      agent: orchestrator.buildInitialAgent(),
      room: ctx.room,
    });

    logger.info("session.started", { callId: call.id, roomName });
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
