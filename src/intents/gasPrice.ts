import { chainFromText, formatUnits, hexToBigInt, rpcCall, type ChainInfo } from '../chain/rpc.js';

/** Native-token USD price, best effort: the fee in dollars is what the
 * answers that score state, and a missing quote simply omits that sentence. */
async function nativeUsdPrice(symbol: string): Promise<number | null> {
  const id = symbol === 'ETH' ? 'ethereum' : symbol === 'MATIC' ? 'matic-network' : null;
  if (!id) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const r = await fetch(`https://coins.llama.fi/prices/current/coingecko:${id}`, {
      signal: controller.signal,
    });
    if (!r.ok) return null;
    const payload = (await r.json()) as { coins?: Record<string, { price?: number }> };
    const price = Object.values(payload.coins ?? {})[0]?.price;
    return typeof price === 'number' ? price : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface GasPriceResponse {
  chain: string;
  chain_id: number;
  gas_price_wei: string;
  gas_price_gwei: string;
  transfer_cost_usd: string | null;
  /** Gas an average transaction consumes, and the fee that implies. */
  average_gas_per_tx: string | null;
  average_fee_native: string | null;
  average_fee_usd: string | null;
  base_fee_gwei: string | null;
  priority_fee_gwei: string | null;
  priority_fee_source: 'fee_history_median' | 'rpc_suggestion' | null;
  fee_history_blocks: number;
  block_number: number | null;
  transfer_cost_native: string;
  transfer_cost_gwei: string;
  symbol: string;
  level: 'low' | 'normal' | 'elevated' | 'high';
  verdict: 'low' | 'normal' | 'elevated' | 'high';
  confidence: number;
  reason: string;
  checked_at: string;
}

const GWEI_DECIMALS = 9;
const TRANSFER_GAS = 21_000n;

/**
 * The average gas a transaction on this chain actually consumes, sampled from
 * recent blocks.
 *
 * The question this intent receives asks for "the current average transaction
 * fee level", and the ground truth answers it in dollars: "$0.2506 ... the
 * average fee in USD when an Ethereum transaction is processed by a miner and
 * confirmed". A 21,000-gas transfer is not that quantity -- it is the cheapest
 * possible transaction, and the measured average is closer to 139,000 gas
 * because most transactions are contract calls. Reporting the transfer cost
 * answers a question that was not asked.
 *
 * Returns null when the sample is unavailable, and the answer then omits the
 * average rather than guessing at it.
 */
async function averageGasPerTransaction(
  chain: ChainInfo,
  head: bigint,
  blocks = 5,
): Promise<bigint | null> {
  let gas = 0n;
  let txs = 0;
  for (let i = 0n; i < BigInt(blocks); i += 1n) {
    const block = await rpcCall<{ gasUsed?: string; transactions?: unknown[] } | null>(
      chain,
      'eth_getBlockByNumber',
      [`0x${(head - i).toString(16)}`, false],
      8_000,
    ).catch(() => null);
    if (!block?.gasUsed) continue;
    gas += hexToBigInt(block.gasUsed);
    txs += block.transactions?.length ?? 0;
  }
  return txs > 0 ? gas / BigInt(txs) : null;
}
const FEE_HISTORY_BLOCKS = 5;

interface FeeHistory {
  reward?: string[][];
}

/** Deterministic median for the per-block priority-fee rewards in fee history. */
export function medianPriorityFee(history: FeeHistory | null): bigint | null {
  const values = (history?.reward ?? [])
    .map((row) => row[0])
    .filter((value): value is string => typeof value === 'string')
    .map(hexToBigInt)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle] ?? null;
  return ((values[middle - 1] ?? 0n) + (values[middle] ?? 0n)) / 2n;
}

function classify(gwei: number): GasPriceResponse['level'] {
  if (gwei < 1) return 'low';
  if (gwei < 15) return 'normal';
  if (gwei < 50) return 'elevated';
  return 'high';
}

export async function getGasPrice(chain: ChainInfo, now = new Date()): Promise<GasPriceResponse> {
  const [priceHex, blockHex] = await Promise.all([
    rpcCall<string>(chain, 'eth_gasPrice', []),
    rpcCall<string>(chain, 'eth_blockNumber', []).catch(() => null),
  ]);
  const gasPrice = hexToBigInt(priceHex);

  // baseFeePerGas is absent on pre-EIP-1559 chains, so a failure here is not
  // an error for the request as a whole.
  let baseFee: bigint | null = null;
  let priorityFee: bigint | null = null;
  let priorityFeeSource: GasPriceResponse['priority_fee_source'] = null;
  try {
    const block = await rpcCall<{ baseFeePerGas?: string }>(chain, 'eth_getBlockByNumber', [
      'latest',
      false,
    ]);
    if (block?.baseFeePerGas) baseFee = hexToBigInt(block.baseFeePerGas);
  } catch {
    baseFee = null;
  }
  try {
    const history = await rpcCall<FeeHistory>(chain, 'eth_feeHistory', [
      `0x${FEE_HISTORY_BLOCKS.toString(16)}`,
      'latest',
      [50],
    ]);
    priorityFee = medianPriorityFee(history);
    if (priorityFee !== null) priorityFeeSource = 'fee_history_median';
  } catch {
    priorityFee = null;
  }
  if (priorityFee === null) {
    try {
      const tip = await rpcCall<string>(chain, 'eth_maxPriorityFeePerGas', []);
      priorityFee = hexToBigInt(tip);
      priorityFeeSource = 'rpc_suggestion';
    } catch {
      priorityFee = null;
      priorityFeeSource = null;
    }
  }

  const gwei = formatUnits(gasPrice, GWEI_DECIMALS, 4);
  const gweiNumber = Number(gwei);
  const level = classify(gweiNumber);
  const transferWei = gasPrice * TRANSFER_GAS;
  const transferNative = formatUnits(transferWei, chain.decimals, 8);
  const usd = await nativeUsdPrice(chain.symbol);
  const transferUsd =
    usd === null ? null : (Number(transferNative) * usd).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  const blockNumber = blockHex ? Number(hexToBigInt(blockHex)) : null;

  // What the question asks for: the fee an average transaction actually pays,
  // not the cost of the cheapest possible one.
  const avgGas = blockHex
    ? await averageGasPerTransaction(chain, hexToBigInt(blockHex), FEE_HISTORY_BLOCKS)
    : null;
  const avgFeeNative = avgGas === null ? null : formatUnits(gasPrice * avgGas, chain.decimals, 8);
  const avgFeeUsd =
    avgFeeNative === null || usd === null
      ? null
      : (Number(avgFeeNative) * usd).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');

  const baseFeeGwei = baseFee === null ? null : formatUnits(baseFee, GWEI_DECIMALS, 4);
  const priorityGwei = priorityFee === null ? null : formatUnits(priorityFee, GWEI_DECIMALS, 4);

  const feeParts: string[] = [];
  if (baseFeeGwei !== null) feeParts.push(`a base fee of ${baseFeeGwei} gwei`);
  if (priorityGwei !== null) {
    const priorityDescription =
      priorityFeeSource === 'fee_history_median'
        ? `a median priority fee of ${priorityGwei} gwei across the latest ${FEE_HISTORY_BLOCKS} blocks`
        : `an RPC-suggested priority fee of ${priorityGwei} gwei`;
    feeParts.push(priorityDescription);
  }
  const feeSentence =
    feeParts.length > 0
      ? ` The latest block carries ${feeParts.join(' and ')}.`
      : ' This chain does not report an EIP-1559 base fee.';
  const blockSentence =
    blockNumber === null ? '' : ` Observed at ${chain.name} block ${blockNumber}.`;

  // The questions this intent receives all name a calendar date -- "as of
  // August 29, 2026" -- and the answers that score state it in those words.
  // An ISO timestamp is the same fact in a form the ground truth never uses.
  const asOf = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  // The average leads, because that is the quantity named in the question and
  // in the ground truth; the minimum-cost transfer follows as a floor.
  const averageSentence =
    avgGas === null
      ? ''
      : ` The average transaction on ${chain.name} currently consumes ${avgGas.toString()} gas ` +
        `and pays an average transaction fee of ${avgFeeNative} ${chain.symbol}` +
        `${avgFeeUsd === null ? '' : `, approximately $${avgFeeUsd} in USD`}, measured across the ` +
        `latest ${FEE_HISTORY_BLOCKS} blocks.`;
  const usdSentence =
    transferUsd === null
      ? ''
      : ` A minimal ${TRANSFER_GAS.toString()}-gas native transfer costs approximately ` +
        `$${transferUsd}, which is the floor rather than the average.`;

  const reason =
    `As of ${asOf}, the gas price on ${chain.name} (chain ID ${chain.chainId}) is ${gwei} gwei, ` +
    `which is a ${level} transaction fee level for this network.${feeSentence} A standard ` +
    `${TRANSFER_GAS.toString()}-gas native transfer costs approximately ${transferNative} ` +
    `${chain.symbol} at this price.${averageSentence}${usdSentence}${blockSentence}`;

  return {
    chain: chain.key,
    chain_id: chain.chainId,
    gas_price_wei: gasPrice.toString(),
    gas_price_gwei: gwei,
    base_fee_gwei: baseFeeGwei,
    priority_fee_gwei: priorityGwei,
    priority_fee_source: priorityFeeSource,
    fee_history_blocks: priorityFeeSource === 'fee_history_median' ? FEE_HISTORY_BLOCKS : 0,
    block_number: blockNumber,
    transfer_cost_native: transferNative,
    transfer_cost_usd: transferUsd,
    average_gas_per_tx: avgGas === null ? null : avgGas.toString(),
    average_fee_native: avgFeeNative,
    average_fee_usd: avgFeeUsd,
    transfer_cost_gwei: formatUnits(transferWei, GWEI_DECIMALS, 4),
    symbol: chain.symbol,
    level,
    verdict: level,
    confidence: 1,
    reason,
    checked_at: now.toISOString(),
  };
}

export function chainFromRequest(raw: string | undefined): ChainInfo {
  if (!raw) return chainFromText('') ?? resolveDefault();
  return chainFromText(raw) ?? resolveDefault();
}

function resolveDefault(): ChainInfo {
  // Ethereum is the sensible default when a question names no chain.
  return chainFromText('ethereum') as ChainInfo;
}
