# Storage Optimization Opportunities

## ✅ Already Implemented

### 1. Coordinate Rounding (4 decimals)
**Status**: ✅ Done
- Cursor x/y: `0.5234375` → `0.5234` (6 bytes saved)
- Scroll x/y: Same treatment
- **Savings**: ~6 bytes/cursor event, ~6 bytes/scroll event

---

## 🎯 High-Impact Optimizations (Recommended)

### 2. URL Normalization & Deduplication
**Status**: ⚠️ **Easy Win - Recommended**

**Problem**: URLs are stored in EVERY event
```json
{
  "meta": {
    "url": "https://en.wikipedia.org/wiki/Machine_learning?section=5#History"
  }
}
```

**Current Cost**:
- Average URL length: ~60-100 chars
- Stored in: Every cursor, navigation, viewport event
- Per user/day: 14,400 cursor events × 80 chars = 1.15 MB just in URLs!

**Solution Options**:

#### Option A: URL Hashing (Best for scale)
```typescript
// Hash URL to short ID
function hashURL(url: string): string {
  // Use first 8 chars of base36-encoded hash
  return btoa(url).substring(0, 8); // "xK9m2pL1"
}

// Store mapping in separate table
{
  "meta": {
    "url_hash": "xK9m2pL1"  // 8 bytes vs 80+ bytes
  }
}
```

**Savings**: ~70 bytes per event = **1 MB/user/day** = **30 GB/month for 1K users**

#### Option B: Store URL only on Navigation events
```typescript
// Cursor events: omit URL (can join via session_id + timestamp)
// Navigation events: include full URL
```

**Savings**: ~60 bytes per cursor event = **830 KB/user/day**

**Recommendation**: Start with Option B (simpler), migrate to A if scale requires it.

---

### 3. Timezone Deduplication
**Status**: ⚠️ **Easy Win**

**Problem**: Timezone stored in every event
```json
{
  "meta": {
    "tz": "America/Los_Angeles"  // 20+ chars, never changes per session
  }
}
```

**Solution**: Store timezone only once per session
- First event in session: include `tz`
- Subsequent events: omit (can join via `session_id`)

**Savings**: ~20 bytes per event (after first) = **280 KB/user/day**

---

### 4. Viewport Dimensions Optimization
**Status**: ⚠️ **Medium Impact**

**Problem**: Viewport width/height stored in every event
```json
{
  "meta": {
    "vw": 1920,  // 4 bytes
    "vh": 1080   // 4 bytes
  }
}
```

**Solution**: Only store when viewport changes
- Track `lastVw` and `lastVh` in EventBuffer
- Only include when dimensions change
- Most users don't resize during a session

**Savings**: ~8 bytes per event (95% of events) = **110 KB/user/day**

---

### 5. Element Selector Optimization
**Status**: ⚠️ **Low-Medium Impact**

**Problem**: Verbose selectors
```json
{
  "t": ".some-really-long-class-name-that-developers-use"  // 40+ chars
}
```

**Current**: ID > first class > tag name

**Optimization Ideas**:
- Limit selector length: `selector.substring(0, 20)`
- Use tag name for long IDs/classes: `div` instead of `.super-long-class`
- Omit generic tags: Don't store `div`, `span` (too common, not useful)

**Savings**: ~15 bytes per cursor event = **210 KB/user/day**

---

### 6. Zoom Level Rounding
**Status**: ⚠️ **Easy Win**

**Problem**: Zoom stored as float
```json
{
  "zoom": 1.25,
  "previous_zoom": 1.0
}
```

**Solution**: Round to 2 decimals
- `zoom: 1.25` not `1.2500000001`
- Common zooms: 1.0, 1.1, 1.25, 1.5, 1.75, 2.0

**Implementation**:
```typescript
zoom: Math.round(currentZoom * 100) / 100
```

**Savings**: ~4 bytes per zoom event (low frequency)

---

### 7. ULID Optimization
**Status**: 🔍 **Consider for Future**

**Problem**: Custom ULID generation might be suboptimal
```typescript
// Current: "1705342534123-abc123def45"
// Length: ~25 chars = 25 bytes
```

**Better Options**:
- Use a proper ULID library (more compact encoding)
- Use sequential IDs per session: `{sid}-{counter}`
- Use timestamp + random 4 bytes: `${ts.toString(36)}-${rand()}`

**Savings**: ~5-10 bytes per event = **70-140 KB/user/day**

---

## 📊 Combined Impact Summary

| Optimization | Bytes/Event | Daily Savings (1 user) | Monthly (1K users) |
|-------------|-------------|----------------------|-------------------|
| 1. ✅ Coordinates (done) | 6 | 86 KB | 2.6 GB |
| 2. URL dedup | 70 | 1 MB | 30 GB |
| 3. Timezone dedup | 20 | 280 KB | 8.4 GB |
| 4. Viewport dedup | 8 | 110 KB | 3.3 GB |
| 5. Selector trim | 15 | 210 KB | 6.3 GB |
| 6. Zoom rounding | 2 | ~1 KB | ~30 MB |
| **Total** | **121 bytes** | **1.7 MB** | **51 GB** |

**Cost Impact**: At $0.125/GB/month, **1000 users** = **$6.37/month saved**

---

## 🚀 Implementation Priority

### Phase 1: Quick Wins (< 1 hour each)
1. ✅ Coordinate rounding (done)
2. Timezone deduplication
3. Zoom rounding
4. Element selector trimming

### Phase 2: Architectural (2-4 hours each)
5. URL deduplication (store only on navigation)
6. Viewport change tracking
7. ULID optimization

### Phase 3: Advanced (if scale demands)
8. URL hashing with lookup table
9. Binary protocol (MessagePack/ProtoBuf)
10. Compression at network layer

---

## 📝 Implementation Notes

### How to Test Optimizations

1. **Before**: Capture sample events, measure JSON size
   ```typescript
   const eventSize = JSON.stringify(event).length;
   console.log('Event size:', eventSize, 'bytes');
   ```

2. **After**: Compare with optimized version

3. **Validate**: Ensure visualization still works with denormalized data

### Database Migration Strategy

For URL/timezone dedup:
1. Add columns: `url_changed`, `tz_changed` (boolean flags)
2. Old events: Keep as-is (backwards compatible)
3. New events: Omit when unchanged
4. Query: JOIN on session_id for missing data

---

## 💡 When to Optimize

**Now (< 1000 users)**:
- Quick wins (Phase 1)
- Set up monitoring for data growth

**Soon (1000-10,000 users)**:
- Architectural changes (Phase 2)
- URL deduplication is critical here

**Later (> 10,000 users)**:
- Advanced optimizations (Phase 3)
- Consider data retention policies (delete old events)

---

## 🔍 Monitoring

Track these metrics:
- Average event size (bytes)
- Daily storage growth (MB/day)
- Events per user per day
- Database size growth rate

Alert when:
- Event size > 200 bytes (investigate bloat)
- Daily growth > 100 MB/1K users
