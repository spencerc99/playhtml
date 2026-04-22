import React from "react";
import { CanPlayElement } from "@playhtml/react";
import { TagType, TagTypeToElement, CanDuplicateTo } from "@playhtml/common";
import { playhtml } from "playhtml";

const TEMPLATE_ID = "ph-cap-bunny-template";
const CLONE_BTN_ID = "ph-cap-bunny-clone";
const MEADOW_ID = "ph-bunny-meadow";

export function DuplicateRabbitDemo(): React.ReactElement {
  const bunnySrc = "/docs/pixel-bunny.png";

  const resetBurrow = () => {
    document
      .querySelectorAll(`[id^="${TEMPLATE_ID}-"]`)
      .forEach((n) => n.remove());
    playhtml.deleteElementData("can-duplicate", CLONE_BTN_ID);
    const btn = document.getElementById(CLONE_BTN_ID);
    if (btn) playhtml.setupPlayElement(btn);
  };

  return (
    <div className="ph-dup-rabbit">

      <div id={MEADOW_ID} className="ph-dup-meadow" aria-label="Bunny field">
        <div id={TEMPLATE_ID} className="ph-bunny-cell">
          <span className="ph-bunny-sprite" aria-hidden="true">
            <img src={bunnySrc} alt="" className="ph-dup-rabbit__img" draggable={false} />
          </span>
        </div>
      </div>
      <div className="ph-dup-rabbit__actions">
        <CanPlayElement
          standalone
          tagInfo={{ [TagType.CanDuplicate]: TEMPLATE_ID }}
          {...TagTypeToElement[TagType.CanDuplicate]}
          id={CLONE_BTN_ID}
          {...{ [CanDuplicateTo]: MEADOW_ID }}
        >
          {() => (
            <button type="button" id={CLONE_BTN_ID} className="ph-dup-rabbit__clone">
              Clone bunny
            </button>
          )}
        </CanPlayElement>
        <button
          type="button"
          className="ph-dup-rabbit__reset"
          onClick={resetBurrow}
        >
          Clear burrow
        </button>
      </div>
    </div>
  );
}
