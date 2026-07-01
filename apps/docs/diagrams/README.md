# Diagram sources

HTML sources for the static diagrams used in the docs. Each renders to a PNG that
lives in `../public/` and is referenced from the docs content (e.g. `concepts.md`).

These files are kept out of `public/` so they aren't served, but tracked so the PNGs
can be regenerated.

## Files

- `how-playhtml-works-overview.html` → `../public/how-playhtml-works-overview.png`
  The "core concepts" overview: one page with the four kinds of shared state
  (element data, page data, presence, events) called out.
- `how-playhtml-works.html` → `../public/how-playhtml-works.png`
  The element-data detail: two pages with the same elements, synced by id.

## Regenerating a PNG

The sources load element art (lamp, hat, wheel, balloon) via root-absolute paths
like `/noguchi-hanging-lamp.png`, which only resolve when served from `public/`.
To regenerate:

1. Copy the source into `public/` temporarily (or serve `diagrams/` with the images
   alongside), then serve `public/` over http:
   ```sh
   cp diagrams/how-playhtml-works-overview.html public/_tmp.html
   (cd public && python3 -m http.server 8765)
   ```
2. Screenshot the `#capture` element at 2x device scale (e.g. with Playwright) to the
   target path in `public/`, then remove the temp copy.

The `#capture` div is the framed content; everything outside it is page chrome.
