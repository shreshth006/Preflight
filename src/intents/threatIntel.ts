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
  /** Short name of the malware family or campaign, for a URL that purports to distribute it. */
  family?: string;
  /** One-line, widely reported description of what that malware is and does. */
  summary?: string;
}

const REFERENCES: ThreatReference[] = [
  {
    domains: ['avsvmcloud.com'],
    keywords: ['sunburst', 'solarwinds', 'solorigate', 'avsvmcloud'],
    name: 'SUNBURST (SolarWinds Orion supply-chain compromise)',
    disposition: 'malicious',
    family: 'SUNBURST backdoor',
    summary:
      'a backdoor delivered through a trojanized SolarWinds Orion update that gave attackers remote access to victim networks',
    facts: [
      'avsvmcloud.com was the command-and-control domain for the SUNBURST backdoor distributed via a trojanized SolarWinds Orion software update, disclosed by FireEye on December 13, 2020.',
      'The malware used a domain generation algorithm to resolve subdomains of avsvmcloud.com, which returned CNAME records pointing to active command-and-control infrastructure.',
      'Microsoft, FireEye and GoDaddy seized and sinkholed the domain, converting it into a killswitch that disabled the backdoor.',
    ],
  },
  {
    domains: ['iuqerfsodp9ifjaposdfjhgosurijfaewrwergwea.com'],
    keywords: ['wannacry', 'wanacrypt', 'kill-switch', 'killswitch', 'kill switch'],
    name: 'WannaCry ransomware kill-switch domain',
    disposition: 'safe',
    facts: [
      'This was the WannaCry ransomware kill-switch domain, found hardcoded into the malware as an unregistered check by security researcher Marcus Hutchins.',
      'Registering it on May 12, 2017 caused the malware to treat the sinkhole response as a signal to stop encrypting files, halting the spread of the initial outbreak.',
      'The domain itself was benign: the registration was a defensive act, and WannaCry had spread using the EternalBlue SMB exploit.',
    ],
  },
  {
    domains: [],
    keywords: ['necurs'],
    name: 'Necurs botnet takedown',
    disposition: 'malicious',
    family: 'Necurs botnet',
    summary:
      'one of the largest spam and malware distribution botnets, which infected more than 9 million computers',
    facts: [
      'On March 10, 2020, Microsoft announced a coordinated legal and technical takedown of the Necurs botnet, which had infected more than 9 million computers globally.',
      "Microsoft analyzed Necurs' domain generation algorithm and predicted over 6 million domains the botnet would have algorithmically generated over the following 25 months, then worked with partners in 35 countries to block them.",
      'Necurs had been one of the largest distributors of spam and malware, and the action severed infected hosts from their operators.',
    ],
  },
  {
    domains: ['baways.com'],
    keywords: ['british airways', 'magecart', 'baways'],
    name: 'British Airways Magecart breach',
    disposition: 'malicious',
    family: 'Magecart skimmer',
    summary: 'malicious JavaScript that skims payment-card data from checkout pages',
    facts: [
      "In the 2018 British Airways breach, attackers injected malicious JavaScript into the site's Modernizr.js library between August 21 and September 5, 2018.",
      "The script skimmed payment-page form data and exfiltrated it to baways.com, a domain the Magecart-linked attackers registered to mimic British Airways' own branding.",
      "Several hundred thousand customers were affected, and the UK Information Commissioner's Office fined British Airways 20 million pounds for the breach.",
    ],
  },
  {
    domains: [],
    keywords: ['dnc hack', 'dnc', 'podesta', 'fancy bear', 'apt28', 'google-login', 'google login'],
    name: 'Fake Google-login phishing in the 2016 DNC hack',
    disposition: 'malicious',
    family: 'Fancy Bear credential-phishing',
    summary: 'fake Google-login pages used to steal account credentials',
    facts: [
      "CrowdStrike's investigation, later corroborated by SecureWorks' bit.ly analysis, found that the Russian-linked group tracked as Fancy Bear, APT28, Sofacy and TG-4127 sent spear-phishing emails using bit.ly-shortened links to fake Google account-login pages.",
      'The pages harvested credentials from Democratic National Committee and Clinton campaign staff, including chairman John Podesta, between March and May 2016.',
      'SecureWorks documented nearly 4,000 phishing links tied to the group.',
    ],
  },
  {
    domains: [],
    keywords: ['emotet'],
    name: 'Emotet command-and-control infrastructure and takedown',
    disposition: 'malicious',
    family: 'Emotet',
    summary: 'a banking trojan turned malware loader spread through malicious email attachments',
    facts: [
      'Emotet operated as a modular loader distributed largely through malicious email attachments, and split its victims across separate botnets, commonly tracked as Epoch 1, Epoch 2 and Epoch 3, each with its own tiered command-and-control servers.',
      'In January 2021 a coordinated action led by Europol and Eurojust, with authorities in the Netherlands, Germany, the United States, the United Kingdom, France, Lithuania, Canada and Ukraine, seized that infrastructure from the inside.',
      'Law enforcement gained control of the servers and used them to deliver an update that removed Emotet from infected machines; the botnet re-emerged in November 2021.',
    ],
  },
  {
    domains: ['xn--80ak6aa92e.com'],
    keywords: ['punycode', 'homograph', 'xn--80ak6aa92e'],
    name: 'Punycode homograph demonstration against apple.com',
    disposition: 'safe',
    facts: [
      'xn--80ak6aa92e.com is the Punycode encoding of a domain written entirely in Cyrillic characters that renders in a browser address bar as apple.com.',
      'Researcher Xudong Zheng published it in April 2017 as a proof-of-concept homograph attack, showing that Chrome, Firefox and Opera displayed the Unicode form rather than the Punycode.',
      'It was a demonstration rather than an attack: no credentials were collected, and browsers responded by displaying Punycode for mixed-script domains, Chrome from version 58.',
    ],
  },
  {
    domains: [],
    keywords: ['conficker', 'downadup'],
    name: 'Conficker domain generation algorithm',
    disposition: 'malicious',
    family: 'Conficker worm',
    summary: 'a self-propagating worm that infected millions of Windows machines',
    facts: [
      'The Conficker worm, active in 2008 and 2009, used a domain generation algorithm seeded by the current date to locate its command-and-control servers rather than fixed addresses.',
      'The A and B variants generated 250 pseudo-random domains per day across 110 top-level domains, while the Conficker.C variant, active from April 1, 2009, escalated this to 50,000 candidate domains generated daily across 116 top-level domains, of which it would contact 500.',
      "That scale was explicitly designed to defeat the Conficker Working Group's domain-blocking countermeasures, which pre-registered and sinkholed the generated domains.",
    ],
  },
  {
    domains: [],
    keywords: ['gameover zeus', 'gameover', 'tovar', 'cryptolocker'],
    name: 'Operation Tovar (Gameover Zeus)',
    disposition: 'malicious',
    family: 'Gameover Zeus',
    summary:
      'a peer-to-peer banking trojan used for credential theft and CryptoLocker ransomware distribution',
    facts: [
      "In Operation Tovar, executed around May 30, 2014, the FBI, UK's National Crime Agency, Europol and private partners disrupted the peer-to-peer Gameover Zeus botnet.",
      'Gameover Zeus used a fallback domain generation algorithm producing pseudo-random domains as a backup command-and-control channel.',
      'Following the takedown, a new Gameover Zeus variant emerged in July 2014 using a purely domain-generation-algorithm-based, non-peer-to-peer command-and-control model that generated roughly 1,000 new domains daily.',
    ],
  },
  {
    domains: [],
    keywords: ['mirai', 'anna-senpai'],
    name: 'Mirai botnet source code release',
    disposition: 'malicious',
    family: 'Mirai botnet',
    summary:
      'IoT botnet malware that infects devices through default credentials to launch large-scale DDoS attacks, with source code leaked in 2016',
    facts: [
      "Mirai, the IoT botnet malware behind the record-breaking September 2016 DDoS attacks on Brian Krebs' site and the host OVH, had its source code leaked publicly on Hack Forums by a user calling themselves Anna-senpai on September 30, 2016.",
      'Academic follow-up research, presented at USENIX Security 2017 by Antonakakis and others, traced numerous command-and-control domains associated with post-leak Mirai variant clusters.',
      'That work found some of those domains had DNS lookup activity predating their actual use as command-and-control infrastructure by months, and the released code went on to seed many independent variants.',
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
/** Whether a keyword occurs as a whole word (hyphens and punctuation count as boundaries). */
function wordIn(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

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
    if (ref.domains.some((d) => text.includes(d)) || ref.keywords.some((k) => wordIn(text, k))) {
      return ref;
    }
  }
  return null;
}
