import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractDomain, extractDomainFromQuery } from '../telegraph/request.js';
import {
  findAddress,
  findChain,
  findEnsName,
  findSubject,
  findTxHash,
  findUrl,
  valuesFromBody,
  valuesFromQuery,
  type RequestValues,
} from '../telegraph/params.js';
import { toTelegraphResponse } from '../telegraph/response.js';
import { verifyTLS } from '../tls/verify.js';
import type { TLSVerificationOptions } from '../tls/types.js';
import { chainFromText, lookupChain, resolveChain, SUPPORTED_CHAINS } from '../chain/rpc.js';
import { resolveEnsName } from '../chain/ens.js';
import { getGasPrice } from '../intents/gasPrice.js';
import { getWalletBalance } from '../intents/walletBalance.js';
import { lookupTransaction } from '../intents/onchainTx.js';
import { scanUrl } from '../intents/urlScan.js';
import { lookupTvl } from '../intents/tvl.js';
import { getCryptoPrice } from '../intents/cryptoPrice.js';
import type { AppConfig } from './config.js';
import { createLogger } from '../observability/logger.js';

const MAX_BODY_BYTES = 64 * 1024;

interface IntentRoute {
  intent: string;
  handle(values: RequestValues, config: AppConfig): Promise<unknown>;
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
      return getGasPrice(chainFor(values));
    },
  },
  '/wallet-balance': {
    intent: 'WALLET_BALANCE_CHECK',
    handle: async (values) => {
      const chain = chainFor(values);
      const address = findAddress(values);
      if (address) return getWalletBalance(address, chain);
      // The intent explicitly covers ENS names, which resolve on mainnet
      // regardless of which chain the balance is then read from.
      const ensName = findEnsName(values);
      if (ensName) {
        const resolved = await resolveEnsName(ensName);
        if (resolved) return getWalletBalance(resolved, chain, new Date(), ensName);
        throw new TypeError(`ENS name does not resolve to an address: ${ensName}`);
      }
      throw new TypeError(
        'missing required field: address (an 0x-prefixed EVM address or an ENS name)',
      );
    },
  },
  '/tx-lookup': {
    intent: 'ONCHAIN_TX_LOOKUP',
    handle: async (values) => {
      const hash = findTxHash(values);
      if (!hash)
        throw new TypeError('missing required field: hash (a 0x-prefixed transaction hash)');
      return lookupTransaction(hash, chainFor(values));
    },
  },
  '/url-scan': {
    intent: 'URL_SCAN',
    handle: async (values, config) => {
      const target = findUrl(values);
      if (!target) throw new TypeError('missing required field: url');
      return scanUrl(target, tlsOptionsFrom(config));
    },
  },
  '/crypto-price': {
    intent: 'CRYPTO_PRICE',
    handle: async (values) => {
      const subject = findSubject(values) ?? values.all()[0];
      if (!subject) throw new TypeError('missing required field: asset');
      return getCryptoPrice(subject, new Date(), values.all().join(' '));
    },
  },
  '/tvl': {
    intent: 'TVL_LOOKUP',
    handle: async (values) => {
      const subject = findSubject(values) ?? values.all()[0];
      if (!subject) throw new TypeError('missing required field: protocol');
      // "Aave V3 on the Ethereum chain" asks for that chain's share, not the
      // protocol total across every deployment.
      const named = findChain(values);
      return lookupTvl(subject, new Date(), lookupChain(named ?? '')?.name);
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
        send(response, 404, { error: 'not_found', code: 'NOT_FOUND', requestId: id }, id);
        return;
      }

      const intentRoute = INTENT_ROUTES[url.pathname];
      if (intentRoute) {
        const body = method === 'GET' ? undefined : await readBody(request);
        const values = method === 'GET' ? valuesFromQuery(url.searchParams) : valuesFromBody(body);
        const payload = await intentRoute.handle(values, config);
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
      const tlsResult = await verifyTLS(requestInput.domain, {
        maxInputLength: config.maxInputLength,
        requestTimeoutMs: config.requestTimeoutMs,
        dnsTimeoutMs: config.dnsTimeoutMs,
        connectTimeoutMs: config.connectTimeoutMs,
        handshakeTimeoutMs: config.handshakeTimeoutMs,
        allowPrivateTargets: config.allowPrivateTargets,
      });
      const telegraphResponse = toTelegraphResponse(tlsResult);
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
