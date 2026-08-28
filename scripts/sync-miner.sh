#!/usr/bin/env bash
# Publish the current miner.yaml on-chain in one step.
#
# The registration commits to a SHA-256 of the YAML bytes, so the URL it points
# at must be immutable: a mutable URL whose content changes under a committed
# hash fails node verification. This uses raw.githubusercontent.com pinned to
# the exact commit SHA, which is immutable, free, and needs no IPFS pinning
# service or web portal.
#
# Usage:
#   scripts/sync-miner.sh                 # dry run: validate, verify, print tx
#   EXECUTE_ONCHAIN=YES scripts/sync-miner.sh
#
# Key: read from $MINER_PRIVATE_KEY, or from $MINER_KEY_FILE (default
# ~/.preflight-miner-key). Never passed on the command line, never logged.
set -euo pipefail

REPO="${REPO:-shreshth006/Preflight}"
DIAMOND="${DIAMOND:-0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8}"
RPC="${RPC:-https://sepolia.base.org}"
YAML_FILE="${YAML_FILE:-telegraph/miner.yaml}"
FEE_ADDRESS="${FEE_ADDRESS:-0x5c4B38CF6aDb8c5A30242c3FC9124CE0197D2d52}"
MIN_PRICE="${MIN_PRICE:-10000}"
# updateMiner retires the old registration and issues a new id, so the current
# id is state, not a constant. It is read from and written back to this file.
REGISTRATION_FILE="${REGISTRATION_FILE:-telegraph/registration-id}"
REGISTRATION_ID="${REGISTRATION_ID:-$(cat "$REGISTRATION_FILE" 2>/dev/null || true)}"
NODE_API="${NODE_API:-https://devnode.telegraphprotocol.com}"
MINER_KEY_FILE="${MINER_KEY_FILE:-$HOME/.preflight-miner-key}"

export PATH="$HOME/.foundry/bin:$PATH"
command -v cast >/dev/null || { echo "cast (Foundry) is required: https://getfoundry.sh" >&2; exit 1; }

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step "Validating YAML"
npm run --silent validate:config

step "Checking the working tree is committed and pushed"
if [[ -n "$(git status --porcelain "$YAML_FILE")" ]]; then
  echo "$YAML_FILE has uncommitted changes. Commit and push before syncing." >&2
  exit 1
fi
# ls-remote rather than fetch: a broken unrelated ref in the repository aborts
# a fetch, and all this needs to know is the SHA origin/main points at.
SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git ls-remote origin main | awk '{print $1}')"
if [[ "$SHA" != "$REMOTE_SHA" ]]; then
  echo "HEAD is not what origin/main points at. Push before syncing, or the URL will 404." >&2
  echo "  local:  $SHA" >&2
  echo "  origin: ${REMOTE_SHA:-<unreachable>}" >&2
  exit 1
fi

YAML_URL="https://raw.githubusercontent.com/$REPO/$SHA/$YAML_FILE"
LOCAL_HASH="$(sha256sum "$YAML_FILE" | awk '{print $1}')"

step "Verifying the hosted YAML matches these exact bytes"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
for attempt in 1 2 3 4 5; do
  code="$(curl -sL -m 20 -o "$TMP" -w '%{http_code}' "$YAML_URL" || true)"
  [[ "$code" == 200 ]] && break
  echo "  attempt $attempt: HTTP $code, retrying (GitHub raw can lag a push)"
  sleep 4
done
[[ "$code" == 200 ]] || { echo "hosted YAML unreachable: HTTP $code at $YAML_URL" >&2; exit 1; }
REMOTE_HASH="$(sha256sum "$TMP" | awk '{print $1}')"
if [[ "$LOCAL_HASH" != "$REMOTE_HASH" ]]; then
  echo "hash mismatch — refusing to register content that differs from the hosted file" >&2
  echo "  local:  $LOCAL_HASH" >&2
  echo "  hosted: $REMOTE_HASH" >&2
  exit 1
fi
echo "  ✅ $LOCAL_HASH"

step "Reading declared intents"
INTENTS_JSON="$(python3 - "$YAML_FILE" <<'PY'
import json, sys, yaml
d = yaml.safe_load(open(sys.argv[1]))
print(json.dumps(d["semantics"]["supported_intents"], separators=(",", ":")))
PY
)"
echo "  $INTENTS_JSON"

step "Confirming every intent is canonical on-chain"
python3 -c "import json;print('\n'.join(json.loads('''$INTENTS_JSON''')))" | while read -r intent; do
  ok="$(cast call "$DIAMOND" "isCanonicalIntent(string)(bool)" "$intent" --rpc-url "$RPC" | tail -1)"
  printf '  %-24s %s\n' "$intent" "$ok"
  [[ "$ok" == true ]] || { echo "intent $intent is not canonical — the transaction would revert" >&2; exit 1; }
done

if [[ -n "$REGISTRATION_ID" ]]; then
  FN='updateMiner(uint256,string,bytes32,address,uint256,string[])'
  ARGS=("$REGISTRATION_ID" "$YAML_URL" "0x$LOCAL_HASH" "$FEE_ADDRESS" "$MIN_PRICE" "$INTENTS_JSON")
else
  FN='registerMiner(string,bytes32,address,uint256,string[])'
  ARGS=("$YAML_URL" "0x$LOCAL_HASH" "$FEE_ADDRESS" "$MIN_PRICE" "$INTENTS_JSON")
fi

step "Transaction"
cat <<SUMMARY
  network        Base Sepolia (84532)
  contract       $DIAMOND
  function       ${FN%%(*}
  registration   ${REGISTRATION_ID:-<new>}
  yaml url       $YAML_URL
  yaml hash      0x$LOCAL_HASH
  fee address    $FEE_ADDRESS
  min price      $MIN_PRICE (0.01 USDC)
  intents        $INTENTS_JSON
SUMMARY

if [[ "${EXECUTE_ONCHAIN:-NO}" != YES ]]; then
  echo
  echo "Dry run. Set EXECUTE_ONCHAIN=YES to submit."
  exit 0
fi

if [[ -z "${MINER_PRIVATE_KEY:-}" ]]; then
  [[ -f "$MINER_KEY_FILE" ]] || { echo "no key: set MINER_PRIVATE_KEY or create $MINER_KEY_FILE (chmod 600)" >&2; exit 1; }
  MINER_PRIVATE_KEY="$(tr -d '[:space:]' < "$MINER_KEY_FILE")"
fi

SENDER="$(cast wallet address --private-key "$MINER_PRIVATE_KEY")"
BALANCE="$(cast balance "$SENDER" --rpc-url "$RPC")"
echo "  sender         $SENDER"
echo "  balance        $(cast from-wei "$BALANCE") ETH"
[[ "$BALANCE" != "0" ]] || { echo "sender has no gas on Base Sepolia" >&2; exit 1; }

step "Submitting"
RECEIPT="$(mktemp)"
cast send "$DIAMOND" "$FN" "${ARGS[@]}" \
  --rpc-url "$RPC" --private-key "$MINER_PRIVATE_KEY" --json > "$RECEIPT"
python3 -c "import json;d=json.load(open('$RECEIPT'));print('  tx',d.get('transactionHash'),'status',d.get('status'))"
python3 -c "
import json,sys
d=json.load(open('$RECEIPT'))
if d.get('status') not in ('0x1', 1): sys.exit('transaction reverted')
"

# MinerRegistered(registrationId indexed, miner indexed, ...) — emitted by both
# registerMiner and updateMiner, and the only place the new id appears.
NEW_ID="$(python3 -c "
import json
TOPIC='0x7305b0d0f2fed40b03fb6b42dfaa5d50920aa0312578b5ed482f1072942823a4'
d=json.load(open('$RECEIPT'))
for log in d.get('logs', []):
    t=log.get('topics') or []
    if t and t[0].lower()==TOPIC:
        print(int(t[1],16)); break
")"
rm -f "$RECEIPT"
if [[ -n "$NEW_ID" && "$NEW_ID" != "$REGISTRATION_ID" ]]; then
  echo "  registration $REGISTRATION_ID retired, now $NEW_ID"
  REGISTRATION_ID="$NEW_ID"
  printf '%s\n' "$NEW_ID" > "$REGISTRATION_FILE"
  echo "  wrote $REGISTRATION_FILE — commit it so the next sync targets the right registration"
fi

step "Verifying on-chain state"
# The RPC can lag its own receipt by a second or two, returning an empty
# record for a registration that was just created.
for attempt in 1 2 3 4 5 6; do
  STATE="$(cast call "$DIAMOND" \
    "getMiner(uint256)(address,string,bytes32,bool,bytes32,address,uint256,string[])" \
    "${REGISTRATION_ID:-0}" --rpc-url "$RPC" 2>/dev/null || true)"
  [[ "$(printf '%s' "$STATE" | sed -n '4p')" == true ]] && break
  echo "  attempt $attempt: not visible yet"
  sleep 3
done
printf '%s\n' "$STATE" | head -8

step "Waiting for the node to reload the manifest"
for i in $(seq 1 24); do
  body="$(curl -s -m 15 -A 'preflight-sync' "$NODE_API/api/miners/${REGISTRATION_ID}" || true)"
  status="$(printf '%s' "$body" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin); m=d.get('miner',d)
    print(m.get('activation_status'), '|', ','.join(m.get('supported_intents') or []), '|', m.get('rejection_reason'))
except Exception: print('pending')
" 2>/dev/null || echo pending)"
  echo "  [$((i*5))s] $status"
  case "$status" in
    active*) echo "  ✅ live"; break ;;
    rejected*) echo "  ❌ rejected — fix the YAML and re-run" >&2; exit 1 ;;
  esac
  sleep 5
done
