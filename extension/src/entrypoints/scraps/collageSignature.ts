// ABOUTME: How a shared collage gets signed: the maker's cursor colour, and a name when they give one.
// ABOUTME: Holds the signer the host provides, the stamp a choice makes, and the remembered "don't sign".

import type { PublishedSignature } from "../../../shared/publishedCollage";
import { PUBLISHED_COLLAGE_LIMITS } from "../../../shared/publishedCollage";
import { cssColorToHex } from "../../utils/color";

/** The maker as the extension knows them. */
export interface SignerIdentity {
  /** Their cursor colour, as hex. */
  color: string;
  name?: string;
}

/**
 * Where signing reads the maker from, given by the studio's host: only the
 * extension knows who is sharing.
 */
export interface CollageSigner {
  load: () => Promise<SignerIdentity | null>;
  /** Makes a name typed while sharing the maker's name everywhere. */
  saveName: (name: string) => Promise<void>;
}

export interface SigningChoice {
  signing: boolean;
  /** The name typed while sharing, when the maker has none of their own yet. */
  name: string;
}

/** The maker from a stored identity, or null when it has no usable colour. */
export function signerIdentity(
  identity: {
    name?: string;
    playerStyle: { colorPalette: string[] };
  } | null,
): SignerIdentity | null {
  const color = cssColorToHex(identity?.playerStyle.colorPalette[0] ?? "");
  if (!identity || !color) return null;
  // A name saved before signing existed may hold characters a signature
  // refuses, so it gets the same cleaning as a typed one.
  const name = signatureName(identity.name ?? "");
  return name ? { color, name } : { color };
}

/** Trims a typed name to what a signature can carry. */
export function signatureName(text: string): string {
  const name = text
    .replace(/(?![\u200C\u200D])[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .slice(0, PUBLISHED_COLLAGE_LIMITS.maxSignatureNameLength)
    .trim();
  // Joiners alone would make an invisible name tag.
  return name.replace(/[\u200C\u200D]/g, "").trim() ? name : "";
}

/**
 * The stamp a choice makes. The maker's own name wins; without one, a typed
 * name signs; with neither, the colour alone does.
 */
export function signatureFor(
  identity: SignerIdentity | null,
  choice: SigningChoice,
): PublishedSignature | undefined {
  if (!identity || !choice.signing) return undefined;
  const name = identity.name ?? signatureName(choice.name);
  return name ? { color: identity.color, name } : { color: identity.color };
}

const SIGNING_OFF_KEY = "wwo-collage-signing-off";

/** Whether the maker turned signing off last time; signing is on otherwise. */
export function signingWasTurnedOff(): boolean {
  try {
    return window.localStorage.getItem(SIGNING_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberSigning(signing: boolean): void {
  try {
    if (signing) window.localStorage.removeItem(SIGNING_OFF_KEY);
    else window.localStorage.setItem(SIGNING_OFF_KEY, "1");
  } catch {
    // Without storage the next share simply starts signed again.
  }
}
