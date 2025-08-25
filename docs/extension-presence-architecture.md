# PlayHTML Extension: Proximity-Based Presence Architecture

## Overview

The PlayHTML Browser Extension needs proximity-based player presence detection (similar to Sky: Children of Light) that integrates with the existing PlayHTML ecosystem while leveraging the cursor-party foundation for cursor tracking.

## Current Infrastructure

### PlayHTML Core

- **PartyKit Server**: `partykit/party.ts` - Real-time state sync with Yjs
- **Global State**: `globalData` (Y.Map) for shared element state
- **Awareness**: `yprovider.awareness` for user presence
- **Supabase Persistence**: Long-term storage of game state

### Cursor Party

- **Dedicated cursor tracking**: https://github.com/spencerc99/cursor-party also located locally at /Users/spencerchang/Projects/cursor-party
- **Real-time cursor positions**: Optimized for cursor movement
- **Lightweight**: Focused purely on cursor/pointer interactions

### Extension Requirements

- **Cross-site identity**: Persistent player identity across domains
- **Proximity detection**: Players only visible when cursors are near each other
- **Magical encounters**: Special interactions when cursors touch
- **Site coordination**: Work with existing PlayHTML instances when present

## Architectural Challenges

### 1. **Dual Connection Problem**

- Extension needs presence on ALL sites (even without PlayHTML)
- PlayHTML instances need to coordinate with extension presence
- Avoid duplicate connections or conflicting state

### 2. **Cursor vs Game State**

- Cursor tracking needs high-frequency updates (60fps)
- Game state needs persistent, slower updates
- Different optimization needs

### 3. **Smooth Integration**

- Right now, we only support `awareness` as a general object for real-time presence information. Cursors should become a first class feature of the presence infrastructure in playhtml and allow special configuration baked into the initialization options
- Developers should be able to customize the cursor behavior, including whether it is used at all, different styles for how it is rendered, and configure custom behavior depending on the positions of themselves and other players through callbacks.

## Proposed Architecture: Unified PlayHTML + Cursor Tracking

### Phase 1: Extend PlayHTML PartyKit Server

- extend the `partykit/party.ts` to support cursors taking most of the logic from the existing `cursor-party` repo

### Phase 2: Extension Connection Strategy

- handle connecting to playhtml with the extension and enabling the cursors
- resolve any differences with sites that already are using playhtml

### Phase 3: Proximity UI Implementation

```typescript
class ProximityRenderer {
  activeCursors: Map<string, CursorElement> = new Map();
  proximityIndicators: Map<string, ProximityElement> = new Map();

  updateOtherPlayerCursor(data: CursorPositionMessage) {
    const { connectionId, x, y, playerIdentity } = data;

    let cursorElement = this.activeCursors.get(connectionId);
    if (!cursorElement) {
      cursorElement = this.createCursorElement(playerIdentity);
      this.activeCursors.set(connectionId, cursorElement);
      document.body.appendChild(cursorElement);
    }

    // Update position with smooth animation
    cursorElement.style.left = `${x}px`;
    cursorElement.style.top = `${y}px`;

    // Hide cursor if too far from our cursor
    const ourCursor = this.getOurCursorPosition();
    const distance = Math.sqrt(
      Math.pow(x - ourCursor.x, 2) + Math.pow(y - ourCursor.y, 2)
    );

    const isVisible = distance < VISIBILITY_THRESHOLD;
    cursorElement.style.opacity = isVisible ? "1" : "0";
  }

  showProximityIndicator(otherPlayer: PlayerIdentity) {
    // Create magical proximity effect
    const indicator = document.createElement("div");
    indicator.className = "playhtml-proximity-indicator";
    indicator.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 999998;
      width: 100px;
      height: 100px;
      border: 2px solid ${otherPlayer.playerStyle.colorPalette[0]};
      border-radius: 50%;
      animation: proximityPulse 2s infinite;
      background: radial-gradient(circle, transparent 70%, ${otherPlayer.playerStyle.colorPalette[0]}20);
    `;

    // Position near our cursor
    const ourPos = this.getOurCursorPosition();
    indicator.style.left = `${ourPos.x - 50}px`;
    indicator.style.top = `${ourPos.y - 50}px`;

    document.body.appendChild(indicator);
    this.proximityIndicators.set(otherPlayer.publicKey, indicator);

    // Add CSS animation if not exists
    this.addProximityStyles();
  }

  addProximityStyles() {
    if (document.getElementById("playhtml-proximity-styles")) return;

    const style = document.createElement("style");
    style.id = "playhtml-proximity-styles";
    style.textContent = `
      @keyframes proximityPulse {
        0%, 100% { transform: scale(1); opacity: 0.6; }
        50% { transform: scale(1.2); opacity: 0.9; }
      }
      
      .playhtml-proximity-indicator {
        transition: all 0.3s ease;
      }
      
      .playhtml-cursor-other {
        position: fixed;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        pointer-events: none;
        z-index: 999999;
        transition: all 0.1s ease;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
    `;
    document.head.appendChild(style);
  }
}
```

## Technical Considerations

### Performance Optimizations

- **Cursor throttling**: Limit cursor updates to 60fps max
- **Proximity culling**: Only send cursor data to nearby players
- **Connection pooling**: Reuse PartyKit connections across tabs
- **Graceful degradation**: Fallback when PartyKit unavailable
- **Cursor Interpolation**: Interpolate the cursor position to smooth out the movement
- **Spatial partitioning**: Use quadtree/spatial hash for proximity detection instead of O(n²) loops

### Privacy & Security

- **Ephemeral presence**: Cursor data not persisted
- **Domain isolation**: Presence scoped to current domain
- **Opt-out mechanisms**: Easy way to disable presence
- **Anonymous by default**: No personal data in cursor tracking

### Cross-site Coordination

- **Room naming**: Consistent strategy for room IDs across extension and PlayHTML
- **Identity bridging**: Extension identity works with PlayHTML awareness
- **Conflict resolution**: Handle multiple PlayHTML versions gracefully
