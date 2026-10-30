// ABOUTME: Checks wildcard URL patterns: normalization, matching, precedence, and inference.
// ABOUTME: Pattern suggestions come only from URLs already seen on the same hostname.

import { describe, expect, it } from 'vitest';
import {
  matchesUrlPattern,
  normalizeInternetPlace,
  resolveInternetPlacePolicy,
  suggestUrlPatterns,
  type InternetPlacePolicy,
} from '../internetPlaceCatalog';

const film = (user: string, tag: string) => `https://letterboxd.com/${user}/tag/${tag}/films`;

describe('URL patterns', () => {
  it('normalizes patterns and rejects ones without a whole-segment *', () => {
    expect(normalizeInternetPlace('https://www.Letterboxd.com/*/tag/*/films/?x=1', 'pattern'))
      .toBe('letterboxd.com/*/tag/*/films');
    expect(() => normalizeInternetPlace('letterboxd.com/nylonsmile/films', 'pattern')).toThrow();
    expect(() => normalizeInternetPlace('letterboxd.com/a*/films', 'pattern')).toThrow();
    expect(() => normalizeInternetPlace('*.letterboxd.com/*', 'pattern')).toThrow();
  });

  it('matches one segment per * on the same hostname', () => {
    const pattern = 'letterboxd.com/*/tag/*/films';
    expect(matchesUrlPattern(pattern, film('nylonsmile', 'naomi'))).toBe(true);
    expect(matchesUrlPattern(pattern, 'https://www.letterboxd.com/a/tag/b/films')).toBe(true);
    expect(matchesUrlPattern(pattern, 'https://letterboxd.com/a/tag/b/films/page/2')).toBe(false);
    expect(matchesUrlPattern(pattern, 'https://letterboxd.com/a/list/b/films')).toBe(false);
    expect(matchesUrlPattern(pattern, 'https://other.com/a/tag/b/films')).toBe(false);
  });

  it('ranks page, then the narrowest pattern, then path, hostname and site', () => {
    const policy = (scope: InternetPlacePolicy['scope'], placeKey: string): InternetPlacePolicy =>
      ({ scope, placeKey, placement: 'regular', note: scope, updatedAt: '' });
    const policies = [
      policy('site', 'letterboxd.com'),
      policy('path', 'letterboxd.com/nylonsmile'),
      policy('pattern', 'letterboxd.com/*/tag/*/*'),
      policy('pattern', 'letterboxd.com/*/tag/*/films'),
    ];
    expect(resolveInternetPlacePolicy(policies, film('nylonsmile', 'naomi'))?.placeKey)
      .toBe('letterboxd.com/*/tag/*/films');
    expect(resolveInternetPlacePolicy(
      [...policies, policy('page', film('nylonsmile', 'naomi'))],
      film('nylonsmile', 'naomi'),
    )?.scope).toBe('page');
    expect(resolveInternetPlacePolicy(policies, 'https://letterboxd.com/nylonsmile/films')?.scope)
      .toBe('path');
  });

  it('suggests patterns from seen URLs, narrowest first, only for real repeats', () => {
    const seen = [
      film('nylonsmile', 'horror'),
      film('nylonsmile', 'a24'),
      film('davidehrlich', 'comfort'),
      film('karsten', 'naomi'),
      'https://letterboxd.com/film/past-lives',
      'https://other.com/nylonsmile/tag/naomi/films',
    ];
    const suggestions = suggestUrlPatterns(film('nylonsmile', 'naomi'), seen);
    expect(suggestions.map((suggestion) => suggestion.pattern)).toEqual([
      'letterboxd.com/nylonsmile/tag/*/films',
      'letterboxd.com/*/tag/*/films',
    ]);
    expect(suggestions[1].matches).toHaveLength(5);
    expect(suggestUrlPatterns(film('nylonsmile', 'naomi'), [film('karsten', 'naomi')])).toEqual([]);
    expect(suggestUrlPatterns('https://letterboxd.com/', seen)).toEqual([]);
  });
});
