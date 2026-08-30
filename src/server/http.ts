import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractDomain, extractDomainFromQuery } from '../telegraph/request.js';
import {
  findAddress,
  findMalformedAddress,
  findChain,
  findEnsName,
  findSubject,
  findTvlSubject,
  findTxHash,
  findUrl,
  valuesFromBody,
  valuesFromQuery,
  type RequestValues,
} from '../telegraph/params.js';
import { toTelegraphResponse } from '../telegraph/response.js';
import { parentDomainEvidence } from '../tls/parentDomain.js';
import { verifyTLS } from '../tls/verify.js';
import type { TLSVerificationOptions } from '../tls/types.js';
import { chainFromText, lookupChain, resolveChain, SUPPORTED_CHAINS } from '../chain/rpc.js';
import { resolveEnsName } from '../chain/ens.js';
import { getGasPrice } from '../intents/gasPrice.js';
import { unanswerable } from '../telegraph/unanswerable.js';
import {
  contextualizeWalletBalance,
  describeMalformedAddress,
  getWalletBalance,
} from '../intents/walletBalance.js';
import { lookupTransaction } from '../intents/onchainTx.js';
import {
  describeDocumentedIncident,
  describeUnknownIncident,
  scanUrl,
} from '../intents/urlScan.js';
import { lookupTvl } from '../intents/tvl.js';
import { getExchangeRate } from '../intents/currencyExchange.js';
import { locateIp } from '../intents/ipGeolocation.js';
import { getStockPrice } from '../intents/stockPrice.js';
import { getCryptoPrice } from '../intents/cryptoPrice.js';
import { searchAcademicPapers } from '../intents/academicSearch.js';
import type { AppConfig } from './config.js';
import { createLogger } from '../observability/logger.js';

const MAX_BODY_BYTES = 64 * 1024;

interface IntentRoute {
  intent: string;
  handle(values: RequestValues, config: AppConfig): Promise<unknown>;
}

interface RequestFailureResponse {
  verdict: 'not_found' | 'unavailable';
  found: false;
  confidence: number;
  reason: string;
  checked_at: string;
  missing: string;
}

const REQUEST_SUBJECTS: Record<string, string> = {
  '/ssl-check': 'TLS/SSL certificate verification',
  '/v1/ssl-check': 'TLS/SSL certificate verification',
  '/url-scan': 'URL safety assessment',
  '/gas-price': 'gas-price lookup',
  '/wallet-balance': 'wallet-balance lookup',
  '/tx-lookup': 'transaction lookup',
  '/crypto-price': 'cryptocurrency-price lookup',
  '/tvl': 'total-value-locked lookup',
  '/fx-rate': 'currency-exchange lookup',
  '/ip-geolocation': 'IP-geolocation lookup',
  '/stock-price': 'stock-price lookup',
  '/papers': 'academic-paper search',
};

function requestFailure(path: string, message: string, invalid: boolean): RequestFailureResponse {
  const subject = REQUEST_SUBJECTS[path] ?? 'intent lookup';
  const detail = message.replace(/[.!?]+$/, '');
  return {
    verdict: invalid ? 'not_found' : 'unavailable',
    found: false,
    confidence: 1,
    checked_at: new Date().toISOString(),
    missing: invalid ? 'valid request input' : 'a completed upstream result',
    reason: invalid
      ? `The ${subject} cannot be completed because the supplied request is invalid: ${detail}. ` +
        'No result is returned rather than guessing the missing or malformed input.'
      : `The ${subject} is temporarily unavailable because a required dependency failed before ` +
        'a verified result was produced. No result is returned rather than inventing one.',
  };
}

const MALFORMED_SENTINELS = new Set(['[object Object]', 'undefined', 'null', 'NaN', 'Infinity']);

function containsOnlyMalformedSentinels(values: RequestValues): boolean {
  const supplied = values.all().map((value) => value.trim());
  return supplied.length > 0 && supplied.every((value) => MALFORMED_SENTINELS.has(value));
}

function tlsOptionsFrom(config: AppConfig): Partial<TLSVerificationOptions> {
  return {
    maxInputLength: config.maxInputLength,
    requestTimeoutMs: config.requestTimeoutMs,
    dnsTimeoutMs: config.dnsTimeoutMs,
    connectTimeoutMs: config.connectTimeoutMs,
    handshakeTimeoutMs: config.handshakeTimeoutMs,
    allowPrivateTargets: config.allowPrivateTargets,
  };
}

// An explicitly named chain we do not serve is an error, not a cue to answer
// about Ethereum instead. A chain named only in free text is advisory, and a
// question naming none at all defaults to Ethereum.
function chainFor(values: RequestValues): ReturnType<typeof resolveChain> {
  const named = findChain(values);
  if (named) {
    const found = lookupChain(named);
    if (!found)
      throw new TypeError(`unsupported chain: ${named}. PREFLIGHT serves ${SUPPORTED_CHAINS}.`);
    return found;
  }
  return resolveChain(chainFromText(values.text())?.key);
}

const INTENT_ROUTES: Record<string, IntentRoute> = {
  '/gas-price': {
    intent: 'GAS_PRICE',
    handle: async (values) => {
      const named = findChain(values);
      if (named && !lookupChain(named)) {
        return unanswerable(
          `An average transaction fee on ${named}`,
          'a supported EVM network',
          `PREFLIGHT measures transaction fees on ${SUPPORTED_CHAINS}.`,
        );
      }
      return getGasPrice(chainFor(values));
    },
  },
  '/wallet-balance': {
    intent: 'WALLET_BALANCE_CHECK',
    handle: async (values) => {
      const chain = chainFor(values);
      const contextualize = (result: Awaited<ReturnType<typeof getWalletBalance>>) =>
        contextualizeWalletBalance(result, values.context());
      const address = findAddress(values);
      if (address) return contextualize(await getWalletBalance(address, chain));
      // The intent explicitly covers ENS names, which resolve on mainnet
      // regardless of which chain the balance is then read from.
      const ensName = findEnsName(values);
      if (ensName) {
        const resolved = await resolveEnsName(ensName);
        if (resolved)
          return contextualize(await getWalletBalance(resolved, chain, new Date(), ensName));
        throw new TypeError(`ENS name does not resolve to an address: ${ensName}`);
      }
      // A hex string that was meant to be an address but is the wrong length
      // is a question we can answer rather than a request we should refuse:
      // no account exists at it, so its balance is zero.
      const malformed = findMalformedAddress(values);
      if (malformed) return contextualize(describeMalformedAddress(malformed, chain));
      return unanswerable(
        `A native-coin balance on ${chain.name}`,
        'a wallet address',
        'A balance lookup needs a 0x-prefixed EVM address or an ENS name.',
      );
    },
  },
  '/tx-lookup': {
    intent: 'ONCHAIN_TX_LOOKUP',
    handle: async (values) => {
      const hash = findTxHash(values);
      if (!hash)
        return unanswerable(
          'A transaction lookup',
          'a transaction hash',
          'A lookup needs a 0x-prefixed 32-byte transaction hash.',
        );
      return lookupTransaction(hash, chainFor(values));
    },
  },
  '/url-scan': {
    intent: 'URL_SCAN',
    handle: async (values, config) => {
      const questionContext = values.context();
      const questionText = questionContext ?? values.text();
      const target = findUrl(values);
      if (!target) {
        const documented = describeDocumentedIncident(questionText);
        if (documented) return documented;
        if (questionContext) return describeUnknownIncident();
        return unanswerable(
          'A URL safety assessment',
          'a URL or a documented incident',
          'A scan needs a URL to retrieve, or the name of a documented domain incident to report on.',
        );
      }
      return scanUrl(target, tlsOptionsFrom(config), new Date(), questionText);
    },
  },
  '/crypto-price': {
    intent: 'CRYPTO_PRICE',
    handle: async (values) => {
      const subject = findSubject(values) ?? values.all()[0];
      if (!subject) {
        return unanswerable(
          'A cryptocurrency price',
          'an asset',
          'A quote needs a ticker such as BTC or a name such as Bitcoin.',
        );
      }
      return getCryptoPrice(subject, new Date(), values.context() ?? values.text());
    },
  },
  '/fx-rate': {
    intent: 'CURRENCY_EXCHANGE',
    handle: async (values) => {
      // The pair may be named as codes, as words, or inside a whole question,
      // so the full request text is what gets scanned.
      const text = values.all().join(' ');
      if (!text) {
        return unanswerable(
          'An exchange rate',
          'a currency pair',
          'A rate needs two currencies, as ISO 4217 codes such as USD and EUR or as their names.',
        );
      }
      const amountText = values.get(['amount', 'value', 'quantity']);
      const amount = amountText === undefined ? undefined : Number(amountText.replace(/,/g, ''));
      const from = values.get(['from', 'base', 'source_currency', 'source']);
      const to = values.get(['to', 'quote', 'target_currency', 'target']);
      const date = values.get(['date', 'as_of', 'on']);
      return getExchangeRate(text, new Date(), {
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
        ...(date === undefined ? {} : { date }),
        ...(amount !== undefined && Number.isFinite(amount) && amount > 0 ? { amount } : {}),
      });
    },
  },
  '/ip-geolocation': {
    intent: 'IP_GEOLOCATION',
    handle: async (values) => {
      const text = values.all().join(' ');
      if (!text) {
        return unanswerable(
          'A geolocation',
          'an IP address',
          'Geolocation needs an IPv4 or IPv6 address; a hostname must be resolved to one first.',
        );
      }
      return locateIp(text);
    },
  },
  '/stock-price': {
    intent: 'STOCK_PRICE',
    handle: async (values) => {
      const subject = findSubject(values) ?? values.all()[0];
      if (!subject) {
        return unanswerable(
          'An equity quote',
          'a ticker symbol',
          'A quote needs a listed symbol such as AAPL, or a company name that maps to one.',
        );
      }
      return getStockPrice(values.all().join(' '));
    },
  },
  '/papers': {
    intent: 'ACADEMIC_SEARCH',
    handle: async (values) => {
      const directTopic = values.get(['topic', 'subject', 'keywords', 'search']);
      const context = values.context();
      const input = context ?? directTopic ?? values.text();
      if (!input) {
        return unanswerable(
          'An academic-paper search',
          'a research topic',
          'A paper search needs a subject such as quantum error correction or AI safety.',
        );
      }
      return searchAcademicPapers(input);
    },
  },
  '/tvl': {
    intent: 'TVL_LOOKUP',
    handle: async (values) => {
      const subject = findTvlSubject(values);
      if (!subject) {
        return unanswerable(
          'A total value locked figure',
          'a protocol or chain',
          'A TVL lookup needs the name of a DeFi protocol such as Aave V3, or of a chain.',
        );
      }
      // "Aave V3 on the Ethereum chain" asks for that chain's share, not the
      // protocol total across every deployment.
      const named = findChain(values) ?? chainFromText(values.text())?.key;
      return lookupTvl(subject, new Date(), lookupChain(named ?? '')?.name, values.context());
    },
  },
};

const MAX_LOGGED_INPUT = 512;

/** Parameter names a caller used, so a parsing miss is diagnosable. */
function describeKeys(query: URLSearchParams, body: unknown): string[] {
  const keys = [...new Set([...query.keys()])];
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const key of Object.keys(body)) keys.push(key);
  }
  return [...new Set(keys)];
}

/** The values a caller sent, truncated so one request cannot flood the log. */
function describeInput(query: URLSearchParams, body: unknown): string {
  const parts = [...query.entries()].map(([k, v]) => `${k}=${v}`);
  if (body !== undefined) parts.push(JSON.stringify(body) ?? '');
  const joined = parts.join('&');
  return joined.length > MAX_LOGGED_INPUT ? `${joined.slice(0, MAX_LOGGED_INPUT)}…` : joined;
}

function requestId(request: IncomingMessage): string {
  const supplied = request.headers['x-request-id'];
  return typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : randomUUID();
}

function send(response: ServerResponse, status: number, body: unknown, id: string): void {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-request-id', id);
  response.end(payload);
}

function sendText(
  response: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  id: string,
): void {
  response.statusCode = status;
  response.setHeader('content-type', contentType);
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-request-id', id);
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new TypeError('request body is too large');
    chunks.push(Buffer.from(buffer));
  }
  if (bytes === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new TypeError('request body must be valid JSON');
  }
}

// Bundled layouts differ between the container build (dist/server/) and the
// serverless build, so the YAML is looked up relative to both.
async function readMinerYaml(): Promise<string> {
  const candidates = [
    new URL('../../telegraph/miner.yaml', import.meta.url),
    new URL('../../../telegraph/miner.yaml', import.meta.url),
    pathToFileURL(resolve(process.cwd(), 'telegraph/miner.yaml')),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8');
    } catch {
      continue;
    }
  }
  throw new Error('miner.yaml not found');
}

export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

export function createRequestHandler(config: AppConfig): RequestHandler {
  const log = createLogger(config.logLevel);
  return async (request, response) => {
    const id = requestId(request);
    const started = performance.now();
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    try {
      if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
        send(response, 200, { status: 'ok', service: 'preflight', version: config.version }, id);
        return;
      }
      if (method === 'GET' && url.pathname === '/ready') {
        send(response, 200, { status: 'ready', service: 'preflight' }, id);
        return;
      }
      if (method === 'GET' && url.pathname === '/miner.yaml') {
        const yaml = await readMinerYaml();
        sendText(response, 200, yaml, 'application/yaml; charset=utf-8', id);
        return;
      }
      if (!['GET', 'POST'].includes(method)) {
        if (url.pathname in REQUEST_SUBJECTS) {
          send(
            response,
            200,
            requestFailure(url.pathname, `unsupported HTTP method ${method}`, true),
            id,
          );
          return;
        }
        send(response, 404, { error: 'not_found', code: 'NOT_FOUND', requestId: id }, id);
        return;
      }

      const intentRoute = INTENT_ROUTES[url.pathname];
      if (intentRoute) {
        const body = method === 'GET' ? undefined : await readBody(request);
        const values = method === 'GET' ? valuesFromQuery(url.searchParams) : valuesFromBody(body);
        const payload = containsOnlyMalformedSentinels(values)
          ? requestFailure(url.pathname, 'the request contains only malformed runtime values', true)
          : await intentRoute.handle(values, config);
        // The exact shape a caller used is the only way to tell a parsing
        // miss from a wrong answer, and the router decides that shape rather
        // than we do — so record it alongside what we resolved from it.
        log('intent_request', {
          requestId: id,
          intent: intentRoute.intent,
          path: url.pathname,
          method,
          userAgent: request.headers['user-agent'] ?? null,
          requestKeys: describeKeys(url.searchParams, body),
          rawInput: describeInput(url.searchParams, body),
          response: payload,
          latencyMs: Math.round(performance.now() - started),
        });
        send(response, 200, payload, id);
        return;
      }

      if (!['/ssl-check', '/v1/ssl-check'].includes(url.pathname)) {
        send(response, 404, { error: 'not_found', code: 'NOT_FOUND', requestId: id }, id);
        return;
      }
      const requestInput =
        method === 'GET'
          ? extractDomainFromQuery(url.searchParams)
          : extractDomain(await readBody(request));
      const tlsOptions = {
        maxInputLength: config.maxInputLength,
        requestTimeoutMs: config.requestTimeoutMs,
        dnsTimeoutMs: config.dnsTimeoutMs,
        connectTimeoutMs: config.connectTimeoutMs,
        handshakeTimeoutMs: config.handshakeTimeoutMs,
        allowPrivateTargets: config.allowPrivateTargets,
      };
      const tlsResult = await verifyTLS(requestInput.domain, tlsOptions);
      // An unreachable subdomain still has an observable certificate
      // configuration at its registrable domain, and that is a fact about the
      // hostname that was asked about rather than a substitute for one.
      const parentEvidence =
        tlsResult.reachable && tlsResult.handshakeSucceeded
          ? null
          : await parentDomainEvidence(
              tlsResult.normalizedHost || requestInput.domain,
              tlsOptions,
            ).catch(() => null);
      const telegraphResponse = toTelegraphResponse(tlsResult, new Date(), parentEvidence);
      log('ssl_verification', {
        requestId: id,
        intent: 'SSL_VERIFICATION',
        rawInput: requestInput.domain,
        normalizedHost: tlsResult.normalizedHost,
        resolvedAddresses: tlsResult.network.resolvedAddresses,
        selectedAddress: tlsResult.network.selectedAddress,
        reachable: tlsResult.reachable,
        handshakeSucceeded: tlsResult.handshakeSucceeded,
        chainTrusted: tlsResult.chainTrusted,
        hostnameValid: tlsResult.hostnameValid,
        timeValid: tlsResult.timeValid,
        canonicalValid: tlsResult.valid,
        telegraphResponse,
        latencyMs: Math.round(performance.now() - started),
      });
      send(response, 200, telegraphResponse, id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const invalid = error instanceof TypeError;
      // A request we failed to parse is the most important one to be able to
      // read back, because it is the one that scored nothing.
      log(
        'request_failed',
        {
          requestId: id,
          method,
          path: url.pathname,
          userAgent: request.headers['user-agent'] ?? null,
          requestKeys: describeKeys(url.searchParams, undefined),
          rawInput: describeInput(url.searchParams, undefined),
          error: message,
          latencyMs: Math.round(performance.now() - started),
        },
        invalid ? 'info' : 'error',
      );
      if (url.pathname in REQUEST_SUBJECTS) {
        send(response, 200, requestFailure(url.pathname, message, invalid), id);
        return;
      }
      send(
        response,
        invalid ? 400 : 500,
        {
          error: invalid ? 'invalid_request' : 'internal_error',
          code: invalid ? 'INVALID_INPUT' : 'INTERNAL_ERROR',
          message: invalid ? message : 'unexpected internal error',
          requestId: id,
        },
        id,
      );
    }
  };
}

export function createHttpServer(config: AppConfig): Server {
  const handler = createRequestHandler(config);
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 10_000;
  server.requestTimeout = config.requestTimeoutMs;
  server.timeout = config.requestTimeoutMs;
  return server;
}
