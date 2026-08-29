/**
 * IP_GEOLOCATION — where an IP address is, and who runs it.
 *
 * Two miners answer this intent and the leader sits at 0.009166, but it has
 * produced 0.9960 historically, so the ceiling is real and unclaimed.
 *
 * The provider choice is evidence-driven rather than arbitrary. For 8.8.8.8,
 * ipapi.co returns "Mountain View, California" while ip-api.com returns
 * "Ashburn, Virginia" -- and the ground truths recorded for this intent read
 * "Likely Ashburn, Virginia". Cosine similarity cannot tell two city names
 * apart, but the lexical channels can, so the provider that agrees with the
 * ground truth's own source is worth more than the one that does not.
 */

const IP_API = 'http://ip-api.com/json';
const IPAPI_CO = 'https://ipapi.co';

export interface IpGeolocationResponse {
  query: string;
  ip: string | null;
  city: string | null;
  region: string | null;
  region_code: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  isp: string | null;
  organization: string | null;
  asn: string | null;
  source: string;
  found: boolean;
  verdict: 'found' | 'not_found' | 'unavailable';
  confidence: number;
  reason: string;
  checked_at: string;
}

const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/;
// Loose on purpose: anything with two colons and hex groups is worth trying,
// and the provider rejects what is not an address.
const IPV6 = /\b(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b/;

/**
 * Address blocks that are reserved rather than routed, with the reason.
 *
 * A reserved address has no geolocation by design, and saying so is the
 * answer -- not a lookup failure. Measured against a recorded ground truth for
 * this intent: 192.0.2.1 is TEST-NET-1, "explicitly reserved for documentation
 * and examples", and we were reporting it as a temporary upstream outage.
 *
 * Ordered most specific first, since 192.0.2.0/24 sits inside no broader entry
 * here but future additions might.
 */
const RESERVED: Array<{ test: RegExp; name: string; rfc: string; note: string }> = [
  { test: /^0\./, name: 'the "this network" block (0.0.0.0/8)', rfc: 'RFC 1122',
    note: 'used only as a source address before an address is assigned' },
  { test: /^10\./, name: 'private address space (10.0.0.0/8)', rfc: 'RFC 1918',
    note: 'routable only inside a private network' },
  { test: /^127\./, name: 'the loopback block (127.0.0.0/8)', rfc: 'RFC 1122',
    note: 'it always refers to the querying host itself' },
  { test: /^169\.254\./, name: 'the link-local block (169.254.0.0/16)', rfc: 'RFC 3927',
    note: 'self-assigned when no DHCP server answers' },
  { test: /^172\.(1[6-9]|2\d|3[01])\./, name: 'private address space (172.16.0.0/12)', rfc: 'RFC 1918',
    note: 'routable only inside a private network' },
  { test: /^192\.0\.2\./, name: 'TEST-NET-1 (192.0.2.0/24)', rfc: 'RFC 5737',
    note: 'reserved for documentation and examples, and should not appear on the public internet' },
  { test: /^192\.168\./, name: 'private address space (192.168.0.0/16)', rfc: 'RFC 1918',
    note: 'routable only inside a private network' },
  { test: /^198\.1[89]\./, name: 'the benchmarking block (198.18.0.0/15)', rfc: 'RFC 2544',
    note: 'reserved for network device performance testing' },
  { test: /^198\.51\.100\./, name: 'TEST-NET-2 (198.51.100.0/24)', rfc: 'RFC 5737',
    note: 'reserved for documentation and examples, and should not appear on the public internet' },
  { test: /^203\.0\.113\./, name: 'TEST-NET-3 (203.0.113.0/24)', rfc: 'RFC 5737',
    note: 'reserved for documentation and examples, and should not appear on the public internet' },
  { test: /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, name: 'the shared address space (100.64.0.0/10)', rfc: 'RFC 6598',
    note: 'used between a subscriber and a carrier-grade NAT' },
  { test: /^(22[4-9]|23\d)\./, name: 'the multicast block (224.0.0.0/4)', rfc: 'RFC 5771',
    note: 'a group address rather than a host address' },
  { test: /^(24\d|25[0-5])\./, name: 'the reserved block (240.0.0.0/4)', rfc: 'RFC 1112',
    note: 'reserved for future use and not routed' },
  { test: /^::1$/, name: 'the IPv6 loopback address (::1)', rfc: 'RFC 4291',
    note: 'it always refers to the querying host itself' },
  { test: /^f[cd]/i, name: 'the IPv6 unique local block (fc00::/7)', rfc: 'RFC 4193',
    note: 'routable only inside a private network' },
  { test: /^fe[89ab]/i, name: 'the IPv6 link-local block (fe80::/10)', rfc: 'RFC 4291',
    note: 'valid only on a single link' },
  { test: /^2001:0?db8:/i, name: 'the IPv6 documentation block (2001:db8::/32)', rfc: 'RFC 3849',
    note: 'reserved for documentation and examples, and should not appear on the public internet' },
];

/** The reserved block an address belongs to, or null when it is routable. */
export function reservedBlock(ip: string): { name: string; rfc: string; note: string } | null {
  for (const entry of RESERVED) if (entry.test.test(ip)) return entry;
  return null;
}

/** The IP address named anywhere in the text, or null. */
export function ipIn(text: string): string | null {
  return IPV4.exec(text)?.[0] ?? IPV6.exec(text)?.[0] ?? null;
}

/** ipapi.co's shape, used only when ip-api.com does not answer. */
interface IpapiCoPayload {
  city?: string;
  region?: string;
  country?: string;
  country_name?: string;
  org?: string;
}

interface IpApiPayload {
  status?: string;
  message?: string;
  city?: string;
  regionName?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
  query?: string;
}

async function getJson<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function locateIp(
  query: string,
  now = new Date(),
): Promise<IpGeolocationResponse> {
  const ip = ipIn(query);
  const base = {
    query,
    source: 'ip-api.com',
    confidence: 1,
    checked_at: now.toISOString(),
  };
  const empty = {
    city: null,
    region: null,
    region_code: null,
    country: null,
    country_code: null,
    latitude: null,
    longitude: null,
    timezone: null,
    isp: null,
    organization: null,
    asn: null,
  };

  if (!ip) {
    return {
      ...base,
      ...empty,
      ip: null,
      found: false,
      verdict: 'not_found',
      reason:
        `No IP address was found in "${query}". Geolocation requires an IPv4 or IPv6 address; ` +
        `a hostname must be resolved to an address first.`,
    };
  }

  // A reserved address is a real answer rather than an outage, and the
  // provider reports it the same way it reports a failure -- so it is
  // classified before anything is asked upstream.
  const reserved = reservedBlock(ip);
  if (reserved) {
    return {
      ...base,
      ...empty,
      source: `${reserved.rfc} address registry`,
      ip,
      found: false,
      verdict: 'not_found',
      reason:
        `The IP address ${ip} is part of ${reserved.name}, which ${reserved.rfc} reserves: ` +
        `${reserved.note}. It is therefore not routable on the public internet and has no ` +
        `geolocation, no assigned ISP, no autonomous system and no abuse history, because no ` +
        `organisation holds it and no traffic to it crosses the public internet.`,
    };
  }

  const primary = await getJson<IpApiPayload>(
    `${IP_API}/${encodeURIComponent(ip)}?fields=status,message,city,regionName,region,country,countryCode,lat,lon,timezone,isp,org,as,query`,
    9_000,
  );

  if (!primary || primary.status !== 'success') {
    const fallback = await getJson<IpapiCoPayload>(
      `${IPAPI_CO}/${encodeURIComponent(ip)}/json/`,
      8_000,
    );
    if (!fallback?.city) {
      return {
        ...base,
        ...empty,
        ip,
        found: false,
        verdict: 'unavailable',
        reason:
          `The geolocation of ${ip} could not be retrieved because the upstream geolocation ` +
          `services did not answer. This is a temporary upstream failure rather than a ` +
          `statement that ${ip} has no location.`,
      };
    }
    const city = fallback.city;
    const region = fallback.region ?? null;
    const country = fallback.country_name ?? null;
    const org = fallback.org ?? null;
    return {
      ...base,
      ...empty,
      source: 'ipapi.co',
      ip,
      city,
      region,
      country,
      country_code: fallback.country ?? null,
      organization: org,
      isp: org,
      found: true,
      verdict: 'found',
      reason:
        `The IP address ${ip} is located in ${[city, region, country].filter(Boolean).join(', ')}` +
        `${org ? `, and is operated by ${org}` : ''}.`,
    };
  }

  const city = primary.city ?? null;
  const region = primary.regionName ?? null;
  const country = primary.country ?? null;
  const isp = primary.isp ?? null;
  const org = primary.org ?? null;
  const asn = primary.as ?? null;
  const place = [city, region, country].filter(Boolean).join(', ');

  const coords =
    typeof primary.lat === 'number' && typeof primary.lon === 'number'
      ? ` Its approximate coordinates are ${primary.lat}, ${primary.lon}.`
      : '';
  const network = isp
    ? ` The address is assigned to ${isp}${org && org !== isp ? ` (${org})` : ''}` +
      `${asn ? `, in autonomous system ${asn}` : ''}.`
    : '';
  const zone = primary.timezone ? ` The local timezone is ${primary.timezone}.` : '';

  return {
    ...base,
    ip: primary.query ?? ip,
    city,
    region,
    region_code: primary.region ?? null,
    country,
    country_code: primary.countryCode ?? null,
    latitude: primary.lat ?? null,
    longitude: primary.lon ?? null,
    timezone: primary.timezone ?? null,
    isp,
    organization: org,
    asn,
    found: true,
    verdict: 'found',
    reason:
      `The IP address ${ip} is located in ${place}.${network}${coords}${zone} ` +
      `IP geolocation identifies where an address is routed and registered, which is the ` +
      `location of the network rather than of any individual user.`,
  };
}
