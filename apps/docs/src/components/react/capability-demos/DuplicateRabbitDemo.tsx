// Docs live demo for can-duplicate: each click clones the bunny into the meadow.
//
// Uses CanPlayElement directly because CanDuplicateElement has no `standalone`
// option, and the docs site never renders <PlayProvider>.
import React from "react";
import { CanPlayElement } from "@playhtml/react";
import { CanDuplicateTo, TagType, TagTypeToElement, playhtml } from "playhtml";

const TEMPLATE_ID = "ph-cap-bunny-template";
const CLONE_BUTTON_ID = "ph-cap-bunny-clone";
const MEADOW_ID = "ph-bunny-meadow";

// can-duplicate stores the clone ids on the button, and clones get ids of the
// form `${TEMPLATE_ID}-<random>`. Clear both, then re-register the button.
function clearMeadow(): void {
  document
    .querySelectorAll(`[id^="${TEMPLATE_ID}-"]`)
    .forEach((clone) => clone.remove());
  playhtml.deleteElementData("can-duplicate", CLONE_BUTTON_ID);
  const button = document.getElementById(CLONE_BUTTON_ID);
  if (button) playhtml.setupPlayElement(button);
}

export function DuplicateRabbitDemo(): React.ReactElement {
  return (
    <div className="ph-dup-rabbit">
      <div id={MEADOW_ID} className="ph-dup-meadow" aria-label="Bunny field">
        <div id={TEMPLATE_ID} className="ph-bunny-cell">
          <span className="ph-bunny-sprite" aria-hidden="true">
            <img
              src="/docs/pixel-bunny.png"
              alt=""
              className="ph-dup-rabbit__img"
              draggable={false}
            />
          </span>
        </div>
      </div>
      <div className="ph-dup-rabbit__actions">
        <CanPlayElement
          standalone
          {...TagTypeToElement[TagType.CanDuplicate]}
          tagInfo={{ [TagType.CanDuplicate]: TEMPLATE_ID }}
          {...{ [CanDuplicateTo]: MEADOW_ID }}
          id={CLONE_BUTTON_ID}
        >
          {() => (
            <button
              type="button"
              id={CLONE_BUTTON_ID}
              className="ph-dup-rabbit__clone"
            >
              Clone bunny
            </button>
          )}
        </CanPlayElement>
        <button
          type="button"
          className="ph-dup-rabbit__reset"
          onClick={clearMeadow}
        >
          Clear burrow
        </button>
      </div>
    </div>
  );
}
