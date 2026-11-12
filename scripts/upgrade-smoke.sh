#!/usr/bin/env bash
# Runs the deploy's smoke checks against the staging Worker build, served locally by
# `wrangler dev` with a fresh local D1 database and no cafe data (profile item 8, D277).
# /upgrade runs it before and after an upgrade and compares the two reports.
#
# Usage:  pnpm build:staging && scripts/upgrade-smoke.sh <label>
# Output: upgrade/logs/<label>/{smoke.md,smoke-migrations.log,smoke-worker.log}
# Exit:   0 if every check passed, 1 if a check failed, 2 if the Worker didn't start.
#
# Everything stays local: the migrations go to a throwaway folder (--local --persist-to), and
# the Worker gets throwaway test values for the site URL and the auth secret, which a
# production build requires (like the e2e server, test/e2e/support/global-setup.ts).

set -uo pipefail

LABEL="${1:-smoke}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 2

OUT="upgrade/logs/$LABEL"
mkdir -p "$OUT"
REPORT="$OUT/smoke.md"
CONFIG=".output/server/wrangler.json"
export WRANGLER_SEND_METRICS=false

fail_early() { # $1 = message, $2 = exit code
  printf '# Smoke: %s\n\n%s\n' "$LABEL" "$1" > "$REPORT"
  echo "[smoke] $1"
  exit "$2"
}

[ -f "$CONFIG" ] || fail_early "No Worker build: run \`pnpm build:staging\` first." 2

STATE="$(mktemp -d)"
PORT="$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
BASE="http://127.0.0.1:$PORT"
WORKER_PID=""
cleanup() {
  # wrangler dev runs workerd as a child: stop the whole process group, not only pnpm.
  [ -n "$WORKER_PID" ] && { kill -TERM -- "-$WORKER_PID" 2>/dev/null || kill "$WORKER_PID" 2>/dev/null; }
  rm -rf "$STATE"
}
trap cleanup EXIT

echo "[smoke] local migrations"
if ! pnpm exec wrangler d1 migrations apply DB --local --persist-to "$STATE" --config "$CONFIG" > "$OUT/smoke-migrations.log" 2>&1; then
  fail_early "Local migrations failed: see \`$OUT/smoke-migrations.log\`." 1
fi

echo "[smoke] wrangler dev on $BASE"
set -m # the background job gets its own process group, so cleanup can stop all of it
pnpm exec wrangler dev --config "$CONFIG" --local --persist-to "$STATE" --ip 127.0.0.1 --port "$PORT" \
  --var "NUXT_PUBLIC_SITE_URL:$BASE" \
  --var "NUXT_BETTER_AUTH_SECRET:upgrade-smoke-secret-at-least-32-characters" \
  > "$OUT/smoke-worker.log" 2>&1 &
WORKER_PID=$!
set +m

for _ in $(seq 1 90); do
  curl -s -o /dev/null "$BASE/api/does-not-exist" && break
  sleep 1
done
curl -s -o /dev/null "$BASE/api/does-not-exist" || fail_early "The Worker did not start: see \`$OUT/smoke-worker.log\`." 2

FAILED=0
ROWS=""
row() { # $1 = name, $2 = PASS|FAIL, $3 = detail
  ROWS+="| $1 | $2 | $3 |\n"
  [ "$2" = PASS ] || FAILED=1
  echo "[smoke] $2 $1"
}
status_of() { curl -s -o /dev/null -w '%{http_code}' "$BASE$1"; }
has_header() { curl -s -I "$BASE$1" | grep -qi "^$2:"; }
expect_status() { # $1 = name, $2 = path, $3 = expected code
  local code
  code="$(status_of "$2")"
  if [ "$code" = "$3" ]; then row "$1" PASS "$code"; else row "$1" FAIL "$code, expected $3"; fi
}

# The database answers through the Worker (the deploy's first check).
body="$(curl -s "$BASE/api/health")"
if printf '%s' "$body" | grep -q '"ok"'; then row "GET /api/health is ok" PASS "$body"; else row "GET /api/health is ok" FAIL "$body"; fi

# Security headers on the app shell and the platform pages.
if has_header /sign-in content-security-policy; then row "/sign-in has Content-Security-Policy" PASS "-"; else row "/sign-in has Content-Security-Policy" FAIL "header missing"; fi
if has_header /platform/sign-in strict-transport-security; then row "/platform/sign-in has Strict-Transport-Security" PASS "-"; else row "/platform/sign-in has Strict-Transport-Security" FAIL "header missing"; fi

# The platform's home page renders on the server (same text as the deploy and platform-home.test.ts).
if curl -s "$BASE/" | grep -q 'scan the QR code shared by your cafe'; then row "/ renders the platform home" PASS "-"; else row "/ renders the platform home" FAIL "text not found"; fi

# Routing: addresses from before cafe addresses lead nowhere; an unknown API path is our JSON 404.
expect_status "/admin/login is 404" /admin/login 404
code="$(curl -s -o "$OUT/smoke-404.json" -w '%{http_code}' "$BASE/api/does-not-exist")"
if [ "$code" = 404 ] && grep -q '"NOT_FOUND"' "$OUT/smoke-404.json"; then row "unknown API path is JSON 404" PASS "$code"; else row "unknown API path is JSON 404" FAIL "$code"; fi

# Protected routes refuse without a session; the session endpoint answers.
expect_status "cafe admin API is 401 without a session" /api/c/nuk/admin/me 401
expect_status "platform API is 401 without a session" /api/platform/health 401
expect_status "Better Auth get-session answers" /api/auth/get-session 200

# Nothing above logged a server error.
errors="$(grep -c '"level":"error"' "$OUT/smoke-worker.log" || true)"
if [ "$errors" = 0 ]; then row "no server errors logged" PASS "0"; else row "no server errors logged" FAIL "$errors (see smoke-worker.log)"; fi

{
  echo "# Smoke: $LABEL"
  echo
  echo "- date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- commit: $(git rev-parse --short HEAD 2>/dev/null || echo n/a)"
  echo "- target: staging Worker build under \`wrangler dev --local\`"
  echo
  echo "| Check | Result | Detail |"
  echo "|---|---|---|"
  printf "%b" "$ROWS"
} > "$REPORT"

echo "Smoke: $REPORT"
exit "$FAILED"
