// PlayHTML Authentication System
// Implements identity management and global auth object
//
// NOTE: Permissions are checked client-side only and are advisory.
// A modified client can bypass permission checks. The CRDT layer (Yjs)
// does not enforce permissions. If server-side enforcement is needed,
// CRDT writes would need an authorization middleware on the server.

import type {
  PlayHTMLIdentity,
  PlayHTMLAuth,
  PermissionContext,
  PermissionConfig,
  PermissionFunction,
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
} from "./crypto";

// Role definition: either an explicit list of public keys, or a condition function
export type RoleDefinition = string[] | PermissionFunction;

// Global auth state
let currentIdentity: PlayHTMLIdentity | undefined;
let authReadyCallbacks: Array<(auth: PlayHTMLAuth) => void> = [];

// Global permission configuration
let globalRoles: Record<string, RoleDefinition> = {};

// Session management state
let currentSession: ValidatedSession | null = null;
let sessionRenewalTimer: number | null = null;
// Set externally by the main module when WebSocket is available
let sessionWebSocket: WebSocket | null = null;

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

// Check if user has permission for a specific action using global roles first,
// then element-specific permissions.
//
// NOTE: This check is client-side only and advisory. See module header comment.
export async function checkPermission(
  elementId: string,
  action: string,
  userIdentity?: PlayHTMLIdentity
): Promise<boolean> {
  const element = document.getElementById(elementId);
  if (!element) return false;

  // First check if this is a globally owned element (from InitOptions.roles)
  if (userIdentity && Object.keys(globalRoles).length > 0) {
    const userRoles = await getUserRolesForElement(elementId, userIdentity);

    // Check if user has "owner" or "admin" role globally - these have write access to all elements
    if (userRoles.includes("owner") || userRoles.includes("admin")) {
      return true;
    }
  }

  // Check element-specific permissions (playhtml-permissions attribute)
  const permissionsAttr = element.getAttribute("playhtml-permissions");
  if (!permissionsAttr) {
    // No element-specific restrictions = allow access
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

  // Check if user has required role for this specific element
  const userRoles = await getUserRolesForElement(elementId, userIdentity);
  return userRoles.includes(requiredRole);
}

// Configure global roles.
// Roles can be:
//   - string[] of public keys (explicit membership)
//   - PermissionFunction (inline condition, evaluated at check time)
export function configureGlobalPermissions(
  roles: Record<string, RoleDefinition>,
): void {
  globalRoles = roles;
  console.log("[PLAYHTML AUTH]: Configured global permissions", {
    roles: Object.keys(roles),
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

  for (const [roleName, roleDefinition] of Object.entries(globalRoles)) {
    if (Array.isArray(roleDefinition)) {
      // Explicit public key list
      if (roleDefinition.includes(userIdentity.publicKey)) {
        roles.push(roleName);
      }
    } else if (typeof roleDefinition === "function") {
      // Inline condition function — no indirection through named conditions
      const context = buildPermissionContext(userIdentity, elementId);
      try {
        if (await roleDefinition(context)) {
          roles.push(roleName);
        }
      } catch (error) {
        console.error(
          `Failed to evaluate role condition for '${roleName}':`,
          error
        );
      }
    }
  }

  return roles.length > 0 ? roles : ["visitor"]; // Default to visitor if no roles matched
}

// Get the current user's roles (convenience helper for UI rendering)
export async function getMyRoles(elementId?: string): Promise<string[]> {
  const identity = getCurrentIdentity();
  return getUserRolesForElement(elementId || "", identity);
}

// Build permission context for condition evaluation
function buildPermissionContext(
  userIdentity: PlayHTMLIdentity | undefined,
  elementId: string
): PermissionContext {
  const element = document.getElementById(elementId);

  return {
    user: userIdentity,
    element: element || document.createElement("div"),
    domain: window.location.hostname,
    customData: element ? getElementCustomData(element) : {},
  };
}

function getElementCustomData(element: HTMLElement): Record<string, any> {
  try {
    const customData = element.getAttribute("playhtml-custom-data");
    return customData ? JSON.parse(customData) : {};
  } catch {
    return {};
  }
}

// Get current authenticated identity
export function getCurrentIdentity(): PlayHTMLIdentity | undefined {
  return currentIdentity || window.playhtmlAuth?.identity;
}

// Session Management Functions

// Set the WebSocket used for session management (called from main module)
export function setSessionWebSocket(ws: WebSocket): void {
  sessionWebSocket = ws;
}

// Establish or re-establish a session over the current WebSocket
export async function establishSession(
  identity?: PlayHTMLIdentity
): Promise<ValidatedSession> {
  const actualIdentity = identity || getCurrentIdentity();
  if (!actualIdentity) {
    throw new Error("No identity available for session establishment");
  }
  if (!sessionWebSocket) {
    throw new Error("No WebSocket connection available");
  }
  return await establishSessionWithWS(actualIdentity, sessionWebSocket);
}

// Internal session establishment with WebSocket
// Uses server-initiated challenge-response: client requests challenge,
// server generates and sends it, client signs and returns it.
export async function establishSessionWithWS(
  identity: PlayHTMLIdentity,
  ws: WebSocket
): Promise<ValidatedSession> {
  return new Promise((resolve, reject) => {
    // Request a challenge from the server
    const request = {
      type: "session_request_challenge",
      publicKey: identity.publicKey,
      algorithm: identity.algorithm || "Ed25519",
    };

    // Set up one-time listener for server responses
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "session_challenge") {
          // Server sent a challenge — sign it and respond
          signMessage(
            JSON.stringify(data.challenge),
            identity.privateKey,
            identity.algorithm
          )
            .then((signature) => {
              ws.send(
                JSON.stringify({
                  type: "session_establish",
                  challenge: data.challenge,
                  signature,
                  publicKey: identity.publicKey,
                  algorithm: identity.algorithm || "Ed25519",
                })
              );
            })
            .catch((err) => {
              ws.removeEventListener("message", handleMessage);
              reject(err);
            });
        } else if (
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
            `Session ${
              data.type === "session_renewed" ? "renewed" : "established"
            }: ${session.sessionId.slice(0, 8)}...`
          );

          resolve(session);
        } else if (data.type === "session_error") {
          ws.removeEventListener("message", handleMessage);
          reject(new Error(data.message || "Session establishment failed"));
        }
      } catch {
        // Non-JSON message, ignore
      }
    };

    ws.addEventListener("message", handleMessage);

    // Send challenge request to server
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(request));
    } else {
      ws.removeEventListener("message", handleMessage);
      reject(new Error("WebSocket not open"));
    }

    // Set timeout for session establishment
    setTimeout(() => {
      ws.removeEventListener("message", handleMessage);
      reject(new Error("Session establishment timeout"));
    }, 10000); // 10 second timeout
  });
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
        await establishSession();
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
      `Session renewal scheduled in ${Math.round(
        timeUntilRenewal / 1000 / 60
      )} minutes`
    );
  }
}

// Get current session
export function getCurrentSession(): ValidatedSession | null {
  return currentSession;
}

// Create a session action (lightweight — no per-action signing)
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
export async function initializeSessionAuth(ws: WebSocket): Promise<void> {
  setSessionWebSocket(ws);
  const identity = getCurrentIdentity();
  if (identity) {
    // Wait for WebSocket to be fully ready
    if (ws.readyState !== WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        const checkReady = () => {
          if (ws.readyState === WebSocket.OPEN) {
            resolve();
          } else {
            setTimeout(checkReady, 100);
          }
        };
        checkReady();
      });
    }

    try {
      await establishSessionWithWS(identity, ws);
    } catch (error) {
      console.warn("Failed to establish session on page load:", error);
      // Continue without session - user can still interact with public elements
    }
  }
}
