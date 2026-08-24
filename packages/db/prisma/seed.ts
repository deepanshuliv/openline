


import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const caller = await prisma.caller.upsert({
    where: { phone: "+1-555-0100" },
    update: {},
    create: {
      name: "Sarah Miller",
      phone: "+1-555-0100",
      email: "sarah.miller@example.com",
      preferredLanguage: "en",
    },
  });

  const existingMatter = await prisma.matter.findFirst({
    where: { callerId: caller.id, incidentType: "motor_vehicle_accident" },
  });

  const matter =
    existingMatter ??
    (await prisma.matter.create({
      data: {
        callerId: caller.id,
        status: "INTAKE",
        incidentType: "motor_vehicle_accident",
        incidentDate: new Date("2026-08-05T00:00:00.000Z"),
        incidentLocation: "Intersection of 5th Ave & Main St, Springfield",
        incidentDescription: "Rear-ended while stopped at a red light.",
        injuries: ["lower back pain", "whiplash"],
        treatmentReceived: "Evaluated at Springfield Urgent Care",
        emergencyServicesInvolved: true,
        policeReport: true,
        insuranceInformation: "Other driver insured with Acme Mutual",
        representedByAttorney: false,
        qualificationStatus: "PENDING",
      },
    }));

  const existingAppointment = await prisma.appointment.findFirst({
    where: { matterId: matter.id },
  });

  if (!existingAppointment) {
    await prisma.appointment.create({
      data: {
        matterId: matter.id,
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        type: "follow_up_call",
        status: "SCHEDULED",
        idempotencyKey: `seed-${matter.id}`,
      },
    });
  }

  console.log("Seeded demo caller/matter/appointment:", {
    callerId: caller.id,
    matterId: matter.id,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
