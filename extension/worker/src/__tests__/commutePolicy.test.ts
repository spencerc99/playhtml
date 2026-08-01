// ABOUTME: Verifies that Internet Commute responses expose only safe public destinations.
// ABOUTME: Covers domain-only scenery, private apps, query rules, and aggregate activity.

import { describe, expect, it } from 'vitest';
import type { CollectionEvent } from '@playhtml/extension-types';
import { buildCommuteResponse } from '../routes/commutePolicy';

function event(
  id: string,
  type: CollectionEvent['type'],
  url: string,
  ts: number,
  pid: string,
  title?: string,
): CollectionEvent {
  return {
    id,
    type,
    ts,
    data: title ? { title } : {},
    meta: {
      pid,
      sid: `session-${pid}`,
      url,
      vw: 1200,
      vh: 800,
      tz: 'UTC',
      cursor_color: '#5b8db8',
    },
  };
}

describe('buildCommuteResponse', () => {
  it('keeps only YouTube video identity parameters', () => {
    const response = buildCommuteResponse(
      [
        event(
          'youtube',
          'navigation',
          'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=private&utm_source=feed',
          200,
          'rider-one',
          'A particular video',
        ),
      ],
      [],
      1_000,
    );

    expect(response.destinations).toEqual([
      expect.objectContaining({
        domain: 'youtube.com',
        title: 'A particular video',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      }),
    ]);
  });

  it('keeps private applications and unknown query pages as domain-only scenery', () => {
    const response = buildCommuteResponse(
      [
        event(
          'doc',
          'navigation',
          'https://docs.google.com/document/d/private-document-id/edit',
          300,
          'rider-one',
          'Personal planning document',
        ),
        event(
          'unknown-query',
          'navigation',
          'https://small.example/read?id=bearer-link',
          200,
          'rider-two',
          'An otherwise interesting page',
        ),
        event(
          'article',
          'navigation',
          'https://garden.example/essays/moss',
          100,
          'rider-three',
          'Notes on moss',
        ),
      ],
      [],
      1_000,
    );

    expect(response.scenery).toEqual([
      expect.objectContaining({ domain: 'docs.google.com' }),
      expect.objectContaining({ domain: 'small.example' }),
      expect.objectContaining({ domain: 'garden.example' }),
    ]);
    expect(response.scenery).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Personal planning document',
        }),
      ]),
    );
    expect(response.destinations).toEqual([
      expect.objectContaining({
        domain: 'garden.example',
        title: 'Notes on moss',
        url: 'https://garden.example/essays/moss',
      }),
    ]);
  });

  it('keeps large documentation and authentication surfaces as scenery only', () => {
    const response = buildCommuteResponse(
      [
        event(
          'superhuman-docs',
          'navigation',
          'https://docs.superhuman.com/help/article',
          300,
          'docs-rider',
          'Superhuman Help Center',
        ),
        event(
          'saml-callback',
          'navigation',
          'https://idpproxy.illinois.edu/simplesaml/module.php/saml/sp/saml2-acs.php/saml-sp',
          200,
          'auth-rider',
          'Sign in',
        ),
        event(
          'saml-callback-path',
          'navigation',
          'https://university.example/simplesaml/module.php/saml/sp/saml2-acs.php/service',
          150,
          'callback-rider',
          'University login',
        ),
        event(
          'article',
          'navigation',
          'https://garden.example/essays/moss',
          100,
          'article-rider',
          'Notes on moss',
        ),
      ],
      [],
      1_000,
    );

    expect(response.scenery.map((item) => item.domain)).toEqual([
      'docs.superhuman.com',
      'idpproxy.illinois.edu',
      'university.example',
      'garden.example',
    ]);
    expect(
      response.destinations.map((destination) => destination.domain),
    ).toEqual(['garden.example']);
  });

  it('keeps IMDb entity pages while removing tracking queries', () => {
    const response = buildCommuteResponse(
      [
        event(
          'imdb-title',
          'navigation',
          'https://www.imdb.com/title/tt0133093/?ref_=nv_sr_srsg_0_tt_8_nm_0_in_0_q_matrix',
          200,
          'movie-rider',
          'The Matrix (1999) - IMDb',
        ),
      ],
      [],
      1_000,
    );

    expect(response.destinations).toEqual([
      expect.objectContaining({
        domain: 'imdb.com',
        title: 'The Matrix (1999) - IMDb',
        url: 'https://www.imdb.com/title/tt0133093',
      }),
    ]);
  });

  it('keeps user-bound surfaces as scenery but excludes them from destinations', () => {
    const response = buildCommuteResponse(
      [
        event(
          'cart',
          'navigation',
          'https://shop.example/cart',
          500,
          'cart-rider',
          'Your cart',
        ),
        event(
          'account',
          'navigation',
          'https://shop.example/account/orders',
          450,
          'account-rider',
          'Order history',
        ),
        event(
          'account-subdomain',
          'navigation',
          'https://account.mayoclinic.org/',
          440,
          'patient-rider',
          'Patient portal',
        ),
        event(
          'candidate-portal',
          'navigation',
          'https://candidate.atsglobe.com/',
          430,
          'candidate-rider',
          'Candidate portal',
        ),
        event(
          'login',
          'navigation',
          'https://service.example/users/sign_in',
          400,
          'login-rider',
          'Sign in',
        ),
        event(
          'redirect',
          'navigation',
          'https://newsletter.example/redirect/message',
          300,
          'redirect-rider',
          'https://destination.example/page',
        ),
        event(
          'article',
          'navigation',
          'https://article.example/story',
          200,
          'article-rider',
          'A story worth visiting',
        ),
        event(
          'publisher',
          'navigation',
          'https://newsletter.substack.com/publish/stats/audience',
          190,
          'publisher-rider',
          'Newsletter audience',
        ),
        event(
          'schedule',
          'navigation',
          'https://work.example/my_schedule',
          180,
          'schedule-rider',
          'My schedule',
        ),
        event(
          'spotify',
          'navigation',
          'https://open.spotify.com/',
          170,
          'spotify-rider',
          'Spotify – Web Player',
        ),
        event(
          'download',
          'navigation',
          'https://game.itch.io/title/download/signed-token',
          160,
          'download-rider',
          'Download a game',
        ),
        event(
          'puzzle-stats',
          'navigation',
          'https://www.nytimes.com/puzzles/stats',
          150,
          'puzzle-rider',
          'NYTimes Crosswords',
        ),
        event(
          'generic-pinterest',
          'navigation',
          'https://uk.pinterest.com/ideas/interesting/123',
          140,
          'pinterest-rider',
          'Pinterest',
        ),
        event(
          'public-newsletter',
          'navigation',
          'https://newsletter.substack.com/p/a-public-essay',
          130,
          'newsletter-rider',
          'A public essay',
        ),
        event(
          'generic-newsletter',
          'navigation',
          'https://generic.substack.com/',
          125,
          'generic-newsletter-rider',
          'Substack',
        ),
      ],
      [],
      1_000,
    );

    expect(response.scenery.map((item) => item.domain)).toEqual([
      'shop.example',
      'account.mayoclinic.org',
      'candidate.atsglobe.com',
      'service.example',
      'newsletter.example',
      'article.example',
      'newsletter.substack.com',
      'work.example',
      'open.spotify.com',
      'game.itch.io',
      'nytimes.com',
      'uk.pinterest.com',
      'generic.substack.com',
    ]);
    expect(
      response.destinations.map((destination) => destination.domain),
    ).toEqual(['article.example', 'newsletter.substack.com']);
  });

  it('omits local-network hosts from scenery', () => {
    const response = buildCommuteResponse(
      [
        event(
          'localhost',
          'navigation',
          'http://localhost:5173/private-project',
          200,
          'local-rider',
          'Development server',
        ),
        event(
          'article',
          'navigation',
          'https://article.example/story',
          100,
          'article-rider',
          'A story worth visiting',
        ),
      ],
      [],
      1_000,
    );

    expect(response.scenery.map((item) => item.domain)).toEqual([
      'article.example',
    ]);
  });

  it('returns an aggregate active-person count without participant identifiers', () => {
    const response = buildCommuteResponse(
      [],
      [
        event(
          'recent-one',
          'cursor',
          'https://private.example/one',
          950_000,
          'person-one',
        ),
        event(
          'recent-two',
          'cursor',
          'https://private.example/two',
          900_000,
          'person-two',
        ),
        event(
          'duplicate',
          'cursor',
          'https://private.example/three',
          850_000,
          'person-one',
        ),
        event(
          'old',
          'cursor',
          'https://private.example/four',
          700_000,
          'person-three',
        ),
      ],
      1_000_000,
    );

    expect(response.activePeople).toBe(2);
    expect(JSON.stringify(response)).not.toContain('person-one');
    expect(JSON.stringify(response)).not.toContain('private.example/one');
  });
});
