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
  signature: string; // Cryptographic signature
  publicKey: string; // Actor's public key
  algorithm?: string; // Signature algorithm (Ed25519 or RSA-PSS)
}

export interface AuthenticatedMessage {
  type: string;
  data: any;
  timestamp: number;
  nonce: string;
  signature: string;
  publicKey: string;
  algorithm?: string; // Signature algorithm (Ed25519 or RSA-PSS)
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

// Shared cryptographic utilities for both client and server

// Utility functions for base64 encoding/decoding (shared between environments)
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Import public key from base64 string for verification (shared utility)
async function importPublicKey(publicKeyBase64: string, algorithm: string = "Ed25519"): Promise<CryptoKey> {
  // For Node.js environments, use Buffer; for browser, use base64ToArrayBuffer
  const publicKeyBuffer = typeof Buffer !== 'undefined' 
    ? Buffer.from(publicKeyBase64, "base64")
    : base64ToArrayBuffer(publicKeyBase64);
  
  const keyAlgorithm = algorithm === "RSA-PSS" 
    ? { name: "RSA-PSS", hash: "SHA-256" }
    : { name: "Ed25519" };
  
  return await crypto.subtle.importKey(
    "spki",
    publicKeyBuffer,
    keyAlgorithm,
    false, // not extractable
    ["verify"]
  );
}

// Consolidated signature verification function (replaces both crypto.ts and previous common implementation)
export async function verifySignature(
  message: string,
  signatureBase64: string,
  publicKeyBase64: string,
  algorithm: string = "Ed25519"
): Promise<boolean> {
  try {
    // Early return for empty inputs
    if (!signatureBase64 || !publicKeyBase64) {
      return false;
    }
    
    // Check if inputs are valid base64
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(publicKeyBase64) || 
        !/^[A-Za-z0-9+/]*={0,2}$/.test(signatureBase64)) {
      return false;
    }

    const publicKey = await importPublicKey(publicKeyBase64, algorithm);
    const messageBuffer = new TextEncoder().encode(message);
    
    // For Node.js environments, use Buffer; for browser, use base64ToArrayBuffer
    const signatureBuffer = typeof Buffer !== 'undefined'
      ? Buffer.from(signatureBase64, "base64") 
      : base64ToArrayBuffer(signatureBase64);
    
    const verifyAlgorithm = algorithm === "RSA-PSS" 
      ? { name: "RSA-PSS", saltLength: 32 }
      : "Ed25519";
    
    return await crypto.subtle.verify(
      verifyAlgorithm,
      publicKey,
      signatureBuffer,
      messageBuffer
    );
  } catch (error) {
    console.error("Failed to verify signature:", error);
    return false;
  }
}