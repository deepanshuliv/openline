import { prisma } from "@repo/db";








export class AppointmentService {

  checkAvailability(preferredWindowStart: string): { slotId: string; startsAt: string }[] {
    const base = new Date(preferredWindowStart);
    const start = Number.isNaN(base.getTime()) ? new Date() : base;

    const slots: { slotId: string; startsAt: string }[] = [];
    let daysAdded = 0;
    let cursor = new Date(start);
    while (slots.length < 3) {
      cursor = addDays(cursor, 1);
      if (isWeekend(cursor)) continue;
      daysAdded += 1;
      for (const hour of [10, 14]) {
        if (slots.length >= 3) break;
        const slotTime = new Date(cursor);
        slotTime.setHours(hour, 0, 0, 0);
        slots.push({ slotId: `slot-${slotTime.toISOString()}`, startsAt: slotTime.toISOString() });
      }
      if (daysAdded > 10) break;
    }
    return slots;
  }


  async scheduleFollowUp(input: {
    matterId: string;
    slotId: string;
    callId: string;
    appointmentRequestId: string;
    type?: string;
  }): Promise<{ appointmentId: string; scheduledAt: string; status: string; idempotent: boolean }> {
    const idempotencyKey = `${input.callId}:${input.appointmentRequestId}`;

    const existing = await prisma.appointment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return {
        appointmentId: existing.id,
        scheduledAt: existing.scheduledAt.toISOString(),
        status: existing.status,
        idempotent: true,
      };
    }

    const scheduledAt = new Date(input.slotId.replace(/^slot-/, ""));
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new Error(`invalid slotId: ${input.slotId}`);
    }

    const appointment = await prisma.appointment.create({
      data: {
        matterId: input.matterId,
        scheduledAt,
        type: input.type ?? "follow_up_call",
        status: "SCHEDULED",
        idempotencyKey,
      },
    });

    await prisma.matter.update({ where: { id: input.matterId }, data: { status: "SCHEDULED" } });

    return {
      appointmentId: appointment.id,
      scheduledAt: appointment.scheduledAt.toISOString(),
      status: appointment.status,
      idempotent: false,
    };
  }
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}
