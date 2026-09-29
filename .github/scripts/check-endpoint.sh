#!/usr/bin/env bash
# Check that a production endpoint is healthy; exit non-zero if it is not.
#
#   check-endpoint.sh URL            pass on HTTP 200
#   check-endpoint.sh URL health     pass only on HTTP 200 AND a JSON body with "status":"ok"
#
# Retries absorb a network blip without hiding a real outage: a stalled sync
# keeps /health at 503 for hours, so it fails every attempt. Tunable via
# ATTEMPTS and DELAY (seconds) for local testing.
set -uo pipefail

URL="${1:?usage: check-endpoint.sh URL [health]}"
MODE="${2:-}"
ATTEMPTS="${ATTEMPTS:-3}"
DELAY="${DELAY:-20}"

body="$(mktemp)"
trap 'rm -f "$body"' EXIT
ok=0 code=000 detail=""

for i in $(seq 1 "$ATTEMPTS"); do
  code="$(curl -sS -o "$body" -w '%{http_code}' --max-time 20 "$URL" 2>/dev/null)" || code=000
  if [ "$code" = "200" ]; then
    if [ "$MODE" != "health" ]; then ok=1; break; fi
    status="$(jq -r '.status // empty' "$body" 2>/dev/null)"
    if [ "$status" = "ok" ]; then ok=1; break; fi
  fi
  [ "$i" -lt "$ATTEMPTS" ] && sleep "$DELAY"
done

# /health explains itself ("Last successful sync was N minutes ago"); surface
# that rather than a bare status code, so the alert says what is wrong.
if [ "$MODE" = "health" ]; then
  detail="$(jq -r '.message // empty' "$body" 2>/dev/null)"
fi
[ "$code" = "000" ] && detail="No response (DNS failure, refused connection, or timeout)."

summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; return 0; }

if [ "$ok" = 1 ]; then
  echo "OK  $URL  (HTTP $code)"
  summary "✅ \`$URL\` — HTTP $code"
  [ "$MODE" = "health" ] && { jq -c . "$body" 2>/dev/null; summary '```json' "$(jq . "$body" 2>/dev/null)" '```'; }
  exit 0
fi

msg="$URL returned HTTP $code after $ATTEMPTS attempts.${detail:+ $detail}"
echo "::error title=Production check failed::$msg"
echo "FAIL  $msg"
summary "❌ \`$URL\` — HTTP $code after $ATTEMPTS attempts" "${detail:+> $detail}"
if [ -s "$body" ]; then
  echo "--- response body ---"; head -c 2000 "$body"; echo
fi
exit 1
