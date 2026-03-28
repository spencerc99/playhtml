// ABOUTME: Interactive coffee machine + cortado for the essay marginalia.
// ABOUTME: Shared state tracks phase and counts; play events trigger animations across clients.

import { useEffect, useState, useCallback, useContext, useRef } from "react";
import { withSharedState, PlayContext } from "@playhtml/react";
import styles from "./CoffeeMachine.module.scss";

type Phase = "idle" | "ready";
type VisualState = "idle" | "brewing" | "ready" | "drinking";

interface CoffeeData {
  phase: Phase;
  brewCount: number;
  drinkCount: number;
}

interface CoffeeMachineProps {
  id: string;
}

const BREW_DURATION_MS = 2500;
const DRINK_DURATION_MS = 1200;

export const CoffeeMachine = withSharedState<CoffeeData, any, CoffeeMachineProps>(
  () => ({
    defaultData: { phase: "idle", brewCount: 0, drinkCount: 0 },
  }),
  ({ data, setData }, props) => {
    const {
      dispatchPlayEvent,
      registerPlayEventListener,
      removePlayEventListener,
    } = useContext(PlayContext);

    // Local animation state layered on top of the shared phase
    const [animating, setAnimating] = useState<"brewing" | "drinking" | null>(
      null,
    );
    const timerRef = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => {
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }, []);

    const runBrewAnimation = useCallback(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setAnimating("brewing");

      timerRef.current = setTimeout(() => {
        setAnimating(null);
      }, BREW_DURATION_MS);
    }, []);

    const runDrinkAnimation = useCallback(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setAnimating("drinking");

      timerRef.current = setTimeout(() => {
        setAnimating(null);
      }, DRINK_DURATION_MS);
    }, []);

    // Listen for animation-trigger events from any client
    useEffect(() => {
      const brewListenerId = registerPlayEventListener("wewere-coffee-brew", {
        onEvent: () => {
          runBrewAnimation();
        },
      });

      const drinkListenerId = registerPlayEventListener(
        "wewere-coffee-drink",
        {
          onEvent: () => {
            runDrinkAnimation();
          },
        },
      );

      return () => {
        removePlayEventListener("wewere-coffee-brew", brewListenerId);
        removePlayEventListener("wewere-coffee-drink", drinkListenerId);
      };
    }, [
      registerPlayEventListener,
      removePlayEventListener,
      runBrewAnimation,
      runDrinkAnimation,
    ]);

    const handleClick = () => {
      if (data.phase === "idle" && !animating) {
        setData((draft) => {
          draft.phase = "ready";
          draft.brewCount = (draft.brewCount ?? 0) + 1;
        });
        dispatchPlayEvent({
          type: "wewere-coffee-brew",
          eventPayload: {},
        });
      } else if (data.phase === "ready" && !animating) {
        setData((draft) => {
          draft.phase = "idle";
          draft.drinkCount = (draft.drinkCount ?? 0) + 1;
        });
        dispatchPlayEvent({
          type: "wewere-coffee-drink",
          eventPayload: {},
        });
      }
    };

    // Derive visual state: animation takes precedence, otherwise use shared phase
    const visualState: VisualState = animating ?? data.phase;
    const isClickable =
      (data.phase === "idle" || data.phase === "ready") && !animating;

    const label =
      visualState === "idle"
        ? "brew a cortado?"
        : visualState === "brewing"
          ? "brewing..."
          : visualState === "drinking"
            ? "sipping..."
            : "take a sip?";

    return (
      <div id={props.id} className={styles.coffee}>
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
          {(data.brewCount > 0 || data.drinkCount > 0) && (
            <span className={styles.stats}>
              {" "}
              ({data.brewCount} brewed, {data.drinkCount} sipped)
            </span>
          )}
        </span>
      </div>
    );
  },
);
