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
    align-items: center;
    gap: 10px;
  }

  .together-here {
    display: inline-flex;
    align-items: center;
  }

  .together-face {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid #f6f5f1;
    margin-left: -5px;
  }

  .together-face:first-child {
    margin-left: 0;
  }

  .together-here .collage-studio__label {
    margin-left: 6px;
  }

  .together-invite {
    border-color: #4a9a8a;
    color: #2f6b60;
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
