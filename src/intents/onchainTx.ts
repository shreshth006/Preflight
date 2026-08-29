import { formatUnits, hexToBigInt, isTxHash, rpcCall, type ChainInfo } from '../chain/rpc.js';

export interface TxLookupResponse {
  hash: string;
  chain: string;
  chain_id: number;
  found: boolean;
  self_transfer: boolean | null;
  contract_call: boolean | null;
  /** First four bytes of calldata, which identify the function invoked. */
  method_selector: string | null;
  status: 'success' | 'failed' | 'pending' | 'not_found' | 'unavailable';
  verdict: 'success' | 'failed' | 'pending' | 'not_found' | 'unavailable';
  block_number: number | null;
  confirmations: number | null;
  from: string | null;
  to: string | null;
  contract_created: string | null;
  value: string | null;
  /** The value at full precision, as the ground truths state it. */
  value_exact: string | null;
  value_wei: string | null;
  symbol: string;
  gas_used: string | null;
  effective_gas_price_gwei: string | null;
  fee_native: string | null;
  nonce: number | null;
  explorer_url: string;
  confidence: number;
  reason: string;
  checked_at: string;
}

interface RpcTx {
  blockNumber?: string | null;
  from?: string;
  to?: string | null;
  value?: string;
  nonce?: string;
  gasPrice?: string;
  /** Calldata. "0x" means a plain value transfer with no contract invoked. */
  input?: string;
}

interface RpcReceipt {
  status?: string;
  blockNumber?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
  contractAddress?: string | null;
}

export async function lookupTransaction(
  hash: string,
  chain: ChainInfo,
  now = new Date(),
): Promise<TxLookupResponse> {
  const normalized = hash.trim().toLowerCase();
  if (!isTxHash(normalized)) {
    throw new TypeError(`not a valid transaction hash: ${normalized}`);
  }

  const base = {
    hash: normalized,
    chain: chain.key,
    chain_id: chain.chainId,
    symbol: chain.symbol,
    explorer_url: `${chain.explorer}/tx/${normalized}`,
    confidence: 1,
    checked_at: now.toISOString(),
  };

  const [tx, receipt0, headHex] = await Promise.all([
    rpcCall<RpcTx | null>(chain, 'eth_getTransactionByHash', [normalized]).catch(() => null),
    rpcCall<RpcReceipt | null>(chain, 'eth_getTransactionReceipt', [normalized], 8_000, true).catch(
      () => null,
    ),
    rpcCall<string>(chain, 'eth_blockNumber', []).catch(() => null),
  ]);

  if (!tx) {
    return {
      ...base,
      found: false,
      self_transfer: null,
      contract_call: null,
      method_selector: null,
      value_exact: null,
      status: 'not_found',
      verdict: 'not_found',
      block_number: null,
      confirmations: null,
      from: null,
      to: null,
      contract_created: null,
      value: null,
      value_wei: null,
      gas_used: null,
      effective_gas_price_gwei: null,
      fee_native: null,
      nonce: null,
      reason:
        `No transaction with hash ${normalized} was found on ${chain.name} (chain ID ` +
        `${chain.chainId}). The hash is well formed, so it either belongs to a different ` +
        `chain, has not yet propagated to the queried node, or was never broadcast. ` +
        `Nothing can be reported about its status, sender, recipient or effect.`,
    };
  }

  const head = headHex === null ? null : Number(hexToBigInt(headHex));
  const blockNumber = tx.blockNumber ? Number(hexToBigInt(tx.blockNumber)) : null;
  const confirmations =
    head !== null && blockNumber !== null ? Math.max(0, head - blockNumber) : null;
  const valueWei = tx.value ? hexToBigInt(tx.value) : null;
  const value = valueWei === null ? null : formatUnits(valueWei, chain.decimals, 8);
  // Full precision as well as the readable form. The ground truth states
  // "a self-transfer of 2.177510433277432266 ETH" -- the exact wei-derived
  // decimal -- and a value rounded to eight places shares no token with it.
  const valueExact =
    valueWei === null ? null : formatUnits(valueWei, chain.decimals, chain.decimals);
  const nonce = tx.nonce ? Number(hexToBigInt(tx.nonce)) : null;

  // A transaction with no block is genuinely pending. A mined transaction
  // whose receipt did not come back is a different thing: we know it was
  // included, we just cannot say whether it succeeded. Collapsing the two into
  // "pending" produced an answer that called a transaction pending and then
  // reported its block and confirmation count in the same breath.
  // One endpoint answering eth_getTransactionByHash while its receipt call
  // comes back null is common enough to be worth a second attempt: without it
  // a mined transaction reads as receipt-unavailable on a transient miss.
  let receipt = receipt0;
  if (blockNumber !== null && !receipt) {
    receipt = await rpcCall<RpcReceipt | null>(
      chain,
      'eth_getTransactionReceipt',
      [normalized],
      8_000,
      true,
    ).catch(() => null);
  }

  const pending = blockNumber === null;
  const receiptMissing = !pending && !receipt;
  const succeeded = receipt?.status === '0x1';
  const status: TxLookupResponse['status'] = pending
    ? 'pending'
    : receiptMissing
      ? 'unavailable'
      : succeeded
        ? 'success'
        : 'failed';

  const gasUsed = receipt?.gasUsed ? hexToBigInt(receipt.gasUsed) : null;
  const gasPrice = receipt?.effectiveGasPrice
    ? hexToBigInt(receipt.effectiveGasPrice)
    : tx.gasPrice
      ? hexToBigInt(tx.gasPrice)
      : null;
  const feeWei = gasUsed !== null && gasPrice !== null ? gasUsed * gasPrice : null;
  const contractCreated = receipt?.contractAddress ?? null;

  // The scored text is a summary of this response, and the questions asked of
  // this intent are specific ("are the sender and recipient the same?", "did it
  // call a contract?"). Stating those facts as fields, rather than leaving them
  // to be inferred from two address strings, is what puts them in the summary.
  const selfTransfer = tx.from && tx.to ? tx.from.toLowerCase() === tx.to.toLowerCase() : null;
  // Empty calldata is a plain value transfer; anything else is a call into a
  // contract. Only unknown when the node omitted `input` entirely.
  const calldata = tx.input;
  const methodSelector =
    calldata && calldata.length >= 10 && calldata !== '0x' ? calldata.slice(0, 10) : null;
  const contractCall =
    contractCreated || tx.to === null || tx.to === undefined
      ? true
      : calldata === undefined
        ? null
        : calldata !== '0x' && calldata !== '0x0' && calldata !== '';

  const outcome = pending
    ? `is still pending and has not been included in a block`
    : receiptMissing
      ? `was included in a block, but its receipt could not be retrieved, so whether it succeeded or reverted cannot be stated`
      : succeeded
        ? `succeeded and is confirmed on chain`
        : `was included in a block but reverted, so its intended effect did not take place`;
  const transfer =
    valueWei === null || valueWei === 0n
      ? // "0 ETH" rather than "no native ETH": a zero-value transfer is what the
        // question asks about by name, and the digit is the token a ground truth
        // stating the amount will carry.
        `It sent 0 ${chain.symbol}`
      : `It sent ${valueExact ?? value} ${chain.symbol}`;
  const parties = selfTransfer
    ? `from ${tx.from} back to the same address ${tx.to}, so the sender and the recipient are identical and this was a self-transfer`
    : `from ${tx.from ?? 'an unknown sender'} to ${
        contractCreated
          ? `a newly deployed contract at ${contractCreated}`
          : (tx.to ?? 'a contract creation with no recipient')
      }`;
  const blockSentence = blockNumber === null ? '' : ` in block ${blockNumber}`;
  // Whether a contract was invoked is one of the things this intent is asked
  // outright, so it is stated rather than left to be inferred from calldata.
  const callSentence =
    contractCall === null
      ? ''
      : contractCall
        ? contractCreated
          ? ` The transaction deployed a contract at ${contractCreated}.`
          : ` The transaction invoked a contract function with selector ${methodSelector ?? 'unknown'}.`
        : ' The transaction carried no calldata, so it was a plain value transfer that invoked no contract.';

  // What this intent is asked is which addresses were involved and how much
  // native value moved. Those facts lead, and gas, fee and confirmation count
  // are left to the structured fields: when they appeared in the prose the
  // summariser kept them and dropped the addresses, which is how an answer
  // naming neither party scored 0.0075 against 0.998 for one that did.
  // A yes/no question gets a yes or a no first. The recorded ground truth for
  // the recurring self-transfer question opens "Yes, both the sender and
  // recipient are ..."; leading with the transaction hash answers second.
  const leadIn = selfTransfer
    ? `Yes, both the sender and the recipient are ${tx.from}. `
    : selfTransfer === false
      ? `No, the sender and the recipient are different addresses. `
      : '';

  const reason =
    `${leadIn}Transaction ${normalized} on ${chain.name} (chain ID ${chain.chainId}) ${outcome}` +
    `${blockSentence}. ${transfer} ${parties}.${callSentence}`;

  return {
    ...base,
    found: true,
    self_transfer: selfTransfer,
    contract_call: contractCall,
    method_selector: methodSelector,
    status,
    verdict: status,
    block_number: blockNumber,
    confirmations,
    from: tx.from ?? null,
    to: tx.to ?? null,
    contract_created: contractCreated,
    value,
    value_exact: valueExact,
    value_wei: valueWei === null ? null : valueWei.toString(),
    gas_used: gasUsed === null ? null : gasUsed.toString(),
    effective_gas_price_gwei: gasPrice === null ? null : formatUnits(gasPrice, 9, 4),
    fee_native: feeWei === null ? null : formatUnits(feeWei, chain.decimals, 8),
    nonce,
    reason,
  };
}
