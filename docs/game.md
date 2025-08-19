# PlayHTML Browser Extension - Complete Implementation Guide

## Vision: An Internet Game & Enhancement Tool

The PlayHTML Bag is a browser extension that transforms the internet into a **living, social playground**. It serves dual purposes:

1. **Utility Tool**: Turn any webpage element into interactive PlayHTML elements (`can-move`, `can-spin`, etc.)
2. **Internet Game**: A cozy, exploration-based game where players leave traces of themselves across websites and encounter others in real-time

### Core Game Experience

Players explore the internet collecting **traces of humanity** - beautiful interactions, collaborative moments, and intimate encounters with strangers. The game emphasizes:

- **Ambient multiplayer**: See other players' presence as gentle cursors and traces
- **Collective decoration**: Add interactive elements to existing pages that others can discover
- **Spontaneous intimacy**: Wordless connections through shared attention and creative expression
- **Anti-farming exploration**: Rewards come from visiting new places, not grinding the same locations

## Game Architecture

```
Player's Browser Extension (Identity + Inventory Wallet)
    ↓ (real-time presence + game state sync)
PlayHTML PartyKit Server (Cross-site coordination)
    ↓ (persistence)
Supabase Database (Game state, inventory, discoveries)

Extension ↔ Website's PlayHTML Instance (When present)
```

**Key insight**: The extension acts as a "wallet" carrying your identity and inventory between different PlayHTML "worlds" (websites).

## Core Game Mechanics

### 1. **Digital Messages & Geocaching**

Players leave discoverable content for others:

```typescript
interface DigitalMessage {
  content: string | emoji | drawing;
  triggerElement?: DOMSelector; // Hidden until you interact with specific element
  discoveryCondition: "hover" | "click" | "dwell_time" | "sequence";
  ephemeral: boolean; // Fades after X discoveries or time
  personalStyle: PlayerStyle; // Color palette, animation style, etc.
}
```

**Examples:**

- **Whispered secrets**: Hover over specific words to discover hidden messages
- **Emotional breadcrumbs**: Click sequences that reveal collaborative poems
- **Time capsules**: Messages that only appear during certain seasons
- **Chain letters**: Collaborative stories built word by word

### 2. **Cursor Trails & Guided Navigation**

Share your exploration patterns with others:

```typescript
interface CursorTrail {
  path: MousePosition[];
  style: "gentle_glow" | "sparkles" | "paint_brush" | "flowing_water";
  intention: "discovery_path" | "reading_rhythm" | "emotional_journey";
  personalSignature: PlayerStyle;
}
```

**Examples:**

- **Reading rhythm**: Natural eye movement creates gentle light trails
- **Discovery tours**: "Follow my cursor to see the most beautiful details"
- **Collaborative drawing**: Multiple trails creating shared artwork
- **Attention meditation**: Following someone's contemplative reading pattern

### 3. **Custom Element Interactions**

Transform existing page elements into personal expressions:

```typescript
interface ElementEnhancement {
  targetElement: DOMSelector;
  interaction: InteractionType;
  discoveryMechanism: "obvious" | "subtle_hint" | "completely_hidden";
  attribution: PlayerIdentity;
}
```

**Examples:**

- **Breathing images**: Photos that pulse gently when hovered
- **Sound associations**: Words that trigger ambient sounds when clicked
- **Texture memories**: Descriptions that provide haptic feedback
- **Growth animations**: Text that sprouts flowers or stars
- **Physics poetry**: Words that react with gravity/magnetism

### 4. **Warmth Spots & Presence**

Ambient traces of human attention and care:

- **Presence indicators**: Gentle glows showing where people recently spent time
- **Reading companions**: Soft shadows of others reading the same content
- **Community gardens**: Interactive elements that grow with collective attention
- **Harmony builders**: Ambient soundscapes built by community interaction

### 5. **Internet Mini-Map with Fog of War**

Discovery and exploration visualization:

```typescript
interface InternetMap {
  visitedSites: {
    [domain: string]: {
      discoveredAt: number;
      playersEncountered: number;
      itemsCollected: number;
      connectionsFound: string[]; // Links to other sites
      personalContributions: Interaction[];
    };
  };
  fogOfWar: {
    hintedSites: string[]; // Sites you've seen links to but not visited
    nearbyActivity: LiveActivity[]; // "3 players active near here"
    seasonalEvents: Event[]; // "This week: explore space-themed sites"
  };
}
```

**Features:**

- **Discovery bonuses**: Rewards for visiting new/rare sites
- **Social breadcrumbs**: See paths other players took to find sites
- **Temporal events**: Community focuses and seasonal activities
- **Neighborhood awareness**: Activity indicators for familiar domains

## Identity & Cross-Site Persistence

### Decentralized Identity System

Like MetaMask but for social gaming:

```typescript
interface PlayHTMLIdentity {
  privateKey: string; // For signing/authentication
  publicKey: string; // Cross-site recognition
  playerStyle: {
    // Personal aesthetic signature
    colorPalette: string[];
    animationStyle: "gentle" | "energetic" | "contemplative";
    interactionPatterns: Pattern[];
  };
  playerName?: string;
  createdAt: number;
  discoveredSites: string[];
}

// Export/Import for cross-device sync
function exportIdentity(): string {
  return JSON.stringify(getStoredIdentity());
}

function importIdentity(exportedData: string): void {
  const identity = JSON.parse(exportedData);
  storeIdentity(identity);
  syncInventoryFromServer(identity.publicKey);
}
```

**Benefits:**

- **No centralized login required**
- **Cross-device portability** via export/import
- **Privacy-preserving** while enabling recognition
- **Backup/recovery** through key export

### Game State Synchronization

- **Extension storage**: Local identity and recent interactions
- **PartyKit coordination**: Real-time presence and live interactions
- **Database persistence**: Long-term inventory, discoveries, and contributions

## Technical Implementation

### Project Structure

```
packages/extension/
├── src/
│   ├── manifest.json              # WebExtension Manifest v3
│   ├── background/
│   │   └── service-worker.ts      # Cross-site state, identity management
│   ├── content/
│   │   ├── content-script.ts      # PlayHTML injection and coordination
│   │   ├── element-picker.ts      # Visual element selection tool
│   │   ├── conflict-detector.ts   # Detect existing PlayHTML usage
│   │   └── presence-overlay.ts    # Show other players' presence
│   ├── popup/
│   │   ├── popup.tsx              # Main interface (@playhtml/react)
│   │   ├── inventory.tsx          # Game inventory and discoveries
│   │   ├── internet-map.tsx       # Fog of war exploration view
│   │   └── element-manager.tsx    # Site-specific element management
│   ├── devtools/
│   │   ├── panel.tsx              # Game state and element inspector
│   │   └── conflict-resolver.tsx  # PlayHTML conflict debugging
│   ├── game/
│   │   ├── identity.ts            # Player identity & key management
│   │   ├── inventory.ts           # Cross-site item management
│   │   ├── interactions.ts        # Message bottles, trails, enhancements
│   │   ├── discovery.ts           # Internet map and exploration
│   │   └── presence.ts            # Live player awareness
│   └── shared/
│       ├── messaging.ts           # Extension communication
│       ├── element-enhancer.ts    # Core element enhancement logic
│       └── conflict-detector.ts   # PlayHTML conflict handling
```

### Core Technologies

- **TypeScript + Vite**: Consistent with PlayHTML ecosystem
- **WebExtension Polyfill**: Cross-browser compatibility (Chrome, Firefox, Safari)
- **@playhtml/react**: Primary UI framework for extension interfaces
- **playhtml core**: Element enhancement for existing DOM elements
- **PartyKit integration**: Real-time coordination with existing infrastructure

### Development Workflow

```bash
# Extension-specific commands
bun dev-extension          # Development server with hot reload
bun build-extension        # Production build
bun test-extension         # Extension tests

# Integrated workspace commands
bun dev                    # All packages + extension
bun build-packages         # Build everything including extension
```

## Live Player Presence System

### Real-time Multiplayer

```typescript
interface LivePlayer {
  publicKey: string;
  currentSite: string;
  cursor: {
    position: { x: number; y: number };
    style: PlayerStyle;
    activity: "browsing" | "creating" | "discovering";
  };
  presence: {
    joinedAt: number;
    isVisible: boolean;
    interactionMode: "observing" | "collaborative";
  };
}
```

**Presence Features:**

- **Ambient awareness**: See others' cursors as gentle, non-intrusive presence
- **Synchronized activities**: Collaborative interactions (watering plants together)
- **Temporal events**: Community activities that happen in real-time
- **Cross-site following**: Discover sites through other players' journeys

### Subtle Environmental Cues

Make discovery feel magical rather than mechanical:

- **Gentle shimmer**: Text that subtly glows when hiding secrets
- **Magnetic cursor**: Gentle pull toward interactive elements
- **Ambient sound shifts**: Audio cues for hidden interactions
- **Visual breathing**: Elements that seem "alive" when they contain player additions
- **Warmth visualization**: Areas that feel "lived in" by community attention

## Collection & Inventory System

### What Players Collect

Focus on **traces of humanity** rather than arbitrary objects:

- **Interaction artifacts**: Beautiful moments captured when multiple players collaborated
- **Site signatures**: Unique "essence" of meaningful pages visited
- **Connection fossils**: Records of meaningful encounters with other players

### Anti-Farming Mechanics

Encourage exploration over grinding:

- **Domain cooldowns**: Limited collection opportunities per site per day
- **Discovery bonuses**: Higher rewards for visiting new/rare sites
- **Community validation**: Items gain value when others also find them meaningful
- **Temporal scarcity**: Some interactions only available during specific events
- **Collaborative requirements**: Best rewards require multiple players working together

## Conflict Resolution & Website Integration

### Existing PlayHTML Detection

- Should detect when visited website has already implemented playhtml and try to merge with it by layering on game interactions without affecting existing functionality. There are certain attributes that can be added that are explicitly for interacting with the game. For example, `can-take` means that the element can be taken by the player and added to their inventory.

### Website Owner Integration

Make it easy for sites to participate:

- **Zero-setup participation**: Game works on any site immediately
- **Progressive enhancement**: Better with more integration, functional without
- **Owner tools**: Simple ways to add item drops or special interactions
- **Community management**: Basic moderation tools for site owners
- **Attribution system**: Clear credit for player contributions

## Success Metrics & Engagement

### Core Metrics

- **Daily return rate**: Do players open the extension regularly?
- **Discovery rate**: Are people visiting new sites because of the game?
- **Social encounters**: Meaningful interactions with other players per session
- **Creation rate**: Player contributions that others find valuable
- **Cross-site connections**: How the game drives exploration across domains

### Engagement Loops

- **Daily rhythms**: Check neighborhood activity, discover new sites, leave traces
- **Weekly events**: Community-focused exploration themes
- **Seasonal celebrations**: Temporal events that bring players together
- **Discovery achievements**: Recognition for meaningful exploration and contribution

## Implementation Phases

### Phase 1: Foundation (Immediate)

1. **WebExtension setup** with Vite and hot reload
2. **Element picker tool** for visual DOM selection
3. **Basic capability injection** (convert elements to PlayHTML by adding attributes or custom code)
4. **Identity system** with export/import functionality
5. **Simple presence detection** showing other players on same site. Mimic Sky: Children of Light mechanic where other player only shows up when you are in close proximity. this should happen when your cursors are almost touching with a special interaction when they touch.

### Phase 2: Core Game (Next)

1. **Message bottles & digital geocaching**
2. **Cursor trails and guided navigation**
3. **Internet mini-map with fog of war**
4. **Cross-site inventory system**
5. _Basic template injection_ (inject templates from the playhtml template store\* coming soon)
6. **Real-time multiplayer presence**

### Phase 3: Rich Interactions (Future)

1. **Custom element enhancements**
2. **Warmth spots and ambient community traces**
3. **Temporal events and seasonal content**
4. **Advanced discovery mechanics**
5. **Website owner integration tools**

The PlayHTML Browser Extension creates a new layer of humanity and connection across the internet, transforming everyday browsing into opportunities for creativity, discovery, and genuine encounters with others.
