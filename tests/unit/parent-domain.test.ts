import { describe, expect, it } from 'vitest';
import { parentDomainOf, sanCovers } from '../../src/tls/parentDomain.js';

describe('parentDomainOf', () => {
  it('strips the leftmost label of a subdomain', () => {
    expect(parentDomainOf('api.example.com')).toBe('example.com');
    expect(parentDomainOf('a.b.example.com')).toBe('b.example.com');
  });

  it('declines a bare registrable domain rather than probing a suffix', () => {
    // Probing "co.uk" would be both wrong and rude, and this is not a
    // public-suffix implementation, so two-label inputs get no parent.
    expect(parentDomainOf('example.com')).toBeNull();
    expect(parentDomainOf('localhost')).toBeNull();
  });
});

describe('sanCovers', () => {
  it('matches an exact name', () => {
    expect(sanCovers('api.example.com', 'api.example.com')).toBe(true);
  });

  it('matches a wildcard across exactly one label', () => {
    expect(sanCovers('*.example.com', 'api.example.com')).toBe(true);
    // RFC 6125: a wildcard spans one label, so a deeper name is not covered.
    expect(sanCovers('*.example.com', 'a.b.example.com')).toBe(false);
    // Nor does it cover the bare domain it wildcards.
    expect(sanCovers('*.example.com', 'example.com')).toBe(false);
  });

  it('does not match an unrelated suffix', () => {
    expect(sanCovers('*.example.com', 'api.notexample.com')).toBe(false);
    expect(sanCovers('*.example.com', 'exampleXcom')).toBe(false);
  });

  it('accepts the DNS: type prefix the certificate actually carries', () => {
    // Production returned "no name covers api.example.com" while listing
    // DNS:*.example.com, because the prefix was being matched literally.
    expect(sanCovers('DNS:*.example.com', 'api.example.com')).toBe(true);
    expect(sanCovers('DNS:example.com', 'example.com')).toBe(true);
    expect(sanCovers('DNS: *.example.com', 'api.example.com')).toBe(true);
  });

  it('is case and trailing-dot insensitive', () => {
    expect(sanCovers('*.Example.COM', 'API.example.com.')).toBe(true);
  });
});
