// ABOUTME: Tests for rendered signup email download links.
// ABOUTME: Verifies welcome email bodies include every supported browser install target.

import { describe, expect, it } from 'vitest';
import { WELCOME_EMAIL_TEXT, renderWelcomeEmail } from '../WelcomeEmail';

const EDGE_DOWNLOAD_URL =
  'https://microsoftedge.microsoft.com/addons/detail/we-were-online/kiamoecdnaglmhigmbmdkiodbbphpodl';

describe('WelcomeEmail', () => {
  it('includes an Edge install link in the plaintext welcome email', () => {
    expect(WELCOME_EMAIL_TEXT).toContain(`- Download on Edge: ${EDGE_DOWNLOAD_URL}`);
  });

  it('includes an Edge install link in the HTML welcome email', async () => {
    const html = await renderWelcomeEmail();

    expect(html).toContain('Download on Edge');
    expect(html).toContain(`href="${EDGE_DOWNLOAD_URL}"`);
  });
});
