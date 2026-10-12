import { ReadableStream } from "node:stream/web";
import { tts as ttsBase, type voice } from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";
import { createLogger } from "@repo/shared";

const logger = createLogger("agent:phrases");

// Pre-synthesized audio for fixed phrases (greeting, fillers, hold messages).
// Synthesized once per worker process during prewarm, so playing one costs no
// TTS round-trip at call time.
export class PhraseCache {
  private readonly audio = new Map<string, AudioFrame[]>();

  constructor(private readonly tts: ttsBase.TTS) {
    // TTS errors surface as events; without a listener Node throws
    // ERR_UNHANDLED_ERROR. Failures are already handled per phrase in add().
    tts.on("error", () => {});
  }

  // Synthesize phrases one at a time to stay under the TTS provider's
  // concurrent-stream limit. Failures are logged; those phrases fall back to live TTS.
  async add(phrases: string[], perPhraseTimeoutMs = 8_000): Promise<void> {
    const started = Date.now();
    for (const text of new Set(phrases)) {
      if (this.audio.has(text)) continue;
      try {
        const frames = await Promise.race([
          synthesize(this.tts, text),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${perPhraseTimeoutMs} ms`)), perPhraseTimeoutMs)),
        ]);
        this.audio.set(text, frames);
      } catch (err) {
        logger.warn("phrase.synthesis_failed", { text, message: String(err) });
      }
    }
    logger.info("phrases.ready", { count: this.audio.size, ms: Date.now() - started });
  }

  has(text: string): boolean {
    return this.audio.has(text);
  }

  // Speak a phrase, from cache when available, otherwise through live TTS.
  say<U>(session: voice.AgentSession<U>, text: string, opts: { addToChatCtx?: boolean; allowInterruptions?: boolean } = {}) {
    const frames = this.audio.get(text);
    if (!frames) return session.say(text, opts);
    const audio = new ReadableStream<AudioFrame>({
      start(controller) {
        for (const frame of frames) controller.enqueue(frame);
        controller.close();
      },
    });
    return session.say(text, { ...opts, audio });
  }
}

async function synthesize(tts: ttsBase.TTS, text: string): Promise<AudioFrame[]> {
  const stream = tts.stream();
  stream.pushText(text);
  stream.flush();
  stream.endInput();
  const frames: AudioFrame[] = [];
  for await (const ev of stream) {
    if (ev === ttsBase.SynthesizeStream.END_OF_STREAM) continue;
    frames.push(ev.frame);
  }
  return frames;
}
