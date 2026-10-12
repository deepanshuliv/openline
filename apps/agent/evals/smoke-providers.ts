// One tiny live check per voice provider. Costs a fraction of a cent.
//   bun run smoke
// TTS: Rime speaks a sentence. STT: AssemblyAI transcribes that audio, or a
// clip from macOS `say` when Rime is unavailable, so each provider is
// checked independently.
import { initializeLogger, stt as sttBase, tts as ttsBase } from "@livekit/agents";
import { AudioFrame, AudioResampler } from "@livekit/rtc-node";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSTT, createTTS } from "../src/core/providers.ts";

initializeLogger({ pretty: true, level: "warn" });

const SENTENCE = "I'd like to book a follow up with Doctor Patel on Tuesday.";

async function synthesize(): Promise<AudioFrame[]> {
  const tts = createTTS();
  let error: unknown = null;
  tts.on("error", (e) => (error = e.error));
  const started = Date.now();
  const frames: AudioFrame[] = [];
  let firstByteMs: number | null = null;
  for await (const ev of tts.synthesize(SENTENCE)) {
    if ((ev as unknown) === ttsBase.SynthesizeStream.END_OF_STREAM) continue;
    firstByteMs ??= Date.now() - started;
    frames.push(ev.frame);
  }
  const seconds = frames.reduce((s, f) => s + f.samplesPerChannel / f.sampleRate, 0);
  console.log(`rime: ${frames.length} frames, ${seconds.toFixed(2)}s audio @ ${frames[0]?.sampleRate} Hz, first byte ${firstByteMs} ms`);
  if (error) throw error;
  if (seconds < 1) throw new Error("Rime returned too little audio");
  return frames;
}

// 16 kHz mono PCM from macOS text-to-speech, split into 100 ms frames.
function localSpeech(): AudioFrame[] {
  const dir = mkdtempSync(join(tmpdir(), "smoke-"));
  const aiff = join(dir, "s.aiff");
  const wav = join(dir, "s.wav");
  execFileSync("say", ["-o", aiff, SENTENCE]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
  const buf = readFileSync(wav);
  const dataAt = buf.indexOf("data") + 8;
  const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + dataAt, buf.byteOffset + buf.length - ((buf.length - dataAt) % 2)));
  const frames: AudioFrame[] = [];
  for (let i = 0; i < pcm.length; i += 1600) {
    const chunk = pcm.slice(i, i + 1600);
    frames.push(new AudioFrame(chunk, 16000, 1, chunk.length));
  }
  return frames;
}

async function transcribe(input: AudioFrame[]): Promise<string> {
  let frames = input;
  // The STT stream expects 16 kHz; Rime returns 24 kHz.
  if (frames[0] && frames[0].sampleRate !== 16000) {
    const resampler = new AudioResampler(frames[0].sampleRate, 16000, 1);
    frames = [...frames.flatMap((f) => resampler.push(f)), ...resampler.flush()];
  }
  const stt = createSTT();
  stt.on("error", (e) => console.error("assemblyai error:", e.error instanceof Error ? e.error.message : e.error));
  const stream = stt.stream();
  const rate = frames[0]!.sampleRate;
  const finals: string[] = [];
  const reader = (async () => {
    for await (const ev of stream) {
      if (process.env.SMOKE_DEBUG) console.log("stt event", ev.type, ev.alternatives?.[0]?.text ?? "");
      if (ev.type === sttBase.SpeechEventType.FINAL_TRANSCRIPT && ev.alternatives?.[0]?.text) finals.push(ev.alternatives[0].text);
    }
  })();
  // Stream at real-time pace, as a live call does; the plugin only connects
  // while input is open.
  const silence = new AudioFrame(new Int16Array(rate / 10), rate, 1, rate / 10);
  for (const f of [...frames, ...Array<AudioFrame>(20).fill(silence)]) {
    stream.pushFrame(f);
    await new Promise((r) => setTimeout(r, (f.samplesPerChannel / f.sampleRate) * 1000));
  }
  const deadline = Date.now() + 8_000;
  while (finals.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  stream.endInput();
  stream.close();
  void reader;
  return finals.join(" ").trim();
}

let failed = false;
let frames: AudioFrame[];
try {
  frames = await synthesize();
  console.log("rime: PASS");
} catch (err) {
  failed = true;
  console.error(`rime: FAIL (${err instanceof Error ? err.message : String(err)})`);
  frames = localSpeech();
}

const text = await transcribe(frames);
console.log(`assemblyai: "${text}"`);
const words = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
const expected = new Set(words(SENTENCE));
const overlap = words(text).filter((w) => expected.has(w)).length / expected.size;
console.log(`assemblyai: ${overlap >= 0.6 ? "PASS" : "FAIL"} (word overlap ${(overlap * 100).toFixed(0)}%)`);
process.exit(failed || overlap < 0.6 ? 1 : 0);
