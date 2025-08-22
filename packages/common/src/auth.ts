// PlayHTML Authentication & Identity Types
// Based on the design in docs/auth.md

export interface PlayHTMLIdentity {
  privateKey: string; // Private key for signing (base64 encoded)
  publicKey: string; // Public identity (base64 encoded)
  displayName?: string; // Human-readable name
  avatar?: string; // Custom avatar/cursor style
  createdAt: number; // Identity creation timestamp
  version: number; // For future migrations
  verifiedDomains?: string[]; // DNS-verified domain aliases
  algorithm?: string; // Crypto algorithm used (Ed25519 or RSA-PSS)
}

export interface PlayHTMLAuth {
  identity?: PlayHTMLIdentity;
  isAuthenticated: boolean;
  sign: (message: string) => Promise<string>;
  verify: (message: string, signature: string, publicKey: string) => Promise<boolean>;
}

// Simplified permission model
export interface GlobalRoleDefinition {
  [roleName: string]: string[] | { condition: string }; // Public keys array or conditional assignment
}

export interface PermissionConfig {
  [action: string]: string; // action -> required role mapping
}

export interface GlobalPlayHTMLConfig {
  roles?: GlobalRoleDefinition;
  permissionConditions?: Record<string, PermissionFunction>;
}

export interface PermissionContext {
  user?: PlayHTMLIdentity;
  element: HTMLElement;
  domain: string;
  visitCount: number;
  timeOfDay: number;
  userLocation?: { lat: number; lng: number };
  siteLocation?: { lat: number; lng: number };
  customData: Record<string, any>; // Site-specific context
}

export interface SignedAction {
  action: string; // What action is being performed
  elementId: string; // Target element
  data: any; // Action payload
  timestamp: number; // When action was created
  nonce: string; // Unique nonce to prevent replay
  signature: string; // Ed25519 signature
  publicKey: string; // Actor's public key
}

export interface AuthenticatedMessage {
  type: string;
  data: any;
  timestamp: number;
  nonce: string;
  signature: string;
  publicKey: string;
}

export interface UserSession {
  publicKey: string;
  connectedAt: number;
  lastSeen: number;
  verifiedDomains: string[];
}

// Session-based authentication types
export interface SessionChallenge {
  challenge: string;
  domain: string;
  timestamp: number;
  expiresAt: number;
}

export interface ValidatedSession {
  sessionId: string;
  publicKey: string;
  domain: string;
  establishedAt: number;
  expiresAt: number;
  permissions?: any; // Cached permissions for this session
}

export interface SessionAction {
  sessionId: string;
  action: string;
  elementId: string;
  data: any;
  timestamp: number;
  nonce: string;
}

export interface SessionEstablishmentRequest {
  challenge: SessionChallenge;
  signature: string;
  publicKey: string;
}

export interface SessionEstablishmentResponse {
  sessionId: string;
  publicKey: string;
  expiresAt: number;
  renewed: boolean;
}

// Permission function type for extensible custom logic
export type PermissionFunction = (context: PermissionContext) => Promise<boolean>;

// Declare global auth object for extension integration
declare global {
  interface Window {
    playhtmlAuth?: PlayHTMLAuth;
  }
}