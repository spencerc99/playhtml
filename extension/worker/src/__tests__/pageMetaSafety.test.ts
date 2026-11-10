// ABOUTME: Verifies that page inspection accepts only bounded public HTTP targets.
// ABOUTME: Covers credential, port, reserved-host, and IP-literal rejection.

import { describe, expect, it } from 'vitest';
import { isPublicHttpUrl, resolvePublicRedirect } from '../routes/pageMeta';

describe('isPublicHttpUrl', () => {
  it('accepts ordinary public HTTP pages', () => {
    expect(isPublicHttpUrl('https://example.com/article')?.toString()).toBe(
      'https://example.com/article',
    );
    expect(
      isPublicHttpUrl('http://subdomain.example.org:80/page'),
    ).not.toBeNull();
    expect(
      isPublicHttpUrl('https://httpbin.org/redirect-to?url=http://127.0.0.1/'),
    ).not.toBeNull();
  });

  it.each([
    'https://localhost/page',
    'https://service.internal/page',
    'https://home.arpa/page',
    'https://device.local/page',
    'https://127.0.0.1/page',
    'https://2130706433/page',
    'https://0x7f000001/page',
    'https://[::1]/page',
    'https://user:password@example.com/page',
    'https://example.com:8443/page',
    'file:///private/note',
  ])('rejects a non-public target: %s', (target) => {
    expect(isPublicHttpUrl(target)).toBeNull();
  });
});

describe('resolvePublicRedirect', () => {
  it('allows relative redirects between public pages', () => {
    expect(
      resolvePublicRedirect(
        new URL('https://example.com/start'),
        '/article',
      )?.toString(),
    ).toBe('https://example.com/article');
  });

  it.each([
    'http://127.0.0.1/private',
    'http://[::1]/private',
    'https://service.internal/private',
    'file:///private/note',
  ])('rejects a redirect to a non-public target: %s', (location) => {
    expect(
      resolvePublicRedirect(new URL('https://example.com/start'), location),
    ).toBeNull();
  });
});
