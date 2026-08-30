import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const file = process.argv[2] ?? 'telegraph/miner.yaml';
const allowedEndpointKeys = new Set([
  'path',
  'external_path',
  'method',
  'description',
  'endpoint_base_url',
  'content_type',
  'multipart_fields',
  'param_map',
]);
const allowedRootKeys = new Set([
  'version',
  'kind',
  'id',
  'slug',
  'protocol',
  'name',
  'description',
  'base_url',
  'docs',
  'auth',
  'rate_limit_per_sec',
  'cache_ttl_sec',
  'circuit_threshold',
  'circuit_cooldown_seconds',
  'limitations',
  'errors',
  'endpoints',
  'input_schema',
  'output_schema',
  'semantics',
  'on_chain',
  'polling',
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

const raw = await readFile(file, 'utf8');
const root = record(parse(raw), 'root');
for (const key of Object.keys(root))
  if (!allowedRootKeys.has(key)) throw new Error(`root has unsupported field: ${key}`);
const required = ['version', 'kind', 'id', 'slug', 'name', 'base_url'];
for (const key of required) if (!(key in root)) throw new Error(`missing required field: ${key}`);
if (root.version !== '1') throw new Error('version must be "1"');
if (root.kind !== 'miner') throw new Error('kind must be "miner"');
if (typeof root.id !== 'number' || !Number.isInteger(root.id))
  throw new Error('id must be an integer');
if (typeof root.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(root.slug))
  throw new Error('slug must be lowercase kebab-case');
if (typeof root.base_url !== 'string' || !/^https?:\/\//.test(root.base_url))
  throw new Error('base_url must start with http:// or https://');
const endpoints = root.endpoints;
if (!Array.isArray(endpoints) || endpoints.length === 0)
  throw new Error('at least one endpoint is required');
for (const [index, endpointValue] of endpoints.entries()) {
  const endpoint = record(endpointValue, `endpoints[${index}]`);
  for (const key of Object.keys(endpoint))
    if (!allowedEndpointKeys.has(key))
      throw new Error(`endpoints[${index}] has unsupported field: ${key}`);
  for (const key of ['path', 'external_path', 'method'])
    if (typeof endpoint[key] !== 'string')
      throw new Error(`endpoints[${index}].${key} must be a string`);
}
const semantics = record(root.semantics, 'semantics');
const supported = semantics.supported_intents;
if (!Array.isArray(supported) || supported.length === 0)
  throw new Error('supported_intents must declare at least one intent');
if (!supported.includes('SSL_VERIFICATION'))
  throw new Error('supported_intents must include SSL_VERIFICATION, the primary intent');

// Declaring an intent the miner cannot serve is worse than not declaring it:
// the node routes traffic we would answer with an error. Every intent must
// map to an endpoint that exists in this file.
const INTENT_ENDPOINTS: Record<string, string> = {
  SSL_VERIFICATION: '/ssl-check',
  URL_SCAN: '/url-scan',
  GAS_PRICE: '/gas-price',
  WALLET_BALANCE_CHECK: '/wallet-balance',
  ONCHAIN_TX_LOOKUP: '/tx-lookup',
  TVL_LOOKUP: '/tvl',
  CRYPTO_PRICE: '/crypto-price',
  CURRENCY_EXCHANGE: '/fx-rate',
  IP_GEOLOCATION: '/ip-geolocation',
  STOCK_PRICE: '/stock-price',
  ACADEMIC_SEARCH: '/papers',
  CVE_LOOKUP: '/cve',
};
const paths = new Set(
  endpoints.map((endpointValue) => record(endpointValue, 'endpoint').path as string),
);
for (const intent of supported as string[]) {
  const expected = INTENT_ENDPOINTS[intent];
  if (!expected) throw new Error(`intent ${intent} has no endpoint mapping in this validator`);
  if (!paths.has(expected))
    throw new Error(`intent ${intent} is declared but endpoint ${expected} is missing`);
}

// The production host is a single Vercel function behind explicit rewrites.
// A manifest-only endpoint works locally but returns 404 after deployment, so
// verify that every advertised external path reaches the function as part of
// the same config gate.
const vercel = record(JSON.parse(await readFile('vercel.json', 'utf8')), 'vercel.json');
if (!Array.isArray(vercel.rewrites)) throw new Error('vercel.json.rewrites must be an array');
const rewrites = new Set(
  vercel.rewrites.map((value, index) => {
    const rewrite = record(value, `vercel.json.rewrites[${index}]`);
    if (typeof rewrite.source !== 'string' || typeof rewrite.destination !== 'string')
      throw new Error(`vercel.json.rewrites[${index}] needs string source and destination`);
    return rewrite.source;
  }),
);
for (const [index, endpointValue] of endpoints.entries()) {
  const endpoint = record(endpointValue, `endpoints[${index}]`);
  const externalPath = endpoint.external_path as string;
  if (!rewrites.has(externalPath))
    throw new Error(`endpoint ${externalPath} is advertised but missing from vercel.json rewrites`);
}

const mapping = record(semantics.signal_mapping, 'semantics.signal_mapping');
for (const key of ['confidence_field', 'label_field', 'reason_field'])
  if (typeof mapping[key] !== 'string')
    throw new Error(`semantics.signal_mapping.${key} must be a string`);

if (!root.input_schema || !root.output_schema)
  throw new Error('top-level input_schema and output_schema are required by PREFLIGHT');
process.stdout.write(
  JSON.stringify({
    valid: true,
    file,
    intents: supported,
    endpointCount: endpoints.length,
  }) + '\n',
);
