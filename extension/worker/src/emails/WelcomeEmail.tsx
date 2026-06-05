// ABOUTME: Email templates sent to we were online signups.
// ABOUTME: Exposes HTML and plaintext bodies for download-link and updates emails.

const CHROME_URL =
  'https://chromewebstore.google.com/detail/we-were-online/bhkdblmogjkgeipehaphdocclmijnkhc?authuser=0&hl=en';
const FIREFOX_URL =
  'https://addons.mozilla.org/en-US/firefox/addon/we-were-online/';
const HOMEPAGE_URL = 'https://wewere.online/';
const PLAYHTML_URL = 'https://playhtml.fun/';
const DISCORD_INVITE_URL = 'https://discord.gg/SKbsSf4ptU';
const SELF_PORTRAIT_URL =
  'https://spencer.place/creation/self-portrait-(internet)';
const REPLY_EMAIL = 'hi@spencer.place';

export const WELCOME_EMAIL_SUBJECT = 'welcome to we were online!';

export const UPDATES_EMAIL_SUBJECT = 'updates from we were online';

const SHARED_EMAIL_TEXT = `As a reminder, we were online is a browser extension—part game, artwork, and tool—that turns the existing Internet into a living, shared world, actively shaped by its inhabitants. Eventually, I want this to be a space where we can bump into each other all over the web and other creatives can create more embodied social media from their personal websites to bring belonging to the open web (building on top of playhtml: ${PLAYHTML_URL}).

But that'll be a long process and here's what you can do now:

1. Collect your browsing traces: your trails, keypresses, scrolls are transformed into an Internet self-portrait. It's an experiment in taking data that's usually used for surveillance and making it into something expressive instead. Data stored locally and collected anonymously. If you'd like, you can also share the data to contribute to a collective portrait of the Internet: ${SELF_PORTRAIT_URL}

2. Browse collectively on Wikipedia: you'll see other people browsing Wikipedia and can even follow each other down links. This is a first experiment in the kinds of collective interactions that I hope to bring to the rest of the web.

If you have an idea for a new social web experience (like the Wikipedia one), please let me know! I'm working directly with people to help bring their ideas to life.

You can also join the playhtml discord: ${DISCORD_INVITE_URL}

Thanks for your willingness to try something new and contribute to making a new kind of Internet! Let me know what you think anytime at my email :)

spencer
${REPLY_EMAIL}
`;

export const WELCOME_EMAIL_TEXT = `Hi everyone!

Thanks for signing up and being willing to try something that makes the Internet hopefully feel a bit more alive :) I'm excited to share the beta of we were online (${HOMEPAGE_URL}) with you.

- Download on Chrome (or chromium equivalents): ${CHROME_URL}
- Download on Firefox: ${FIREFOX_URL}
- Use another browser or run into any issues? let me know

${SHARED_EMAIL_TEXT}`;

export const UPDATES_EMAIL_TEXT = `Hi everyone!

Thanks for signing up for updates as we keep building we were online (${HOMEPAGE_URL}).

${SHARED_EMAIL_TEXT}`;

const SHARED_EMAIL_HTML = `
            <p style="font-size:16px;line-height:1.6;margin:0 0 16px 0">
              As a reminder, we were online is a browser extension - part game, artwork, and tool - that turns the existing Internet into a living, shared world, actively shaped by its inhabitants. Eventually, I want this to be a space where we can bump into each other all over the web and other creatives can create more embodied social media from their personal websites to bring belonging to the open web (building on top of
              <a href="${PLAYHTML_URL}" style="color:#067df7;text-decoration:none" target="_blank">playhtml</a>).
            </p>
            <p style="font-size:16px;line-height:1.6;margin:0 0 16px 0">But that'll be a long process and here's what you can do now:</p>
            <ol style="font-size:16px;line-height:1.6;padding-left:20px;margin:0 0 16px 0">
              <li>
                <strong>Collect your browsing traces:</strong> your trails, keypresses, scrolls are transformed into an Internet self-portrait. It's an experiment in taking data that's usually used for surveillance and making it into something expressive instead. Data stored locally and collected anonymously. If you'd like, you can also share the data to contribute to a
                <a href="${SELF_PORTRAIT_URL}" style="color:#067df7;text-decoration:none" target="_blank">collective portrait of the Internet</a>.
              </li>
              <li>
                <strong>Browse collectively on Wikipedia:</strong> you'll see other people browsing Wikipedia and can even follow each other down links. This is a first experiment in the kinds of collective interactions that I hope to bring to the rest of the web.
              </li>
            </ol>
            <p style="font-size:16px;line-height:1.6;margin:0 0 16px 0">
              If you have an idea for a new social web experience (like the Wikipedia one), please let me know! I'm working directly with people to help bring their ideas to life.
            </p>
            <div style="margin:24px 0">
              <a href="${DISCORD_INVITE_URL}" style="display:inline-block;background-color:#3d3833;color:#faf7f2;padding:12px 20px;border-radius:4px;text-decoration:none;font-weight:600;font-size:15px" target="_blank">
                join the playhtml discord
              </a>
            </div>
            <p style="font-size:16px;line-height:1.6;margin:0 0 16px 0">
              Thanks for your willingness to try something new and contribute to making a new kind of Internet! Let me know what you think anytime at
              <a href="mailto:${REPLY_EMAIL}" style="color:#067df7;text-decoration:none" target="_blank">${REPLY_EMAIL}</a> :)
            </p>
            <p style="font-family:'Source Serif 4','Source Serif Pro',Georgia,serif;font-style:italic;font-size:18px;color:#3d3833;margin:24px 0 0 0">spencer</p>`;

function buildEmailHtml(subject: string, preview: string, introHtml: string): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${subject}</title>
  </head>
  <body style="background-color:#faf7f2;color:#3d3833;font-family:'Atkinson Hyperlegible',-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;margin:0;padding:0">
    <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">
      ${preview}
    </div>
    <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;margin:0 auto;padding:40px 24px">
      <tbody>
        <tr style="width:100%">
          <td>
            <h1 style="font-family:'Source Serif 4','Source Serif Pro',Georgia,serif;font-style:italic;font-weight:200;font-size:32px;color:#3d3833;margin:0 0 24px 0;letter-spacing:0">
              we were online
            </h1>
            ${introHtml}
${SHARED_EMAIL_HTML}
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;
}

const WELCOME_EMAIL_HTML = buildEmailHtml(
  WELCOME_EMAIL_SUBJECT,
  'install links for we were online - and what to expect next',
  `<p style="font-size:16px;line-height:1.6;margin:0 0 16px 0">Hi everyone!</p>
            <p style="font-size:16px;line-height:1.6;margin:0 0 16px 0">
              Thanks for signing up and being willing to try something that makes the Internet hopefully feel a bit more alive :) I'm excited to share the beta of
              <a href="${HOMEPAGE_URL}" style="color:#067df7;text-decoration:none" target="_blank"><em>we were online</em></a>
              with you.
            </p>
            <div style="margin:24px 0">
              <a href="${CHROME_URL}" style="display:inline-block;background-color:#4a9a8a;color:#faf7f2;padding:12px 20px;border-radius:4px;text-decoration:none;font-weight:600;font-size:15px;margin-right:8px;margin-bottom:8px" target="_blank">
                Download on Chrome
              </a>
              <a href="${FIREFOX_URL}" style="display:inline-block;background-color:#4a9a8a;color:#faf7f2;padding:12px 20px;border-radius:4px;text-decoration:none;font-weight:600;font-size:15px;margin-right:8px;margin-bottom:8px" target="_blank">
                Download on Firefox
              </a>
            </div>
            <p style="font-size:16px;line-height:1.6;margin:0 0 16px 0">
              (Chrome download also works for Chromium-equivalents.) Use another browser or run into any issues?
              <a href="mailto:${REPLY_EMAIL}" style="color:#067df7;text-decoration:none" target="_blank">let me know</a>.
            </p>`,
);

const UPDATES_EMAIL_HTML = buildEmailHtml(
  UPDATES_EMAIL_SUBJECT,
  'updates from we were online and playhtml',
  `<p style="font-size:16px;line-height:1.6;margin:0 0 16px 0">Hi everyone!</p>
            <p style="font-size:16px;line-height:1.6;margin:0 0 16px 0">
              Thanks for signing up for updates as we keep building
              <a href="${HOMEPAGE_URL}" style="color:#067df7;text-decoration:none" target="_blank"><em>we were online</em></a>.
            </p>`,
);

export async function renderWelcomeEmail(): Promise<string> {
  return WELCOME_EMAIL_HTML;
}

export async function renderUpdatesEmail(): Promise<string> {
  return UPDATES_EMAIL_HTML;
}
