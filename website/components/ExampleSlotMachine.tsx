// ABOUTME: Slot machine component for cycling through playhtml examples
// ABOUTME: Uses deterministic daily shuffle to ensure all examples are seen
import { useState, useEffect } from "react";
import "./ExampleSlotMachine.scss";

interface Example {
  title: string;
  description: string;
  url: string;
}

const examples: Example[] = [
  {
    title: "fridge poetry",
    description: "Create poetry with strangers together in real-time",
    url: "/fridge.html",
  },
  {
    title: "every color [playhtml experiment 04]",
    description: "A website with every color added by someone",
    url: "/experiments/4/",
  },
  {
    title: "one color [playhtml experiment 01]",
    description: "A website with a single color set by someone",
    url: "/experiments/one/",
  },
  {
    title: "cursor party [playhtml experiment 02]",
    description: "See everyone's cursors dancing together",
    url: "/experiments/two/",
  },
  {
    title: "minute faces (together) [playhtml experiment 05]",
    description: "Every minute of the day colored by someone at that minute",
    url: "/experiments/5/",
  },
  // {
  //   title: "grid paper typing [playhtml experiment 08]",
  //   description: "Collaborative grid paper where everyone types letters together",
  //   url: "/experiments/8/",
  // },
];

// Seeded random number generator for deterministic shuffling
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

// Shuffle array deterministically based on seed
function shuffleWithSeed<T>(array: T[], seed: number): T[] {
  const arr = [...array];
  const random = seededRandom(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function ExampleSlotMachine() {
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isSpinning, setIsSpinning] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [shuffledExamples, setShuffledExamples] = useState<Example[]>([]);

  useEffect(() => {
    // Use a daily seed that changes each day
    const today = new Date();
    const dayOfYear = Math.floor(
      (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) /
        (1000 * 60 * 60 * 24)
    );

    // Shuffle examples with daily seed so order is consistent per day
    const shuffled = shuffleWithSeed(examples, dayOfYear);
    setShuffledExamples(shuffled);

    // Load first example
    setCurrentIndex(0);
  }, []);

  const spinRoulette = () => {
    setIsSpinning(true);

    setTimeout(() => {
      // Cycle through examples in order
      setCurrentIndex((prev) => (prev + 1) % shuffledExamples.length);
      setIsSpinning(false);
    }, 600);
  };

  const handlePull = () => {
    setIsPulling(true);
    setTimeout(() => {
      setIsPulling(false);
    }, 300);
    spinRoulette();
  };

  const currentExample =
    currentIndex >= 0 && shuffledExamples[currentIndex]
      ? shuffledExamples[currentIndex]
      : null;

  return (
    <div className="example-roulette">
      <div
        id="exampleSlot"
        className={`example-slot ${isSpinning ? "spinning" : ""}`}
      >
        <h2>games & examples</h2>
        <img
          id="slotHandle"
          src="/slot-machine-handle.png"
          className={`slot-handle ${isPulling ? "pulling" : ""}`}
          onClick={handlePull}
          alt="Pull the lever!"
          title="Pull the lever to spin!"
        />
        <div className="browser-window">
          <div className="browser-chrome">
            <div className="browser-dots">
              <span className="dot red"></span>
              <span className="dot yellow"></span>
              <span className="dot green"></span>
            </div>
            <div className="browser-url">
              {currentExample && (
                <a href={currentExample.url} target="_blank" rel="noreferrer">
                  <span>{currentExample.title}</span>
                </a>
              )}
            </div>
          </div>
          {currentExample && (
            <iframe
              id="exampleFrame"
              className="example-frame"
              src={currentExample.url}
              sandbox="allow-scripts allow-same-origin"
            />
          )}
        </div>
        <div className="example-info">
          {currentExample && <p>{currentExample.description}</p>}
          <p>
            or view everything on the{" "}
            <a href="https://www.are.na/spencer-chang/playhtml-sites">
              community example gallery
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
