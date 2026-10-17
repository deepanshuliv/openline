#!/bin/sh
# Keeps Postgres bounded: once a day, deletes finished calls (with their events,
# transcript turns and handoffs) older than CALL_RETENTION_DAYS, plus old
# cancelled/completed appointments and refill requests. Runs in postgres:16-alpine.
set -u
DAYS="${CALL_RETENTION_DAYS:-90}"

prune() {
  psql -v ON_ERROR_STOP=1 -v days="$DAYS" -q <<'SQL'
BEGIN;
CREATE TEMP TABLE old_calls ON COMMIT DROP AS
  SELECT id FROM "Call"
  WHERE status <> 'ACTIVE' AND "startedAt" < now() - make_interval(days => :days);
DELETE FROM "CallEvent"      WHERE "callId" IN (SELECT id FROM old_calls);
DELETE FROM "TranscriptTurn" WHERE "callId" IN (SELECT id FROM old_calls);
DELETE FROM "Handoff"        WHERE "callId" IN (SELECT id FROM old_calls);
DELETE FROM "Call"           WHERE id IN (SELECT id FROM old_calls);
DELETE FROM "RefillRequest"  WHERE "createdAt" < now() - make_interval(days => :days);
DELETE FROM "Appointment"    WHERE status <> 'SCHEDULED' AND "endsAt" < now() - make_interval(days => :days);
SELECT 'retention ok: ' || count(*) || ' calls kept, db ' || pg_size_pretty(pg_database_size(current_database())) FROM "Call";
COMMIT;
SQL
}

while true; do
  prune || echo "retention: prune failed (tables may not exist until migrate has run)"
  used=$(df -P / | awk 'NR==2 { gsub("%", "", $5); print $5 }')
  [ "${used:-0}" -gt 80 ] && echo "WARNING: host disk / is ${used}% full"
  sleep 86400
done
