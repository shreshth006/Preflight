import { formatUnits, hexToBigInt, isAddress, rpcCall, type ChainInfo } from '../chain/rpc.js';

export interface WalletBalanceResponse {
  address: string;
  ens_name: string | null;
  chain: string;
  chain_id: number;
  balance_wei: string;
  balance: string;
  symbol: string;
  decimals: number;
  transaction_count: number | null;
  is_contract: boolean | null;
  account_type: 'eoa' | 'contract' | 'delegated_eoa' | null;
  delegate_address: string | null;
  funded: boolean;
  verdict: 'funded' | 'empty';
  block_number: number | null;
  explorer_url: string;
  confidence: number;
  reason: string;
  checked_at: string;
}

// EIP-7702 sets an EOA's code to the 23-byte designator 0xef0100 || address.
// Treating that as contract bytecode would misclassify every smart-account
// wallet — including ordinary user wallets — as a contract.
const DELEGATION_PREFIX = '0xef0100';

function classifyAccount(code: string | null): {
  type: WalletBalanceResponse['account_type'];
  delegate: string | null;
} {
  if (code === null) return { type: null, delegate: null };
  if (code === '0x' || code === '') return { type: 'eoa', delegate: null };
  if (
    code.toLowerCase().startsWith(DELEGATION_PREFIX) &&
    code.length === DELEGATION_PREFIX.length + 40
  ) {
    return { type: 'delegated_eoa', delegate: `0x${code.slice(DELEGATION_PREFIX.length)}` };
  }
  return { type: 'contract', delegate: null };
}

export async function getWalletBalance(
  address: string,
  chain: ChainInfo,
  now = new Date(),
  ensName: string | null = null,
): Promise<WalletBalanceResponse> {
  const normalized = address.trim();
  if (!isAddress(normalized)) {
    throw new TypeError(`not a valid EVM address: ${normalized}`);
  }

  const [balanceHex, nonceHex, codeHex, blockHex] = await Promise.all([
    rpcCall<string>(chain, 'eth_getBalance', [normalized, 'latest']),
    rpcCall<string>(chain, 'eth_getTransactionCount', [normalized, 'latest']).catch(() => null),
    rpcCall<string>(chain, 'eth_getCode', [normalized, 'latest']).catch(() => null),
    rpcCall<string>(chain, 'eth_blockNumber', []).catch(() => null),
  ]);

  const balanceWei = hexToBigInt(balanceHex);
  const balance = formatUnits(balanceWei, chain.decimals, 8);
  const nonce = nonceHex === null ? null : Number(hexToBigInt(nonceHex));
  const { type: accountType, delegate } = classifyAccount(codeHex);
  const isContract = accountType === null ? null : accountType === 'contract';
  const blockNumber = blockHex === null ? null : Number(hexToBigInt(blockHex));
  const funded = balanceWei > 0n;

  const kind =
    accountType === 'contract'
      ? 'contract account'
      : accountType === 'delegated_eoa'
        ? `externally owned account with an EIP-7702 delegation to ${delegate}`
        : accountType === 'eoa'
          ? 'externally owned account'
          : 'account';
  const holding = funded
    ? `holds a balance of ${balance} ${chain.symbol}`
    : `holds no ${chain.symbol} balance (0 ${chain.symbol})`;

  const subject = ensName ? `${ensName} (${normalized})` : normalized;
  // Address, amount and chain are what this intent is asked for, and they lead.
  // Outbound-transaction count and the observed block follow as structured
  // fields rather than prose: in ONCHAIN_TX_LOOKUP the same peripheral detail
  // displaced the addresses from the summary the node actually scores.
  const reason =
    `The address ${subject} on ${chain.name} (chain ID ${chain.chainId}) ${holding}, ` +
    `equal to ${balanceWei.toString()} wei. It is ${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind}. ` +
    `This balance covers only the native ${chain.symbol} token and does not include ERC-20 holdings.`;

  return {
    address: normalized,
    ens_name: ensName,
    chain: chain.key,
    chain_id: chain.chainId,
    balance_wei: balanceWei.toString(),
    balance,
    symbol: chain.symbol,
    decimals: chain.decimals,
    transaction_count: nonce,
    is_contract: isContract,
    account_type: accountType,
    delegate_address: delegate,
    funded,
    verdict: funded ? 'funded' : 'empty',
    block_number: blockNumber,
    explorer_url: `${chain.explorer}/address/${normalized}`,
    confidence: 1,
    reason,
    checked_at: now.toISOString(),
  };
}
