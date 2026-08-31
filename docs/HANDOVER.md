# PREFLIGHT — what we learned, and how to keep winning

Written for whoever picks this up next. Everything here is measured, not
theorised. Where a number appears, it came from running the real scorer.

---

## 1. The one thing that matters most

**The Telegraph scoring function is public, deterministic, and runnable
offline.** Everything else in this document follows from that.

Each intent has a champion scoring module. That `.wasm` is the exact binary the
node runs to score your answer. It is downloadable. Given
`rank_answer(question, ground_truth, answer)` it returns the same number every
time.

So you never have to guess, and you never have to wait nine hours for an epoch.

```bash
node scripts/epoch-replica.mjs --verify    # prove the replica matches the node
node scripts/epoch-replica.mjs --rank      # score live answers vs rivals
node scripts/epoch-replica.mjs --robust    # score across ALL recorded truths
```

**Verify before you trust.** `--verify` replays 472 recorded answers through the
module that scored them and reports Spearman against the node's real numbers:

```
CRYPTO_PRICE 1.0000   TVL_LOOKUP 1.0000   URL_SCAN 1.0000
IP_GEOLOCATION 0.9036   SSL 0.8524   ONCHAIN 0.6022   GAS_PRICE 0.5899
ALL 0.9005
```

Anything below ~0.6 is an unreliable instrument. **Do not tune on it.** Tuning
GAS_PRICE on a 0.59 replica is how registration 1760 was wasted.

---

## 2. Optimise the distribution, not one sample

The daemon **regenerates the ground truth with an LLM every epoch**, so its
shape varies even when the question repeats verbatim. Tuning against the most
recent recorded truth overfits to one draw.

Proof that nobody holds a high score: `chainsight-oracle` on consecutive epochs
scored 0.996 → 0.008 → 0.998 → 0.006. Same miner, same intent.

So always measure with `--robust`, which scores against **every** recorded
question-and-truth pair, and select on **mean** and **beats-field**, never on
the best case.

Worked example — SSL wording selection on the corrected 25-pair corpus:

```
                          mean     >0.9     beats field
chosen wording           0.7963   20/25        24/25
check-list variant       0.7175   18/25        24/25
concise variant          0.4813   12/25        21/25
first sentence only      0.1285    3/25        22/25
```

Shorter was not better here. The full answer retained more truth shapes and
more field wins, so it stayed unchanged.

---

## 3. What actually scores (all measured)

### 3.1 Operational and meta text is catastrophic

The single biggest lever found. Not "slightly worse" — orders of magnitude.

```
DNS_FAILURE in the prose                     0.9941 → 0.0097    (100x)
"This question concerns X, and names no
 live URL to scan, so the answer below..."   1.0000 → 0.000001  (1,000,000x)
```

Error codes, status enums, framing sentences, "the data shows that this is a
lookup of…" — all poison. **Keep them in structured fields; keep them out of
`reason`.**

### 3.2 Comprehensiveness loses

```
739-char SUNBURST account   0.0207
245-char account            0.3806
477-char, 3 dense sentences 1.0000
```

Past roughly 500 characters an answer dilutes. Match the ground truth's length,
which is typically 200–500 chars.

### 3.3 Grammatical shape matters as much as facts

Identical facts, identical numbers, only the sentence structure differing:

```
"...$105.19 USD, a 24-hour price increase of 2.43%,
   a market capitalization of $61.43 billion"          0.0476
"...$105.19 USD. Over the last 24 hours it has risen
   by 2.43%. Its market capitalization is..."          0.0000
```

Ground truths use **noun-phrase lists**. Verb-led separate sentences score zero.

### 3.4 Never return an HTTP error

A 400 is correct as an API and wrong as a miner: the node scores the prose it
receives, and a status code gives it none.

Epoch 292, WALLET_BALANCE_CHECK was asked _"What is the current native coin
balance of wallet address on the Base chain?"_ — a question naming no address.
We returned 400 and scored 0. So did `chainwire`. The miner that simply
answered took the intent with 0.0019.

Every intent path now returns 200 with prose for missing input, garbage query
input, malformed JSON, unsupported methods, unsupported chains and dependency
failures. The 10-endpoint integration matrix covers these branches. Unknown
non-intent routes still return the conventional 404.

Same class of bug: a malformed address. The recurring question carries
`%[0x1234567890abcdef1234567890abcdef123456789]%` — 41 hex chars where an
address has 40. Answer it (`balance is 0, no account exists at it`) rather than
rejecting it.

### 3.5 Answer the question that was asked

- GAS_PRICE asks for the _average transaction fee in USD_. A 21,000-gas
  transfer is the **cheapest possible** transaction, not the average of recent
  blocks.
- ONCHAIN questions are often yes/no. The truth opens _"Yes, both the sender
  and recipient are 0x…"_. Lead with the answer, not the transaction hash —
  **no truth ever repeats the hash**.
- SSL questions target `api.example.com`, which never resolves. The truths
  answer as **method**: _"use openssl or curl, here are the steps and the
  issues to look for."_ Give the methodology, not an apology.
- URL_SCAN is a **knowledge** intent — "what is documented about X" — not a
  live scanner. See `src/intents/threatIntel.ts`.
- Use the exact figures and date formats the truths use: full-precision values
  (`2.177510433277432266`), calendar dates ("August 29, 2026") not ISO.

---

## 4. The tooling, and what is irreplaceable

```
fixtures/live/scored-receipts.json   1,056 receipts: question, ground truth,
                                     every miner's answer and score.
                                     THE API NO LONGER SERVES THIS TEXT.
                                     It cannot be recollected. Do not delete.
fixtures/champions/*.wasm            the 10 scoring binaries
scripts/epoch-replica.mjs            --verify | --rank | --robust
scripts/predict-score.ts             TF-IDF proxy; weaker, superseded
scripts/smoke.sh                     23 production checks + prose defects
scripts/inspect-scoring.sh           live epoch standings
scripts/sync-miner.sh                on-chain manifest publish (pre-authorized)
```

`smoke.sh` checks prose well-formedness (unrendered `${}`, `undefined`, comma
after period, unterminated sentences) because a half-applied edit once shipped
`"...price sources., a 24-hour price increase"` and all earlier checks passed
it before prose validation was added.

---

## 5. Track 2 (scoring modules)

Two sequential gates against the incumbent champion:

1. **Ordering** — rank the good answer above the bad one on at least as many
   of ~15 hidden fixtures as the champion
2. **Separation** — average margin must _exceed_ the champion's, not tie

The rejection message names which gate failed and gives both numbers. That is
your only view into the hidden fixtures — read it carefully.

**The registry hash is keccak256, not SHA-256.** Proven: the keccak of an
artefact matched the node's `got=` digest byte for byte. Submitting SHA-256
causes a "hash mismatch" rejection and wastes a transaction. Register once,
with keccak.

```bash
cast send <DIAMOND> "registerWasm(bytes32,string,string)(uint256)" \
  <KECCAK> <IMMUTABLE_URL> <INTENT> --rpc-url https://sepolia.base.org
```

Host at a commit-pinned `raw.githubusercontent.com` URL — it must be immutable.
Keep the module small; a 24 MB module was rejected for exceeding the 600s gate
budget, a 24 KB one runs in ~10s.

**What won TEXT_AUTHENTICITY_CHECK (reg 1832):** ordering tied 14–14, margin
0.6651 vs 0.6586. You do not need to out-order the champion — you need to tie
ordering and beat separation.

**What failed repeatedly on IP_GEOLOCATION:** the small module scored
separation 0.9278 against a 0.9250 bar but ordered 14/15 against 15/15. Every
attempt to fix ordering by adding machinery destroyed the separation we already
had (0.308, 0.312, 0.519, 0.610, 0.859, 0.888, 0.894). The lesson: **when you
already pass one gate, do not spend it to pass the other.**

---

## 6. Mistakes made — do not repeat

1. **Trusting an unvalidated proxy.** A TF-IDF harness predicted 42/47 → 46/47.
   The real gate said ordering was unchanged and separation had dropped 0.066.
   One wasted registration. Validate the instrument first, always.
2. **Adding genuinely useful information.** Parent-domain wildcard evidence for
   an unreachable host is real and useful, and it scored 0.005464 against
   0.006498 without it. Useful to a human is not the same as scoring.
3. **Measuring one question instead of all of them.** "Leading 7 of 8" became
   "mean 0.2299, beats field 2 of 9" once measured properly.
4. **Scoring live prices against stale truths.** For CRYPTO/GAS/TVL/WALLET the
   figure necessarily differs from a truth generated weeks ago, so the offline
   harness measures **shape only**. Chainsight's own answer drops 0.098 → 0.045
   under that treatment.
5. **Half-applied edits.** Always re-read the file after a scripted edit and
   check the rendered output, not just that it compiles.
6. **Grouping robust replay by question alone.** One question can have multiple
   regenerated truths. The old harness silently scored only the first. Robust
   replay is now keyed by `(question, ground_truth)`.
7. **Inventing replay parameters.** The old TVL replica forced Ethereum onto
   all-chain questions; URL replay likewise synthesized a live URL from a bare
   incident hostname. Reconstruct only what the question and router actually
   supply.

---

## 7. State at handover (epoch 292)

```
CRYPTO PRICE       #1     0.055      SSL VERIFICATION  #1   0.0090
URL SCAN           #1     0.353      CURRENCY EXCHANGE #2   0.000048
STOCK PRICE        #2     0.319      TVL LOOKUP        #2   0.017
ONCHAIN TX LOOKUP  #5     0.0088     IP GEOLOCATION    #4   0.000  (transport)
GAS PRICE          #7     0.000      WALLET BALANCE    #7   0.000  (transport)

3rd overall on the miner leaderboard. Registration 308, 10 intents.
Track 2: champion of TEXT_AUTHENTICITY_CHECK (reg 1832).

Superseded on August 30, 2026: registration 339, 8 intents. GAS_PRICE and
STOCK_PRICE were withdrawn from `supported_intents` because neither can be
measured offline -- no archived receipts exist for STOCK_PRICE, and GAS_PRICE
beats the field on only 6 of 28 pairs. Both endpoints still serve.
```

Fresh corrected-corpus robust snapshot on August 30, 2026:

```
intent                   pairs   mean     min      >0.9    beats-field
CRYPTO_PRICE                28   0.0412   0.0000    0/28      14/28
GAS_PRICE                   28   0.0049   0.0000    0/28       6/28
IP_GEOLOCATION              25   0.8371   0.0096   21/25      24/25
ONCHAIN_TX_LOOKUP            9   0.8883   0.0138    8/9        8/9
SSL_VERIFICATION            25   0.7963   0.0093   20/25      24/25
TVL_LOOKUP                  29   0.0202   0.0068    0/29      17/29
URL_SCAN                    10   0.7698   0.0000    6/10       9/10
WALLET_BALANCE_CHECK        16   0.2488   0.0001    4/16       9/16
CURRENCY_EXCHANGE            0   —        —         —          —
STOCK_PRICE                  0   —        —         —          —
```

After the four floor-raising changes (`4559c1a`, `f8a500d`, `9d177a0`,
`b420d25`), replayed against the deployed production build on August 30, 2026:

```
intent                   pairs   mean     min      >0.9    beats-field
CRYPTO_PRICE                28   0.0441   0.0000    0/28      18/28
GAS_PRICE                   28   0.0049   0.0000    0/28       6/28
IP_GEOLOCATION              25   0.8371   0.0096   21/25      24/25
ONCHAIN_TX_LOOKUP            9   0.8883   0.0138    8/9        8/9
SSL_VERIFICATION            25   0.7963   0.0093   20/25      24/25
TVL_LOOKUP                  29   0.0211   0.0129    0/29      17/29
URL_SCAN                    10   0.9584   0.7500    8/10      10/10
WALLET_BALANCE_CHECK        16   0.4966   0.0002    8/16      12/16
```

Four intents improved; the four that were already strong are unchanged to
every printed digit, which is the isolation proof. The gains are in the
minimum rather than the peak -- URL_SCAN's floor moves off zero, wallet's
mean doubles -- because judging normalises against the leader per intent, so
a zero costs more than a peak earns.

The last two have no archived question/ground-truth receipts and therefore
cannot be tuned offline. The epoch standings above are observable, but no
robust before/after can be produced for their wording.

Judging is **the average of normalized performance across intents**, per the
maintainers. Normalized is score ÷ leader, so **rank matters and absolute score
does not**: winning an intent where everyone scores 0.02 is worth exactly as
much as winning one where everyone scores 0.99. Do not drop a low-scoring
intent you are winning.

---

## 8. Open problems

- **Transport failures.** Epoch 292 lost GAS_PRICE and IP_GEOLOCATION to
  `dial tcp: lookup …vercel.app: i/o timeout` on the node's side, while the
  endpoint served in 0.44s with 2ms DNS. A third of the surface scored zero for
  reasons unrelated to answers. Maintainers are aware.
- **TVL_LOOKUP is not proven structurally capped.** The earlier conclusion used
  both broken replay grouping and a forced Ethereum scope. On the corrected 29
  pairs, the baseline is mean 0.0202 and 17/29 field wins. The best final-pass
  wording reached 0.0211 but stayed at 17/29, so it failed the two-metric gate
  and was rejected. Re-test future candidates; do not repeat the capped claim.
- **GAS_PRICE** is led by a miner that answers _"no admissible evidence found"_
  and scores ~1.0 whenever the truth generator also fails. Deliberately not
  imitated — it returns nothing to real users.
- **Fresh truth shapes.** The replica measures recorded shapes. Epoch 292's
  ONCHAIN truth fell outside all of them and the whole field scored ~0.01. This
  is irreducible while truths are generated.
- **No offline evidence for CURRENCY_EXCHANGE or STOCK_PRICE.** Both have zero
  archived truth pairs. Do not tune their prose unless new ground truths become
  available; only fix defects independently provable from HTTP or factual
  behavior.

---

## 9. Final preflight state (registration 376)

Registration **376** became active on August 30, 2026 with the eight protected
intents above plus `ACADEMIC_SEARCH`. Transaction:
`0x790a38893240cb41dab7f0be8bf99443e27c8a00b7bf824c1f25dbcfdcbdd05d`.
The registered manifest hash and the production `/miner.yaml` hash are both
`75256b90de4e7813fdd19e48118b8793e2c3a02debb6f561fea797f19c7a8f9d`.

`ACADEMIC_SEARCH` was the only new intent that cleared the evidence bar. The
incumbent won all three epochs in which it appeared. PREFLIGHT's independently
implemented OpenAlex endpoint returned the exact same paper-title sets on four
recovered real questions (10/10, 10/10, 5/5 and 10/10), and its score divided
by the incumbent's score was 1.001153, 1.000344, 0.998814 and 0.997138. There
is no archived ACADEMIC_SEARCH receipt corpus, so these are matchup probes, not
a claimed robust mean.

The endpoint is isolated at `/papers`; none of the existing answer builders
changed. Full robust replay immediately before registration reproduced the
protected results above (latest CRYPTO_PRICE mean 0.0442, still 18/28), and the
post-deploy production gate passed all 22 checks. Do not issue another manifest
sync merely to tidy metadata: registration 376 is active with all nine intended
canonical intents and no rejection reason.

---

## 10. CVE edge and registration 377

On August 31, 2026, `CVE_LOOKUP` was added as a tenth declared intent without
removing or changing any of registration 376's nine intents. The endpoint is
isolated at `/cve`; its known recurring cases are dependency-free and unseen
identifiers merge live CVE.org and NVD records.

This was not an intuition-driven addition. The exact current champion scorer
(`a3bc2a00c45ce8e1c09acfa4eb8ff96e4e78cbbafefeac2f9571416dcc9cfb48`)
was run across all 13 public real CVE question/ground-truth pairs. The deployed
PREFLIGHT answer scored mean **0.99999128**, minimum **0.99993789**, and
13/13 at or above 0.9. The current PatchSignal response scored mean
**0.38436101** and 5/13 at or above 0.9; PREFLIGHT won 11 pairs and lost two
by microscopic margins. Reproduce this with `node scripts/cve-replica.mjs`.

Commit `47372bb` passed 137 tests, typecheck, lint, build, config validation,
all 23 local smoke checks, all 23 production smoke checks, and the production
CVE replica. The production and on-chain manifest hash is
`4d96099c1f52cb3d2a31733b75f5a5040946038fa8109cb2cd08c622a2a04f02`.
Transaction
`0xefc9bb4833ff735e309fa8935881f0596fd9bf5e889ffcc5f3b3a96d9121ff32`
retired registration 376 and created **registration 377** with all ten intents.

At 01:02 IST, Base Sepolia returned registration 377 as active with the exact
immutable YAML URL, hash, fee address, and ten-intent list. The Telegraph dev
node API was simultaneously timing out for every tested endpoint (`HTTP 000`),
so node-side activation could not yet be observed. This is not a rejection.
**Do not submit another on-chain update.** First query
`https://devnode.telegraphprotocol.com/api/miners/377` when the service
recovers. The sync script now exits nonzero if the node never reports active,
instead of silently succeeding after its two-minute polling bound.

## 11. 2026-08-31 autopilot run — see `docs/AUTOPILOT-REPORT-2026-08-31.md`

Measured record of the six-hour autopilot (Fable orchestrator, Opus workers) and the
continuous Track 2 program that followed. Headlines: epoch 296 settled at PREFLIGHT
0.8244 (#1 among ≥5-intent miners); epoch 297 first look 0.6266 (#3; field-wide CVE
zero and ONCHAIN plateau; URL_SCAN still 0.000 under the new prose — input not
recovered); commit `6d3819e` (URL_SCAN verdict-first prose, archived path untouched)
and `017d5f5` (deterministic champion loading, `CHAMPIONS_DIR`); registration 377
unchanged throughout. Track 2: every synth-perfect candidate lost ground on
independently written corpora — treat the held-out rule in that report as binding.
Only TEXT_AUTHENTICITY_CHECK v9 was recommended for registration at the time of writing.
