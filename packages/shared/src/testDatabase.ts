const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

// Integration tests create and delete rows, so they must never run against the
// production database. Call before anything imports @repo/db: it points
// DATABASE_URL at TEST_DATABASE_URL when set, then refuses any non-local host.
export function useLocalTestDatabase(): void {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (!LOCAL_HOSTS.has(host) && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
    throw new Error(
      `Integration tests write and delete rows; refusing to run against ${host}. ` +
        `Set TEST_DATABASE_URL to the local Postgres (docker compose up -d postgres), or ALLOW_REMOTE_TEST_DB=1 to override.`,
    );
  }
}
