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
we were online

we were online is an online multiplayer world—part game, artwork, and tool—that turns the existing Internet into a living, shared world, actively shaped by its inhabitants. Contribute your browsing data to a collective portrait of the Internet and create your own Internet self-portraits.

See it in action: https://www.instagram.com/p/DYpRnRAORbE/

See other people (still in development):
- On Wikipedia, see others on the same article, chat with them live, watch links grow patina, and follow other cursors down rabbit holes. See it in action: https://www.instagram.com/p/DYpRnRAORbE/
```

---

## Firefox AMO — full description

AMO supports a limited set of HTML tags, so the demo link can be clickable.
Paste into the "Description" field with HTML enabled.

```html
<p><strong>we were online</strong></p>

<p>we were online is an online multiplayer world—part game, artwork, and tool—that turns the existing Internet into a living, shared world, actively shaped by its inhabitants. Contribute your browsing data to a collective portrait of the Internet and create your own Internet self-portraits.</p>

<p>See it in action: <a href="https://www.instagram.com/p/DYpRnRAORbE/">demo on Instagram</a></p>

<p><strong>See other people (still in development):</strong></p>
<ul>
  <li>On Wikipedia, see others on the same article, chat with them live, watch links grow patina, and follow other cursors down rabbit holes. <a href="https://www.instagram.com/p/DYpRnRAORbE/">See it in action</a>.</li>
</ul>
```
