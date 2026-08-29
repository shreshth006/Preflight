import tls from 'node:tls';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import {
  DEFAULT_TLS_OPTIONS,
  type CertificateDetails,
  type TLSVerificationOptions,
  type TLSVerificationResult,
} from './types.js';
import { DNSResolutionError, resolveDeterministically } from './dns.js';
import { parseSubjectAlternativeNames, parseTarget } from './hostname.js';
import { isSafeAddress } from '../security/ssrf.js';

function elapsed(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function principalMatches(left: tls.Certificate, right: tls.Certificate): boolean {
  const keys: Array<keyof tls.Certificate> = ['C', 'CN', 'L', 'O', 'OU', 'ST'];
  const compared = keys.filter((key) => left[key] !== undefined && right[key] !== undefined);
  return (
    compared.length > 0 &&
    compared.every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]))
  );
}

function hasPresentedIssuer(chain: tls.PeerCertificate[]): boolean {
  if (chain.length < 2) return false;
  const leaf = chain[0];
  const issuer = chain[1];
  return Boolean(leaf && issuer && principalMatches(leaf.issuer, issuer.subject));
}

function isTimeout(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ETIMEDOUT' || /timed out/i.test(errorMessage(error));
}

function baseResult(
  input: string,
  host: string,
  port: number,
  total: number,
): TLSVerificationResult {
  return {
    input,
    normalizedHost: host,
    port,
    reachable: false,
    dnsResolved: false,
    handshakeSucceeded: false,
    certificatePresent: false,
    chainTrusted: null,
    hostnameValid: null,
    timeValid: null,
    valid: false,
    failureCode: 'UNKNOWN',
    network: { resolvedAddresses: [] },
    timingMs: { total },
  };
}

function getCertificate(socket: tls.TLSSocket): {
  certificate?: CertificateDetails;
  present: boolean;
} {
  type PeerWithIssuer = tls.PeerCertificate & { issuerCertificate?: tls.PeerCertificate };
  const peer = socket.getPeerCertificate(true) as PeerWithIssuer;
  if (!peer || Object.keys(peer).length === 0) return { present: false };
  const chain: tls.PeerCertificate[] = [];
  let current: tls.PeerCertificate | undefined = peer;
  const seen = new Set<string>();
  while (current && Object.keys(current).length > 0 && chain.length < 32) {
    const key = `${current.fingerprint256 ?? ''}|${current.serialNumber ?? ''}|${current.valid_to ?? ''}`;
    if (seen.has(key)) break;
    seen.add(key);
    chain.push(current);
    const next: tls.PeerCertificate | undefined = (current as PeerWithIssuer).issuerCertificate;
    if (!next || next === current) break;
    current = next;
  }
  const certificate: CertificateDetails = {
    chainLength: chain.length,
    chainComplete: hasPresentedIssuer(chain),
  };
  const subject = firstString(peer.subject?.CN);
  const issuer = firstString(peer.issuer?.O) ?? firstString(peer.issuer?.CN);
  if (subject) certificate.subject = subject;
  if (issuer) certificate.issuer = issuer;
  if (peer.serialNumber) certificate.serialNumber = peer.serialNumber;
  if (peer.fingerprint256) certificate.fingerprint256 = peer.fingerprint256;
  const validFrom = isoDate(peer.valid_from);
  const validTo = isoDate(peer.valid_to);
  if (validFrom) certificate.validFrom = validFrom;
  if (validTo) certificate.validTo = validTo;
  if (typeof peer.bits === 'number' && Number.isInteger(peer.bits)) certificate.keyBits = peer.bits;
  const subjectAltNames = parseSubjectAlternativeNames(peer.subjectaltname);
  if (subjectAltNames) certificate.subjectAltNames = subjectAltNames;
  return { certificate, present: true };
}

function verifyAttempt(
  hostname: string,
  port: number,
  address: string,
  options: TLSVerificationOptions,
): Promise<{ result: Partial<TLSVerificationResult>; retryable: boolean }> {
  return new Promise((resolve) => {
    const connectStarted = performance.now();
    let settled = false;
    const connectTimer = setTimeout(
      () => finish({ failureCode: 'TIMEOUT', failureMessage: 'TCP connection timed out' }, true),
      options.connectTimeoutMs,
    );
    const handshakeTimer = setTimeout(
      () => finish({ failureCode: 'TIMEOUT', failureMessage: 'TLS handshake timed out' }, true),
      options.handshakeTimeoutMs,
    );
    const socketOptions: tls.ConnectionOptions = {
      host: address,
      port,
      ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
      rejectUnauthorized: false,
      ...(options.ca === undefined ? {} : { ca: options.ca }),
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.3',
      checkServerIdentity: (requestedHost, certificate) =>
        tls.checkServerIdentity(hostname || requestedHost, certificate),
    };
    const socket = tls.connect(socketOptions);
    const finish = (result: Partial<TLSVerificationResult>, retryable: boolean): void => {
      if (settled) return;
      settled = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (handshakeTimer) clearTimeout(handshakeTimer);
      socket.destroy();
      resolve({ result, retryable });
    };
    socket.once('connect', () => {
      const connectMs = elapsed(connectStarted);
      socket.once('secureConnect', () => {
        const certificate = getCertificate(socket);
        const hostnameError = tls.checkServerIdentity(hostname, socket.getPeerCertificate());
        const timeNow = (options.now ?? (() => new Date()))();
        const validFrom = certificate.certificate?.validFrom
          ? Date.parse(certificate.certificate.validFrom)
          : Number.NaN;
        const validTo = certificate.certificate?.validTo
          ? Date.parse(certificate.certificate.validTo)
          : Number.NaN;
        const timeValid =
          Number.isFinite(validFrom) &&
          Number.isFinite(validTo) &&
          timeNow.getTime() >= validFrom &&
          timeNow.getTime() <= validTo;
        const chainTrusted = socket.authorized;
        const hostnameValid = !hostnameError;
        const cipher = socket.getCipher();
        const failureCode = !certificate.present
          ? 'NO_CERTIFICATE'
          : !hostnameValid
            ? 'HOSTNAME_MISMATCH'
            : !timeValid
              ? timeNow.getTime() < validFrom
                ? 'NOT_YET_VALID'
                : 'EXPIRED'
              : !chainTrusted
                ? 'UNTRUSTED_CHAIN'
                : 'NONE';
        const attemptResult: Partial<TLSVerificationResult> = {
          reachable: true,
          handshakeSucceeded: true,
          certificatePresent: certificate.present,
          chainTrusted,
          hostnameValid,
          timeValid,
          valid: failureCode === 'NONE',
          failureCode,
          cipher: cipher.standardName || cipher.name,
          timingMs: {
            connect: connectMs,
            handshake: elapsed(connectStarted),
            total: elapsed(connectStarted),
          },
        };
        const protocol = socket.getProtocol();
        if (protocol) attemptResult.tlsProtocol = protocol;
        if (certificate.certificate) attemptResult.certificate = certificate.certificate;
        if (certificate.certificate?.keyBits !== undefined)
          attemptResult.keyBits = certificate.certificate.keyBits;
        const failureMessage = hostnameError?.message ?? socket.authorizationError;
        if (failureMessage)
          attemptResult.failureMessage =
            typeof failureMessage === 'string' ? failureMessage : failureMessage.message;
        finish(attemptResult, false);
      });
    });
    socket.once('error', (error: Error) => {
      const code = errorCode(error);
      const retryable =
        code === 'ECONNREFUSED' ||
        code === 'ECONNRESET' ||
        code === 'EHOSTUNREACH' ||
        code === 'ENETUNREACH' ||
        isTimeout(error);
      finish(
        {
          reachable: code !== 'ECONNREFUSED' && code !== 'EHOSTUNREACH' && code !== 'ENETUNREACH',
          handshakeSucceeded: false,
          failureCode: isTimeout(error)
            ? 'TIMEOUT'
            : socket.authorizationError
              ? 'UNTRUSTED_CHAIN'
              : 'HANDSHAKE_FAILURE',
          failureMessage: error.message,
          timingMs: { connect: elapsed(connectStarted), total: elapsed(connectStarted) },
        },
        retryable,
      );
    });
  });
}

export async function verifyTLS(
  input: string,
  suppliedOptions: Partial<TLSVerificationOptions> = {},
): Promise<TLSVerificationResult> {
  const options: TLSVerificationOptions = { ...DEFAULT_TLS_OPTIONS, ...suppliedOptions };
  const started = performance.now();
  let target;
  try {
    target = parseTarget(input, options.maxInputLength);
  } catch (error) {
    const result = baseResult(String(input), '', 443, elapsed(started));
    result.failureCode = 'INVALID_CERTIFICATE';
    result.failureMessage = errorMessage(error);
    result.timingMs.total = elapsed(started);
    return result;
  }
  const result = baseResult(target.input, target.hostname, target.port, 0);
  const remainingMs = (): number => options.requestTimeoutMs - elapsed(started);
  try {
    if (target.isIpLiteral && !isSafeAddress(target.hostname, options.allowPrivateTargets)) {
      throw new Error(`unsafe destination address blocked: ${target.hostname}`);
    }
    const resolution = target.isIpLiteral
      ? {
          addresses: [
            {
              address: target.hostname,
              family: target.hostname.includes(':') ? (6 as const) : (4 as const),
            },
          ],
          elapsedMs: 0,
        }
      : await resolveDeterministically(
          target.hostname,
          Math.min(options.dnsTimeoutMs, Math.max(1, remainingMs())),
          options.allowPrivateTargets,
        );
    result.dnsResolved = true;
    result.network.resolvedAddresses = resolution.addresses.map((entry) => entry.address);
    result.timingMs.dns = resolution.elapsedMs;
    let lastAttempt: Partial<TLSVerificationResult> = { failureCode: 'UNKNOWN' };
    for (const address of resolution.addresses) {
      if (remainingMs() <= 0) {
        lastAttempt = { failureCode: 'TIMEOUT', failureMessage: 'request deadline exceeded' };
        break;
      }
      const attemptOptions: TLSVerificationOptions = {
        ...options,
        connectTimeoutMs: Math.min(options.connectTimeoutMs, Math.max(1, remainingMs())),
        handshakeTimeoutMs: Math.min(options.handshakeTimeoutMs, Math.max(1, remainingMs())),
      };
      const attempt = await verifyAttempt(
        target.hostname,
        target.port,
        address.address,
        attemptOptions,
      );
      lastAttempt = attempt.result;
      Object.assign(result, attempt.result);
      result.network.selectedAddress = address.address;
      result.network.family = address.family;
      if (!attempt.retryable || attempt.result.handshakeSucceeded) break;
    }
    if (lastAttempt.failureCode === 'UNKNOWN') result.failureCode = 'UNKNOWN';
  } catch (error) {
    const message = errorMessage(error);
    const code = errorCode(error);
    result.failureCode = /unsafe destination/.test(message)
      ? 'CONNECTION_FAILURE'
      : isTimeout(error)
        ? 'TIMEOUT'
        : error instanceof DNSResolutionError ||
            code === 'ENOTFOUND' ||
            code === 'EAI_AGAIN' ||
            /DNS/i.test(message)
          ? 'DNS_FAILURE'
          : 'CONNECTION_FAILURE';
    result.failureMessage = message;
  }
  result.valid =
    result.reachable &&
    result.handshakeSucceeded &&
    result.certificatePresent &&
    result.chainTrusted === true &&
    result.hostnameValid === true &&
    result.timeValid === true;
  result.timingMs.total = elapsed(started);
  return result;
}
