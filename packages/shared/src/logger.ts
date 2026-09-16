/**
 * Structured console logger shared by apps/api and apps/agent.
 *
 * This is the primary "watch the call happen" surface (per the demo
 * requirement) — every orchestration step prints a single, greppable,
 * timestamped line: `HH:mm:ss.SSS [scope] eventType  key=value key=value`.
 * It is intentionally plain (no external logging lib) so it reads well in a
 * raw terminal during a live demo.
 */

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

type Level = "debug" | "info" | "event" | "warn" | "error";

const LEVEL_COLOR: Record<Level, string> = {
  debug: COLORS.gray,
  info: COLORS.cyan,
  event: COLORS.green,
  warn: COLORS.yellow,
  error: COLORS.red,
};

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** Redacts likely-sensitive keys before printing (CLAUDE.md §26 — never log secrets). */
const SENSITIVE_KEYS = /key|secret|token|password|authorization/i;

function formatFields(fields?: Record<string, unknown>): string {
  if (!fields) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const safe = SENSITIVE_KEYS.test(k) ? "[redacted]" : v;
    const str = typeof safe === "string" ? safe : JSON.stringify(safe);
    parts.push(`${COLORS.dim}${k}=${COLORS.reset}${str}`);
  }
  return parts.length ? "  " + parts.join(" ") : "";
}

export class Logger {
  constructor(private readonly scope: string) {}

  private write(level: Level, message: string, fields?: Record<string, unknown>) {
    const color = LEVEL_COLOR[level];
    const line = `${COLORS.dim}${timestamp()}${COLORS.reset} ${color}[${this.scope}]${COLORS.reset} ${message}${formatFields(fields)}`;
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  debug(message: string, fields?: Record<string, unknown>) {
    this.write("debug", message, fields);
  }

  info(message: string, fields?: Record<string, unknown>) {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>) {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: Record<string, unknown>) {
    this.write("error", message, fields);
  }

  /** One line per CallEvent — the live "what is happening" feed. */
  event(eventType: string, fields?: Record<string, unknown>) {
    this.write("event", `${COLORS.bold}${eventType}${COLORS.reset}`, fields);
  }

  child(subScope: string): Logger {
    return new Logger(`${this.scope}:${subScope}`);
  }
}

export function createLogger(scope: string): Logger {
  return new Logger(scope);
}
