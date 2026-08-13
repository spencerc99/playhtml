// ABOUTME: Verifies deterministic public-page verdicts from bounded response evidence.
// ABOUTME: Covers redirects, account gates, noindex directives, and unavailable pages.

import { describe, expect, it } from 'vitest';
import {
  classifyPublicPage,
  type PublicPageEvidence,
} from '../routes/publicPageInspection';

function pageEvidence(
  overrides: Partial<PublicPageEvidence> = {},
): PublicPageEvidence {
  return {
    requestedUrl: 'https://example.com/article',
    finalUrl: 'https://example.com/article',
    status: 200,
    contentType: 'text/html; charset=utf-8',
    xRobotsTag: null,
    htmlHead: '<title>An interesting article</title>',
    ...overrides,
  };
}

describe('classifyPublicPage', () => {
  it('accepts a successful indexable HTML page', () => {
    expect(classifyPublicPage(pageEvidence())).toEqual({
      verdict: 'public',
      reason: 'public_html',
      finalUrl: 'https://example.com/article',
    });
  });

  it.each([401, 403])('marks a %i response as gated', (status) => {
    expect(classifyPublicPage(pageEvidence({ status }))).toMatchObject({
      verdict: 'gated',
      reason: 'authentication_required',
    });
  });

  it('marks a redirect to an authentication route as gated', () => {
    expect(
      classifyPublicPage(
        pageEvidence({ finalUrl: 'https://example.com/auth/signin' }),
      ),
    ).toMatchObject({ verdict: 'gated', reason: 'login_redirect' });
  });

  it('does not treat an article mentioning login as an account gate', () => {
    expect(
      classifyPublicPage(
        pageEvidence({
          htmlHead:
            '<title>How login systems work</title><input type="password">',
        }),
      ),
    ).toMatchObject({ verdict: 'public', reason: 'public_html' });
  });

  it('marks a titled password form as gated', () => {
    expect(
      classifyPublicPage(
        pageEvidence({
          htmlHead:
            '<title>Sign in</title><input name="password" type=password>',
        }),
      ),
    ).toMatchObject({ verdict: 'gated', reason: 'authentication_required' });
  });

  it('honors noindex in an X-Robots-Tag header', () => {
    expect(
      classifyPublicPage(
        pageEvidence({ xRobotsTag: 'max-snippet:20, noindex' }),
      ),
    ).toMatchObject({ verdict: 'not_public', reason: 'noindex' });
  });

  it('honors the robots none shorthand', () => {
    expect(
      classifyPublicPage(
        pageEvidence({ htmlHead: '<meta name="robots" content="none">' }),
      ),
    ).toMatchObject({ verdict: 'not_public', reason: 'noindex' });
  });

  it.each([
    '<meta name="robots" content="nofollow, noindex">',
    "<meta content='NOINDEX' name='robots'>",
    '<meta name=robots content=noindex>',
    '<meta name="wewere-online" content="noindex">',
  ])('honors a supported HTML noindex directive', (htmlHead) => {
    expect(classifyPublicPage(pageEvidence({ htmlHead }))).toMatchObject({
      verdict: 'not_public',
      reason: 'noindex',
    });
  });

  it.each([
    [404, 'not_found'],
    [410, 'not_found'],
    [429, 'rate_limited'],
    [503, 'server_error'],
  ] as const)('marks status %i unavailable', (status, reason) => {
    expect(classifyPublicPage(pageEvidence({ status }))).toMatchObject({
      verdict: 'unavailable',
      reason,
    });
  });

  it('keeps unresolved redirects unknown', () => {
    expect(classifyPublicPage(pageEvidence({ status: 302 }))).toMatchObject({
      verdict: 'unknown',
      reason: 'unresolved_redirect',
    });
  });

  it('does not promote a non-HTML response', () => {
    expect(
      classifyPublicPage(pageEvidence({ contentType: 'application/pdf' })),
    ).toMatchObject({ verdict: 'not_public', reason: 'not_html' });
  });
});
