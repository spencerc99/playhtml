// ABOUTME: A heads-up display overlay for web browsing, inspired by car dashboards and video game HUDs.
// ABOUTME: Renders real-time gauges measuring scroll velocity, distance traveled, time on page, interaction rate, and more.

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Gauge SVG Components ───────────────────────────────────────────

interface ArcGaugeProps {
  value: number; // 0–1
  label: string;
  sublabel?: string;
  size?: number;
  color?: string;
  glowColor?: string;
  thickness?: number;
  startAngle?: number;
  endAngle?: number;
}

function ArcGauge({
  value,
  label,
  sublabel,
  size = 120,
  color = "#e8dcc8",
  glowColor,
  thickness = 3,
  startAngle = 135,
  endAngle = 405,
}: ArcGaugeProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness * 2 - 8) / 2;
  const totalAngle = endAngle - startAngle;

  const polarToCartesian = (angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const describeArc = (start: number, end: number) => {
    const s = polarToCartesian(start);
    const e = polarToCartesian(end);
    const largeArc = end - start > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
  };

  const clampedValue = Math.max(0, Math.min(1, value));
  const valueAngle = startAngle + totalAngle * clampedValue;

  // Tick marks
  const numTicks = 10;
  const ticks = Array.from({ length: numTicks + 1 }, (_, i) => {
    const angle = startAngle + (totalAngle / numTicks) * i;
    const inner = polarToCartesian(angle);
    const outerR = r + 4;
    const rad = ((angle - 90) * Math.PI) / 180;
    const outer = { x: cx + outerR * Math.cos(rad), y: cy + outerR * Math.sin(rad) };
    return { inner, outer, major: i % 5 === 0 };
  });

  // Needle tip
  const needleTip = polarToCartesian(valueAngle);
  const needleBase1Rad = ((valueAngle - 90 + 90) * Math.PI) / 180;
  const needleBase2Rad = ((valueAngle - 90 - 90) * Math.PI) / 180;
  const needleWidth = 2;
  const needleBase1 = {
    x: cx + needleWidth * Math.cos(needleBase1Rad),
    y: cy + needleWidth * Math.sin(needleBase1Rad),
  };
  const needleBase2 = {
    x: cx + needleWidth * Math.cos(needleBase2Rad),
    y: cy + needleWidth * Math.sin(needleBase2Rad),
  };

  const glow = glowColor || color;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Background arc */}
      <path
        d={describeArc(startAngle, endAngle)}
        fill="none"
        stroke="rgba(232,220,200,0.12)"
        strokeWidth={thickness}
        strokeLinecap="round"
      />
      {/* Value arc */}
      <path
        d={describeArc(startAngle, valueAngle)}
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
        style={{
          filter: `drop-shadow(0 0 4px ${glow})`,
          transition: "d 0.3s ease-out",
        }}
      />
      {/* Tick marks */}
      {ticks.map((tick, i) => (
        <line
          key={i}
          x1={tick.inner.x}
          y1={tick.inner.y}
          x2={tick.outer.x}
          y2={tick.outer.y}
          stroke={tick.major ? "rgba(232,220,200,0.4)" : "rgba(232,220,200,0.15)"}
          strokeWidth={tick.major ? 1.5 : 0.75}
        />
      ))}
      {/* Needle */}
      <polygon
        points={`${needleTip.x},${needleTip.y} ${needleBase1.x},${needleBase1.y} ${needleBase2.x},${needleBase2.y}`}
        fill={color}
        style={{
          filter: `drop-shadow(0 0 3px ${glow})`,
          transition: "all 0.15s ease-out",
        }}
      />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r={3} fill={color} opacity={0.6} />
      {/* Label */}
      <text
        x={cx}
        y={cy + r * 0.35}
        textAnchor="middle"
        fill="rgba(232,220,200,0.7)"
        fontSize={size * 0.08}
        fontFamily="'Martian Mono', 'Space Mono', 'Courier New', monospace"
        letterSpacing="0.08em"
      >
        {label}
      </text>
      {sublabel && (
        <text
          x={cx}
          y={cy + r * 0.55}
          textAnchor="middle"
          fill={color}
          fontSize={size * 0.13}
          fontFamily="'Martian Mono', 'Space Mono', 'Courier New', monospace"
          fontWeight={600}
        >
          {sublabel}
        </text>
      )}
    </svg>
  );
}

// ─── Mini bar gauge (like a fuel gauge) ──────────────────────────────

interface BarGaugeProps {
  value: number; // 0–1
  label: string;
  width?: number;
  height?: number;
  color?: string;
  icon?: string;
}

function BarGauge({
  value,
  label,
  width = 100,
  height = 8,
  color = "#e8dcc8",
  icon,
}: BarGaugeProps) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      {icon && (
        <span style={{ fontSize: "10px", opacity: 0.6 }}>{icon}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "2px",
          }}
        >
          <span
            style={{
              fontSize: "9px",
              color: "rgba(232,220,200,0.5)",
              fontFamily: "'Martian Mono', monospace",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontSize: "9px",
              color: "rgba(232,220,200,0.7)",
              fontFamily: "'Martian Mono', monospace",
            }}
          >
            {Math.round(clamped * 100)}%
          </span>
        </div>
        <div
          style={{
            width,
            height,
            background: "rgba(232,220,200,0.08)",
            borderRadius: height / 2,
            overflow: "hidden",
            border: "1px solid rgba(232,220,200,0.1)",
          }}
        >
          <div
            style={{
              width: `${clamped * 100}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${color}88, ${color})`,
              borderRadius: height / 2,
              transition: "width 0.5s ease-out",
              boxShadow: `0 0 6px ${color}44`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Compass ────────────────────────────────────────────────────────

interface CompassProps {
  scrollProgress: number; // 0–1 vertical scroll
  size?: number;
}

function Compass({ scrollProgress, size = 60 }: CompassProps) {
  // Map scroll progress to a rotation — "heading" through the page
  const rotation = scrollProgress * 360;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Outer ring */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="rgba(232,220,200,0.15)"
        strokeWidth={1}
      />
      {/* Cardinal directions */}
      {["N", "E", "S", "W"].map((dir, i) => {
        const angle = i * 90 - rotation;
        const rad = ((angle - 90) * Math.PI) / 180;
        const tx = cx + (r - 8) * Math.cos(rad);
        const ty = cy + (r - 8) * Math.sin(rad);
        const isNorth = dir === "N";
        return (
          <text
            key={dir}
            x={tx}
            y={ty}
            textAnchor="middle"
            dominantBaseline="central"
            fill={isNorth ? "#d4b85c" : "rgba(232,220,200,0.35)"}
            fontSize={isNorth ? 9 : 7}
            fontFamily="'Martian Mono', monospace"
            fontWeight={isNorth ? 700 : 400}
          >
            {dir}
          </text>
        );
      })}
      {/* Needle (always points up — "your heading") */}
      <polygon
        points={`${cx},${cy - r + 14} ${cx - 3},${cy} ${cx + 3},${cy}`}
        fill="#d4b85c"
        opacity={0.8}
        style={{ filter: "drop-shadow(0 0 3px rgba(212,184,92,0.4))" }}
      />
      <circle cx={cx} cy={cy} r={2} fill="#d4b85c" opacity={0.5} />
    </svg>
  );
}

// ─── Odometer display ────────────────────────────────────────────────

interface OdometerProps {
  value: number;
  label: string;
  unit?: string;
}

function Odometer({ value, label, unit = "px" }: OdometerProps) {
  const formatted = value >= 10000
    ? `${(value / 1000).toFixed(1)}k`
    : value >= 1000
      ? `${(value / 1000).toFixed(2)}k`
      : String(Math.round(value));

  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontSize: "9px",
          color: "rgba(232,220,200,0.4)",
          fontFamily: "'Martian Mono', monospace",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: "2px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "inline-flex",
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(232,220,200,0.12)",
          borderRadius: "4px",
          padding: "3px 8px",
          fontFamily: "'Martian Mono', monospace",
          fontSize: "13px",
          color: "#e8dcc8",
          letterSpacing: "0.15em",
          fontVariantNumeric: "tabular-nums",
          minWidth: "60px",
          justifyContent: "center",
        }}
      >
        {formatted}
        <span
          style={{
            fontSize: "8px",
            color: "rgba(232,220,200,0.4)",
            marginLeft: "3px",
            alignSelf: "flex-end",
          }}
        >
          {unit}
        </span>
      </div>
    </div>
  );
}

// ─── Session clock ──────────────────────────────────────────────────

interface SessionClockProps {
  elapsedMs: number;
}

function SessionClock({ elapsedMs }: SessionClockProps) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");
  const display = hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;

  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontSize: "8px",
          color: "rgba(232,220,200,0.35)",
          fontFamily: "'Martian Mono', monospace",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: "2px",
        }}
      >
        session
      </div>
      <div
        style={{
          fontFamily: "'Martian Mono', monospace",
          fontSize: "16px",
          color: "#d4b85c",
          letterSpacing: "0.1em",
          fontVariantNumeric: "tabular-nums",
          textShadow: "0 0 8px rgba(212,184,92,0.3)",
        }}
      >
        {display}
      </div>
    </div>
  );
}

// ─── Horizon line (attitude indicator inspired) ─────────────────────

interface HorizonProps {
  scrollSpeed: number; // current px/s
  maxSpeed?: number;
  width?: number;
  height?: number;
}

function Horizon({ scrollSpeed, maxSpeed = 3000, width = 200, height = 40 }: HorizonProps) {
  // Tilt based on scroll speed — like banking in a vehicle
  const tilt = Math.max(-15, Math.min(15, (scrollSpeed / maxSpeed) * 30 - 15));
  const cx = width / 2;
  const cy = height / 2;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* Sky / ground split */}
      <defs>
        <clipPath id="horizon-clip">
          <rect x={0} y={0} width={width} height={height} rx={4} />
        </clipPath>
      </defs>
      <g clipPath="url(#horizon-clip)">
        {/* Sky */}
        <rect x={0} y={0} width={width} height={height} fill="rgba(45,55,72,0.3)" />
        {/* Ground — tilts with speed */}
        <rect
          x={-width}
          y={cy}
          width={width * 3}
          height={height}
          fill="rgba(92,75,56,0.3)"
          transform={`rotate(${tilt}, ${cx}, ${cy})`}
          style={{ transition: "transform 0.3s ease-out" }}
        />
        {/* Center crosshair */}
        <line x1={cx - 20} y1={cy} x2={cx - 6} y2={cy} stroke="#d4b85c" strokeWidth={1.5} opacity={0.6} />
        <line x1={cx + 6} y1={cy} x2={cx + 20} y2={cy} stroke="#d4b85c" strokeWidth={1.5} opacity={0.6} />
        <circle cx={cx} cy={cy} r={2} fill="none" stroke="#d4b85c" strokeWidth={1} opacity={0.5} />
        {/* Horizon line */}
        <line
          x1={0}
          y1={cy}
          x2={width}
          y2={cy}
          stroke="rgba(232,220,200,0.2)"
          strokeWidth={0.5}
          transform={`rotate(${tilt}, ${cx}, ${cy})`}
          style={{ transition: "transform 0.3s ease-out" }}
        />
      </g>
      {/* Border */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={4}
        fill="none"
        stroke="rgba(232,220,200,0.1)"
        strokeWidth={1}
      />
    </svg>
  );
}

// ─── Main HUD Component ─────────────────────────────────────────────

interface BrowsingHudProps {
  visible: boolean;
  onClose: () => void;
}

// Smoothly interpolate a value
function useSmoothValue(target: number, smoothing = 0.15) {
  const ref = useRef(target);
  const [value, setValue] = useState(target);

  useEffect(() => {
    let raf: number;
    const animate = () => {
      ref.current += (target - ref.current) * smoothing;
      setValue(ref.current);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [target, smoothing]);

  return value;
}

export function BrowsingHud({ visible, onClose }: BrowsingHudProps) {
  // ── Tracking state ──
  const [scrollSpeed, setScrollSpeed] = useState(0); // px/s
  const [totalScrollDistance, setTotalScrollDistance] = useState(0); // px
  const [clickCount, setClickCount] = useState(0);
  const [clicksPerMinute, setClicksPerMinute] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0); // 0–1
  const [pageDepth, setPageDepth] = useState(0); // max scroll reached 0–1
  const [elapsedMs, setElapsedMs] = useState(0);
  const [mouseDistance, setMouseDistance] = useState(0); // px
  const [fuelRemaining, setFuelRemaining] = useState(1); // attention gauge, decays
  const [keystrokeCount, setKeystrokeCount] = useState(0);
  const [idleTime, setIdleTime] = useState(0); // ms since last interaction

  const startTimeRef = useRef(Date.now());
  const lastScrollYRef = useRef(window.scrollY);
  const lastScrollTimeRef = useRef(Date.now());
  const scrollSpeedSamplesRef = useRef<number[]>([]);
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const clickTimestampsRef = useRef<number[]>([]);
  const lastInteractionRef = useRef(Date.now());
  const totalScrollDistRef = useRef(0);
  const mouseDistRef = useRef(0);
  const clickCountRef = useRef(0);
  const keystrokeCountRef = useRef(0);
  const maxDepthRef = useRef(0);

  // Smoothed values for gauges
  const smoothScrollSpeed = useSmoothValue(scrollSpeed, 0.1);
  const smoothCPM = useSmoothValue(clicksPerMinute, 0.08);

  // ── Event handlers ──
  const handleScroll = useCallback(() => {
    const now = Date.now();
    const currentY = window.scrollY;
    const deltaY = Math.abs(currentY - lastScrollYRef.current);
    const deltaTime = Math.max(1, now - lastScrollTimeRef.current);

    // Accumulate distance
    totalScrollDistRef.current += deltaY;
    setTotalScrollDistance(totalScrollDistRef.current);

    // Speed in px/s
    const instantSpeed = (deltaY / deltaTime) * 1000;
    scrollSpeedSamplesRef.current.push(instantSpeed);
    if (scrollSpeedSamplesRef.current.length > 5) {
      scrollSpeedSamplesRef.current.shift();
    }
    const avgSpeed =
      scrollSpeedSamplesRef.current.reduce((a, b) => a + b, 0) /
      scrollSpeedSamplesRef.current.length;
    setScrollSpeed(avgSpeed);

    // Scroll progress (0–1)
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const progress = currentY / maxScroll;
    setScrollProgress(progress);

    // Track max depth
    if (progress > maxDepthRef.current) {
      maxDepthRef.current = progress;
      setPageDepth(progress);
    }

    lastScrollYRef.current = currentY;
    lastScrollTimeRef.current = now;
    lastInteractionRef.current = now;
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const pos = { x: e.clientX, y: e.clientY };
    if (lastMousePosRef.current) {
      const dx = pos.x - lastMousePosRef.current.x;
      const dy = pos.y - lastMousePosRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      mouseDistRef.current += dist;
      setMouseDistance(mouseDistRef.current);
    }
    lastMousePosRef.current = pos;
    lastInteractionRef.current = Date.now();
  }, []);

  const handleClick = useCallback(() => {
    const now = Date.now();
    clickCountRef.current += 1;
    setClickCount(clickCountRef.current);
    clickTimestampsRef.current.push(now);
    // Keep only last 60s of clicks
    clickTimestampsRef.current = clickTimestampsRef.current.filter(
      (t) => now - t < 60000
    );
    setClicksPerMinute(clickTimestampsRef.current.length);
    lastInteractionRef.current = now;
  }, []);

  const handleKeydown = useCallback(() => {
    keystrokeCountRef.current += 1;
    setKeystrokeCount(keystrokeCountRef.current);
    lastInteractionRef.current = Date.now();
  }, []);

  // ── Setup / teardown ──
  useEffect(() => {
    if (!visible) return;

    // Reset on open
    startTimeRef.current = Date.now();
    lastScrollYRef.current = window.scrollY;
    lastScrollTimeRef.current = Date.now();
    lastInteractionRef.current = Date.now();
    scrollSpeedSamplesRef.current = [];
    lastMousePosRef.current = null;
    clickTimestampsRef.current = [];
    totalScrollDistRef.current = 0;
    mouseDistRef.current = 0;
    clickCountRef.current = 0;
    keystrokeCountRef.current = 0;
    maxDepthRef.current = 0;

    setScrollSpeed(0);
    setTotalScrollDistance(0);
    setClickCount(0);
    setClicksPerMinute(0);
    setMouseDistance(0);
    setKeystrokeCount(0);
    setPageDepth(0);
    setFuelRemaining(1);
    setIdleTime(0);

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("click", handleClick, true);
    window.addEventListener("keydown", handleKeydown, { passive: true });

    // Timer tick for elapsed / idle / fuel
    const interval = setInterval(() => {
      const now = Date.now();
      setElapsedMs(now - startTimeRef.current);

      const idle = now - lastInteractionRef.current;
      setIdleTime(idle);

      // Fuel decays with idle time, replenishes with activity
      setFuelRemaining((prev) => {
        if (idle > 5000) {
          // Decay after 5s idle
          return Math.max(0, prev - 0.003);
        }
        // Replenish slowly with activity
        return Math.min(1, prev + 0.002);
      });

      // Decay scroll speed toward 0 if no scroll events
      if (now - lastScrollTimeRef.current > 300) {
        setScrollSpeed((prev) => prev * 0.85);
      }
    }, 100);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("keydown", handleKeydown);
      clearInterval(interval);
    };
  }, [visible, handleScroll, handleMouseMove, handleClick, handleKeydown]);

  // ── Derived values ──
  const speedNormalized = Math.min(1, smoothScrollSpeed / 3000);
  const cpmNormalized = Math.min(1, smoothCPM / 30);
  const isIdle = idleTime > 10000;

  // Status text
  const statusText = useMemo(() => {
    if (isIdle) return "drifting...";
    if (smoothScrollSpeed > 2000) return "hyperspeed";
    if (smoothScrollSpeed > 800) return "cruising";
    if (smoothCPM > 15) return "clicking frenzy";
    if (smoothScrollSpeed > 200) return "browsing";
    if (keystrokeCount > 0 && idleTime < 2000) return "typing";
    return "idle";
  }, [isIdle, smoothScrollSpeed, smoothCPM, keystrokeCount, idleTime]);

  if (!visible) return null;

  const containerStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 2147483646,
    pointerEvents: "none",
    fontFamily: "'Martian Mono', 'Space Mono', 'Courier New', monospace",
    color: "#e8dcc8",
  };

  // The HUD is arranged around the edges of the viewport like a car dashboard
  return (
    <div style={containerStyle} id="playhtml-browsing-hud">
      {/* ── Top center: Horizon indicator + status ── */}
      <div
        style={{
          position: "absolute",
          top: "16px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <Horizon scrollSpeed={smoothScrollSpeed} width={180} height={36} />
        <div
          style={{
            fontSize: "10px",
            color: isIdle ? "rgba(232,220,200,0.3)" : "rgba(212,184,92,0.7)",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            transition: "color 0.5s",
          }}
        >
          {statusText}
        </div>
      </div>

      {/* ── Bottom left cluster: Speedometer + Tachometer ── */}
      <div
        style={{
          position: "absolute",
          bottom: "16px",
          left: "16px",
          display: "flex",
          gap: "4px",
          alignItems: "flex-end",
        }}
      >
        {/* Speedometer */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <ArcGauge
            value={speedNormalized}
            label="SCROLL"
            sublabel={`${Math.round(smoothScrollSpeed)}`}
            size={110}
            color={smoothScrollSpeed > 2000 ? "#e85d5d" : smoothScrollSpeed > 800 ? "#d4b85c" : "#8ab4a0"}
            thickness={3}
          />
          <div style={{ fontSize: "7px", color: "rgba(232,220,200,0.3)", marginTop: "-4px" }}>
            px/s
          </div>
        </div>

        {/* Tachometer (clicks per minute) */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <ArcGauge
            value={cpmNormalized}
            label="CLICKS"
            sublabel={`${Math.round(smoothCPM)}`}
            size={90}
            color={smoothCPM > 20 ? "#e85d5d" : smoothCPM > 10 ? "#d4b85c" : "#8aa4b4"}
            thickness={2.5}
          />
          <div style={{ fontSize: "7px", color: "rgba(232,220,200,0.3)", marginTop: "-4px" }}>
            /min
          </div>
        </div>
      </div>

      {/* ── Bottom center: Odometers ── */}
      <div
        style={{
          position: "absolute",
          bottom: "16px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: "16px",
          alignItems: "flex-end",
        }}
      >
        <Odometer value={totalScrollDistance} label="scroll" unit="px" />
        <Odometer value={mouseDistance} label="cursor" unit="px" />
        <Odometer value={clickCount} label="clicks" unit="" />
        <Odometer value={keystrokeCount} label="keys" unit="" />
      </div>

      {/* ── Bottom right: Session clock + Compass ── */}
      <div
        style={{
          position: "absolute",
          bottom: "16px",
          right: "16px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <Compass scrollProgress={scrollProgress} size={56} />
        <SessionClock elapsedMs={elapsedMs} />
      </div>

      {/* ── Right side: Fuel + Depth gauges ── */}
      <div
        style={{
          position: "absolute",
          right: "16px",
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          width: "100px",
        }}
      >
        <BarGauge
          value={fuelRemaining}
          label="attention"
          color={fuelRemaining < 0.25 ? "#e85d5d" : fuelRemaining < 0.5 ? "#d4b85c" : "#8ab4a0"}
          icon="◐"
        />
        <BarGauge
          value={pageDepth}
          label="depth"
          color="#8aa4b4"
          icon="▾"
        />
        <BarGauge
          value={scrollProgress}
          label="position"
          color="#b4a08a"
          icon="◇"
        />
      </div>

      {/* ── Left side: Mini page map ── */}
      <div
        style={{
          position: "absolute",
          left: "16px",
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <div
          style={{
            fontSize: "8px",
            color: "rgba(232,220,200,0.35)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          page
        </div>
        {/* Minimap track */}
        <div
          style={{
            width: "4px",
            height: "80px",
            background: "rgba(232,220,200,0.08)",
            borderRadius: "2px",
            position: "relative",
            border: "1px solid rgba(232,220,200,0.06)",
          }}
        >
          {/* Current position indicator */}
          <div
            style={{
              position: "absolute",
              top: `${scrollProgress * 100}%`,
              left: "-3px",
              width: "10px",
              height: "3px",
              background: "#d4b85c",
              borderRadius: "1.5px",
              transform: "translateY(-50%)",
              transition: "top 0.15s ease-out",
              boxShadow: "0 0 4px rgba(212,184,92,0.4)",
            }}
          />
          {/* Max depth marker */}
          <div
            style={{
              position: "absolute",
              top: `${pageDepth * 100}%`,
              left: "-1px",
              width: "6px",
              height: "1px",
              background: "rgba(232,220,200,0.25)",
              transform: "translateY(-50%)",
            }}
          />
        </div>
        <div
          style={{
            fontSize: "8px",
            color: "rgba(232,220,200,0.3)",
            fontFamily: "'Martian Mono', monospace",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {Math.round(scrollProgress * 100)}%
        </div>
      </div>

      {/* ── Close button (top right) ── */}
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: "12px",
          right: "12px",
          pointerEvents: "auto",
          background: "none",
          border: "1px solid rgba(232,220,200,0.15)",
          borderRadius: "4px",
          color: "rgba(232,220,200,0.5)",
          fontSize: "10px",
          fontFamily: "'Martian Mono', monospace",
          padding: "4px 8px",
          cursor: "pointer",
          transition: "all 0.2s",
          letterSpacing: "0.05em",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "#e8dcc8";
          e.currentTarget.style.borderColor = "rgba(232,220,200,0.3)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "rgba(232,220,200,0.5)";
          e.currentTarget.style.borderColor = "rgba(232,220,200,0.15)";
        }}
      >
        esc ✕
      </button>

      {/* ── Top left: domain / current URL ── */}
      <div
        style={{
          position: "absolute",
          top: "12px",
          left: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}
      >
        <div
          style={{
            fontSize: "10px",
            color: "rgba(232,220,200,0.5)",
            letterSpacing: "0.08em",
            maxWidth: "200px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {window.location.hostname}
        </div>
        <div
          style={{
            fontSize: "8px",
            color: "rgba(232,220,200,0.25)",
            maxWidth: "200px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {window.location.pathname}
        </div>
      </div>

      {/* ── Subtle vignette overlay for the HUD feel ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.15) 100%)",
        }}
      />
    </div>
  );
}
