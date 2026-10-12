import { prisma, type Prisma } from "@repo/db";
import { CLINIC, VISIT_TYPE_INFO, clinicLocalParts, clinicLocalToUtc, type VisitType } from "@repo/shared";

const DAY_MS = 86_400_000;
const MIN_LEAD_MS = 2 * 60 * 60_000;

type PartOfDay = "morning" | "afternoon" | "any";

export interface Slot {
  providerId: string;
  providerName: string;
  startsAt: Date;
  endsAt: Date;
  visitType: VisitType;
}

export class SlotUnavailableError extends Error {}

// A slot's length comes from the visit type it was searched for, so a visit can
// only move into a slot found for the same visit type.
export class VisitTypeMismatchError extends Error {
  constructor(readonly visitType: VisitType) {
    super(`Slots must be searched with visit_type ${visitType} for this appointment.`);
  }
}

const TITLE_WORDS = new Set(["dr", "doctor", "nurse", "practitioner", "np", "md", "the", "with"]);
const nameWords = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w && !TITLE_WORDS.has(w));

export const WEEKDAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export class SchedulingService {
  // Matches "Dr. Lee", "doctor patel", "nurse practitioner Kim", "Marcus".
  // Returns "any" when the name is only a title ("the doctor").
  async findProviderByName(name: string) {
    const wanted = nameWords(name);
    if (wanted.length === 0) return "any" as const;
    const providers = await prisma.provider.findMany();
    return providers.find((p) => wanted.every((w) => nameWords(p.name).includes(w))) ?? null;
  }

  // Open slots on the clinic grid, excluding lunch, booked time, and anything
  // too soon to prepare for. Spreads results across days so the caller gets choices.
  async findSlots(opts: {
    visitType: VisitType;
    providerId?: string | null;
    from?: Date;
    to?: Date;
    partOfDay?: PartOfDay;
    limit?: number;
    // Skip times that overlap this patient's own scheduled visits.
    patientId?: string | null;
  }): Promise<Slot[]> {
    const now = Date.now();
    const from = new Date(Math.max(opts.from?.getTime() ?? now, now + MIN_LEAD_MS));
    const to = opts.to ?? new Date(now + CLINIC.bookingHorizonDays * DAY_MS);
    const limit = opts.limit ?? 3;
    const minutes = VISIT_TYPE_INFO[opts.visitType].minutes;

    const providers = await prisma.provider.findMany({
      where: {
        ...(opts.providerId ? { id: opts.providerId } : {}),
        ...(opts.visitType === "NEW_PATIENT" ? { acceptsNewPatients: true } : {}),
      },
    });
    if (providers.length === 0) return [];

    const booked = await prisma.appointment.findMany({
      where: { providerId: { in: providers.map((p) => p.id) }, status: "SCHEDULED", startsAt: { lt: to }, endsAt: { gt: from } },
      select: { providerId: true, startsAt: true, endsAt: true },
    });
    const own = opts.patientId
      ? await prisma.appointment.findMany({ where: { patientId: opts.patientId, status: "SCHEDULED", startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } })
      : [];

    const slots: Slot[] = [];
    const perDay = new Map<string, number>();
    // Walk clinic-local calendar days (not 24h steps from an arbitrary instant,
    // which skips the last day of a range and drifts across DST).
    const first = clinicLocalParts(from);
    for (let offset = 0; slots.length < limit; offset++) {
      const date = new Date(Date.UTC(first.year, first.month - 1, first.day + offset));
      const day = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() };
      if (clinicLocalToUtc(day.year, day.month, day.day, 0, 0) > to) break;
      const isoWeekday = day.weekday === 0 ? 7 : day.weekday;
      if (isoWeekday > 5) continue;
      const dayKey = `${day.year}-${day.month}-${day.day}`;

      for (let minute = CLINIC.openHour * 60; minute + minutes <= CLINIC.closeHour * 60; minute += CLINIC.slotMinutes) {
        if (slots.length >= limit) break;
        const hour = Math.floor(minute / 60);
        const endMinute = minute + minutes;
        if (minute < CLINIC.lunchEndHour * 60 && endMinute > CLINIC.lunchStartHour * 60) continue;
        if (opts.partOfDay === "morning" && hour >= 12) continue;
        if (opts.partOfDay === "afternoon" && hour < 12) continue;

        const startsAt = clinicLocalToUtc(day.year, day.month, day.day, hour, minute % 60);
        const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
        if (startsAt < from || startsAt > to) continue;
        if (own.some((a) => a.startsAt < endsAt && a.endsAt > startsAt)) continue;

        for (const provider of providers) {
          if (!provider.workDays.includes(isoWeekday)) continue;
          const clash = booked.some((b) => b.providerId === provider.id && b.startsAt < endsAt && b.endsAt > startsAt);
          if (clash) continue;
          // At most two options per day keeps spoken choices varied.
          if ((perDay.get(dayKey) ?? 0) >= 2) break;
          slots.push({ providerId: provider.id, providerName: provider.name, startsAt, endsAt, visitType: opts.visitType });
          perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + 1);
          // Skip ahead so two same-day options aren't back-to-back.
          minute += 60 - CLINIC.slotMinutes;
          break;
        }
      }
    }
    return slots;
  }

  async upcomingFor(patientId: string) {
    return prisma.appointment.findMany({
      where: { patientId, status: "SCHEDULED", startsAt: { gte: new Date() } },
      include: { provider: true },
      orderBy: { startsAt: "asc" },
    });
  }

  async book(input: { patientId: string; slot: Slot; reason: string; callId: string }) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findFirst({
        where: { patientId: input.patientId, providerId: input.slot.providerId, startsAt: input.slot.startsAt, status: "SCHEDULED" },
        include: { provider: true },
      });
      if (existing) return existing;
      await assertFree(tx, input.slot);
      await assertPatientFree(tx, input.patientId, input.slot);
      return tx.appointment.create({
        data: {
          patientId: input.patientId,
          providerId: input.slot.providerId,
          startsAt: input.slot.startsAt,
          endsAt: input.slot.endsAt,
          visitType: input.slot.visitType,
          reason: input.reason,
          callId: input.callId,
        },
        include: { provider: true },
      });
    }).catch(rethrowConflict);
  }

  async reschedule(input: { appointmentId: string; patientId: string; slot: Slot; callId: string }) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.appointment.findFirst({ where: { id: input.appointmentId, patientId: input.patientId, status: "SCHEDULED" } });
      if (!current) throw new SlotUnavailableError("That appointment is no longer scheduled.");
      if (current.visitType !== input.slot.visitType) throw new VisitTypeMismatchError(current.visitType as VisitType);
      await tx.appointment.update({ where: { id: current.id }, data: { status: "CANCELLED", cancelReason: "rescheduled" } });
      await assertFree(tx, input.slot);
      await assertPatientFree(tx, input.patientId, input.slot);
      const next = await tx.appointment.create({
        data: {
          patientId: input.patientId,
          providerId: input.slot.providerId,
          startsAt: input.slot.startsAt,
          endsAt: input.slot.endsAt,
          visitType: current.visitType,
          reason: current.reason,
          rescheduledFromId: current.id,
          callId: input.callId,
        },
        include: { provider: true },
      });
      return { previous: current, next };
    }).catch(rethrowConflict);
  }

  async cancel(input: { appointmentId: string; patientId: string; reason: string | null }) {
    const result = await prisma.appointment.updateMany({
      where: { id: input.appointmentId, patientId: input.patientId, status: "SCHEDULED" },
      data: { status: "CANCELLED", cancelReason: input.reason ?? "cancelled by patient" },
    });
    if (result.count === 0) return null;
    return prisma.appointment.findUnique({ where: { id: input.appointmentId }, include: { provider: true } });
  }
}

async function assertFree(tx: Prisma.TransactionClient, slot: Slot): Promise<void> {
  const clash = await tx.appointment.findFirst({
    where: { providerId: slot.providerId, status: "SCHEDULED", startsAt: { lt: slot.endsAt }, endsAt: { gt: slot.startsAt } },
  });
  if (clash) throw new SlotUnavailableError("That time was just taken.");
}

async function assertPatientFree(tx: Prisma.TransactionClient, patientId: string, slot: Slot): Promise<void> {
  const clash = await tx.appointment.findFirst({
    where: { patientId, status: "SCHEDULED", startsAt: { lt: slot.endsAt }, endsAt: { gt: slot.startsAt } },
  });
  if (clash) throw new SlotUnavailableError("The caller already has an appointment at that time.");
}

// The partial unique index on (providerId, startsAt) is the last line of
// defense against two concurrent bookings of the same slot.
function rethrowConflict(err: unknown): never {
  if (typeof err === "object" && err && "code" in err && (err as { code: string }).code === "P2002") {
    throw new SlotUnavailableError("That time was just taken.");
  }
  throw err;
}
