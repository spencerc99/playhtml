// PlayHTML Authentication System
// Implements identity management and global auth object

import type {
  PlayHTMLIdentity,
  PlayHTMLAuth,
  PermissionContext,
  GlobalRoleDefinition,
  PermissionConfig,
  PermissionFunction,
  SessionChallenge,
  ValidatedSession,
  SessionAction,
} from "@playhtml/common";
import {
  generateIdentity,
  signMessage,
  verifySignature,
  importIdentity,
  exportIdentity,
} from "./crypto";

// Re-export crypto functions for external use
export {
  generateIdentity,
  signMessage,
  verifySignature,
  importIdentity,
  exportIdentity,
  createSignedAction,
  createAuthenticatedMessage,
} from "./crypto";

// Global auth state
let currentIdentity: PlayHTMLIdentity | undefined;
let authReadyCallbacks: Array<(auth: PlayHTMLAuth) => void> = [];

// Global permission configuration
let globalRoles: GlobalRoleDefinition = {};
let permissionConditions: Record<string, PermissionFunction> = {};

// Session management state
let currentSession: ValidatedSession | null = null;
let sessionRenewalTimer: number | null = null;

// No built-in permission functions - users define their own custom functions

// Create PlayHTMLAuth object from identity
function createAuthFromIdentity(identity?: PlayHTMLIdentity): PlayHTMLAuth {
  return {
    identity,
    isAuthenticated: !!identity,
    sign: async (message: string) => {
      if (!identity) throw new Error("No identity available for signing");
      return await signMessage(
        message,
        identity.privateKey,
        identity.algorithm
      );
    },
    verify: async (
      message: string,
      signature: string,
      publicKey: string,
      algorithm?: string
    ) => {
      return await verifySignature(message, signature, publicKey, algorithm);
    },
  };
}

// Initialize authentication system
export async function initializeAuth(): Promise<PlayHTMLAuth> {
  // Check if extension has already injected auth
  if (window.playhtmlAuth) {
    console.log("PlayHTML Auth: Using extension-provided identity");
    currentIdentity = window.playhtmlAuth.identity;
    return window.playhtmlAuth;
  }

  // Check for stored identity in localStorage (fallback)
  const storedIdentity = getStoredIdentity();
  if (storedIdentity) {
    console.log("PlayHTML Auth: Using stored identity");
    currentIdentity = storedIdentity;
    const auth = createAuthFromIdentity(storedIdentity);
    injectGlobalAuth(auth);
    return auth;
  }

  // No identity found - running in read-only mode
  console.log("PlayHTML Auth: No identity found, running in read-only mode");
  const auth = createAuthFromIdentity();
  injectGlobalAuth(auth);
  return auth;
}

// Get stored identity from localStorage
function getStoredIdentity(): PlayHTMLIdentity | undefined {
  try {
    const stored = localStorage.getItem("playhtml_identity");
    if (stored) {
      return importIdentity(stored);
    }
  } catch (error) {
    console.error("Failed to load stored identity:", error);
  }
  return undefined;
}

// Store identity in localStorage
export function storeIdentity(identity: PlayHTMLIdentity): void {
  try {
    const exported = exportIdentity(identity);
    localStorage.setItem("playhtml_identity", exported);
    currentIdentity = identity;

    // Update global auth object
    const auth = createAuthFromIdentity(identity);
    injectGlobalAuth(auth);

    console.log("Identity stored successfully");
  } catch (error) {
    console.error("Failed to store identity:", error);
    throw error;
  }
}

// Clear stored identity
export function clearIdentity(): void {
  localStorage.removeItem("playhtml_identity");
  currentIdentity = undefined;

  // Update global auth object
  const auth = createAuthFromIdentity();
  injectGlobalAuth(auth);

  console.log("Identity cleared");
}

// Inject auth object into global scope
function injectGlobalAuth(auth: PlayHTMLAuth): void {
  window.playhtmlAuth = auth;

  // Dispatch event for PlayHTML to react to auth changes
  window.dispatchEvent(new CustomEvent("playhtmlAuthReady", { detail: auth }));

  // Notify any waiting callbacks
  authReadyCallbacks.forEach((callback) => callback(auth));
  authReadyCallbacks = [];
}

// Wait for auth to be ready
export function onAuthReady(callback: (auth: PlayHTMLAuth) => void): void {
  if (window.playhtmlAuth) {
    callback(window.playhtmlAuth);
  } else {
    authReadyCallbacks.push(callback);
  }
}

// Generate and store a new identity
export async function createNewIdentity(
  displayName?: string
): Promise<PlayHTMLIdentity> {
  const identity = await generateIdentity(displayName);
  storeIdentity(identity);
  return identity;
}

// Check if user has permission for a specific action using new simplified model
export async function checkPermission(
  elementId: string,
  action: string,
  userIdentity?: PlayHTMLIdentity
): Promise<boolean> {
  const element = document.getElementById(elementId);
  if (!element) return false;

  const permissionsAttr = element.getAttribute("playhtml-permissions");
  if (!permissionsAttr) {
    // No restrictions = everyone can do everything
    return true;
  }

  // Parse permissions like "write:contributors, delete:moderators"
  const permissions = parsePermissions(permissionsAttr);
  const requiredRole = permissions[action];

  if (!requiredRole) {
    // Action not restricted
    return true;
  }

  if (requiredRole === "everyone") {
    return true;
  }

  if (!userIdentity) {
    // No identity, can only access "everyone" permissions
    return false;
  }

  // Check if user has required role
  const userRoles = await getUserRolesForElement(elementId, userIdentity);
  return userRoles.includes(requiredRole);
}

// Helper functions
function getVisitCount(domain: string): number {
  try {
    const stored = localStorage.getItem(`playhtml_visits_${domain}`);
    const count = stored ? parseInt(stored) : 0;
    localStorage.setItem(`playhtml_visits_${domain}`, (count + 1).toString());
    return count + 1;
  } catch {
    return 0;
  }
}

function getElementCustomData(element: HTMLElement): Record<string, any> {
  try {
    const customData = element.getAttribute("playhtml-custom-data");
    return customData ? JSON.parse(customData) : {};
  } catch {
    return {};
  }
}

// Configure global roles and permission conditions
export function configureGlobalPermissions(
  roles: GlobalRoleDefinition,
  conditions: Record<string, PermissionFunction> = {}
): void {
  globalRoles = roles;
  permissionConditions = conditions;
  console.log("[PLAYHTML AUTH]: Configured global permissions", {
    roles,
    conditions,
  });
}

// Parse simple permission string like "write:owner, delete:moderators"
export function parsePermissions(permissionsAttr: string): PermissionConfig {
  const permissions: PermissionConfig = {};

  permissionsAttr.split(",").forEach((perm) => {
    const [action, role] = perm.trim().split(":");
    if (action && role) {
      permissions[action.trim()] = role.trim();
    }
  });

  return permissions;
}

// Get user's roles based on global configuration
export async function getUserRolesForElement(
  elementId: string,
  userIdentity?: PlayHTMLIdentity
): Promise<string[]> {
  const roles: string[] = [];

  if (!userIdentity) {
    return ["everyone"]; // Default role for unauthenticated users
  }

  const context = await buildPermissionContext(userIdentity, elementId);

  for (const [roleName, roleDefinition] of Object.entries(globalRoles)) {
    if (Array.isArray(roleDefinition)) {
      // Explicit public key list
      if (roleDefinition.includes(userIdentity.publicKey)) {
        roles.push(roleName);
      }
    } else if (roleDefinition.condition) {
      // Conditional role assignment
      const conditionFn = permissionConditions[roleDefinition.condition];
      if (conditionFn) {
        try {
          if (await conditionFn(context)) {
            roles.push(roleName);
          }
        } catch (error) {
          console.error(
            `Failed to evaluate role condition '${roleDefinition.condition}':`,
            error
          );
        }
      } else {
        console.warn(
          `Permission condition '${roleDefinition.condition}' not found in custom conditions`
        );
      }
    }
  }

  return roles.length > 0 ? roles : ["visitor"]; // Default to visitor if no roles matched
}

// Build permission context for evaluation
async function buildPermissionContext(
  userIdentity: PlayHTMLIdentity | undefined,
  elementId: string
): Promise<PermissionContext> {
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error(`Element ${elementId} not found`);
  }

  return {
    user: userIdentity,
    element,
    domain: window.location.hostname,
    visitCount: getVisitCount(window.location.hostname),
    timeOfDay: new Date().getHours(),
    customData: getElementCustomData(element),
  };
}

// Get current authenticated identity
export function getCurrentIdentity(): PlayHTMLIdentity | undefined {
  return currentIdentity || window.playhtmlAuth?.identity;
}

// Session Management Functions

// Generate a challenge for session establishment
export function generateSessionChallenge(): SessionChallenge {
  const challenge = crypto.randomUUID();
  const domain = window.location.hostname;
  const timestamp = Date.now();
  const expiresAt = timestamp + 5 * 60 * 1000; // 5 minutes

  return {
    challenge,
    domain,
    timestamp,
    expiresAt,
  };
}

// Internal session establishment with WebSocket (called from main.ts)
export async function establishSessionWithWS(
  identity: PlayHTMLIdentity,
  ws: WebSocket
): Promise<ValidatedSession> {
  return new Promise((resolve, reject) => {
    const challenge = generateSessionChallenge();

    // Sign the challenge to prove identity ownership
    signMessage(
      JSON.stringify(challenge),
      identity.privateKey,
      identity.algorithm
    )
      .then((signature) => {
        const request = {
          type: "session_establish",
          challenge,
          signature,
          publicKey: identity.publicKey,
          algorithm: identity.algorithm || "Ed25519",
        };

        // Set up one-time listener for session response
        const handleMessage = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            if (
              data.type === "session_established" ||
              data.type === "session_renewed"
            ) {
              ws.removeEventListener("message", handleMessage);

              const session: ValidatedSession = {
                sessionId: data.sessionId,
                publicKey: data.publicKey,
                domain: window.location.hostname,
                establishedAt: Date.now(),
                expiresAt: data.expiresAt,
              };

              // Store session and set up auto-renewal
              currentSession = session;
              scheduleSessionRenewal(session);

              // Dispatch session events
              const eventType =
                data.type === "session_renewed"
                  ? "playhtmlSessionRenewed"
                  : "playhtmlSessionEstablished";
              window.dispatchEvent(
                new CustomEvent(eventType, { detail: session })
              );

              console.log(
                `✅ Session ${
                  data.type === "session_renewed" ? "renewed" : "established"
                }: ${session.sessionId}`
              );

              resolve(session);
            } else if (data.type === "session_error") {
              ws.removeEventListener("message", handleMessage);
              reject(new Error(data.message || "Session establishment failed"));
            }
          } catch (error) {
            // Ignore non-JSON messages
          }
        };

        ws.addEventListener("message", handleMessage);

        // Send session establishment request
        ws.send(JSON.stringify(request));

        // Set timeout for session establishment
        setTimeout(() => {
          ws.removeEventListener("message", handleMessage);
          reject(new Error("Session establishment timeout"));
        }, 10000); // 10 second timeout
      })
      .catch(reject);
  });
}

// Public session establishment function (delegates to main.ts)
export async function establishSession(
  identity?: PlayHTMLIdentity
): Promise<ValidatedSession> {
  const actualIdentity = identity || getCurrentIdentity();
  if (!actualIdentity) {
    throw new Error("No identity available for session establishment");
  }

  // This will be called by the main module with the actual WebSocket
  throw new Error(
    "Session establishment must be called through PlayHTML main module"
  );
}

// Schedule automatic session renewal
function scheduleSessionRenewal(session: ValidatedSession): void {
  if (sessionRenewalTimer) {
    clearTimeout(sessionRenewalTimer);
  }

  // Renew when 1 hour remains (23 hours after establishment)
  const renewalTime = session.expiresAt - 60 * 60 * 1000; // 1 hour before expiry
  const timeUntilRenewal = renewalTime - Date.now();

  if (timeUntilRenewal > 0) {
    sessionRenewalTimer = window.setTimeout(async () => {
      try {
        const identity = getCurrentIdentity();
        if (identity) {
          await establishSession(identity); // This will extend the existing session
        }
      } catch (error) {
        console.error("Session renewal failed:", error);
        window.dispatchEvent(
          new CustomEvent("playhtmlSessionExpired", {
            detail: {
              error: error instanceof Error ? error.message : String(error),
            },
          })
        );
      }
    }, timeUntilRenewal);

    console.log(
      `🔄 Session renewal scheduled in ${Math.round(
        timeUntilRenewal / 1000 / 60
      )} minutes`
    );
  }
}

// Get current session
export function getCurrentSession(): ValidatedSession | null {
  return currentSession;
}

// Create a session action (replaces signed actions for better performance)
export function createSessionAction(
  action: string,
  elementId: string,
  data: any
): SessionAction {
  if (!currentSession) {
    throw new Error("No active session for creating actions");
  }

  return {
    sessionId: currentSession.sessionId,
    action,
    elementId,
    data,
    timestamp: Date.now(),
    nonce: crypto.randomUUID(),
  };
}

// Initialize session authentication on page load (called from main.ts with WebSocket)
export async function initializeSessionAuth(ws?: WebSocket): Promise<void> {
  const identity = getCurrentIdentity();
  if (identity && ws) {
    try {
      await establishSessionWithWS(identity, ws);
    } catch (error) {
      console.warn("Failed to establish session on page load:", error);
      // Continue without session - user can still interact with public elements
    }
  }
}
