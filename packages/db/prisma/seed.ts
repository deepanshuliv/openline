import { PrismaClient } from "@prisma/client";
import { CLINIC, clinicLocalParts, clinicLocalToUtc } from "@repo/shared";

const prisma = new PrismaClient();

// Synthetic demo data — one patient per demo scenario. Dates are relative to
// "now" so the scenarios keep working whenever the seed is run. Re-running the
// seed resets these patients' clinical records but keeps call history.

const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

// The Nth business day from today, at a clinic-local wall-clock time.
function businessDayAt(n: number, hour: number, minute = 0): Date {
  let cursor = new Date();
  let remaining = n;
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    const { weekday } = clinicLocalParts(cursor);
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  const p = clinicLocalParts(cursor);
  return clinicLocalToUtc(p.year, p.month, p.day, hour, minute);
}

const PROVIDERS = [
  { id: "prov_patel", name: "Dr. Anita Patel", title: "MD", specialty: "Family Medicine", workDays: [1, 2, 3, 4, 5] },
  { id: "prov_lee", name: "Dr. Marcus Lee", title: "MD", specialty: "Internal Medicine", workDays: [1, 3, 5] },
  { id: "prov_kim", name: "Sarah Kim", title: "NP", specialty: "Family Nurse Practitioner", workDays: [2, 4] },
];

async function resetPatient(data: {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  preferredPharmacy: string;
  lastVisitAt: Date | null;
  primaryProviderId: string;
}) {
  const { phone, dateOfBirth, ...rest } = data;
  const patient = await prisma.patient.upsert({
    where: { phone },
    update: { ...rest, dateOfBirth: new Date(dateOfBirth) },
    create: { ...rest, phone, dateOfBirth: new Date(dateOfBirth) },
  });
  await prisma.refillRequest.deleteMany({ where: { patientId: patient.id } });
  await prisma.prescription.deleteMany({ where: { patientId: patient.id } });
  await prisma.insurancePlan.deleteMany({ where: { patientId: patient.id } });
  // Break reschedule links before deleting appointments.
  await prisma.appointment.updateMany({ where: { patientId: patient.id }, data: { rescheduledFromId: null } });
  await prisma.appointment.deleteMany({ where: { patientId: patient.id } });
  return patient;
}

async function main() {
  for (const p of PROVIDERS) {
    await prisma.provider.upsert({ where: { id: p.id }, update: p, create: p });
  }

  const yearStart = clinicLocalToUtc(new Date().getFullYear(), 1, 1, 0);

  // Scenario 1 — book an appointment.
  const maria = await resetPatient({
    firstName: "Maria",
    lastName: "Gonzalez",
    dateOfBirth: "1985-03-14",
    phone: "+15550100101",
    email: "maria.gonzalez@example.com",
    preferredPharmacy: "CVS Pharmacy, 120 Main St",
    lastVisitAt: daysAgo(240),
    primaryProviderId: "prov_patel",
  });
  await prisma.insurancePlan.create({
    data: {
      patientId: maria.id,
      payer: "Aetna",
      planName: "Aetna Choice POS II",
      memberId: "W123456789",
      groupNumber: "0847291",
      effectiveFrom: yearStart,
      primaryCopayCents: 2500,
      specialistCopayCents: 5000,
      deductibleCents: 100000,
      deductibleMetCents: 100000,
    },
  });

  // Scenario 2 — reschedule / cancel.
  const james = await resetPatient({
    firstName: "James",
    lastName: "Carter",
    dateOfBirth: "1972-11-02",
    phone: "+15550100102",
    email: "james.carter@example.com",
    preferredPharmacy: "Walgreens, 45 Oak Ave",
    lastVisitAt: daysAgo(60),
    primaryProviderId: "prov_lee",
  });
  await prisma.insurancePlan.create({
    data: {
      patientId: james.id,
      payer: "UnitedHealthcare",
      planName: "UHC Choice Plus",
      memberId: "UHC883421907",
      effectiveFrom: yearStart,
      primaryCopayCents: 3000,
      specialistCopayCents: 6000,
      deductibleCents: 200000,
      deductibleMetCents: 50000,
      coinsurancePct: 20,
    },
  });
  // Dr. Lee works Mon/Wed/Fri; pick the first of those 2+ business days out.
  let followUpDay = 2;
  while (![1, 3, 5].includes(clinicLocalParts(businessDayAt(followUpDay, 10)).weekday)) followUpDay += 1;
  const followUpAt = businessDayAt(followUpDay, 10, 0);
  await prisma.appointment.create({
    data: {
      patientId: james.id,
      providerId: "prov_lee",
      startsAt: followUpAt,
      endsAt: new Date(followUpAt.getTime() + 20 * 60_000),
      visitType: "FOLLOW_UP",
      reason: "Blood pressure follow-up",
    },
  });
  const physicalAt = businessDayAt(9, 9, 0);
  await prisma.appointment.create({
    data: {
      patientId: james.id,
      providerId: "prov_patel",
      startsAt: physicalAt,
      endsAt: new Date(physicalAt.getTime() + 40 * 60_000),
      visitType: "ANNUAL_PHYSICAL",
      reason: "Annual physical",
    },
  });

  // Scenario 3 — insurance / eligibility. Old employer plan is inactive.
  const priya = await resetPatient({
    firstName: "Priya",
    lastName: "Shah",
    dateOfBirth: "1990-07-21",
    phone: "+15550100103",
    email: "priya.shah@example.com",
    preferredPharmacy: "Rite Aid, 9 Elm St",
    lastVisitAt: daysAgo(400),
    primaryProviderId: "prov_kim",
  });
  await prisma.insurancePlan.create({
    data: {
      patientId: priya.id,
      payer: "Blue Cross Blue Shield",
      planName: "BCBS Blue Advantage PPO",
      memberId: "XYZ771203456",
      groupNumber: "55120",
      effectiveFrom: daysAgo(90),
      primaryCopayCents: 3500,
      specialistCopayCents: 7000,
      deductibleCents: 150000,
      deductibleMetCents: 40000,
      coinsurancePct: 20,
      priorAuthVisitTypes: ["NEW_PATIENT"],
    },
  });
  await prisma.insurancePlan.create({
    data: {
      patientId: priya.id,
      payer: "Cigna",
      planName: "Cigna Open Access Plus",
      memberId: "U44190277",
      isPrimary: false,
      active: false,
      effectiveFrom: daysAgo(800),
      effectiveTo: daysAgo(91),
      primaryCopayCents: 2000,
      specialistCopayCents: 4000,
      deductibleCents: 100000,
    },
  });

  // Scenario 4 — prescription refill + human escalation.
  const robert = await resetPatient({
    firstName: "Robert",
    lastName: "Chen",
    dateOfBirth: "1958-05-09",
    phone: "+15550100104",
    email: "robert.chen@example.com",
    preferredPharmacy: "CVS Pharmacy, 120 Main St",
    lastVisitAt: daysAgo(120),
    primaryProviderId: "prov_patel",
  });
  await prisma.insurancePlan.create({
    data: {
      patientId: robert.id,
      payer: "Medicare",
      planName: "Medicare Part B",
      memberId: "1EG4TE5MK73",
      effectiveFrom: clinicLocalToUtc(2023, 6, 1, 0),
      primaryCopayCents: 0,
      specialistCopayCents: 0,
      deductibleCents: 25700,
      deductibleMetCents: 25700,
      coinsurancePct: 20,
    },
  });
  await prisma.prescription.createMany({
    data: [
      {
        patientId: robert.id,
        prescriberId: "prov_patel",
        drugName: "Lisinopril",
        strength: "10 mg",
        directions: "One tablet by mouth daily",
        refillsRemaining: 3,
        daysSupply: 30,
        lastFilledAt: daysAgo(27),
      },
      {
        patientId: robert.id,
        prescriberId: "prov_patel",
        drugName: "Atorvastatin",
        strength: "20 mg",
        directions: "One tablet by mouth at bedtime",
        refillsRemaining: 0,
        daysSupply: 90,
        lastFilledAt: daysAgo(84),
      },
      {
        patientId: robert.id,
        prescriberId: "prov_patel",
        drugName: "Lorazepam",
        strength: "0.5 mg",
        directions: "One tablet by mouth as needed for anxiety",
        controlled: true,
        refillsRemaining: 1,
        daysSupply: 30,
        lastFilledAt: daysAgo(25),
      },
    ],
  });

  console.log("Seeded clinic demo data:", {
    clinic: CLINIC.name,
    providers: PROVIDERS.map((p) => p.name),
    patients: [maria, james, priya, robert].map((p) => `${p.firstName} ${p.lastName}`),
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
