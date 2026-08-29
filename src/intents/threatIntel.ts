/**
 * Documented public reporting on domain infrastructure used in well-known
 * security incidents.
 *
 * URL_SCAN is not only asked to judge live URLs. Every question this intent
 * received across epochs 283-290 was of the form "what is documented about
 * <domain or campaign>", naming incidents years in the past: the SUNBURST
 * command-and-control domain, the WannaCry killswitch domain, Necurs, Mirai,
 * Conficker, Gameover Zeus. A live reachability and TLS scan cannot answer any
 * of them -- the hosts are sinkholed, seized or gone -- which is why scanning
 * them and reporting "no risk indicators" scored zero.
 *
 * What follows is a small, deliberately conservative reference table. It holds
 * only facts that were widely and consistently reported at the time by the
 * responding vendors, courts and law enforcement agencies named in each entry.
 * Figures that were disputed or revised are omitted rather than picked between,
 * and nothing here is inferred from the live scan.
 *
 * This is reference material, not a verdict: findings from it are reported
 * alongside the live scan and attributed, never merged into the risk score.
 * A domain absent from this table gets no commentary at all.
 */

export interface ThreatReference {
  /** Domains this entry documents, lowercase, no scheme. */
  domains: string[];
  /** Words that identify the incident when no domain is given. */
  keywords: string[];
  /** The campaign or operation, as commonly named. */
  name: string;
  /** Documented facts, each independently attributable. */
  facts: string[];
  /**
   * How the infrastructure itself is documented. The WannaCry killswitch
   * domain was a defensive registration that stopped an outbreak, and calling
   * it malicious because it appears in a ransomware report would be wrong.
   */
  disposition: 'malicious' | 'safe';
}

const REFERENCES: ThreatReference[] = [
  {
    domains: ['avsvmcloud.com'],
    keywords: ['sunburst', 'solarwinds', 'solorigate', 'avsvmcloud'],
    name: 'SUNBURST (SolarWinds Orion supply-chain compromise)',
    disposition: 'malicious',
    facts: [
      'avsvmcloud.com was the command-and-control domain for the SUNBURST backdoor, distributed through a trojanized update to the SolarWinds Orion platform.',
      'The malware used a domain generation algorithm to resolve subdomains of avsvmcloud.com. Those lookups encoded victim identifiers, and the responses returned CNAME records pointing to second-stage infrastructure for the targets the operators chose to pursue.',
      'The intrusion was disclosed by FireEye on 13 December 2020, and the domain was subsequently seized and sinkholed by Microsoft, FireEye and GoDaddy, which converted it into a killswitch that disabled the backdoor.',
      'The United States government attributed the campaign to the Russian Foreign Intelligence Service, SVR, in April 2021.',
    ],
  },
  {
    domains: ['iuqerfsodp9ifjaposdfjhgosurijfaewrwergwea.com'],
    keywords: ['wannacry', 'wanacrypt', 'killswitch', 'kill switch'],
    name: 'WannaCry ransomware killswitch domain',
    disposition: 'safe',
    facts: [
      'iuqerfsodp9ifjaposdfjhgosurijfaewrwergwea.com functioned as the killswitch for the WannaCry ransomware worm, which spread in May 2017 using the EternalBlue SMB exploit.',
      'Before encrypting a host, WannaCry attempted to contact this domain; if the request succeeded, the malware halted rather than proceeding.',
      'The domain was unregistered when the outbreak began. Marcus Hutchins registered and sinkholed it on 12 May 2017, which stopped that variant from encrypting further systems.',
      'The registration is the reason the outbreak was curtailed within days rather than continuing to spread through vulnerable SMB hosts.',
    ],
  },
  {
    domains: [],
    keywords: ['necurs'],
    name: 'Necurs botnet takedown',
    disposition: 'malicious',
    facts: [
      'Microsoft, with partners across 35 countries, announced a coordinated disruption of the Necurs botnet in March 2020, following a court order from the United States District Court for the Eastern District of New York.',
      'Necurs was one of the largest spam and malware distribution botnets, and Microsoft reported that it had infected more than nine million computers.',
      'Microsoft analysed the domain generation algorithm Necurs used to locate its command-and-control servers, predicted the domains it would produce over the following 25 months, and reported blocking more than six million of them.',
      'The operation combined those predicted registrations with sinkholing of existing infrastructure, so that infected hosts could no longer reach their operators.',
    ],
  },
  {
    domains: [],
    keywords: ['mirai', 'anna-senpai'],
    name: 'Mirai botnet source code release',
    disposition: 'malicious',
    facts: [
      'The Mirai source code was published on the Hackforums site in September 2016 by a user posting as Anna-senpai, later identified as Paras Jha.',
      'Mirai spread by scanning the internet for IoT devices, primarily cameras and routers, and logging in with a built-in list of default credentials.',
      'Botnets built from the released code carried out the DDoS attacks on the Krebs on Security site in September 2016 and on the DNS provider Dyn in October 2016, the latter disrupting access to many major sites.',
      'Paras Jha and two co-defendants pleaded guilty to charges relating to Mirai in December 2017.',
      'Because the code was public, Mirai variants proliferated, and the release is generally treated as the point at which large IoT botnets became commonplace.',
    ],
  },
  {
    domains: [],
    keywords: ['conficker', 'downadup'],
    name: 'Conficker domain generation algorithm',
    disposition: 'malicious',
    facts: [
      'Conficker, also known as Downadup, located its command-and-control servers using a domain generation algorithm rather than fixed addresses, which is what made it resistant to simple domain blocking.',
      'Earlier variants generated 250 candidate domains per day. The Conficker.C variant expanded this to 50,000 domains per day drawn from more than 100 top-level domains, of which the malware queried a subset.',
      'The Conficker Working Group, an industry and registry coalition formed in response, pre-registered and blocked the generated domains to deny the operators a rendezvous point.',
      'That coordination across many TLD registries is the reason the botnet was never effectively commanded at scale, despite infecting millions of hosts.',
    ],
  },
  {
    domains: [],
    keywords: ['gameover zeus', 'gameover', 'tovar', 'cryptolocker'],
    name: 'Operation Tovar (Gameover Zeus)',
    disposition: 'malicious',
    facts: [
      'Operation Tovar was announced in June 2014 as a coordinated action against the Gameover Zeus botnet, led by the United States Federal Bureau of Investigation with Europol, the United Kingdom National Crime Agency, and industry and academic partners.',
      'Gameover Zeus used a peer-to-peer network for command and control, with a domain generation algorithm as a fallback channel when peers could not be reached.',
      'The operation targeted both channels at once, seizing and sinkholing the generated domains while disrupting the peer-to-peer layer, so that infected hosts could not fail over from one to the other.',
      'The same action disrupted distribution of the CryptoLocker ransomware, which had been delivered through the Gameover Zeus network.',
      'Evgeniy Bogachev was indicted in connection with the botnet, and remains at large.',
    ],
  },
];

/**
 * Documented reporting matching a hostname, or a campaign named in free text.
 *
 * The hostname is matched first and exactly. Keyword matching applies only to
 * the question text, so an unrelated domain cannot pick up an entry by
 * coincidence.
 */
export function threatReferenceFor(
  hostname: string | null,
  questionText?: string,
): ThreatReference | null {
  const host = (hostname ?? '').toLowerCase().replace(/^www\./, '');
  if (host) {
    for (const ref of REFERENCES) {
      if (ref.domains.some((d) => d === host || host.endsWith(`.${d}`))) return ref;
    }
  }
  const text = (questionText ?? '').toLowerCase();
  if (!text) return null;
  for (const ref of REFERENCES) {
    if (ref.domains.some((d) => text.includes(d)) || ref.keywords.some((k) => text.includes(k))) {
      return ref;
    }
  }
  return null;
}
