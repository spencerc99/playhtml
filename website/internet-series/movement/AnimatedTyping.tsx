// ABOUTME: Animated typing visualization component with character-by-character replay
// ABOUTME: Handles typing animation, sequence replay, and blinking caret
import React, { useState, useEffect, useRef, memo } from "react";
import { TypingState, TypingAction, ActiveTyping } from "./types";

interface TypingSettings {
  animationSpeed: number;
  textboxOpacity: number;
  keyboardShowCaret: boolean;
  keyboardAnimationSpeed: number;
}

interface AnimatedTypingProps {
  typingStates: TypingState[];
  timeRange: { min: number; max: number; duration: number };
  settings: TypingSettings;
}

// Seeded random for consistent variations
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

// Calculate character reveal time with natural variations
// Returns cumulative time offsets for each character
function calculateCharacterTimings(textLength: number, baseDuration: number, seed: number): number[] {
  const timings: number[] = [];
  let cumulativeTime = 0;

  for (let i = 0; i < textLength; i++) {
    // Random speed variation: some chars fast (0.5x), some slow (1.5x)
    const variation = 0.5 + seededRandom(seed + i) * 1.0; // 0.5 to 1.5
    const charTime = (baseDuration / textLength) * variation;
    cumulativeTime += charTime;
    timings.push(cumulativeTime);
  }

  // Normalize so the last character appears at baseDuration
  const totalTime = timings[timings.length - 1] || 1;
  return timings.map(t => (t / totalTime) * baseDuration);
}

// Replay sequence to get text at a specific elapsed time
// Animates character-by-character with natural typing rhythm
function replaySequence(sequence: TypingAction[], elapsedMs: number, seed: number = 0): string {
  let text = '';
  let actionSeed = seed;

  for (let i = 0; i < sequence.length; i++) {
    const action = sequence[i];
    const nextAction = sequence[i + 1];

    // Calculate time window for this action
    const actionStartTime = action.timestamp;
    const actionEndTime = nextAction ? nextAction.timestamp : elapsedMs + 1000;

    if (elapsedMs < actionStartTime) {
      break; // Haven't reached this action yet
    }

    if (action.action === 'type' && action.text) {
      const textLength = action.text.length;
      const timeInAction = elapsedMs - actionStartTime;
      const actionDuration = actionEndTime - actionStartTime;

      if (elapsedMs >= actionEndTime || textLength === 0) {
        // Action complete, show all text
        text += action.text;
      } else {
        // Animate character by character with variations
        const charTimings = calculateCharacterTimings(textLength, actionDuration, actionSeed);

        // Find how many characters should be visible
        let charsToShow = 0;
        for (let j = 0; j < charTimings.length; j++) {
          if (timeInAction >= charTimings[j]) {
            charsToShow = j + 1;
          } else {
            break;
          }
        }

        text += action.text.slice(0, charsToShow);
        break; // Don't process future actions
      }
      actionSeed += textLength; // Update seed for next action
    } else if (action.action === 'backspace' && action.deletedCount) {
      const timeInAction = elapsedMs - actionStartTime;
      const actionDuration = actionEndTime - actionStartTime;
      const deleteCount = action.deletedCount || 0;

      if (elapsedMs >= actionEndTime) {
        // Backspace complete, remove all characters
        const charsToDelete = Math.min(deleteCount, text.length);
        text = text.slice(0, -charsToDelete);
      } else {
        // Animate backspace character by character with variations
        const charTimings = calculateCharacterTimings(deleteCount, actionDuration, actionSeed);

        // Find how many characters should be deleted
        let charsDeleted = 0;
        for (let j = 0; j < charTimings.length; j++) {
          if (timeInAction >= charTimings[j]) {
            charsDeleted = j + 1;
          } else {
            break;
          }
        }

        const charsToDelete = Math.min(charsDeleted, text.length);
        text = text.slice(0, -charsToDelete);
        break; // Don't process future actions
      }
      actionSeed += deleteCount; // Update seed for next action
    }
  }

  return text;
}

// TypingBox Component - renders individual typing instance with classic input styling
const TypingBox = memo(({ typing, settings }: { typing: ActiveTyping; settings: TypingSettings }) => {
  const { x, y, currentText, showCaret, textboxSize, fontSize, positionOffset } = typing;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${x + positionOffset.x}px`,
        top: `${y + positionOffset.y}px`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }}
    >
      {/* Classic web input box with riso texture */}
      <div
        style={{
          position: 'relative',
          width: `${textboxSize.width}px`,
          minHeight: `${textboxSize.height}px`,
          border: '2px solid #999',
          borderRadius: '3px',
          backgroundColor: '#fefefe',
          padding: '8px 10px',
          fontFamily: 'monospace',
          fontSize: `${fontSize}px`,
          color: '#222',
          lineHeight: '1.5',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          // Classic inset shadow for input fields
          boxShadow: 'inset 1px 1px 3px rgba(0, 0, 0, 0.15), 0 1px 0 rgba(255, 255, 255, 0.8)',
          opacity: settings.textboxOpacity + 0.5, // Make more visible
        }}
      >

        {/* Text content */}
        <span style={{ position: 'relative', zIndex: 1 }}>
          {currentText}
          {settings.keyboardShowCaret && showCaret && (
            <span
              style={{
                display: 'inline-block',
                width: '2px',
                height: `${fontSize * 1.2}px`,
                backgroundColor: '#333',
                marginLeft: '2px',
                verticalAlign: 'text-bottom',
                animation: 'blink 1.06s step-end infinite',
              }}
            />
          )}
        </span>
      </div>
    </div>
  );
}, (prev, next) => {
  return (
    prev.typing.currentText === next.typing.currentText &&
    prev.typing.showCaret === next.typing.showCaret
  );
});

export const AnimatedTyping: React.FC<AnimatedTypingProps> = memo(({
  typingStates,
  timeRange,
  settings,
}) => {
  const [elapsedTimeMs, setElapsedTimeMs] = useState(0);
  const [activeTypings, setActiveTypings] = useState<ActiveTyping[]>([]);
  const animationRef = useRef<number>();

  // Settings as refs (same pattern as AnimatedTrails)
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Animation loop (same as AnimatedTrails)
  useEffect(() => {
    if (typingStates.length === 0 || timeRange.duration === 0) {
      setActiveTypings([]); // Clear active typings when no states
      return;
    }

    let startTime: number | null = null;

    const animate = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;

      const realElapsed = timestamp - startTime;
      const scaledElapsed = realElapsed * settingsRef.current.animationSpeed;
      const loopedElapsed = scaledElapsed % timeRange.duration;

      setElapsedTimeMs(loopedElapsed);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [typingStates, timeRange.duration]);

  // Update active typings based on elapsedTimeMs
  useEffect(() => {
    const newActiveTypings: ActiveTyping[] = [];

    typingStates.forEach((state, index) => {
      const { startOffsetMs, durationMs } = state;

      if (elapsedTimeMs < startOffsetMs) {
        return; // Not started yet
      }

      const typingElapsed = elapsedTimeMs - startOffsetMs;

      // Apply keyboard animation speed to slow down/speed up typing
      const scaledElapsed = typingElapsed * settingsRef.current.keyboardAnimationSpeed;

      // Replay sequence to get current text
      // If animation is finished, show final text (use durationMs as elapsed time)
      const timeToReplay = scaledElapsed > durationMs ? durationMs : scaledElapsed;
      const seed = state.animation.x + state.animation.y; // Consistent seed per typing instance
      const currentText = replaySequence(
        state.animation.sequence,
        timeToReplay,
        seed
      );

      // Only show blinking caret while actively typing (not after completion)
      // Animation finishes when real elapsed time reaches durationMs / speed
      const scaledDuration = durationMs / settingsRef.current.keyboardAnimationSpeed;
      const isTyping = typingElapsed <= scaledDuration;
      const showCaret = isTyping && Math.floor(typingElapsed / 530) % 2 === 0;

      newActiveTypings.push({
        id: `typing-state-${index}`, // Use index to ensure uniqueness
        x: state.animation.x,
        y: state.animation.y,
        color: state.animation.color,
        currentText,
        showCaret,
        textboxSize: state.textboxSize,
        fontSize: state.fontSize,
        positionOffset: state.positionOffset,
      });
    });

    setActiveTypings(newActiveTypings);
  }, [elapsedTimeMs, typingStates]);


  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {activeTypings.map(typing => (
        <TypingBox
          key={typing.id}
          typing={typing}
          settings={settingsRef.current}
        />
      ))}
    </div>
  );
});
