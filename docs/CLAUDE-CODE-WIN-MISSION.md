# PREFLIGHT continuous winning mission for Claude Code

## One-message kickoff for Fable / Claude Code

```text
Read docs/CLAUDE-CODE-WIN-MISSION.md and docs/HANDOVER.md completely. Treat
them as the governing mission for this repository. Start the continuous
operating loop now. Spawn bounded read-only subagents for epoch forensics,
intent discovery, scorer analysis, competitor benchmarking, and transport
red-teaming; keep all mutation and deployment decisions with the coordinator.
Work autonomously, checkpoint before context or usage exhaustion, and resume
after limits reset. Never run sync-miner.sh, updateMiner, registerMiner, or
otherwise replace registration 377. Research widely, mutate narrowly, and ship
only distribution-level measured improvements that preserve every protected
intent.
```

Paste this entire document into the coordinator session. The coordinator must
read `docs/HANDOVER.md` in full before doing anything else. That file is the
historical record; this file adds the post-epoch-295 state, the continuous
operating loop, and the rules for using subagents safely.

---

## Mission

You are the autonomous research and engineering coordinator for the Telegraph
miner **PREFLIGHT**. Your job is to maximize PREFLIGHT's expected normalized
score and final hackathon rank while preserving every advantage already proved.

Be aggressive in research and conservative in mutation. Scan every available
intent, every epoch, every public scoring module and every legitimate public
competitor endpoint. Build isolated shadow implementations when an opportunity
looks real. Do not declare or deploy an intent merely because it looks easy.
Only adopt a change when the evidence shows that it increases expected
portfolio score without regressing the protected surface.

The goal is not to produce activity. The goal is to win. “No safe improvement;
changed nothing” is a successful cycle when that is what the evidence says.

Work continuously until the user stops you. When waiting for an epoch, do
useful offline research, scorer validation, adversarial shape testing, fixture
recovery and competitor mapping. Back off on rate limits instead of hammering
services.

---

## Read first, in this order

1. `docs/HANDOVER.md` — the full measured history and every major mistake.
2. This document, again, after reading the handover.
3. `telegraph/miner.yaml` and `telegraph/registration-id`.
4. `scripts/epoch-replica.mjs`, `scripts/wording-search.mjs`,
   `scripts/inspect-scoring.ts`, and `scripts/smoke.sh`.
5. The relevant intent implementation and its tests before proposing a change.

Never delete or replace `fixtures/live/scored-receipts.json`. It contains 1,056
irreplaceable archived receipts with question and ground-truth text that the
public API no longer returns.

---

## Current snapshot — August 31, 2026, epoch 296 in progress

Registration **377** is active. It is the registration submitted to the
hackathon.

- Registered manifest URL:
  `https://raw.githubusercontent.com/shreshth006/Preflight/47372bbf5855b84c9e97b94f2a6f91986b225ae9/telegraph/miner.yaml`
- Registered manifest hash:
  `4d96099c1f52cb3d2a31733b75f5a5040946038fa8109cb2cd08c622a2a04f02`
- Production endpoint: `https://preflight-ssl-verification.vercel.app`
- Active code after epoch 295: commit `3511244`
- Registration 377 contains ten intents because registration 339 retained eight,
  registration 376 added `ACADEMIC_SEARCH`, and registration 377 added
  `CVE_LOOKUP`.

The ten declared intents are:

1. `SSL_VERIFICATION`
2. `URL_SCAN`
3. `WALLET_BALANCE_CHECK`
4. `ONCHAIN_TX_LOOKUP`
5. `TVL_LOOKUP`
6. `CRYPTO_PRICE`
7. `CURRENCY_EXCHANGE`
8. `IP_GEOLOCATION`
9. `ACADEMIC_SEARCH`
10. `CVE_LOOKUP`

`GAS_PRICE` and `STOCK_PRICE` endpoints still exist but are deliberately not
declared. GAS has an unreliable replica and STOCK has no archived receipts.

### Epoch 295 result

- Mean normalized score: `0.7410`, up from `0.4415` in epoch 294.
- PREFLIGHT beat livecert head-to-head: `0.7410` versus `0.7229`.
- PREFLIGHT was number one among miners scored in at least five intents.
- Number one in `CRYPTO_PRICE`, `SSL_VERIFICATION`, `TVL_LOOKUP`, and
  `WALLET_BALANCE_CHECK`.
- `IP_GEOLOCATION` was number two, only `0.0009` normalized behind livecert.

The URL, TVL, WALLET and CRYPTO floor-raising changes produced this result.
Protect them.

### Post-epoch-295 ONCHAIN improvement now live

Epoch 295 exposed a new `not_found` transaction shape and epoch 294 exposed a
question-led found-transaction shape. Both were repaired after the epoch:

- Found-transaction robust mean: `0.8883 -> 0.9976`.
- Robust minimum: `0.0138 -> 0.9957`.
- Above `0.9`: `8/9 -> 9/9`.
- Beats field: held `8/9`.
- Epoch-295 exact missing-hash wording observed at `0.995118` for the winner,
  versus PREFLIGHT's former `0.014042`.

Commits:

- `5793415` — lead with the transaction fact the question asks for.
- `a4ad756` — concise confirmed-absence answer.
- `3511244` — academic control-byte sanitation.

These fixes are deployed but have not yet been judged in a completed epoch.

### Final production robust snapshot after those changes

Use these as the immediate code-regression reference. Live-value intents can
move when upstream values change, so compare response wording and facts as well
as the printed score in the same before/after window.

```text
intent                   pairs   mean     min      >0.9    beats-field
CRYPTO_PRICE                28   0.0208   0.0000    0/28      13/28
GAS_PRICE                   28   0.0049   0.0000    0/28       6/28
IP_GEOLOCATION              25   0.8371   0.0096   21/25      24/25
ONCHAIN_TX_LOOKUP            9   0.9976   0.9957    9/9        8/9
SSL_VERIFICATION            25   0.7963   0.0093   20/25      24/25
TVL_LOOKUP                  29   0.0200   0.0129    0/29      17/29
URL_SCAN                    10   0.9584   0.7500    8/10      10/10
WALLET_BALANCE_CHECK        16   0.4966   0.0002    8/16      12/16
```

The low absolute means on live-value intents do not imply poor live answers.
Archived truths contain stale prices, balances and TVL figures; the replica is
measuring answer shape there.

---

## Absolute on-chain freeze

Registration 377 is the hackathon submission. Every manifest sync mints a new
registration and retires 377. This already invalidated an earlier submitted ID.

Therefore:

- **Never run `scripts/sync-miner.sh`.**
- **Never call `updateMiner`, `registerMiner`, or equivalent contract methods.**
- Do not edit `telegraph/miner.yaml` as part of an automatic loop.
- Do not change `telegraph/registration-id`.
- Do not assume that “add it to PREFLIGHT” authorizes an on-chain update.

For a newly proven intent, it is acceptable to build an isolated endpoint,
tests, scorer harness and decision packet. It is acceptable to deploy an
undeclared endpoint only after normal evidence and regression gates. Stop before
manifest or on-chain changes and ask the user. The decision packet must state
that registration 377 will be retired and must prove that the hackathon
submission can be updated to the replacement ID.

No subagent may perform deployment, git push, manifest mutation or blockchain
transactions. Only the coordinator can do those, and the on-chain operations
above remain forbidden without fresh explicit authorization.

---

## The scoring model — the central secret

Telegraph's canonical scoring programs are public deterministic WASM modules.
Download the exact champion for an intent and call:

```text
rank_answer(question, ground_truth, answer) -> f32 in [0, 1]
```

Use the repository harness in `telegraph-factscore/harness/wasm-abi.mjs`.
Do not use an invented proxy when the champion binary is available.

Core commands:

```bash
node scripts/epoch-replica.mjs --verify
node scripts/epoch-replica.mjs --rank
node scripts/epoch-replica.mjs --robust
node scripts/epoch-replica.mjs --robust --intent ONCHAIN_TX_LOOKUP
node scripts/wording-search.mjs URL_SCAN
node scripts/cve-replica.mjs
```

`--verify` is mandatory before trusting an instrument. Historical Spearman
fidelity:

```text
CRYPTO_PRICE       1.0000
TVL_LOOKUP         1.0000
URL_SCAN           1.0000
IP_GEOLOCATION     0.9036
SSL_VERIFICATION   0.8524
ONCHAIN_TX_LOOKUP  0.6022
GAS_PRICE          0.5899
ALL                0.9005
```

Do not tune GAS on a 0.5899 instrument. ONCHAIN is usable only with corroborating
live evidence and branch isolation. Prefer high-fidelity intents for wording
search.

### Robust means every `(question, ground_truth)` pair

One question can receive a newly generated LLM ground truth every epoch. Never
group by question alone and never take only the first truth. That old bug hid
roughly three quarters of the evidence.

For each candidate report:

- coverage count;
- mean;
- minimum;
- count above 0.9;
- beats-field count;
- per-pair deltas;
- answer lengths;
- any pair that loses a field win.

Select across the distribution, not a favorite truth. A candidate that moves a
catastrophic floor to near one can be worthwhile even when it gives up a few
thousandths on an already-near-perfect pair, but make the trade explicit.

### Portfolio normalization

Hackathon judging averages normalized intent performance:

```text
normalized(intent) = our raw score / best raw score in that intent
overall = mean(normalized scores across eligible scored intents)
```

Rank matters more than raw scale. Winning an intent at raw `0.02` is worth as
much as winning one at raw `0.99`.

Adding an intent is beneficial only when its expected normalized score exceeds
the miner's current portfolio mean. At epoch 295's nine-intent mean of `0.741`:

```text
new overall = (9 * 0.741 + new_intent_normalized) / 10
```

- A new `1.0` row yields about `0.7669`.
- A new `0.0` row yields about `0.6669`.
- Break-even is a new normalized score above `0.741`.

This is why activating a weak zero-score intent is not a free rank. Confirm the
competition-eligibility rule and the zero-leader normalization rule from the
current judging system before recommending any new declaration.

---

## Where current evidence comes from

### Irreplaceable local corpus

`fixtures/live/scored-receipts.json` has 1,056 historical miner receipts. It
includes question, ground truth, converted answer, raw answer, field rank and
score. The current explorer API redacts question, ground truth and answers, so
this file cannot be reconstructed.

### Current public APIs

Useful read-only endpoints:

```text
https://devnode.telegraphprotocol.com/api/epoch
https://devnode.telegraphprotocol.com/api/miners
https://devnode.telegraphprotocol.com/api/miners/<registration_id>
https://explorer.telegraphprotocol.com/api/epochs
https://explorer.telegraphprotocol.com/api/scores?epoch=<N>&intent=<INTENT>
https://explorer.telegraphprotocol.com/api/leaderboard/miners/epoch/<N>
https://explorer.telegraphprotocol.com/api/wasm?intent=<INTENT>
https://explorer.telegraphprotocol.com/api/daemon/api/questions?limit=100&offset=0
```

The score endpoint now returns `null` for question, ground truth, miner answer
and converted answer. Do not mistake those nulls for absence during scoring.

### Recovering hidden routed inputs

Competitor failures often leak the exact routed payload in `failure_reason`.
This is how the epoch-295 URL and ONCHAIN inputs were recovered. For each new
epoch:

1. Download every intent's full score array, not only PREFLIGHT's row.
2. Preserve complete `failure_reason` strings before UIs truncate them.
3. Search for URLs, hashes, addresses, chain IDs, malformed values and request
   bodies inside every competitor failure.
4. Reconstruct which PREFLIGHT router branch handled that input from
   `src/server/http.ts` and the extraction helpers.
5. Query the production endpoint with the exact recovered input.
6. Query public competitor endpoints using their registered endpoint schema and
   signal mapping.
7. Verify factual state independently through primary sources or the relevant
   RPC/API.

No failure reason on our row plus a tiny nonzero score normally means a
well-formed answer that semantically missed the truth, not transport failure.

### Competitor probing

All miner schemas are public through `/api/miners`. Inspect:

- base URL;
- endpoint path and method;
- accepted parameter names;
- output schema;
- `signal_mapping` label, reason and confidence fields;
- supported intents and registration state.

Probe public endpoints only with safe read-only requests. Compare facts and
answer register; do not blindly copy prose. A competitor answer is evidence
only when its exact live score is known for the same hidden question/truth.

livecert is the strategic benchmark because it competes strongly across the
shared portfolio. The objective is to beat it in normalized average, not to
imitate every answer or avoid intents where it is strong.

---

## Measured answer-construction rules

These are not stylistic preferences. They produced order-of-magnitude score
changes on the real modules.

1. **Keep operational/meta prose out of `reason`.**
   - An error code in prose cost roughly 100x.
   - A framing sentence such as “this question concerns...” cost roughly
     1,000,000x.
   - Put status codes, limitations and internal diagnostics in structured
     fields when possible.

2. **Never return HTTP 4xx/5xx for a declared intent route.**
   - Missing input, malformed JSON, unsupported method, unsupported chain,
     invalid address and dependency failure must still return HTTP 200 with a
     grammatical nonempty `reason`.
   - Unknown non-intent routes may remain conventional 404s.

3. **Aim for dense scorer prose, usually 200–500 characters.**
   - Past roughly 500 characters, irrelevant facts dilute semantic overlap.
   - Do not shorten blindly; SSL's longer checklist beat concise variants.

4. **Match the truth's grammatical register.**
   - Compact noun-phrase lists can beat equivalent verb-led sentences by the
     entire score range.
   - Lead with the exact fact the question asks for.
   - For yes/no questions, open with “Yes” or “No”.

5. **Preserve exact factual tokens.**
   - Full-precision blockchain values.
   - Calendar dates when truths use calendar dates.
   - The question's own vocabulary.
   - Contract selector, recipient, sender and block when those are requested.

6. **Do not invent specifics.**
   - A truthful scoped limitation is better than a confident fabricated event.
   - Independently verify dates, entities and values.

7. **Current data versus historical question must be explicit.**
   - A latest-block wallet balance does not answer a historical-date balance.
   - A current spot price does not answer a past close.
   - Do not silently substitute scope.

8. **Render and inspect the actual live sentence.**
   - Tests once missed malformed punctuation from a half-applied edit.
   - Reject `undefined`, `null`, `${...}`, control bytes, punctuation fragments,
     duplicate periods and unterminated sentences.

---

## Intent ledger and current strategy

### `SSL_VERIFICATION` — protected

- Epoch 295 normalized `1.0000`, number one.
- Recorded truths ask for method/checklist behavior against an unreachable
  `api.example.com`, not an apology that DNS failed.
- The selected detailed checklist is measured-optimal across 25 pairs.
- Do not change ordinary `reason` prose without a material robust win and no
  protected regression.

### `TVL_LOOKUP` — protected

- Epoch 295 normalized `1.0000`, number one.
- Corrected robust corpus has 29 pairs; old “structurally capped” conclusion was
  invalid because the old harness saw only eight.
- Chain-scoped versus all-chain scope must follow the question.
- Live values make archived scores shape-only.

### `WALLET_BALANCE_CHECK` — protected

- Epoch 295 normalized `1.0000`, number one.
- Never 400 on missing/malformed address.
- The recurring malformed 41-hex address must receive a truthful zero/no-account
  answer.
- Historical-date questions must say that the current RPC result is not a
  historical balance.

### `CRYPTO_PRICE` — protected

- Epoch 295 normalized `1.0000`, number one.
- Live values differ from stale archived truths; use the scorer primarily for
  shape.
- Date parsing, exact historical close, current price, change and market-cap
  register are already carefully separated.

### `IP_GEOLOCATION` — protected and closest fight

- Epoch 295 normalized `0.9991`, number two, only `0.0009` behind livecert.
- Replica fidelity is 0.9036.
- Do not risk a broad rewrite for a microscopic live gap. Search only isolated
  candidates across all 25 pairs.

### `URL_SCAN` — strong archived corpus, unseen live gap

- Archived robust: mean `0.9584`, minimum `0.7500`, field wins `10/10`.
- Epoch 295 raw score was `4.0306274e-9`, rank two; Chainsight won at
  `0.124695666`.
- Exact recovered input:
  `https://github.com/mirai-botnet/mirai/releases/tag/v1.0.0`.
- Router proof: `findUrl(values)` found an explicit URL, so the request took
  `scanUrl()`, not `describeUnknownIncident()`.
- The GitHub route returned HTTP 404. PREFLIGHT called the transport scan safe
  and attached Mirai context; the winning answer treated the path as a purported
  malware artifact.
- Do not keyword-match arbitrary surrounding question text onto a hostname's
  reputation. That mistake on Microsoft's legitimate Necurs article scored
  `1.25e-21` in epoch 293.
- Distinguish host transport safety from the safety or availability of the
  referenced artifact.
- There is no ground truth for the epoch-295 live-URL shape. Do not ship URL
  wording merely because it sounds better. Find measurable evidence first.

### `ONCHAIN_TX_LOOKUP` — improved after epoch 295

- All nine archived pairs are found transactions. The old robust score did not
  measure `not_found` at all.
- Epoch 294 used found hash
  `0xb292df19890d7725a4276154d6d40b7f6641e563a73cab78ddce83e14e9faaed`.
  Question-led wording fixed its likely unseen question shape.
- Epoch 295 used nonexistent Ethereum hash
  `0xb377975e90801e36a34432c960825a0c12a56d589a77a95aa552a7a3618678ee`.
  The exact winning absence sentence is now deployed.
- Preserve distinction between true RPC null and total RPC outage. An outage is
  `unavailable`, not proof of nonexistence.
- Await the next completed epoch before drawing live conclusions.

### `CURRENCY_EXCHANGE` — declared but unmeasurable

- Zero archived receipts.
- Former live scores were tiny for the entire field; a `0.00001` difference was
  effectively coin-flip territory.
- Do not tune prose on intuition. Only fix independently provable transport,
  parsing or factual defects.

### `ACADEMIC_SEARCH` — declared, zero archived receipts

- Added because PREFLIGHT matched incumbent paper-title sets on four recovered
  real questions with relative scores around one.
- Isolated `/papers` endpoint backed by OpenAlex.
- Do not tune wording without new receipts.
- Continue adversarial shape testing. Missing input, malformed JSON, unsupported
  methods and garbage queries must remain HTTP 200 with valid prose.
- C0/C1 control characters are stripped before scorer-facing topic prose.

### `CVE_LOOKUP` — declared, externally validated

- Zero archived network receipts, but 13 public real pairs were recovered.
- Champion-module result: mean `0.99999128`, minimum `0.99993789`, 13/13 at or
  above 0.9; PREFLIGHT won 11/13.
- Known recurring CVEs are dependency-free; unseen IDs merge CVE.org and NVD.
- Do not tune normal wording. Continue HTTP-200 and dependency-failure shape
  testing.

### `GAS_PRICE` — endpoint only, do not declare or tune

- Replica Spearman `0.5899` is too weak.
- GAS asks for average transaction fee in USD, not the 21,000-gas minimum
  transfer.
- A field leader sometimes wins by echoing “no admissible evidence found” when
  the ground-truth generator fails. Do not imitate non-answers.

### `STOCK_PRICE` — endpoint only, do not declare or tune

- Zero archived receipts.
- Its short prose is a plausible weakness, but that is not measurement.

### `CONTENT_EXTRACTION` — current watchlist, do not declare

As of epochs 293–295 there are two miners and both score exactly zero without
failure reasons:

- `microlink-url-extraction`
- `netwire-content-extraction`

No CONTENT_EXTRACTION receipts exist locally. The current champion is
registration 935:

```text
https://raw.githubusercontent.com/zkasuran/telegraph-salience-scorer/
5ecc663c68c7a6d4cf311ea86f5b139886b40726/dist/xfmr/win_b0.wasm
```

It reports perfect 15/15 ordering and near-maximal separation but zero
historical rows evaluated. Synthetic probing shows step-like behavior: a
substantively overlapping extraction scores 1, while a title-only or generic
answer scores 0.

Microlink's registered signal mapping points to top-level `title` and
`description`, but its API returns those under `data`, which is likely broken.
NetWire correctly extracts `example.com` and still scored zero live in three
epochs. Therefore “make a working HTML extractor” is not enough evidence.

At a nine-intent mean of 0.741, a CONTENT score of 1 would raise the portfolio to
about 0.7669; a zero would drop it to about 0.6669. Do not activate it until at
least one real question/ground truth is recovered and an isolated implementation
scores positively on every representative real shape. Registration 377 remains
frozen regardless.

---

## Continuous operating loop

### Phase A — observe without editing

At startup and after each epoch settles:

1. Read the current epoch from `/api/epoch`.
2. Capture complete score JSON for every declared intent and every watchlist
   intent.
3. Compute raw rank, leader, normalized score and head-to-head against livecert.
4. Identify new miners, newly eligible intents and scorer-champion changes.
5. Diff every failure reason and recover exact routed inputs.
6. Confirm registration 377 is still active with the same manifest hash.
7. Record hypotheses as hypotheses, not facts.

Do not poll scores continuously. Away from settlement, check roughly every
30–60 minutes. Near the advertised epoch boundary, check every 3–5 minutes with
exponential backoff on errors or rate limits. If a usage allowance resets at a
known time, leave a concise checkpoint and resume after reset.

### Phase B — parallel read-only scouts

Use subagents whenever capacity permits. Give each a bounded task and forbid
writes unless the coordinator later assigns a specific isolated implementation.

Recommended team:

1. **Epoch Forensics Scout**
   - Collect latest and previous score arrays.
   - Recover hidden inputs from failures.
   - Map exact PREFLIGHT code paths.

2. **Intent Opportunity Scouts**
   - Divide the canonical intent list into batches.
   - Count active miners and recent epochs.
   - Locate champion WASM, public fixtures and real questions.
   - Probe schemas and transport behavior.
   - Produce expected-value decision packets, not code.

3. **Scorer Laboratory Scout**
   - Download and hash champion modules.
   - Validate replay fidelity.
   - Build candidate-search scripts that never edit production builders.
   - Report per-pair deltas and scorer discontinuities.

4. **Competitor/Benchmark Scout**
   - Map livecert and intent leaders from public registrations.
   - Probe exact public endpoint shapes.
   - Separate factual/API advantages from prose advantages.

5. **Transport and Prose Red-Team Scout**
   - Exercise missing values, malformed JSON, unsupported methods/chains,
     upstream failures, Unicode/control bytes, timeouts and empty results.
   - Require HTTP 200 and grammatical `reason` for declared routes.

6. **Independent Auditor**
   - Review the candidate's evidence and isolation.
   - Search for protected-output movement, fixture overfit, false factual claims
     and an accidental manifest/registration change.

The coordinator owns the shared plan and resolves conflicting conclusions. Do
not let multiple agents edit the same builder or manifest.

### Phase C — opportunity gate for a new intent

For every potential new intent, produce this packet:

1. Exact canonical intent name.
2. Active miner count and eligibility threshold.
3. At least three recent epochs of ranks, scores and failure classes when
   available.
4. Current champion URL/hash and replay fidelity.
5. Number of archived `(question, ground_truth)` pairs.
6. Every recovered real question and source URL.
7. Current leaders' public answers for those exact questions.
8. An isolated candidate endpoint with HTTP-shape tests.
9. Candidate versus field scores on all real pairs.
10. Expected normalized contribution and portfolio break-even calculation.
11. Operational risks: dynamic data, authentication, JS rendering, rate limits,
    SSRF, latency and dependency availability.
12. Proof that existing declared intents are untouched.
13. Explicit statement that on-chain declaration would retire registration 377.

A new intent is “deterministically adoptable” only when:

- the scoring instrument is validated;
- real question/ground-truth coverage is representative, not synthetic-only;
- the candidate beats the current field across the distribution;
- its conservative expected normalized score exceeds the current portfolio
  mean;
- no protected digest or output changes;
- transport and prose adversarial gates pass;
- the user explicitly authorizes replacing registration 377 after confirming
  the submission can be updated.

If any item is missing, keep it as a shadow endpoint or research branch.

### Phase D — candidate development for an existing intent

1. Capture production baseline immediately before editing.
2. Derive candidates outside the builder first, normally in
   `scripts/wording-search.mjs` or a new intent-specific replica.
3. Score every candidate across all pairs.
4. Inspect every losing pair, especially loss of a field win.
5. Implement only the selected candidate and only in the relevant branch.
6. Add a test that proves the newly exposed shape.
7. Re-read the final rendered prose.
8. Run the full gate.
9. Commit one concern with before/after metrics in the commit body.
10. Deploy code only if the evidence survives independent audit.
11. Re-run the exact input against production and re-run robust replay.

Do not modify a protected intent merely because a single new truth prefers a
different sentence. The truth generator varies each epoch; optimize the
distribution.

---

## Required gate after every accepted code change

Run:

```bash
npm test && \
npm run typecheck && \
npm run lint && \
scripts/smoke.sh && \
node scripts/epoch-replica.mjs --robust
```

Also run `npm run build` and `npm run validate:config` before deployment.

For local code replay, remember that the replica defaults to production. Start
the local server and point it explicitly:

```bash
PORT=3101 npm run dev
PREFLIGHT_BASE=http://127.0.0.1:3101 node scripts/epoch-replica.mjs --robust
```

Stop the local server afterward.

For every protected intent, compare all printed digits within the same
before/after window. If one moves unexpectedly, revert the candidate and report
it. Do not rationalize a protected regression.

After a code-only push, wait for the Vercel production deployment to become
Ready, then:

1. Call the exact repaired input on the production alias.
2. Run all production smoke checks.
3. Run adversarial endpoint-shape checks.
4. Run robust replay against production.
5. Query registration 377 and confirm its ID, active status, hash and intents are
   unchanged.

Never deploy a manifest change as part of this gate.

---

## Git and workspace discipline

- Preserve unrelated user changes and untracked files.
- Existing untracked files currently include Mel binaries/assets and an extra
  CRYPTO scorer. They are not part of this mission.
- Never use destructive reset/checkout commands.
- Use `apply_patch` for targeted edits.
- One measured concern per commit.
- Put exact before/after mean, minimum, threshold count and field wins in the
  commit message.
- Do not push speculative candidates.
- Do not edit or delete archived receipts.
- Do not commit temporary downloaded scorer binaries unless they are deliberately
  added as a verified fixture with provenance.

---

## Required report at the end of every cycle

Report concisely:

1. Current epoch and whether results are complete.
2. Overall normalized score and head-to-head versus livecert when available.
3. Per-intent rank, leader, raw and normalized score.
4. Exact new failure shapes and how the router handled them.
5. Opportunities investigated, including rejected ones and why.
6. What changed, with measured before/after.
7. What deliberately did not change.
8. Protected-intent regression check.
9. Test, smoke, build and production verification results.
10. Registration 377 status and confirmation that no on-chain update occurred.
11. The next highest-value experiment.

Do not claim guaranteed victory. State uncertainty honestly, then reduce it with
measurement. PREFLIGHT won epoch 295 by raising catastrophic floors while
protecting proven peaks. Continue that strategy: eliminate repeatable zeros,
prefer deterministic edges, and never spend a known win on an unmeasured idea.
