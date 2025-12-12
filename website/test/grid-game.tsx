import "../home.scss";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, withSharedState } from "@playhtml/react";

const GRID_SIZE = 10;
const CELL_SIZE = 50;

interface Position {
  x: number;
  y: number;
}

interface Player {
  id: string;
  position: Position;
  color: string;
  name: string;
}

interface Hole {
  position: Position;
  isDugUp: boolean;
  hasGold: boolean;
}

interface GameState {
  holes: Hole[];
  players: { [playerId: string]: Player };
}

// Generate initial holes with random gold placement
function generateInitialHoles(): Hole[] {
  const holes: Hole[] = [];
  const numHoles = 20;
  const usedPositions = new Set<string>();

  for (let i = 0; i < numHoles; i++) {
    let x, y;
    let posKey;
    // Find unique position
    do {
      x = Math.floor(Math.random() * GRID_SIZE);
      y = Math.floor(Math.random() * GRID_SIZE);
      posKey = `${x},${y}`;
    } while (usedPositions.has(posKey));

    usedPositions.add(posKey);
    holes.push({
      position: { x, y },
      isDugUp: false,
      hasGold: Math.random() > 0.7, // 30% chance of gold
    });
  }

  return holes;
}

// Generate random color for player
function getRandomColor(): string {
  const colors = [
    "#FF6B6B",
    "#4ECDC4",
    "#45B7D1",
    "#FFA07A",
    "#98D8C8",
    "#F7DC6F",
    "#BB8FCE",
    "#85C1E2",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Generate random starting position
function getRandomStartPosition(): Position {
  return {
    x: Math.floor(Math.random() * GRID_SIZE),
    y: Math.floor(Math.random() * GRID_SIZE),
  };
}

// Check if two positions are adjacent (including diagonals)
function isAdjacent(pos1: Position, pos2: Position): boolean {
  const dx = Math.abs(pos1.x - pos2.x);
  const dy = Math.abs(pos1.y - pos2.y);
  return dx <= 1 && dy <= 1 && (dx !== 0 || dy !== 0);
}

// Main Game Component
const GridGame = withSharedState(
  {
    defaultData: {
      holes: generateInitialHoles(),
      players: {},
    } as GameState,
  },
  ({ data, setData }) => {
    const [myPlayerId] = useState(() => `player-${Date.now()}-${Math.random()}`);
    const [selectedHole, setSelectedHole] = useState<Position | null>(null);

    // Initialize current player
    useEffect(() => {
      if (!data.players[myPlayerId]) {
        setData((draft) => {
          draft.players[myPlayerId] = {
            id: myPlayerId,
            position: getRandomStartPosition(),
            color: getRandomColor(),
            name: `Player ${Object.keys(draft.players).length + 1}`,
          };
        });
      }
    }, [myPlayerId]);

    // Handle keyboard controls for movement
    useEffect(() => {
      const handleKeyPress = (e: KeyboardEvent) => {
        const player = data.players[myPlayerId];
        if (!player) return;

        let newX = player.position.x;
        let newY = player.position.y;

        switch (e.key.toLowerCase()) {
          case "w":
          case "arrowup":
            newY = Math.max(0, newY - 1);
            break;
          case "s":
          case "arrowdown":
            newY = Math.min(GRID_SIZE - 1, newY + 1);
            break;
          case "a":
          case "arrowleft":
            newX = Math.max(0, newX - 1);
            break;
          case "d":
          case "arrowright":
            newX = Math.min(GRID_SIZE - 1, newX + 1);
            break;
          default:
            return;
        }

        if (newX !== player.position.x || newY !== player.position.y) {
          setData((draft) => {
            draft.players[myPlayerId].position = { x: newX, y: newY };
          });
        }
      };

      window.addEventListener("keydown", handleKeyPress);
      return () => window.removeEventListener("keydown", handleKeyPress);
    }, [data.players, myPlayerId]);

    // Handle hole digging
    const handleHoleClick = (hole: Hole, index: number) => {
      const player = data.players[myPlayerId];
      if (!player) return;

      // Check if hole is already dug up
      if (hole.isDugUp) {
        return;
      }

      // Check if player is adjacent to the hole
      if (!isAdjacent(player.position, hole.position)) {
        setSelectedHole(hole.position);
        setTimeout(() => setSelectedHole(null), 1000);
        return;
      }

      // Dig up the hole
      setData((draft) => {
        draft.holes[index].isDugUp = true;
      });
    };

    const myPlayer = data.players[myPlayerId];

    return (
      <div style={{ padding: "20px", fontFamily: "monospace" }}>
        <h1>Multiplayer Gold Dig Game</h1>
        <div style={{ marginBottom: "20px" }}>
          <p>
            <strong>Controls:</strong> W/A/S/D or Arrow Keys to move
          </p>
          <p>
            <strong>Goal:</strong> Click holes when adjacent to dig them up and
            find gold!
          </p>
          {myPlayer && (
            <p>
              You are{" "}
              <span
                style={{
                  color: myPlayer.color,
                  fontWeight: "bold",
                }}
              >
                {myPlayer.name}
              </span>{" "}
              at ({myPlayer.position.x}, {myPlayer.position.y})
            </p>
          )}
          <p>
            Gold found:{" "}
            {data.holes.filter((h) => h.isDugUp && h.hasGold).length} / Total
            dug: {data.holes.filter((h) => h.isDugUp).length}
          </p>
        </div>

        {/* Grid */}
        <div
          style={{
            position: "relative",
            width: GRID_SIZE * CELL_SIZE,
            height: GRID_SIZE * CELL_SIZE,
            border: "2px solid #333",
            backgroundColor: "#8B7355",
            boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
          }}
        >
          {/* Grid lines */}
          {Array.from({ length: GRID_SIZE }).map((_, i) => (
            <React.Fragment key={`grid-${i}`}>
              {/* Vertical lines */}
              <div
                style={{
                  position: "absolute",
                  left: i * CELL_SIZE,
                  top: 0,
                  width: 1,
                  height: GRID_SIZE * CELL_SIZE,
                  backgroundColor: "rgba(0,0,0,0.1)",
                }}
              />
              {/* Horizontal lines */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: i * CELL_SIZE,
                  width: GRID_SIZE * CELL_SIZE,
                  height: 1,
                  backgroundColor: "rgba(0,0,0,0.1)",
                }}
              />
            </React.Fragment>
          ))}

          {/* Holes */}
          {data.holes.map((hole, index) => (
            <div
              key={`hole-${index}`}
              onClick={() => handleHoleClick(hole, index)}
              style={{
                position: "absolute",
                left: hole.position.x * CELL_SIZE,
                top: hole.position.y * CELL_SIZE,
                width: CELL_SIZE,
                height: CELL_SIZE,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: hole.isDugUp ? "default" : "pointer",
                fontSize: "24px",
                transition: "all 0.2s",
                animation:
                  selectedHole &&
                  selectedHole.x === hole.position.x &&
                  selectedHole.y === hole.position.y
                    ? "shake 0.5s"
                    : "none",
              }}
            >
              {hole.isDugUp ? (
                <div
                  style={{
                    width: "70%",
                    height: "70%",
                    borderRadius: "50%",
                    backgroundColor: hole.hasGold ? "#FFD700" : "#666",
                    border: hole.hasGold
                      ? "3px solid #FFA500"
                      : "3px solid #444",
                    boxShadow: hole.hasGold
                      ? "0 0 10px rgba(255,215,0,0.8)"
                      : "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {hole.hasGold && <span style={{ fontSize: "16px" }}>💰</span>}
                </div>
              ) : (
                <div
                  style={{
                    width: "60%",
                    height: "60%",
                    borderRadius: "50%",
                    backgroundColor: "#654321",
                    border: "2px dashed #8B7355",
                  }}
                />
              )}
            </div>
          ))}

          {/* Players */}
          {Object.values(data.players).map((player) => (
            <div
              key={player.id}
              style={{
                position: "absolute",
                left: player.position.x * CELL_SIZE,
                top: player.position.y * CELL_SIZE,
                width: CELL_SIZE,
                height: CELL_SIZE,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                transition: "all 0.2s ease-out",
              }}
            >
              {/* Player circle */}
              <div
                style={{
                  width: "70%",
                  height: "70%",
                  borderRadius: "50%",
                  backgroundColor: player.color,
                  border: `3px solid ${
                    player.id === myPlayerId ? "#fff" : "#000"
                  }`,
                  boxShadow:
                    player.id === myPlayerId
                      ? "0 0 15px rgba(255,255,255,0.8)"
                      : "0 2px 4px rgba(0,0,0,0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                  zIndex: 10,
                }}
              >
                👤
              </div>
              {/* Player name */}
              <div
                style={{
                  position: "absolute",
                  bottom: -20,
                  fontSize: "10px",
                  fontWeight: "bold",
                  color: player.color,
                  textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                  whiteSpace: "nowrap",
                }}
              >
                {player.name}
              </div>
            </div>
          ))}
        </div>

        <style>
          {`
            @keyframes shake {
              0%, 100% { transform: translateX(0); }
              25% { transform: translateX(-5px); }
              75% { transform: translateX(5px); }
            }
          `}
        </style>
      </div>
    );
  }
);

function App() {
  return (
    <PlayProvider>
      <GridGame />
    </PlayProvider>
  );
}

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(<App />);
