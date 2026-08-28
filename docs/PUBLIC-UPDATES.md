# PREFLIGHT — Public Update Drafts

Track 1 judging is 75% normalized performance within the intent and **25%
engagement and updates posted on X**, tagging **@Telegraphprotoc**. That 25%
is a quarter of the total score, so these are drafted as work happens rather
than written at the end.

Every claim below must be true at the time it is posted. Nothing here is
posted automatically — no X integration is authorized in this project. Copy a
draft out when the milestone it describes has actually happened.

Status key: `READY` = milestone reached, safe to post. `PENDING` = do not post
until the milestone is real and the numbers are filled in.

---

## 1. Why every SSL miner on Telegraph scores ~0.01 — `READY`

> We read the live Telegraph miner registry before writing a line of miner code.
>
> All 4 SSL_VERIFICATION miners score between 0.0000 and 0.0102 — while
> FACT_CHECK, CVE_LOOKUP and CURRENCY_EXCHANGE miners sit at 0.997–1.000.
>
> Same network, same Tier A "exact match" class. That gap is the whole game.
>
> Building PREFLIGHT to close it. @Telegraphprotoc

## 2. The scoring formula is public, and it rewards text — `READY`

> Telegraph's canonical WASM scoring module is open source, and it is not an
> exact-match diff. It is:
>
> 0.25 × cosine(question, answer)
> 0.50 × cosine(ground_truth, answer)
> 0.15 × BM25(ground_truth, answer)
> 0.10 × sigmoid((len(answer) − 50) / 20)
>
> An SSL miner that answers "certificate expired" is leaving points on the
> floor. @Telegraphprotoc

## 3. A 58-character answer costs you real score — `READY`

> Found this auditing our own miner: PREFLIGHT returned rich text for valid
> certificates and 58-character stubs for failures.
>
> Under the canonical scorer a 58-char answer earns 0.060 on the length term.
> A 150-char one earns 0.099 — and short answers starve the BM25 term too.
>
> We already had the issuer, validity window, chain depth and SAN list. We
> were just throwing them away on the failure paths.
>
> Every verdict now reports the full picture: 341–613 chars, same facts, no
> padding. @Telegraphprotoc

## 4. Benchmark — `READY`

> PREFLIGHT SSL_VERIFICATION, local benchmark:
>
> 18/18 correct — 100% accuracy
> p50 25ms · p95 1,203ms
> Verdicts covered: valid, expired, hostname_mismatch, self_signed,
> untrusted, unreachable
>
> Deterministic DNS, SNI-aware TLS 1.2/1.3 handshake, native chain
> verification, SSRF-guarded outbound. @Telegraphprotoc

## 5. Deployment — `READY`

> PREFLIGHT is live at https://preflight-ssl-verification.vercel.app
>
> /health · /ready · /ssl-check?domain=…
>
> ~315ms end to end. All six verdict paths verified in production: valid,
> expired, hostname_mismatch, self_signed, untrusted, unreachable.
>
> Try it against expired.badssl.com or wrong.host.badssl.com — negative
> certificate paths return the same factual depth as the happy path.
> @Telegraphprotoc

## 6. Registration — `READY`

> PREFLIGHT is registered on Telegraph with seven deterministic
> infrastructure and on-chain intents.
>
> registration id: 288 (Base Sepolia)
> intents: SSL_VERIFICATION, URL_SCAN, GAS_PRICE, WALLET_BALANCE_CHECK,
> ONCHAIN_TX_LOOKUP, TVL_LOOKUP, CRYPTO_PRICE
> live: https://preflight-ssl-verification.vercel.app
> source: https://github.com/shreshth006/Preflight
>
> Every endpoint is exercised by the production smoke gate. @Telegraphprotoc

## 7. First real score — `PENDING` (never post a projected number)

> First canonical evaluation for PREFLIGHT:
>
> epoch <EPOCH> · score <SCORE> · rank <RANK> of <N> in SSL_VERIFICATION
>
> Previous leader: 0.010148683.
>
> <one honest sentence about what the number shows> @Telegraphprotoc

---

## Rules for these posts

- Do not post a score that has not been observed in the Telegraph API.
- Do not describe the miner as "live" or "registered" before it is.
- Do not fabricate engagement, and do not inflate metrics — rule 04 of the
  hackathon rules makes that a disqualifying offence.
- Tag @Telegraphprotoc on every update used for judging.
