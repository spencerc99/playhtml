8.# PlayHTML Authentication & Identity System Design

## Overview

A **lightweight, decentralized identity system** that works seamlessly between the browser extension and core PlayHTML library. Like MetaMask for social web interactions, providing permissioned access to PlayHTML elements across the internet without requiring traditional login systems.

## Core Architecture

### 1. Identity Generation & Storage

**Hosted Web Interface** (`auth.playhtml.fun`):

```typescript
interface PlayHTMLIdentity {
  privateKey: string; // Ed25519 private key for signing
  publicKey: string; // Public identity (like MetaMask address)
  displayName?: string; // Human-readable name
  avatar?: string; // Custom avatar/cursor style
  createdAt: number; // Identity creation timestamp
  version: number; // For future migrations
}

// Key generation using Web Crypto API
async function generateIdentity(
  displayName?: string
): Promise<PlayHTMLIdentity> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519", namedCurve: "Ed25519" },
    true,
    ["sign", "verify"]
  );

  const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const publicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);

  return {
    privateKey: arrayBufferToBase64(privateKey),
    publicKey: arrayBufferToBase64(publicKey),
    displayName,
    createdAt: Date.now(),
    version: 1,
  };
}
```

**Export/Import for Portability**:

```typescript
// Export identity as encrypted JSON file
function exportIdentity(identity: PlayHTMLIdentity, password?: string): string {
  const data = password ? encrypt(identity, password) : identity;
  return JSON.stringify(data, null, 2);
}

// Import from file with password recovery
function importIdentity(jsonData: string, password?: string): PlayHTMLIdentity {
  const parsed = JSON.parse(jsonData);
  return password ? decrypt(parsed, password) : parsed;
}
```

### 2. Extension Integration

**Global Identity Injection**:

```typescript
// Extension injects identity into page context
interface PlayHTMLAuth {
  identity?: PlayHTMLIdentity;
  isAuthenticated: boolean;
  sign: (message: string) => Promise<string>;
  verify: (
    message: string,
    signature: string,
    publicKey: string
  ) => Promise<boolean>;
}

// Global object available to all PlayHTML instances
declare global {
  interface Window {
    playhtmlAuth?: PlayHTMLAuth;
  }
}

// Content script automatically injects authenticated identity
function injectAuth() {
  const identity = getStoredIdentity(); // From extension storage

  window.playhtmlAuth = {
    identity,
    isAuthenticated: !!identity,
    sign: async (message) => signMessage(message, identity.privateKey),
    verify: async (message, signature, publicKey) =>
      verifySignature(message, signature, publicKey),
  };

  // Dispatch event so PlayHTML can react to auth changes
  window.dispatchEvent(
    new CustomEvent("playhtmlAuthReady", { detail: window.playhtmlAuth })
  );
}
```

### 3. Clean HTML Permission System

**HTML Attributes - Keep It Simple**:

```html
<!-- Basic owner-only permissions -->
<div
  id="admin-panel"
  can-play
  playhtml-owner="spencer.place"
  playhtml-permissions="write:owner, delete:owner"
></div>

<!-- Role-based permissions -->
<div
  id="community-board"
  can-move
  playhtml-owner="spencer.place"
  playhtml-permissions="write:contributors, delete:moderators"
></div>

<!-- Multiple actions with different roles -->
<div
  id="guestbook"
  can-play
  playhtml-owner="spencer.place"
  playhtml-permissions="read:everyone, write:visitors, moderate:moderators, delete:owner"
></div>

<!-- No restrictions = everyone can do everything -->
<div id="public-canvas" can-move can-spin playhtml-owner="spencer.place"></div>
```

**React Component Props**:

```tsx
// React components use props instead of HTML attributes
function MyGuestbook() {
  return (
    <CanPlay
      id="guestbook"
      owner="spencer.place"
      permissions={{
        read: "everyone",
        write: "visitors",
        moderate: "moderators",
        delete: "owner",
      }}
    >
      {/* guestbook content */}
    </CanPlay>
  );
}

// Alternative object syntax for complex permissions
function ComplexElement() {
  return (
    <CanPlay
      id="advanced-element"
      owner="spencer.place"
      permissions={[
        { action: "read", role: "everyone" },
        { action: "write", role: "contributors", condition: "frequentVisitor" },
        { action: "delete", role: "moderators" },
        { action: "admin", role: "owner" },
      ]}
    >
      {/* element content */}
    </CanPlay>
  );
}
```

### 4. JavaScript Configuration System

**Global PlayHTML Configuration**:

### 5. Automatic Signing & Server Validation

**Client-Side Automatic Signing**:

```typescript
// Enhanced setData with automatic authentication
async function setData(
  elementId: string,
  newData: any,
  options: { action?: string } = {}
) {
  const action = options.action || "write"; // Default action

  if (window.playhtmlAuth?.identity) {
    try {
      // Check permissions first
      const hasPermission = await checkPermission(
        elementId,
        action,
        window.playhtmlAuth.identity
      );

      if (!hasPermission) {
        throw new Error("Permission denied");
      }

      // Automatically sign the data change
      const signedChange = await createSignedAction(
        action,
        elementId,
        newData,
        window.playhtmlAuth.identity
      );

      // Apply to CRDT with temporary auth data
      applyDataChange({
        type: "crdt_update",
        elementId,
        data: {
          ...newData,
          _temp_auth: signedChange,
        },
      });
    } catch (error) {
      console.error("Failed to perform action:", error);
      showUserFeedback(`Unable to ${action}: ${error.message}`);
    }
  } else {
    // No identity - check if action is allowed for "everyone"
    const hasPermission = await checkPermission(elementId, action);

    if (hasPermission) {
      // Apply change without authentication
      applyDataChange({
        type: "crdt_update",
        elementId,
        data: newData,
      });
    } else {
      showUserFeedback("Please connect your PlayHTML identity to interact");
    }
  }
}

async function createSignedAction(
  action: string,
  elementId: string,
  data: any,
  identity: PlayHTMLIdentity
): Promise<SignedAction> {
  const payload = {
    action,
    elementId,
    data,
    timestamp: Date.now(),
    nonce: crypto.randomUUID(),
  };

  const message = JSON.stringify(payload);
  const signature = await signMessage(message, identity.privateKey);

  return {
    ...payload,
    signature,
    publicKey: identity.publicKey,
  };
}
```

**Server-Side Session & Renewal Management**:

```typescript
// Enhanced PartyKit server with session renewal support
export default class SessionValidatedPlayHTML implements PartyKitServer {
  private validSessions = new Map<string, ValidatedSession>();
  private pendingChallenges = new Map<string, SessionChallenge>();
  private usedNonces = new Set<string>();

  // Session establishment with renewal support
  async handleSessionEstablishment(request: Request): Response<Response> {
    const { challenge, signature, publicKey } = await request.json();

    // Validate challenge exists and signature is correct (ONLY crypto verification)
    const storedChallenge = this.pendingChallenges.get(challenge.challenge);
    if (!storedChallenge || storedChallenge.expiresAt < Date.now()) {
      return new Response('Invalid or expired challenge', { status: 400 });
    }

    const isValidSignature = await verifySignature(
      JSON.stringify(challenge),
      signature,
      publicKey
    );

    if (!isValidSignature) {
      return new Response('Invalid signature', { status: 400 });
    }

    // Check if this is a renewal (user already has active session)
    const existingSession = this.findExistingSession(publicKey);

    if (existingSession) {
      // Extend existing session instead of creating new one
      existingSession.expiresAt = Date.now() + (24 * 60 * 60 * 1000);

      console.log(`🔄 Renewed session for ${publicKey}`);

      return new Response(JSON.stringify({
        sessionId: existingSession.sessionId, // Keep same session ID
        publicKey: existingSession.publicKey,
        expiresAt: existingSession.expiresAt,
        renewed: true
      }));
    } else {
      // Create new session
      const session: ValidatedSession = {
        sessionId: crypto.randomUUID(),
        publicKey,
        domain: challenge.domain,
        establishedAt: Date.now(),
        expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
        permissions: await this.getUserPermissions(publicKey, challenge.domain)
      };

      this.validSessions.set(session.sessionId, session);
      this.pendingChallenges.delete(challenge.challenge);

      console.log(`✅ New session established for ${publicKey}`);

      return new Response(JSON.stringify({
        sessionId: session.sessionId,
        publicKey: session.publicKey,
        expiresAt: session.expiresAt,
        renewed: false
      }));
    }
  }

  private findExistingSession(publicKey: string): ValidatedSession | null {
    for (const session of this.validSessions.values()) {
      if (session.publicKey === publicKey && session.expiresAt > Date.now()) {
        return session;
      }
    }
    return null;
  }

  // Message handling with simplified session validation
  async onMessage(message: string, sender: Party.Connection) {
    try {
      const parsed = JSON.parse(message);

      if (parsed.type === "session_action") {
        await this.handleSessionAction(parsed.action, sender);
      } else {
        await this.handleAnonymousAction(parsed, sender);
      }
    } catch (error) {
      console.error("Message processing error:", error);
      sender.send(JSON.stringify({
        type: "action_rejected",
        reason: error.message
      }));
    }
  }

  private async handleSessionAction(action: SimpleAction, sender: Party.Connection) {
    // 1. Validate session exists and is not expired
    const session = this.validSessions.get(action.sessionId);
    if (!session || session.expiresAt < Date.now()) {
      throw new Error('Invalid or expired session');
    }

    // 2. Basic action validation (no signature verification needed)
    if (!this.isValidAction(action)) {
      throw new Error('Invalid action format');
    }

    // 3. Check nonce uniqueness (prevent replay attacks)
    const nonceKey = `${action.sessionId}:${action.nonce}`;
    if (this.usedNonces.has(nonceKey)) {
      throw new Error('Duplicate action detected');
    }

    // 4. Check user permissions
    const hasPermission = await this.checkUserPermission(
      session.publicKey,
      action.elementId,
      action.action
    );

    if (!hasPermission) {
      throw new Error('Permission denied');
    }

    // 5. Apply action to CRDT
    await this.executeAction(action);

    // 6. Track nonce and broadcast to other clients
    this.usedNonces.add(nonceKey);
    this.room.broadcast(JSON.stringify({
      type: 'action_applied',
      action: {
        elementId: action.elementId,
        data: action.data,
        appliedBy: session.publicKey,
        appliedAt: Date.now()
      }
    }));

    // Clean up old nonces (5 minute window)
    setTimeout(() => this.usedNonces.delete(nonceKey), 5 * 60 * 1000);
  }

  // Periodic cleanup of expired sessions
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.validSessions.entries()) {
      if (session.expiresAt < now) {
        this.validSessions.delete(sessionId);
        console.log(`🗑️ Cleaned up expired session: ${sessionId}`);
      }
    }
  }

  constructor() {
    // Run cleanup every hour
    setInterval(() => this.cleanupExpiredSessions(), 60 * 60 * 1000);
  }
}

  private async checkUserPermission(
    domain: string,
    publicKey: string,
    elementId: string,
    action: string
  ): Promise<boolean> {
    const roles = this.globalRoles.get(domain);
    if (!roles) return false;

    // Check if user has required role for action
    const userRoles = await this.getUserRoles(domain, publicKey);
    const elementConfig = this.elementConfigs.get(elementId);

    if (!elementConfig) return false;

    const requiredRole = elementConfig.permissions[action];
    if (!requiredRole || requiredRole === "everyone") return true;

    return userRoles.includes(requiredRole);
  }
}
```

### 7. React Integration

**Advanced Security: Cryptographic Element Verification**

For elements requiring maximum security, PlayHTML will support cryptographic signatures that prevent HTML configuration tampering:

```html
<!-- Element owner signs the exact configuration -->
<div
  id="admin-panel"
  can-play
  playhtml-owner="spencer.place"
  playhtml-permissions="write:owner, delete:owner"
  playhtml-signature="ed25519:ABCD1234567890..."
></div>
```

**How Element Signatures Work:**

1. **Configuration Signing**: Website owners create a canonical message containing element ID, domain, owner, and permissions, then sign it with their private key
2. **Tamper Detection**: PlayHTML verifies the signature matches the current HTML attributes before processing any actions
3. **Authentication Chain**: Combined with session authentication, this creates end-to-end cryptographic verification

**Security Benefits:**

- **Prevents HTML tampering**: Can't modify `playhtml-owner` or `playhtml-permissions` without invalidating signature
- **Cryptographic proof**: Mathematical guarantee that configuration comes from legitimate owner
- **Decentralized**: No server-side configuration registry required

**Developer Experience Improvements for Signature Generation:**

- **React Development Hook**: `usePlayHTMLDev()` hook for automatic signature generation during development

  ```typescript
  const { signElementConfig } = usePlayHTMLDev();
  // Auto-generates signatures for development with console output
  ```

- **Build Tool Integration**: Webpack/Vite plugins and CLI tools for automated signature injection

  ```bash
  npx playhtml sign-elements --input src/ --output dist/
  # Scans components and auto-injects signatures during build
  ```

- **Browser Extension Dev Mode**: PlayHTML extension automatically detects development domains and generates signatures

  ```typescript
  // Extension auto-signs elements on localhost, *.dev, staging domains
  // Shows signature status in developer tools
  ```

- **Zero-Config Experience**: Progressive complexity from automatic dev signatures to production signing workflows
  ```typescript
  <CanPlay id="my-element" permissions="write:contributors" autoSign />
  // Signature auto-generated in development, build process handles production
  ```

**Implementation Status:** Element signatures are planned for Phase 3 after core session authentication is established. They provide optional enhanced security for sensitive elements while maintaining PlayHTML's ease-of-use for creative applications.

```tsx
// usePlayHTMLPermissions hook
function usePlayHTMLPermissions(elementId: string) {
  const [permissions, setPermissions] = useState({
    canRead: true,
    canWrite: true,
    canDelete: false,
    canModerate: false,
  });

  useEffect(() => {
    const updatePermissions = async () => {
      const identity = window.playhtmlAuth?.identity;

      const newPermissions = {
        canRead: await checkPermission(elementId, "read", identity),
        canWrite: await checkPermission(elementId, "write", identity),
        canDelete: await checkPermission(elementId, "delete", identity),
        canModerate: await checkPermission(elementId, "moderate", identity),
      };

      setPermissions(newPermissions);
    };

    updatePermissions();

    // Listen for auth changes
    window.addEventListener("playhtmlAuthReady", updatePermissions);
    return () =>
      window.removeEventListener("playhtmlAuthReady", updatePermissions);
  }, [elementId]);

  return permissions;
}

// Example usage in components
function GuestbookComponent({ id }: { id: string }) {
  const { data, setData } = usePlayHTML(id);
  const permissions = usePlayHTMLPermissions(id);

  const addEntry = async (text: string) => {
    try {
      await setData(
        id,
        {
          entries: [
            ...data.entries,
            { id: crypto.randomUUID(), text, timestamp: Date.now() },
          ],
        },
        { action: "write" }
      );
    } catch (error) {
      alert("Unable to add entry - permission denied");
    }
  };

  const deleteEntry = async (entryId: string) => {
    try {
      await setData(
        id,
        {
          entries: data.entries.filter((e) => e.id !== entryId),
        },
        { action: "delete" }
      );
    } catch (error) {
      alert("Unable to delete entry - permission denied");
    }
  };

  return (
    <div>
      {data.entries?.map((entry) => (
        <div key={entry.id}>
          <span>{entry.text}</span>
          {permissions.canDelete && (
            <button onClick={() => deleteEntry(entry.id)}>Delete</button>
          )}
        </div>
      ))}

      {permissions.canWrite ? (
        <AddEntryForm onSubmit={addEntry} />
      ) : (
        <p>You need permission to add entries to this guestbook.</p>
      )}
    </div>
  );
}
```

## Implementation Phases

### **Phase 1: Core Permission System (Immediate)**

1. **Clean HTML API**: Simple `playhtml-permissions="delete:owner"` syntax
2. **JavaScript role configuration**: Global role definitions in `initPlayHTML()`
3. **Automatic extension signing**: Domain-based auto-signing without user prompts
4. **Temp auth validation**: Server validates `_temp_auth` data and strips before broadcast
5. **Basic permission checking**: Owner, role-based, and "everyone" permission model

### **Phase 2: Enhanced Permissions (Next)**

1. **Custom permission conditions**: JavaScript functions for time-based, visit-based, etc.
2. **React permission hooks**: Easy access to permission state in components
3. **Advanced role assignments**: Conditional roles based on user behavior
4. **Audit logging**: Track all permission checks and violations
5. **Permission inheritance**: Element-level permission inheritance

### **Phase 3: Advanced Features (Future)**

1. **UCAN-style capabilities**: Delegatable, time-limited permission tokens
2. **Cross-domain permissions**: Trusted domain verification via DNS
3. **Admin dashboard**: GUI for permission management at `admin.playhtml.fun`
4. **Enterprise integration**: OAuth/SAML support for organizational identity

### 8. Session Management & User Experience

**Automatic Session Renewal Benefits:**

**✅ Seamless User Experience**: Users authenticate once and then interact freely for 24 hours without interruption

**✅ Transparent Renewal**: Sessions automatically renew in the background when 1 hour remains, invisible to users

**✅ Graceful Failure**: If renewal fails, users get clear instructions to refresh rather than cryptic errors

**✅ Multi-Tab Support**: Session renewal works across browser tabs since sessions are identified by public key

**✅ Development Friendly**: Optional session status component for debugging and monitoring

**Session Lifecycle:**

1. **Initial Authentication**: User signs challenge on first interaction
2. **Active Period**: 23 hours of seamless interaction
3. **Auto-Renewal**: Transparent renewal when 1 hour remains
4. **Expiration Handling**: Clear messaging and refresh instruction if renewal fails

**Events for UI Integration:**

```typescript
// Listen for session events in your application
window.addEventListener("playhtmlSessionEstablished", (e) => {
  console.log("✅ Session established:", e.detail.sessionId);
});

window.addEventListener("playhtmlSessionRenewed", (e) => {
  console.log("🔄 Session renewed:", e.detail.sessionId);
});

window.addEventListener("playhtmlSessionExpired", (e) => {
  console.log("❌ Session expired:", e.detail.error);
  showRefreshPrompt();
});
```

## Security Benefits of Session-Only Authentication

### **What Session Authentication Provides:**

**✅ Identity Verification**: Users must cryptographically prove they control their private key during session establishment

**✅ Prevents Identity Spoofing**: Can't fake being another user without their actual private key

**✅ Session Management**: Controlled expiry, automatic renewal, domain binding, and revocation capabilities

**✅ Replay Protection**: Nonce tracking prevents duplicate actions within session lifetime

**✅ Performance**: One-time crypto operation per page load instead of per action

**✅ Multi-Tab Consistency**: Session renewal works across browser tabs for seamless experience

### **Security Comparison:**

| Attack Vector           | Session Auth Protection                | Per-Action Signing                      | Anonymous Mode                    |
| ----------------------- | -------------------------------------- | --------------------------------------- | --------------------------------- |
| **Identity Spoofing**   | ✅ Cryptographically prevented         | ✅ Cryptographically prevented          | ❌ No identity verification       |
| **Action Tampering**    | ✅ Server validates all actions        | ✅ Each action cryptographically signed | ⚠️ Basic permission checking only |
| **Replay Attacks**      | ✅ Nonce tracking + session expiry     | ✅ Individual action nonces             | ❌ No replay protection           |
| **Client Modification** | ✅ Actions validated server-side       | ✅ Signatures validated server-side     | ⚠️ Relies on client-side checking |
| **Session Hijacking**   | ✅ Domain binding + auto-renewal       | ✅ No session concept                   | N/A                               |
| **Performance Impact**  | ✅ Fast (one-time auth + auto-renewal) | ❌ Slow (crypto per action)             | ✅ Fastest (no crypto)            |
| **User Experience**     | ✅ Seamless after initial auth         | ❌ Approval prompts per action          | ✅ No auth friction               |
| **Multi-Tab Support**   | ✅ Works across tabs                   | ⚠️ Each tab needs individual setup      | ✅ No setup needed                |

### **When Session Auth is Sufficient:**

- ✅ Creative collaboration (art, writing, games)
- ✅ Social interactions (guestbooks, comments, reactions)
- ✅ Community moderation (content curation, basic access control)
- ✅ Educational tools (shared whiteboards, polls)
- ✅ Most PlayHTML use cases

### **When Per-Action Signing Might Be Needed:**

- ⚠️ Financial transactions or payment processing
- ⚠️ Legal document modifications
- ⚠️ Medical record updates
- ⚠️ High-stakes administrative changes

For PlayHTML's creative and social focus, **session authentication with automatic renewal provides the optimal balance** of strong security with excellent user experience.

## Security Model & Limitations

### **Trust Model**

PlayHTML uses a **"session-based cryptographic authentication"** model that balances security with usability:

- **Session Establishment**: Users prove identity through challenge-response cryptography
- **Action Validation**: Server validates each action against established session permissions
- **Optimistic Updates**: Actions appear immediately but can be rolled back if server rejects
- **Domain Binding**: Sessions are tied to specific domains for additional security

### **Known Security Limitations**

**1. Session-Based Trust Window**

- **Risk**: All actions within a valid session are trusted without individual signing
- **Impact**: Compromised client could perform multiple actions before session expires
- **Mitigation**: Short session lifetime (24 hours), nonce tracking, permission validation
- **Acceptable for**: Creative, social platforms where consequences are reversible

**2. Browser Extension Dependency**

- **Risk**: Users rely on browser extension for identity and session establishment
- **Impact**: Malicious extensions could auto-establish sessions for unauthorized domains
- **Mitigation**: Extension permission system limits scope to trusted domains
- **User responsibility**: Only install PlayHTML extensions from trusted sources

**3. Optimistic Update Window**

- **Risk**: Invalid actions appear briefly for the user before server validation
- **Impact**: Temporary "split brain" state until server responds
- **Mitigation**: Only affects the user attempting invalid actions
- **Behavior**: Invalid changes disappear on server response or page refresh

**4. Element Configuration Trust**

- **Risk**: HTML-based permissions can be modified in browser dev tools
- **Impact**: Users could claim false ownership or permissions locally
- **Mitigation**: Server validates against authoritative configuration (Element Signatures in Phase 3)
- **Current state**: Relies on social trust and basic validation

### **Recommended Use Cases**

**✅ Good fit:**

- Creative collaboration (art, writing, games)
- Social interactions (guestbooks, comments, reactions)
- Community moderation (content curation, basic access control)
- Educational tools (shared whiteboards, polls)

**❌ Not recommended:**

- Financial transactions or payment processing
- Medical records or sensitive personal information
- Legal documents or contracts
- High-stakes data where corruption has serious consequences

## Open Questions for Discussion

1. **Cross-domain role inheritance**: Should roles defined on one domain work on related subdomains?

2. **Permission condition caching**: How long should we cache results of expensive permission conditions (like geolocation)?

3. **Role delegation**: Should users be able to delegate their roles to others temporarily?

4. **Permission debugging**: What developer tools should we provide for debugging permission issues?

5. **Rate limiting**: Should permission checks themselves be rate limited to prevent abuse?

6. **Graceful degradation**: How should elements behave when session establishment fails due to network issues?

7. **Element-level vs global roles**: Should we support element-specific role overrides in addition to global roles?

8. **Session renewal notifications**: Should we show users when their session is being renewed, or keep it completely transparent?

9. **Multi-device sessions**: Should a user be able to have multiple active sessions across different devices simultaneously?

10. **Session analytics**: What session-related metrics should we track for debugging and optimization?

11. **Migration strategy**: How do we handle permission changes on existing elements with historical data?

12. **Offline session handling**: How should the system behave when users go offline during an active session?
