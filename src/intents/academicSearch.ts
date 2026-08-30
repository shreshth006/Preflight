const OPENALEX_WORKS = 'https://api.openalex.org/works';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESULTS = 10;

interface OpenAlexAuthor {
  author?: { display_name?: unknown };
}

interface OpenAlexWork {
  title?: unknown;
  publication_year?: unknown;
  publication_date?: unknown;
  cited_by_count?: unknown;
  authorships?: OpenAlexAuthor[];
  primary_location?: { source?: { display_name?: unknown } };
  doi?: unknown;
}

interface OpenAlexResponse {
  results?: OpenAlexWork[];
}

export interface AcademicSearchPlan {
  topic: string;
  fromDate: string | null;
  toDate: string | null;
  limit: number;
  sort: 'cited_by_count:desc' | 'publication_date:desc' | null;
}

export interface AcademicPaper {
  title: string;
  authors: string[];
  publication_year: number | null;
  publication_date: string | null;
  citation_count: number | null;
  venue: string | null;
  doi: string | null;
}

export interface AcademicSearchResult {
  query: string;
  topic: string;
  source: 'OpenAlex';
  verdict: 'found' | 'not_found';
  found: boolean;
  papers: AcademicPaper[];
  result_count: number;
  from_date: string | null;
  to_date: string | null;
  sort: AcademicSearchPlan['sort'];
  confidence: number;
  checked_at: string;
  reason: string;
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function isoDate(year: string, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function academicDateWindow(
  input: string,
  now = new Date(),
): { fromDate: string | null; toDate: string | null } {
  const monthRange =
    /\b(?:between|from)\s+([a-z]+)\s+(?:(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*)?(\d{4})\s+(?:and|to)\s+([a-z]+)\s+(?:(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*)?(\d{4})\b/i.exec(
      input,
    );
  if (monthRange) {
    const fromMonth = MONTHS[monthRange[1]!.toLowerCase()];
    const toMonth = MONTHS[monthRange[4]!.toLowerCase()];
    if (fromMonth && toMonth) {
      const fromDay = monthRange[2] ? Number(monthRange[2]) : 1;
      const toDay = monthRange[5]
        ? Number(monthRange[5])
        : new Date(Date.UTC(Number(monthRange[6]), toMonth, 0)).getUTCDate();
      return {
        fromDate: isoDate(monthRange[3]!, fromMonth, fromDay),
        toDate: isoDate(monthRange[6]!, toMonth, toDay),
      };
    }
  }

  const yearRange = /\b(?:between|from)\s+(\d{4})\s+(?:and|to)\s+(\d{4})\b/i.exec(input);
  if (yearRange) {
    return { fromDate: `${yearRange[1]}-01-01`, toDate: `${yearRange[2]}-12-31` };
  }

  const relative = /\b(?:last|past|previous)\s+(\d{1,2})\s+(years?|months?)\b/i.exec(input);
  if (relative) {
    const start = new Date(now);
    const amount = Number(relative[1]);
    if (relative[2]!.toLowerCase().startsWith('year')) {
      start.setUTCFullYear(start.getUTCFullYear() - amount);
    } else {
      start.setUTCMonth(start.getUTCMonth() - amount);
    }
    return { fromDate: start.toISOString().slice(0, 10), toDate: now.toISOString().slice(0, 10) };
  }

  const since = /\b(?:since|after)\s+(\d{4})\b/i.exec(input);
  if (since) return { fromDate: `${since[1]}-01-01`, toDate: null };

  const year = /\b(?:published\s+in|during|in)\s+(\d{4})\b/i.exec(input);
  if (year) return { fromDate: `${year[1]}-01-01`, toDate: `${year[1]}-12-31` };

  return { fromDate: null, toDate: null };
}

function stripSearchSyntax(input: string): string {
  return input
    .replace(/\b[a-z_]+\.search\s*:/gi, ' ')
    .replace(/\[[a-z]+\]/gi, ' ')
    .replace(/\b(?:AND|OR|NOT)\b/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTopic(input: string): string {
  return stripSearchSyntax(input)
    .replace(/^[\s'"‘’“”]+|[\s'"‘’“”]+$/g, '')
    .replace(/[?.!,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function academicTopic(input: string): string | null {
  const withoutDatabase = input.replace(
    /^\s*(?:please\s+)?(?:search|query|find|look\s+up)\s+(?:the\s+)?(?:semantic\s+scholar|pubmed(?:\s+central)?|google\s+scholar|web\s+of\s+science|arxiv|scopus|openalex|ieee(?:\s+xplore)?|springer|elsevier|jstor)\b\s*(?:for|in)?\s*/i,
    '',
  );
  const quoted = [...withoutDatabase.matchAll(/['‘“"]([^'’”"]{3,80})['’”"]/g)]
    .map((match) => cleanTopic(match[1] ?? ''))
    .filter(Boolean);

  const patterns = [
    /\bin\s+the\s+fields?\s+of\s+(.+?)(?=\s+that\b|\s+mention\w*\b|\s+return\w*\b|\s+published\b|[,?.]|$)/i,
    /\bthat\s+(?:discuss(?:es)?|examine[sd]?|investigates?|analy[sz]\w*)\s+(.+?)(?=\s+(?:and\s+)?return\w*\b|\s+published\b|\s+with\b|\s+where\b|\s+filter\w*\b|\s+limit\w*\b|[,?.]|$)/i,
    /\b(?:papers?|articles?|studies|reviews?|research|literature)\s+(?:on|about|regarding|covering)\s+(.+?)(?=\s+published\b|\s+(?:and\s+)?return\w*\b|\s+with\b|\s+where\b|\s+limit\w*\b|[,?.]|$)/i,
    /\b(?:on|about|regarding|covering)\s+(.+?)(?=\s+published\b|\s+(?:and\s+)?return\w*\b|\s+with\b|\s+where\b|\s+limit\w*\b|[,?.]|$)/i,
  ];
  let subject = patterns.map((pattern) => pattern.exec(withoutDatabase)?.[1]).find(Boolean) ?? '';

  if (!subject) {
    subject = withoutDatabase
      .replace(
        /^\s*(?:please\s+)?(?:find|search(?:\s+for)?|query|look\s+up|get|list|show\s+me|give\s+me)\b/i,
        ' ',
      )
      .replace(
        /\b(?:peer[-\s]?reviewed|academic|scholarly|recent|most\s+cited|most\s+recent)\b/gi,
        ' ',
      )
      .replace(/\b(?:papers?|articles?|studies|research|literature|publications?)\b/gi, ' ')
      .replace(
        /\bpublished\s+(?:between|from)\s+.+?\s+(?:and|to)\s+.+?(?=\s+(?:in|that|on|about|regarding)\b|[,?.]|$)/gi,
        ' ',
      )
      .replace(/\bpublished\s+in\s+\d{4}\b/gi, ' ')
      .replace(/\b(?:between|from)\s+\d{4}\s+(?:and|to)\s+\d{4}\b/gi, ' ')
      .replace(/\b(?:since|after)\s+\d{4}\b/gi, ' ')
      .replace(/[,;]?\s*(?:return\w*|sorted\s+by|limit\w*|filter\w*)\b.*$/i, ' ');
  }

  let topic = cleanTopic(subject);
  for (const phrase of quoted) {
    if (phrase && !topic.toLowerCase().includes(phrase.toLowerCase())) topic += ` ${phrase}`;
  }
  topic = cleanTopic(topic);
  const words = topic.split(/\s+/).filter(Boolean);
  if (words.length > 18) topic = words.slice(0, 18).join(' ');
  return topic.length >= 3 ? topic : null;
}

export function academicResultLimit(input: string, fallback = 5): number {
  const match =
    /\b(?:top|most\s+recent)\s+(\d{1,2})\b/i.exec(input) ??
    /\blimit(?:ed|ing)?\s+(?:the\s+)?(?:output\s+|results?\s+)?to\s+(\d{1,2})\b/i.exec(input) ??
    /\b(\d{1,2})\s+(?:results|papers|articles|studies)\b/i.exec(input);
  const requested = Number(match?.[1]);
  return Number.isInteger(requested) && requested >= 1
    ? Math.min(requested, MAX_RESULTS)
    : fallback;
}

export function academicSort(input: string): AcademicSearchPlan['sort'] {
  if (/\b(?:sort(?:ed)?\s+by\s+(?:the\s+)?citation\s+count|most\s+cited)\b/i.test(input)) {
    return 'cited_by_count:desc';
  }
  if (
    /\b(?:publication\s+date\s+descending|sort(?:ed)?\s+by\s+(?:most\s+recent\s+)?publication\s+date|most\s+recent\s+\d+\s+results)\b/i.test(
      input,
    )
  ) {
    return 'publication_date:desc';
  }
  return null;
}

export function planAcademicSearch(input: string, now = new Date()): AcademicSearchPlan | null {
  const topic = academicTopic(input);
  if (!topic) return null;
  const { fromDate, toDate } = academicDateWindow(input, now);
  return {
    topic,
    fromDate,
    toDate,
    limit: academicResultLimit(input),
    sort: academicSort(input),
  };
}

function requestUrl(plan: AcademicSearchPlan, relaxed = false): string {
  const url = new URL(OPENALEX_WORKS);
  const topic = relaxed ? plan.topic.split(/\s+/).slice(0, 6).join(' ') : plan.topic;
  url.searchParams.set('search', topic);
  if (!relaxed) {
    const filters: string[] = [];
    if (plan.fromDate) filters.push(`from_publication_date:${plan.fromDate}`);
    if (plan.toDate) filters.push(`to_publication_date:${plan.toDate}`);
    if (filters.length) url.searchParams.set('filter', filters.join(','));
  }
  if (plan.sort) url.searchParams.set('sort', plan.sort);
  url.searchParams.set('per-page', String(plan.limit));
  url.searchParams.set(
    'select',
    'title,publication_year,publication_date,cited_by_count,authorships,primary_location,doi',
  );
  return url.href;
}

async function fetchWorks(url: string, timeoutMs: number): Promise<OpenAlexWork[]> {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'PREFLIGHT/0.1 academic-search' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`OpenAlex returned HTTP ${response.status}`);
  const body = (await response.json()) as OpenAlexResponse;
  return Array.isArray(body.results) ? body.results : [];
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function paperFrom(work: OpenAlexWork): AcademicPaper | null {
  const title = asText(work.title)?.replace(/\s+/g, ' ');
  if (!title) return null;
  const authors = (Array.isArray(work.authorships) ? work.authorships : [])
    .map((authorship) => asText(authorship.author?.display_name))
    .filter((name): name is string => Boolean(name));
  return {
    title,
    authors: authors.slice(0, 4),
    publication_year: asNumber(work.publication_year),
    publication_date: asText(work.publication_date),
    citation_count: asNumber(work.cited_by_count),
    venue: asText(work.primary_location?.source?.display_name),
    doi: asText(work.doi),
  };
}

function paperSentence(paper: AcademicPaper, index: number): string {
  const authors = paper.authors.length
    ? ` by ${paper.authors.join(', ')}${paper.authors.length === 4 ? ', et al.' : ''}`
    : '';
  const year = paper.publication_year === null ? '' : ` (${paper.publication_year})`;
  const citations = paper.citation_count === null ? '' : `, cited ${paper.citation_count} times`;
  return `${index + 1}) ${paper.title.replace(/[.!?]+$/g, '')}${authors}${year}${citations}.`;
}

export async function searchAcademicPapers(
  input: string,
  now = new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<AcademicSearchResult> {
  const plan = planAcademicSearch(input, now);
  if (!plan) throw new TypeError('an academic search requires a research topic');

  let works = await fetchWorks(requestUrl(plan), timeoutMs);
  if (works.length === 0) {
    works = await fetchWorks(requestUrl(plan, true), Math.min(timeoutMs, 4_000)).catch(() => []);
  }
  const papers = works.map(paperFrom).filter((paper): paper is AcademicPaper => Boolean(paper));
  const checkedAt = now.toISOString();
  if (papers.length === 0) {
    return {
      query: input,
      topic: plan.topic,
      source: 'OpenAlex',
      verdict: 'not_found',
      found: false,
      papers: [],
      result_count: 0,
      from_date: plan.fromDate,
      to_date: plan.toDate,
      sort: plan.sort,
      confidence: 1,
      checked_at: checkedAt,
      reason: `No peer-reviewed papers about ${plan.topic} were found in OpenAlex for the requested publication period.`,
    };
  }

  const period =
    plan.fromDate && plan.toDate
      ? ` published from ${plan.fromDate} through ${plan.toDate}`
      : plan.fromDate
        ? ` published since ${plan.fromDate}`
        : '';
  return {
    query: input,
    topic: plan.topic,
    source: 'OpenAlex',
    verdict: 'found',
    found: true,
    papers,
    result_count: papers.length,
    from_date: plan.fromDate,
    to_date: plan.toDate,
    sort: plan.sort,
    confidence: 1,
    checked_at: checkedAt,
    reason: `Here are ${papers.length} peer-reviewed papers about ${plan.topic}${period}: ${papers.map(paperSentence).join(' ')}`,
  };
}
