# Openline

*The clinic line that's always open.*

https://github.com/user-attachments/assets/c38ef3ed-dccd-437e-a835-bb86888af2e2

**Openline** is a browser-based voice AI receptionist platform. Its receptionist, **Suzi**, answers for a (fictional) family clinic, **Maple Grove Family Clinic**. One agent handles four kinds of calls: booking, rescheduling or cancelling appointments, insurance and eligibility questions, and prescription refills. When a refill needs a clinician, the agent does a **live warm transfer** to a human on the staff console.

The agent is built as a **vertical-agnostic core** plus a **clinic vertical**. The core owns the voice pipeline, call lifecycle, telemetry, latency tracking and warm transfer. The vertical supplies the persona, tools and business rules.

> Portfolio / experimental project. All patient data is synthetic. Do not enter real health information: transcripts are persisted and voice/model providers receive call audio and text. Nothing here is medical advice, and the insurance and refill rules are illustrative.

## Using the app

Everything a caller needs is on one route, `/`:

1. **Home.** The first screen is just the pitch, a **Call Suzi** button and three steps (press Call Suzi, allow your microphone, press OK when Suzi is ready). Scrolling down shows everything Suzi can do, the care team she books with (read live from the database via `GET /api/providers`), and the demo patients.
2. **Connecting to Suzi.** A popup walks through three steps: Microphone → Connect → Talk.
   - **Microphone first.** The browser asks for the microphone right away. Nothing else happens until the caller allows it: no call is created and Suzi can't join or speak. If it's blocked, missing or in use, the popup says how to fix it and offers **Try again**. If the caller unblocks it in browser settings, the popup carries on by itself where the browser supports that.
   - **Connect.** Only after the microphone is allowed does the app create the call and join it, with the microphone still off. Suzi joins too, starts her voice session, and then sets the `agent.ready` attribute. Until then the popup says *Connecting to Suzi*. If she isn't ready within 30 seconds, it says so and offers **Try again**.
   - **Talk.** Only then does it say *Suzi is ready*. Pressing **OK** turns the microphone on, sets the caller's `caller.ready` attribute and opens the call screen. Suzi says nothing and hears nothing until `caller.ready` arrives; then she greets. If the caller never presses OK, or leaves, she ends the call after 3 minutes without having said a word.
   - **Cancel** (or Esc) goes back home at any step. If the clinic can't be reached, the popup says so and offers **Try again**.
3. **On the call.** The conversation fills the screen, like a chat; until you speak it lists the demo patients you can call as. At the bottom sit Suzi's orb (listening, thinking or speaking) and the call bar: status, timer, **Full screen**, **Mute** and **End call**. There's no text box: this is a voice call. **Full screen** (or tapping the orb) shows only the large orb and the call buttons; **Show chat** (or tapping the orb again) brings the conversation back. **End call and go home** in the corner leaves in one click.
4. **After the call.** A short summary, **Call Suzi again** or **Back home**.

The call screen also handles the usual problems itself. If microphone access is lost during the call (permission revoked, or the microphone fails to start), the call ends with a *Microphone needed* screen and **Try again**, so Suzi never keeps talking to someone she can't hear. If Suzi hasn't joined after 15 seconds, the screen says so. A dropped connection shows *The call dropped* with the same two buttons. Browsers that block sound get an **Enable sound** button.

Staff use `/staff` to take warm transfers, and `/calls` lists past calls with their transcripts and latency.

## Look and feel

The web app is light, with an editorial serif for headlines and one brand palette that colours the hero ribbon and Suzi's orb. The ribbon (`components/Ribbon.tsx`, a WebGL shader) is a twisting band that breathes like a voice, with a satin groove texture, a pearlescent sheen and a soft shadow. Two palettes ship:

- **Lagoon** (default): deep teal, aqua and periwinkle on a cool mist. Calm and clinical without feeling cold.
- **Dusk**: plum, lilac and blush. Warmer and softer.

Preview with `?palette=dusk` or `?palette=lagoon` (the choice is remembered in the browser). The tokens are `--ribbon-*` and `--sky-*` at the top of `apps/web/app/globals.css`.

## Demo scenarios

Seeded by `bun run db:seed`. Each scenario has a demo patient; the call screen lists them until the caller first speaks.

| Scenario                               | Demo patient                       | What happens                                                                                                                                           |
| -------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Book an appointment                    | Maria Gonzalez, DOB March 14, 1985 | Verifies identity, offers open slots, books one.                                                                                                       |
| Reschedule / cancel                    | James Carter, DOB Nov 2, 1972      | Moves a follow-up with Dr. Lee and cancels an annual physical.                                                                                         |
| Check insurance / eligibility          | Priya Shah, DOB July 21, 1990      | Finds the active BCBS plan (the old Cigna plan is inactive); quotes copay, deductible and coverage.                                                    |
| Prescription refill + human escalation | Robert Chen, DOB May 9, 1958       | Lisinopril goes to the pharmacy; lorazepam is a controlled substance, so the agent queues a nurse transfer. Open `/staff` in another tab to accept it. |

## Architecture

```text
Browser caller (apps/web /)          Staff (apps/web /staff)
  │ POST /api/calls/session            │ GET /api/handoffs/stream (SSE)
  ▼                                    │ POST /api/handoffs/:id/accept → room token
API (apps/api) ── Postgres ◄───────────┤ POST /api/handoffs/:id/complete
  │   ▲   └── Redis pub/sub ──┐        ▼
  │   │ SSE /api/calls/:id/events/stream     LiveKit room (caller + agent + staff)
  ▼   │                       │         ▲
LiveKit Cloud ◄───────────────┼──── WebRTC ┘
  │                           │
  ▼                           │
Agent worker (apps/agent)     │
  core/      providers      AssemblyAI STT → DeepSeek LLM → Rime TTS, each with a
                            LiveKit Inference fallback; startup key check
             voiceSession   Silero VAD + LiveKit turn detector, endpointing, latency events
             PhraseCache    pre-synthesized greeting, fillers, tool bridges and goodbye
             toolFiller     plays a bridging line while a tool runs ("Let me check your coverage.")
             CallSession    phases, intents, transcript, end-of-call
             WarmTransfer   queue → hold → staff joins → spoken briefing → agent leaves
             EventService   → recordCallEvent (packages/db): Postgres + Redis publish
  verticals/clinic/
             instructions   system prompt, transfer scripts, greeting/goodbye phrases
             tools.ts       verify_patient, find/book/reschedule/cancel, list_my_appointments,
                            check_insurance, list_medications, request_refill,
                            transfer_to_staff, end_call
             services/      scheduling (no double-booking), patients, coverage, prescriptions
packages/shared   eligibility + refill rules, clinic time helpers, event types, latency stats
packages/db       Prisma schema/client, seed, recordCallEvent (shared by agent and API)
```

### Voice pipeline

- **Providers.** AssemblyAI (`universal-streaming-english`) transcribes, DeepSeek (`deepseek-chat`, through the OpenAI-compatible plugin) reasons, Rime (`mistv3`, measured ~365 ms to first audio) speaks. All are set in `.env`.
- **Fallbacks.** Unless `PROVIDER_FALLBACK=off`, each provider is wrapped in a LiveKit fallback adapter that switches to LiveKit Inference (Deepgram, GPT-4.1-mini, Cartesia; billed to the LiveKit project) when the primary errors or times out, so a bad key or outage degrades the call instead of dropping it. Child-provider errors are kept from the session, which would otherwise close after three. At startup the worker checks the DeepSeek and AssemblyAI keys and logs `provider.key_invalid` for a bad one.
- **Turn-taking.** Silero VAD plus LiveKit's turn detector decide when the caller is done, within `ENDPOINTING_MIN_DELAY_MS` (600, enough for AssemblyAI's final transcript) and `ENDPOINTING_MAX_DELAY_MS` (1200). Preemptive generation starts the reply from the interim transcript. Under two words spoken over the agent (`interruption.minWords: 2`) don't interrupt it, so backchannels like "mm-hm" are ignored.
- **Fixed phrases.** The greeting (which tells the caller what Suzi can do), the lookup bridges, fillers and goodbye are synthesized once per worker process and played by code. On the first lookup of each caller turn the agent plays a line that fits the tool (`TOOL_BRIDGES` in `verticals/clinic/instructions.ts`: "Let me look at the schedule for you.", "Let me check your coverage." and so on), or a generic filler, so a lookup never sounds like dead air. Prewarm waits at most 3 s for the greeting (a slow TTS must not miss LiveKit's process-init timeout); anything not ready plays through live TTS. `end_call` plays the goodbye itself, so a call never ends in silence, and the agent stops listening once the call ends so a trailing "bye" can't start another turn.

### Calls, events and transfers

- **Call lifecycle.** `POST /api/calls/session` creates the `Call` (ACTIVE) and a caller token; LiveKit auto-dispatches the agent. The agent moves the call through `GREETING → IDENTIFYING → SERVING → (TRANSFERRING) → COMPLETED | HANDED_OFF`. The API closes what the agent can't: staff completing a handoff, and a sweeper (every minute) that marks never-joined calls COMPLETED after 10 min and silent calls ERROR after 15 min.
- **Events.** Every call event goes through `recordCallEvent` in `packages/db`: a `CallEvent` row in Postgres, then a publish on Redis channel `call-events:<callId>`. The API replays stored events and then relays the channel over SSE, so the console works for live and finished calls. Transfer requests also publish on `handoff-events` for the staff queue.
- **Warm transfer.** `transfer_to_staff` creates a `Handoff` and publishes it to the staff queue. Accepting is a conditional update, so only one staff member can win. When a `staff-*` participant joins, the agent briefs them on the open line with the caller's verified name (or none if unverified) and the summary, then leaves without closing the room. The pipeline only listens to the caller, so staff speech never reaches the agent. If nobody accepts within `TRANSFER_TIMEOUT_SEC`, the agent takes the caller back and leaves a callback request; an accepted-but-not-joined transfer gets 30 s grace. A caller hanging up while queued cancels the handoff.

### Design choices

- **The LLM never makes business decisions.** Eligibility (`evaluateEligibility`) and refill outcomes (`evaluateRefill`) are plain functions in `packages/shared`. The model collects facts and calls tools.
- **The model can't invent times or IDs.** Slot and appointment tools return short handles (`S1`, `A1`, or just `1`) that map to real rows for the duration of the call. Refills match on the exact drug name.
- **Identity before data.** Every patient tool refuses until `verify_patient` matches date of birth and last name (ignoring case, spaces and punctuation), with nickname prefixes of at least two letters. Three failed attempts lock verification for the call.
- **No double-booking.** Bookings run in a transaction that checks both the provider's and the patient's calendar, backed by a partial unique index on `(providerId, startsAt) WHERE status = 'SCHEDULED'`. A visit can only be rescheduled into a slot found for its own visit type, so its length never changes.
- **Clinic-local time.** Date searches are interpreted in the clinic's timezone and walk local calendar days, so single-day searches, weekends and DST changes behave.
- **Shared types, not runtime schemas, cross into the browser.** `CallEventPayload` is a plain interface; the web app imports `packages/shared` sources through `apps/web/lib/shared.ts`.

### Testing

- `bun run test` runs four suites: shared rules (unit), agent tools, scheduling and warm transfer (integration, real Postgres and Redis, isolated per test), API handoff race and stale-call sweeper (integration), and the web console's event folding (unit). No model calls.
- `apps/agent`: `bun run evals` grades the real prompt and tools against DeepSeek deterministically; `bun run smoke` checks Rime and AssemblyAI; `bun run live-call` places a scripted voice call through LiveKit, optionally with a staff bot that accepts the transfer.

## Latency

Each agent reply emits a `latency.turn` event with this breakdown, all measured by the LiveKit Agents SDK:

- **e2e:** caller stops speaking → first agent audio
- **stt:** transcription delay
- **endOfTurn:** end-of-turn decision delay
- **llmTtft:** LLM time to first token
- **ttsTtfb:** TTS time to first audio

The caller screen doesn't show latency. Each call's page under `/calls` shows the per-turn breakdown, the summary at the top of `/calls` shows the median over recent calls, and `GET /api/metrics/latency` returns the raw numbers.

Last snapshot (2026-10-08, from `/api/metrics/latency` over the 20 most recent calls):

| Metric                                    | Value    |
| ----------------------------------------- | -------- |
| Median reply time (end of speech → audio) | 2,641 ms |
| Turns measured                            | 64       |
| Target                                    | 660 ms   |

Each per-call view shows the last reply's end-to-end time against the 660 ms budget, p50/p90 for the call, and the split into speech to text (target 198 ms), end of turn, model time to first token (target 322 ms) and voice time to first audio (target 89 ms), plus a sparkline of every reply.

These measurements predate the switch to AssemblyAI, DeepSeek and Rime (they used LiveKit Inference for all three stages); re-measure with `GET /api/metrics/latency` after a few calls. Spot checks from scripted calls on the new stack: end-of-turn 0.5–0.8 s, STT 0.5–0.8 s, LLM TTFT 0.4–0.8 s (GPT-4.1-mini fallback; the DeepSeek key was invalid at the time), Rime TTFB ~0.2–0.6 s after the first sentence of a call.

| Stage      | Target | Measured (p50, 20 turns, worker on a laptop in India, LiveKit Cloud India South) |
| ---------- | ------ | -------------------------------------------------------------------------------- |
| End-to-end | 660 ms | ~2,170 ms (~1,400 ms on turns with no tool call)                                 |
| STT        | 198 ms | ~250 ms                                                                          |
| LLM TTFT   | 322 ms | ~780 ms                                                                          |
| TTS TTFB   | 89 ms  | ~200 ms                                                                          |

Tuning already applied:

- Cloud turn detector with a 250 ms VAD silence window (Silero's default is 550 ms).
- End-of-turn wait between 0.6 s (so AssemblyAI's final transcript lands first) and 1.2 s.
- Rime `mistv3` instead of `arcana` (~365 ms vs 0.5–2.8 s to first audio, measured from India).
- Preemptive generation.
- A fixed greeting that skips the LLM.
- `verify_patient` returns the patient's appointments and medications, which saves a tool round trip.
- Pre-synthesized greeting, fillers and goodbye.

What still blocks the 660 ms target:

- **Region.** The models are served from the US. Every LLM and TTS request crosses India↔US, and the gateway's LLM TTFT floor measured from here was ~600 ms for every model tried. Deploy the worker in the same region as the inference providers.
- **Tool turns.** Turns that call a tool pay for a second LLM pass.
- **LLM speed.** A 322 ms TTFT generally needs a low-latency inference provider.
- **Fallback cost.** While a primary provider is failing, each turn first spends time on the failed attempt before the fallback answers.

## Run locally

```bash
cp .env.example .env          # add LiveKit URL/key/secret and the AssemblyAI, DeepSeek and Rime keys
bun install
docker compose up -d postgres redis
bun run db:migrate            # or: cd packages/db && bunx dotenv -e ../../.env -- prisma migrate deploy
bun run db:seed
bun run dev                   # web :3000, api :4000, agent worker
```

Open `http://localhost:3000`, click **Call Suzi**, allow the microphone, and press **OK** when Suzi is ready. For the refill scenario, open `http://localhost:3000/staff` in another tab and accept the transfer.

If ports 5432/6379/3000 are taken, set `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT` (and update `DATABASE_URL`/`REDIS_URL`), and run the web app on another port with a matching `CORS_ORIGIN`.

## API

| Method | Route                          | Purpose                                                           |
| ------ | ------------------------------ | ----------------------------------------------------------------- |
| `GET`  | `/health`                      | Health check.                                                     |
| `POST` | `/api/calls/session`           | Create a call and mint a caller LiveKit token.                    |
| `GET`  | `/api/calls`                   | Recent calls, with patient, intents, and p50 latency.             |
| `GET`  | `/api/calls/:id`               | Call detail: transcript, events, handoffs, appointments, refills. |
| `GET`  | `/api/calls/:id/events`        | All stored events for a call (JSON).                              |
| `GET`  | `/api/calls/:id/events/stream` | SSE: replay + live call events.                                   |
| `GET`  | `/api/providers`               | The care team (name, specialty, working days) for the landing page. |
| `GET`  | `/api/patients/:id`            | Patient chart: upcoming appointments, insurance, prescriptions.   |
| `GET`  | `/api/handoffs`                | Active transfer queue (`?status=WAITING,ACCEPTED`).               |
| `GET`  | `/api/handoffs/stream`         | SSE: queue snapshots for the staff console.                       |
| `POST` | `/api/handoffs/:id/accept`     | Claim a transfer (409 if taken); returns a staff room token.      |
| `POST` | `/api/handoffs/:id/complete`   | Staff ends the call.                                              |
| `GET`  | `/api/metrics/latency`         | Latency summary over recent calls.                                |

## Adding another vertical

Implement `Vertical` (`apps/agent/src/core/Vertical.ts`):

- a name and an agent label
- `keyterms` that bias speech-to-text toward your domain vocabulary
- `phrases`: the greeting, fillers and optional goodbye, pre-synthesized at worker start
- `fillerSkipTools`: tools that speak for themselves and shouldn't trigger a filler
- `createAgent({ call, transfer, phrases })`, which returns a LiveKit `Agent` with your instructions and tools; wrap tools with `instrumentedTool` so they show up in the timeline
- the two transfer scripts (`introduction` receives the verified caller's name, or null)

Then point `entry.ts` at it. Domain events go through `call.emit(...)`.

## Development checks

```bash
bun run test                  # shared rules, agent tools + warm transfer, API handoffs + sweeper, web state (no model calls)
bunx turbo run check-types    # all packages
bun run lint                  # all packages
cd apps/agent && bun run smoke   # live: Rime TTS + AssemblyAI STT, fraction of a cent
cd apps/agent && bun run evals   # live: 22 DeepSeek behavior evals, ~$0.01 per run
cd apps/agent && bun run live-call # live: scripted voice call through LiveKit (needs api + agent running)
```

In `apps/agent`, `TEST_NOW=2026-10-30T20:50:00Z bun run test` runs the tests at a fixed clock (weekends, closing time, DST). `bun run evals <filter>` runs only matching scenarios; `EVAL_BUDGET_USD` caps spend (default $0.05). Evals use the real instructions and tools against the local DB and grade deterministically (tool calls, arguments, spoken text).

The agent and API tests run against the local Postgres and Redis from `.env`, so start them and seed first. They create and clean up their own rows.

## License

No license file is included in this repository.
