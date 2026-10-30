// ABOUTME: Styles for the public collage gallery: the studio's grained ground, the site's nav, framed covers, washed detail cards.
// ABOUTME: Each frame copies the studio's mat; each card's wash comes from blurred blots of its collage's colours.

export const GALLERY_STYLES = `
  .collage-board {
    --b-ground: #f6f5f1;
    --b-ink: #3d3833;
    --b-muted: #8a8279;
    --b-accent: #4a9a8a;
    /* The studio's mat palette, so a framed collage reads as it does in the editor. */
    --c-mat: #e6e3dc;
    --c-ink: #3a3734;
    --c-muted: #86807a;
    --c-rule: #dcd8cf;
    min-height: 100vh;
    box-sizing: border-box;
    overflow-x: hidden;
    padding: 28px 20px 96px;
    /* The collage studio's ground, with its paper grain multiplied over it. */
    background-color: var(--b-ground);
    background-size: 240px 240px;
    background-blend-mode: multiply;
    color: var(--b-ink);
    font-family: "Atkinson Hyperlegible", -apple-system, BlinkMacSystemFont, sans-serif;
    line-height: 1.5;
  }

  .collage-board__nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    max-width: 1120px;
    margin: 0 auto;
    font-size: 13px;
    color: var(--b-muted);
  }

  .collage-board__wordmark {
    font-family: "Source Serif 4", "Lora", Georgia, serif;
    font-style: italic;
    font-weight: 200;
    font-size: 18px;
    color: var(--b-ink);
    text-decoration: none;
  }

  .collage-board__links {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 16px;
  }

  .collage-board__links a {
    position: relative;
    color: var(--b-muted);
    text-decoration: none;
    transition: color 0.15s;
  }

  .collage-board__links a:hover {
    color: var(--b-accent);
  }

  .collage-board__links a[aria-current="page"] {
    color: var(--b-ink);
  }

  .collage-board__links a[aria-current="page"]::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -4px;
    height: 1px;
    background: rgba(74, 154, 138, 0.7);
  }

  .collage-board__header {
    position: relative;
    max-width: 1000px;
    margin: 0 auto;
    padding: 64px 0 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
  }

  .collage-board__heading {
    margin: 0;
    font-family: "Source Serif 4", Georgia, serif;
    font-style: italic;
    font-weight: 200;
    font-size: 64px;
    letter-spacing: -0.01em;
    line-height: 1;
  }

  .collage-board__lede {
    margin: 0;
    font-size: 14px;
    color: var(--b-muted);
    letter-spacing: 0.08em;
  }

  .collage-board__tape {
    position: absolute;
    z-index: 2;
    pointer-events: none;
    opacity: 0.88;
    mix-blend-mode: multiply;
  }

  /* A cut-out hyperlink, the kind of scrap the studio collects. */
  .collage-board__note {
    position: absolute;
    left: 0;
    top: 70px;
    width: 196px;
    padding: 8px 10px;
    background: #ffffff;
    text-align: left;
    transform: rotate(-3deg);
  }

  .collage-board__note span {
    font-family: "Times New Roman", Times, serif;
    font-size: 16px;
    line-height: 1.3;
    color: #1a0dab;
    text-decoration: underline;
  }

  /* A cut-out grey system button. */
  .collage-board__cta {
    position: absolute;
    right: 6px;
    top: 96px;
    transform: rotate(2.4deg);
  }

  .collage-board__cta a {
    display: inline-block;
    padding: 6px 14px;
    background: #d4d0c8;
    border: 2px solid;
    border-color: #ffffff #404040 #404040 #ffffff;
    box-shadow: 1px 1px 0 #000000;
    color: #000000;
    font-family: Tahoma, Verdana, sans-serif;
    font-size: 13px;
    text-decoration: none;
  }

  .collage-board__cta a:active {
    border-color: #404040 #ffffff #ffffff #404040;
  }

  .collage-board__section {
    max-width: 1120px;
    margin: 0 auto;
    padding-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .collage-board__band {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    height: 120px;
  }

  .collage-board__streak {
    position: absolute;
    left: 50%;
    bottom: 14px;
    width: 460px;
    max-width: 90vw;
    height: 46px;
    transform: translateX(-50%) skewX(-12deg);
    background: linear-gradient(90deg, rgba(255, 106, 19, 0) 0%, #ff6a13 12%, #ff8a1f 48%, #ff6a13 80%, rgba(255, 106, 19, 0) 100%);
    filter: blur(3px);
  }

  .collage-board__favorites {
    position: relative;
    margin: 0;
    font-family: "Source Serif 4", Georgia, serif;
    font-weight: 400;
    font-size: 104px;
    letter-spacing: -0.03em;
    line-height: 0.9;
    color: #161616;
  }

  /* A row of found "Share" buttons, fading out, as if cut from page after page. */
  .collage-board__shares {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 36px;
  }

  .collage-board__share {
    padding: 3px 12px;
    border-radius: 999px;
    background: #1f4bff;
    color: #ffffff;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 12px;
    font-weight: 600;
  }

  .collage-board__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 64px 48px;
    align-items: start;
  }

  .collage-board__pin {
    position: relative;
    display: flex;
    flex-direction: column;
    color: inherit;
    text-decoration: none;
  }

  .collage-board__mat {
    position: relative;
    padding: 14px 14px 0;
    background: var(--c-mat);
    box-shadow:
      0 1px 0 color-mix(in srgb, #fff 70%, transparent) inset,
      0 0 0 1px var(--c-rule),
      0 10px 24px color-mix(in srgb, var(--c-ink) 8%, transparent);
    transition: transform 160ms ease, box-shadow 160ms ease;
  }

  .collage-board__pin:hover .collage-board__mat,
  .collage-board__pin:focus-visible .collage-board__mat {
    transform: translateY(-3px);
    box-shadow:
      0 1px 0 color-mix(in srgb, #fff 70%, transparent) inset,
      0 0 0 1px var(--c-rule),
      0 16px 30px color-mix(in srgb, var(--c-ink) 14%, transparent);
  }

  .collage-board__pin:focus-visible {
    outline: none;
  }

  .collage-board__window {
    position: relative;
    overflow: hidden;
    background: #fdfcfa;
    box-shadow:
      inset 1px 1px 0 color-mix(in srgb, var(--c-ink) 14%, transparent),
      0 0 0 1px color-mix(in srgb, #fff 80%, transparent);
  }

  .collage-board__cover {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .collage-board__caption {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-height: 40px;
    padding: 8px 0;
    box-sizing: border-box;
  }

  .collage-board__title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--c-ink);
    font-family: "Lora", Georgia, serif;
    font-weight: 600;
    font-size: 15px;
  }

  .collage-board__meta {
    flex: 1 0 100%;
    order: 3;
    padding-top: 6px;
    border-top: 1px solid rgba(45, 42, 39, 0.18);
    color: #4d4741;
    font-family: "Martian Mono", ui-monospace, monospace;
    font-size: 9.5px;
    letter-spacing: 0.02em;
  }

  /* The detail card under each frame, its own collage's colours bleeding into the paper. */
  .collage-board__card {
    position: relative;
    z-index: 1;
    isolation: isolate;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    width: 88%;
    margin: -6px 10px 0 auto;
    padding: 16px 18px 14px;
    box-sizing: border-box;
    background-color: #fbf8f3;
    box-shadow: 0 1px 3px rgba(90, 78, 65, 0.18);
  }

  /* Grain over the wash, so the colour reads as soaked into paper. */
  .collage-board__card::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background-image:
      radial-gradient(rgba(60, 50, 40, 0.13) 0.6px, transparent 0.9px),
      radial-gradient(rgba(60, 50, 40, 0.09) 0.6px, transparent 0.9px);
    background-size: 5px 5px, 7px 7px;
    background-position: 0 0, 2px 3px;
    mix-blend-mode: multiply;
  }

  .collage-board__blot {
    position: absolute;
    z-index: -2;
    pointer-events: none;
    transition: opacity 400ms ease;
  }

  /* The maker's name, set in a tag of their cursor colour. */
  .collage-board__name {
    padding: 1px 8px;
    border-radius: 3px;
    color: #2d2a27;
    font-family: "Martian Mono", ui-monospace, monospace;
    font-size: 12px;
    font-weight: 700;
  }

  .collage-board__meta {
    color: #3f3a35;
    font-family: "Martian Mono", ui-monospace, monospace;
    font-size: 10px;
    letter-spacing: 0.02em;
  }

  .collage-board__status {
    margin: 0;
    text-align: center;
    font-family: "Martian Mono", ui-monospace, monospace;
    font-size: 12px;
    color: var(--b-muted);
  }

  /* The cut-out scraps crowd the title on narrow screens; they sit under it instead. */
  @media (max-width: 760px) {
    .collage-board {
      padding: 20px 16px 64px;
    }

    .collage-board__header {
      padding: 40px 0 24px;
    }

    .collage-board__heading {
      font-size: 52px;
    }

    .collage-board__note,
    .collage-board__cta {
      position: relative;
      left: auto;
      right: auto;
      top: auto;
      margin-top: 18px;
    }

    .collage-board__band {
      height: 92px;
    }

    .collage-board__favorites {
      font-size: 68px;
    }

    .collage-board__grid {
      grid-template-columns: 1fr;
    }

    .collage-board__mat {
      padding: 10px 10px 0;
    }

    .collage-board__card {
      width: 92%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .collage-board__mat {
      transition: none;
    }
  }
`;
