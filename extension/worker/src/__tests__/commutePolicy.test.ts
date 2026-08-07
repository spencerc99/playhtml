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
  it('returns a larger destination pool for consecutive finite train routes', () => {
    const response = buildCommuteResponse(
      Array.from({ length: 60 }, (_, index) =>
        event(
          `destination-${index}`,
          'navigation',
          `https://destination-${index}.com/place`,
          1_000 - index,
          `rider-${index}`,
          `Destination ${index}`,
        ),
      ),
      [],
      2_000,
    );

    expect(response.destinations).toHaveLength(50);
    expect(
      new Set(response.destinations.map((item) => item.domain)).size,
    ).toBe(50);
  });

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

  it('keeps public product pages while removing shopping parameters', () => {
    const response = buildCommuteResponse(
      [
        event(
          'amazon-product',
          'navigation',
          'https://www.amazon.com/Writing-Tools/dp/B0ABC12345/ref=sr_1_1?dib=private&tag=affiliate-20',
          300,
          'amazon-rider',
          'A useful writing tool',
        ),
        event(
          'store-product',
          'navigation',
          'https://shop.example/products/linen-shirt?variant=private&utm_source=feed',
          200,
          'store-rider',
          'Linen shirt',
        ),
        event(
          'marketplace-listing',
          'navigation',
          'https://www.etsy.com/listing/123456789/handmade-object?ref=private',
          150,
          'marketplace-rider',
          'Handmade object',
        ),
        event(
          'store-cart',
          'navigation',
          'https://shop.example/cart?item=private',
          100,
          'cart-rider',
          'Your cart',
        ),
        event(
          'amazon-home',
          'navigation',
          'https://www.amazon.com/',
          50,
          'amazon-home-rider',
          'Amazon.com. Spend less. Smile more.',
        ),
      ],
      [],
      1_000,
    );

    expect(response.destinations).toHaveLength(3);
    expect(response.destinations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'amazon.com',
          title: 'A useful writing tool',
          url: 'https://www.amazon.com/dp/B0ABC12345',
        }),
        expect.objectContaining({
          domain: 'shop.example',
          title: 'Linen shirt',
          url: 'https://shop.example/products/linen-shirt',
        }),
        expect.objectContaining({
          domain: 'etsy.com',
          title: 'Handmade object',
          url: 'https://www.etsy.com/listing/123456789/handmade-object',
        }),
      ]),
    );
  });

  it('keeps Grok as scenery while allowing Archive.org item pages as stops', () => {
    const response = buildCommuteResponse(
      [
        event(
          'grok',
          'navigation',
          'https://grok.com/',
          200,
          'grok-rider',
          'Grok',
        ),
        event(
          'archive-item',
          'navigation',
          'https://archive.org/details/computerchronicles',
          100,
          'archive-rider',
          'Computer Chronicles',
        ),
      ],
      [],
      1_000,
    );

    expect(response.scenery.map((item) => item.domain)).toEqual([
      'grok.com',
      'archive.org',
    ]);
    expect(response.destinations).toEqual([
      expect.objectContaining({
        domain: 'archive.org',
        title: 'Computer Chronicles',
        url: 'https://archive.org/details/computerchronicles',
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

  it('omits non-public and tracking hosts from scenery', () => {
    const response = buildCommuteResponse(
      [
        event(
          'single-label',
          'navigation',
          'http://jellyfin-local:8096/web',
          300,
          'local-rider',
          'Jellyfin',
        ),
        event(
          'tracking-host',
          'navigation',
          'https://tracking.prmtracking.com/click/campaign',
          200,
          'tracking-rider',
          'Redirecting',
        ),
        event(
          'credentialed-host',
          'navigation',
          'https://person:secret@example.com/private',
          150,
          'credential-rider',
          'Private server',
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

  it('keeps search engines and query-like paths as scenery only', () => {
    const response = buildCommuteResponse(
      [
        event(
          'search-engine',
          'navigation',
          'https://duckduckgo.com/?q=private+search',
          400,
          'search-rider',
          'Private search',
        ),
        event(
          'query-path',
          'navigation',
          'https://search.example/results/&q=private+search',
          300,
          'query-path-rider',
          'Private search',
        ),
        event(
          'article',
          'navigation',
          'https://garden.example/essays/moss',
          200,
          'article-rider',
          'Notes on moss',
        ),
      ],
      [],
      2_000,
    );

    expect(response.destinations.map((item) => item.domain)).toEqual([
      'garden.example',
    ]);
  });

  it('keeps private applications and opaque sessions as scenery only', () => {
    const response = buildCommuteResponse(
      [
        event(
          'photos-search',
          'navigation',
          'https://photos.google.com/u/1/search/private-search-id',
          1_000,
          'photos-rider',
          'Google Photos',
        ),
        event(
          'slack-channel',
          'navigation',
          'https://app.slack.com/client/T52AJV4BA/C0B90D2LLS3',
          900,
          'slack-rider',
          'Workspace channel',
        ),
        event(
          'miro-board',
          'navigation',
          'https://miro.com/app/board/uXjVH9KT5eM=',
          800,
          'miro-rider',
          'A private workspace',
        ),
        event(
          'messenger-thread',
          'navigation',
          'https://messenger.com/e2ee/t/6091314047652823',
          700,
          'messenger-rider',
          'Messenger',
        ),
        event(
          'meeting',
          'navigation',
          'https://meet.google.com/abc-defg-hij',
          600,
          'meeting-rider',
          'Private meeting',
        ),
        event(
          'application',
          'navigation',
          'https://apply.commonapp.org/mycolleges/327/3900/14662',
          500,
          'application-rider',
          'My Colleges',
        ),
        event(
          'university-portal',
          'navigation',
          'https://my.university.example/uPortal/f/servicehub/normal/render.uP',
          400,
          'portal-rider',
          'Student service hub',
        ),
        event(
          'university-course-manager',
          'navigation',
          'https://mygju.gju.edu.jo/faces/course_sections/manage_course_sections.xhtml',
          350,
          'course-manager-rider',
          'Manage Course Sections',
        ),
        event(
          'collaborative-room',
          'navigation',
          'https://collaboration.example/rooms/2df06b06-ab84-448e-b904-84c8f0997aa9',
          300,
          'room-rider',
          'Shared room',
        ),
        event(
          'article',
          'navigation',
          'https://garden.example/essays/moss',
          200,
          'article-rider',
          'Notes on moss',
        ),
      ],
      [],
      2_000,
    );

    expect(response.scenery.map((item) => item.domain)).toEqual([
      'photos.google.com',
      'app.slack.com',
      'miro.com',
      'messenger.com',
      'meet.google.com',
      'apply.commonapp.org',
      'my.university.example',
      'mygju.gju.edu.jo',
      'collaboration.example',
      'garden.example',
    ]);
    expect(response.destinations).toEqual([
      expect.objectContaining({
        domain: 'garden.example',
        url: 'https://garden.example/essays/moss',
      }),
    ]);
  });

  it('allows public platform content while excluding private platform surfaces', () => {
    const response = buildCommuteResponse(
      [
        event(
          'pinterest-board',
          'navigation',
          'https://www.pinterest.com/person/ideas',
          1_400,
          'pinterest-profile-rider',
          'Ideas',
        ),
        event(
          'pinterest-pin',
          'navigation',
          'https://www.pinterest.com/pin/1112811389198317559',
          1_300,
          'pinterest-pin-rider',
          'A particular pin',
        ),
        event(
          'github-profile',
          'navigation',
          'https://github.com/person',
          1_200,
          'github-profile-rider',
          'A GitHub profile',
        ),
        event(
          'github-organization',
          'navigation',
          'https://github.com/orgs/organization/repositories',
          1_150,
          'github-organization-rider',
          'An organization on GitHub',
        ),
        event(
          'github-repository',
          'navigation',
          'https://github.com/owner/project',
          1_100,
          'github-repository-rider',
          'A public repository',
        ),
        event(
          'ao3-profile',
          'navigation',
          'https://archiveofourown.org/users/person/stats',
          1_000,
          'ao3-profile-rider',
          'User Statistics',
        ),
        event(
          'ao3-work',
          'navigation',
          'https://archiveofourown.org/works/12345678',
          900,
          'ao3-work-rider',
          'A public work',
        ),
        event(
          'substack-note',
          'navigation',
          'https://substack.com/@person/note/c-123456',
          800,
          'substack-note-rider',
          'A personal note',
        ),
        event(
          'substack-article',
          'navigation',
          'https://publication.substack.com/p/a-public-essay',
          700,
          'substack-article-rider',
          'A public essay',
        ),
        event(
          'roblox-profile',
          'navigation',
          'https://roblox.com/users/123456/profile',
          600,
          'roblox-profile-rider',
          'A Roblox profile',
        ),
        event(
          'roblox-game',
          'navigation',
          'https://roblox.com/games/123456/a-public-game',
          500,
          'roblox-game-rider',
          'A public game',
        ),
        event(
          'wikipedia-user',
          'navigation',
          'https://sv.wikipedia.org/wiki/Anv%C3%A4ndare:Person',
          400,
          'wikipedia-user-rider',
          'Användare:Person – Wikipedia',
        ),
        event(
          'wikipedia-article',
          'navigation',
          'https://de.wikipedia.org/wiki/Depression',
          300,
          'wikipedia-article-rider',
          'Depression – Wikipedia',
        ),
        event(
          'archive-home',
          'navigation',
          'https://archive.org/',
          200,
          'archive-home-rider',
          'Internet Archive',
        ),
        event(
          'archive-item',
          'navigation',
          'https://archive.org/details/computerchronicles',
          100,
          'archive-item-rider',
          'Computer Chronicles',
        ),
      ],
      [],
      2_000,
    );

    expect(response.destinations.map((destination) => destination.url)).toEqual(
      expect.arrayContaining([
        'https://www.pinterest.com/pin/1112811389198317559',
        'https://github.com/owner/project',
        'https://archiveofourown.org/works/12345678',
        'https://publication.substack.com/p/a-public-essay',
        'https://roblox.com/games/123456/a-public-game',
        'https://de.wikipedia.org/wiki/Depression',
        'https://archive.org/details/computerchronicles',
      ]),
    );
    expect(response.destinations).toHaveLength(7);
  });

  it('keeps person-bound profiles and personalized homepages as scenery only', () => {
    const response = buildCommuteResponse(
      [
        event(
          'linkedin-profile',
          'navigation',
          'https://linkedin.com/in/person-123',
          800,
          'linkedin-rider',
          'A person on LinkedIn',
        ),
        event(
          'bluesky-profile',
          'navigation',
          'https://bsky.app/profile/person.example',
          700,
          'bluesky-rider',
          'A person on Bluesky',
        ),
        event(
          'lastfm-profile',
          'navigation',
          'https://last.fm/user/person',
          600,
          'lastfm-rider',
          'A music profile',
        ),
        event(
          'artfight-profile',
          'navigation',
          'https://artfight.net/~person',
          500,
          'artfight-rider',
          'An Art Fight profile',
        ),
        event(
          'patreon-profile',
          'navigation',
          'https://patreon.com/person',
          400,
          'patreon-rider',
          'A creator profile',
        ),
        event(
          'netflix-browse',
          'navigation',
          'https://netflix.com/browse',
          300,
          'netflix-rider',
          'Netflix',
        ),
        event(
          'article',
          'navigation',
          'https://garden.example/essays/moss',
          200,
          'article-rider',
          'Notes on moss',
        ),
      ],
      [],
      2_000,
    );

    expect(response.destinations.map((item) => item.domain)).toEqual([
      'garden.example',
    ]);
  });

  it('keeps short-form video and movie streaming services as scenery only', () => {
    const response = buildCommuteResponse(
      [
        event(
          'tiktok-video',
          'navigation',
          'https://www.tiktok.com/@person/video/1234567890123456789',
          500,
          'tiktok-rider',
          'A particular TikTok video',
        ),
        event(
          'peacock-show',
          'navigation',
          'https://www.peacocktv.com/watch/asset/tv/a-show/123',
          400,
          'peacock-rider',
          'A show on Peacock',
        ),
        event(
          'disney-show',
          'navigation',
          'https://www.disneyplus.com/series/a-show/abc123',
          300,
          'disney-rider',
          'A show on Disney+',
        ),
        event(
          'criterion-film',
          'navigation',
          'https://www.criterionchannel.com/videos/a-film',
          200,
          'criterion-rider',
          'A film on Criterion Channel',
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
      2_000,
    );

    expect(response.scenery.map((item) => item.domain)).toEqual([
      'tiktok.com',
      'peacocktv.com',
      'disneyplus.com',
      'criterionchannel.com',
      'garden.example',
    ]);
    expect(response.destinations.map((item) => item.domain)).toEqual([
      'garden.example',
    ]);
  });

  it('keeps public social posts while excluding profiles on the same platform', () => {
    const response = buildCommuteResponse(
      [
        event(
          'instagram-profile',
          'navigation',
          'https://instagram.com/person',
          500,
          'instagram-profile-rider',
          'A person on Instagram',
        ),
        event(
          'instagram-post',
          'navigation',
          'https://instagram.com/p/C0NTENT1234/',
          400,
          'instagram-post-rider',
          'A public post',
        ),
        event(
          'tumblr-profile',
          'navigation',
          'https://tumblr.com/person',
          300,
          'tumblr-profile-rider',
          'A person on Tumblr',
        ),
        event(
          'tumblr-post',
          'navigation',
          'https://tumblr.com/person/823750052332847104/a-public-post',
          200,
          'tumblr-post-rider',
          'A public post',
        ),
      ],
      [],
      2_000,
    );

    expect(response.destinations.map((item) => item.url)).toEqual([
      'https://instagram.com/p/C0NTENT1234',
      'https://tumblr.com/person/823750052332847104/a-public-post',
    ]);
  });

  it('keeps direct files as scenery only', () => {
    const response = buildCommuteResponse(
      [
        event(
          'pdf',
          'navigation',
          'https://assets.example/reports/research.pdf',
          400,
          'pdf-rider',
          'Research report',
        ),
        event(
          'image',
          'navigation',
          'https://uploads.example/private-image.png',
          300,
          'image-rider',
          'private-image.png',
        ),
        event(
          'article',
          'navigation',
          'https://garden.example/essays/moss',
          200,
          'article-rider',
          'Notes on moss',
        ),
      ],
      [],
      2_000,
    );

    expect(response.destinations.map((item) => item.domain)).toEqual([
      'garden.example',
    ]);
  });

  it('deduplicates destinations by registrable domain', () => {
    const response = buildCommuteResponse(
      [
        event(
          'shop',
          'navigation',
          'https://shop.norlys.dk/products/keyboard',
          300,
          'shop-rider',
          'A keyboard',
        ),
        event(
          'main',
          'navigation',
          'https://norlys.dk/articles/design',
          200,
          'article-rider',
          'An article about design',
        ),
        event(
          'other',
          'navigation',
          'https://garden.example/essays/moss',
          100,
          'garden-rider',
          'Notes on moss',
        ),
      ],
      [],
      2_000,
    );

    expect(response.destinations.map((item) => item.domain)).toEqual([
      'garden.example',
      'shop.norlys.dk',
    ]);
  });

  it('shows more representative scenery when browsing activity is higher', () => {
    const makeEvents = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        event(
          `event-${index}`,
          'navigation',
          `https://site-${index}.example/article`,
          count - index,
          `rider-${index}`,
          `Article ${index}`,
        ),
      );

    const lowActivity = buildCommuteResponse(makeEvents(40), [], 2_000);
    const highActivity = buildCommuteResponse(makeEvents(600), [], 2_000);
    const maximumActivity = buildCommuteResponse(makeEvents(2_000), [], 2_000);

    expect(lowActivity.scenery).toHaveLength(40);
    expect(highActivity.scenery).toHaveLength(120);
    expect(maximumActivity.scenery).toHaveLength(200);
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
