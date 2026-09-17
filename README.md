# Gideon-style Voice Intake Orchestrator

A browser-based voice intake prototype that connects a caller to a LiveKit voice agent, collects structured personal-injury intake fields, applies a small deterministic qualification rule set, and exposes live call events and persisted call history.

> Portfolio / experimental project. The seed data is synthetic. Do not enter real caller or legal information: transcripts and intake fields are persisted, and configured voice and model providers receive call data. This is not legal advice and its qualification rules are not legal criteria.

## Status

The repository contains a Bun/Turborepo monorepo with a Next.js web console, an Express API, a LiveKit Agents worker, and Prisma-backed persistence. It has no hosted deployment target, CI workflow, automated tests, or test script.

The current checkout has a runtime gap: [`PolicyService`](apps/agent/src/services/PolicyService.ts) tries to load `intake-policy.md`, `escalation-rules.md`, `appointment-rules.md`, and `communication-policy.md`, but those files are not present in `apps/agent/src/policy/`. Add the files or change the loader before expecting the worker to handle a live call.

## What is implemented

- A live call console at `/` with microphone access through LiveKit.
- Call history at `/calls` and persisted call detail pages at `/calls/:id`.
- Four agent roles: triage, intake, qualification, and scheduling.
- Structured intake extraction through OpenRouter, validated with the shared Zod schema and written incrementally to a matter.
- Deterministic qualification based on reported injury, incident type, incident date, and whether the caller already has an attorney.
- Deterministically generated follow-up slots and idempotent appointment creation. There is no calendar provider integration.
- A live transcript, intake panel, and event timeline. The browser receives the timeline through Server-Sent Events (SSE), backed by Redis pub/sub.
- Call, transcript, event, caller, matter, and appointment persistence in Postgres through Prisma.

Human escalation is only represented by the `request_human_handoff` path and a call-ending reason. No human queue, notification, or transfer service is wired into the repository.

## Architecture

```text
Browser (apps/web)
  │ POST /api/calls/session
  ▼
API (apps/api) ──────────────── Postgres
  │ LiveKit token + call row       ▲
  │                                │ read models
  ▼                                │
LiveKit Cloud ◄──── WebRTC ─── Browser
  │
  ▼
Agent worker (apps/agent)
  Silero VAD → Deepgram STT → OpenRouter LLM → Deepgram TTS
  │
  ├─ CallOrchestrator → triage / intake / qualification / scheduling
  ├─ ToolRegistry → caller, matter, appointment, and call-log services → Postgres
  └─ EventService → Postgres CallEvent + Redis stream/pub-sub
                                      │
                                      ▼
                             API SSE → Browser timeline
```

The API creates the `Call` row and mints a 15-minute LiveKit room token. The worker joins the room, owns the in-memory `CallState`, and constructs the active agent. The orchestrator validates phase transitions; agents can propose a handoff only through a tool. The worker records transcript turns and event rows, then publishes the same event payload to Redis. The API replays persisted events and forwards live per-call pub/sub messages over SSE.

## Prerequisites

- Bun `1.3.13` (declared by the workspace) and Node.js `>=18`.
- Docker for the local Postgres and Redis containers.
- A LiveKit Cloud project: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`.
- An OpenRouter API key: `OPENROUTER_API_KEY`.
- A Deepgram API key: `DEEPGRAM_API_KEY`.

The provider links are also recorded in [`.env.example`](.env.example): [LiveKit Cloud](https://cloud.livekit.io), [OpenRouter](https://openrouter.ai/keys), and [Deepgram](https://console.deepgram.com).

## Run locally

Create the shared root environment file, then start the local infrastructure:

```bash
cp .env.example .env
bun install

docker compose up -d postgres redis
bun run db:migrate
bun run db:seed
```

The seed creates a synthetic caller, a motor-vehicle matter, and a follow-up appointment. Start the workspace with:

```bash
bun run dev
```

This starts the workspace development scripts: the web console on `http://localhost:3000`, the docs app on `http://localhost:3001`, the API on `http://localhost:4000`, and the agent worker. Because of the missing policy files described in [Status](#status), the API and web app can start, but the agent path needs that repository gap resolved before a call can complete.

For an API smoke check:

```bash
curl http://localhost:4000/health
```

The response has the form:

```json
{ "status": "ok", "uptime": 0.123, "timestamp": "2026-01-01T00:00:00.000Z" }
```

Once the worker prerequisites are complete, open the web console, choose **Start Call**, allow microphone access, and use **Call History** to inspect the transcript, extracted fields, events, and appointment state.

### Full Docker stack

The Compose file also builds the `web`, `api`, and `agent` images:

```bash
docker compose up --build
```

The root `.env` file is still required. The web image receives its public API URL as a build argument; the LiveKit URL used by the browser is returned by the API session endpoint.

## Configuration

Use [`.env.example`](.env.example) as the starting point. The API and worker validate required values at startup.

| Variable                      | Used by             | Default / purpose                                                   |
| ----------------------------- | ------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                | API, worker, Prisma | Required. Local Compose value targets Postgres on `localhost:5432`. |
| `REDIS_URL`                   | API, worker         | Required. Local Compose value targets Redis on `localhost:6379`.    |
| `LIVEKIT_URL`                 | API, worker         | Required. LiveKit room URL.                                         |
| `LIVEKIT_API_KEY`             | API, worker         | Required. Used by the API to sign room tokens.                      |
| `LIVEKIT_API_SECRET`          | API, worker         | Required. Kept server-side for token signing.                       |
| `OPENROUTER_API_KEY`          | Worker              | Required. Used for realtime LLM calls and structured extraction.    |
| `OPENROUTER_MODEL`            | Worker              | Defaults to `openai/gpt-4o-mini` for the voice agent.               |
| `OPENROUTER_EXTRACTION_MODEL` | Worker              | Defaults to `openai/gpt-4o-mini` for extraction and summaries.      |
| `DEEPGRAM_API_KEY`            | Worker              | Required. Used for Nova-3 STT and Aura Asteria English TTS.         |
| `API_PORT`                    | API                 | Defaults to `4000`.                                                 |
| `CORS_ORIGIN`                 | API                 | Defaults to `http://localhost:3000`.                                |
| `NEXT_PUBLIC_API_URL`         | Web                 | Defaults to `http://localhost:4000`.                                |

`NEXT_PUBLIC_LIVEKIT_URL` is present in [`.env.example`](.env.example) and is passed to the web Docker build, but the current browser code uses the `url` returned by `POST /api/calls/session` instead.

## API

The Express API is mounted from [`apps/api/src/app.ts`](apps/api/src/app.ts).

| Method | Route                          | Purpose                                                                                 |
| ------ | ------------------------------ | --------------------------------------------------------------------------------------- |
| `GET`  | `/health`                      | Return API health, uptime, and timestamp.                                               |
| `POST` | `/api/calls/session`           | Create a call row and mint a LiveKit token. Accepts optional `{ "callerName": "..." }`. |
| `GET`  | `/api/calls`                   | List the most recent calls, up to 50.                                                   |
| `GET`  | `/api/calls/:id`               | Return a call with caller, matter, appointments, transcript turns, and events.          |
| `GET`  | `/api/calls/:id/events`        | Return persisted events for a call.                                                     |
| `GET`  | `/api/calls/:id/events/stream` | Replay persisted events, then stream `call-event` SSE messages.                         |
| `GET`  | `/api/matters/:id`             | Return a matter with its caller and appointments.                                       |

Example session request:

```bash
curl -s -X POST http://localhost:4000/api/calls/session \
  -H 'Content-Type: application/json' \
  -d '{"callerName":"Prospective Caller"}'
```

The response contains `callId`, `roomName`, `identity`, `token`, and the LiveKit `url`.

## How the call works

### Agent control flow

`CallOrchestrator` owns the phase machine in `packages/shared/src/phases.ts`:

```text
GREETING → TRIAGE → INTAKE → QUALIFICATION → SCHEDULING → CONFIRMATION → COMPLETED
```

The allowed transitions also include returning from qualification to intake, ending from earlier phases, and entering error recovery. The LLM proposes handoffs through tools; `CallOrchestrator` checks each transition before constructing the next agent.

After each final caller transcript, the worker sends a rolling excerpt of recent caller turns and already-known fields to OpenRouter. The result is validated against `intakeFieldsSchema`. Extraction runs in the background so the spoken reply is not held up; qualification waits for the pending extraction before evaluating the fields.

Qualification is code in `packages/shared/src/intake.ts`:

- `QUALIFIED` requires at least one injury, a supported incident type (`motor_vehicle_accident`, `slip_and_fall`, `workplace_injury`, or `dog_bite`), and a known incident date.
- `DISQUALIFIED` is returned when the caller is already represented by an attorney.
- Otherwise the result is `INSUFFICIENT`, with reasons for the missing criteria.

These rules describe the demo implementation. They do not assess the legal merits of a case.

### Persistence and events

Prisma models `Caller`, `Matter`, `Appointment`, `Call`, `TranscriptTurn`, and `CallEvent` in [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma). `EventService` writes a `CallEvent` row, appends the serialized event to the Redis `call-events` stream, and publishes it on the per-call `call-events:<callId>` channel. `EventStreamService` bridges that channel to the browser with SSE.

## Repository layout

```text
apps/
  web/       Next.js live call console, call history, and call detail views
  api/       Express session, read-model, health, and SSE endpoints
  agent/     LiveKit worker, orchestrator, agents, tools, policies, and services
  docs/      Separate Next.js app from the workspace scaffold
packages/
  db/        Prisma schema, migration, client, and synthetic seed
  shared/    Zod schemas, phases, events, tool contracts, logging, env loading
  ui/        Reusable React components used by the docs app
  eslint-config/ and typescript-config/ shared workspace configuration
docs/video/  Standalone HTML architecture and implementation explainers
```

## Development checks

The workspace scripts come from the root [`package.json`](package.json):

```bash
bun run check-types
bun run build
bun run db:studio
```

`bun run db:studio` opens Prisma Studio against the configured Postgres database.

There are no automated tests in this repository. A root `bun run lint` script exists, but on a clean install it currently stops in `apps/api`, `apps/agent`, and `packages/shared` because those packages invoke `eslint` without declaring an available `eslint` binary. The `web`, `docs`, and `ui` lint scripts do not show that error in the current checkout.

## License

No license file is included in this repository.
