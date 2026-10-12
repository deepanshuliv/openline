"use client";

import { AGENT_NAME, LATENCY_TARGETS_MS, summarizeTurns, type TurnLatency } from "@/lib/shared";
import { formatMs, latencyTone } from "@/lib/format";

const STAGES: { key: keyof TurnLatency; label: string; target: number | null; cls: string; hint: string }[] = [
  { key: "sttMs", label: "Speech to text", target: LATENCY_TARGETS_MS.stt, cls: "stt", hint: "End of speech to final transcript" },
  { key: "endOfTurnMs", label: "End of turn", target: null, cls: "eot", hint: "Turn detector decision delay" },
  { key: "llmTtftMs", label: "Model", target: LATENCY_TARGETS_MS.llm, cls: "llm", hint: "Time to first token" },
  { key: "ttsTtfbMs", label: "Voice", target: LATENCY_TARGETS_MS.tts, cls: "tts", hint: "Time to first audio" },
];

export function LatencyPanel({ turns }: { turns: TurnLatency[] }) {
  const last = turns[turns.length - 1] ?? null;
  const stats = summarizeTurns(turns);
  const target = LATENCY_TARGETS_MS.e2e;
  const tone = latencyTone(last?.e2eMs, target);

  return (
    <section className="inner">
      <div className="innerHead">
        Latency
        <span className="meta">target {target} ms</span>
      </div>

      <div className="latencyTop">
        <div>
          <div className={`latencyBig num tone-${tone}`}>
            {last?.e2eMs != null ? (
              <>
                {Math.round(last.e2eMs)}
                <small>ms</small>
              </>
            ) : (
              "-"
            )}
          </div>
          <div className="caption">last reply, end of speech to first audio</div>
        </div>
        <dl className="latencyStats">
          <dt>p50</dt>
          <dd className={`tone-${latencyTone(stats.e2e.p50, target)}`}>{formatMs(stats.e2e.p50)}</dd>
          <dt>p90</dt>
          <dd className={`tone-${latencyTone(stats.e2e.p90, target)}`}>{formatMs(stats.e2e.p90)}</dd>
          <dt>turns</dt>
          <dd>{turns.length}</dd>
        </dl>
      </div>

      {last ? <TurnBreakdown turn={last} /> : <p className="empty">The breakdown appears after {AGENT_NAME}&rsquo;s first reply.</p>}

      <div className="stageRows">
        {STAGES.map((s) => {
          const value = last ? (last[s.key] as number | null) : null;
          const scale = Math.max(s.target ?? 0, value ?? 0, 1) * 1.2;
          const stageTone = s.target ? latencyTone(value, s.target) : "none";
          return (
            <div key={s.key} className="stageRow" title={s.hint}>
              <span className="stageName">
                <span className={`mark ${s.cls}`} aria-hidden="true" />
                {s.label}
              </span>
              <span className="stageLine" aria-hidden="true">
                {value != null && <span className={`fill ${stageTone === "none" ? "" : stageTone}`} style={{ width: `${(value / scale) * 100}%` }} />}
                {s.target != null && <span className="goal" style={{ left: `${(s.target / scale) * 100}%` }} />}
              </span>
              <span className={`stageValue tone-${stageTone}`}>
                {formatMs(value)}
                {s.target != null && <span className="goalText"> / {s.target}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {turns.length > 1 && <Sparkline values={turns.map((t) => t.e2eMs)} target={target} />}
    </section>
  );
}

// One reply as consecutive segments; the dark tick marks the 660 ms budget.
function TurnBreakdown({ turn }: { turn: TurnLatency }) {
  const parts = [
    { cls: "eot", v: turn.endOfTurnMs ?? 0, label: "End of turn" },
    { cls: "llm", v: turn.llmTtftMs ?? 0, label: "Model" },
    { cls: "tts", v: turn.ttsTtfbMs ?? 0, label: "Voice" },
  ];
  const sum = parts.reduce((a, p) => a + p.v, 0);
  const total = Math.max(turn.e2eMs ?? sum, sum, 1);
  const scale = Math.max(total, LATENCY_TARGETS_MS.e2e) * 1.08;
  return (
    <>
      <div className="segLine" aria-hidden="true">
        {parts.map((p) =>
          p.v > 0 ? <span key={p.cls} className={`seg ${p.cls}`} style={{ width: `${(p.v / scale) * 100}%` }} title={`${p.label}: ${Math.round(p.v)} ms`} /> : null,
        )}
        <span className="segTarget" style={{ left: `${(LATENCY_TARGETS_MS.e2e / scale) * 100}%` }} />
      </div>
      <div className="segLegend">
        <span>0</span>
        <span>{LATENCY_TARGETS_MS.e2e} ms budget</span>
        <span>{Math.round(scale)} ms</span>
      </div>
    </>
  );
}

function Sparkline({ values, target }: { values: Array<number | null>; target: number }) {
  const pts = values.slice(-24);
  const w = 300;
  const h = 52;
  const max = Math.max(target * 1.4, ...pts.map((v) => v ?? 0));
  const x = (i: number) => (pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * (w - 8) + 4);
  const y = (v: number) => h - 4 - (v / max) * (h - 8);
  const line = pts
    .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  return (
    <div className="spark">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Reply time per turn">
        <line x1="0" x2={w} y1={y(target)} y2={y(target)} className="sparkTarget" />
        <polyline points={line} className="sparkLine" />
        {pts.map((v, i) => (v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="2.6" className={`sparkDot tone-${latencyTone(v, target)}`} />))}
      </svg>
      <span className="caption">Each reply this call. Dashed line is the {target} ms target.</span>
    </div>
  );
}
