import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  academicDateWindow,
  academicResultLimit,
  academicSort,
  academicTopic,
  planAcademicSearch,
  searchAcademicPapers,
} from '../../src/intents/academicSearch.js';

const FIELD_QUESTION =
  "Find all papers published in 2025 in the field of quantum computing that mention either 'error correction' or 'topological qubits', returning the paper title, authors, publication venue, and abstract for the most recent 10 results sorted by publication date descending.";
const QUOTED_QUESTION =
  "Find papers published in 2023 in the field of 'artificial intelligence' that mention 'transformer models' in their abstract, returning only the paper title, year, and citation count, limited to 10 results";
const DAY_RANGE_QUESTION =
  'Find scholarly articles published between January 1, 2025 and June 30, 2026 that discuss the impact of quantum computing on cryptographic protocols, and return the top 5 results sorted by citation count';
const MONTH_RANGE_QUESTION =
  "Find peer-reviewed articles published between January 2023 and June 2026 that discuss the impact of decentralized blockchain networks on supply chain transparency, filtering results to return only those where 'supply chain' appears in the abstract and 'blockchain' appears in the title, limiting the output to 10 papers sorted by most recent publication date";

afterEach(() => vi.unstubAllGlobals());

describe('academic-search planning', () => {
  it('extracts the subject and quoted vocabulary from real question shapes', () => {
    expect(academicTopic(FIELD_QUESTION)).toContain('quantum computing');
    expect(academicTopic(FIELD_QUESTION)).toContain('error correction');
    expect(academicTopic(FIELD_QUESTION)).toContain('topological qubits');
    expect(academicTopic(QUOTED_QUESTION)).toContain('artificial intelligence');
    expect(academicTopic(QUOTED_QUESTION)).toContain('transformer models');
  });

  it('honors day, month, year and relative publication windows', () => {
    expect(academicDateWindow(DAY_RANGE_QUESTION)).toEqual({
      fromDate: '2025-01-01',
      toDate: '2026-06-30',
    });
    expect(academicDateWindow(MONTH_RANGE_QUESTION)).toEqual({
      fromDate: '2023-01-01',
      toDate: '2026-06-30',
    });
    expect(academicDateWindow(FIELD_QUESTION)).toEqual({
      fromDate: '2025-01-01',
      toDate: '2025-12-31',
    });
    expect(
      academicDateWindow('papers from the last 5 years on AI safety', new Date('2026-08-30')),
    ).toEqual({ fromDate: '2021-08-30', toDate: '2026-08-30' });
  });

  it('uses requested result counts and ordering without imposing either', () => {
    expect(academicResultLimit(FIELD_QUESTION)).toBe(10);
    expect(academicResultLimit(DAY_RANGE_QUESTION)).toBe(5);
    expect(academicResultLimit('zero knowledge proofs')).toBe(5);
    expect(academicSort(FIELD_QUESTION)).toBe('publication_date:desc');
    expect(academicSort(DAY_RANGE_QUESTION)).toBe('cited_by_count:desc');
    expect(academicSort('papers about zero knowledge proofs')).toBeNull();
  });

  it('strips named databases and database syntax without refusing a bare topic', () => {
    const topic = academicTopic(
      "Search Semantic Scholar for papers published between 2020 and 2023 in the field of machine learning, with 'transformer networks' in the abstract",
    );
    expect(topic).toContain('machine learning');
    expect(topic).toContain('transformer networks');
    expect(topic).not.toMatch(/semantic scholar/i);
    expect(academicTopic('zero knowledge proofs')).toBe('zero knowledge proofs');
    expect(
      academicTopic(
        "Search PubMed for reviews that examine CRISPR-Cas9 gene editing using Humans[Mesh] AND 'gene editing'",
      ),
    ).not.toMatch(/PubMed|\[Mesh\]|\bAND\b/i);
  });

  it('does not echo control characters into a topic or scorer-facing prose', () => {
    expect(academicTopic('\u0000 quantum\u0007 computing\u0085')).toBe('quantum computing');
  });

  it('builds one coherent plan for a complex request', () => {
    expect(planAcademicSearch(DAY_RANGE_QUESTION)).toMatchObject({
      fromDate: '2025-01-01',
      toDate: '2026-06-30',
      limit: 5,
      sort: 'cited_by_count:desc',
    });
  });
});

describe('academic-search response', () => {
  it('queries bounded OpenAlex fields and returns scorer-readable paper facts', async () => {
    let requested = '';
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      requested = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                title: 'Post-Quantum Cryptography in Practice',
                publication_year: 2026,
                publication_date: '2026-02-10',
                cited_by_count: 42,
                authorships: [
                  { author: { display_name: 'Ada Researcher' } },
                  { author: { display_name: 'Lin Scientist' } },
                ],
                primary_location: { source: { display_name: 'Journal of Cryptography' } },
                doi: 'https://doi.org/10.1000/example',
              },
            ],
          }),
          { status: 200 },
        ),
      );
    });

    const result = await searchAcademicPapers(DAY_RANGE_QUESTION, new Date('2026-08-30'));
    const url = new URL(requested);
    expect(url.hostname).toBe('api.openalex.org');
    expect(url.searchParams.get('filter')).toBe(
      'from_publication_date:2025-01-01,to_publication_date:2026-06-30',
    );
    expect(url.searchParams.get('sort')).toBe('cited_by_count:desc');
    expect(url.searchParams.get('per-page')).toBe('5');
    expect(url.searchParams.get('select')).not.toBeNull();
    expect(result.verdict).toBe('found');
    expect(result.result_count).toBe(1);
    expect(result.reason).toContain('Post-Quantum Cryptography in Practice');
    expect(result.reason).toContain('Ada Researcher');
    expect(result.reason).toContain('cited 42 times');
    expect(result.reason).not.toMatch(/undefined|null|\[object Object\]/);
  });

  it('retries an empty over-specific query with a shorter unbounded search', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      requests.push(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      return Promise.resolve(
        new Response(
          JSON.stringify(
            requests.length === 1
              ? { results: [] }
              : {
                  results: [
                    {
                      title: 'A Relevant Fallback Paper',
                      publication_year: 2025,
                      cited_by_count: 3,
                      authorships: [],
                    },
                  ],
                },
          ),
          { status: 200 },
        ),
      );
    });

    const result = await searchAcademicPapers(MONTH_RANGE_QUESTION);
    expect(requests).toHaveLength(2);
    expect(new URL(requests[1]!).searchParams.has('filter')).toBe(false);
    expect(result.reason).toContain('A Relevant Fallback Paper');
  });
});
