// ABOUTME: Styles for the public collage gallery: a dotted cream board, taped cards and grain catalog slips.
// ABOUTME: Layered over the studio's sheet and piece rules, which draw a collage that has no baked cover.

export const GALLERY_STYLES = `
  .collage-board {
    --b-ground: #faf7f2;
    --b-ink: #3d3833;
    --b-muted: #8a8279;
    --b-accent: #3a7d6f;
    --b-slip: #ece8e2;
    min-height: 100vh;
    overflow-x: hidden;
    background-color: var(--b-ground);
    background-image: radial-gradient(rgba(90, 78, 65, 0.07) 1px, transparent 1.2px);
    background-size: 6px 6px;
    color: var(--b-ink);
    font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
    line-height: 1.5;
  }

  .collage-board__nav {
    display: flex;
    justify-content: center;
    gap: 22px;
    padding: 18px 16px 0;
    font-size: 13px;
  }

  .collage-board__nav a {
    color: var(--b-muted);
    text-decoration: none;
  }

  .collage-board__nav a:hover,
  .collage-board__nav a[aria-current="page"] {
    color: var(--b-accent);
  }

  .collage-board__header {
    position: relative;
    max-width: 1000px;
    margin: 0 auto;
    padding: 64px 24px 40px;
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
    top: -16px;
    left: 50%;
    pointer-events: none;
    opacity: 0.88;
    mix-blend-mode: multiply;
  }

  /* A cut-out hyperlink, the kind of scrap the studio collects. */
  .collage-board__note {
    position: absolute;
    left: 24px;
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
    right: 30px;
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
    max-width: 1160px;
    margin: 0 auto;
    padding: 8px 24px 96px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 48px;
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
    width: 560px;
    max-width: 90vw;
    height: 46px;
    transform: translateX(-45%) skewX(-12deg);
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

  .collage-board__picker {
    position: relative;
    margin: 0 0 20px 18px;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-weight: 800;
    font-size: 22px;
    letter-spacing: -0.01em;
    white-space: nowrap;
    color: #ffffff;
  }

  .collage-board__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 72px 48px;
    align-items: start;
  }

  .collage-board__pin {
    position: relative;
    display: flex;
    flex-direction: column;
    color: inherit;
    text-decoration: none;
    transition: transform 160ms ease, filter 160ms ease;
  }

  .collage-board__pin:hover,
  .collage-board__pin:focus-visible {
    filter: drop-shadow(0 10px 14px rgba(40, 34, 28, 0.18));
    outline: none;
  }

  .collage-board__face {
    position: relative;
    width: 100%;
    overflow: hidden;
    background: #f5f0e8;
    box-shadow: 0 1px 3px rgba(90, 78, 65, 0.2);
  }

  .collage-board__cover {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .collage-board__small {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  .collage-board__sheet {
    position: absolute;
    left: 0;
    top: 0;
    overflow: hidden;
    transform-origin: 0 0;
    pointer-events: none;
  }

  .collage-board__slip {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 76%;
    margin: -18px 14px 0 auto;
    padding: 12px 14px 10px;
    box-sizing: border-box;
    background-color: var(--b-slip);
    background-image:
      radial-gradient(rgba(90, 78, 65, 0.09) 0.6px, transparent 0.9px),
      radial-gradient(rgba(90, 78, 65, 0.06) 0.6px, transparent 0.9px);
    background-size: 5px 5px, 7px 7px;
    background-position: 0 0, 2px 3px;
    box-shadow: 0 1px 3px rgba(90, 78, 65, 0.18);
  }

  .collage-board__title {
    font-family: "Lora", Georgia, serif;
    font-weight: 600;
    font-size: 17px;
    color: #2d2a27;
  }

  .collage-board__meta {
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(90, 78, 65, 0.25);
    font-family: "Martian Mono", ui-monospace, monospace;
    font-size: 10px;
    color: var(--b-muted);
  }

  .collage-board__sign {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding-top: 6px;
  }

  .collage-board__who {
    font-family: "Martian Mono", ui-monospace, monospace;
    font-size: 10.5px;
    color: var(--b-accent);
  }

  .collage-board__mark {
    font-family: "Source Serif 4", Georgia, serif;
    font-style: italic;
    font-size: 12px;
    color: var(--b-muted);
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
    .collage-board__header {
      padding: 40px 16px 24px;
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

    .collage-board__section {
      padding: 8px 16px 64px;
    }

    .collage-board__band {
      height: 92px;
    }

    .collage-board__favorites {
      font-size: 60px;
    }

    .collage-board__picker {
      margin: 0 0 10px 8px;
      font-size: 14px;
    }

    .collage-board__grid {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .collage-board__pin {
      transition: none;
    }
  }
`;
