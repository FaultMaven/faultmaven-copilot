#!/usr/bin/env bash
# `pnpm audit` of pnpm-lock.yaml for the lockfile-audit action (faultmaven#2159).
#
# It retries only when npm's advisory endpoint is unreachable. Any other exit is
# a finding (advisories) or an error, never retried. It sets the step output
# `result` (clean, advisories, error or unreachable) and writes one job-summary
# block. ON_UNREACHABLE decides whether "unreachable" fails the step: `fail` or
# `warn`.
set -uo pipefail

level=moderate
attempts=4
on_unreachable=${ON_UNREACHABLE:-}
case "$on_unreachable" in
  fail | warn) ;;
  *)
    echo "::error::on-unreachable must be 'fail' or 'warn', got '$on_unreachable'."
    exit 2
    ;;
esac

# finish <result> <exit code> <summary line>...
finish() {
  local result=$1 code=$2
  shift 2
  echo "result=$result" >>"${GITHUB_OUTPUT:-/dev/null}"
  printf '%s\n' "$@" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit "$code"
}

command="pnpm audit --audit-level=$level"
out=''
for i in $(seq 1 "$attempts"); do
  if out="$(pnpm audit --audit-level="$level" 2>&1)"; then
    echo "$out"
    finish clean 0 "### Dependency audit: clean" "" \
      "\`$command\` found no advisory at or above $level outside \`pnpm.auditConfig.ignoreGhsas\`."
  fi
  # The transport errors seen when npm's advisory endpoint is down
  # (faultmaven-website's outage handling, moved here unchanged).
  if printf '%s' "$out" | grep -qiE 'ERR_SOCKET_TIMEOUT|FetchError|socket timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|request to .* failed'; then
    echo "::notice::Attempt $i/$attempts: npm's advisory endpoint is unreachable."
    if [ "$i" -lt "$attempts" ]; then sleep $((i * 20)); fi
    continue
  fi
  echo "$out"
  if printf '%s' "$out" | grep -qE 'vulnerabilit(y|ies) found'; then
    echo "::error::pnpm audit found advisories at or above $level."
    finish advisories 1 "### Dependency audit: advisories found" "" \
      "\`$command\` reported advisories at or above $level; the step log lists them." \
      "Bump or override each one. One with no fixed version goes in \`pnpm.auditConfig.ignoreGhsas\`, with the reason in the PR that adds it."
  fi
  echo "::error::pnpm audit failed without reporting advisories."
  finish error 1 "### Dependency audit: failed" "" \
    "\`$command\` exited non-zero without reporting advisories; the step log says why."
done

echo "$out"
did_not_run=("### Dependency audit: DID NOT RUN" ""
  "npm's advisory endpoint was unreachable after $attempts attempts, so **no audit was performed**. This is not a clean result.")
if [ "$on_unreachable" = warn ]; then
  echo "::warning::npm's advisory endpoint was unreachable after $attempts attempts; this audit did not run."
  finish unreachable 0 "${did_not_run[@]}"
fi
echo "::error::npm's advisory endpoint was unreachable after $attempts attempts; this audit did not run."
finish unreachable 1 "${did_not_run[@]}"
