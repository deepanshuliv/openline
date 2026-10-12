// Isolated test data for the clinic tools: patients tagged with a unique last-name
// suffix so tests never touch (or depend on) the demo seed, plus a real
// CallSession and a fake warm transfer.
import { prisma } from "@repo/db";
import { CallLogService } from "../src/core/CallLogService.ts";
import { CallSession } from "../src/core/CallSession.ts";
import type { TransferRequest, WarmTransfer } from "../src/core/WarmTransfer.ts";
import { createClinicTools } from "../src/verticals/clinic/tools.ts";

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

export interface Fixture {
  tag: string;
  // Last names are `${base}${tag}` so they are unique per run.
  lastName: (base: string) => string;
  patients: Record<"maria" | "robert" | "priya" | "noplan" | "blocker", { id: string; firstName: string; lastName: string; dob: string }>;
  // A new patient with no appointments, for tests that must not share state.
  freshPatient: (firstName: string) => Promise<{ id: string; firstName: string; lastName: string; dob: string }>;
  cleanup: () => Promise<void>;
}

// "tagged" (tests): last names carry a unique suffix, so runs can't collide.
// "natural" (LLM evals): speakable names, with birth dates that differ from the
// demo seed; leftovers from an interrupted eval run are removed first.
export async function createFixture(naming: "tagged" | "natural" = "tagged"): Promise<Fixture> {
  const natural = naming === "natural";
  const tag = `${natural ? "eval" : "zz"}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const lastName = (base: string) => (natural ? base : `${base}${tag}`);
  if (natural) await removePatients((await prisma.patient.findMany({ where: { phone: { startsWith: "eval" } }, select: { id: true } })).map((p) => p.id), "eval");
  const plan = {
    memberId: "W123456789",
    effectiveFrom: daysAgo(300),
    primaryCopayCents: 2500,
    specialistCopayCents: 5000,
    deductibleCents: 150000,
    deductibleMetCents: 40000,
    coinsurancePct: 20,
  };

  const mk = async (firstName: string, base: string, dob: string, extra: Record<string, unknown>) => {
    const p = await prisma.patient.create({
      data: { firstName, lastName: lastName(base), dateOfBirth: new Date(dob), phone: `${tag}-${firstName}`, preferredPharmacy: "CVS on Main St", ...extra },
    });
    return { id: p.id, firstName, lastName: p.lastName, dob };
  };

  const maria = await mk("Maria", "Gonzalez", natural ? "1979-03-14" : "1985-03-14", {
    lastVisitAt: daysAgo(200),
    primaryProviderId: "prov_patel",
    insurancePlans: { create: [{ ...plan, payer: "Aetna", planName: "Choice POS II" }] },
  });
  const robert = await mk("Robert", "Chen", natural ? "1951-05-09" : "1958-05-09", {
    lastVisitAt: daysAgo(120),
    primaryProviderId: "prov_lee",
    insurancePlans: { create: [{ ...plan, payer: "Medicare", planName: "Part B", primaryCopayCents: 0 }] },
    prescriptions: {
      create: [
        { prescriberId: "prov_lee", drugName: "Lisinopril", strength: "10 mg", directions: "1 daily", refillsRemaining: 3, daysSupply: 30, lastFilledAt: daysAgo(27) },
        { prescriberId: "prov_lee", drugName: "Atorvastatin", strength: "20 mg", directions: "1 nightly", refillsRemaining: 0, daysSupply: 90, lastFilledAt: daysAgo(84) },
        { prescriberId: "prov_lee", drugName: "Lorazepam", strength: "0.5 mg", directions: "as needed", controlled: true, refillsRemaining: 1, daysSupply: 30, lastFilledAt: daysAgo(25) },
        { prescriberId: "prov_lee", drugName: "Metformin", strength: "500 mg", directions: "twice daily", refillsRemaining: 2, daysSupply: 30, lastFilledAt: daysAgo(5) },
      ],
    },
  });
  const priya = await mk("Priya", "Shah", natural ? "1993-07-21" : "1990-07-21", {
    lastVisitAt: daysAgo(400),
    insurancePlans: {
      create: [
        { ...plan, payer: "Blue Cross Blue Shield", planName: "PPO", isPrimary: true, inNetwork: false, priorAuthVisitTypes: ["NEW_PATIENT"] },
        { ...plan, payer: "Cigna", planName: "Open Access", isPrimary: false, active: false, effectiveTo: daysAgo(91) },
      ],
    },
    prescriptions: { create: [{ prescriberId: "prov_patel", drugName: "Sertraline", strength: "50 mg", directions: "1 daily", refillsRemaining: 2, daysSupply: 30, lastFilledAt: daysAgo(29) }] },
  });
  const noplan = await mk("Dana", "O'Brien-Smith", "2001-12-31", { lastVisitAt: daysAgo(30) });
  // Stands in for "another caller" who grabs a slot; has no other appointments.
  const blocker = await mk("Other", "Caller", "1970-01-01", {});

  const extra: string[] = [];
  let seq = 0;
  const freshPatient = async (firstName: string) => {
    const p = await mk(firstName, `Fresh${++seq}`, "1980-06-15", { lastVisitAt: daysAgo(30) });
    extra.push(p.id);
    return p;
  };
  const cleanup = () => removePatients([maria.id, robert.id, priya.id, noplan.id, blocker.id, ...extra], tag);

  return { tag, lastName, patients: { maria, robert, priya, noplan, blocker }, freshPatient, cleanup };
}

async function removePatients(patientIds: string[], roomPrefix: string): Promise<void> {
  const where = { patientId: { in: patientIds } };
  await prisma.refillRequest.deleteMany({ where });
  await prisma.appointment.updateMany({ where, data: { rescheduledFromId: null } });
  await prisma.appointment.deleteMany({ where });
  await prisma.prescription.deleteMany({ where });
  await prisma.insurancePlan.deleteMany({ where });
  const calls = await prisma.call.findMany({ where: { OR: [where, { roomName: { startsWith: roomPrefix } }] }, select: { id: true } });
  const callIds = calls.map((c) => c.id);
  await prisma.refillRequest.deleteMany({ where: { callId: { in: callIds } } });
  await prisma.appointment.updateMany({ where: { callId: { in: callIds } }, data: { callId: null } });
  await prisma.handoff.deleteMany({ where: { OR: [where, { callId: { in: callIds } }] } });
  await prisma.callEvent.deleteMany({ where: { callId: { in: callIds } } });
  await prisma.transcriptTurn.deleteMany({ where: { callId: { in: callIds } } });
  await prisma.call.deleteMany({ where: { id: { in: callIds } } });
  await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
}

export class FakeTransfer {
  requests: TransferRequest[] = [];
  get isPending(): boolean {
    return this.requests.length > 0;
  }
  async request(req: TransferRequest): Promise<{ alreadyPending: boolean }> {
    const alreadyPending = this.isPending;
    if (!alreadyPending) this.requests.push(req);
    return { alreadyPending };
  }
}

export interface ToolHarness {
  call: CallSession;
  transfer: FakeTransfer;
  run: (name: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  tools: ReturnType<typeof createClinicTools>;
}

let roomSeq = 0;
export async function createToolHarness(fx: Fixture): Promise<ToolHarness> {
  const record = await new CallLogService().findOrCreateByRoomName(`${fx.tag}-room-${++roomSeq}`);
  const call = new CallSession({ callId: record.id, roomName: record.roomName, agentLabel: "RECEPTIONIST" });
  const transfer = new FakeTransfer();
  const tools = createClinicTools(call, transfer as unknown as WarmTransfer);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const run = async (name: string, args: Record<string, unknown> = {}) => {
    const t = byName.get(name);
    if (!t) throw new Error(`no tool ${name}`);
    // The SDK validates arguments against the zod schema before execute.
    const parsed = (t.parameters as unknown as { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { message: string } } }).safeParse(args);
    if (!parsed.success) return { error: `Invalid arguments: ${parsed.error?.message}` };
    return (await t.execute(parsed.data as never, {} as never)) as Record<string, unknown>;
  };
  return { call, transfer, run, tools };
}
