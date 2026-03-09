// ABOUTME: Interactive coffee machine + cortado for the essay marginalia.
// ABOUTME: Brew and drink actions dispatch play events so all visitors see animations.

import { useEffect, useState, useCallback, useContext, useRef } from "react";
import { PlayContext } from "@playhtml/react";
import styles from "./CoffeeMachine.module.scss";

type VisualState = "idle" | "brewing" | "ready" | "drinking";

interface CoffeeMachineProps {
  id: string;
}

const BREW_DURATION_MS = 2500;
const DRINK_DURATION_MS = 1200;

export function CoffeeMachine({ id }: CoffeeMachineProps) {
  const {
    hasSynced,
    dispatchPlayEvent,
    registerPlayEventListener,
    removePlayEventListener,
  } = useContext(PlayContext);

  const [visualState, setVisualState] = useState<VisualState>("idle");
  const [brewCount, setBrewCount] = useState(0);
  const [drinkCount, setDrinkCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Clean up any pending timeout on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Run the brew animation sequence locally
  const runBrewAnimation = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisualState("brewing");

    timerRef.current = setTimeout(() => {
      setVisualState("ready");
    }, BREW_DURATION_MS);
  }, []);

  // Run the drink animation sequence locally
  const runDrinkAnimation = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisualState("drinking");

    timerRef.current = setTimeout(() => {
      setVisualState("idle");
    }, DRINK_DURATION_MS);
  }, []);

  // Listen for brew and drink events from any client
  useEffect(() => {
    if (!hasSynced) return;

    const brewListenerId = registerPlayEventListener("wewere-coffee-brew", {
      onEvent: () => {
        setBrewCount((c) => c + 1);
        runBrewAnimation();
      },
    });

    const drinkListenerId = registerPlayEventListener("wewere-coffee-drink", {
      onEvent: () => {
        setDrinkCount((c) => c + 1);
        runDrinkAnimation();
      },
    });

    return () => {
      removePlayEventListener("wewere-coffee-brew", brewListenerId);
      removePlayEventListener("wewere-coffee-drink", drinkListenerId);
    };
  }, [
    hasSynced,
    registerPlayEventListener,
    removePlayEventListener,
    runBrewAnimation,
    runDrinkAnimation,
  ]);

  const handleClick = () => {
    if (visualState === "idle") {
      dispatchPlayEvent({
        type: "wewere-coffee-brew",
        eventPayload: {},
      });
    } else if (visualState === "ready") {
      dispatchPlayEvent({
        type: "wewere-coffee-drink",
        eventPayload: {},
      });
    }
  };

  const isClickable = visualState === "idle" || visualState === "ready";

  const label =
    visualState === "idle"
      ? "brew a cortado?"
      : visualState === "brewing"
      ? "brewing..."
      : visualState === "drinking"
      ? "sipping..."
      : "take a sip?";

  return (
    <div id={id} className={styles.coffee}>
      <div
        className={`${styles.scene} ${styles[visualState]}`}
        onClick={isClickable ? handleClick : undefined}
        role={isClickable ? "button" : undefined}
        tabIndex={isClickable ? 0 : undefined}
        onKeyDown={
          isClickable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") handleClick();
              }
            : undefined
        }
      >
        {/* Machine -- prominent when idle/brewing, background when ready/drinking */}
        <img
          src="/la-marzocco.png"
          alt="Espresso machine"
          className={`${styles.machineImg} ${
            visualState === "ready" || visualState === "drinking"
              ? styles.machineBackground
              : ""
          }`}
          draggable={false}
        />

        {/* Cup -- empty when idle/brewing, full cortado when ready/drinking */}
        <img
          src={
            visualState === "ready" || visualState === "drinking"
              ? "/cortado.png"
              : "/cortado-empty.png"
          }
          alt={
            visualState === "ready"
              ? "A cortado ready to drink"
              : "An empty cortado cup"
          }
          className={`${styles.cupImg} ${
            visualState === "ready" || visualState === "drinking"
              ? styles.cupReady
              : ""
          } ${visualState === "drinking" ? styles.cupDrinking : ""}`}
          draggable={false}
        />
      </div>
      <span className={styles.label}>
        {label}
        {(brewCount > 0 || drinkCount > 0) && (
          <span className={styles.stats}>
            {" "}
            ({brewCount} brewed, {drinkCount} sipped)
          </span>
        )}
      </span>
    </div>
  );
}
