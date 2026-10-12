// Clinic tools end to end against local Postgres + Redis, exactly as the LLM
// calls them (handles, error messages, side effects). Needs migrations + seed
// (for providers). No model calls.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@repo/db";
import { CLINIC, clinicLocalParts, formatClinicTime } from "@repo/shared";
import { SchedulingService, SlotUnavailableError } from "../src/verticals/clinic/services/SchedulingService.ts";
import { createFixture, createToolHarness, type Fixture, type ToolHarness } from "./fixtures.ts";

let fx: Fixture;
beforeAll(async () => {
  fx = await createFixture();
});
afterAll(async () => {
  await fx.cleanup();
  await prisma.$disconnect();
});

const verify = (h: ToolHarness, p: { firstName: string; lastName: string; dob: string }) =>
  h.run("verify_patient", { first_name: p.firstName, last_name: p.lastName, date_of_birth: p.dob });

// Next clinic-local weekday (Mon-Fri) at least `minDays` out, as YYYY-MM-DD.
function nextWeekday(isoWeekday: number, minDays = 2): string {
  for (let i = minDays; i < minDays + 8; i++) {
    const p = clinicLocalParts(new Date(Date.now() + i * 86_400_000));
    if ((p.weekday === 0 ? 7 : p.weekday) === isoWeekday) return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  }
  throw new Error("unreachable");
}

describe("verify_patient", () => {
  test("exact match verifies and returns context", async () => {
    const h = await createToolHarness(fx);
    const r = await verify(h, fx.patients.robert);
    expect(r.verified).toBe(true);
    expect(r.medications).toContain("Lisinopril 10 mg");
    expect(h.call.patientId).toBe(fx.patients.robert.id);
  });

  test("case, whitespace and nickname-prefix tolerant", async () => {
    const h = await createToolHarness(fx);
    const r = await h.run("verify_patient", { first_name: " rob ", last_name: fx.patients.robert.lastName.toUpperCase(), date_of_birth: "1958-05-09" });
    expect(r.verified).toBe(true);
  });

  test("punctuation in last names is ignored (O'Brien-Smith vs OBrien Smith)", async () => {
    const h = await createToolHarness(fx);
    const spoken = fx.patients.noplan.lastName.replace("'", "").replace("-", " ");
    const r = await h.run("verify_patient", { first_name: "Dana", last_name: spoken, date_of_birth: "2001-12-31" });
    expect(r.verified).toBe(true);
  });

  test("merged first+last name (STT 'Priyashah') can still be matched when split", async () => {
    const h = await createToolHarness(fx);
    const r = await verify(h, fx.patients.priya);
    expect(r.verified).toBe(true);
  });

  test("wrong DOB fails without leaking data", async () => {
    const h = await createToolHarness(fx);
    const r = await h.run("verify_patient", { first_name: "Maria", last_name: fx.patients.maria.lastName, date_of_birth: "1985-03-15" });
    expect(r.verified).toBe(false);
    expect(JSON.stringify(r)).not.toContain("Aetna");
    expect(h.call.patientId).toBeNull();
  });

  test("impossible calendar date is rejected, not rolled over", async () => {
    const h = await createToolHarness(fx);
    const r = await h.run("verify_patient", { first_name: "Maria", last_name: fx.patients.maria.lastName, date_of_birth: "1985-02-30" });
    expect(r.verified).toBe(false);
  });

  test("a single-letter first name is not enough to match", async () => {
    const h = await createToolHarness(fx);
    const r = await h.run("verify_patient", { first_name: "M", last_name: fx.patients.maria.lastName, date_of_birth: fx.patients.maria.dob });
    expect(r.verified).toBe(false);
  });

  test("locks out after 3 failed attempts, even with the right answer", async () => {
    const h = await createToolHarness(fx);
    for (let i = 0; i < 3; i++) await h.run("verify_patient", { first_name: "Maria", last_name: fx.patients.maria.lastName, date_of_birth: "1900-01-01" });
    const r = await verify(h, fx.patients.maria);
    expect(r.verified).toBe(false);
    expect(String(r.message)).toContain("transfer");
  });

  test("re-verifying as a different person replaces the verified patient", async () => {
    const h = await createToolHarness(fx);
    await verify(h, fx.patients.maria);
    await verify(h, fx.patients.robert);
    expect(h.call.patientId).toBe(fx.patients.robert.id);
  });
});

describe("guards before verification", () => {
  for (const [name, args] of [
    ["book_appointment", { slot_id: "S1", reason: "x" }],
    ["list_my_appointments", {}],
    ["cancel_appointment", { appointment_id: "A1" }],
    ["reschedule_appointment", { appointment_id: "A1", slot_id: "S1" }],
    ["check_insurance", {}],
    ["list_medications", {}],
    ["request_refill", { medication_name: "Lisinopril" }],
  ] as const) {
    test(`${name} refuses an unverified caller`, async () => {
      const h = await createToolHarness(fx);
      const r = await h.run(name, args);
      expect(String(r.error)).toContain("not verified");
    });
  }
});

describe("find_appointment_slots", () => {
  test("a single-day search returns slots on that clinic-local day", async () => {
    const h = await createToolHarness(fx);
    const day = nextWeekday(2); // Tuesday
    const r = await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", earliest_date: day, latest_date: day });
    const slots = r.slots as { when: string }[];
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(s.when).toStartWith("Tuesday");
  });

  test("a single-day search late in the day still covers the whole day (afternoon)", async () => {
    const h = await createToolHarness(fx);
    const day = nextWeekday(4); // Thursday
    const r = await h.run("find_appointment_slots", { visit_type: "SICK_VISIT", earliest_date: day, latest_date: day, part_of_day: "afternoon" });
    const slots = r.slots as { when: string }[];
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(s.when).toMatch(/^Thursday.* (1|2|3|4):\d\d PM$/);
  });

  test("weekend-only range returns nothing and says so", async () => {
    const h = await createToolHarness(fx);
    const sat = (() => {
      const mon = nextWeekday(1);
      const d = new Date(`${mon}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 5);
      return d.toISOString().slice(0, 10);
    })();
    const sun = new Date(new Date(`${sat}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
    const r = await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", earliest_date: sat, latest_date: sun });
    expect(r.slots).toEqual([]);
    expect(String(r.message)).toBeTruthy();
  });

  test("reversed date range is handled (swapped), not silently empty", async () => {
    const h = await createToolHarness(fx);
    const a = nextWeekday(1);
    const b = nextWeekday(5);
    const [late, early] = a > b ? [a, b] : [b, a];
    const r = await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", earliest_date: late, latest_date: early });
    expect((r.slots as unknown[]).length).toBeGreaterThan(0);
  });

  test("past dates fall back to the next available times", async () => {
    const h = await createToolHarness(fx);
    const r = await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", earliest_date: "2020-01-01" });
    expect((r.slots as unknown[]).length).toBeGreaterThan(0);
  });

  test("provider-specific search respects work days (Sarah Kim: Tue/Thu)", async () => {
    const h = await createToolHarness(fx);
    const r = await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", provider_name: "Sarah Kim" });
    for (const s of r.slots as { when: string; provider: string }[]) {
      expect(s.provider).toBe("Sarah Kim");
      expect(s.when).toMatch(/^(Tuesday|Thursday)/);
    }
  });

  test("provider-specific search on a day they don't work explains why", async () => {
    const h = await createToolHarness(fx);
    const mon = nextWeekday(1);
    const r = await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", provider_name: "Kim", earliest_date: mon, latest_date: mon });
    expect(r.slots).toEqual([]);
    expect(String(r.message)).toContain("Tuesday");
  });

  test("provider name variants resolve: 'doctor patel', 'Dr. Lee', 'nurse practitioner Kim'", async () => {
    const h = await createToolHarness(fx);
    for (const [name, expected] of [["doctor patel", "Dr. Anita Patel"], ["Dr. Lee", "Dr. Marcus Lee"], ["nurse practitioner Kim", "Sarah Kim"], ["Marcus", "Dr. Marcus Lee"]]) {
      const r = await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", provider_name: name });
      expect((r.slots as { provider: string }[])[0]?.provider).toBe(expected!);
    }
  });

  test("a bare title like 'Dr.' or 'the doctor' does not silently pick a provider", async () => {
    const h = await createToolHarness(fx);
    const anyProvider = await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP" });
    for (const name of ["Dr.", "doctor", "the doctor"]) {
      // Treated as "any provider", not matched to whoever is listed first.
      const r = await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", provider_name: name });
      expect(r.slots).toEqual(anyProvider.slots);
    }
  });

  test("unknown provider lists the real ones", async () => {
    const h = await createToolHarness(fx);
    const r = await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", provider_name: "Dr. House" });
    expect(String(r.error)).toContain("Dr. Anita Patel");
  });

  test("slots never land in lunch, outside hours, or overrun close", async () => {
    const h = await createToolHarness(fx);
    const r = await h.run("find_appointment_slots", { visit_type: "ANNUAL_PHYSICAL", part_of_day: "any" });
    expect((r.slots as unknown[]).length).toBeGreaterThan(0);
    for (const s of r.slots as { when: string }[]) {
      const m = s.when.match(/at (\d+):(\d\d) (AM|PM)$/)!;
      const h24 = (Number(m[1]) % 12) + (m[3] === "PM" ? 12 : 0);
      const start = h24 * 60 + Number(m[2]);
      expect(start).toBeGreaterThanOrEqual(CLINIC.openHour * 60);
      expect(start + 40).toBeLessThanOrEqual(CLINIC.closeHour * 60);
      expect(start + 40 <= CLINIC.lunchStartHour * 60 || start >= CLINIC.lunchEndHour * 60).toBe(true);
    }
  });
});

describe("booking flow", () => {
  test("book -> list -> reschedule -> cancel, with handles", async () => {
    const h = await createToolHarness(fx);
    await verify(h, await fx.freshPatient("Eve"));
    const found = await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", provider_name: "Patel" });
    const booked = await h.run("book_appointment", { slot_id: "S1", reason: "blood pressure check" });
    expect(booked.booked).toBe(true);
    expect(booked.when).toBe((found.slots as { when: string }[])[0]!.when);

    const listed = await h.run("list_my_appointments");
    expect((listed.appointments as unknown[]).length).toBe(1);

    await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", provider_name: "Patel" });
    const moved = await h.run("reschedule_appointment", { appointment_id: "A1", slot_id: "S2" });
    expect(moved.rescheduled).toBe(true);

    await h.run("list_my_appointments");
    const cancelled = await h.run("cancel_appointment", { appointment_id: "A1", reason: "feeling better" });
    expect(cancelled.cancelled).toBe(true);
    expect(((await h.run("list_my_appointments")).appointments as unknown[]).length).toBe(0);
  });

  test("handles tolerate model formatting: 's1', ' S1 ', '1'", async () => {
    const h = await createToolHarness(fx);
    await verify(h, await fx.freshPatient("Finn"));
    await h.run("find_appointment_slots", { visit_type: "SICK_VISIT", provider_name: "Lee" });
    const r = await h.run("book_appointment", { slot_id: "1", reason: "cough" });
    expect(r.booked).toBe(true);
    await h.run("list_my_appointments");
    expect((await h.run("cancel_appointment", { appointment_id: " a1 " })).cancelled).toBe(true);
  });

  test("invented slot handle is rejected", async () => {
    const h = await createToolHarness(fx);
    await verify(h, fx.patients.maria);
    const r = await h.run("book_appointment", { slot_id: "S9", reason: "x" });
    expect(String(r.error)).toContain("Unknown slot");
  });

  test("a slot taken by someone else mid-call fails cleanly", async () => {
    const a = await createToolHarness(fx);
    const b = await createToolHarness(fx);
    await verify(a, await fx.freshPatient("Gus"));
    await verify(b, await fx.freshPatient("Hana"));
    await a.run("find_appointment_slots", { visit_type: "FOLLOW_UP", provider_name: "Kim" });
    await b.run("find_appointment_slots", { visit_type: "FOLLOW_UP", provider_name: "Kim" });
    expect((await a.run("book_appointment", { slot_id: "S1", reason: "x" })).booked).toBe(true);
    const r = await b.run("book_appointment", { slot_id: "S1", reason: "x" });
    expect(String(r.error)).toContain("just taken");
  });

  test("concurrent double-book of one slot: exactly one wins", async () => {
    const scheduling = new SchedulingService();
    const [p1, p2] = await Promise.all([fx.freshPatient("Ann"), fx.freshPatient("Ben")]);
    const [slot] = await scheduling.findSlots({ visitType: "SICK_VISIT", providerId: "prov_patel", partOfDay: "afternoon" });
    const results = await Promise.allSettled([
      scheduling.book({ patientId: p1.id, slot: slot!, reason: "x", callId: null as never }),
      scheduling.book({ patientId: p2.id, slot: slot!, reason: "x", callId: null as never }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(SlotUnavailableError);
  });

  test("patient can't be double-booked at the same time with another provider", async () => {
    const h = await createToolHarness(fx);
    await verify(h, fx.patients.priya);
    const day = nextWeekday(3); // Wednesday: Patel and Lee both work
    const withPatel = await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", provider_name: "Patel", earliest_date: day, latest_date: day });
    expect((withPatel.slots as unknown[]).length).toBeGreaterThan(0);
    expect((await h.run("book_appointment", { slot_id: "S1", reason: "x" })).booked).toBe(true);
    const first = (withPatel.slots as { when: string }[])[0]!.when;
    const withLee = await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", provider_name: "Lee", earliest_date: day, latest_date: day });
    expect((withLee.slots as { when: string }[]).some((s) => s.when === first)).toBe(false);
  });

  test("rescheduling a 40-minute physical keeps a 40-minute block", async () => {
    const h = await createToolHarness(fx);
    const patient = await fx.freshPatient("Carl");
    await verify(h, patient);
    await h.run("find_appointment_slots", { visit_type: "ANNUAL_PHYSICAL", provider_name: "Lee" });
    expect((await h.run("book_appointment", { slot_id: "S1", reason: "physical" })).booked).toBe(true);
    await h.run("list_my_appointments");
    // Model searches with the wrong visit type before rescheduling.
    await h.run("find_appointment_slots", { visit_type: "FOLLOW_UP", provider_name: "Lee", part_of_day: "afternoon" });
    const r = await h.run("reschedule_appointment", { appointment_id: "A1", slot_id: "S1" });
    const appts = await prisma.appointment.findMany({ where: { patientId: patient.id, status: "SCHEDULED", visitType: "ANNUAL_PHYSICAL" } });
    expect(appts.length).toBe(1);
    for (const a of appts) expect(a.endsAt.getTime() - a.startsAt.getTime()).toBe(40 * 60_000);
    if (r.error) expect(String(r.error)).toContain("ANNUAL_PHYSICAL");
  });

  test("failed reschedule leaves the original appointment intact", async () => {
    const a = await createToolHarness(fx);
    const patient = await fx.freshPatient("Dora");
    await verify(a, patient);
    await a.run("find_appointment_slots", { visit_type: "SICK_VISIT", provider_name: "Lee", part_of_day: "morning" });
    expect((await a.run("book_appointment", { slot_id: "S1", reason: "x" })).booked).toBe(true);
    await a.run("list_my_appointments");
    const offered = await a.run("find_appointment_slots", { visit_type: "SICK_VISIT", provider_name: "Lee", part_of_day: "afternoon" });
    // Someone else grabs the offered S1 before the caller confirms.
    const scheduling = new SchedulingService();
    const same = await scheduling.findSlots({ visitType: "SICK_VISIT", providerId: "prov_lee", partOfDay: "afternoon", patientId: patient.id });
    expect(formatClinicTime(same[0]!.startsAt)).toBe((offered.slots as { when: string }[])[0]!.when);
    await scheduling.book({ patientId: fx.patients.blocker.id, slot: same[0]!, reason: "x", callId: a.call.callId });
    const r = await a.run("reschedule_appointment", { appointment_id: "A1", slot_id: "S1" });
    expect(String(r.error)).toContain("Nothing was changed");
    expect(((await a.run("list_my_appointments")).appointments as unknown[]).length).toBeGreaterThan(0);
  });

  test("a NEW_PATIENT visit only offers providers accepting new patients", async () => {
    const h = await createToolHarness(fx);
    const accepting = new Set((await prisma.provider.findMany({ where: { acceptsNewPatients: true } })).map((p) => p.name));
    const r = await h.run("find_appointment_slots", { visit_type: "NEW_PATIENT" });
    for (const s of r.slots as { provider: string }[]) expect(accepting.has(s.provider)).toBe(true);
  });
});

describe("check_insurance", () => {
  test("in-network plan returns copay", async () => {
    const h = await createToolHarness(fx);
    await verify(h, fx.patients.maria);
    const r = await h.run("check_insurance", { visit_type: "FOLLOW_UP" });
    const [plan] = r.plans as { in_network: boolean; copay: string; member_id_last4: string }[];
    expect(plan).toMatchObject({ in_network: true, copay: "$25", member_id_last4: "6789" });
  });

  test("out-of-network primary + expired secondary reported honestly", async () => {
    const h = await createToolHarness(fx);
    await verify(h, fx.patients.priya);
    const r = await h.run("check_insurance", { visit_type: "NEW_PATIENT" });
    const plans = r.plans as { plan: string; eligible: boolean; in_network: boolean; prior_auth_required: boolean }[];
    expect(plans.find((p) => p.plan.startsWith("Blue Cross"))).toMatchObject({ in_network: false, prior_auth_required: true });
    expect(plans.find((p) => p.plan.startsWith("Cigna"))?.eligible).toBe(false);
  });

  test("no plan on file offers billing", async () => {
    const h = await createToolHarness(fx);
    await verify(h, fx.patients.noplan);
    const r = await h.run("check_insurance");
    expect(r.plans).toEqual([]);
    expect(String(r.message)).toContain("billing");
  });
});

describe("request_refill", () => {
  test("each refill rule maps to the right outcome", async () => {
    const h = await createToolHarness(fx);
    await verify(h, fx.patients.robert);
    const outcome = async (m: string) => (await h.run("request_refill", { medication_name: m })).outcome;
    expect(await outcome("Lisinopril")).toBe("SENT_TO_PHARMACY");
    expect(await outcome("atorvastatin 20 mg")).toBe("PROVIDER_APPROVAL_REQUIRED");
    expect(await outcome("Lorazepam")).toBe("CLINICIAN_REVIEW");
    expect(await outcome("metformin")).toBe("CLINICIAN_REVIEW"); // filled 5 days ago
  });

  test("stale patient needs a visit", async () => {
    const h = await createToolHarness(fx);
    await verify(h, fx.patients.priya);
    expect((await h.run("request_refill", { medication_name: "Sertraline" })).outcome).toBe("VISIT_REQUIRED");
  });

  test("tolerates punctuation and filler words from transcripts", async () => {
    const h = await createToolHarness(fx);
    await verify(h, fx.patients.priya);
    const r = await h.run("request_refill", { medication_name: "my sertraline." });
    expect(r.medication).toBe("Sertraline");
  });

  test("a drug not on file is refused, never guessed", async () => {
    const h = await createToolHarness(fx);
    await verify(h, fx.patients.robert);
    expect(String((await h.run("request_refill", { medication_name: "Lisinopro" })).error)).toContain("not on the caller's active medication list");
    expect(String((await h.run("request_refill", { medication_name: "oxycodone" })).error)).toContain("not on");
  });

  test("a second immediate refill of the same drug is not sent twice", async () => {
    const h = await createToolHarness(fx);
    await verify(h, fx.patients.maria);
    // Maria has no meds; use Robert's freshly refilled Lisinopril from the first test path.
    const h2 = await createToolHarness(fx);
    await verify(h2, fx.patients.robert);
    const r = await h2.run("request_refill", { medication_name: "Lisinopril" });
    expect(r.outcome).not.toBe("SENT_TO_PHARMACY");
  });

  test("a different pharmacy is honored", async () => {
    const h = await createToolHarness(fx);
    await verify(h, fx.patients.robert);
    const r = await h.run("request_refill", { medication_name: "Atorvastatin", pharmacy: "Walgreens on 5th" });
    expect(r.pharmacy).toBe("Walgreens on 5th");
  });
});

describe("transfer and end_call", () => {
  test("transfer queues once; a repeat is already_waiting", async () => {
    const h = await createToolHarness(fx);
    const args = { department: "NURSE", reason: "side effects", summary: "Caller has questions." };
    expect((await h.run("transfer_to_staff", args)).status).toBe("queued");
    expect((await h.run("transfer_to_staff", args)).status).toBe("already_waiting");
  });

  test("end_call is refused while a transfer is pending", async () => {
    const h = await createToolHarness(fx);
    await h.run("transfer_to_staff", { department: "BILLING", reason: "dispute", summary: "x" });
    expect((await h.run("end_call", { summary: "done" })).ended).toBe(false);
  });

  test("end_call ends the call", async () => {
    const h = await createToolHarness(fx);
    let ended = "";
    h.call.onEnded = (r) => (ended = r);
    expect((await h.run("end_call", { summary: "booked" })).ended).toBe(true);
    expect(ended).toBe("agent_ended");
  });
});
