// ABOUTME: Styles for the shared collage page around the scraps studio it embeds.
// ABOUTME: The studio brings its own look; this places it and adds the invite bar, title and name prompt.

export const TOGETHER_STYLES = `
  .together {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: #f6f5f1;
  }

  .together-bar {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  /* The "shared" tag is also the invite button: it copies the link. */
  .together-share {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px 3px 7px;
    border: 1px solid #9fcabf;
    border-radius: 999px;
    background: #fdfcfa;
    color: #2f6b60;
    font-family: "Martian Mono", monospace;
    font-size: 10px;
    white-space: nowrap;
    cursor: pointer;
  }

  .together-share:hover,
  .together-share:focus-visible {
    border-color: #4a9a8a;
    background: #eef6f3;
  }

  .together-share__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4a9a8a;
  }

  .together-with {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  /* Each person's name on a wash of their cursor color; a dot marks who is
     here right now. */
  .together-person {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 12ch;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--person) 24%, #fdfcfa);
    color: #3a3734;
    font-family: "Martian Mono", monospace;
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.7;
  }

  .together-person--here {
    opacity: 1;
  }

  .together-person--here::before {
    content: "";
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--person);
  }

  .together-join {
    border-color: #4a9a8a;
    color: #2f6b60;
  }

  /* The mat's edge in the accent, so the whole collage reads as shared. */
  .together .collage-studio:not(.collage-studio--sheet) .collage-mat {
    box-shadow:
      0 1px 0 color-mix(in srgb, #fff 70%, transparent) inset,
      0 0 0 1px #9fcabf,
      0 10px 24px color-mix(in srgb, #3a3734 8%, transparent);
  }

  .together-caption {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
  }

  .together-title {
    min-width: 0;
    flex: 0 1 300px;
    padding: 0 0 2px;
    border: 0;
    border-bottom: 1px dotted #86807a;
    background: transparent;
    color: #3a3734;
    font-family: "Lora", Georgia, serif;
    font-size: 15px;
    font-weight: 600;
  }

  .together-title::placeholder {
    color: #86807a;
    font-weight: 400;
  }

  .together-title:focus {
    outline: none;
    border-bottom-color: #4a9a8a;
  }

  .together-empty {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 26px;
    color: #86807a;
    pointer-events: none;
    text-align: center;
  }

  .together-name {
    position: fixed;
    left: 50%;
    top: 40%;
    transform: translate(-50%, -50%);
    z-index: 100000;
    width: min(340px, calc(100vw - 32px));
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border: 1px solid #dcd8cf;
    border-radius: 4px;
    background: #fdfcfa;
    box-shadow: 0 10px 30px rgba(40, 36, 30, 0.16);
    font-family: "Martian Mono", monospace;
    font-size: 11px;
    color: #3a3734;
  }

  .together-name label {
    font-size: 12px;
  }

  .together-name p {
    margin: 0;
    color: #86807a;
    font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.5;
  }

  .together-name input {
    padding: 7px 9px;
    border: 1px solid #dcd8cf;
    border-radius: 3px;
    background: #f6f5f1;
    color: #3a3734;
    font-family: "Lora", Georgia, serif;
    font-size: 15px;
  }

  .together-name input:focus {
    outline: 2px solid rgba(74, 154, 138, 0.45);
    outline-offset: 1px;
  }

  .together-name__actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    align-items: center;
  }

  .together-name__skip {
    border: 0;
    background: none;
    padding: 0;
    color: #86807a;
    font: inherit;
    cursor: pointer;
  }

  .together-name__skip:hover {
    color: #3a3734;
    text-decoration: underline;
  }
`;
