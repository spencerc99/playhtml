# Shared Elements Testing Guide

## Setup Instructions

### 1. Build the packages first
```bash
bun build-packages
```

### 2. Start the PartyKit server
```bash
bun dev-server
# Should start on localhost:1999
```

### 3. Start the main website (Source)
```bash
bun dev
# Should start on localhost:5173
```

### 4. Start a consumer server on different port
In a new terminal:
```bash
cd website
npx serve . -p 3000
# OR use python: python -m http.server 3000
# OR use any other static server on port 3000
```

## Testing Steps

### Phase 1: Basic Same-Domain Sharing
1. Open `localhost:5173/shared-test-source.html` 
2. Open `localhost:5173/shared-test-consumer.html` in another tab
3. Verify console shows shared element discovery
4. Test that elements sync within same domain

### Phase 2: Cross-Domain Reference Testing  
1. Open `localhost:5173/shared-test-source.html` (source)
2. Open `localhost:3000/shared-test-consumer.html` (consumer)
3. Check console logs for:
   - Source: "Found X shared elements"
   - Consumer: "Found X shared references"
   - PartyKit logs showing registration and access requests

### Expected Behavior

#### ✅ Should Work:
- Global shared counter syncs between different ports
- Read-only elements update on consumer when changed on source
- Console shows successful shared element registration
- Console shows successful shared element access requests

#### ❌ Should Fail (Expected):
- Domain-scoped elements should be denied access across ports
- Read-only elements should reject writes from consumer

## Debugging

### Browser Console
- Check for `[PLAYHTML]` logs showing element discovery
- Check for `[MAIN-PARTY]` logs in PartyKit dev server
- Check for `[SHARED-PARTY]` logs in PartyKit dev server

### Common Issues
1. **CORS errors**: Make sure both ports are serving from the same origin (localhost)
2. **Build issues**: Run `bun build-packages` if changes aren't reflected
3. **PartyKit not running**: Ensure `bun dev-server` is running on port 1999
4. **Import errors**: Check that the built packages are accessible

### Next Steps
Once basic functionality works:
1. Test with can-move elements (drag and drop sync)
2. Test with custom can-play elements
3. Test permission enforcement
4. Test error handling for missing elements