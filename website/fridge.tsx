import "./home.scss";
import { TagType } from "@playhtml/common";
import ReactDOM from "react-dom/client";
import { withPlay } from "../packages/react/src";
import React from "react";
import { PlayProvider } from "../packages/react/src";

interface Props {
  word: string;
}

const FridgeWord = withPlay<Props>()(
  {
    tagInfo: [TagType.CanMove],
  },
  ({ props }) => {
    const { word } = props;
    return (
      <div selector-id="#fridge .fridgeWordHolder" className="fridgeWordHolder">
        <div className="fridgeWord">{word}</div>
      </div>
    );
  }
);

const Words = [
  "lightning",
  "surrender",
  "dream",
  "love",
  "!",
  "who",
  "don't",
  "and",
  "you",
  "if",
  "world",
  "?",
  "s",
  "vanish",
  "tender",
  "with",
  "where",
  "few",
  "I",
  "question",
  "moon",
  "as",
  "ing",
  "moment",
  "its",
  "but",
  "is",
  "sometimes",
  "in",
  "every",
  "would",
  "could",
  "under",
  "around",
  "s",
  "the",
  "once",
  "surrounding",
  "free",
  "someone",
  "touch",
  "heart",
  "life",
  "living",
  "never",
  "always",
];

ReactDOM.createRoot(document.getElementById("fridge") as HTMLElement).render(
  <PlayProvider>
    {Words.map((w, i) => (
      <FridgeWord key={i} word={w} />
    ))}
  </PlayProvider>
);
