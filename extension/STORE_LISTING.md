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

A quiet portrait of your time on the internet — and the people quietly there with you.

we were online collects gentle traces of how you move, click, scroll, and type across the web, then renders them as living visualizations: cursor-trail portraits, typing rhythms, the shape of a day's browsing. It's a keepsake of your time online, made from the small motions you never think about.

It's also quietly social. When others with the extension are on the same page, you'll see their cursors drift alongside yours and a small count of who else is here. On Wikipedia, it goes further: a little chat panel lets you talk live with whoever else is reading the same article. Pick a random Wikipedia article as your name (reroll until one feels right), and wander the encyclopedia together. Messages are live-only — nothing is stored.

See it in action: https://www.instagram.com/p/DYpRnRAORbE/

WHAT IT CAPTURES
- Cursor movement, clicks, and holds
- Typing cadence and rhythm (text is abstracted by default — we capture the shape of typing, not what you wrote)
- Navigation: page transitions and screen time
- Scroll, resize, and zoom

YOUR DATA, YOUR CHOICE
Collection is local-first — your data stays on your device by default. During setup you choose, per collector, whether to keep things local or share them anonymously to contribute to collective visualizations. Keyboard text is abstracted by default, and personal info (emails, phone numbers) is always redacted. No account, no cross-site ad tracking, no selling data.

ON WIKIPEDIA
- See who else is reading the same article
- Chat live with them in a small panel (open it from the presence pill or press /)
- Your name is a random Wikipedia article — hover anyone's name for a preview
- Follow another reader's cursor as they wander
- Chat is ephemeral: messages live only while people are there

we were online is in open beta. It's a small, personal art project about noticing the internet as a place — somewhere we all were, together.
```

---

## Firefox AMO — full description

AMO supports a limited set of HTML tags, so the demo link can be clickable.
Paste into the "Description" field with HTML enabled.

```html
<p><strong>we were online</strong></p>

<p>A quiet portrait of your time on the internet — and the people quietly there with you.</p>

<p>we were online collects gentle traces of how you move, click, scroll, and type across the web, then renders them as living visualizations: cursor-trail portraits, typing rhythms, the shape of a day's browsing. It's a keepsake of your time online, made from the small motions you never think about.</p>

<p>It's also quietly social. When others with the extension are on the same page, you'll see their cursors drift alongside yours and a small count of who else is here. On Wikipedia, it goes further: a little chat panel lets you talk live with whoever else is reading the same article. Pick a random Wikipedia article as your name (reroll until one feels right), and wander the encyclopedia together. Messages are live-only — nothing is stored.</p>

<p>See it in action: <a href="https://www.instagram.com/p/DYpRnRAORbE/">demo on Instagram</a></p>

<p><strong>What it captures</strong></p>
<ul>
  <li>Cursor movement, clicks, and holds</li>
  <li>Typing cadence and rhythm (text is abstracted by default — we capture the shape of typing, not what you wrote)</li>
  <li>Navigation: page transitions and screen time</li>
  <li>Scroll, resize, and zoom</li>
</ul>

<p><strong>Your data, your choice</strong></p>
<p>Collection is local-first — your data stays on your device by default. During setup you choose, per collector, whether to keep things local or share them anonymously to contribute to collective visualizations. Keyboard text is abstracted by default, and personal info (emails, phone numbers) is always redacted. No account, no cross-site ad tracking, no selling data.</p>

<p><strong>On Wikipedia</strong></p>
<ul>
  <li>See who else is reading the same article</li>
  <li>Chat live with them in a small panel (open it from the presence pill or press /)</li>
  <li>Your name is a random Wikipedia article — hover anyone's name for a preview</li>
  <li>Follow another reader's cursor as they wander</li>
  <li>Chat is ephemeral: messages live only while people are there</li>
</ul>

<p>we were online is in open beta. It's a small, personal art project about noticing the internet as a place — somewhere we all were, together.</p>
```
