import "./drunk-cursor.scss";
import React, {
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import ReactDOM from "react-dom/client";
import {
  PlayContext,
  PlayProvider,
  usePlayContext,
  withSharedState,
} from "@playhtml/react";
import { playhtml } from "playhtml";

interface CursorPresence {
  cursor: { x: number; y: number } | null;
  playerIdentity: {
    playerStyle: { colorPalette: string[] };
    name?: string;
  };
  lastSeen: number;
}

const CURSOR_AWARENESS_FIELD = "__playhtml_cursors__";

const DRINK_COUNT = 4;
const WATER_SPAWN_CHANCE = 0.1;
type DrinkType = "beer" | "water";
type DrinkState =
  | "full"
  | "draining"
  | "falling"
  | "hidden"
  | "pouring"
  | "respawning";

const DrunkCursorController = withSharedState(
  {
    id: "drunk-cursor-main-1",
    defaultData: {
      drinkTypes: Array(DRINK_COUNT).fill("beer") as DrinkType[],
    },
    myDefaultAwareness: {
      drunkLevel: 0,
    },
  },
  ({ data, setData, myAwareness, setMyAwareness, awareness }) => {
    // Use ref to track current drunk level for interval callbacks and prevent flicker
    const drunkLevelRef = useRef(0);

    // Get drunk level from awareness (our own awareness)
    // Use a more stable check - treat undefined as 0, but preserve actual 0 values
    const drunkLevel = useMemo(() => {
      if (myAwareness === undefined || myAwareness === null) {
        // If awareness is undefined but we have a ref value, use that to prevent flicker
        return drunkLevelRef.current;
      }
      const level =
        typeof myAwareness.drunkLevel === "number" ? myAwareness.drunkLevel : 0;
      // Update ref whenever we get a valid value
      drunkLevelRef.current = level;
      return level;
    }, [myAwareness]);

    const wobbleAnimationRef = useRef<number | null>(null);
    const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });
    const [currentMousePos, setCurrentMousePos] = useState({ x: 0, y: 0 });
    const mouseInterferenceRef = useRef({ x: 0, y: 0 });
    const lastMousePosRef = useRef({ x: 0, y: 0 });
    const targetInterferedPosRef = useRef({ x: 0, y: 0 }); // Target position after interference
    const smoothedPosRef = useRef({ x: 0, y: 0 }); // Smoothly interpolated position
    const animationFrameRef = useRef<number | null>(null);
    const lastInterferenceTimeRef = useRef(0);
    const lastUpdateTimeRef = useRef(0); // Track last mousemove time for wobble detection
    const wobblePhaseRef = useRef({ x: 0, y: 0, lastResetX: 0, lastResetY: 0 }); // Track wobble phase for smooth/jerk pattern
    const { hasSynced, cursors, getMyPlayerIdentity } = useContext(PlayContext);
    const drunkDecayIntervalRef = useRef<number | null>(null);
    const [otherCursors, setOtherCursors] = useState<
      Map<string, CursorPresence>
    >(new Map());
    // Use ref to track latest cursor positions without triggering effect restarts
    const otherCursorsRef = useRef<Map<string, CursorPresence>>(new Map());
    // Track wobbled positions for other users' cursors (simulated locally)
    const [otherCursorsWobbled, setOtherCursorsWobbled] = useState<
      Map<string, { x: number; y: number }>
    >(new Map());

    // Override playhtml's document cursor style - hide it since we render our own
    useEffect(() => {
      if (!hasSynced) return;

      // Override the cursor style that playhtml sets
      const overrideCursor = () => {
        document.documentElement.style.cursor = "none";
      };

      // Override immediately and set up observer to keep it overridden
      overrideCursor();
    }, [hasSynced]);

    // Get my user ID from cursor client
    const getMyUserId = useCallback((): string | null => {
      if (!playhtml.cursorClient) return null;
      const provider = (playhtml.cursorClient as any).provider;
      if (!provider) return null;
      return provider.awareness.clientID.toString();
    }, []);

    // Get drunk level for a user from awareness
    // The awareness array from withSharedState contains all users' awareness
    // We need to match userId (client ID) to the awareness entry
    const getUserDrunkLevel = useCallback(
      (userId: string, isMyCursor: boolean = false): number => {
        if (isMyCursor) {
          return drunkLevel;
        }

        // Access the provider's awareness states directly to get client ID -> awareness mapping
        if (!playhtml.cursorClient) return 0;
        const provider = (playhtml.cursorClient as any).provider;
        if (!provider) return 0;

        const elementId = "drunk-cursor-main-1";
        const clientIdNum = parseInt(userId);
        if (isNaN(clientIdNum)) return 0;

        // Get awareness state for this client ID
        const states = provider.awareness.getStates();
        const userState = states.get(clientIdNum);
        if (userState) {
          // Check if this user has awareness for our element
          const elementAwareness = userState["can-play"]?.[elementId];
          if (elementAwareness?.drunkLevel !== undefined) {
            return elementAwareness.drunkLevel;
          }
        }

        return 0;
      },
      [drunkLevel],
    );

    // Track own cursor movements
    useEffect(() => {
      if (!hasSynced) return;

      let lastUpdateTime = 0;
      const THROTTLE_MS = 1000 / 60; // 60fps for mouse position updates
      const INTERFERENCE_INTERVAL_MS = 200; // Apply interference every 200ms for less frequent, bigger adjustments

      const handleMove = (e: MouseEvent) => {
        const now = performance.now();
        if (now - lastUpdateTimeRef.current < THROTTLE_MS) return;
        lastUpdateTimeRef.current = now;

        const userId = getMyUserId();
        if (!userId) return;

        // Initialize last position if needed
        if (
          lastMousePosRef.current.x === 0 &&
          lastMousePosRef.current.y === 0
        ) {
          lastMousePosRef.current = { x: e.clientX, y: e.clientY };
          smoothedPosRef.current = { x: e.clientX, y: e.clientY };
          targetInterferedPosRef.current = { x: e.clientX, y: e.clientY };
          setCurrentMousePos({ x: e.clientX, y: e.clientY });
          return;
        }

        // Calculate distance BEFORE updating last position
        const dx = e.clientX - lastMousePosRef.current.x;
        const dy = e.clientY - lastMousePosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Reset wobble phase when user starts moving (fresh start)
        if (distance > 0.1) {
          wobblePhaseRef.current = { x: 0, y: 0, lastResetX: 0, lastResetY: 0 };
        }

        // Always update last position AFTER calculating distance
        lastMousePosRef.current = { x: e.clientX, y: e.clientY };

        // Apply drunk interference at intervals (not every frame) for smoother effect
        const timeSinceLastInterference = now - lastInterferenceTimeRef.current;

        if (drunkLevel > 0) {
          const interference = drunkLevel / 100;
          // Scale effect down at low drunk % (e.g. 20% feels gentler), keep 100% full strength
          const effectiveInterference =
            drunkLevel >= 100 ? 1 : Math.pow(interference, 0.55);

          let targetX = e.clientX;
          let targetY = e.clientY;

          if (
            distance > 0.1 &&
            timeSinceLastInterference >= INTERFERENCE_INTERVAL_MS
          ) {
            // User is moving - apply interference at intervals
            lastInterferenceTimeRef.current = now;

            if (drunkLevel >= 100) {
              // At 100%, move perpendicular to intended direction
              const angle = Math.atan2(dy, dx) + Math.PI / 2;
              const perpendicularDistance = distance * 3;
              targetX =
                lastMousePosRef.current.x +
                Math.cos(angle) * perpendicularDistance;
              targetY =
                lastMousePosRef.current.y +
                Math.sin(angle) * perpendicularDistance;
            } else {
              // Overcompensation and offset scaled by effectiveInterference (gentler at low %)
              const overcompensation = 1 + effectiveInterference * 4.0;
              targetX = lastMousePosRef.current.x + dx * overcompensation;
              targetY = lastMousePosRef.current.y + dy * overcompensation;

              const time = now / 1000;
              const randomOffset = effectiveInterference * 150;
              const offsetX =
                Math.sin(time * 0.8 + userId.charCodeAt(0)) * randomOffset;
              const offsetY =
                Math.cos(time * 0.6 + userId.charCodeAt(1)) * randomOffset;
              targetX += offsetX;
              targetY += offsetY;
            }

            targetInterferedPosRef.current = { x: targetX, y: targetY };
          } else if (distance <= 0.1) {
            // User is not moving - wobble with smooth drift + jerk pattern
            // Use steeper curve for wobble scaling (low drunk = very gentle, high drunk = intense)
            const wobbleScale = Math.pow(interference, 1.8); // Steep curve: 20% drunk = 0.2^1.8 ≈ 0.05, 100% = 1.0
            const baseWobbleAmount = 20; // Very gentle base wobble at low drunk
            const maxWobbleAmount = 200; // Max wobble at 100% drunk
            const wobbleAmount =
              baseWobbleAmount +
              (maxWobbleAmount - baseWobbleAmount) * wobbleScale;

            const time = now / 1000;

            // Smooth drift phase that accumulates, then jerks back
            // More drunk = wider diameter but similar drift speed (slower at 100% for more control)
            const driftScale = Math.pow(interference, 1.5); // Steeper curve for drift speed
            const baseDriftSpeed = 0.15; // Very slow at low drunk
            const maxDriftSpeed = 0.35; // Slower at 100% - wider diameter but controlled drift
            const driftSpeed =
              baseDriftSpeed + (maxDriftSpeed - baseDriftSpeed) * driftScale;

            // Jerk frequency: much slower at low drunk, only frequent at high drunk
            const jerkScale = Math.pow(interference, 2.0); // Very steep: almost no jerks at low drunk
            const baseJerkInterval = 3.5; // Very slow jerks when less drunk (almost no jerks)
            const maxJerkInterval = 0.8; // Fast jerks when very drunk
            const jerkInterval =
              baseJerkInterval -
              (baseJerkInterval - maxJerkInterval) * jerkScale;

            // Initialize phase tracking if needed
            if (wobblePhaseRef.current.lastResetX === 0) {
              wobblePhaseRef.current.lastResetX = time;
              wobblePhaseRef.current.lastResetY = time - 0.6; // Offset Y for variety
            }

            // X axis: smooth drift then jerk back
            const timeSinceResetX = time - wobblePhaseRef.current.lastResetX;
            let shouldJerkX = false;
            if (timeSinceResetX >= jerkInterval) {
              // Jerk back - reset phase (will cause immediate snap to opposite side)
              wobblePhaseRef.current.x = 0;
              wobblePhaseRef.current.lastResetX = time;
              shouldJerkX = true;
            } else {
              // Smooth drift - accumulate phase
              wobblePhaseRef.current.x += driftSpeed * (16 / 1000);
            }

            // Y axis: similar but offset for variety
            const timeSinceResetY = time - wobblePhaseRef.current.lastResetY;
            let shouldJerkY = false;
            if (timeSinceResetY >= jerkInterval * 1.3) {
              wobblePhaseRef.current.y = 0;
              wobblePhaseRef.current.lastResetY = time;
              shouldJerkY = true;
            } else {
              wobblePhaseRef.current.y += driftSpeed * 0.7 * (16 / 1000);
            }

            // Determine direction based on cycle (alternates each reset)
            const cycleX = Math.floor(
              (time -
                wobblePhaseRef.current.lastResetX +
                (shouldJerkX ? jerkInterval : 0)) /
                jerkInterval,
            );
            const cycleY = Math.floor(
              (time -
                wobblePhaseRef.current.lastResetY +
                (shouldJerkY ? jerkInterval * 1.3 : 0)) /
                (jerkInterval * 1.3),
            );
            const directionX = cycleX % 2 === 0 ? 1 : -1;
            const directionY = cycleY % 2 === 0 ? 1 : -1;

            // Apply wobble: smooth ease-out for drift, immediate snap for jerk
            const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
            const normalizedX = Math.min(1, wobblePhaseRef.current.x);
            const normalizedY = Math.min(1, wobblePhaseRef.current.y);

            // When jerking, use full amplitude immediately (snap), otherwise smooth drift
            // Jerk intensity scales aggressively - only intense at high drunk
            const jerkIntensityScale = Math.pow(interference, 2.5); // Very steep: minimal jerk at low drunk
            const jerkMultiplier = 1 + jerkIntensityScale * 0.4; // Up to 1.4x at 100% drunk, ~1.0x at 20%
            const wobbleX = shouldJerkX
              ? e.clientX + wobbleAmount * -directionX * jerkMultiplier // More intense snap when drunker
              : e.clientX + easeOut(normalizedX) * wobbleAmount * directionX; // Smooth drift
            const wobbleY = shouldJerkY
              ? e.clientY + wobbleAmount * -directionY * jerkMultiplier
              : e.clientY + easeOut(normalizedY) * wobbleAmount * directionY;

            targetX = wobbleX;
            targetY = wobbleY;
            targetInterferedPosRef.current = { x: targetX, y: targetY };
          }
        } else {
          // No interference - use actual mouse position
          targetInterferedPosRef.current = { x: e.clientX, y: e.clientY };
          smoothedPosRef.current = { x: e.clientX, y: e.clientY };
          setCurrentMousePos({ x: e.clientX, y: e.clientY });
        }
      };

      document.addEventListener("mousemove", handleMove);
      return () => {
        document.removeEventListener("mousemove", handleMove);
      };
    }, [hasSynced, getMyUserId, drunkLevel]);

    // Smooth interpolation of cursor position (runs continuously)
    // Also handles wobble for other users' cursors
    useEffect(() => {
      if (!hasSynced) return;

      const smoothStep = () => {
        // Update own cursor position
        const current = smoothedPosRef.current;
        let target = targetInterferedPosRef.current;

        // If user is stationary and drunk, update wobble continuously
        if (drunkLevel > 0) {
          const interference = drunkLevel / 100;
          const effectiveInterference =
            drunkLevel >= 100 ? 1 : Math.pow(interference, 0.55);
          const timeSinceLastMove =
            performance.now() - lastUpdateTimeRef.current;

          // If no mouse movement detected recently, apply continuous wobble
          if (timeSinceLastMove > 150) {
            // User is stationary - update wobble with smooth drift + jerk pattern
            // Use steeper curve for wobble scaling (low drunk = very gentle, high drunk = intense)
            const wobbleScale = Math.pow(interference, 1.8); // Steep curve: 20% drunk = 0.2^1.8 ≈ 0.05, 100% = 1.0
            const baseWobbleAmount = 20; // Very gentle base wobble at low drunk
            const maxWobbleAmount = 200; // Max wobble at 100% drunk
            const wobbleAmount =
              baseWobbleAmount +
              (maxWobbleAmount - baseWobbleAmount) * wobbleScale;

            const time = performance.now() / 1000;
            const deltaTime = 16 / 1000; // Approximate frame time (60fps)

            // Smooth drift phase that accumulates, then jerks back
            // More drunk = wider diameter but similar drift speed (slower at 100% for more control)
            const driftScale = Math.pow(interference, 1.5); // Steeper curve for drift speed
            const baseDriftSpeed = 0.15; // Very slow at low drunk
            const maxDriftSpeed = 0.35; // Slower at 100% - wider diameter but controlled drift
            const driftSpeed =
              baseDriftSpeed + (maxDriftSpeed - baseDriftSpeed) * driftScale;

            // Jerk frequency: much slower at low drunk, only frequent at high drunk
            const jerkScale = Math.pow(interference, 2.0); // Very steep: almost no jerks at low drunk
            const baseJerkInterval = 3.5; // Very slow jerks when less drunk (almost no jerks)
            const maxJerkInterval = 0.8; // Fast jerks when very drunk
            const jerkInterval =
              baseJerkInterval -
              (baseJerkInterval - maxJerkInterval) * jerkScale;

            // Initialize phase tracking if needed
            if (wobblePhaseRef.current.lastResetX === 0) {
              wobblePhaseRef.current.lastResetX = time;
              wobblePhaseRef.current.lastResetY = time - 0.6; // Offset Y for variety
            }

            // X axis: smooth drift then jerk back
            const timeSinceResetX = time - wobblePhaseRef.current.lastResetX;
            let shouldJerkX = false;
            if (timeSinceResetX >= jerkInterval) {
              // Jerk back - reset phase (will cause immediate snap to opposite side)
              wobblePhaseRef.current.x = 0;
              wobblePhaseRef.current.lastResetX = time;
              shouldJerkX = true;
            } else {
              // Smooth drift - accumulate phase
              wobblePhaseRef.current.x += driftSpeed * deltaTime;
            }

            // Y axis: similar but offset for variety
            const timeSinceResetY = time - wobblePhaseRef.current.lastResetY;
            let shouldJerkY = false;
            if (timeSinceResetY >= jerkInterval * 1.3) {
              wobblePhaseRef.current.y = 0;
              wobblePhaseRef.current.lastResetY = time;
              shouldJerkY = true;
            } else {
              wobblePhaseRef.current.y += driftSpeed * 0.7 * deltaTime;
            }

            // Determine direction based on cycle (alternates each reset)
            const cycleX = Math.floor(
              (time -
                wobblePhaseRef.current.lastResetX +
                (shouldJerkX ? jerkInterval : 0)) /
                jerkInterval,
            );
            const cycleY = Math.floor(
              (time -
                wobblePhaseRef.current.lastResetY +
                (shouldJerkY ? jerkInterval * 1.3 : 0)) /
                (jerkInterval * 1.3),
            );
            const directionX = cycleX % 2 === 0 ? 1 : -1;
            const directionY = cycleY % 2 === 0 ? 1 : -1;

            // Apply wobble: smooth ease-out for drift, immediate snap for jerk
            const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
            const normalizedX = Math.min(1, wobblePhaseRef.current.x);
            const normalizedY = Math.min(1, wobblePhaseRef.current.y);

            // When jerking, use full amplitude immediately (snap), otherwise smooth drift
            // Jerk intensity scales aggressively - only intense at high drunk
            const jerkIntensityScale = Math.pow(interference, 2.5); // Very steep: minimal jerk at low drunk
            const jerkMultiplier = 1 + jerkIntensityScale * 0.4; // Up to 1.4x at 100% drunk, ~1.0x at 20%
            const wobbleX = shouldJerkX
              ? lastMousePosRef.current.x +
                wobbleAmount * -directionX * jerkMultiplier // More intense snap when drunker
              : lastMousePosRef.current.x +
                easeOut(normalizedX) * wobbleAmount * directionX; // Smooth drift
            const wobbleY = shouldJerkY
              ? lastMousePosRef.current.y +
                wobbleAmount * -directionY * jerkMultiplier
              : lastMousePosRef.current.y +
                easeOut(normalizedY) * wobbleAmount * directionY;
            targetInterferedPosRef.current = { x: wobbleX, y: wobbleY };
            target = { x: wobbleX, y: wobbleY };
          }
        }

        // Lerp towards target position
        // Use slower lerp when drunk for smoother, bigger movements
        const lerpFactor = drunkLevel > 0 ? 0.08 : 0.3; // Faster when sober, slower when drunk
        const newX = current.x + (target.x - current.x) * lerpFactor;
        const newY = current.y + (target.y - current.y) * lerpFactor;

        smoothedPosRef.current = { x: newX, y: newY };
        setCurrentMousePos({ x: newX, y: newY });

        // Update wobbled positions for other users' cursors
        // Read from ref to get latest positions without restarting the animation loop
        const newWobbled = new Map<string, { x: number; y: number }>();
        const time = performance.now() / 1000;

        otherCursorsRef.current.forEach((cursorPresence, userId) => {
          if (!cursorPresence.cursor) return;

          const userDrunkLevel = getUserDrunkLevel(userId, false);
          if (userDrunkLevel > 0) {
            const interference = userDrunkLevel / 100;
            const effectiveInterference =
              userDrunkLevel >= 100 ? 1 : Math.pow(interference, 0.55);
            const wobbleAmount = effectiveInterference * 120;

            // Apply wobble to other user's cursor position
            const baseX = cursorPresence.cursor.x;
            const baseY = cursorPresence.cursor.y;
            const wobbleX =
              baseX +
              Math.sin(time * 0.5 + userId.charCodeAt(0) * 0.1) * wobbleAmount;
            const wobbleY =
              baseY +
              Math.cos(time * 0.4 + userId.charCodeAt(1) * 0.1) * wobbleAmount;

            newWobbled.set(userId, { x: wobbleX, y: wobbleY });
          } else {
            // No wobble - use actual position
            newWobbled.set(userId, {
              x: cursorPresence.cursor.x,
              y: cursorPresence.cursor.y,
            });
          }
        });

        setOtherCursorsWobbled(newWobbled);

        animationFrameRef.current = requestAnimationFrame(smoothStep);
      };

      animationFrameRef.current = requestAnimationFrame(smoothStep);

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }, [hasSynced, drunkLevel, getUserDrunkLevel]);

    // Drunk level decay over time - use a single interval that runs continuously
    useEffect(() => {
      // Start interval if not already running
      if (drunkDecayIntervalRef.current) {
        return; // Already running
      }

      const decayInterval = setInterval(() => {
        // Read from ref to get current value, not stale closure
        const currentLevel = drunkLevelRef.current;
        if (currentLevel <= 0) {
          // Already at 0, update body class but don't clear interval
          document.body.classList.remove("drunk");
          return;
        }

        document.body.classList.add("drunk");

        const newLevel = Math.max(0, currentLevel - 1);
        drunkLevelRef.current = newLevel; // Keep ref in sync so next tick reads correct value
        setMyAwareness({ drunkLevel: newLevel });

        if (newLevel === 0) {
          setMouseOffset({ x: 0, y: 0 });
          mouseInterferenceRef.current = { x: 0, y: 0 };
          document.body.classList.remove("drunk");
        }
      }, 1000); // Decay 1 per second

      drunkDecayIntervalRef.current = decayInterval as any;

      return () => {
        if (drunkDecayIntervalRef.current) {
          clearInterval(drunkDecayIntervalRef.current);
          drunkDecayIntervalRef.current = null;
        }
      };
    }, []); // Only run once when synced, interval handles the rest

    // Wobble animation when drunk and not moving - now handled in smoothStep above
    // Removed separate wobble effect since it's integrated into the interference system

    // Listen to other users' cursor positions from awareness
    useEffect(() => {
      if (!hasSynced || !playhtml.cursorClient) return;

      const provider = (playhtml.cursorClient as any).provider;
      if (!provider) return;

      const updateOtherCursors = () => {
        const states = provider.awareness.getStates();
        const myClientId = provider.awareness.clientID;
        const newCursors = new Map<string, CursorPresence>();

        states.forEach((state, clientId) => {
          if (clientId === myClientId) return;

          const cursorData = state[CURSOR_AWARENESS_FIELD] as
            | CursorPresence
            | undefined;
          if (cursorData?.cursor) {
            newCursors.set(clientId.toString(), cursorData);
          }
        });

        // Update both state (for rendering) and ref (for animation loop)
        otherCursorsRef.current = newCursors;
        setOtherCursors(newCursors);
      };

      // Initial update
      updateOtherCursors();

      // Listen to awareness changes
      provider.awareness.on("change", updateOtherCursors);

      return () => {
        provider.awareness.off("change", updateOtherCursors);
      };
    }, [hasSynced]);

    // No need to sync - drunkLevel is already from myAwareness
    // The awareness is automatically synced when we call setMyAwareness

    const getUserColor = useCallback(
      (userId: string, isMyCursor: boolean = false): string => {
        let baseColor: string | undefined;

        if (isMyCursor) {
          // Same source as playhtml: cursor client's playerIdentity (exposed as cursors.color in PlayContext)
          baseColor = cursors?.color;
        }
        if (!baseColor) {
          // Other users: same as playhtml - use cursor presence playerIdentity from awareness
          const cursorPresence = otherCursors.get(userId);
          baseColor =
            cursorPresence?.playerIdentity?.playerStyle?.colorPalette?.[0];
        }
        if (!baseColor) {
          // Same fallback as playhtml cursor-client when playerIdentity/color is missing
          baseColor = getMyPlayerIdentity().color;
        }

        return baseColor;
      },
      [otherCursors, getUserDrunkLevel, cursors],
    );

    const myColor = cursors?.color;

    // Welcome modal: show on first visit, persist dismissal in localStorage
    const [welcomeDismissed, setWelcomeDismissed] = useState(() => {
      if (typeof localStorage === "undefined") return false;
      return localStorage.getItem("drunk-cursor-welcome-dismissed") === "1";
    });
    const enterBar = useCallback(() => {
      localStorage.setItem("drunk-cursor-welcome-dismissed", "1");
      setWelcomeDismissed(true);
    }, []);

    const drinks = Array.from({ length: DRINK_COUNT }, (_, i) => i);

    // Shared: which slot is beer vs water (synced for all clients)
    const drinkTypes =
      data?.drinkTypes ?? (Array(DRINK_COUNT).fill("beer") as DrinkType[]);

    // Local: per-slot animation state when a drink is being consumed (drain → fall → pour → respawn)
    type SlotAnimation = {
      state: DrinkState;
      fillLevel: number;
      consumedType: DrinkType;
      nextType: DrinkType;
    };
    const [animatingSlotData, setAnimatingSlotData] = useState<
      Record<number, SlotAnimation>
    >({});
    const animatingSlotsRef = useRef<Set<number>>(new Set());

    // Audio refs for sounds
    const drinkSoundRef = useRef<HTMLAudioElement | null>(null);
    const pourSoundRef = useRef<HTMLAudioElement | null>(null);
    const waterPourSoundRef = useRef<HTMLAudioElement | null>(null);

    const {
      dispatchPlayEvent,
      registerPlayEventListener,
      removePlayEventListener,
    } = useContext(PlayContext);

    // Initialize audio elements
    useEffect(() => {
      drinkSoundRef.current = new Audio(
        "/experiments/drunk-cursor/beer-drink.wav",
      );
      drinkSoundRef.current.volume = 0.5;
      pourSoundRef.current = new Audio(
        "/experiments/drunk-cursor/beer-pour.MP3",
      );
      pourSoundRef.current.volume = 0.9;
      waterPourSoundRef.current = new Audio(
        "/experiments/drunk-cursor/pouring-water.mp3",
      );
      waterPourSoundRef.current.volume = 0.9;
      return () => {
        if (drinkSoundRef.current) {
          drinkSoundRef.current.pause();
          drinkSoundRef.current = null;
        }
        if (pourSoundRef.current) {
          pourSoundRef.current.pause();
          pourSoundRef.current = null;
        }
        if (waterPourSoundRef.current) {
          waterPourSoundRef.current.pause();
          waterPourSoundRef.current = null;
        }
      };
    }, []);

    // Start full drink animation for a slot (drain → fall → hidden → pour → respawn → full). Called from event listener.
    const startDrinkAnimation = useCallback(
      (
        drinkIndex: number,
        consumedType: DrinkType,
        nextType: DrinkType,
        applyDrunkEffect: boolean,
      ) => {
        const DRAIN_DURATION = 1200;
        const DRAIN_STEPS = 24;
        const DRAIN_AMOUNT = 100 / DRAIN_STEPS;
        const STEP_INTERVAL = DRAIN_DURATION / DRAIN_STEPS;
        // Initial state already set by event listener; just run the timers

        let currentStep = 0;
        const drainInterval = setInterval(() => {
          currentStep++;
          setAnimatingSlotData((prev) => {
            const slot = prev[drinkIndex];
            if (!slot) return prev;
            return {
              ...prev,
              [drinkIndex]: {
                ...slot,
                fillLevel: Math.max(0, 100 - currentStep * DRAIN_AMOUNT),
              },
            };
          });

          if (currentStep >= DRAIN_STEPS) {
            clearInterval(drainInterval);
            if (applyDrunkEffect) {
              const currentLevel = drunkLevelRef.current;
              const newLevel =
                consumedType === "water"
                  ? Math.max(0, currentLevel - 30)
                  : Math.min(100, currentLevel + 20);
              drunkLevelRef.current = newLevel;
              setMyAwareness({ drunkLevel: newLevel });
            }
            setAnimatingSlotData((prev) => ({
              ...prev,
              [drinkIndex]: { ...prev[drinkIndex]!, state: "falling" },
            }));
            setTimeout(() => {
              setAnimatingSlotData((prev) => ({
                ...prev,
                [drinkIndex]: { ...prev[drinkIndex]!, state: "hidden" },
              }));
              setTimeout(() => {
                const pourAudio =
                  nextType === "water"
                    ? waterPourSoundRef.current
                    : pourSoundRef.current;
                if (pourAudio) {
                  pourAudio.currentTime = 0;
                  pourAudio.play().catch(() => {});
                }
                setAnimatingSlotData((prev) => ({
                  ...prev,
                  [drinkIndex]: {
                    ...prev[drinkIndex]!,
                    state: "pouring",
                    fillLevel: 0,
                  },
                }));
                const FILL_DURATION = 2500;
                const FILL_STEPS = 20;
                const FILL_AMOUNT = 100 / FILL_STEPS;
                const fillStepInterval = FILL_DURATION / FILL_STEPS;
                let fillStep = 0;
                const fillInterval = setInterval(() => {
                  fillStep++;
                  setAnimatingSlotData((prev) => {
                    const slot = prev[drinkIndex];
                    if (!slot) return prev;
                    return {
                      ...prev,
                      [drinkIndex]: {
                        ...slot,
                        fillLevel: Math.min(100, fillStep * FILL_AMOUNT),
                      },
                    };
                  });
                  if (fillStep >= FILL_STEPS) {
                    clearInterval(fillInterval);
                    setAnimatingSlotData((prev) => ({
                      ...prev,
                      [drinkIndex]: {
                        ...prev[drinkIndex]!,
                        state: "respawning",
                      },
                    }));
                    setTimeout(() => {
                      animatingSlotsRef.current.delete(drinkIndex);
                      setAnimatingSlotData((prev) => {
                        const next = { ...prev };
                        delete next[drinkIndex];
                        return next;
                      });
                    }, 600);
                  }
                }, fillStepInterval);
              }, 1500);
            }, 800);
          }
        }, STEP_INTERVAL);
      },
      [setMyAwareness],
    );

    // Collaborative: when anyone drinks, all clients play sound and start local animation
    useEffect(() => {
      if (!hasSynced || !registerPlayEventListener || !removePlayEventListener)
        return;
      const listenerId = registerPlayEventListener("drunk-cursor-drink", {
        onEvent: (payload: unknown) => {
          const p = payload as {
            drinkIndex?: number;
            consumedType?: DrinkType;
            nextType?: DrinkType;
            userId?: string | null;
          } | null;
          if (p == null || typeof p.drinkIndex !== "number") return;
          const { drinkIndex, consumedType, nextType, userId } = p;
          if (animatingSlotsRef.current.has(drinkIndex)) return;
          animatingSlotsRef.current.add(drinkIndex);
          if (drinkSoundRef.current) {
            drinkSoundRef.current.currentTime = 0;
            drinkSoundRef.current.play().catch(() => {});
          }
          setAnimatingSlotData((prev) => ({
            ...prev,
            [drinkIndex]: {
              state: "draining",
              fillLevel: 100,
              consumedType: consumedType ?? "beer",
              nextType: nextType ?? "beer",
            },
          }));
          const myId = getMyUserId();
          startDrinkAnimation(
            drinkIndex,
            consumedType ?? "beer",
            nextType ?? "beer",
            userId != null && myId != null && userId === myId,
          );
        },
      });
      return () => removePlayEventListener("drunk-cursor-drink", listenerId);
    }, [
      hasSynced,
      registerPlayEventListener,
      removePlayEventListener,
      getMyUserId,
      startDrinkAnimation,
    ]);

    // Click handler: only update shared state and dispatch event; animation is started by event listener
    const handleDrink = useCallback(
      (drinkIndex: number) => {
        if (!hasSynced || !dispatchPlayEvent) return;
        if (animatingSlotData[drinkIndex] != null) return;
        const consumedType = data?.drinkTypes?.[drinkIndex] ?? "beer";
        const nextType = Math.random() < WATER_SPAWN_CHANCE ? "water" : "beer";
        // playhtml: use splice() for array updates; draft.drinkTypes[i] = x is not supported
        setData((draft: { drinkTypes: DrinkType[] }) => {
          draft.drinkTypes.splice(drinkIndex, 1, nextType);
        });
        dispatchPlayEvent({
          type: "drunk-cursor-drink",
          eventPayload: {
            drinkIndex,
            consumedType,
            nextType,
            userId: getMyUserId(),
          },
        });
      },
      [
        hasSynced,
        dispatchPlayEvent,
        animatingSlotData,
        data?.drinkTypes,
        setData,
        getMyUserId,
      ],
    );

    return (
      <div className="drunk-cursor-container" id="drunk-cursor-main-1">
        {/* Welcome modal - first visit only */}
        {!welcomeDismissed && (
          <div
            className="welcome-modal-overlay"
            aria-modal="true"
            role="dialog"
          >
            <div className="welcome-modal">
              <h2 className="welcome-modal-title">
                Welcome to the Cursor Bar!
              </h2>
              <p className="welcome-modal-body">
                This is a shared place for cursors to hang out, relax, and
                rewind after a long day scrolling. Drink some beer, dance
                together, and remember to share!
              </p>
              <button
                type="button"
                className="welcome-modal-button"
                onClick={enterBar}
              >
                Enter bar
              </button>
              <p className="welcome-modal-disclaimer">
                *drink responsibly, don&apos;t drink and scroll
              </p>
            </div>
          </div>
        )}

        {/* Drunk Indicator - beer scale (5 slots), always visible */}
        <div className="drunk-indicator drunk-indicator-beers">
          <div className="drunk-beers">
            {Array.from({ length: 5 }, (_, i) => {
              const beerLevel = drunkLevel / 20; // 0-5 (decimal)
              const fullBeers = Math.floor(beerLevel);
              const partialBeer = beerLevel - fullBeers; // 0-1 for the current partial beer

              const isFullyActive = i < fullBeers;
              const isPartiallyActive = i === fullBeers && partialBeer > 0;
              const fillPercentage = isPartiallyActive ? partialBeer * 100 : 0;

              return (
                <div key={i} className="drunk-beer-wrapper">
                  {/* Inactive (greyed) beer as background */}
                  <img
                    src="/experiments/drunk-cursor/beer.webp"
                    alt=""
                    className="drunk-beer-icon drunk-beer-inactive"
                  />
                  {/* Active (colored) beer clipped to show partial fill */}
                  <div
                    className="drunk-beer-fill"
                    style={{
                      height: isFullyActive
                        ? "100%"
                        : isPartiallyActive
                        ? `${fillPercentage}%`
                        : "0%",
                    }}
                  >
                    <img
                      src="/experiments/drunk-cursor/beer.webp"
                      alt=""
                      className="drunk-beer-icon drunk-beer-active"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Custom cursor element (always show for own cursor) */}
        <div
          className={`custom-cursor ${drunkLevel > 0 ? "cursor-drunk" : ""}`}
          style={{
            left: currentMousePos.x,
            top: currentMousePos.y,
            opacity: currentMousePos.x === 0 && currentMousePos.y === 0 ? 0 : 1,
            // Pulsing animation speed based on drunk level
            animationDuration:
              drunkLevel > 0 ? `${1.5 - (drunkLevel / 100) * 0.7}s` : undefined,
          }}
        >
          {/* Double vision copies - only when drunk */}
          {drunkLevel > 20 && (
            <>
              <svg
                className="cursor-double-vision cursor-double-1"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{
                  opacity: Math.min(0.4, (drunkLevel - 20) / 100),
                  transform: `translate(${4 + (drunkLevel / 100) * 8}px, ${
                    -2 - (drunkLevel / 100) * 4
                  }px)`,
                }}
              >
                <path
                  d="M3 3L10.07 19.97L12.58 12.58L19.97 10.07L3 3Z"
                  fill={myColor}
                  stroke="white"
                  strokeWidth="1.5"
                />
              </svg>
              {drunkLevel > 50 && (
                <svg
                  className="cursor-double-vision cursor-double-2"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{
                    opacity: Math.min(0.3, (drunkLevel - 50) / 100),
                    transform: `translate(${-3 - (drunkLevel / 100) * 6}px, ${
                      3 + (drunkLevel / 100) * 3
                    }px)`,
                  }}
                >
                  <path
                    d="M3 3L10.07 19.97L12.58 12.58L19.97 10.07L3 3Z"
                    fill={myColor}
                    stroke="white"
                    strokeWidth="1.5"
                  />
                </svg>
              )}
            </>
          )}
          {/* Main cursor */}
          <svg
            className="cursor-main"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M3 3L10.07 19.97L12.58 12.58L19.97 10.07L3 3Z"
              fill={myColor}
              stroke="white"
              strokeWidth="1.5"
            />
          </svg>
        </div>

        {/* Other users' cursors */}
        {Array.from(otherCursors.entries()).map(([userId, cursorPresence]) => {
          if (!cursorPresence.cursor) return null;
          const userDrunkLevel = getUserDrunkLevel(userId, false);
          const color = getUserColor(userId);

          // Use wobbled position if available, otherwise use actual position
          const wobbledPos = otherCursorsWobbled.get(userId);
          const displayX = wobbledPos?.x ?? cursorPresence.cursor.x;
          const displayY = wobbledPos?.y ?? cursorPresence.cursor.y;

          return (
            <div
              key={userId}
              className={`other-cursor ${
                userDrunkLevel > 0 ? "cursor-drunk" : ""
              }`}
              style={{
                left: displayX,
                top: displayY,
                // Pulsing animation speed based on drunk level
                animationDuration:
                  userDrunkLevel > 0
                    ? `${1.5 - (userDrunkLevel / 100) * 0.7}s`
                    : undefined,
              }}
            >
              {/* Double vision copies - only when drunk */}
              {userDrunkLevel > 20 && (
                <>
                  <svg
                    className="cursor-double-vision cursor-double-1"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    style={{
                      opacity: Math.min(0.4, (userDrunkLevel - 20) / 100),
                      transform: `translate(${
                        4 + (userDrunkLevel / 100) * 8
                      }px, ${-2 - (userDrunkLevel / 100) * 4}px)`,
                    }}
                  >
                    <path
                      d="M3 3L10.07 19.97L12.58 12.58L19.97 10.07L3 3Z"
                      fill={color}
                      stroke="white"
                      strokeWidth="1.5"
                    />
                  </svg>
                  {userDrunkLevel > 50 && (
                    <svg
                      className="cursor-double-vision cursor-double-2"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      style={{
                        opacity: Math.min(0.3, (userDrunkLevel - 50) / 100),
                        transform: `translate(${
                          -3 - (userDrunkLevel / 100) * 6
                        }px, ${3 + (userDrunkLevel / 100) * 3}px)`,
                      }}
                    >
                      <path
                        d="M3 3L10.07 19.97L12.58 12.58L19.97 10.07L3 3Z"
                        fill={color}
                        stroke="white"
                        strokeWidth="1.5"
                      />
                    </svg>
                  )}
                </>
              )}
              {/* Main cursor */}
              <svg
                className="cursor-main"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3 3L10.07 19.97L12.58 12.58L19.97 10.07L3 3Z"
                  fill={color}
                  stroke="white"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
          );
        })}

        {/* Cursor Bar wooden sign - top left */}
        <div className="cursor-bar-sign">
          <span className="cursor-bar-sign-text">Cursor Bar</span>
        </div>

        {/* Footer napkin */}
        <div className="footer-napkin">
          <a href="https://playhtml.fun">playhtml</a> experiment 9 by{" "}
          <a href="https://spencer.place/">spencer chang</a>
        </div>

        {/* Countertop with drinks */}
        <div className="countertop">
          {drinks.map((i) => {
            const slotAnim = animatingSlotData[i];
            const isAnimating = slotAnim != null;
            const state = isAnimating ? slotAnim.state : "full";
            const fillLevel = isAnimating ? slotAnim.fillLevel : 100;
            // When animating: drain/fall use consumedType; pour/respawn use nextType. When full use shared data.drinkTypes
            const displayType: DrinkType = isAnimating
              ? state === "draining" || state === "falling"
                ? slotAnim.consumedType
                : slotAnim.nextType
              : drinkTypes[i] ?? "beer";
            const isWater = displayType === "water";

            // Don't render hidden drinks
            if (state === "hidden") return null;

            // Show empty container during drain, falling, and pouring
            const showEmpty =
              state === "draining" ||
              state === "falling" ||
              state === "pouring";
            // Show filled drink when full, draining, pouring, or respawning
            const showFilled =
              state === "full" ||
              state === "draining" ||
              state === "pouring" ||
              state === "respawning";

            // Calculate mask based on state
            let maskStyle: React.CSSProperties = {};
            if (state === "draining") {
              maskStyle = {
                maskImage: `linear-gradient(to bottom, transparent ${
                  100 - fillLevel
                }%, black ${100 - fillLevel}%)`,
                WebkitMaskImage: `linear-gradient(to bottom, transparent ${
                  100 - fillLevel
                }%, black ${100 - fillLevel}%)`,
              };
            } else if (state === "pouring") {
              maskStyle = {
                maskImage: `linear-gradient(to bottom, transparent ${
                  100 - fillLevel
                }%, black ${100 - fillLevel}%)`,
                WebkitMaskImage: `linear-gradient(to bottom, transparent ${
                  100 - fillLevel
                }%, black ${100 - fillLevel}%)`,
              };
            }

            const emptyImageSrc = isWater
              ? "/experiments/drunk-cursor/empty-water-glass.png"
              : "/experiments/drunk-cursor/empty-beer.png";
            const filledImageSrc = isWater
              ? "/experiments/drunk-cursor/water-glass.png"
              : "/experiments/drunk-cursor/beer.webp";

            return (
              <div
                key={i}
                className={`drink drink-${state} ${
                  isWater ? "drink-water" : "drink-beer"
                }`}
                onClick={() => handleDrink(i)}
                style={{
                  left: `${15 + (i * 70) / (DRINK_COUNT - 1)}%`,
                }}
              >
                {showEmpty && (
                  <img
                    src={emptyImageSrc}
                    alt="Empty container"
                    className="drink-image drink-image-empty"
                  />
                )}
                {showFilled && (
                  <img
                    src={filledImageSrc}
                    alt={isWater ? "Water" : "Beer"}
                    className="drink-image drink-image-filled"
                    style={maskStyle}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(
  <PlayProvider
    initOptions={{
      cursors: {
        enabled: true,
        onCustomCursorRender: (connectionId, element) => {
          return null;
        },
        shouldRenderCursor: () => false,
        cursorStyle: "cursor: none !important;",
      },
    }}
  >
    <DrunkCursorController />
  </PlayProvider>,
);
