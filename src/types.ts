import { GrowElement, MoveElement, SpinElement } from "./elements";

export type Position = { x: number; y: number };

export interface TagTypeToElement {
  [TagType.CanMove]: MoveElement;
  [TagType.CanSpin]: SpinElement;
  [TagType.CanGrow]: GrowElement;
}

// Supported Tags
export enum TagType {
  "CanMove" = "can-move",
  "CanSpin" = "can-spin",
  "CanGrow" = "can-grow",
  // "CanDraw" = "can-draw",
  // "CanDrive" = "can-drive",
  // "CanHighlight" = "can-highlight",
  // "CanStamp" = "can-stamp",

  // "CanFall" = "can-fall", See https://mrdoob.com/projects/chromeexperiments/google-space/
  // "CanAge" = "can-age",
  // "CanFingerprint" = "can-fingerprint",
  // "CanTake" = "can-take",
  // "CanPlace" = "can-place",
  // "CanBreak" = "can-break",
  // "CanUse" = "can-use",
  // A BUNCH FROM Copilot completions
  // "CanOpen" = "can-open",
  // "CanClose" = "can-close",
  // "CanChat" = "can-chat",
  // "CanRead" = "can-read",
  // "CanWrite" = "can-write",
  // "CanEat" = "can-eat",
  // "CanDrink" = "can-drink",
  // "CanWear" = "can-wear",
  // "CanWield" = "can-wield",
  // "CanTalk" = "can-talk",
  // "CanListen" = "can-listen",
  // "CanLook" = "can-look",
  // "CanSmell" = "can-smell",
  // "CanTaste" = "can-taste",
  // "CanFeel" = "can-feel",
  // "CanThink" = "can-think",
  // "CanSleep" = "can-sleep",
  // "CanWake" = "can-wake",
  // "CanBreathe" = "can-breathe",
}
