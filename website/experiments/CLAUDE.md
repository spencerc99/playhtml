# PlayHTML experiment workflow

Use this checklist when adding a public experiment under `website/experiments/`.
Every experiment is a static HTML entry discovered automatically by the
PlayHTML Vite build.

## Choose the route

Use the next experiment number. Numeric experiments live at
`website/experiments/<number>/`. A named route is appropriate when the name is
part of the experiment, such as `cinderblock`.

Update `ExperimentNumber` in `website/experiments/index.tsx`. Add an entry to
`Experiments` when the route is not the numeric default or the archive should
show a custom title.

## Create the page

Create `website/experiments/<route>/index.html` and the smallest set of source
files needed by the experiment. Every code file must begin with two `ABOUTME:`
comments.

The HTML entry must include:

- A unique, descriptive `<title>`.
- A concrete description of the experiment.
- The shared `/icon.png` favicon.
- A canonical URL.
- Open Graph and Twitter preview metadata.
- A module script that mounts the experiment.

Use this metadata structure:

```html
<meta
  name="description"
  content="One sentence that says what someone can do in this experiment."
/>
<link rel="canonical" href="https://playhtml.fun/experiments/<route>/" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="playhtml" />
<meta property="og:title" content="Experiment title" />
<meta
  property="og:description"
  content="One sentence that says what someone can do in this experiment."
/>
<meta property="og:url" content="https://playhtml.fun/experiments/<route>/" />
<meta
  property="og:image"
  content="https://playhtml.fun/experiments/index-previews/ex-<NN>.png"
/>
<meta name="twitter:card" content="summary_large_image" />
<meta
  name="twitter:image"
  content="https://playhtml.fun/experiments/index-previews/ex-<NN>.png"
/>
```

Use `property="og:image"`, not `name="og:image"`. Social crawlers read the
metadata from the static HTML before the application JavaScript runs.

## Capture the preview

Capture a finished, representative state at 1200 × 630 pixels. Store it at
`website/public/experiments/index-previews/ex-<NN>.png`, using a zero-padded
experiment number such as `ex-11.png`.

Set up a deterministic state before capturing. Do not capture production data,
live visitor activity, names, browsing history, messages, or other user-derived
content. A checked-in preview is permanent and may be displayed outside the
site without context.

For an interactive experiment, choose the state that best explains the
interaction. Do not use an empty initial screen when a stable fixture can show
the result.

## Register the metadata test

Add the route and zero-padded preview number to `experimentCards` in
`website/test/siteMetadata.test.ts`. The test checks that the HTML contains
crawler-readable metadata and that the referenced image exists.

## Verify the experiment

Run the experiment on its real route:

```sh
bun dev
```

Verify the initial state and the important interaction states in a browser.
Capture screenshots for the handoff and pull request.

Then run:

```sh
bun test website/test/siteMetadata.test.ts
bunx vite build website --config vite.config.site.mts
git diff --check
```

The production build must include both the experiment HTML and its preview
asset under `site-dist/`.

## Checklist

- [ ] Choose the next experiment number and route.
- [ ] Add two `ABOUTME:` comments to every code file.
- [ ] Add a title, description, canonical URL, Open Graph tags, and Twitter tags.
- [ ] Capture a deterministic 1200 × 630 preview without user-derived data.
- [ ] Save the preview as `ex-<NN>.png`.
- [ ] Update `ExperimentNumber` and any custom slug or title.
- [ ] Register the route in `siteMetadata.test.ts`.
- [ ] Verify the real route and its important interaction states in a browser.
- [ ] Run the metadata test, production build, and `git diff --check`.
- [ ] Include screenshots in the handoff and pull request.
