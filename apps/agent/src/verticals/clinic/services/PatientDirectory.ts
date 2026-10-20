import { prisma } from "@repo/db";

const normalize = (s: string) => s.trim().toLowerCase().replace(/[^a-z]/g, "");

export class PatientDirectory {
  // Identity check used before disclosing or changing anything: date of birth
  // and last name must match exactly (ignoring case, spaces and punctuation, so
  // "OBrien Smith" matches "O'Brien-Smith"); the first name may be a nickname
  // prefix of at least two letters ("Rob" for "Robert").
  async verify(input: { firstName: string; lastName: string; dateOfBirth: string }) {
    const dob = parseIsoDate(input.dateOfBirth);
    if (!dob) return null;

    const candidates = await prisma.patient.findMany({ where: { dateOfBirth: dob }, include: { primaryProvider: true } });
    const first = normalize(input.firstName);
    const last = normalize(input.lastName);
    if (!first || !last) return null;
    return (
      candidates.find((p) => {
        if (normalize(p.lastName) !== last) return false;
        const known = normalize(p.firstName);
        if (known === first) return true;
        return Math.min(known.length, first.length) >= 2 && (known.startsWith(first) || first.startsWith(known));
      }) ?? null
    );
  }

  // Whether a caller with no record can be registered from these details.
  canRegister(input: { firstName: string; lastName: string; dateOfBirth: string }): boolean {
    const dob = parseIsoDate(input.dateOfBirth);
    return !!dob && dob <= new Date() && normalize(input.firstName).length >= 2 && !!normalize(input.lastName);
  }

  // A caller with no record on file becomes a new patient when they book.
  // Returns null when the name or birth date isn't usable.
  async register(input: { firstName: string; lastName: string; dateOfBirth: string }) {
    const dob = parseIsoDate(input.dateOfBirth);
    if (!dob || !this.canRegister(input)) return null;
    return prisma.patient.create({
      data: { firstName: titleCase(input.firstName), lastName: titleCase(input.lastName), dateOfBirth: dob },
      include: { primaryProvider: true },
    });
  }
}

const titleCase = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase());

// Strict YYYY-MM-DD: rejects dates that don't exist (1985-02-30 would
// otherwise roll over to March 2).
function parseIsoDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3]) ? date : null;
}
