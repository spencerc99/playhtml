// ABOUTME: A collage's signature as a stamp: a tag with the maker's name in their cursor colour, or a colour seal.
// ABOUTME: The studio previews it while sharing; the viewer sets it at the end of the mat's caption.

import type { PublishedSignature } from "../../../shared/publishedCollage";

/** Dark ink on light cursor colours, white on dark ones. */
function inkOn(color: string): string {
  const value = Number.parseInt(color.slice(1), 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return luminance > 0.36 ? "#2d2a27" : "#ffffff";
}

export function SignatureStamp({
  signature,
  className = "",
}: {
  signature: PublishedSignature;
  className?: string;
}) {
  if (signature.name) {
    return (
      <span
        className={`signature-stamp signature-stamp--tag ${className}`}
        style={{ background: signature.color, color: inkOn(signature.color) }}
      >
        {signature.name}
      </span>
    );
  }
  return (
    <span
      className={`signature-stamp signature-stamp--seal ${className}`}
      style={{ background: signature.color }}
      role="img"
      aria-label="a cursor colour seal"
    />
  );
}

export const SIGNATURE_STAMP_STYLES = `
  .signature-stamp {
    display: inline-block;
    flex: 0 0 auto;
    transform: rotate(-3deg);
  }

  .signature-stamp--tag {
    max-width: 14em;
    overflow: hidden;
    padding: 1px 8px;
    border-radius: 3px;
    font-family: "Martian Mono", ui-monospace, monospace;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.5;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .signature-stamp--seal {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.55);
  }
`;
