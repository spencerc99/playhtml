// ABOUTME: Welcome email template sent on first signup to we were online.
// ABOUTME: Renders both HTML (via react-email) and plaintext for email-client compatibility.

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { render } from '@react-email/render';

const CHROME_URL =
  'https://chromewebstore.google.com/detail/we-were-online/bhkdblmogjkgeipehaphdocclmijnkhc?authuser=0&hl=en';
const FIREFOX_URL =
  'https://addons.mozilla.org/en-US/firefox/addon/we-were-online/';
const HOMEPAGE_URL = 'https://wewere.online/';
const PLAYHTML_URL = 'https://playhtml.fun/';
const SELF_PORTRAIT_URL =
  'https://spencer.place/creation/self-portrait-(internet)';
const REPLY_EMAIL = 'hi@spencer.place';

export const WELCOME_EMAIL_SUBJECT =
  'welcome to we were online — install links inside';

export const WELCOME_EMAIL_TEXT = `Hi everyone!

Thank you for filling out the form and being willing to try something that makes the Internet hopefully feel a bit more alive :) I'm excited to share the beta of we were online (${HOMEPAGE_URL}) with you.

- Download on Chrome (or chromium equivalents): ${CHROME_URL}
- Download on Firefox: ${FIREFOX_URL}
- Use another browser or run into any issues? let me know

As a reminder, we were online is a browser extension—part game, artwork, and tool—that turns the existing Internet into a living, shared world, actively shaped by its inhabitants. Eventually, I want this to be a space where we can bump into each other all over the web and other creatives can create more embodied social media from their personal websites to bring belonging to the open web (building on top of playhtml: ${PLAYHTML_URL}).

But that'll be a long process and here's what you can do now:

1. Collect your browsing traces: your trails, keypresses, scrolls are transformed into an Internet self-portrait. It's an experiment in taking data that's usually used for surveillance and making it into something expressive instead. Data stored locally and collected anonymously. If you'd like, you can also share the data to contribute to a collective portrait of the Internet: ${SELF_PORTRAIT_URL}

2. Browse collectively on Wikipedia: you'll see other people browsing Wikipedia and can even follow each other down links. This is a first experiment in the kinds of collective interactions that I hope to bring to the rest of the web.

If you have an idea for a new social web experience (like the Wikipedia one), please let me know! I'm working directly with people to help bring their ideas to life.

Thanks for your willingness to try something new and contribute to making a new kind of Internet! Let me know what you think anytime at my email :)

spencer
${REPLY_EMAIL}
`;

const styles = {
  body: {
    backgroundColor: '#faf7f2',
    color: '#3d3833',
    fontFamily:
      "'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
    margin: 0,
    padding: 0,
  },
  container: {
    margin: '0 auto',
    padding: '40px 24px',
    maxWidth: '560px',
  },
  wordmark: {
    fontFamily: "'Source Serif 4', 'Source Serif Pro', Georgia, serif",
    fontStyle: 'italic',
    fontWeight: 200,
    fontSize: '32px',
    color: '#3d3833',
    margin: '0 0 24px 0',
    letterSpacing: '-0.01em',
  },
  paragraph: {
    fontSize: '16px',
    lineHeight: '1.6',
    margin: '0 0 16px 0',
  },
  buttonRow: {
    margin: '24px 0',
  },
  button: {
    display: 'inline-block',
    backgroundColor: '#4a9a8a',
    color: '#faf7f2',
    padding: '12px 20px',
    borderRadius: '4px',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: '15px',
    marginRight: '8px',
    marginBottom: '8px',
  },
  list: {
    fontSize: '16px',
    lineHeight: '1.6',
    paddingLeft: '20px',
    margin: '0 0 16px 0',
  },
  signature: {
    fontFamily: "'Source Serif 4', 'Source Serif Pro', Georgia, serif",
    fontStyle: 'italic',
    fontSize: '18px',
    color: '#3d3833',
    margin: '24px 0 0 0',
  },
} as const;

export function WelcomeEmail() {
  return (
    <Html>
      <Head />
      <Preview>install links for we were online — and what to expect next</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading as="h1" style={styles.wordmark}>
            we were online
          </Heading>
          <Text style={styles.paragraph}>Hi everyone!</Text>
          <Text style={styles.paragraph}>
            Thank you for filling out the form and being willing to try something
            that makes the Internet hopefully feel a bit more alive :) I'm
            excited to share the beta of{' '}
            <Link href={HOMEPAGE_URL}>
              <em>we were online</em>
            </Link>{' '}
            with you.
          </Text>
          <Section style={styles.buttonRow}>
            <Link href={CHROME_URL} style={styles.button}>
              Download on Chrome
            </Link>
            <Link href={FIREFOX_URL} style={styles.button}>
              Download on Firefox
            </Link>
          </Section>
          <Text style={styles.paragraph}>
            (Chrome download also works for Chromium-equivalents.) Use another
            browser or run into any issues?{' '}
            <Link href={`mailto:${REPLY_EMAIL}`}>let me know</Link>.
          </Text>
          <Text style={styles.paragraph}>
            As a reminder, we were online is a browser extension—part game,
            artwork, and tool—that turns the existing Internet into a living,
            shared world, actively shaped by its inhabitants. Eventually, I want
            this to be a space where we can bump into each other all over the
            web and other creatives can create more embodied social media from
            their personal websites to bring belonging to the open web (building
            on top of <Link href={PLAYHTML_URL}>playhtml</Link>).
          </Text>
          <Text style={styles.paragraph}>
            But that'll be a long process and here's what you can do now:
          </Text>
          <ol style={styles.list}>
            <li>
              <strong>Collect your browsing traces:</strong> your trails,
              keypresses, scrolls are transformed into an Internet self-portrait.
              It's an experiment in taking data that's usually used for
              surveillance and making it into something expressive instead. Data
              stored locally and collected anonymously. If you'd like, you can
              also share the data to contribute to a{' '}
              <Link href={SELF_PORTRAIT_URL}>
                collective portrait of the Internet
              </Link>
              .
            </li>
            <li>
              <strong>Browse collectively on Wikipedia:</strong> you'll see
              other people browsing Wikipedia and can even follow each other
              down links. This is a first experiment in the kinds of collective
              interactions that I hope to bring to the rest of the web.
            </li>
          </ol>
          <Text style={styles.paragraph}>
            If you have an idea for a new social web experience (like the
            Wikipedia one), please let me know! I'm working directly with
            people to help bring their ideas to life.
          </Text>
          <Text style={styles.paragraph}>
            Thanks for your willingness to try something new and contribute to
            making a new kind of Internet! Let me know what you think anytime at{' '}
            <Link href={`mailto:${REPLY_EMAIL}`}>{REPLY_EMAIL}</Link> :)
          </Text>
          <Text style={styles.signature}>spencer</Text>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderWelcomeEmail(): Promise<string> {
  return await render(<WelcomeEmail />);
}
