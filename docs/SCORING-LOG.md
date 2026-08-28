# PREFLIGHT Scoring Log

Every entry records observed Telegraph data. Nothing here is estimated or
projected. PREFLIGHT is registered and active, but no canonical PREFLIGHT
score has been observed yet; the entries below are baseline observations and
verified deployment/registration events.

## Method

Live miner registry, read directly:

```bash
curl https://devnode.telegraphprotocol.com/api/miners
curl https://devnode.telegraphprotocol.com/api/epochs
```

The Explorer HTML endpoints return HTTP 403 to non-browser clients; the
devnode JSON API is the reliable source and is what these entries use.

## 2026-08-28 — SSL_VERIFICATION baseline (epoch 289)

Per-intent scores for every miner declaring `SSL_VERIFICATION`:

| Rank | Miner                        | Slug                            | SSL score   | Requests | Registered |
| ---- | ---------------------------- | ------------------------------- | ----------- | -------- | ---------- |
| 1    | LiveCert Operational Signals | `livecert`                      | 0.010148683 | 42       | 2026-08-28 |
| 2    | TxLens                       | `txlens`                        | 0.006346065 | —        | 2026-08-28 |
| 3    | SSL Labs Check               | `ssllabs`                       | 0.004486340 | 5        | 2026-08-13 |
| 4    | Cert Spotter                 | `certspotter-cert-verification` | 0.000000000 | 12       | 2026-08-25 |

Scored at 2026-08-28T12:48:38Z, epoch 289.

**Target to take rank 1: beat 0.010148683.**

The Explorer-level `0.992` figure previously associated with SSL competitors
is not the per-intent SSL score. The per-intent canonical scores are the four
values above.

## 2026-08-28 — Network-wide score distribution (epoch 289)

184 score entries across 41 intents. The distribution is strongly bimodal:

- **8 intents** have at least one miner above 0.5 (max 1.0):
  CHAT_COMPLETION, CURRENCY_EXCHANGE, CVE_LOOKUP, FACT_CHECK,
  FRAUD_DETECTION, LANGUAGE_GENERATION, TASK_COMPLETION, TEXT_GENERATION.
- **33 intents** have every miner below 0.07, most below 0.02 —
  SSL_VERIFICATION among them (max 0.0101).

The same miner can sit in both regimes: `tavily` scores 1.0 on FACT_CHECK but
0.0106 / 0.0103 / 0.0119 on NEWS_SEARCH / RESEARCH_QUERY / WEB_SEARCH.
`livecert` scores 0.004–0.010 across all six of its declared intents.

Score is not driven by request volume: `patchsignal-cve` scores 0.997 on
CVE_LOOKUP with only 7 requests served.

## Scoring mechanics (from the published canonical baseline)

`telegraphprotocol/telegraph-wasm-baseline` composes four signals:

```
0.25 * cosine(question,     miner_answer)
0.50 * cosine(ground_truth, miner_answer)
0.15 * bm25(ground_truth,   miner_answer)
0.10 * sigmoid((len(miner_answer) - 50) / 20)
```

An empty or whitespace-only answer short-circuits to exactly 0.

Two consequences drive PREFLIGHT's response design:

1. Answer text length below ~150 characters measurably loses the length
   component: a 58-character answer scores 0.060 on that term versus 0.099
   for a 150-character one, and short answers also starve the BM25 term.
2. Answer text is what is scored, so factual density in the reason field —
   issuer, subject, validity window, chain length, SAN list, negotiated
   protocol — is what the correctness and lexical terms can reward.

Note that each intent has its own Canonical Script, so the baseline above is
not necessarily the exact module scoring SSL_VERIFICATION. It is the
published reference implementation and the only public specification of the
scoring contract.

## Judging context (hackathon rules, read 2026-08-28)

- Track 1 (Miners) runs **Aug 17 – Aug 31**.
- 75% of the Track 1 score is Normalized Performance _within the intent_:
  your average canonical score divided by the highest average in that intent.
  **The best miner in an intent automatically receives full points.**
- 25% is engagement and updates posted on X, tagging @Telegraphprotoc.
- Eligibility guardrail: an intent needs at least 3 active miners and at least
  100 real Track 3 requests. SSL_VERIFICATION currently has 4 miners.

Because normalization is within-intent, the absolute value of the SSL scores
does not matter for the 75-point component. Rank 1 is what matters, and rank 1
currently costs 0.0102.

## 2026-08-28 — PREFLIGHT deployed to production

- Public base URL: `https://preflight-ssl-verification.vercel.app`
- Host: Vercel Hobby (the same platform the current SSL rank-1 miner uses)
- Verified live: `/health` 200, `/ready` 200, `/miner.yaml` 200
- All six verdict paths verified against real hosts: valid, expired,
  hostname_mismatch, self_signed, untrusted, unreachable
- Observed latency on `/ssl-check?domain=example.com`: 0.348s / 0.314s / 0.317s
- Local benchmark: 8/8 correct, p50 190ms, p95 878ms

YAML committed at `20249596d0284378dee6691dbf287b240d1ee1e8`, SHA-256
`43568e6562809c24fb81df7f220394f4336deb9b88041adb68689d3c91398ef3`,
hosted-vs-local hash verified identical before registration.

## 2026-08-28 — PREFLIGHT registered on Telegraph

| Field               | Value                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| Registration ID     | `282`                                                                              |
| Transaction         | `0xf3a301103ebdad9d…0aa907d1`                                                      |
| Network             | Base Sepolia (84532)                                                               |
| Contract            | `0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8`                                       |
| Owner / fee address | `0x5c4B38CF6aDb8c5A30242c3FC9124CE0197D2d52`                                       |
| YAML URL            | `https://gateway.pinata.cloud/ipfs/QmWyAPYsRtUTYvjNUeaV5z8g2zM3Zt6Eurz67KHmovgZT7` |
| YAML hash           | `0x837d3536e53485c95845c714bb492922695f3ac3c378d9314de8a4551444fd83`               |
| intentId            | `0x2d477ac0d0ee8ac9ca1c2b8875817aa819d626807936ab32aca7445436d4ea8f`               |
| Min price           | `10000` (0.01 USDC)                                                                |
| Intents             | `["SSL_VERIFICATION"]`                                                             |

Verified independently rather than trusting the portal:

- `getMiner(282)` on the Diamond returns `active = true` and the values above.
- The on-chain `yamlHash` equals the SHA-256 of the bytes served by the IPFS
  gateway, computed locally.
- Node indexed the registration ~10s after confirmation:
  `activation_status: active`, `rejection_reason: null`, `retrying: false`.
- `/api/miners` lists `preflight-ssl-verification` with
  `base_url: https://preflight-ssl-verification.vercel.app` and the
  `/ssl-check` endpoint.

Note: the portal re-serialized the YAML when pinning (normalized quotes,
reflowed the description, and converted `'null'` type strings in
`output_schema` to real nulls). The pinned copy is semantically equivalent on
every routing-relevant field; the on-chain hash commits to the pinned bytes,
so hash verification is self-consistent.

SSL_VERIFICATION field at registration time (epoch 289): livecert 0.010148683
(rank 1), txlens 0.006346065 (rank 2), ssllabs 0.00448634 (rank 3),
certspotter 0 (rank 4), preflight not yet scored.

## 2026-08-28 — Why the whole SSL field sits near 0.01

Read from `/daemon/api/questions` (50 most recent, all `status: success`):

- Questions are generated by news collectors (`collector-hackernews`,
  `collector-gdelt`) and carry categories PHARMA, TECHNOLOGY, AI, FINANCE,
  GEOPOLITICS.
- Routing went to `Telegraph Groq LPU Miner` (38), `Telegraph Knowledge
Chatbot` (5), `Community Memory` (4), `ItsAI Text Detector` (3).
- **No SSL_VERIFICATION questions appeared in the sample.**

This matches the network-wide split recorded above: the eight intents with
miners above 0.5 are the ones this news-derived traffic actually lands on.
The other 33, SSL_VERIFICATION among them, see very little evaluated traffic.

An arithmetic consistency check on the leader: the canonical composite awards
`0.10 * sigmoid((len - 50) / 20)` for length alone, so any non-empty answer of
~150+ characters scores at least ~0.099. livecert served 42 requests and
scored 0.010148683 — close to `0.099 x 10%`. That is consistent with a miner
whose answers are counted successful roughly one time in ten, and it points at
**response success rate**, not answer text quality, as the dominant term.

Acted on this by making request parsing tolerant (commit "Accept probe
requests whose hostname arrives in any shape"). The Engine routes free-text
daemon questions through an LLM router, so the key a hostname arrives under is
the router's choice, not ours. Previously anything outside
`domain|target|host|url` produced HTTP 400 — an error body rather than a
verdict. Extraction now covers 21 keys, searches nested objects and unknown
parameter names, and pulls a hostname, IPv4 or URL out of a sentence.

Verified in production after deploy:

| Request                                                           | Result                          |
| ----------------------------------------------------------------- | ------------------------------- |
| `?domain=example.com`                                             | `valid`, SSL Corporation        |
| `?query=Is the SSL certificate for github.com valid right now?`   | `github.com`, `valid`, Sectigo  |
| `?website=cloudflare.com`                                         | `cloudflare.com`, `valid`       |
| POST `{"question":"check whether expired.badssl.com is expired"}` | `expired.badssl.com`, `expired` |

This is a robustness change, not a scoring trick: each case above returns the
correct verdict for the host actually named in the request.

## 2026-08-28 — Expanded to six intents

Prizes go to the highest **total** normalised score across intents, and the
best miner in each intent receives full points regardless of absolute score.
Intents were therefore ranked by (miners >= 3, for prize eligibility) against
current leaderboard maximum:

| Intent                 | Miners | Max score | Served by         |
| ---------------------- | ------ | --------- | ----------------- |
| `URL_SCAN`             | 7      | 0.000000  | `/url-scan`       |
| `GAS_PRICE`            | 6      | 0.000000  | `/gas-price`      |
| `WALLET_BALANCE_CHECK` | 6      | 0.000129  | `/wallet-balance` |
| `ONCHAIN_TX_LOOKUP`    | 10     | 0.014475  | `/tx-lookup`      |
| `TVL_LOOKUP`           | 7      | 0.017023  | `/tvl`            |

None requires an API key: the on-chain intents read public JSON-RPC across
Ethereum, Base, Arbitrum, OP Mainnet and Polygon (two endpoints per chain),
URL_SCAN reuses the existing TLS engine, and TVL_LOOKUP mirrors DefiLlama.

All five confirmed canonical on-chain via `isCanonicalIntent`, so the update
transaction cannot revert on an unrecognised intent.

Verified live in production after deploy:

| Endpoint                              | Result                          | reason length |
| ------------------------------------- | ------------------------------- | ------------- |
| `/ssl-check?domain=example.com`       | `valid`, SSL Corporation        | 429           |
| `/url-scan?url=https://github.com`    | `safe`, risk 0, HTTP 200        | 325           |
| `/gas-price?chain=base`               | 0.006 gwei, `low`               | 349           |
| `/wallet-balance?address=0xd8dA…6045` | 6.64217816 ETH, `delegated_eoa` | 422           |
| `/tx-lookup?hash=0xaaa…`              | `not_found`                     | 334           |
| `/tvl?protocol=lido`                  | Lido, $23.52 billion            | 321           |

Every reason clears the ~150-character point at which the canonical length
term saturates.

Two correctness findings worth recording:

- `eth_getCode` returns `0xef0100 || address` for EIP-7702 delegated
  accounts. Both the operator wallet and `vitalik.eth` return it, so treating
  any non-empty code as contract bytecode misclassifies ordinary smart-account
  wallets. `account_type` now distinguishes `eoa`, `delegated_eoa` (with the
  delegate address) and `contract`.
- URL_SCAN originally reported `expired.badssl.com` as `unreachable`, because
  `fetch()` refuses an invalid certificate. A completed TLS handshake now
  counts as reachable, so the certificate failure surfaces as a `suspicious`
  verdict instead of being masked.

## Epoch cadence (measured, not documented)

`/api/epochs` over the last 100 epochs: median gap between consecutive epochs
is **1.00 hour**, range 0.08–23.5h, with epochs 282–289 running roughly every
9 hours. The "Epoch duration: 24 hours" figure in the protocol docs is the
genesis parameter, not this devnet's observed cadence. Scoring rounds arrive
far more often than daily.

## 2026-08-28 — Six intents live on-chain (registration 284)

`updateMiner` does not mutate a registration in place: it retires the old id
and issues a new one. Transaction
`0xe7cc1e71f5b194b2f0778385fcec0abe6edfb21d7e2789043b3b58696a490479`
(status 0x1) retired **282** and created **284**, which the receipt's
`MinerRegistered` log carries as topic 1. `getMiner(282)` now returns
`active = false`; `getMiner(284)` returns `active = true` with all six intents
and the GitHub-pinned YAML URL at commit `ee9e826`.

The node indexed it about 110 seconds later: `activation_status: active`,
`rejection_reason: null`, all six intents listed.

The registration id is therefore state rather than a constant, and is stored in
`telegraph/registration-id` so the next sync targets the live registration.

## 2026-08-29 — Seventh intent, ENS, and scan budget (registration 285)

Read the official router descriptions from `/engine/v1/intents`, which state
in the protocol's own words what each intent is classified on. Two acted on:

- `WALLET_BALANCE_CHECK` — "names a specific blockchain address **or ENS
  name**". PREFLIGHT accepted only 0x-prefixed addresses, so every ENS-phrased
  question returned HTTP 400. Added EIP-137 namehash (verified against the
  published vector for `eth`) with registry/resolver lookup over public
  mainnet RPC. `vitalik.eth` resolves to `0xd8da6bf2…96045`, `nick.eth` to
  `0xb8c2c29e…67d5`, and an unregistered name to null.
- `CRYPTO_PRICE` — 10 miners, so prize-eligible, leaderboard maximum 0.0637.
  Served keylessly from DefiLlama's coins feed.

Rejected as expansion targets, with reasons: `CURRENCY_EXCHANGE` (leader at
1.0), `CVE_LOOKUP` (leader at 0.997), `IP_GEOLOCATION` (2 miners, below the
3-miner prize threshold), `TOKEN_HOLDER_COUNT` (needs a paid indexer).

Also bounded URL_SCAN by a single 18s budget. Six redirect hops at the per-hop
timeout could exceed the 30s serverless limit, and a function that times out
answers nothing at all — the worst possible outcome for a scored miner.

`updateMiner` rotated the registration again: **284 → 285**, now active with
all seven intents. The rotation is why the id is stored in
`telegraph/registration-id` rather than hardcoded.

Live in production, every reason clearing the length threshold:

| Endpoint                              | Result              | reason length |
| ------------------------------------- | ------------------- | ------------- |
| `/crypto-price?asset=BTC`             | BTC $77,507.68      | 355           |
| `/wallet-balance?address=vitalik.eth` | resolved, funded    | 437           |
| `/url-scan?url=https://github.com`    | safe, not truncated | 325           |

## 2026-08-29 — Production correctness sweep (registration 286)

Ran every endpoint against real hosts and adversarial inputs rather than
trusting unit tests. Confirmed correct: `incomplete-chain.badssl.com` ->
untrusted, IDN `münchen.de` -> valid, IP literal `1.1.1.1` -> valid (Cloudflare
genuinely holds a certificate for it), `localhost` and `127.0.0.1` blocked by
the SSRF guard, uppercase / trailing-dot / explicit-port / full-URL inputs all
normalising to the same verdict, Polygon reporting POL rather than ETH, the
zero address showing its real 14,149 ETH balance, USDC classified as a
contract, and malformed addresses and hashes rejected as INVALID_INPUT.

Two genuine defects surfaced, both fixed:

1. **Any unrecognised chain silently resolved to Ethereum.** "Gas price on
   Avalanche" returned Ethereum's gas price labelled as Ethereum — confidently
   answering a question that was never asked, which scores worse against
   ground truth than declining. An explicitly named chain must now be one we
   serve; a chain named only in passing in free text stays advisory; a question
   naming none still defaults to Ethereum.

2. **`revoked.badssl.com` reported as `valid`.** We check chain trust,
   hostname and validity period, but not OCSP or CRL, and a revoked
   certificate still presents a well-formed, in-date, trusted chain. Rather
   than implement a partial revocation check under time pressure, the valid
   verdict now states exactly what it covers. Full OCSP remains open work.

Separately, `rate_limit_per_sec` was 5 — copied from the documentation's
example. The node treats it as the ceiling on what it will send upstream, and
its default backstop for a miner declaring nothing is 10/s, so the value was
capping our own traffic below the default. Raised to 25/s, with the circuit
breaker tolerating a short burst of upstream blips (8) and reclosing faster
(15s).

Registration rotated 285 -> 286. On-chain hash
`0x7d710a5b7330fe7819c411227f57f95284270d9afd32648d57839eeeaaa8cdb9` equals
the local file byte-for-byte.

## PREFLIGHT entries

_No canonical PREFLIGHT scores have been observed yet. The active registration
is recorded in `telegraph/registration-id`. Future entries will include the
timestamp, epoch, miner ID, intent, score, rank, request count, and deployed
response version._
