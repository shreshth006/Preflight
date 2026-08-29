import { chainFromText, formatUnits, hexToBigInt, rpcCall, type ChainInfo } from '../chain/rpc.js';

export interface GasPriceResponse {
  chain: string;
  chain_id: number;
  gas_price_wei: string;
  gas_price_gwei: string;
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
  const blockNumber = blockHex ? Number(hexToBigInt(blockHex)) : null;

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
    blockNumber === null
      ? ` Observed at ${now.toISOString()}.`
      : ` Observed at ${chain.name} block ${blockNumber} at ${now.toISOString()}.`;

  const reason =
    `The current gas price on ${chain.name} (chain ID ${chain.chainId}) is ${gwei} gwei, ` +
    `which is ${level} for this network.${feeSentence} A standard ${TRANSFER_GAS.toString()}-gas ` +
    `native transfer costs approximately ${transferNative} ${chain.symbol} at this price.` +
    `${blockSentence} Gas is quoted in gwei, where 1 gwei is 10^9 wei.`;

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
