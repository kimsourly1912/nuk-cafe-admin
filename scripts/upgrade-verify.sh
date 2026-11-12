#!/usr/bin/env bash
# Runs typecheck / lint / test:unit / build (and e2e with --e2e) and saves each log
# separately, so the model reads only SUMMARY.md and the failing lines.
#
# Usage: scripts/upgrade-verify.sh <label> [--e2e]    e.g. baseline | S3 | final
#   --e2e  also run the e2e project after build (milestones only): one worker, 4 GB heap (as CI, D147).
# Output: upgrade/logs/<label>/{SUMMARY.md,typecheck.log,lint.log,test-unit.log,build.log[,e2e.log]}
# Exit:   0 if every check that ran passed, 1 otherwise.

set -uo pipefail

LABEL="${1:-run}"
E2E=0
[ "${2:-}" = "--e2e" ] && E2E=1
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 2

OUT="upgrade/logs/$LABEL"
rm -rf "$OUT"
mkdir -p "$OUT"

# ---- package manager (from lockfile) -------------------------------------
if   [ -f pnpm-lock.yaml ];                    then PM="pnpm"
elif [ -f bun.lock ] || [ -f bun.lockb ];      then PM="bun"
elif [ -f yarn.lock ];                         then PM="yarn"
else                                                PM="npm"
fi

run_script() { # $1 = package.json script name
  case "$PM" in
    npm) echo "npm run --silent $1" ;;
    *)   echo "$PM run $1" ;;
  esac
}

exec_bin() { # $@ = binary + args, run through the project's package manager
  case "$PM" in
    pnpm) echo "pnpm exec $*" ;;
    bun)  echo "bunx $*" ;;
    yarn) echo "yarn $*" ;;
    npm)  echo "npx --no-install $*" ;;
  esac
}

has_script() { # $1 = script name
  node -e "const s=require('./package.json').scripts||{};process.exit(s[process.argv[1]]?0:1)" "$1" 2>/dev/null
}

has_bin() { [ -x "node_modules/.bin/$1" ]; }

# ---- resolve the command for each check ----------------------------------
# Order of preference: project script → known tool → skip.
resolve() { # $1 = check name
  case "$1" in
    typecheck)
      if   has_script typecheck;  then run_script typecheck
      elif has_script type-check; then run_script type-check
      elif has_bin nuxi;          then exec_bin nuxi typecheck
      fi ;;
    lint)
      if   has_script lint;       then run_script lint
      elif has_bin eslint;        then exec_bin eslint .
      fi ;;
    test-unit)
      if   has_script test:unit;  then run_script test:unit
      fi ;;
    e2e)
      if   has_script test:e2e;   then echo "NODE_OPTIONS=--max-old-space-size=4096 $(run_script test:e2e) --maxWorkers=1"
      fi ;;
    build)
      if   has_script build;      then run_script build
      elif has_bin nuxi;          then exec_bin nuxi build
      fi ;;
  esac
}

CHECKS=(typecheck lint test-unit build)
[ "$E2E" -eq 1 ] && CHECKS+=(e2e)
FAILED=0
ROWS=""

export CI=1 NUXT_TELEMETRY_DISABLED=1 FORCE_COLOR=0 NO_COLOR=1

for check in "${CHECKS[@]}"; do
  cmd="$(resolve "$check")"
  log="$OUT/$check.log"

  if [ -z "$cmd" ]; then
    echo "skipped: no script or tool found" > "$log"
    ROWS+="| $check | SKIP | - | - | no script or tool found |\n"
    echo "[$check] SKIP"
    continue
  fi

  echo "[$check] $cmd"
  start=$(date +%s)
  bash -c "$cmd" > "$log" 2>&1
  code=$?
  secs=$(( $(date +%s) - start ))

  # count error-looking lines to make baseline comparison quick
  errs=$(grep -Eic '(^|[^a-z])(error|failed|✖|×)([^a-z]|$)' "$log" || true)

  if [ "$code" -eq 0 ]; then
    ROWS+="| $check | PASS | ${secs}s | $errs | \`$cmd\` |\n"
    echo "[$check] PASS (${secs}s)"
  else
    FAILED=1
    ROWS+="| $check | FAIL (exit $code) | ${secs}s | $errs | \`$cmd\` |\n"
    echo "[$check] FAIL (exit $code, ${secs}s) → $log"
  fi
done

{
  echo "# Verify: $LABEL"
  echo
  echo "- date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- commit: $(git rev-parse --short HEAD 2>/dev/null || echo n/a)"
  echo "- package manager: $PM"
  echo "- node: $(node -v 2>/dev/null || echo n/a)"
  echo
  echo "| Check | Result | Time | Error-like lines | Command |"
  echo "|---|---|---|---|---|"
  printf "%b" "$ROWS"
  echo
  if [ "$FAILED" -eq 1 ]; then
    echo "## First error lines per failing check"
    for check in "${CHECKS[@]}"; do
      log="$OUT/$check.log"
      if grep -q '| '"$check"' | FAIL' <(printf "%b" "$ROWS"); then
        echo
        echo "### $check"
        echo '```'
        grep -Ei -m 20 '(error|failed|✖|×)' "$log" || tail -n 20 "$log"
        echo '```'
      fi
    done
  fi
} > "$OUT/SUMMARY.md"

echo "Summary: $OUT/SUMMARY.md"
exit "$FAILED"
