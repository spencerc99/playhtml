# Store listing copy

Canonical source for the long marketing description shown on the Chrome Web
Store and Firefox AMO listings. These fields are edited directly in each
store's developer dashboard (the `wxt submit` flow only uploads the build +
manifest, not this copy), so this file is the version-controlled record —
edit here, then paste into the dashboards.

The short manifest description (≤132 chars, shown in search results) lives in
`wxt.config.ts`, not here.

---

## Chrome Web Store and Apple App Store — full description

Both stores render this field as plain text. Paste exactly as-is.

```
Turn your browsing history into a living portrait.

we were online is part artwork, game, and browsing-history tool. As you move through the web, it remembers the traces you choose to keep: cursor trails, clicks, scrolls, keyboard rhythm, pages visited, and time spent. Those traces become a visual record of your online life.

REVIEW YOUR BROWSING

Open History from every new tab or the extension popup to see:
- time by site
- active explorations and smaller places you returned to
- a cursor portrait from each day
- a moving landscape of your real browsing traces
- up to a year of your walking record across the web

SEE YOUR TRAIL ANYWHERE

Open your portrait from the browser toolbar. On any page, bring up a historical overlay to revisit the cursor trails, clicks, and scrolls you left there.

WIKIPEDIA FEELS INHABITED

On Wikipedia, live cursors, article chat, remembered links, and shared trails turn reading into a place where you can cross paths with other visitors.

YOU STAY IN CONTROL

Choose what is collected and where it goes. Each collection category can be off, stored only on your device, or shared anonymously for the collective artwork. Emails, phone numbers, and Social Security numbers are always redacted from keyboard data.
```

### Apple App Store fields

Promotional text:

```
See where your time went, revisit the smaller places you explored, and turn a year of browsing into a living portrait.
```

Keywords:

```
browser history,screen time,cursor trails,internet art,privacy,wikipedia,safari extension
```

- Support URL: `https://wewere.online/`
- Marketing URL: `https://wewere.online/`

---

## Firefox AMO — full description

AMO supports a limited set of HTML tags, so the demo link can be clickable.
Paste into the "Description" field with HTML enabled.

```html
<p>Turn your browsing history into a living portrait.</p>

<p>we were online is part artwork, game, and browsing-history tool. As you move through the web, it remembers the traces you choose to keep: cursor trails, clicks, scrolls, keyboard rhythm, pages visited, and time spent. Those traces become a visual record of your online life.</p>

<p><strong>Review your browsing</strong></p>

<ul>
  <li>See time by site.</li>
  <li>Return to active explorations and smaller places you visited.</li>
  <li>See a cursor portrait from each day.</li>
  <li>Move through a landscape of your real browsing traces.</li>
  <li>Browse up to a year of your walking record across the web.</li>
</ul>

<p><strong>See your trail anywhere</strong></p>

<p>Open your portrait from the browser toolbar. On any page, bring up a historical overlay to revisit the cursor trails, clicks, and scrolls you left there.</p>

<p><strong>Wikipedia feels inhabited</strong></p>

<p>On Wikipedia, live cursors, article chat, remembered links, and shared trails turn reading into a place where you can cross paths with other visitors.</p>

<p><strong>You stay in control</strong></p>

<p>Choose what is collected and where it goes. Each collection category can be off, stored only on your device, or shared anonymously for the collective artwork. Emails, phone numbers, and Social Security numbers are always redacted from keyboard data.</p>
```
