// Latency budget for one conversational turn: from the moment the caller stops
// speaking to the first agent audio frame.
export const LATENCY_TARGETS_MS = {
  e2e: 660,
  stt: 198,
  llm: 322,
  tts: 89,
} as const;

export interface TurnLatency {
  // Caller stopped speaking -> agent's first audio frame.
  e2eMs: number | null;
  // Caller stopped speaking -> final transcript available.
  sttMs: number | null;
  // End-of-turn decision delay (VAD/turn detector), measured from end of speech.
  endOfTurnMs: number | null;
  llmTtftMs: number | null;
  ttsTtfbMs: number | null;
}

// Reads a latency.turn event's metadata. Older events may lack metadata.e2eMs
// but carry it as the event's durationMs, hence the fallback.
export function toTurnLatency(metadata: unknown, fallbackE2eMs: number | null = null): TurnLatency {
  const m = (metadata ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    e2eMs: num(m.e2eMs) ?? fallbackE2eMs,
    sttMs: num(m.sttMs),
    endOfTurnMs: num(m.endOfTurnMs),
    llmTtftMs: num(m.llmTtftMs),
    ttsTtfbMs: num(m.ttsTtfbMs),
  };
}

export interface LatencyStats {
  count: number;
  p50: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
}

export function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx] ?? null;
}

export function latencyStats(values: Array<number | null | undefined>): LatencyStats {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  return {
    count: xs.length,
    p50: percentile(xs, 0.5),
    p90: percentile(xs, 0.9),
    min: xs[0] ?? null,
    max: xs[xs.length - 1] ?? null,
  };
}

export function summarizeTurns(turns: TurnLatency[]) {
  return {
    e2e: latencyStats(turns.map((t) => t.e2eMs)),
    stt: latencyStats(turns.map((t) => t.sttMs)),
    llm: latencyStats(turns.map((t) => t.llmTtftMs)),
    tts: latencyStats(turns.map((t) => t.ttsTtfbMs)),
  };
}
