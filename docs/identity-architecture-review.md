# Identity & Permissions Architecture Review

## System Overview

The identity system adds cryptographic identity and role-based permissions to playhtml. Here's how it flows:

```
┌─────────────────────────────────────────────────────────────┐
│  Client (Browser)                                           │
│                                                             │
│  1. Identity generated (Ed25519 / RSA-PSS fallback)         │
│  2. Stored in localStorage as plaintext JSON                │
│  3. On page load: initializeAuth() → establish session      │
│     via WebSocket challenge-response                        │
│  4. On write: checkPermission() → create SessionAction      │
│     → send to server → optimistic CRDT update               │
│                                                             │
│  Permissions resolved via:                                  │
│    - Global roles (InitOptions.roles)                       │
│    - Element-level attrs (playhtml-permissions="write:owner")│
│    - Custom condition functions (permissionConditions)       │
└────────────────────────────────┬────────────────────────────┘
                                 │ WebSocket
┌────────────────────────────────▼────────────────────────────┐
│  Server (PartyKit)                                          │
│                                                             │
│  - Validates session establishment (verifySignature)        │
│  - Stores sessions in-memory (Map<sessionId, session>)      │
│  - Validates SessionActions (session, nonce, timestamp)     │
│  - Broadcasts validated actions                             │
│  - Hourly cleanup of expired sessions                       │
└─────────────────────────────────────────────────────────────┘
```

## Security Analysis

### What works well

1. **Cryptographic foundation is sound.** Ed25519 with RSA-PSS fallback is the right approach. The Web Crypto API is used correctly for key generation, signing, and verification.

2. **Replay protection exists.** Nonce tracking + 5-minute timestamp windows on both `SignedAction` and `SessionAction` prevent replay attacks.

3. **Session model is reasonable.** Challenge-response over WebSocket, 24-hour sessions with auto-renewal, server-side session validation.

### Security concerns

#### 1. Private keys stored as plaintext in localStorage (Critical)

```typescript
// packages/playhtml/src/auth.ts:112-127
export function storeIdentity(identity: PlayHTMLIdentity): void {
  const exported = exportIdentity(identity);
  localStorage.setItem("playhtml_identity", exported);
}
```

```typescript
// packages/playhtml/src/crypto.ts:209-216
export function exportIdentity(identity: PlayHTMLIdentity, password?: string): string {
  if (password) {
    console.warn("Password encryption not yet implemented, exporting as plain text");
  }
  return JSON.stringify(identity, null, 2);
}
```

The private key is stored as a plain JSON string in localStorage. Any XSS vulnerability on the page (or any browser extension) can exfiltrate it. This is the single largest security risk in the system.

**Recommendation:** Use the Web Crypto API's non-extractable keys. Instead of storing exported key material, store the `CryptoKey` objects in IndexedDB (they're structured-clonable). The private key never needs to leave the browser's crypto subsystem. This eliminates the entire class of key-exfiltration attacks.

```typescript
// Instead of exporting the private key:
const keyPair = await crypto.subtle.generateKey(
  { name: "Ed25519" },
  false, // <-- NOT extractable
  ["sign", "verify"]
);
// Store CryptoKey in IndexedDB, never as base64 string
```

This is a fundamental change but it's the right one. The current `exportIdentity` / `importIdentity` flow that round-trips through JSON should be replaced.

#### 2. Client generates its own session challenge (Medium)

```typescript
// packages/playhtml/src/auth.ts:356-447
export async function establishSessionWithWS(identity, ws) {
  const challenge = generateSessionChallenge(); // CLIENT generates
  signMessage(JSON.stringify(challenge), identity.privateKey, ...)
    .then((signature) => {
      ws.send(JSON.stringify({ type: "session_establish", challenge, signature, publicKey }));
    });
}
```

The client generates its own challenge and signs it. The server (`party.ts:652-736`) verifies the signature is valid for the provided challenge but **never checks that it issued the challenge**. This means the client is proving "I can sign things with this key" but the server has no way to bind the session to a specific authentication moment. A leaked signed challenge could be replayed to establish a new session.

**Recommendation:** The server should generate the challenge and send it to the client. The client signs and returns it. This is standard challenge-response:

```
Client → Server: "I want to authenticate as <publicKey>"
Server → Client: { challenge: randomUUID(), expiresAt: ... }
Client → Server: { signature: sign(challenge), publicKey }
Server: verify(challenge, signature, publicKey) → issue session
```

#### 3. Permission checks are client-side only (Medium)

```typescript
// packages/playhtml/src/index.ts:867
const hasPermission = await checkPermission(elementId, "write", identity);
if (!hasPermission) {
  console.warn(`Permission denied...`);
  return;
}
```

Permission checks happen in the browser. The server validates that a session is valid and the action format is correct (`handleSessionAction`), but it **never checks whether the session's user actually has permission for the action on that element**. A modified client can skip the `checkPermission` call entirely and write directly to the CRDT.

The CRDT updates flow through Yjs/SyncedStore which has no authorization layer. The `SessionAction` validation on the server broadcasts a `session_action_validated` message but doesn't actually gate the CRDT write.

**Recommendation:** For the MVP, this is probably acceptable—playhtml is a playful, collaborative library and the threat model is low. But it should be documented clearly that permissions are **advisory, not enforced**. If server-side enforcement is needed later, the CRDT writes would need to go through an authorization middleware on the server.

#### 4. Nonce set grows unbounded in memory (Low)

```typescript
// partykit/party.ts:789-790
this.usedNonces.add(nonceKey);
// ...
setTimeout(() => this.usedNonces.delete(nonceKey), 5 * 60 * 1000);
```

Each nonce spawns a separate `setTimeout`. Under high load, this creates many timers. A simple improvement: use a single interval that sweeps nonces older than 5 minutes, or use a Map with timestamps.

---

## Architectural Simplification Opportunities

### 1. Remove the dual SignedAction / SessionAction system

The codebase has two parallel authentication mechanisms:

- **SignedAction** (`crypto.ts:135-169`): Signs every individual action with the private key
- **SessionAction** (`auth.ts:508-525`): Uses a session ID established via challenge-response

The code currently uses SessionAction when a session exists and falls back... except `createSignedAction` and `createAuthenticatedMessage` are exposed on the `playhtml.auth` API but never actually used in the core write path (`index.ts:876-933`). The write path only uses `createSessionAction`.

**Recommendation:** Pick one approach. SessionAction is the better choice (one signature to establish session, then lightweight actions). Remove `SignedAction`, `AuthenticatedMessage`, `createSignedAction`, `createAuthenticatedMessage`, and `verifySignedAction` from the public API. This cuts ~70 lines of crypto code and eliminates confusion about which to use.

### 2. Consolidate duplicated `verifySignature` implementations

There are three copies of signature verification:

- `packages/common/src/auth.ts:157-197` — the canonical shared version
- `packages/playhtml/src/crypto.ts:131-132` — re-exports from common
- `partykit/__tests__/auth.test.ts:33-98` — a full copy-paste for testing

And two copies of `base64ToArrayBuffer` and `importPublicKey`:
- `packages/common/src/auth.ts:127-154`
- `packages/playhtml/src/crypto.ts:8-24, 92-106`

**Recommendation:** The common package already has the canonical `verifySignature`. Remove the duplicate `importPublicKey` and `base64ToArrayBuffer` from `crypto.ts`. The test file should import from common rather than re-implementing.

### 3. Simplify the role/permission configuration model

The current model has three layers that interact in non-obvious ways:

```
Layer 1: GlobalRoleDefinition (InitOptions.roles)
  - Maps role names → public key arrays OR { condition: string }

Layer 2: PermissionConfig (element attribute: playhtml-permissions)
  - Maps actions → required role names ("write:owner, delete:moderators")

Layer 3: PermissionFunction (InitOptions.permissionConditions)
  - Named functions for conditional role evaluation
```

The indirection is: to grant "write" on an element, you need to:
1. Know which role is required for "write" (from the element attribute)
2. Know if the user has that role (from global roles config)
3. If the role uses a condition, evaluate it (from permission conditions)

This is flexible but hard to reason about, especially for developers without deep experience. The auth example (`auth-example.html`) demonstrates this complexity—it takes 50+ lines of configuration to set up basic roles.

**Recommendation:** Consider a simpler two-tier model:

```html
<!-- Tier 1: Element declares WHO can do WHAT -->
<div id="my-element" can-move
     playhtml-write="owner, contributors"
     playhtml-delete="owner">
```

```javascript
// Tier 2: Site declares WHO is WHO
playhtml.init({
  roles: {
    owner: ["<public-key>"],
    contributors: { condition: "frequentVisitor" }
  },
  conditions: {
    frequentVisitor: (ctx) => ctx.visitCount >= 5
  }
});
```

This eliminates the middle `PermissionConfig` layer and makes the HTML attributes directly reference role names. The mapping from `action → role → user` collapses to `action → roles (on element) → user check (global)`.

### 4. The `PermissionContext` carries too much ambient state

```typescript
export interface PermissionContext {
  user?: PlayHTMLIdentity;
  element: HTMLElement;
  domain: string;
  visitCount: number;
  timeOfDay: number;
  userLocation?: { lat: number; lng: number };
  siteLocation?: { lat: number; lng: number };
  customData: Record<string, any>;
}
```

`timeOfDay`, `userLocation`, `siteLocation` are speculative fields that aren't populated by the implementation (`buildPermissionContext` in `auth.ts:314-331` doesn't set location). The visit counter increments on every permission check call, not on actual page visits.

**Recommendation:** Strip the context to what's actually used:

```typescript
export interface PermissionContext {
  user?: PlayHTMLIdentity;
  element: HTMLElement;
  domain: string;
  customData: Record<string, any>;
}
```

Let developers add `timeOfDay`, `visitCount`, or geolocation through `customData` if they need it. This makes the interface honest about what's provided and avoids the misleading visit counter behavior.

### 5. Remove dead code paths

- `getVisitCount()` in `auth.ts:222-231` increments a counter on every call to `buildPermissionContext`, not on actual visits. It's called during `getUserRolesForElement` which can be called many times per page load.
- `getElementCustomData()` in `auth.ts:233-240` reads a `playhtml-custom-data` attribute that nothing sets.
- `establishSession()` in `auth.ts:451-463` always throws an error ("Session establishment must be called through PlayHTML main module"). It exists only to be dead code.
- The `password` parameter in `exportIdentity`/`importIdentity` does nothing.

### 6. The React `usePlayHTMLPermissions` hook has issues

```typescript
// packages/react/src/hooks/usePlayHTMLPermissions.ts:85
}, [elementId, allActions.join(',')]);
```

- The `allActions` array is recreated every render, so `allActions.join(',')` creates a new string each time if `customActions` changes reference. This could cause unnecessary re-renders.
- The hook uses `@ts-ignore` three times to access `playhtml.auth`, suggesting the React package's types aren't aligned with the core package's auth exports.
- Default permissions (`canRead: true, canWrite: true`) are optimistic—they assume access until proven otherwise. For a security-sensitive feature, denying by default until checks complete would be safer.

### 7. Session renewal calls a function that always throws

```typescript
// packages/playhtml/src/auth.ts:480
await establishSession(identity); // This function always throws!
```

The `scheduleSessionRenewal` function calls `establishSession` which unconditionally throws. Session renewal is broken.

---

## Developer Ergonomics

### What's good

1. **HTML attribute-based permissions** are intuitive: `playhtml-permissions="write:owner"` reads naturally.
2. **Global role configuration in `init()`** is a clean entry point.
3. **Auto-identity creation** with `createNewIdentity()` is simple for getting started.
4. **The React `PermissionProps`** let you pass `owner` and `permissions` directly to components.

### What could be simpler

1. **Automatic identity generation for anonymous users.** Currently, if no identity exists, the user runs in "read-only mode." For a playful library, consider auto-generating an ephemeral identity for every visitor so they can always interact. Make the distinction between "has persistent identity" and "is anonymous" rather than "has identity" vs "no identity."

2. **The auth example is intimidating.** The `auth-example.html` requires understanding public keys, role definitions, condition functions, and session management to set up basic owner-only permissions. Consider a simpler default:

   ```html
   <!-- Just works: only the page author can modify -->
   <div can-move playhtml-owner="me">Protected</div>
   ```

   Where `"me"` is resolved to the current identity's public key. The current system requires knowing and hardcoding public keys upfront.

3. **Too many exports on `playhtml.auth`.** The API surface is:
   - `getCurrentIdentity`, `checkPermission`, `onAuthReady`, `createSignedAction`, `createAuthenticatedMessage`, `createNewIdentity`, `configureGlobalPermissions`, `getCurrentSession`, `establishSession`

   Most developers need: `createNewIdentity`, `getCurrentIdentity`, `checkPermission`. The rest are implementation details. Consider a smaller public API.

4. **No way to get "my roles" as a developer.** You can check individual permissions but there's no simple `getMyRoles()` that returns `["owner", "contributor"]`. This would make conditional UI rendering much simpler.

---

## Summary of Recommendations (Priority Order)

| Priority | Item | Effort |
|----------|------|--------|
| **High** | Use non-extractable CryptoKeys (IndexedDB) instead of plaintext localStorage | Medium |
| **High** | Make challenge-response server-initiated | Low |
| **High** | Remove dual SignedAction/SessionAction (keep SessionAction only) | Low |
| **High** | Fix session renewal (calls function that always throws) | Low |
| **Medium** | Consolidate duplicated crypto code | Low |
| **Medium** | Document that permissions are client-side advisory only | Low |
| **Medium** | Simplify PermissionContext to actually-used fields | Low |
| **Medium** | Simplify role/permission model to two tiers | Medium |
| **Medium** | Remove dead code (throwing `establishSession`, unused password params, broken visit counter) | Low |
| **Low** | Fix React hook dependency array and default permissions | Low |
| **Low** | Auto-generate ephemeral identities for anonymous users | Low |
| **Low** | Reduce `playhtml.auth` public API surface | Low |
| **Low** | Add `getMyRoles()` helper for UI rendering | Low |
