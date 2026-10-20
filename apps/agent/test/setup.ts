// TEST_NOW=2026-10-30T20:50:00Z bun test ... runs the suite at a fixed clock,
// to catch time-of-day / weekday / DST dependent behavior.
import { setSystemTime } from "bun:test";
import { useLocalTestDatabase } from "@repo/shared";

useLocalTestDatabase();

if (process.env.TEST_NOW) setSystemTime(new Date(process.env.TEST_NOW));
