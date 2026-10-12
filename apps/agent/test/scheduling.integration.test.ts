// Runs against the local Postgres (DATABASE_URL). Needs migrations + seed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@repo/db";
import { CLINIC, clinicLocalParts } from "@repo/shared";
import { SchedulingService, SlotUnavailableError } from "../src/verticals/clinic/services/SchedulingService.ts";

const scheduling = new SchedulingService();
const TAG = `test-${Date.now()}`;
let patientA: string;
let patientB: string;

beforeAll(async () => {
  const mk = (n: string) =>
    prisma.patient.create({ data: { firstName: n, lastName: TAG, dateOfBirth: new Date("1990-01-01"), phone: `${TAG}-${n}` } });
  patientA = (await mk("A")).id;
  patientB = (await mk("B")).id;
});

afterAll(async () => {
  const ids = [patientA, patientB];
  await prisma.appointment.updateMany({ where: { patientId: { in: ids } }, data: { rescheduledFromId: null } });
  await prisma.appointment.deleteMany({ where: { patientId: { in: ids } } });
  await prisma.patient.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("SchedulingService", () => {
  test("slots respect hours, lunch, work days and lead time", async () => {
    const slots = await scheduling.findSlots({ visitType: "FOLLOW_UP", providerId: "prov_lee", limit: 6 });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const p = clinicLocalParts(s.startsAt);
      const iso = p.weekday === 0 ? 7 : p.weekday;
      expect([1, 3, 5]).toContain(iso); // Dr. Lee: Mon/Wed/Fri
      expect(p.hour).toBeGreaterThanOrEqual(CLINIC.openHour);
      expect(p.hour < CLINIC.lunchStartHour || p.hour >= CLINIC.lunchEndHour).toBe(true);
      expect(s.startsAt.getTime()).toBeGreaterThan(Date.now() + 2 * 3600_000 - 1000);
    }
  });

  test("a booked slot disappears and cannot be double-booked", async () => {
    const [slot] = await scheduling.findSlots({ visitType: "FOLLOW_UP", providerId: "prov_kim", limit: 1 });
    expect(slot).toBeDefined();
    const appt = await scheduling.book({ patientId: patientA, slot: slot!, reason: "test", callId: null as never });
    expect(appt.status).toBe("SCHEDULED");

    // Same patient re-booking is idempotent.
    const again = await scheduling.book({ patientId: patientA, slot: slot!, reason: "test", callId: null as never });
    expect(again.id).toBe(appt.id);

    // Another patient cannot take it.
    await expect(scheduling.book({ patientId: patientB, slot: slot!, reason: "test", callId: null as never })).rejects.toBeInstanceOf(SlotUnavailableError);

    const after = await scheduling.findSlots({ visitType: "FOLLOW_UP", providerId: "prov_kim", limit: 10 });
    expect(after.some((s) => s.startsAt.getTime() === slot!.startsAt.getTime())).toBe(false);
  });

  test("reschedule cancels the old visit and frees its slot", async () => {
    const [first, second] = await scheduling.findSlots({ visitType: "FOLLOW_UP", providerId: "prov_patel", limit: 2 });
    const appt = await scheduling.book({ patientId: patientB, slot: first!, reason: "test", callId: null as never });
    const { previous, next } = await scheduling.reschedule({ appointmentId: appt.id, patientId: patientB, slot: second!, callId: null as never });

    expect(next.rescheduledFromId).toBe(previous.id);
    const old = await prisma.appointment.findUniqueOrThrow({ where: { id: previous.id } });
    expect(old.status).toBe("CANCELLED");
    const open = await scheduling.findSlots({ visitType: "FOLLOW_UP", providerId: "prov_patel", limit: 10 });
    expect(open.some((s) => s.startsAt.getTime() === first!.startsAt.getTime())).toBe(true);
  });

  test("cancelling twice is a no-op the second time", async () => {
    const [slot] = await scheduling.findSlots({ visitType: "SICK_VISIT", providerId: "prov_patel", limit: 1, patientId: patientA });
    const appt = await scheduling.book({ patientId: patientA, slot: slot!, reason: "test", callId: null as never });
    expect(await scheduling.cancel({ appointmentId: appt.id, patientId: patientA, reason: null })).not.toBeNull();
    expect(await scheduling.cancel({ appointmentId: appt.id, patientId: patientA, reason: null })).toBeNull();
  });

  test("a patient cannot cancel someone else's appointment", async () => {
    const [slot] = await scheduling.findSlots({ visitType: "SICK_VISIT", providerId: "prov_lee", limit: 1, patientId: patientA });
    const appt = await scheduling.book({ patientId: patientA, slot: slot!, reason: "test", callId: null as never });
    expect(await scheduling.cancel({ appointmentId: appt.id, patientId: patientB, reason: null })).toBeNull();
  });
});
