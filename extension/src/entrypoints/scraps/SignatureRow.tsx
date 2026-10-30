// ABOUTME: The share popover's "sign it" row: a switch, the stamp it will make, and a name field when there is none.
// ABOUTME: Signing works with the cursor colour alone; a typed name can also become the maker's name everywhere.

import type { SignerIdentity, SigningChoice } from "./collageSignature";
import { signatureFor } from "./collageSignature";
import { SignatureStamp } from "./SignatureStamp";

export interface SignatureRowProps {
  identity: SignerIdentity;
  choice: SigningChoice;
  onChoice: (choice: SigningChoice) => void;
  useEverywhere: boolean;
  onUseEverywhere: (value: boolean) => void;
  disabled?: boolean;
}

export function SignatureRow({
  identity,
  choice,
  onChoice,
  useEverywhere,
  onUseEverywhere,
  disabled = false,
}: SignatureRowProps) {
  const signature = signatureFor(identity, choice);
  const asksForName = choice.signing && identity.name === undefined;
  return (
    <div className="collage-sign" data-signing={choice.signing}>
      <div className="collage-sign__row">
        <button
          type="button"
          role="switch"
          aria-checked={choice.signing}
          className="collage-sign__switch"
          disabled={disabled}
          onClick={() => onChoice({ ...choice, signing: !choice.signing })}
        >
          <span className="collage-sign__knob" aria-hidden="true" />
          <span className="collage-sign__label">sign it</span>
        </button>
        {signature ? (
          <SignatureStamp signature={signature} />
        ) : (
          <span className="collage-studio__label">
            no stamp · shared anonymously
          </span>
        )}
      </div>
      {asksForName && (
        <>
          <label className="collage-sign__name">
            <span className="collage-studio__label">as</span>
            <input
              type="text"
              value={choice.name}
              placeholder="your name (optional)"
              maxLength={60}
              disabled={disabled}
              onChange={(event) =>
                onChoice({ ...choice, name: event.currentTarget.value })
              }
            />
          </label>
          <label className="collage-sign__everywhere">
            <input
              type="checkbox"
              checked={useEverywhere}
              disabled={disabled || choice.name.trim() === ""}
              onChange={(event) => onUseEverywhere(event.currentTarget.checked)}
            />
            also use it as my we were online name
          </label>
        </>
      )}
    </div>
  );
}

export const SIGNATURE_ROW_STYLES = `
  .collage-sign {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 0;
    border-top: 1px solid color-mix(in srgb, var(--c-ink) 12%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--c-ink) 12%, transparent);
  }

  .collage-sign__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 26px;
  }

  .collage-sign__switch {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--c-ink);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .collage-sign__knob {
    position: relative;
    width: 26px;
    height: 15px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--c-ink) 25%, transparent);
    transition: background 140ms ease;
  }

  .collage-sign__knob::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--c-surface);
    transition: transform 140ms ease;
  }

  .collage-sign__switch[aria-checked="true"] .collage-sign__knob {
    background: var(--c-ink);
  }

  .collage-sign__switch[aria-checked="true"] .collage-sign__knob::after {
    transform: translateX(11px);
  }

  .collage-sign__switch:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
  }

  .collage-sign__name {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .collage-sign__name input {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    padding: 4px 6px;
    border: 1px solid color-mix(in srgb, var(--c-ink) 22%, transparent);
    border-radius: 3px;
    background: transparent;
    color: var(--c-ink);
    font-family: "Martian Mono", monospace;
    font-size: 11px;
  }

  .collage-sign__everywhere {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--c-muted);
    font-size: 11px;
  }

  .collage-sign__everywhere:has(input:disabled) {
    opacity: 0.55;
  }

  .collage-share__signed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .collage-share__change {
    padding: 0;
    border: 0;
    background: none;
    color: var(--c-muted);
    font: inherit;
    font-size: 10px;
    text-decoration: underline;
    cursor: pointer;
  }
`;
