/**
 * Compare scorer-facing wording without editing or deploying an intent.
 *
 * The live endpoint is fetched once per recorded question. Candidate prose is
 * then derived from the same structured response, so every variant carries
 * identical facts and is scored against every recorded question/truth pair.
 *
 *   node scripts/wording-search.mjs TVL_LOOKUP
 *   node scripts/wording-search.mjs CRYPTO_PRICE
 *   node scripts/wording-search.mjs WALLET_BALANCE_CHECK
 *   node scripts/wording-search.mjs URL_SCAN
 *   node scripts/wording-search.mjs IP_GEOLOCATION
 *   node scripts/wording-search.mjs SSL_VERIFICATION
 */

import { readFileSync } from 'node:fs';
import { loadScorer } from '../../telegraph-factscore/harness/wasm-abi.mjs';

const BASE = process.env.PREFLIGHT_BASE ?? 'https://preflight-ssl-verification.vercel.app';
const RECEIPTS = 'fixtures/live/scored-receipts.json';
const intent = process.argv[2];

const MODULES = {
  GAS_PRICE: 'fixtures/champions/GAS_PRICE_reg1535.wasm',
  ONCHAIN_TX_LOOKUP: 'fixtures/champions/ONCHAIN_TX_LOOKUP_reg642.wasm',
  URL_SCAN: 'fixtures/champions/URL_SCAN_reg220.wasm',
  IP_GEOLOCATION: 'fixtures/champions/IP_GEOLOCATION_reg630.wasm',
  SSL_VERIFICATION: 'fixtures/champions/SSL_VERIFICATION_reg631.wasm',
  TVL_LOOKUP: 'fixtures/champions/TVL_LOOKUP_reg49.wasm',
  CRYPTO_PRICE: 'fixtures/champions/CRYPTO_PRICE_reg222.wasm',
  WALLET_BALANCE_CHECK: 'fixtures/champions/WALLET_BALANCE_CHECK_reg1066.wasm',
};

if (!(intent in MODULES)) {
  throw new Error(`usage: node scripts/wording-search.mjs ${Object.keys(MODULES).join('|')}`);
}

const title = (value) =>
  value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

const namedChainFrom = (question) =>
  /\b(arbitrum|base|optimism|polygon|sepolia|ethereum)\b/i.exec(question)?.[1]?.toLowerCase() ??
  null;
const requestedChainFrom = (question) =>
  /\b(arbitrum|base|bitcoin|optimism|polygon|sepolia|solana|ethereum)\b/i
    .exec(question)?.[1]
    ?.toLowerCase() ?? null;
const addressFrom = (question) => /\b0x[0-9a-f]{40}\b/i.exec(question)?.[0] ?? '';
const malformedAddressFrom = (question) => /\b0x[0-9a-f]{41,}\b/i.exec(question)?.[0] ?? '';
const protocolFrom = (question) => /\b(aave\s*v?\d*)\b/i.exec(question)?.[1] ?? 'Aave V3';
const hostFrom = (question) => /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i.exec(question)?.[1] ?? null;
const urlFrom = (question) => /https?:\/\/\S+/i.exec(question)?.[0] ?? null;
const ipFrom = (question) => /\b(?:\d{1,3}\.){3}\d{1,3}\b/.exec(question)?.[0] ?? '';

function endpoint(question) {
  if (intent === 'GAS_PRICE') {
    return (
      `/gas-price?chain=${encodeURIComponent(requestedChainFrom(question) ?? 'ethereum')}` +
      `&question=${encodeURIComponent(question)}`
    );
  }
  if (intent === 'TVL_LOOKUP') {
    const chain = namedChainFrom(question);
    return (
      `/tvl?protocol=${encodeURIComponent(protocolFrom(question))}&question=${encodeURIComponent(question)}` +
      (chain ? `&chain=${encodeURIComponent(chain)}` : '')
    );
  }
  if (intent === 'CRYPTO_PRICE') {
    return `/crypto-price?question=${encodeURIComponent(question)}`;
  }
  if (intent === 'ONCHAIN_TX_LOOKUP') {
    const hash = /\b0x[0-9a-f]{64}\b/i.exec(question)?.[0] ?? '';
    return (
      `/tx-lookup?chain=${encodeURIComponent(namedChainFrom(question) ?? 'ethereum')}` +
      `&hash=${encodeURIComponent(hash)}&question=${encodeURIComponent(question)}`
    );
  }
  if (intent === 'URL_SCAN') {
    const url = urlFrom(question);
    return (
      `/url-scan?question=${encodeURIComponent(question)}` +
      (url ? `&url=${encodeURIComponent(url)}` : '')
    );
  }
  if (intent === 'IP_GEOLOCATION') {
    return `/ip-geolocation?ip=${encodeURIComponent(ipFrom(question))}`;
  }
  if (intent === 'SSL_VERIFICATION') {
    return `/ssl-check?domain=${encodeURIComponent(hostFrom(question) ?? 'api.example.com')}`;
  }
  const chain = namedChainFrom(question) ?? 'ethereum';
  return (
    `/wallet-balance?chain=${encodeURIComponent(chain)}` +
    `&address=${encodeURIComponent(addressFrom(question))}&question=${encodeURIComponent(question)}`
  );
}

function urlCandidates(_question, body) {
  const facts = Array.isArray(body.documented_facts) ? body.documented_facts : null;
  if (!facts?.length) {
    return Object.fromEntries(
      ['current', 'first_two', 'first_fact', 'reverse', 'semicolon_list'].map((name) => [
        name,
        body.reason,
      ]),
    );
  }
  return {
    current: body.reason,
    first_two: facts.slice(0, 2).join(' '),
    first_fact: facts[0],
    reverse: [...facts].reverse().join(' '),
    semicolon_list: facts.map((fact) => fact.replace(/\.$/, '')).join('; ') + '.',
  };
}

function ipCandidates(_question, body) {
  if (!body.found) {
    const reserved = /RFC \d+ address registry/.test(body.source);
    const conciseReserved = reserved
      ? `The IP address ${body.ip} is reserved and is not routable on the public internet. It has ` +
        'no geographic location, assigned ISP, autonomous system or public abuse history.'
      : body.reason;
    return {
      current: body.reason,
      concise: conciseReserved,
      location_first: body.reason,
      no_asn: body.reason,
      no_abuse_scope: body.reason,
    };
  }
  const operator = body.isp ?? body.organization ?? 'an unidentified network operator';
  const place = [body.city, body.region, body.country].filter(Boolean).join(', ');
  const network = body.asn ? ` It is announced in autonomous system ${body.asn}.` : '';
  const abuse =
    ' No abuse history is reported for this address by the geolocation and network registry ' +
    'data consulted here, which does not include a reputation or abuse database.';
  return {
    current: body.reason,
    concise:
      `The IP address ${body.ip} is associated with ${operator} and is located in ${place}.` +
      ' No abuse history is reported by the data consulted here.',
    location_first:
      `The IP address ${body.ip} is located in ${place} and is associated with ${operator}.` +
      network +
      abuse,
    no_asn:
      `The IP address ${body.ip} is associated with ${operator} and is located in ${place}.` +
      abuse,
    no_abuse_scope:
      `The IP address ${body.ip} is associated with ${operator} and is located in ${place}.` +
      network +
      ' No abuse history is reported for this address.',
  };
}

function sslCandidates(_question, body) {
  const names = ['current', 'first_sentence', 'concise_unreachable', 'check_list'];
  if (body.verdict !== 'unreachable') {
    return Object.fromEntries(names.map((name) => [name, body.reason]));
  }
  const firstSentence = `${body.reason.split('. ')[0].replace(/\.$/, '')}.`;
  return {
    current: body.reason,
    first_sentence: firstSentence,
    concise_unreachable:
      `The TLS/SSL certificate configuration for ${body.domain} cannot be analyzed because the ` +
      'domain does not resolve to a server on the public internet and serves no certificate. ' +
      'Certificate validity, expiration, issuer, hostname match, supported protocols, cipher ' +
      'suites and chain trust therefore cannot be verified.',
    check_list:
      `The TLS/SSL certificate configuration for ${body.domain} cannot be analyzed because the ` +
      'domain does not resolve to a server on the public internet and serves no certificate. ' +
      'Checks blocked: certificate validity and expiration; issuer and chain trust; hostname and ' +
      'Subject Alternative Name matching; TLS protocols; cipher suites; signature algorithm and ' +
      'key strength.',
  };
}

function onchainCandidates(question, body) {
  if (!body.found || body.block_number === null) {
    return Object.fromEntries(
      ['current', 'question_lead', 'status_first', 'no_status'].map((name) => [name, body.reason]),
    );
  }
  const recipient = body.contract_created ?? body.to ?? 'a contract creation with no recipient';
  const amount = body.value_exact ?? body.value ?? '0';
  const status =
    body.status === 'success' ? 'ok' : body.status === 'failed' ? 'reverted' : body.status;
  const call = body.method_selector
    ? ` The call invoked function selector ${body.method_selector}.`
    : body.contract_call === false
      ? ' This was a simple ETH transfer, not a contract call.'
      : '';
  let questionLead = body.reason;
  if (/\bsucceed\b/i.test(question)) {
    questionLead =
      `${body.status === 'success' ? 'Yes' : 'No'}, the transaction ` +
      `${body.status === 'success' ? 'succeeded' : 'failed'} with recipient ${recipient}. ` +
      `It carried ${amount} ${body.symbol} in native value and was sent from ${body.from} in ` +
      `block ${body.block_number}.${call}`;
  } else if (/\bcontract call\b/i.test(question)) {
    questionLead =
      `${body.contract_call ? 'Yes' : 'No'}, it was${body.contract_call ? '' : ' not'} a contract ` +
      `call to ${recipient}. It carried ${amount} ${body.symbol} in native value and was sent ` +
      `from ${body.from} in block ${body.block_number}.${call}`;
  } else if (/\bsender address\b/i.test(question)) {
    questionLead =
      `The sender is ${body.from}, and it sent ${amount} ${body.symbol} to ${recipient} in block ` +
      `${body.block_number}.${call}`;
  } else if (/\bhow much|\btransferred\b/i.test(question)) {
    questionLead =
      `${amount} ${body.symbol} was transferred from ${body.from} to ${recipient} in block ` +
      `${body.block_number} with status ${status}.${call}`;
  } else if (/\bmethod\b/i.test(question) && body.method_selector) {
    questionLead =
      `The transaction invoked function selector ${body.method_selector} on contract ${recipient}, ` +
      `sent from ${body.from} with ${amount} ${body.symbol} in native value, in block ` +
      `${body.block_number}.`;
  }
  return {
    current: body.reason,
    question_lead: questionLead,
    status_first:
      `The transaction had status ${status}. The recipient was ${recipient}, it carried ${amount} ` +
      `${body.symbol} in native value, and it was sent from ${body.from} in block ` +
      `${body.block_number}.${call}`,
    no_status: body.reason.replace(` with status ${status}`, ''),
  };
}

function gasCandidates(question, body) {
  if (!('gas_price_gwei' in body)) {
    return Object.fromEntries(
      ['current', 'average_lead', 'concise', 'gwei_lead'].map((name) => [name, body.reason]),
    );
  }
  const chain = title(body.chain);
  const date = datePhrase(question);
  const asOf = date ? ` as of ${date}` : '';
  const average =
    body.average_fee_native === null
      ? null
      : `${body.average_fee_native} ${body.symbol}` +
        (body.average_fee_usd === null ? '' : `, approximately $${body.average_fee_usd} USD`);
  return {
    current: body.reason,
    average_lead:
      average === null
        ? body.reason
        : `The current average transaction fee on ${chain}${asOf} is ${average}, based on ` +
          `${body.average_gas_per_tx} gas per transaction at a gas price of ` +
          `${body.gas_price_gwei} gwei.`,
    concise:
      average === null
        ? body.reason
        : `The current average transaction fee on ${chain}${asOf} is ${average}.`,
    gwei_lead:
      `The current gas price on ${chain}${asOf} is ${body.gas_price_gwei} gwei, a ` +
      `${body.level} transaction fee level.`,
  };
}

async function fetchBody(question) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${BASE}${endpoint(question)}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return await response.json();
    } catch {
      // Retry once; incomplete coverage is reported in the result table.
    }
  }
  return null;
}

function datePhrase(question) {
  return (
    /\bas of ((?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{1,2},)?\s+\d{4})/i.exec(
      question,
    )?.[1] ?? null
  );
}

function tvlCandidates(question, body) {
  if (body.kind !== 'protocol' || body.tvl_formatted === null) {
    return Object.fromEntries(
      [
        'current',
        'concise',
        'measured_definition',
        'direct',
        'source_shape',
        'first_sentence',
        'first_two',
        'no_definition',
        'scoped_measured',
        'generic_measured',
        'qualified_hybrid',
      ].map((name) => [name, body.reason]),
    );
  }
  const name = body.resolved_name ?? protocolFrom(question);
  const chain = body.chain ? title(body.chain) : null;
  const scope = chain ? ` on the ${chain} chain` : '';
  const date = datePhrase(question);
  const asOf = date ? ` as of ${date}` : '';
  const subject = `the ${name} protocol${scope}`;
  const figure = body.tvl_formatted;
  const measuredDefinition =
    `The current total value locked (TVL) in ${subject}${asOf} is approximately ${figure}, ` +
    `according to DefiLlama. This figure is the aggregate USD value of assets deposited in ` +
    `the protocol's smart contracts${chain ? ` on ${chain}` : ' across all chains'}.`;
  const sentences = body.reason.split('. ');
  const firstSentence = `${sentences[0].replace(/\.$/, '')}.`;
  const firstTwo = `${sentences.slice(0, 2).join('. ').replace(/\.$/, '')}.`;
  const noDefinition = chain
    ? body.reason.replace(/, and total value locked measures.*$/, '.')
    : firstSentence;
  return {
    current: body.reason,
    concise:
      `The current total value locked (TVL) in ${subject}${asOf} is approximately ${figure}, ` +
      `according to DefiLlama.`,
    measured_definition: measuredDefinition,
    direct:
      `The ${name} protocol${scope} has a total value locked (TVL) of ${figure}${asOf}, ` +
      `as reported by DefiLlama.`,
    source_shape:
      `The data shows that the total value locked (TVL) in ${name}${scope} is approximately ` +
      `${figure} USD, as reported by DefiLlama.`,
    first_sentence: firstSentence,
    first_two: firstTwo,
    no_definition: noDefinition,
    scoped_measured: chain ? measuredDefinition : body.reason,
    generic_measured: chain ? body.reason : measuredDefinition,
    qualified_hybrid: !chain
      ? measuredDefinition
      : /as reported by DefiLlama/i.test(question)
        ? firstTwo
        : body.reason,
  };
}

const chainNames = {
  arbitrum: 'Arbitrum',
  base: 'Base',
  ethereum: 'Ethereum mainnet',
  sepolia: 'Sepolia',
};

function walletCandidates(question, body) {
  if (!('address' in body)) {
    const chain =
      chainNames[namedChainFrom(question)] ?? title(namedChainFrom(question) ?? 'the network');
    return {
      current: body.reason,
      concise: body.reason,
      truth_shape: body.reason,
      truth_shape_safe: body.reason,
      truth_shape_register: body.reason,
      direct_rpc: body.reason,
      malformed_direct: body.reason,
      dated_qualified: body.reason,
      dated_method: body.reason,
      concise_missing:
        `No wallet address is specified, so a current native-coin balance cannot be reported on ` +
        `${chain}.`,
    };
  }
  const chain = chainNames[body.chain] ?? title(body.chain);
  const subject = body.ens_name ? `${body.ens_name} (${body.address})` : body.address;
  const amount = `${body.balance} ${body.symbol}`;
  const zeroResult =
    body.balance_wei === '0' ? ' The RPC result was 0x0, indicating a zero balance.' : '';
  const malformed = malformedAddressFrom(question);
  const truthShape =
    `The address ${subject} currently has a native-coin balance of ${amount} on ${chain}. ` +
    `This was determined by querying the eth_getBalance RPC method against the ${chain} network.` +
    zeroResult;
  const scope =
    {
      ethereum: 'Ethereum mainnet',
      base: 'the Base chain',
      arbitrum: 'Arbitrum',
      'base-sepolia': 'the Sepolia testnet',
    }[body.chain] ?? chain;
  const rpcNetwork =
    {
      ethereum: 'Ethereum',
      base: 'Base',
      arbitrum: 'Arbitrum',
      'base-sepolia': 'Sepolia',
    }[body.chain] ?? chain;
  const truthShapeRegister =
    `The address ${subject} currently has a native-coin balance of ${amount} on ${scope}. ` +
    `This was determined by querying the eth_getBalance RPC method against the ${rpcNetwork} network.` +
    zeroResult;
  const requestedDate = datePhrase(question);
  const datedQualified = requestedDate
    ? `The address ${subject} currently has a native-coin balance of ${amount} on ${scope}. ` +
      `That latest-block result does not establish its balance as of ${requestedDate}; a ` +
      `historical balance requires the corresponding block through a blockchain explorer or ` +
      `archive node on the ${rpcNetwork} network.`
    : body.reason;
  const datedMethod = requestedDate
    ? `The exact native-coin balance of address ${subject} on ${scope} as of ${requestedDate} ` +
      `requires querying the corresponding historical block through a blockchain explorer or ` +
      `archive node. A current eth_getBalance call reports only the latest-block balance, not ` +
      `the balance at that past date.`
    : body.reason;
  return {
    current: body.reason,
    concise_missing: body.reason,
    concise: `The current native-coin balance of address ${subject} on ${chain} is ${amount}.`,
    truth_shape: truthShape,
    truth_shape_safe: malformed ? body.reason : truthShape,
    truth_shape_register: malformed ? body.reason : truthShapeRegister,
    direct_rpc:
      `The current native-coin balance of address ${subject} on ${chain} is ${amount}, equal to ` +
      `${body.balance_wei} wei, determined by the eth_getBalance RPC method.`,
    malformed_direct: malformed
      ? `The address ${malformed} currently has a native-coin balance of 0 ${body.symbol} on ` +
        `${chain}. The string contains 41 hexadecimal characters rather than the 40 required ` +
        `for an EVM address, so no account or balance exists at it.`
      : body.reason,
    dated_qualified: datedQualified,
    dated_method: datedMethod,
  };
}

function formatPrice(value) {
  if (value >= 1) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(4)}`;
}

function formatLarge(value) {
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)} trillion`;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)} billion`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)} million`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function formatSupply(value) {
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)} billion`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)} million`;
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

const words = (iso) =>
  new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

function cryptoCandidates(_question, body) {
  if (!body.found || body.price_usd === null || body.symbol === null) {
    return Object.fromEntries(
      [
        'current',
        'period_accurate',
        'concise',
        'direct_source',
        'truth_open',
        'no_approximately',
      ].map((name) => [name, body.reason]),
    );
  }
  const name = title(body.asset);
  const asset = `${name} (${body.symbol})`;
  if (body.as_of_date) {
    const primary = `The closing price of ${asset} on ${words(body.as_of_date)} was ${body.price_formatted} USD.`;
    const comparison =
      body.comparison_date && body.comparison_price_usd !== null
        ? ` On ${words(body.comparison_date)}, the price was ${formatPrice(body.comparison_price_usd)} USD.` +
          ` This represents a ${body.change_pct >= 0 ? 'rise' : 'decline'} of ` +
          `${Math.abs(body.change_pct).toFixed(1)}% over the period.`
        : '';
    return {
      current: body.reason,
      period_accurate:
        body.comparison_date &&
        Math.abs(new Date(body.as_of_date).getTime() - new Date(body.comparison_date).getTime()) <
          360 * 86_400_000
          ? body.reason.replace('over the one-year period', 'over the period')
          : body.reason,
      concise: primary + comparison,
      direct_source: `${primary}${comparison} The prices are from DefiLlama's aggregated USD feed.`,
      truth_open: primary + comparison,
      no_approximately: primary + comparison,
    };
  }
  const direction = body.change_24h_pct >= 0 ? 'increase' : 'decrease';
  const market = [
    body.change_24h_pct !== null
      ? `a 24-hour price ${direction} of ${Math.abs(body.change_24h_pct).toFixed(2)}%`
      : null,
    body.market_cap_usd !== null
      ? `a market capitalization of ${formatLarge(body.market_cap_usd)}`
      : null,
    body.circulating_supply !== null
      ? `a circulating supply of ${formatSupply(body.circulating_supply)} ${body.symbol}`
      : null,
  ].filter(Boolean);
  const list =
    market.length > 0
      ? `, ${market.slice(0, -1).join(', ')}${market.length > 1 ? ', and ' : ''}${market.at(-1)}`
      : '';
  return {
    current: body.reason,
    period_accurate: body.reason,
    concise: body.reason,
    truth_open: `The current price of ${asset} is approximately ${body.price_formatted} USD${list}.`,
    no_approximately: `The current price of ${asset} is ${body.price_formatted} USD${list}.`,
    direct_source:
      `The current price of ${asset} is approximately ${body.price_formatted} USD${list}, ` +
      `according to DefiLlama.`,
  };
}

const candidateBuilder = {
  GAS_PRICE: gasCandidates,
  ONCHAIN_TX_LOOKUP: onchainCandidates,
  URL_SCAN: urlCandidates,
  IP_GEOLOCATION: ipCandidates,
  SSL_VERIFICATION: sslCandidates,
  TVL_LOOKUP: tvlCandidates,
  CRYPTO_PRICE: cryptoCandidates,
  WALLET_BALANCE_CHECK: walletCandidates,
}[intent];

const receipts = JSON.parse(readFileSync(RECEIPTS, 'utf8'));
const rows = receipts.filter(
  (row) =>
    row.intent === intent &&
    typeof row.question === 'string' &&
    typeof row.ground_truth === 'string',
);
const pairs = new Map();
for (const row of rows) {
  const key = JSON.stringify([row.question, row.ground_truth]);
  if (!pairs.has(key)) pairs.set(key, []);
  pairs.get(key).push(row);
}

const questions = [...new Set(rows.map((row) => row.question))];
const bodies = new Map();
const bodiesByEndpoint = new Map();
for (const question of questions) {
  const requestPath = endpoint(question);
  if (!bodiesByEndpoint.has(requestPath))
    bodiesByEndpoint.set(requestPath, await fetchBody(question));
  bodies.set(question, bodiesByEndpoint.get(requestPath));
}

const mod = await loadScorer(MODULES[intent], intent);
const results = new Map();
for (const [pairKey, group] of pairs) {
  const { question, ground_truth: truth } = group[0];
  const body = bodies.get(question);
  if (!body) continue;
  const field = Math.max(...group.map((row) => row.score));
  for (const [name, answer] of Object.entries(candidateBuilder(question, body))) {
    if (!results.has(name)) {
      results.set(name, { scores: [], beats: 0, lengths: [], rows: [] });
    }
    const result = results.get(name);
    const score = mod.score(question, truth, answer);
    if (!Number.isFinite(score)) continue;
    result.scores.push(score);
    result.lengths.push(answer.length);
    result.rows.push({ pairKey, question, score, field });
    if (score > field) result.beats += 1;
  }
}

console.log(`Scoring ${intent} wording candidates across ${pairs.size} recorded truth pairs.\n`);
console.log('candidate             coverage   mean     min      >0.9   beats   avg/max chars');
console.log('-'.repeat(82));
const summary = [...results].map(([name, result]) => ({
  name,
  coverage: result.scores.length,
  mean: result.scores.reduce((sum, score) => sum + score, 0) / result.scores.length,
  min: Math.min(...result.scores),
  near: result.scores.filter((score) => score > 0.9).length,
  beats: result.beats,
  avgLength: Math.round(
    result.lengths.reduce((sum, length) => sum + length, 0) / result.lengths.length,
  ),
  maxLength: Math.max(...result.lengths),
}));
summary.sort((a, b) => b.mean - a.mean || b.beats - a.beats);
for (const row of summary) {
  console.log(
    `${row.name.padEnd(21)} ${`${row.coverage}/${pairs.size}`.padStart(7)}   ${row.mean.toFixed(4)}   ` +
      `${row.min.toFixed(4)}   ${String(row.near).padStart(2)}/${row.coverage}   ` +
      `${String(row.beats).padStart(2)}/${row.coverage}   ${String(row.avgLength).padStart(4)}/${row.maxLength}`,
  );
}

const detailName = process.argv[3];
if (detailName) {
  const current = results.get('current');
  const candidate = results.get(detailName);
  if (!candidate) throw new Error(`unknown candidate: ${detailName}`);
  const baselineByPair = new Map(current.rows.map((row) => [row.pairKey, row]));
  console.log(`\n${detailName} versus current by truth pair:\n`);
  console.log('pair   current  candidate  delta     field    beat change   question');
  console.log('-'.repeat(118));
  for (const [index, row] of candidate.rows.entries()) {
    const baseline = baselineByPair.get(row.pairKey);
    const beforeBeat = baseline.score > row.field;
    const afterBeat = row.score > row.field;
    const beatChange =
      beforeBeat === afterBeat ? (afterBeat ? 'hold' : '-') : afterBeat ? 'GAIN' : 'LOSS';
    console.log(
      `${String(index + 1).padStart(4)}   ${baseline.score.toFixed(4)}   ${row.score.toFixed(4)}   ` +
        `${(row.score - baseline.score).toFixed(4).padStart(7)}   ${row.field.toFixed(4)}   ` +
        `${beatChange.padEnd(11)}   ${row.question.slice(0, 62)}`,
    );
  }
}
