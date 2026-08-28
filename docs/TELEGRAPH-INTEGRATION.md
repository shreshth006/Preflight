# Telegraph integration record

Last verified: 2026-08-28 (Asia/Calcutta)

This document records the live Telegraph contract used by PREFLIGHT. The
current public sources are authoritative; older generic examples must not be
used to infer a field that is not listed here.

## Sources consulted

- [Hackathon home](https://hackathon.telegraphprotocol.com/)
- [Hackathon rules](https://hackathon.telegraphprotocol.com/rules)
- [Telegraph Guide](https://guide.telegraphprotocol.com/)
- [Intent catalogue documentation](https://github.com/telegraphprotocol/telegraph-docs/blob/main/using/intents.md)
- [Miner YAML standard](https://github.com/telegraphprotocol/telegraph-docs/blob/main/miners/yaml-config.md)
- [Miner registration](https://github.com/telegraphprotocol/telegraph-docs/blob/main/miners/miner-registration.md)
- [Live addresses and parameters](https://github.com/telegraphprotocol/telegraph-docs/blob/main/protocol/addresses-and-params.md)
- [Official examples](https://github.com/telegraphprotocol/telegraph-examples)
- [Official API specifications](https://github.com/telegraphprotocol/Telegraph-api-docs)
- [Live canonical intents](https://devnode.telegraphprotocol.com/engine/v1/intents)
- [Live miner catalogue](https://devnode.telegraphprotocol.com/api/miners)
- [Explorer](https://explorer.telegraphprotocol.com/miners)

The docs reference a Telegraph node repository at
`https://github.com/0xWick/Telegraph`, but that public repository was not
resolvable during this verification. No private repository or unauthenticated
source was treated as authoritative.

## Hackathon rules relevant to PREFLIGHT

- Track 1 is judged primarily on normalized Miner performance (75%) and
  legitimate public development transparency/engagement (25%).
- An Intent needs at least 3 active Miners and at least 100 real Track-3
  application requests for cash-prize eligibility.
- Applications must use real Telegraph Miners; simulated or mocked data is
  disallowed.
- Miners must remain live and operational throughout Track 3.

The current live intent endpoint returned `SSL_VERIFICATION` with
`canonical: true` and `miner_count: 4` on the verification date. This confirms
the Miner-count guardrail for the target Intent, but does not establish the
Track-3 request count.

### Live refresh on 2026-08-28

The public supported-intents page displayed 40 intents, while the live
devnode endpoint returned 45 canonical intents. This count discrepancy is
recorded rather than resolved by inference. Both sources continued to identify
`SSL_VERIFICATION` as a canonical deterministic Intent, and the live API
returned four active SSL Miners. The live catalogue exposed epoch-289 raw
per-Intent values of approximately `0.010148683`, `0.006346065`,
`0.00448634`, and `0` for the four observed Miners. These values are not
treated as a normalized leaderboard score.

## Current canonical Intent

The live endpoint describes the Intent as:

```text
SSL_VERIFICATION
Query supplies a hostname or domain and asks about its TLS/SSL certificate,
chain or configuration.
```

The public Intent documentation classifies it as **Tier A — Deterministic**
and describes Tier A as WASM exact-match evaluation. The exact WASM module,
its version/hash, and its field-level SSL fixture corpus are not published in
the sources inspected here.

## Miner YAML contract

The current YAML standard requires these root fields:

```yaml
version: '1'
kind: miner
id: <unused integer>
slug: <lowercase-kebab-case>
name: <display name>
base_url: <http or https URL>
```

For PREFLIGHT, the declared shape is intentionally one endpoint and one
Intent:

```yaml
endpoints:
  - path: /ssl-check
    external_path: /ssl-check
    method: GET
semantics:
  signal_mapping:
    confidence_field: confidence
    label_field: verdict
    reason_field: reason
  supported_intents:
    - SSL_VERIFICATION
```

The current standard says that `input_schema` and `output_schema` are
top-level fields, not fields inside an endpoint. It also says endpoint entries
are closed and only accept `path`, `external_path`, `method`, `description`,
`endpoint_base_url`, `content_type`, `multipart_fields`, and `param_map`.

There is a conflict in the public material: the checked-in official example
also contains endpoint-level `intents` and `params`, while the current YAML
field reference explicitly says the endpoint object is closed and rejects
those fields. PREFLIGHT follows the current field reference and omits them.
The config validator script should be run against the current Telegraph node
before any on-chain transaction.

## Observed SSL wire contract

No official SSL-specific request/response schema or public Canonical WASM
module was found. The following is an observed, live compatibility contract,
not a claim about the hidden scorer:

```http
GET /ssl-check?domain=example.com
```

Observed response from the active `livecert` Miner:

```json
{
  "chain_length": 3,
  "domain": "example.com",
  "verdict": "valid",
  "valid": true,
  "chain_complete": true,
  "trusted": true,
  "expired": false,
  "hostname_match": true,
  "issuer": "SSL Corporation",
  "subject": "example.com",
  "subject_alt_names": ["DNS:example.com"],
  "valid_from": "2026-01-01",
  "valid_to": "2026-10-27",
  "days_remaining": 60,
  "tls_protocol": "TLSv1.3",
  "cipher": "TLS_AES_128_GCM_SHA256",
  "key_bits": 256,
  "confidence": 1,
  "reason": "The TLS/SSL certificate configuration for example.com is valid. ...",
  "checked_at": "2026-08-27T22:59:48.654Z"
}
```

Observed active SSL Miners also show these compatible variations:

- `txlens`: `query`, `status`, `summary`, `confidence`, `canonical`,
  `valid`, `authorized`, `authorization_error`, `issuer`, `valid_from`,
  `valid_to`, and `days_until_expiry`.
- `livecert`: `domain`, `verdict`, `valid`, `trusted`, `expired`,
  `hostname_match`, `chain_complete`, certificate details, `confidence`,
  `reason`, and `checked_at`.

PREFLIGHT defaults to the livecert-compatible response because it is the
closest observed live contract for a live TLS handshake. The formatter lives
entirely in `src/telegraph/response.ts`; changing output shape must not change
`src/tls/`.

### PREFLIGHT request aliases

The adapter accepts `domain`, and also accepts `target`, `host`, or `url` as
compatibility aliases when receiving a direct HTTP request. The YAML advertises
only `domain` so the public contract stays deterministic. Full URLs and
explicit ports are supported by the engine; paths and URL fragments are
ignored after parsing the authority.

### PREFLIGHT response policy

- `verdict` is one of the observed deterministic states listed above.
- `valid` is `true` only when reachability, TLS handshake, trust, hostname,
  and certificate time validity all pass.
- Unreachable endpoints return HTTP 200 with `valid: false` and
  `verdict: "unreachable"`; normal negative verification is not an HTTP 500.
- `confidence` is `1` for every well-formed request that receives a
  deterministic classification, including DNS and network failures. This
  matches the observed livecert behavior; it is a confidence in the
  classification, not a claim that an unreachable host has a valid
  certificate.
- `checked_at` is UTC ISO-8601 and is excluded from canonical comparison by
  the adapter's stable fields when a strict fixture comparison is used. It is
  retained for operations/debugging.

The last point is deliberately isolated because timestamps are inherently
non-deterministic. If the official scorer proves that `checked_at` is part of
the canonical output, update only the response formatter and its fixtures.

## Live registration contract

Current public docs specify Base Sepolia:

- Chain ID: `84532`
- Diamond: `0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8`
- Minimum price: `10000` USDC base units (`0.01` USDC)
- YAML hash: SHA-256 of the raw hosted YAML bytes, prefixed with `0x`
- Registration function:
  `registerMiner(string,bytes32,address,uint256,string[])`

The docs show the following operator-controlled command shape:

```bash
cast send "$DIAMOND" \
  "registerMiner(string,bytes32,address,uint256,string[])" \
  "$YAML_URL" "$YAML_HASH" "$FEE_ADDRESS" "$MIN_PRICE" \
  '["SSL_VERIFICATION"]' \
  --rpc-url "$RPC" --private-key "$MINER_PRIVATE_KEY"
```

PREFLIGHT does not execute this command automatically. It requires a wallet,
gas, a hosted YAML URL, and an irreversible on-chain transaction. See
`scripts/register-miner.sh` for a dry-run/print-only helper and
`docs/OPERATIONS.md` for the operator checklist.

## Scoring observations

The live `/api/miners` endpoint exposes per-Intent scores under each miner's
`scores` array, including `intent_id`, `epoch_id`, `rank`, `score`, and
`scored_at`. On 2026-08-27, the endpoint showed four active
`SSL_VERIFICATION` Miners. The displayed raw scores were approximately
`0.0097`, `0.0065`, `0.0050`, and `0` for the observed epoch, which do not
match the Explorer-level `~0.992` figure described in the project brief.
This is evidence that the visible Explorer average and the per-Intent API
score are different quantities or that the current testnet scoring feed is in
a transitional state. PREFLIGHT records only observed values; it fabricates
no score. Update `docs/SCORING-LOG.md` with actual receipts after registration.

## Unknowns kept behind the adapter

1. The exact current SSL Canonical WASM input/output schema and hash.
2. Whether the scorer compares only mapped label/reason fields or the full JSON
   body, and whether timestamps are ignored.
3. The current supported request field name used by the hidden evaluation
   corpus beyond the observed `domain` query parameter.
4. Whether the apparent live score scale is raw local score, error, or an
   Explorer/API presentation mismatch.

These unknowns do not leak into the TLS engine. The only files intended to
change after a receipt experiment are `src/telegraph/request.ts`,
`src/telegraph/response.ts`, the YAML schema, and matching fixtures.

## Publishing a miner change on-chain

`scripts/sync-miner.sh` replaces the web portal and the IPFS pinning step.
Because the registration commits to a SHA-256 of the YAML bytes, the URL it
points at must be immutable; the script pins `raw.githubusercontent.com` to the
exact commit SHA, which costs nothing and needs no pinning service.

```bash
# after changing telegraph/miner.yaml, committing and pushing:
scripts/sync-miner.sh                      # dry run — validates and prints the tx
EXECUTE_ONCHAIN=YES scripts/sync-miner.sh  # submits it
```

It refuses to proceed unless the YAML validates, the commit is published on
`origin/main`, the hosted bytes hash-match the local file, and every declared
intent is canonical on-chain. After submitting it reads `getMiner` back and
polls the node until the manifest reports `active` or `rejected`.

The signing key is read from `$MINER_PRIVATE_KEY` or `$MINER_KEY_FILE`
(default `~/.preflight-miner-key`, mode 600). It is never passed as a command
argument and never logged. The registering wallet owns the slug, so updates
must be signed by the same wallet that holds the active registration recorded
in `telegraph/registration-id`.
