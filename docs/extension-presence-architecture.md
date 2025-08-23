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
- **Dedicated cursor tracking**: https://github.com/spencerc99/cursor-party
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

### 3. **Progressive Enhancement**
- Sites without PlayHTML should still have basic presence
- Sites with PlayHTML should get full game features
- Smooth upgrade path when PlayHTML is added to a site

## Proposed Architecture: Unified PlayHTML + Cursor Tracking

### Phase 1: Extend PlayHTML PartyKit Server

```typescript
// partykit/party.ts - Enhanced with cursor tracking
export default class PlayHTMLPartyServer implements Party.Server {
  // Existing PlayHTML functionality
  ydoc: Y.Doc
  yprovider: any
  
  // New cursor tracking functionality  
  cursors: Map<string, CursorState> = new Map()
  proximityPairs: Set<string> = new Set() // Track who's near whom
  
  onMessage(message: string, sender: Party.Connection) {
    const data = JSON.parse(message)
    
    if (data.type === 'cursor-update') {
      this.handleCursorUpdate(sender, data)
    } else if (data.type === 'yjs-update') {
      this.handleYjsUpdate(sender, data)
    }
    // ... existing handlers
  }
  
  handleCursorUpdate(sender: Party.Connection, data: CursorUpdateMessage) {
    const { x, y, playerIdentity } = data
    
    // Update cursor state
    this.cursors.set(sender.id, {
      x, y, 
      playerIdentity,
      lastSeen: Date.now(),
      connectionId: sender.id
    })
    
    // Check proximity with other cursors
    this.checkProximity(sender.id)
    
    // Broadcast only to nearby players (optimization)
    this.broadcastToNearby(sender.id, {
      type: 'cursor-position',
      connectionId: sender.id,
      x, y, 
      playerIdentity
    })
  }
  
  checkProximity(connectionId: string) {
    const cursor = this.cursors.get(connectionId)
    if (!cursor) return
    
    for (const [otherId, otherCursor] of this.cursors) {
      if (otherId === connectionId) continue
      
      const distance = Math.sqrt(
        Math.pow(cursor.x - otherCursor.x, 2) + 
        Math.pow(cursor.y - otherCursor.y, 2)
      )
      
      const pairKey = [connectionId, otherId].sort().join('-')
      const wasNear = this.proximityPairs.has(pairKey)
      const isNear = distance < PROXIMITY_THRESHOLD
      
      if (!wasNear && isNear) {
        // Players just came into proximity
        this.proximityPairs.add(pairKey)
        this.notifyProximityEntered(connectionId, otherId)
      } else if (wasNear && !isNear) {
        // Players just left proximity  
        this.proximityPairs.delete(pairKey)
        this.notifyProximityLeft(connectionId, otherId)
      }
    }
  }
}
```

### Phase 2: Extension Connection Strategy

```typescript
// Extension content script
class PlayHTMLExtension {
  partyConnection: PartySocket | null = null
  isPlayHTMLSite: boolean = false
  roomId: string
  
  async init() {
    // Detect existing PlayHTML on page
    this.isPlayHTMLSite = this.detectExistingPlayHTML() > 0
    
    // Determine room strategy
    if (this.isPlayHTMLSite) {
      // Join existing PlayHTML room
      this.roomId = this.extractPlayHTMLRoomId() || this.generateRoomId()
    } else {
      // Create extension-only room for this domain
      this.roomId = `extension-${window.location.hostname}`
    }
    
    await this.connectToPartyKit()
    this.setupCursorTracking()
    this.setupProximityHandlers()
  }
  
  async connectToPartyKit() {
    this.partyConnection = new PartySocket({
      host: PARTYKIT_HOST,
      room: this.roomId,
      id: this.playerIdentity.publicKey
    })
    
    this.partyConnection.addEventListener('message', this.handlePartyMessage.bind(this))
  }
  
  setupCursorTracking() {
    let lastCursorUpdate = 0
    const CURSOR_THROTTLE = 16 // ~60fps
    
    document.addEventListener('mousemove', (e) => {
      const now = Date.now()
      if (now - lastCursorUpdate < CURSOR_THROTTLE) return
      
      lastCursorUpdate = now
      this.sendCursorUpdate(e.clientX, e.clientY)
    })
  }
  
  sendCursorUpdate(x: number, y: number) {
    if (!this.partyConnection) return
    
    this.partyConnection.send(JSON.stringify({
      type: 'cursor-update',
      x, y,
      playerIdentity: this.playerIdentity,
      timestamp: Date.now(),
      url: window.location.href
    }))
  }
  
  handlePartyMessage(event) {
    const data = JSON.parse(event.data)
    
    switch (data.type) {
      case 'proximity-entered':
        this.showProximityIndicator(data.otherPlayer)
        break
      case 'proximity-left': 
        this.hideProximityIndicator(data.otherPlayer)
        break
      case 'cursor-position':
        this.updateOtherPlayerCursor(data)
        break
    }
  }
}
```

### Phase 3: Proximity UI Implementation

```typescript
class ProximityRenderer {
  activeCursors: Map<string, CursorElement> = new Map()
  proximityIndicators: Map<string, ProximityElement> = new Map()
  
  updateOtherPlayerCursor(data: CursorPositionMessage) {
    const { connectionId, x, y, playerIdentity } = data
    
    let cursorElement = this.activeCursors.get(connectionId)
    if (!cursorElement) {
      cursorElement = this.createCursorElement(playerIdentity)
      this.activeCursors.set(connectionId, cursorElement)
      document.body.appendChild(cursorElement)
    }
    
    // Update position with smooth animation
    cursorElement.style.left = `${x}px`
    cursorElement.style.top = `${y}px`
    
    // Hide cursor if too far from our cursor
    const ourCursor = this.getOurCursorPosition()
    const distance = Math.sqrt(
      Math.pow(x - ourCursor.x, 2) + Math.pow(y - ourCursor.y, 2)
    )
    
    const isVisible = distance < VISIBILITY_THRESHOLD
    cursorElement.style.opacity = isVisible ? '1' : '0'
  }
  
  showProximityIndicator(otherPlayer: PlayerIdentity) {
    // Create magical proximity effect
    const indicator = document.createElement('div')
    indicator.className = 'playhtml-proximity-indicator'
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
    `
    
    // Position near our cursor
    const ourPos = this.getOurCursorPosition()
    indicator.style.left = `${ourPos.x - 50}px`
    indicator.style.top = `${ourPos.y - 50}px`
    
    document.body.appendChild(indicator)
    this.proximityIndicators.set(otherPlayer.publicKey, indicator)
    
    // Add CSS animation if not exists
    this.addProximityStyles()
  }
  
  addProximityStyles() {
    if (document.getElementById('playhtml-proximity-styles')) return
    
    const style = document.createElement('style')
    style.id = 'playhtml-proximity-styles'
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
    `
    document.head.appendChild(style)
  }
}
```

## Migration Strategy

### Short Term (Extension v0.1)
1. **Reuse Cursor Party**: Connect extension directly to cursor-party for basic presence
2. **Separate from PlayHTML**: Extension operates independently
3. **Focus on proximity**: Get the core interaction working

### Medium Term (Extension v0.2 + PlayHTML v2.3)
1. **Merge cursor-party into PlayHTML**: Add cursor tracking to PlayHTML PartyKit server
2. **Extension connects to PlayHTML**: Use unified connection strategy
3. **Backward compatibility**: Support sites with old PlayHTML versions

### Long Term (PlayHTML v3.0)
1. **Cursor tracking as core feature**: All PlayHTML instances have cursor awareness
2. **Extension enhances**: Extension adds cross-site identity and game mechanics
3. **Unified ecosystem**: Seamless experience across all sites

## Technical Considerations

### Performance Optimizations
- **Cursor throttling**: Limit cursor updates to 60fps max
- **Proximity culling**: Only send cursor data to nearby players
- **Connection pooling**: Reuse PartyKit connections across tabs
- **Graceful degradation**: Fallback when PartyKit unavailable

### Privacy & Security
- **Ephemeral presence**: Cursor data not persisted
- **Domain isolation**: Presence scoped to current domain
- **Opt-out mechanisms**: Easy way to disable presence
- **Anonymous by default**: No personal data in cursor tracking

### Cross-site Coordination
- **Room naming**: Consistent strategy for room IDs across extension and PlayHTML
- **Identity bridging**: Extension identity works with PlayHTML awareness
- **Conflict resolution**: Handle multiple PlayHTML versions gracefully

## Next Steps

1. **Prototype cursor integration**: Add basic cursor tracking to existing PlayHTML PartyKit
2. **Extension connection**: Implement PartyKit connection in extension content script  
3. **Proximity detection**: Build the core proximity algorithms
4. **Visual effects**: Create the magical proximity indicators
5. **Performance testing**: Optimize for real-world usage

This architecture provides a clear path from the current separate systems toward a unified, magical presence system that makes the internet feel more alive and connected.