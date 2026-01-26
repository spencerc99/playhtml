// ABOUTME: Type definitions for the Internet Movement visualization
// ABOUTME: Shared types used across multiple components

export interface CollectionEvent {
  id: string;
  type: string;
  ts: number;
  data: {
    x: number;
    y: number;
    event?: 'move' | 'click' | 'hold' | 'cursor_change';
    cursor?: string;
    button?: number;
    duration?: number;
  };
  meta: {
    pid: string;
    sid: string;
    url: string;
    vw: number;
    vh: number;
    tz: string;
  };
}

export interface Trail {
  points: Array<{ x: number; y: number; ts: number; cursor?: string }>;
  color: string;
  opacity: number;
  angle?: number;
  startTime: number;
  endTime: number;
  clicks: Array<{ x: number; y: number; ts: number; button?: number; duration?: number }>;
}

export interface TrailState {
  trail: Trail;
  startOffsetMs: number;
  durationMs: number;
  variedPoints: Array<{ x: number; y: number }>;
  clicksWithProgress: Array<{
    x: number;
    y: number;
    ts: number;
    progress: number;
    duration?: number;
  }>;
}

export interface ClickEffect {
  id: string;
  x: number;
  y: number;
  color: string;
  radiusFactor: number;
  durationFactor: number;
  startTime: number;
  trailIndex: number;
  holdDuration?: number; // If present, this is a hold event - scale size and duration by this
}

// Keyboard event types
export interface KeyboardEventData {
  x: number;
  y: number;
  t?: string;
  event: 'type';
  sequence?: TypingAction[] | null;
}

export interface TypingAction {
  action: 'type' | 'backspace';
  text?: string;
  deletedCount?: number;
  timestamp: number;
}

export interface TypingAnimation {
  event: CollectionEvent;
  x: number;
  y: number;
  color: string;
  startTime: number;
  sequence: TypingAction[];
}

export interface TypingState {
  animation: TypingAnimation;
  startOffsetMs: number;
  durationMs: number;
  textboxSize: { width: number; height: number };
  fontSize: number;
  positionOffset: { x: number; y: number };
}

export interface ActiveTyping {
  id: string;
  x: number;
  y: number;
  color: string;
  currentText: string;
  showCaret: boolean;
  textboxSize: { width: number; height: number };
  fontSize: number;
  positionOffset: { x: number; y: number };
}
