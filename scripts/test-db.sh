#!/usr/bin/env bash
# Throwaway Postgres for the database integration tests (row-level security, persistence,
# user isolation). Starts a private cluster on a socket in a temp dir, loads the Supabase
# basics stand-in, applies EVERY migration in order, runs the opt-in Jest integration tests
# against it, then deletes the cluster. Needs Postgres server binaries (initdb / pg_ctl).
#   npm run test:db
set -euo pipefail
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "Postgres server binaries not found (set PGBIN)"; exit 2; }
DIR="$(mktemp -d)"; PORT="${PG_TEST_PORT:-5499}"
cleanup() { "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
RUNAS=(); [ "$(id -u)" = "0" ] && { chown -R postgres "$DIR" 2>/dev/null || useradd -M postgres 2>/dev/null; chown -R postgres "$DIR"; RUNAS=(runuser -u postgres --); }
"${RUNAS[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-k $DIR -p $PORT -c listen_addresses=''" -l "$DIR/log" start >/dev/null
URL="postgres://postgres@/postgres?host=$DIR&port=$PORT"
export PGOPTIONS='-c client_min_messages=warning'
psql "$URL" -X -q -v ON_ERROR_STOP=1 -f supabase/tests/supabase-basics.sql >/dev/null
for f in supabase/migrations/*.sql; do psql "$URL" -X -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { echo "migration failed: $f"; exit 1; }; done
echo "applied $(ls supabase/migrations/*.sql | wc -l) migrations"
PG_TEST_URL="$URL" npx jest --runInBand --testPathPattern 'integration' "$@"
