# PREFLIGHT

![PREFLIGHT — trust infrastructure for autonomous agents](docs/assets/preflight-social-preview.png)

Open-source trust infrastructure for autonomous agents. Before an agent
connects to an endpoint, follows a URL, trusts a chain, or acts on an address,
PREFLIGHT checks the target and returns a deterministic, machine-readable
verdict.

PREFLIGHT serves its infrastructure and on-chain signals through Telegraph.

- **Live:** https://preflight-ssl-verification.vercel.app
- **Source:** https://github.com/shreshth006/Preflight
- **Registered:** Base Sepolia, registration `288`, slug `preflight-ssl-verification`

## Try it

```bash
curl 'https://preflight-ssl-verification.vercel.app/ssl-check?domain=example.com'
curl 'https://preflight-ssl-verification.vercel.app/ssl-check?domain=expired.badssl.com'
curl 'https://preflight-ssl-verification.vercel.app/url-scan?url=http://127.0.0.1:22'
```

The first target is accepted, the expired certificate is classified rather
than treated as a server error, and the loopback URL is blocked by the SSRF
guard.

## Intents served

| Intent                 | Endpoint          | What it answers                                                                                                      |
| ---------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `SSL_VERIFICATION`     | `/ssl-check`      | Live TLS verification: DNS, SNI-aware TLS 1.2/1.3 handshake, native chain and hostname verification, validity period |
| `URL_SCAN`             | `/url-scan`       | Safety judgement with redirect chain, security headers, and an explainable risk score                                |
| `GAS_PRICE`            | `/gas-price`      | Current gas with EIP-1559 base fee, priority fee, and the cost of a standard transfer                                |
| `WALLET_BALANCE_CHECK` | `/wallet-balance` | Native balance, nonce, and account type — including EIP-7702 delegated accounts and ENS names                        |
| `ONCHAIN_TX_LOOKUP`    | `/tx-lookup`      | Status and effect of a transaction: block, confirmations, value, gas, fee                                            |
| `TVL_LOOKUP`           | `/tvl`            | Total value locked for a protocol or chain                                                                           |
| `CRYPTO_PRICE`         | `/crypto-price`   | USD spot price by ticker or name, with the observation timestamp                                                     |

Chains: Ethereum, Base, Arbitrum One, OP Mainnet, Polygon PoS, Base Sepolia —
two public RPC endpoints each, so one provider outage cannot take an intent
offline. No endpoint requires an API key.

## Design notes

Every response carries `verdict`, `confidence` and `reason`, so a single
`signal_mapping` covers all seven intents.

**Parameters are matched tolerantly.** The Engine classifies free-text
questions and decides which key a value arrives under, so a hostname, URL,
address, transaction hash or asset is also recovered from a sentence:
`?query=Is the SSL certificate for github.com valid right now?` resolves the
same as `?domain=github.com`. A request we cannot parse is a request we answer
with an error instead of a verdict.

**The reason field is the answer.** Telegraph's canonical scoring module grades
answer text against ground truth, so every verdict path reports the facts it
actually observed — issuer, validity window, chain depth, SAN list, negotiated
protocol — rather than a one-line label.

**Answers state their limits.** A `valid` certificate verdict says it covers
chain trust, hostname and validity period, and that revocation was not checked.
An explicitly named chain we do not serve is rejected rather than silently
answered about Ethereum.

## Running it

```bash
npm ci
npm test
npm run build
npm start

curl 'http://127.0.0.1:3000/ssl-check?domain=example.com'
curl 'http://127.0.0.1:3000/wallet-balance?address=vitalik.eth'
curl 'http://127.0.0.1:3000/gas-price?chain=base'
```

## Commands

- `npm run validate:config` — validate the YAML, including that every declared
  intent maps to an endpoint that exists.
- `npm run benchmark` / `npm run benchmark:json` — maintained TLS corpus.
- `npm run --silent inspect:scoring -- --json` — capture the latest exact question,
  ground truth, converted answer, score, rank, leader, and normalized score for
  every registered intent. Pin a receipt with `-- --epoch=290 --intent=GAS_PRICE`.
- `scripts/sync-miner.sh` — publish the current `miner.yaml` on-chain in one
  step. Dry run unless `EXECUTE_ONCHAIN=YES`. See
  [`docs/TELEGRAPH-INTEGRATION.md`](docs/TELEGRAPH-INTEGRATION.md).
- `scripts/smoke.sh [base-url]` — exercise every intent endpoint against a
  running instance and assert the verdicts. Exits non-zero on any failure, so
  it can gate a deploy. Defaults to production.
- `scripts/verify-registration.sh` / `scripts/inspect-scoring.sh` — inspect a
  registration or produce the same live score snapshot from a shell.

## Documentation

- [`docs/TELEGRAPH-INTEGRATION.md`](docs/TELEGRAPH-INTEGRATION.md) — protocol
  integration and the on-chain publish workflow.
- [`docs/SCORING-LOG.md`](docs/SCORING-LOG.md) — every observed measurement,
  including the network-wide score distribution, the canonical scoring
  formula, and the defects found by production sweeps. Nothing in it is
  estimated.
- [`docs/PUBLIC-UPDATES.md`](docs/PUBLIC-UPDATES.md) — truthful public launch
  and build-in-public drafts.

Track 3 Agent Gateway work is deferred until the miner has been scored.
