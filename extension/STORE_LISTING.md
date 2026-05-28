# Store listing copy

Canonical source for the long marketing description shown on the Chrome Web
Store and Firefox AMO listings. These fields are edited directly in each
store's developer dashboard (the `wxt submit` flow only uploads the build +
manifest, not this copy), so this file is the version-controlled record —
edit here, then paste into the dashboards.

The short manifest description (≤132 chars, shown in search results) lives in
`wxt.config.ts`, not here.

---

## Chrome Web Store — full description

Chrome renders this field as **plain text** (no markdown, URLs are not
clickable). Paste exactly as-is.

```
A quiet portrait of your time on the internet. Collect traces of where you've been and share them anonymously.

we were online is an online multiplayer world—part game, artwork, and tool—that turns the existing Internet into a living, shared world, actively shaped by its inhabitants. Contribute your browsing data to a collective portrait of the Internet and create your own Internet self-portraits.

Cursor trails, keypresses and clicks, scroll patterns, and navigation rhythms, time on pages come to life on the pages you visit and show you how long you've spent on each page.

What it collects (all configurable):
  - Cursor movement, clicks, and holds
  - Scroll and viewport changes
  - Page navigation (screen time)
  - Keyboard rhythm

What you can do:
  - View per-site "internet portraits" that visualize your browsing as trail art
  - Choose three privacy levels: off, local-only, or shared
  - Configure exactly which data types are collected

See other people (still in development):
- On Wikipedia, see others on the same article, chat with them live, watch links grow patina, and follow other cursors down rabbit holes. See it in action https://www.instagram.com/p/DYpRnRAORbE/

Data Collection Policies:

* You choose what is collected and where your data goes, on your device or shared for the purposes of the art project.
```

---

## Firefox AMO — full description

AMO supports a limited set of HTML tags, so the demo link can be clickable.
Paste into the "Description" field with HTML enabled.

```html
<p>A quiet portrait of your time on the internet. Collect traces of where you've been and share them anonymously.</p>

<p>we were online is an online multiplayer world—part game, artwork, and tool—that turns the existing Internet into a living, shared world, actively shaped by its inhabitants. Contribute your browsing data to a collective portrait of the Internet and create your own Internet self-portraits.</p>

<p>Cursor trails, keypresses and clicks, scroll patterns, and navigation rhythms, time on pages come to life on the pages you visit and show you how long you've spent on each page.</p>

<p><strong>What it collects (all configurable):</strong></p>
<ul>
  <li>Cursor movement, clicks, and holds</li>
  <li>Scroll and viewport changes</li>
  <li>Page navigation (screen time)</li>
  <li>Keyboard rhythm</li>
</ul>

<p><strong>What you can do:</strong></p>
<ul>
  <li>View per-site "internet portraits" that visualize your browsing as trail art</li>
  <li>Choose three privacy levels: off, local-only, or shared</li>
  <li>Configure exactly which data types are collected</li>
</ul>

<p><strong>See other people (still in development):</strong></p>
<ul>
  <li>On Wikipedia, see others on the same article, chat with them live, watch links grow patina, and follow other cursors down rabbit holes. <a href="https://www.instagram.com/p/DYpRnRAORbE/">See it in action</a>.</li>
</ul>

<p><strong>Data Collection Policies:</strong></p>
<ul>
  <li>You choose what is collected and where your data goes, on your device or shared for the purposes of the art project.</li>
</ul>
```
