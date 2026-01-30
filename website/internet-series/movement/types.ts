// ABOUTME: Type definitions for the Internet Movement visualization
// ABOUTME: Shared types used across multiple components

export interface CollectionEvent {
  id: string;
  type: string;
  ts: number;
  data: {
    x: number;
    y: number;
    event?: "move" | "click" | "hold" | "cursor_change";
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
  clicks: Array<{
    x: number;
    y: number;
    ts: number;
    button?: number;
    duration?: number;
  }>;
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
export interface InputStyling {
  w: number; // Width in pixels
  h: number; // Height in pixels
  br: number; // Border radius in pixels (capped at 20)
  bg: number; // Background luminosity 0-1 (for light/dark detection)
  bs: number; // Border style: 0=none, 1=solid, 2=dashed, 3=dotted, 4=double
}

export interface KeyboardEventData {
  x: number;
  y: number;
  t?: string;
  event: "type";
  sequence?: TypingAction[] | null;
  style?: InputStyling;
}

export interface TypingAction {
  action: "type" | "backspace";
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
  style?: InputStyling;
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
  style?: InputStyling;
}

// Viewport animation types
export interface ScrollAnimation {
  participantId: string;
  sessionId: string;
  pageUrl: string;
  color: string;
  scrollEvents: Array<{
    scrollX: number;
    scrollY: number;
    timestamp: number;
    viewportWidth: number;
    viewportHeight: number;
  }>;
  resizeEvents?: Array<{
    width: number;
    height: number;
    timestamp: number;
    quantity?: number;
  }>;
  zoomEvents?: Array<{
    zoom: number;
    previous_zoom?: number;
    timestamp: number;
    quantity?: number;
  }>;
  startTime: number;
  endTime: number;
  startViewportWidth: number;
  startViewportHeight: number;
  endViewportWidth: number;
  endViewportHeight: number;
}

export interface ViewportSize {
  width: number;
  height: number;
  key: string;
  count: number;
}

export interface ScrollViewportState {
  animation: ScrollAnimation;
  viewportSize: ViewportSize;
  startOffsetMs: number;
  durationMs: number;
  viewportRect: { x: number; y: number; width: number; height: number };
  backgroundSeed: number;
}

// Dynamic viewport system types
export type ViewportPhase = 'fade-in' | 'animating' | 'fade-out';

export interface ActiveViewport {
  id: string;
  animation: ScrollAnimation;
  rect: { x: number; y: number; width: number; height: number };
  phase: ViewportPhase;
  phaseStartTime: number;  // When this phase started (real time)
  animationStartTime: number;  // When animation started (real time)
  durationMs: number;  // How long the animation runs
  backgroundSeed: number;
}

// Navigation graph types for animated navigation visualization
export interface NavigationNode {
  id: string;
  domain: string;
  fullUrl: string;
  visitCount: number;
  totalTimeMs: number;
  participants: Set<string>;
  firstVisitTs: number;
  lastVisitTs: number;
  x: number;
  y: number;
  domainColor: string;  // Color assigned based on domain for visual grouping
}

export interface NavigationEdge {
  id: string;
  source: string;
  target: string;
  traversalCount: number;
  participants: Set<string>;
  wobblePath: Array<{ x: number; y: number }>;
}

export interface NavigationAnimation {
  nodes: NavigationNode[];
  edges: NavigationEdge[];
  color: string;
  startTime: number;
  endTime: number;
  participantId: string;
}

// A journey represents a single navigation session - sequence of page visits
export interface NavigationJourney {
  id: string;
  participantId: string;
  color: string;
  // Ordered sequence of node IDs representing the path taken
  nodeSequence: string[];
  // Edges in order (edge from nodeSequence[i] to nodeSequence[i+1])
  edgeSequence: string[];
  startTime: number;
  endTime: number;
}

export interface NavigationState {
  nodes: NavigationNode[];
  edges: NavigationEdge[];
  journeys: NavigationJourney[];
  durationMs: number;
}
