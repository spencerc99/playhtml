import "./playground.scss";
import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";

// RISO-inspired color palette (same as main)
const RISO_COLORS = [
  "rgb(0, 120, 191)", // Blue
  "rgb(255, 102, 94)", // Bright Red
  "rgb(0, 169, 92)", // Green
  "rgb(255, 123, 75)", // Orange
  "rgb(255, 232, 0)", // Yellow
  "rgb(255, 72, 176)", // Pink
  "rgb(102, 45, 145)", // Purple
];

interface ClickEffect {
  id: string;
  x: number;
  y: number;
  color: string;
  radiusFactor: number; // Random factor 0-1 for radius calculation
  durationFactor: number; // Random factor 0-1 for duration calculation
  startTime: number;
}

const SETTINGS_KEY = 'click-playground-settings';

// Load settings from localStorage
const loadSettings = () => {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
  
  return {
    minRadius: 20,
    maxRadius: 150,
    minDuration: 3000,
    maxDuration: 6000,
    expansionDuration: 2000, // How long each ring takes to expand (independent of total duration)
    strokeWidth: 2,
    opacity: 0.5,
    autoSpawn: true,
    spawnInterval: 2000,
    numRings: 5,
    ringDelayMs: 200, // Absolute delay in milliseconds between each ring starting
    animationStopPoint: 0.5, // Stop animation at 50% (0-1)
  };
};

const ClickEffectPlayground = () => {
  const [effects, setEffects] = useState<ClickEffect[]>([]);
  const [settings, setSettings] = useState(loadSettings());
  const [copySuccess, setCopySuccess] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSpawnTime = useRef<number>(0);
  
  // Save settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }, [settings]);

  // Auto-spawn effects
  useEffect(() => {
    if (!settings.autoSpawn) return;

    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastSpawnTime.current < settings.spawnInterval) return;

      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.random() * rect.width;
        const y = Math.random() * rect.height;
        spawnEffect(x, y);
        lastSpawnTime.current = now;
      }
    }, 100);

    return () => clearInterval(interval);
  }, [settings.autoSpawn, settings.spawnInterval]);

  // Clean up old effects (use max duration since actual duration is calculated dynamically)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setEffects((prev) =>
        prev.filter((effect) => {
          const effectDuration = settings.minDuration + effect.durationFactor * (settings.maxDuration - settings.minDuration);
          return now - effect.startTime < effectDuration + 500;
        })
      );
    }, 100);

    return () => clearInterval(interval);
  }, [settings.minDuration, settings.maxDuration]);

  const spawnEffect = (x: number, y: number) => {
    const color = RISO_COLORS[Math.floor(Math.random() * RISO_COLORS.length)];
    
    // Store random factors (0-1) so effects can be reactive to settings changes
    const radiusFactor = Math.random();
    const durationFactor = Math.random();

    const newEffect: ClickEffect = {
      id: `${Date.now()}-${Math.random()}`,
      x,
      y,
      color,
      radiusFactor,
      durationFactor,
      startTime: Date.now(),
    };

    setEffects((prev) => [...prev, newEffect]);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.target === containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      spawnEffect(x, y);
    }
  };
  
  const copySettings = () => {
    const settingsJSON = JSON.stringify(settings, null, 2);
    navigator.clipboard.writeText(settingsJSON).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  return (
    <div className="playground">
      <div className="controls">
        <h2>Click Effect Playground</h2>

        <div className="control-group">
          <label>
            <input
              type="checkbox"
              checked={settings.autoSpawn}
              onChange={(e) =>
                setSettings((s) => ({ ...s, autoSpawn: e.target.checked }))
              }
            />
            Auto-spawn effects
          </label>
        </div>

        {settings.autoSpawn && (
          <div className="control-group">
            <label>Spawn Interval (ms)</label>
            <input
              type="range"
              min="200"
              max="3000"
              step="100"
              value={settings.spawnInterval}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  spawnInterval: parseInt(e.target.value, 10),
                }))
              }
            />
            <span>{settings.spawnInterval}ms</span>
          </div>
        )}

        <div className="control-group">
          <label>Min Radius</label>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={settings.minRadius}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                minRadius: parseInt(e.target.value, 10),
              }))
            }
          />
          <span>{settings.minRadius}px</span>
        </div>

        <div className="control-group">
          <label>Max Radius</label>
          <input
            type="range"
            min="50"
            max="300"
            step="10"
            value={settings.maxRadius}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                maxRadius: parseInt(e.target.value, 10),
              }))
            }
          />
          <span>{settings.maxRadius}px</span>
        </div>

        <div className="control-group">
          <label>Expansion Speed (duration)</label>
          <input
            type="range"
            min="5000"
            max="15000"
            step="100"
            value={settings.expansionDuration}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                expansionDuration: parseInt(e.target.value, 10),
              }))
            }
          />
          <span>{settings.expansionDuration}ms</span>
        </div>

        <div className="control-group">
          <label>Min Total Duration</label>
          <input
            type="range"
            min="200"
            max="5000"
            step="100"
            value={settings.minDuration}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                minDuration: parseInt(e.target.value, 10),
              }))
            }
          />
          <span>{settings.minDuration}ms</span>
        </div>

        <div className="control-group">
          <label>Max Total Duration</label>
          <input
            type="range"
            min="200"
            max="5000"
            step="100"
            value={settings.maxDuration}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                maxDuration: parseInt(e.target.value, 10),
              }))
            }
          />
          <span>{settings.maxDuration}ms</span>
        </div>

        <div className="control-group">
          <label>Stroke Width</label>
          <input
            type="range"
            min="0.5"
            max="10"
            step="0.5"
            value={settings.strokeWidth}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                strokeWidth: parseFloat(e.target.value),
              }))
            }
          />
          <span>{settings.strokeWidth}px</span>
        </div>

        <div className="control-group">
          <label>Opacity</label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={settings.opacity}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                opacity: parseFloat(e.target.value),
              }))
            }
          />
          <span>{settings.opacity.toFixed(1)}</span>
        </div>

        <div className="control-group">
          <label>Number of Rings</label>
          <input
            type="range"
            min="1"
            max="15"
            step="1"
            value={settings.numRings}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                numRings: parseInt(e.target.value, 10),
              }))
            }
          />
          <span>{settings.numRings}</span>
        </div>

        <div className="control-group">
          <label>Ring Delay (ms)</label>
          <input
            type="range"
            min="10"
            max="1000"
            step="10"
            value={settings.ringDelayMs}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                ringDelayMs: parseInt(e.target.value, 10),
              }))
            }
          />
          <span>{settings.ringDelayMs}ms</span>
        </div>

        <div className="control-group">
          <label>Animation Stop Point</label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={settings.animationStopPoint}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                animationStopPoint: parseFloat(e.target.value),
              }))
            }
          />
          <span>{(settings.animationStopPoint * 100).toFixed(0)}%</span>
        </div>

        <div className="info">
          <p>Active effects: {effects.length}</p>
          <p>Click anywhere to spawn an effect</p>
        </div>

        <button 
          className="copy-button"
          onClick={copySettings}
        >
          {copySuccess ? '✓ Copied!' : 'Copy Settings JSON'}
        </button>
      </div>

      <div className="canvas-container" ref={containerRef} onClick={handleClick}>
        <svg width="100%" height="100%">
          {effects.map((effect) => (
            <RippleEffect
              key={effect.id}
              effect={effect}
              minRadius={settings.minRadius}
              maxRadius={settings.maxRadius}
              minDuration={settings.minDuration}
              maxDuration={settings.maxDuration}
              expansionDuration={settings.expansionDuration}
              strokeWidth={settings.strokeWidth}
              opacity={settings.opacity}
              numRings={settings.numRings}
              ringDelayMs={settings.ringDelayMs}
              animationStopPoint={settings.animationStopPoint}
            />
          ))}
        </svg>
      </div>
    </div>
  );
};

// Ripple effect component
const RippleEffect = React.memo(
  ({
    effect,
    minRadius,
    maxRadius,
    minDuration,
    maxDuration,
    expansionDuration,
    strokeWidth,
    opacity,
    numRings,
    ringDelayMs,
    animationStopPoint,
  }: {
    effect: ClickEffect;
    minRadius: number;
    maxRadius: number;
    minDuration: number;
    maxDuration: number;
    expansionDuration: number;
    strokeWidth: number;
    opacity: number;
    numRings: number;
    ringDelayMs: number;
    animationStopPoint: number;
  }) => {
    const [now, setNow] = useState(Date.now());
    const [isAnimating, setIsAnimating] = useState(true);

    // Calculate actual radius from factor and current settings
    const effectMaxRadius = minRadius + effect.radiusFactor * (maxRadius - minRadius);
    
    // Total duration is for when to clean up the effect
    const effectTotalDuration = minDuration + effect.durationFactor * (maxDuration - minDuration);

    useEffect(() => {
      let animationFrameId: number;

      const animate = () => {
        setNow(Date.now());
        animationFrameId = requestAnimationFrame(animate);
      };

      if (isAnimating) {
        animationFrameId = requestAnimationFrame(animate);
      }

      return () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
      };
    }, [isAnimating]);

    // Easing function for smooth expansion
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    // Check if all rings have reached the stop point OR total duration elapsed
    const totalElapsed = now - effect.startTime;
    const allRingsComplete = totalElapsed >= effectTotalDuration || Array.from({ length: numRings }).every((_, i) => {
      const ringStartTime = effect.startTime + (i * ringDelayMs);
      const elapsed = now - ringStartTime;
      const ringProgress = Math.min(1, elapsed / expansionDuration);
      return ringProgress >= animationStopPoint;
    });

    // Stop animation once all rings reach the stop point
    if (isAnimating && allRingsComplete) {
      setIsAnimating(false);
    }

    // Multiple rings, each independently animating from 0 to maxRadius
    // Each ring has a staggered start time based on ringDelayMs
    const rings = Array.from({ length: numRings }, (_, i) => {
      // Calculate when this ring started (in ms)
      const ringStartTime = effect.startTime + (i * ringDelayMs);
      
      // Calculate elapsed time for THIS specific ring
      const elapsed = now - ringStartTime;
      
      // If ring hasn't started yet, don't render
      if (elapsed < 0) return null;
      
      // Calculate this ring's individual progress (0-1) based on EXPANSION DURATION
      let ringProgress = Math.min(1, elapsed / expansionDuration);
      
      // STOP at the animationStopPoint (e.g., 0.5 = 50%)
      ringProgress = Math.min(ringProgress, animationStopPoint);
      
      // Each ring expands from 0 to (maxRadius * stopPoint)
      const ringRadius = effectMaxRadius * easeOutCubic(ringProgress);
      
      // Fade in at start, then stay at peak opacity
      let ringOpacity: number;
      if (ringProgress < 0.05) {
        // Fade in quickly
        ringOpacity = opacity * (ringProgress / 0.05);
      } else {
        // Stay at peak opacity (no fade out since we stop early)
        ringOpacity = opacity;
      }

      return (
        <circle
          key={i}
          cx={effect.x}
          cy={effect.y}
          r={ringRadius}
          fill="none"
          stroke={effect.color}
          strokeWidth={strokeWidth}
          opacity={Math.max(0, ringOpacity)}
          style={{ mixBlendMode: "multiply" }}
        />
      );
    });

    return <g>{rings}</g>;
  }
);

// Render the component
ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(<ClickEffectPlayground />);
