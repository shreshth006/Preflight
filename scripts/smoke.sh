#!/usr/bin/env bash
# Exercise every intent endpoint against a running PREFLIGHT and report the
# verdict, reason length and latency for each.
#
#   scripts/smoke.sh                       # production
#   scripts/smoke.sh http://localhost:3000 # a local build
#
# Exits non-zero if any endpoint fails, so it can gate a deploy.
set -uo pipefail

BASE="${1:-https://preflight-ssl-verification.vercel.app}"
TX="${SMOKE_TX:-0x29004626ff77201e565c5297043a1fc49b29fc63fa5605ef78d1f307c5029a7b}"

# path|query|what the verdict should be, empty when it varies with live data
CASES=(
  "health||"
  "ready||"
  "ssl-check|domain=example.com|valid"
  "ssl-check|domain=expired.badssl.com|expired"
  "ssl-check|domain=wrong.host.badssl.com|hostname_mismatch"
  "ssl-check|domain=self-signed.badssl.com|self_signed"
  "url-scan|url=https://github.com|safe"
  "url-scan|url=http://127.0.0.1:22|malicious"
  "gas-price|chain=base|"
  "gas-price|chain=ethereum|"
  "wallet-balance|address=vitalik.eth|funded"
  "wallet-balance|address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&chain=ethereum|empty"
  # Epoch 292 regressions: both used to return HTTP 400, which guarantees that
  # the scorer receives no prose at all.
  "wallet-balance|chain=base&question=What%20is%20the%20current%20native%20coin%20balance%20of%20wallet%20address%20on%20the%20Base%20chain%3F|not_found"
  "wallet-balance|chain=base&question=What%20is%20the%20balance%20of%20%25%5B0x1234567890abcdef1234567890abcdef123456789%5D%25%20on%20Base%3F|empty"
  "tx-lookup|hash=${TX}&chain=base-sepolia|success"
  "tvl|protocol=aave|protocol"
  "crypto-price|asset=BTC|found"
  "fx-rate|pair=USD%20to%20EUR|found"
  "ip-geolocation|ip=8.8.8.8|found"
  "ip-geolocation|ip=192.168.1.1|not_found"
  "stock-price|symbol=AAPL|found"
  "papers|topic=zero%20knowledge%20proofs|found"
)

failures=0
printf '%-14s %-46s %-9s %-18s %6s %8s\n' ENDPOINT QUERY HTTP VERDICT LEN TIME
for case in "${CASES[@]}"; do
  IFS='|' read -r path query expected <<<"$case"
  url="$BASE/$path"
  [[ -n "$query" ]] && url="$url?$query"
  body="$(mktemp)"
  read -r code time < <(curl -s -m 45 -o "$body" -w '%{http_code} %{time_total}' "$url")
  read -r verdict len prose < <(
    python3 -c '
import json, re, sys

# Well-formedness of the answer prose, not just of the response.
#
# A half-applied edit once shipped "... across its price sources., a 24-hour
# price increase ..." -- a comma after a full stop, and a missing one before
# the following clause -- and every check here passed it, because the gate
# looked at status codes and verdicts and never at the sentence. The prose is
# the thing the network actually scores, so it is checked too.
def defects(text):
    found = []
    # A template that did not render, or a value that reached the prose as a
    # JavaScript primitive rather than as a fact.
    for token in ("${", "undefined", "NaN", "[object Object]", "null,", " null ", "Infinity"):
        if token in text:
            found.append("template:" + token.strip())
    if re.search(r"\.\s*,", text):
        found.append("comma-after-period")
    if re.search(r",\s*\.", text):
        found.append("period-after-comma")
    if ",," in text or re.search(r"(?<!\.)\.\.(?!\.)", text):
        found.append("doubled-punctuation")
    if re.search(r"\s[.,;]", text):
        found.append("space-before-punctuation")
    if "  " in text:
        found.append("double-space")
    if not text.rstrip().endswith((".", "!", "?")):
        found.append("unterminated")
    if text[:1].islower():
        found.append("lowercase-start")
    return found

try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("PARSE_FAIL 0 -"); raise SystemExit

reason = d.get("reason") or ""
verdict = d.get("verdict") or d.get("status") or "-"
# health and ready carry no prose and are not required to.
issues = defects(reason) if reason else []
print(verdict, len(reason), ",".join(issues) or "-")
' "$body"
  )
  rm -f "$body"
  bad=""
  [[ "$code" != 200 ]] && bad="  <-- HTTP $code"
  [[ -n "$expected" && "$verdict" != "$expected" ]] && bad="  <-- expected $expected"
  [[ "$prose" != "-" ]] && bad="$bad  <-- prose: $prose"
  [[ -n "$bad" ]] && failures=$((failures + 1))
  printf '%-14s %-46s %-9s %-18s %6s %8s%s\n' \
    "$path" "${query:0:46}" "$code" "$verdict" "$len" "$time" "$bad"
done

echo
if [[ "$failures" -eq 0 ]]; then
  echo "all ${#CASES[@]} checks passed against $BASE"
else
  echo "$failures of ${#CASES[@]} checks FAILED against $BASE" >&2
fi
exit $((failures > 0))
