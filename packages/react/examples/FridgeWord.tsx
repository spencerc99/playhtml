import { TagType } from "@playhtml/common";
import { withSharedState } from "@playhtml/react";
import "./FridgeWord.scss";

interface Props {
  id?: string;
  word: string;
  color?: string;
}

export const FridgeWord = withSharedState(
  {
    tagInfo: [TagType.CanMove],
  },
  ({}, props: Props) => {
    const { id, word, color } = props;
    return (
      <div
        id={id}
        selector-id="#fridge .fridgeWordHolder"
        className="fridgeWordHolder"
      >
        <div
          className={`fridgeWord`}
          style={{
            "--word-color": color,
          }}
        >
          {word}
        </div>
      </div>
    );
  }
);
