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
  "tx-lookup|hash=${TX}&chain=base-sepolia|success"
  "tvl|protocol=aave|protocol"
  "crypto-price|asset=BTC|found"
  "fx-rate|pair=USD to EUR|found"
  "ip-geolocation|ip=8.8.8.8|found"
  "ip-geolocation|ip=192.168.1.1|not_found"
  "stock-price|symbol=AAPL|found"
)

failures=0
printf '%-14s %-46s %-9s %-18s %6s %8s\n' ENDPOINT QUERY HTTP VERDICT LEN TIME
for case in "${CASES[@]}"; do
  IFS='|' read -r path query expected <<<"$case"
  url="$BASE/$path"
  [[ -n "$query" ]] && url="$url?$query"
  body="$(mktemp)"
  read -r code time < <(curl -s -m 45 -o "$body" -w '%{http_code} %{time_total}' "$url")
  read -r verdict len < <(
    python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("PARSE_FAIL 0"); raise SystemExit
print(d.get("verdict") or d.get("status") or "-", len(d.get("reason", "")))
' "$body"
  )
  rm -f "$body"
  bad=""
  [[ "$code" != 200 ]] && bad="  <-- HTTP $code"
  [[ -n "$expected" && "$verdict" != "$expected" ]] && bad="  <-- expected $expected"
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
